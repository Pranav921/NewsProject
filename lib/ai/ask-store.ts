import "server-only";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { getRedisKeyspace } from "../redis-keyspace.ts";
import { ASK_CACHE_BYTES, ASK_DAILY_GENERATIONS, ASK_INPUT_RESERVATION, ASK_LEASE_SECONDS, AskBackendError, withinAskDeadline } from "./ask-settings.ts";
import type { AskConfig } from "./ask-settings.ts";

// All keys are explicit KEYS with the same Ask-only hash tag. Redis TIME, not
// client clocks, owns sliding windows, daily counters and lease expiration.
// Admission = abuse limits for EVERY request, cache hits included (each one still
// loads RSS and touches Redis): leases, user 3/min, IP 5/min, user 10/day.
// KEYS: lease, user minute, IP minute, user-day, active. ARGV: owner, lease seconds.
export const ASK_ADMIT_SCRIPT = `
local now = tonumber(redis.call('TIME')[1])
local day = math.floor(now / 86400)
local retry = 86400 - (now % 86400)
redis.call('ZREMRANGEBYSCORE', KEYS[5], '-inf', now)
if redis.call('EXISTS', KEYS[1]) == 1 then return {0, math.max(1, redis.call('TTL', KEYS[1]))} end
if redis.call('ZCARD', KEYS[5]) >= 2 then return {0, 3} end
for i = 2, 3 do
  redis.call('ZREMRANGEBYSCORE', KEYS[i], '-inf', now - 60)
  local limit = 3
  if i == 3 then limit = 5 end
  if redis.call('ZCARD', KEYS[i]) >= limit then return {2, 60} end
end
local count = 0
if tonumber(redis.call('HGET', KEYS[4], 'day') or '-1') == day then count = tonumber(redis.call('HGET', KEYS[4], 'count') or '0') end
if count >= 10 then return {2, retry} end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('ZADD', KEYS[5], now + tonumber(ARGV[2]), ARGV[1])
redis.call('EXPIRE', KEYS[5], tonumber(ARGV[2]) * 2)
for i = 2, 3 do redis.call('ZADD', KEYS[i], now, ARGV[1]); redis.call('EXPIRE', KEYS[i], 120) end
redis.call('HSET', KEYS[4], 'day', day, 'count', count + 1)
redis.call('EXPIRE', KEYS[4], 172800)
return {1, 0}
`;
// Reservation = paid generation budgets, reached only on a cache miss. The global
// generation-request cap, attempts and token units are checked together and all
// incremented, or none are. KEYS: lease, active, model-day, reservation,
// generation-day. ARGV: owner, attempts cap, token cap, first, second, generation cap.
export const ASK_RESERVE_SCRIPT = `
local now = tonumber(redis.call('TIME')[1])
local day = math.floor(now / 86400)
if redis.call('GET', KEYS[1]) ~= ARGV[1] or tonumber(redis.call('ZSCORE', KEYS[2], ARGV[1]) or '0') <= now then return {-1, 3} end
if redis.call('EXISTS', KEYS[4]) == 1 then return {-1, 3} end
if tonumber(redis.call('HGET', KEYS[3], 'day') or '-1') ~= day then
  redis.call('HSET', KEYS[3], 'day', day, 'used', 0, 'reserved', 0, 'tokensUsed', 0, 'tokensReserved', 0)
end
local generations = 0
if tonumber(redis.call('HGET', KEYS[5], 'day') or '-1') == day then generations = tonumber(redis.call('HGET', KEYS[5], 'count') or '0') end
local attempts = tonumber(redis.call('HGET', KEYS[3], 'used')) + tonumber(redis.call('HGET', KEYS[3], 'reserved'))
local tokens = tonumber(redis.call('HGET', KEYS[3], 'tokensUsed')) + tonumber(redis.call('HGET', KEYS[3], 'tokensReserved'))
local total = tonumber(ARGV[4]) + tonumber(ARGV[5])
if generations >= tonumber(ARGV[6]) or attempts + 2 > tonumber(ARGV[2]) or tokens + total > tonumber(ARGV[3]) then return {0, 86400 - (now % 86400)} end
redis.call('HSET', KEYS[5], 'day', day, 'count', generations + 1)
redis.call('EXPIRE', KEYS[5], 172800)
redis.call('HINCRBY', KEYS[3], 'reserved', 2)
redis.call('HINCRBY', KEYS[3], 'tokensReserved', total)
redis.call('EXPIRE', KEYS[3], 172800)
redis.call('HSET', KEYS[4], 'owner', ARGV[1], 'day', day, 'next', 1, 'first', ARGV[4], 'second', ARGV[5])
redis.call('EXPIRE', KEYS[4], 172800)
return {1, 0}
`;
export const ASK_START_SCRIPT = `
local now = tonumber(redis.call('TIME')[1])
local day = math.floor(now / 86400)
if redis.call('GET', KEYS[1]) ~= ARGV[1] or tonumber(redis.call('ZSCORE', KEYS[2], ARGV[1]) or '0') <= now then return 0 end
if redis.call('HGET', KEYS[4], 'owner') ~= ARGV[1] or tonumber(redis.call('HGET', KEYS[4], 'day') or '-1') ~= day or tonumber(redis.call('HGET', KEYS[3], 'day') or '-1') ~= day then return 0 end
local next = tonumber(redis.call('HGET', KEYS[4], 'next') or '3')
if next > 2 then return 0 end
local field = 'first'
if next == 2 then field = 'second' end
local tokens = tonumber(redis.call('HGET', KEYS[4], field))
redis.call('HINCRBY', KEYS[3], 'reserved', -1)
redis.call('HINCRBY', KEYS[3], 'used', 1)
redis.call('HINCRBY', KEYS[3], 'tokensReserved', -tokens)
redis.call('HINCRBY', KEYS[3], 'tokensUsed', tokens)
redis.call('HINCRBY', KEYS[4], 'next', 1)
return 1
`;
export const ASK_FINISH_SCRIPT = `
local now = tonumber(redis.call('TIME')[1])
local owned = redis.call('GET', KEYS[1]) == ARGV[1] and tonumber(redis.call('ZSCORE', KEYS[2], ARGV[1]) or '0') > now
if redis.call('HGET', KEYS[4], 'owner') == ARGV[1] then
  if redis.call('HGET', KEYS[4], 'day') == redis.call('HGET', KEYS[3], 'day') then
    local next = tonumber(redis.call('HGET', KEYS[4], 'next'))
    local pending = math.max(0, 3 - next)
    local tokens = 0
    if next == 1 then tokens = tokens + tonumber(redis.call('HGET', KEYS[4], 'first')) end
    if next <= 2 then tokens = tokens + tonumber(redis.call('HGET', KEYS[4], 'second')) end
    redis.call('HINCRBY', KEYS[3], 'reserved', -pending)
    redis.call('HINCRBY', KEYS[3], 'tokensReserved', -tokens)
  end
  redis.call('DEL', KEYS[4])
end
if owned and ARGV[2] ~= '' then redis.call('SET', KEYS[5], ARGV[2], 'EX', ARGV[3]) end
if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]) end
redis.call('ZREM', KEYS[2], ARGV[1])
if owned then return 1 end
return 0
`;

export type AskStore = {
  admit(user: string, ip: string, owner: string): Promise<void>;
  getCached(key: string): Promise<unknown>;
  reserve(user: string, owner: string, config: AskConfig): Promise<void>;
  start(user: string, owner: string): Promise<void>;
  finish(user: string, owner: string, cacheKey?: string, value?: unknown, seconds?: number): Promise<void>;
};
export const askHash = (value: string) => createHash("sha256").update(value).digest("hex");

export function createAskStore(env: Record<string, string | undefined> = process.env,
  signal: AbortSignal = AbortSignal.timeout(30000)): AskStore {
  if (!env.UPSTASH_REDIS_REST_URL?.trim() || !env.UPSTASH_REDIS_REST_TOKEN?.trim()) throw new AskBackendError("redis-unavailable", 503, 10);
  let prefix: string;
  try { prefix = getRedisKeyspace(env).askPrefix; } catch { throw new AskBackendError("invalid-configuration"); }
  let redis: Redis;
  try { redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL.trim(), token: env.UPSTASH_REDIS_REST_TOKEN.trim(),
    retry: false, signal: () => AbortSignal.any([signal, AbortSignal.timeout(3000)]) }); }
  catch { throw new AskBackendError("redis-unavailable", 503, 10); }
  const keys = (user: string, owner: string) => [prefix + "lease:" + askHash(user), prefix + "active",
    prefix + "model-day", prefix + "reservation:" + askHash(owner)];
  const safe = async <T>(operation: () => Promise<T>): Promise<T> => {
    try { return await withinAskDeadline(operation, signal); }
    catch (error) { if (error instanceof AskBackendError) throw error; throw new AskBackendError("redis-unavailable", 503, 10); }
  };
  const result = (value: unknown): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2 || value.some(item => !Number.isSafeInteger(item))) throw new AskBackendError("redis-unavailable");
    return value as [number, number];
  };
  return {
    async admit(user, ip, owner) {
      const id = askHash(user);
      const [status, retry] = result(await safe(() => redis.eval(ASK_ADMIT_SCRIPT,
        [keys(user, owner)[0], prefix + "minute:" + id, prefix + "ip:" + askHash(ip),
          prefix + "user-day:" + id, prefix + "active"], [owner, ASK_LEASE_SECONDS])));
      if (status !== 1) throw new AskBackendError(status === 0 ? "busy" : "request-limit", status === 0 ? 409 : 429, Math.max(1, retry));
    },
    getCached: key => safe(() => redis.get(prefix + "cache:" + askHash(key))),
    async reserve(user, owner, config) {
      const [status, retry] = result(await safe(() => redis.eval(ASK_RESERVE_SCRIPT, [...keys(user, owner), prefix + "generation-day"],
        [owner, config.dailyAttempts, config.dailyTokens, ASK_INPUT_RESERVATION + config.selectionTokens,
          ASK_INPUT_RESERVATION + config.answerTokens, ASK_DAILY_GENERATIONS])));
      if (status !== 1) throw new AskBackendError(status === -1 ? "lease-expired" : "generation-budget", status === -1 ? 409 : 429, Math.max(1, retry));
    },
    async start(user, owner) {
      if (await safe(() => redis.eval(ASK_START_SCRIPT, keys(user, owner), [owner])) !== 1) throw new AskBackendError("lease-expired", 409, 3);
    },
    async finish(user, owner, key = owner, value, seconds = 300) {
      const data = value === undefined ? "" : JSON.stringify(value);
      if (new TextEncoder().encode(data).length > ASK_CACHE_BYTES) throw new AskBackendError("invalid-configuration");
      const status = await safe(() => redis.eval(ASK_FINISH_SCRIPT,
        [...keys(user, owner), prefix + "cache:" + askHash(key)], [owner, data, seconds]));
      if (status !== 0 && status !== 1) throw new AskBackendError("redis-unavailable");
      if (value !== undefined && status !== 1) throw new AskBackendError("lease-expired", 409, 3);
    },
  };
}

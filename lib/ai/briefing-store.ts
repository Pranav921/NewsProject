import "server-only";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { getRedisKeyspace } from "../redis-keyspace.ts";
import { BriefingError } from "./settings.ts";
import type { BriefingConfig } from "./settings.ts";
import type { BriefingStore, StoredBriefing } from "./service.ts";
import type { NewsItem } from "../types.ts";

// Hash tags keep all Lua keys in one Redis cluster slot. Quotas and the lease
// deliberately span model/prompt changes, so configuration cannot reset budgets.
export const RESERVE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return {-1, 3} end
local cooldown = redis.call('TTL', KEYS[2])
if cooldown > 0 then return {0, cooldown} end
local time = redis.call('TIME')
local day = math.floor(tonumber(time[1]) / 86400)
local storedDay = tonumber(redis.call('HGET', KEYS[3], 'day') or '-1')
local count = tonumber(redis.call('HGET', KEYS[3], 'count') or '0')
if storedDay ~= day then count = 0 end
if count >= tonumber(ARGV[2]) then return {0, 86400 - (tonumber(time[1]) % 86400)} end
redis.call('HSET', KEYS[3], 'day', day, 'count', count + 1)
redis.call('EXPIRE', KEYS[3], 172800)
return {1, 0}
`;
export const COMPLETE_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('SET', KEYS[3], 'success', 'EX', ARGV[3])
return 1
`;
export const FAIL_SCRIPT = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[2], 'retry', 'EX', ARGV[2])
return 1
`;
export const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
export const USER_LIMIT_SCRIPT = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], 60) end
return {count, redis.call('TTL', KEYS[1])}
`;

export function createBriefingStore(env: Record<string, string | undefined> = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL?.trim();
  const token = env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) throw new BriefingError("redis-unavailable");
  let PREFIX: string;
  try { PREFIX = getRedisKeyspace(env).briefingPrefix; }
  catch { throw new BriefingError("invalid-configuration"); }
  const redis = new Redis({ url, token, retry: false, signal: () => AbortSignal.timeout(5000) });
  const lock = PREFIX + "lock";
  const cooldown = PREFIX + "cooldown";
  const store: BriefingStore & {
    enforceUserLimit(userId: string, limit: number): Promise<void>;
    fetchArticles(load: () => Promise<NewsItem[]>): Promise<NewsItem[]>;
  } = {
    getCached: (scope) => redis.get(PREFIX + "cache:" + scope),
    async acquire(owner) {
      const seconds = await redis.ttl(cooldown);
      if (seconds > 0) throw new BriefingError("generation-cooldown", 503, seconds);
      return await redis.set(lock, owner, { nx: true, ex: 90 }) === "OK";
    },
    async reserve(owner, config: BriefingConfig) {
      const result = await redis.eval<[string, number], [number, number]>(RESERVE_SCRIPT, [lock, cooldown, PREFIX + "daily-attempts"], [owner, config.dailyAttempts]);
      if (result[0] !== 1) throw new BriefingError(result[0] === -1 ? "lease-expired" : "generation-budget", 503, Math.max(1, result[1]));
    },
    async complete(owner, scope, value: StoredBriefing, seconds) {
      const result = await redis.eval<[string, string, number], number>(COMPLETE_SCRIPT, [lock, PREFIX + "cache:" + scope, cooldown], [owner, JSON.stringify(value), seconds]);
      if (result !== 1) throw new BriefingError("lease-expired", 503, 3);
    },
    async fail(owner, retrySeconds) {
      await redis.eval(FAIL_SCRIPT, [lock, cooldown], [owner, retrySeconds]);
    },
    async release(owner) {
      await redis.eval(RELEASE_SCRIPT, [lock], [owner]);
    },
    async enforceUserLimit(userId, limit) {
      const id = createHash("sha256").update(userId).digest("hex");
      const [count, ttl] = await redis.eval<[], [number, number]>(USER_LIMIT_SCRIPT, [PREFIX + "user:" + id], []);
      if (count > limit) throw new BriefingError("user-rate-limit", 429, Math.max(1, ttl));
    },
    async fetchArticles(load) {
      const key = PREFIX + "rss-snapshot";
      const cached = await redis.get<NewsItem[]>(key);
      if (Array.isArray(cached)) return cached;
      const articles = await load();
      // Do not cache an empty outage for the full snapshot interval.
      if (articles.length) await redis.set(key, articles, { ex: 90 });
      return articles;
    },
  };
  return store;
}

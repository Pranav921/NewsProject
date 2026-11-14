import assert from "node:assert/strict";
import test from "node:test";
import { Ratelimit } from "@upstash/ratelimit";
import { loadAiModule } from "./helpers/load-ai-module.mjs";
import * as settings from "../lib/ai/settings.ts";

const keyspace = loadAiModule("../../lib/redis-keyspace.ts");
const { getRedisKeyspace } = keyspace;
const environments = [{ REDIS_KEYSPACE: "dev" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }];
const credentials = { UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "fake" };

test("explicit server environments separate all prefixes and retain exact production legacy names", () => {
  const spaces = environments.map(getRedisKeyspace);
  assert.equal(new Set(spaces.map(s => s.rateLimitPrefix)).size, 3);
  assert.equal(new Set(spaces.map(s => s.briefingPrefix)).size, 3);
  assert.equal(spaces[0].rateLimitPrefix, "kicker:dev:ratelimit");
  assert.equal(spaces[1].rateLimitPrefix, "kicker:preview:ratelimit");
  assert.equal(spaces[2].rateLimitPrefix, "@upstash/ratelimit");
  assert.equal(spaces[2].briefingPrefix, "kicker:{ai-briefing}:v1:");
  assert.equal(getRedisKeyspace({ NODE_ENV: "production", REDIS_KEYSPACE: "dev" }).environment, "dev", "local next start is not a production deployment");
  assert.equal(getRedisKeyspace({ VERCEL_ENV: "development" }).environment, "dev");
  assert.equal(getRedisKeyspace({ VERCEL_ENV: "production", REDIS_KEYSPACE: "prod-legacy" }).environment, "prod");
});

test("missing, arbitrary, client-style and conflicting environments fail without selecting legacy keys", () => {
  for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "development" },
    { NEXT_PUBLIC_REDIS_KEYSPACE: "dev" }, { REDIS_KEYSPACE: "prod-legacy" },
    { REDIS_KEYSPACE: "dev:" }, { REDIS_KEYSPACE: "preview" },
    { VERCEL: "1", REDIS_KEYSPACE: "dev" }, { VERCEL_ENV: "unknown" },
    { VERCEL_ENV: "preview", REDIS_KEYSPACE: "dev" },
    { VERCEL_ENV: "production", REDIS_KEYSPACE: "dev" },
    { VERCEL_ENV: "development", REDIS_KEYSPACE: "prod-legacy" }]) {
    assert.throws(() => getRedisKeyspace(env), /redis-keyspace-/);
  }
});

test("actual Upstash sliding-window SDK constructs disjoint Redis keys for the same identifier", async () => {
  const groups = [];
  for (const env of environments) {
    const keysSeen = [];
    const redis = { evalsha: async (_sha, keys) => { keysSeen.push(...keys.filter(Boolean)); return [4, 5]; } };
    const limiter = new Ratelimit({ redis, prefix: getRedisKeyspace(env).rateLimitPrefix,
      limiter: Ratelimit.slidingWindow(5, "1 m"), timeout: 0, ephemeralCache: false });
    const result = await limiter.limit("auth-login:192.0.2.1");
    assert.equal(result.success, true);
    await result.pending;
    assert.ok(keysSeen.length >= 2);
    assert.ok(keysSeen.every(key => key.startsWith(getRedisKeyspace(env).rateLimitPrefix + ":")));
    groups.push(new Set(keysSeen));
  }
  for (let left = 0; left < groups.length; left++) for (let right = left + 1; right < groups.length; right++) {
    for (const key of groups[left]) assert.equal(groups[right].has(key), false);
  }
});

test("application rate limiter wires the server namespace and rejects ambiguity before constructing Redis", async () => {
  for (const env of [...environments, {}]) {
    let prefix; let redisCalls = 0;
    class Redis { constructor() { redisCalls++; } }
    class MockLimit {
      constructor(options) { prefix = options.prefix; }
      static slidingWindow() { return {}; }
      async limit() { return { success: true }; }
    }
    const { enforceRateLimit } = loadAiModule("../../lib/ratelimit.ts", {
      "@upstash/redis": { Redis }, "@upstash/ratelimit": { Ratelimit: MockLimit },
      "./redis-keyspace": keyspace, "next/server": { NextResponse: Response },
    }, { process: { env: { NODE_ENV: "production", ...credentials, ...env } }, console: { info() {}, error() {}, warn() {} } });
    // Browser-controlled headers cannot select a namespace.
    const result = await enforceRateLimit(new Request("https://example.test/api/auth/login", { headers: { "x-redis-keyspace": "prod-legacy" } }), "auth-login");
    if (Object.keys(env).length) {
      assert.equal(result, null); assert.equal(prefix, getRedisKeyspace(env).rateLimitPrefix);
      assert.equal(redisCalls, 1);
    } else { assert.equal(result.status, 503); assert.equal(redisCalls, 0); }
  }
});

test("all AI commands and Lua KEYS stay in their environment with one shared cluster hash tag per script", async () => {
  const groups = [];
  for (const env of environments) {
    const calls = [];
    class Redis {
      async get(key) { calls.push([key]); return null; }
      async ttl(key) { calls.push([key]); return -2; }
      async set(key) { calls.push([key]); return "OK"; }
      async eval(script, keys) {
        calls.push(keys);
        if (script === storeModule.RESERVE_SCRIPT) return [1, 0];
        if (script === storeModule.USER_LIMIT_SCRIPT) return [1, 60];
        return 1;
      }
    }
    const storeModule = loadAiModule("../../lib/ai/briefing-store.ts", {
      "@upstash/redis": { Redis }, "../redis-keyspace.ts": keyspace, "./settings.ts": settings,
    });
    const store = storeModule.createBriefingStore({ ...credentials, ...env });
    await store.getCached("fixture"); await store.acquire("worker");
    await store.reserve("worker", { dailyAttempts: 48 });
    await store.complete("worker", "fixture", {}, 900);
    await store.fail("worker", 30); await store.release("worker");
    await store.enforceUserLimit("fixture-user", 5);
    await store.fetchArticles(async () => [{ link: "https://example.test/story" }]);
    const prefix = getRedisKeyspace(env).briefingPrefix;
    assert.ok(calls.length >= 10);
    for (const keys of calls) {
      assert.ok(keys.every(key => key.startsWith(prefix)));
      assert.equal(new Set(keys.map(key => key.match(/\{([^}]+)\}/)[1])).size, 1);
    }
    groups.push(new Set(calls.flat()));
  }
  for (let left = 0; left < groups.length; left++) for (let right = left + 1; right < groups.length; right++) {
    for (const key of groups[left]) assert.equal(groups[right].has(key), false);
  }
});

test("AI store rejects ambiguous configuration before constructing Redis", () => {
  let constructors = 0;
  const storeModule = loadAiModule("../../lib/ai/briefing-store.ts", {
    "@upstash/redis": { Redis: class { constructor() { constructors++; } } },
    "../redis-keyspace.ts": keyspace, "./settings.ts": settings,
  });
  assert.throws(() => storeModule.createBriefingStore(credentials), /invalid-configuration/);
  assert.equal(constructors, 0);
});

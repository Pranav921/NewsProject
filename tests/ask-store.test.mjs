import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModule } from "./helpers/load-ai-module.mjs";
import * as settings from "../lib/ai/ask-settings.ts";

const keyspace = loadAiModule("../../lib/redis-keyspace.ts");
const MODEL = { AI_BRIEFING_MODEL: "claude-haiku-5-5" };
const credentials = { UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "fixture" };
function fixture(env = { REDIS_KEYSPACE: "dev" }) {
  const calls = []; let answer; let failure = false; let constructors = 0;
  class Redis {
    constructor(options) { constructors++; assert.equal(options.retry, false); assert.equal(options.signal().aborted, false); }
    async get(key) { calls.push({ type: "get", keys: [key] }); if (failure) throw new Error("PRIVATE Redis credential"); return null; }
    async eval(script, keys, args) {
      calls.push({ type: "eval", script, keys, args });
      if (failure) throw new Error("PRIVATE Redis credential");
      return answer ?? (script === loaded.ASK_ADMIT_SCRIPT || script === loaded.ASK_RESERVE_SCRIPT ? [1, 0] : 1);
    }
  }
  const loaded = loadAiModule("../../lib/ai/ask-store.ts", { "@upstash/redis": { Redis },
    "../redis-keyspace.ts": keyspace, "./ask-settings.ts": settings });
  return { module: loaded, calls, create: (overrides = {}) => loaded.createAskStore({ ...credentials, ...env, ...overrides }),
    set: value => { answer = value; }, fail: () => { failure = true; }, constructors: () => constructors };
}

test("Ask Redis keys are separate across dev/preview/prod, hash private identifiers, and preserve legacy prefixes", async () => {
  const groups = [];
  for (const env of [{ REDIS_KEYSPACE: "dev" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }]) {
    const f = fixture(env); const store = f.create(); const prefix = keyspace.getRedisKeyspace(env).askPrefix;
    await store.admit("PRIVATE-user", "192.0.2.1", "owner-a"); await store.getCached("PRIVATE-question");
    await store.reserve("PRIVATE-user", "owner-a", settings.readAskConfig(MODEL)); await store.start("PRIVATE-user", "owner-a");
    await store.finish("PRIVATE-user", "owner-a", "PRIVATE-question", { output: "fixture" }, 300);
    for (const call of f.calls) {
      assert.ok(call.keys.every(key => key.startsWith(prefix)));
      assert.equal(new Set(call.keys.map(key => key.match(/\{([^}]+)\}/)[1])).size, 1);
      assert.doesNotMatch(call.keys.join(" "), /PRIVATE|192\.0\.2\.1|@upstash\/ratelimit|\{ai-briefing\}/);
    }
    assert.equal(f.calls[0].args[1], 45);
    assert.equal(f.calls[2].args[1], 40); assert.equal(f.calls[2].args[2], 2700000); assert.equal(f.calls[2].args[5], 20);
    assert.equal(f.calls[0].keys.length, 5); assert.ok(f.calls[2].keys.at(-1).endsWith("generation-day"));
    assert.equal(f.calls[2].args[3] + f.calls[2].args[4], 132656);
    groups.push(new Set(f.calls.flatMap(call => call.keys)));
  }
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) for (const key of groups[i]) assert.equal(groups[j].has(key), false);
  assert.equal(keyspace.getRedisKeyspace({ VERCEL_ENV: "production" }).briefingPrefix, "kicker:{ai-briefing}:v1:");
});

test("Ask Redis rejects missing credentials and ambiguous namespace before constructing a client", () => {
  const f = fixture(); assert.throws(() => f.module.createAskStore({}), { code: "redis-unavailable" });
  assert.throws(() => f.create({ REDIS_KEYSPACE: undefined }), { code: "invalid-configuration" });
  assert.throws(() => f.create({ VERCEL_ENV: "production" }), { code: "invalid-configuration" });
  assert.equal(f.constructors(), 0);
});

test("Ask Redis translates busy/quota/lease results and strips raw errors", async () => {
  const f = fixture(); const store = f.create();
  f.set([0, 8]); await assert.rejects(store.admit("u", "ip", "o"), error => error.code === "busy" && error.retryAfter === 8);
  f.set([2, 60]); await assert.rejects(store.admit("u", "ip", "o"), { code: "request-limit" });
  f.set([0, 100]); await assert.rejects(store.reserve("u", "o", settings.readAskConfig(MODEL)), { code: "generation-budget" });
  f.set([-1, 3]); await assert.rejects(store.reserve("u", "o", settings.readAskConfig(MODEL)), { code: "lease-expired" });
  f.set(0); await assert.rejects(store.start("u", "o"), { code: "lease-expired" });
  await assert.rejects(store.finish("u", "o", "key", { output: "value" }), { code: "lease-expired" });
  await store.finish("u", "o"); // stale owner's cleanup may not remove a replacement
  f.set("bad shape"); await assert.rejects(store.admit("u", "ip", "o"), { code: "redis-unavailable" });
  f.fail(); await assert.rejects(store.getCached("key"), error => error.code === "redis-unavailable" && error.message === "redis-unavailable" && error.cause === undefined);
});

test("Ask Lua scripts encode atomic admission, server-time budgets, ownership and no refunds of started calls", () => {
  const { module: scripts } = fixture();
  for (const script of [scripts.ASK_ADMIT_SCRIPT, scripts.ASK_RESERVE_SCRIPT, scripts.ASK_START_SCRIPT, scripts.ASK_FINISH_SCRIPT]) assert.match(script, /redis.call\('TIME'\)/);
  assert.match(scripts.ASK_ADMIT_SCRIPT, /ZCARD', KEYS\[5\]\) >= 2/);
  assert.match(scripts.ASK_ADMIT_SCRIPT, /local limit = 3/); assert.match(scripts.ASK_ADMIT_SCRIPT, /limit = 5/);
  assert.match(scripts.ASK_ADMIT_SCRIPT, /count >= 10/);
  assert.doesNotMatch(scripts.ASK_ADMIT_SCRIPT, /\b20\b|generation|ARGV\[3\]/,"cache hits pass admission without touching global generation capacity");
  assert.match(scripts.ASK_RESERVE_SCRIPT, /generations >= tonumber\(ARGV\[6\]\) or attempts \+ 2/, "generation cap is checked atomically with budgets");
  assert.match(scripts.ASK_RESERVE_SCRIPT, /attempts \+ 2/); assert.match(scripts.ASK_RESERVE_SCRIPT, /tokens \+ total/);
  assert.match(scripts.ASK_START_SCRIPT, /next > 2/); assert.match(scripts.ASK_START_SCRIPT, /'used', 1/);
  assert.match(scripts.ASK_START_SCRIPT, /'day'\).*~= day/);
  assert.match(scripts.ASK_FINISH_SCRIPT, /3 - next/); assert.doesNotMatch(scripts.ASK_FINISH_SCRIPT, /'used', -/);
  assert.match(scripts.ASK_FINISH_SCRIPT, /if owned and ARGV\[2\] ~= ''/);
  assert.match(scripts.ASK_FINISH_SCRIPT, /GET', KEYS\[1\]\) == ARGV\[1\] then redis.call\('DEL'/);
  for (const script of [scripts.ASK_ADMIT_SCRIPT, scripts.ASK_RESERVE_SCRIPT, scripts.ASK_START_SCRIPT, scripts.ASK_FINISH_SCRIPT]) assert.doesNotMatch(script, /FLUSH|SCAN|RENAME|KEYS\s+\*/i);
});

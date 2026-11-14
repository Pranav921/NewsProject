import assert from "node:assert/strict";
import test from "node:test";
import * as settings from "../lib/ai/settings.ts";
import { loadAiModule } from "./helpers/load-ai-module.mjs";

const keyspace = loadAiModule("../../lib/redis-keyspace.ts");

function fixture() {
  const calls = []; let evalResult = 1;
  class Redis {
    constructor(config) { assert.equal(config.retry, false); assert.equal(typeof config.signal, "function"); }
    async get() { return null; }
    async ttl() { return -2; }
    async set(...args) { calls.push({ command: "set", args }); return "OK"; }
    async eval(script, keys, args) { calls.push({ command: "eval", script, keys, args }); return evalResult; }
  }
  const loaded = loadAiModule("../../lib/ai/briefing-store.ts", { "@upstash/redis": { Redis }, "./settings.ts": settings, "../redis-keyspace.ts": keyspace });
  return { module: loaded, calls, result: (value) => { evalResult = value; }, store: loaded.createBriefingStore({ UPSTASH_REDIS_REST_URL: "https://redis.example", UPSTASH_REDIS_REST_TOKEN: "fixture", REDIS_KEYSPACE: "dev" }) };
}

test("Redis adapter requires configuration and acquires an expiring global NX lease", async () => {
  const { module, store, calls } = fixture();
  assert.throws(() => module.createBriefingStore({}), /redis-unavailable/);
  assert.equal(await store.acquire("worker"), true);
  const call = calls[0];
  assert.equal(call.args[1], "worker"); assert.equal(call.args[2].nx, true); assert.equal(call.args[2].ex, 90);
});

test("Redis adapter uses ownership-checked scripts for publish/failure/release and fails on lost lease", async () => {
  const { module, store, calls, result } = fixture();
  await store.complete("worker", "scope", { output: {} }, 900);
  assert.equal(calls[0].script, module.COMPLETE_SCRIPT);
  assert.equal(calls[0].args[0], "worker"); assert.equal(calls[0].args[2], 900);
  result(0); await assert.rejects(store.complete("worker", "scope", {}, 900), /lease-expired/);
  await store.fail("worker", 30); await store.release("worker");
  assert.equal(calls.at(-2).script, module.FAIL_SCRIPT); assert.equal(calls.at(-1).script, module.RELEASE_SCRIPT);
  for (const script of [module.COMPLETE_SCRIPT, module.FAIL_SCRIPT, module.RELEASE_SCRIPT]) {
    assert.match(script, /redis.call\('GET', KEYS\[1\]\)/);
    assert.match(script, /ARGV\[1\]/);
  }
});

test("Redis budgets reserve before invocation, preserve retry timing and hash user identifiers", async () => {
  const { module, store, calls, result } = fixture();
  const config = settings.readBriefingConfig({ AI_BRIEFING_MODEL: "fixture" });
  result([1, 0]); await store.reserve("worker", config);
  assert.equal(calls[0].script, module.RESERVE_SCRIPT); assert.equal(calls[0].args[1], 48);
  // The entire UTC-day rollover/count increment lives inside one Redis eval.
  assert.match(module.RESERVE_SCRIPT, /redis.call\('TIME'\)/);
  assert.match(module.RESERVE_SCRIPT, /storedDay ~= day/);
  assert.match(module.RESERVE_SCRIPT, /count \+ 1/);
  result([0, 25]); await assert.rejects(store.reserve("worker", config), (error) => error.retryAfter === 25);
  result([6, 15]); await assert.rejects(store.enforceUserLimit("private-user-id", 5), (error) => error.status === 429 && error.retryAfter === 15);
  assert.ok(!calls.at(-1).keys[0].includes("private-user-id"));
});

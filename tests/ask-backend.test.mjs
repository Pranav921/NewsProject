import assert from "node:assert/strict";
import test from "node:test";
import { backend, backendWithRetrieval, snapshot, config, memoryStore, providerFixture, backendInput } from "./helpers/ask-backend-fixture.mjs";
import * as retrieval from "../lib/ai/ask-retrieval.ts";
import { AskBackendError, readAskConfig } from "../lib/ai/ask-settings.ts";

test("private cache hits use zero model calls and no generation reservation; changed users/questions/metadata/config miss", async () => {
  const memory = memoryStore(); const fake = providerFixture();
  const first = await backend.getAskAnswer(backendInput(memory, fake.provider));
  assert.equal(first.cacheHit, false); assert.equal(fake.calls(), 2); assert.equal(memory.stats.attempts, 2);
  const cached = await backend.getAskAnswer(backendInput(memory, () => assert.fail("cache hit must not call model")));
  assert.equal(cached.cacheHit, true); assert.equal(cached.modelRequests, 0); assert.equal(cached.usage, null);
  assert.equal(cached.generatedAt, first.generatedAt); assert.equal(memory.stats.reserves, 1);
  assert.equal(memory.stats.requests, 2, "cached requests still count against abuse quotas");
  const key = backend.askCacheIdentity("user-1", "Nvidia news?", snapshot, config);
  assert.equal(key, backend.askCacheIdentity("user-1", "  Nvidia   news?  ", { ...snapshot, asOf: new Date(memory.now() + 1000).toISOString() }, config));
  for (const different of [backend.askCacheIdentity("other-user", "Nvidia news?", snapshot, config),
    backend.askCacheIdentity("user-1", "Other question", snapshot, config),
    backend.askCacheIdentity("user-1", "Nvidia news?", { ...snapshot, articles: snapshot.articles.slice(1) }, config),
    backend.askCacheIdentity("user-1", "Nvidia news?", snapshot, { ...config, model: "other-model" })]) assert.notEqual(different, key);
  assert.doesNotMatch(key, /user-1|Nvidia/);
  assert.equal(memory.active.size, 0); assert.equal(memory.stats.pending, 0);
});

test("all four validated statuses are cacheable; no-results retrieval uses one charged attempt", async () => {
  for (const status of ["answered", "no_results", "needs_clarification", "unsupported"]) {
    const memory = memoryStore(); const fake = providerFixture({ status });
    const result = await backend.getAskAnswer(backendInput(memory, fake.provider));
    assert.equal(result.answer.status, status); assert.equal(memory.cache.size, 1);
    assert.equal(memory.stats.attempts, 2); assert.equal(memory.stats.pending, 0); assert.equal(memory.stats.reservedTokens, 0);
  }
  const memory = memoryStore(); const fake = providerFixture({ args: { query: "volcanic eruption" } });
  const result = await backend.getAskAnswer(backendInput(memory, fake.provider));
  assert.equal(result.answer.status, "no_results"); assert.equal(fake.calls(), 1);
  assert.equal(memory.stats.attempts, 1); assert.equal(memory.stats.pending, 0); assert.equal(memory.cache.size, 1);
});

test("failed model attempts stay charged; only never-started calls are released and failures are not cached", async () => {
  for (const failAt of [1, 2]) {
    const memory = memoryStore(); const fake = providerFixture({ failAt });
    await assert.rejects(backend.getAskAnswer(backendInput(memory, fake.provider)), { code: "provider-error" });
    assert.equal(memory.stats.attempts, failAt); assert.equal(memory.stats.pending, 0);
    assert.equal(memory.stats.reservedTokens, 0); assert.ok(memory.stats.tokens > 0);
    assert.equal(memory.cache.size, 0); assert.equal(memory.active.size, 0);
  }
});

test("invalid citations cannot enter the private cache", async () => {
  const memory = memoryStore(); const fake = providerFixture({ invalidId: `article_${"f".repeat(64)}` });
  await assert.rejects(backend.getAskAnswer(backendInput(memory, fake.provider)), { code: "invalid-citation" });
  assert.equal(memory.stats.attempts, 2); assert.equal(memory.cache.size, 0); assert.equal(memory.stats.pending, 0);
});

test("cache revalidation rejects expiration, altered evidence, output/citation fields and oversized values", async () => {
  const memory = memoryStore();
  await backend.getAskAnswer(backendInput(memory, providerFixture().provider));
  const record = structuredClone([...memory.cache.values()][0]);
  assert.ok(backend.readAskCache(record, snapshot, config, memory.now()));
  for (const patch of [{ expiresAt: new Date(memory.now()).toISOString() }, { version: "old" }, { output: {} },
    { evidence: { ...record.evidence, articles: [{ ...record.evidence.articles[0], link: "https://evil.test" }] } },
    { evidence: { ...record.evidence, coverage: { ...record.evidence.coverage, asOf: "bad date" } } },
    { snapshotTime: "bad date" }, { extra: "not allowed" },
    { output: { ...record.output, statements: [{ text: "Report.", articleIds: [`article_${"f".repeat(64)}`] }] } },
    { output: { ...record.output, statements: [{ ...record.output.statements[0], url: "https://evil.test" }] } }]) {
    assert.equal(backend.readAskCache({ ...record, ...patch }, snapshot, config, memory.now()), null);
  }
  assert.equal(backend.readAskCache({ ...record, extra: "x".repeat(17000) }, snapshot, config, memory.now()), null);
  memory.advance(301000);
  assert.equal(backend.readAskCache(record, snapshot, config, memory.now()), null);
});

test("abuse limits include cache hits: user 3/min, 10/day; IP 5/min; admission has no global daily cap", async () => {
  const memory = memoryStore();
  for (let i = 0; i < 3; i++) { await memory.store.admit("u", "ip", `a${i}`); await memory.store.finish("u", `a${i}`); }
  await assert.rejects(memory.store.admit("u", "ip", "blocked"), { code: "request-limit" });
  for (let i = 3; i < 10; i++) { memory.advance(61000); await memory.store.admit("u", "ip", `a${i}`); await memory.store.finish("u", `a${i}`); }
  memory.advance(61000); await assert.rejects(memory.store.admit("u", "ip", "daily"), { code: "request-limit" });
  for (let i = 0; i < 25; i++) { memory.advance(61000); await memory.store.admit(`other-${i}`, `ip-${i}`, `b${i}`); await memory.store.finish(`other-${i}`, `b${i}`); }
  await memory.store.admit("last", "last", "last"); // 36th admission: only generations are globally capped
  assert.equal(memory.stats.generations, 0, "admission alone never consumes generation capacity");
  const sameIP = memoryStore();
  for (let i = 0; i < 5; i++) { await sameIP.store.admit(`u${i}`, "ip", `a${i}`); await sameIP.store.finish(`u${i}`, `a${i}`); }
  await assert.rejects(sameIP.store.admit("six", "ip", "six"), { code: "request-limit" });
});

test("concurrent admission permits one request/user and two globally, with expiring owned leases", async () => {
  const memory = memoryStore();
  const results = await Promise.allSettled([memory.store.admit("a", "1", "owner-a"), memory.store.admit("a", "1", "other-a"),
    memory.store.admit("b", "2", "owner-b"), memory.store.admit("c", "3", "owner-c")]);
  assert.deepEqual(results.map(result => result.status), ["fulfilled", "rejected", "fulfilled", "rejected"]);
  await memory.store.finish("a", "wrong-owner"); assert.equal(memory.active.size, 2);
  memory.advance(46000); await memory.store.admit("a", "1", "replacement");
  await memory.store.finish("a", "owner-a"); assert.ok(memory.active.has("replacement"));
  await assert.rejects(memory.store.start("a", "owner-a"), { code: "lease-expired" });
});

test("parallel reservations cannot overspend attempts or aggregate tokens; start is limited to two", async () => {
  for (const limits of [{ ...config, dailyAttempts: 2 }, { ...config, dailyTokens: 132656 }]) {
    const memory = memoryStore(); await memory.store.admit("a", "1", "a"); await memory.store.admit("b", "2", "b");
    const reservations = await Promise.allSettled([memory.store.reserve("a", "a", limits), memory.store.reserve("b", "b", limits)]);
    assert.deepEqual(reservations.map(result => result.status), ["fulfilled", "rejected"]);
    await memory.store.start("a", "a"); await memory.store.start("a", "a");
    await assert.rejects(memory.store.start("a", "a"), { code: "lease-expired" });
    await memory.store.finish("a", "a"); assert.equal(memory.stats.attempts, 2); assert.equal(memory.stats.pending, 0);
  }
});

test("whole-request work deadline includes hung RSS loading; no model starts and leases are released", async () => {
  const memory = memoryStore(); const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15);
  try {
    await assert.rejects(backend.getAskAnswer(backendInput(memory, () => assert.fail("no model"), {
      workSignal: controller.signal, load: () => new Promise(() => {}),
    })), { code: "deadline" });
  } finally { clearTimeout(timer); }
  assert.equal(memory.stats.attempts, 0); assert.equal(memory.active.size, 0);
});

test("storage errors fail closed before any paid call; valid cache is not used to bypass failed admission", async () => {
  for (const method of ["admit", "getCached", "reserve", "start"]) {
    const memory = memoryStore(); memory.store[method] = async () => { throw new AskBackendError("redis-unavailable"); };
    await assert.rejects(backend.getAskAnswer(backendInput(memory, () => assert.fail("no model"))), error => ["redis-unavailable", "provider-error"].includes(error.code));
    assert.equal(memory.cache.size, 0);
  }
});

test("configuration rejects increased hard caps or malformed limits and contains no environment-enabled defaults", () => {
  assert.equal(config.dailyAttempts, 40); assert.equal(config.dailyTokens, 2700000); assert.equal(config.cacheSeconds, 300);
  const base = { AI_BRIEFING_MODEL: "claude-haiku-5-5" };
  for (const env of [{ AI_ASK_DAILY_MODEL_ATTEMPTS: "41" }, { AI_ASK_DAILY_RESERVED_TOKENS: "3000001" },
    { AI_ASK_CACHE_SECONDS: "-1" }, { AI_ASK_ANSWER_TOKENS: "12.5" }]) assert.throws(() => readAskConfig({ ...base, ...env }), { code: "invalid-configuration" });
  // The model is the briefing's, never a separate Ask setting, and must support Ask's forced tool call.
  assert.equal(readAskConfig({ ...base, AI_ASK_MODEL: "claude-opus-5-5" }).model, "claude-haiku-5-5");
  for (const env of [{}, { AI_BRIEFING_MODEL: "https://invalid" }, { AI_BRIEFING_MODEL: "claude-sonnet-5-5" }, { ...base, AI_BRIEFING_PROVIDER: "openai" }]) {
    assert.throws(() => readAskConfig(env), { code: "unsupported-model" });
  }
});

test("concurrent backend requests hold leases during snapshot loading and cannot start excess model workflows", async () => {
  const memory = memoryStore(); let release;
  const wait = new Promise(resolve => { release = resolve; });
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const first = backend.getAskAnswer(backendInput(memory, providerFixture().provider, { load: async () => { entered(); await wait; return { snapshot }; } }));
  await began;
  await assert.rejects(backend.getAskAnswer(backendInput(memory, () => assert.fail("same user model"))), { code: "busy" });
  let enteredSecond;
  const beganSecond = new Promise(resolve => { enteredSecond = resolve; });
  const second = backend.getAskAnswer(backendInput(memory, providerFixture().provider, {
    userId: "other-user", ip: "192.0.2.2", load: async () => { enteredSecond(); await wait; return { snapshot }; },
  }));
  await beganSecond;
  await assert.rejects(backend.getAskAnswer(backendInput(memory, () => assert.fail("third model"), { userId: "third-user" })), { code: "busy" });
  release(); await Promise.all([first, second]);
  assert.equal(memory.stats.attempts, 4); assert.equal(memory.cache.size, 2); assert.equal(memory.active.size, 0);
});

test("model timeout retains the started attempt and releases the unstarted second reservation", async () => {
  const memory = memoryStore(); const controller = new AbortController();
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const pending = backend.getAskAnswer(backendInput(memory, async () => { entered(); return new Promise(() => {}); }, { workSignal: controller.signal }));
  await began; controller.abort();
  await assert.rejects(pending, error => ["deadline", "provider-error"].includes(error.code));
  assert.equal(memory.stats.attempts, 1); assert.equal(memory.stats.pending, 0);
  assert.equal(memory.stats.reservedTokens, 0); assert.equal(memory.cache.size, 0); assert.equal(memory.active.size, 0);
});

test("old-day reservations cannot start after UTC rollover or reduce a new day's reserved budget", async () => {
  const memory = memoryStore();
  await memory.store.admit("old-user", "old-ip", "old-owner"); await memory.store.reserve("old-user", "old-owner", config);
  memory.advance(86400000);
  await memory.store.admit("new-user", "new-ip", "new-owner"); await memory.store.reserve("new-user", "new-owner", config);
  await assert.rejects(memory.store.start("old-user", "old-owner"), { code: "lease-expired" });
  await memory.store.finish("old-user", "old-owner"); assert.equal(memory.stats.pending, 2);
  await memory.store.start("new-user", "new-owner"); await memory.store.finish("new-user", "new-owner");
  assert.equal(memory.stats.attempts, 1); assert.equal(memory.stats.pending, 0);
});

test("cache publication executes no extra retrieval, and hits execute zero tools", async () => {
  let executions = 0;
  const guarded = backendWithRetrieval({ ...retrieval, createAskTools(value) {
    const bound = retrieval.createAskTools(value);
    return Object.fromEntries(Object.entries(bound).map(([name, run]) => [name, args => { executions++; return run(args); }]));
  } });
  const memory = memoryStore();
  await guarded.getAskAnswer(backendInput(memory, providerFixture().provider)); assert.equal(executions, 1);
  const cached = await guarded.getAskAnswer(backendInput(memory, () => assert.fail("cached model")));
  assert.equal(cached.cacheHit, true); assert.equal(executions, 1);
});

test("a cache record returned under a different user's key cannot leak across sessions", async () => {
  const memory = memoryStore();
  await backend.getAskAnswer(backendInput(memory, providerFixture().provider));
  const record = [...memory.cache.values()][0];
  memory.store.getCached = async () => record; // simulate a crossed storage response
  const fake = providerFixture();
  const result = await backend.getAskAnswer(backendInput(memory, fake.provider, { userId: "other-user" }));
  assert.equal(result.cacheHit, false); assert.equal(fake.calls(), 2);
});

test("cache hits never consume the global generation cap; at the cap, saved answers still serve and misses stop before any model call", async () => {
  const memory = memoryStore();
  memory.stats.generations = 19; // one generation left today
  const first = providerFixture();
  assert.equal((await backend.getAskAnswer(backendInput(memory, first.provider))).cacheHit, false);
  assert.equal(memory.stats.generations, 20);
  const hit = await backend.getAskAnswer(backendInput(memory, () => assert.fail("cache hit must not call the model")));
  assert.equal(hit.cacheHit, true); assert.equal(memory.stats.generations, 20, "hit consumed no generation");
  assert.equal(memory.stats.requests, 2, "the hit still counted as an admitted (abuse-limited) request");
  await assert.rejects(backend.getAskAnswer(backendInput(memory, () => assert.fail("no model past the cap"), { userId: "other-user", ip: "192.0.2.9" })),
    { code: "generation-budget", status: 429 });
  assert.equal(memory.stats.generations, 20); assert.equal(memory.stats.pending, 0); assert.equal(memory.active.size, 0);
});

test("only a fully successful reservation consumes a generation; RSS failures and budget rejections do not", async () => {
  const memory = memoryStore();
  await assert.rejects(backend.getAskAnswer(backendInput(memory, () => assert.fail("no model"), { load: async () => { throw new Error("rss down"); } })));
  assert.equal(memory.stats.generations, 0, "a pre-reservation failure consumes no generation");
  await memory.store.admit("u", "ip", "o");
  await assert.rejects(memory.store.reserve("u", "o", { ...config, dailyAttempts: 1 }), { code: "generation-budget" });
  assert.equal(memory.stats.generations, 0, "an attempt-budget rejection consumes no generation");
  memory.stats.generations = 20; memory.advance(86400000); // UTC rollover resets the cap
  await memory.store.admit("u2", "ip2", "o2"); await memory.store.reserve("u2", "o2", config);
  assert.equal(memory.stats.generations, 1);
});

test("a client disconnect mid-generation still releases the lease and refunds never-started calls", async () => {
  // The route's workSignal includes request.signal, so a closed tab aborts all new work;
  // cleanup must still run on its own time-only signal.
  const memory = memoryStore(); const client = new AbortController();
  const workSignal = AbortSignal.any([client.signal]);
  let entered;
  const began = new Promise(resolve => { entered = resolve; });
  const pending = backend.getAskAnswer(backendInput(memory, async () => { entered(); return new Promise(() => {}); },
    { workSignal, cleanupSignal: AbortSignal.timeout(5000) }));
  await began; client.abort();
  await assert.rejects(pending, error => ["deadline", "provider-error"].includes(error.code));
  assert.equal(memory.stats.attempts, 1, "the started call stays charged");
  assert.equal(memory.stats.pending, 0, "the never-started second call is refunded");
  assert.equal(memory.stats.reservedTokens, 0); assert.equal(memory.active.size, 0, "the lease is released immediately");
});

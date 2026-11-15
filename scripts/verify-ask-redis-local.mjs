// Executes the real Ask Lua scripts through the real @upstash/redis client against a
// DISPOSABLE local Redis behind an Upstash-compatible REST shim. It refuses any
// non-loopback URL and any non-empty database, never reads .env files and never
// touches shared Upstash, briefing or production keys. No model calls are made.
//
//   docker network create kicker-ask-test
//   docker run -d --rm --name kicker-ask-redis --network kicker-ask-test redis:7.2-alpine redis-server --save "" --appendonly no
//   docker run -d --rm --name kicker-ask-srh --network kicker-ask-test -p 127.0.0.1:8079:80 \
//     -e SRH_MODE=env -e SRH_TOKEN=local_disposable_token -e SRH_CONNECTION_STRING=redis://kicker-ask-redis:6379 hiett/serverless-redis-http:latest
//   ASK_LOCAL_REDIS_TOKEN=local_disposable_token node --experimental-strip-types scripts/verify-ask-redis-local.mjs
import assert from "node:assert/strict";
import { Redis } from "@upstash/redis";
import { loadAiModule } from "../tests/helpers/load-ai-module.mjs";
import * as settings from "../lib/ai/ask-settings.ts";
import { backend, snapshot, config, providerFixture } from "../tests/helpers/ask-backend-fixture.mjs";
import { ASK_NOW } from "../tests/fixtures/ask-news.mjs";

const url = process.env.ASK_LOCAL_REDIS_URL ?? "http://127.0.0.1:8079";
const token = process.env.ASK_LOCAL_REDIS_TOKEN;
const parsed = new URL(url);
assert.ok(parsed.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(parsed.hostname), // IP literals only
  "Refusing: only a loopback Redis REST shim may be used");
assert.ok(token, "Set ASK_LOCAL_REDIS_TOKEN to the disposable shim token");

// Explicit environment: never spread process.env, so VERCEL_ENV/production keys cannot leak in.
const env = { UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, REDIS_KEYSPACE: "dev" };
const raw = new Redis({ url, token, retry: false, automaticDeserialization: false });
assert.equal(await raw.dbsize(), 0, "Refusing: the database must be empty and disposable");

const keyspace = loadAiModule("../../lib/redis-keyspace.ts");
const storeModule = loadAiModule("../../lib/ai/ask-store.ts", {
  "@upstash/redis": { Redis }, "../redis-keyspace.ts": keyspace, "./ask-settings.ts": settings,
});
const prefix = keyspace.getRedisKeyspace(env).askPrefix;
assert.equal(prefix, "kicker:dev:{kicker-dev-ask}:v1:");
const store = storeModule.createAskStore(env, new AbortController().signal);
const h = storeModule.askHash;
const K = {
  lease: user => prefix + "lease:" + h(user), minute: user => prefix + "minute:" + h(user),
  userDay: user => prefix + "user-day:" + h(user), generationDay: prefix + "generation-day", active: prefix + "active",
  modelDay: prefix + "model-day", reservation: owner => prefix + "reservation:" + h(owner), cache: key => prefix + "cache:" + h(key),
};
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const clock = async () => { const [seconds] = await raw.time(); const now = Number(seconds); return { now, day: Math.floor(now / 86400), midnight: 86400 - (now % 86400) }; };
// Same script and KEYS layout as store.admit, with a 1-second lease to test expiry quickly.
const shortLease = (user, owner) => raw.eval(storeModule.ASK_ADMIT_SCRIPT, [K.lease(user), K.minute(user),
  prefix + "ip:" + h("198.51.100.250"), K.userDay(user), K.active], [owner, 1]);
// With automatic deserialization off, HGETALL is a flat [field, value, ...] list.
const hash = async key => { const flat = await raw.hgetall(key) ?? []; const out = {};
  for (let i = 0; i < flat.length; i += 2) out[flat[i]] = flat[i + 1]; return out; };
const model = async () => Object.fromEntries(Object.entries(await hash(K.modelDay)).map(([k, v]) => [k, Number(v)]));
async function rejects(promise, code, status) {
  try { await promise; } catch (error) {
    assert.equal(error.code, code); if (status) assert.equal(error.status, status);
    assert.equal(error.cause, undefined); return error;
  }
  assert.fail(`expected ${code}`);
}
async function reset() {
  let cursor = "0";
  do {
    const [next, keys] = await raw.scan(cursor, { match: prefix + "*", count: 500 });
    if (keys.length) await raw.del(...keys);
    cursor = String(next);
  } while (cursor !== "0");
}
const results = [];
async function check(name, fn) {
  await reset();
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, ok: false }); console.log(`FAIL ${name}\n  ${error.stack?.split("\n").slice(0, 3).join("\n  ")}`); }
}
const IP = "198.51.100.1";
const per = { first: settings.ASK_INPUT_RESERVATION + config.selectionTokens, second: settings.ASK_INPUT_RESERVATION + config.answerTokens };

await check("admission sets an owned 45s lease, counts once, and a second same-user request is busy without counting", async () => {
  const { now } = await clock();
  await store.admit("u1", IP, "o1");
  assert.equal(await raw.get(K.lease("u1")), "o1");
  const ttl = await raw.ttl(K.lease("u1")); assert.ok(ttl > 0 && ttl <= 45, `lease ttl ${ttl}`);
  assert.ok(Number(await raw.zscore(K.active, "o1")) > now);
  const busy = await rejects(store.admit("u1", IP, "o2"), "busy", 409);
  assert.ok(busy.retryAfter >= 1 && busy.retryAfter <= 45);
  assert.equal(await raw.hget(K.userDay("u1"), "count"), "1"); assert.equal(await raw.zcard(K.minute("u1")), 1);
  assert.equal(await raw.exists(K.generationDay), 0, "admission never touches global generation capacity");
});

await check("finish releases the owned lease so the user can ask again", async () => {
  await store.admit("u1", IP, "o1"); await store.finish("u1", "o1");
  assert.equal(await raw.exists(K.lease("u1")), 0); assert.equal(await raw.zscore(K.active, "o1"), null);
  await store.admit("u1", IP, "o2");
});

await check("global in-flight cap is two concurrent Ask requests", async () => {
  await store.admit("u1", "198.51.100.11", "o1"); await store.admit("u2", "198.51.100.12", "o2");
  const busy = await rejects(store.admit("u3", "198.51.100.13", "o3"), "busy", 409); assert.equal(busy.retryAfter, 3);
  await store.finish("u1", "o1"); await store.admit("u3", "198.51.100.13", "o3");
});

await check("per-user limit is 3 per rolling minute (Retry-After 60)", async () => {
  for (let i = 0; i < 3; i++) { await store.admit("u1", "198.51.100." + (20 + i), "o" + i); await store.finish("u1", "o" + i); }
  const limited = await rejects(store.admit("u1", "198.51.100.30", "o9"), "request-limit", 429); assert.equal(limited.retryAfter, 60);
  assert.equal(await raw.hget(K.userDay("u1"), "count"), "3", "rejected requests are not counted");
});

await check("per-IP limit is 5 per rolling minute across different users", async () => {
  for (let i = 0; i < 5; i++) { await store.admit("u" + i, IP, "o" + i); await store.finish("u" + i, "o" + i); }
  await rejects(store.admit("u9", IP, "o9"), "request-limit", 429);
});

await check("user 10/day uses Redis UTC day and resets; a full global generation cap does not block admission", async () => {
  const { day, midnight } = await clock();
  await raw.hset(K.userDay("u1"), { day, count: 10 });
  const limited = await rejects(store.admit("u1", IP, "o1"), "request-limit", 429);
  assert.ok(Math.abs(limited.retryAfter - midnight) <= 5, `retry ${limited.retryAfter} vs midnight ${midnight}`);
  await reset(); await raw.hset(K.generationDay, { day, count: 20 });
  await store.admit("u2", IP, "o2"); // cache hits must still be reachable
  const capped = await rejects(store.reserve("u2", "o2", config), "generation-budget", 429);
  assert.ok(Math.abs(capped.retryAfter - midnight) <= 5);
  assert.equal(await raw.exists(K.reservation("o2")), 0); assert.equal(await raw.exists(K.modelDay) && (await model()).reserved, 0);
  await reset(); await raw.hset(K.userDay("u1"), { day: day - 1, count: 10 });
  await store.admit("u1", IP, "o1");
  assert.equal(await raw.hget(K.userDay("u1"), "count"), "1"); assert.equal(Number(await raw.hget(K.userDay("u1"), "day")), day);
});

await check("global generation cap: 20 per UTC day, counted only by fully successful reservations, atomic under races", async () => {
  const { day } = await clock();
  await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config);
  assert.deepEqual(await hash(K.generationDay), { day: String(day), count: "1" });
  assert.ok((await raw.ttl(K.generationDay)) > 0);
  await reset(); await raw.hset(K.modelDay, { day, used: 39, reserved: 0, tokensUsed: 0, tokensReserved: 0 });
  await store.admit("u1", IP, "o1"); await rejects(store.reserve("u1", "o1", config), "generation-budget", 429);
  assert.equal(await raw.exists(K.generationDay), 0, "an attempt-budget rejection consumes no generation");
  await reset(); await raw.hset(K.generationDay, { day, count: 19 });
  await store.admit("u1", "198.51.100.1", "o1"); await store.admit("u2", "198.51.100.2", "o2");
  const race = await Promise.allSettled([store.reserve("u1", "o1", config), store.reserve("u2", "o2", config)]);
  assert.equal(race.filter(r => r.status === "fulfilled").length, 1); assert.equal(await raw.hget(K.generationDay, "count"), "20");
  await reset(); await raw.hset(K.generationDay, { day: day - 1, count: 20 });
  await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config);
  assert.deepEqual(await hash(K.generationDay), { day: String(day), count: "1" }, "UTC rollover resets the cap");
});

await check("reservation needs the owned lease and reserves two attempts plus 132,656 token units exactly once", async () => {
  const { day } = await clock();
  await rejects(store.reserve("u1", "nobody", config), "lease-expired", 409);
  await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config);
  assert.deepEqual(await model(), { day, used: 0, reserved: 2, tokensUsed: 0, tokensReserved: per.first + per.second });
  assert.equal(per.first + per.second, 132656);
  const reservation = await hash(K.reservation("o1"));
  assert.equal(reservation.owner, "o1"); assert.equal(Number(reservation.next), 1);
  assert.equal(Number(reservation.first), per.first); assert.equal(Number(reservation.second), per.second);
  await rejects(store.reserve("u1", "o1", config), "lease-expired", 409);
  assert.equal((await model()).reserved, 2, "duplicate reservation did not double count");
});

await check("attempt and token budgets include outstanding reservations; exhaustion retries at UTC midnight", async () => {
  const { day, midnight } = await clock();
  const seed = async values => { await reset(); await raw.hset(K.modelDay, { day, used: 0, reserved: 0, tokensUsed: 0, tokensReserved: 0, ...values }); await store.admit("u1", IP, "o1"); };
  await seed({ used: 39 });
  const exhausted = await rejects(store.reserve("u1", "o1", config), "generation-budget", 429);
  assert.ok(Math.abs(exhausted.retryAfter - midnight) <= 5);
  await seed({ reserved: 39 }); await rejects(store.reserve("u1", "o1", config), "generation-budget", 429);
  await seed({ used: 38 }); await store.reserve("u1", "o1", config);
  await seed({ tokensUsed: config.dailyTokens - 132655 }); await rejects(store.reserve("u1", "o1", config), "generation-budget", 429);
  await seed({ tokensReserved: config.dailyTokens - 132656 }); await store.reserve("u1", "o1", config);
});

await check("start converts reservations into charged attempts, at most two per request", async () => {
  await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config);
  const { day } = await clock();
  await store.start("u1", "o1");
  assert.deepEqual(await model(), { day, used: 1, reserved: 1, tokensUsed: per.first, tokensReserved: per.second });
  await store.start("u1", "o1");
  assert.deepEqual(await model(), { day, used: 2, reserved: 0, tokensUsed: per.first + per.second, tokensReserved: 0 });
  await rejects(store.start("u1", "o1"), "lease-expired", 409);
  assert.equal((await model()).used, 2, "a third call is impossible");
});

await check("finish refunds only never-started calls; started calls stay charged", async () => {
  for (const starts of [0, 1, 2]) {
    await reset(); await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config);
    for (let i = 0; i < starts; i++) await store.start("u1", "o1");
    await store.finish("u1", "o1");
    const state = await model();
    assert.equal(state.used, starts); assert.equal(state.reserved, 0); assert.equal(state.tokensReserved, 0);
    assert.equal(state.tokensUsed, [0, per.first, per.first + per.second][starts]);
    assert.equal(await raw.exists(K.reservation("o1")), 0); assert.equal(await raw.exists(K.lease("u1")), 0);
  }
});

await check("expired leases cannot reserve, start or publish; stale owners cannot remove a replacement lease", async () => {
  await shortLease("u1", "oA"); await delay(2100);
  await rejects(store.reserve("u1", "oA", config), "lease-expired", 409);
  await store.admit("u1", IP, "oB");
  await store.finish("u1", "oA");
  assert.equal(await raw.get(K.lease("u1")), "oB"); assert.ok(await raw.zscore(K.active, "oB"));
  await rejects(store.finish("u1", "oA", "identity", { stale: true }, 300), "lease-expired", 409);
  assert.equal(await raw.exists(K.cache("identity")), 0, "a stale owner cannot publish a cache record");
  await reset(); await shortLease("u1", "oC"); await store.reserve("u1", "oC", config); await delay(2100);
  await rejects(store.start("u1", "oC"), "lease-expired", 409);
  await store.finish("u1", "oC");
  const state = await model(); assert.equal(state.used, 0); assert.equal(state.reserved, 0); assert.equal(state.tokensReserved, 0);
});

await check("UTC rollover: stale-day reservations cannot start or subtract new-day counters; old totals reset", async () => {
  const { day } = await clock();
  await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config);
  await raw.hset(K.reservation("o1"), { day: day - 1 });
  await rejects(store.start("u1", "o1"), "lease-expired", 409);
  await store.finish("u1", "o1");
  assert.equal((await model()).reserved, 2, "new-day counters are conservatively retained");
  assert.equal(await raw.exists(K.reservation("o1")), 0);
  await reset(); await raw.hset(K.modelDay, { day: day - 1, used: 40, reserved: 2, tokensUsed: config.dailyTokens, tokensReserved: 5 });
  await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config);
  assert.deepEqual(await model(), { day, used: 0, reserved: 2, tokensUsed: 0, tokensReserved: 132656 });
});

await check("parallel requests: Lua admission and budgets stay atomic", async () => {
  const sameUser = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => store.admit("u1", "198.51.100." + i, "o" + i)));
  assert.equal(sameUser.filter(r => r.status === "fulfilled").length, 1);
  assert.ok(sameUser.filter(r => r.status === "rejected").every(r => r.reason.code === "busy"));
  assert.equal(await raw.hget(K.userDay("u1"), "count"), "1");
  await reset();
  const users = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => store.admit("u" + i, "198.51.100." + i, "o" + i)));
  assert.equal(users.filter(r => r.status === "fulfilled").length, 2); assert.equal(await raw.exists(K.generationDay), 0);
  await reset(); const { day } = await clock();
  await raw.hset(K.modelDay, { day, used: 38, reserved: 0, tokensUsed: 0, tokensReserved: 0 });
  await store.admit("u1", "198.51.100.1", "o1"); await store.admit("u2", "198.51.100.2", "o2");
  const reserves = await Promise.allSettled([store.reserve("u1", "o1", config), store.reserve("u2", "o2", config)]);
  assert.equal(reserves.filter(r => r.status === "fulfilled").length, 1); assert.equal((await model()).reserved, 2);
  await reset(); await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config);
  const starts = await Promise.allSettled(Array.from({ length: 5 }, () => store.start("u1", "o1")));
  assert.equal(starts.filter(r => r.status === "fulfilled").length, 2); assert.equal((await model()).used, 2);
});

await check("private cache publish round-trips through the real Upstash client as an object with a TTL", async () => {
  const record = { version: "fixture", nested: { list: [1, 2, 3], text: "Nvidia ‘quotes’ — unicode" } };
  await store.admit("u1", IP, "o1"); await store.finish("u1", "o1", "identity-1", record, 300);
  assert.deepEqual(await store.getCached("identity-1"), record, "automatic deserialization returns the stored object");
  const ttl = await raw.ttl(K.cache("identity-1")); assert.ok(ttl > 290 && ttl <= 300, `cache ttl ${ttl}`);
  assert.equal(await store.getCached("identity-2"), null);
});

await check("every key written is in the dev Ask hash slot and expires (no unbounded growth)", async () => {
  await store.admit("u1", IP, "o1"); await store.reserve("u1", "o1", config); await store.start("u1", "o1");
  await store.finish("u1", "o1", "identity-1", { ok: true }, 300);
  await store.admit("u2", "198.51.100.2", "o2"); await store.reserve("u2", "o2", config);
  const [, keys] = await raw.scan("0", { match: "*", count: 1000 });
  assert.ok(keys.length >= 8); assert.equal(await raw.dbsize(), keys.length);
  for (const key of keys) {
    assert.ok(key.startsWith(prefix), `unexpected key ${key}`);
    const ttl = await raw.ttl(key); assert.ok(ttl > 0, `${key} has no expiry`);
  }
});

const fixtureNow = () => ASK_NOW.getTime() + 1000;
const input = provider => ({ userId: "user-e2e", ip: IP, question: "Nvidia news?", config, store,
  load: async () => ({ snapshot }), provider, now: fixtureNow,
  cleanupSignal: new AbortController().signal, workSignal: new AbortController().signal, workEndsAt: Date.now() + 28000 });

await check("backend on real Redis: miss charges two calls and caches; repeat is a zero-call cache hit", async () => {
  const fake = providerFixture();
  const first = await backend.getAskAnswer(input(fake.provider));
  assert.equal(first.cacheHit, false); assert.equal(first.modelRequests, 2); assert.equal(fake.calls(), 2);
  assert.equal(first.answer.status, "answered"); assert.ok(first.answer.statements[0].citations[0].url.startsWith("https://example.test/"));
  let state = await model(); assert.equal(state.used, 2); assert.equal(state.reserved, 0); assert.equal(state.tokensReserved, 0);
  assert.equal(await raw.exists(K.lease("user-e2e")), 0);
  const second = await backend.getAskAnswer(input(() => assert.fail("cache hit must not call the model")));
  assert.equal(second.cacheHit, true); assert.equal(second.modelRequests, 0); assert.equal(second.generatedAt, first.generatedAt);
  state = await model(); assert.equal(state.used, 2, "cache hit reserved nothing");
  assert.equal(await raw.hget(K.userDay("user-e2e"), "count"), "2", "cache hits still count as requests");
  assert.equal(await raw.hget(K.generationDay, "count"), "1", "the cache hit consumed no generation");
});

await check("backend on real Redis: at the generation cap, saved answers still serve and new questions stop before any model call", async () => {
  const { day } = await clock();
  await backend.getAskAnswer(input(providerFixture().provider));
  await raw.hset(K.generationDay, { day, count: 20 });
  const hit = await backend.getAskAnswer(input(() => assert.fail("cache hit must not call the model")));
  assert.equal(hit.cacheHit, true);
  await rejects(backend.getAskAnswer({ ...input(() => assert.fail("no model past the cap")), userId: "user-e2e-2", question: "Economy news?" }), "generation-budget", 429);
  const state = await model(); assert.equal(state.used, 2); assert.equal(state.reserved, 0);
});

await check("backend on real Redis: failed first call stays charged, unused call refunded, nothing cached", async () => {
  await rejects(backend.getAskAnswer(input(providerFixture({ failAt: 1 }).provider)), "provider-error");
  const state = await model(); assert.equal(state.used, 1); assert.equal(state.reserved, 0); assert.equal(state.tokensReserved, 0);
  const [, keys] = await raw.scan("0", { match: prefix + "cache:*", count: 100 }); assert.equal(keys.length, 0);
  assert.equal(await raw.exists(K.lease("user-e2e")), 0);
});

await check("backend on real Redis: a client disconnect mid-generation still releases the lease and refunds the unstarted call", async () => {
  const client = new AbortController(); let entered;
  const began = new Promise((resolve) => { entered = resolve; });
  const pending = backend.getAskAnswer({ ...input(async () => { entered(); return new Promise(() => {}); }), workSignal: client.signal });
  await began; client.abort();
  await rejects(pending, "deadline");
  const state = await model(); assert.equal(state.used, 1); assert.equal(state.reserved, 0); assert.equal(state.tokensReserved, 0);
  assert.equal(await raw.exists(K.lease("user-e2e")), 0, "lease released immediately, not after 45s");
  await backend.getAskAnswer(input(providerFixture().provider)); // the user can ask again right away
});

await check("backend on real Redis: concurrent identical requests from one user generate once; the other is busy", async () => {
  const fake = providerFixture();
  const slow = async (...args) => { await delay(400); return fake.provider(...args); };
  const both = await Promise.allSettled([backend.getAskAnswer(input(slow)), backend.getAskAnswer(input(slow))]);
  assert.equal(both.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(both.find(r => r.status === "rejected").reason.code, "busy"); assert.equal(fake.calls(), 2);
});

await reset();
assert.equal(await raw.dbsize(), 0, "harness cleaned up every key it wrote");
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length}/${results.length} real-Redis checks passed (no model calls, loopback only).`);
process.exitCode = failed.length ? 1 : 0;

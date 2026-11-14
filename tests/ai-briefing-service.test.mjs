import assert from "node:assert/strict";
import test from "node:test";
import { getOrGenerateBriefing, briefingScope } from "../lib/ai/service.ts";
import { readBriefingConfig, BriefingError } from "../lib/ai/settings.ts";
import { selectBriefingArticles } from "../lib/ai/briefing.ts";
import { editorialNow, editorialArticles } from "./fixtures/briefing-editorial.mjs";

const config = readBriefingConfig({ AI_BRIEFING_MODEL: "fixture-model", AI_BRIEFING_DAILY_ATTEMPTS: "2" });
const article = { title: "Mission preparations", link: "https://example.com/a", source: "NASA", summary: null, publishedAt: "2026-11-13T11:00:00Z" };
const output = { items: [{ headline: "Mission preparations", explanation: "NASA reports mission preparations.", sourceLinks: [article.link] }] };

function fixture() {
  let time = Date.parse("2026-11-13T12:00:00Z");
  const state = { lock: null, cached: null, attempts: 0, calls: 0, reads: 0, cooldown: 0 };
  const store = {
    async getCached() { return state.cached; },
    async acquire(owner) {
      if (state.cooldown > time) throw new BriefingError("generation-cooldown", 503, 30);
      if (state.lock) return false;
      state.lock = owner; return true;
    },
    async reserve(owner, conf) {
      assert.equal(state.lock, owner);
      if (state.attempts >= conf.dailyAttempts) throw new BriefingError("generation-budget");
      state.attempts++;
    },
    async complete(owner, scope, cached, seconds) {
      assert.equal(state.lock, owner);
      state.cached = structuredClone(cached); state.cooldown = time + seconds * 1000;
    },
    async fail(owner, seconds) { if (state.lock === owner) state.cooldown = time + seconds * 1000; },
    async release(owner) { if (state.lock === owner) state.lock = null; },
  };
  const deps = { config, store, now: () => new Date(time),
    async fetchArticles() { state.reads++; return [article]; },
    async generate() { state.calls++; return { output, usage: { inputTokens: 300, outputTokens: 80 } }; },
  };
  return { state, deps, advance: (seconds) => { time += seconds * 1000; } };
}

test("briefing caches successful generation; hits work even after the generation budget is exhausted", async () => {
  const { deps, state } = fixture();
  const first = await getOrGenerateBriefing(deps);
  assert.equal(first.cacheHit, false);
  state.attempts = 2;
  const second = await getOrGenerateBriefing(deps);
  assert.equal(second.cacheHit, true);
  assert.deepEqual(first.briefing, second.briefing);
  assert.equal(state.calls, 1); assert.equal(state.reads, 1); assert.equal(state.lock, null);
});

test("briefing concurrent requests generate only once", async () => {
  const { deps, state } = fixture();
  let finish;
  const ready = new Promise((resolve) => { finish = resolve; });
  const started = getOrGenerateBriefing({ ...deps, generate: async () => { state.calls++; await ready; return { output, usage: {} }; } });
  // Advance promise continuations until the first generation has entered the model.
  for (let i = 0; i < 10 && !state.calls; i++) await Promise.resolve();
  assert.equal(state.calls, 1);
  await assert.rejects(getOrGenerateBriefing(deps), /generation-in-progress/);
  finish(); await started;
  assert.equal((await getOrGenerateBriefing(deps)).cacheHit, true);
  assert.equal(state.calls, 1);
});

test("failed model calls consume budget but allow successful retry after short cooldown", async () => {
  const { deps, state, advance } = fixture();
  await assert.rejects(getOrGenerateBriefing({ ...deps, generate: async () => { state.calls++; throw new BriefingError("provider-error", 502); } }), /provider-error/);
  assert.equal(state.attempts, 1); assert.equal(state.cached, null); assert.equal(state.lock, null);
  await assert.rejects(getOrGenerateBriefing(deps), /generation-cooldown/);
  advance(31);
  const result = await getOrGenerateBriefing(deps);
  assert.equal(result.cacheHit, false); assert.equal(state.attempts, 2);
  assert.equal((await getOrGenerateBriefing(deps)).cacheHit, true);
  advance(901);
  await assert.rejects(getOrGenerateBriefing(deps), /generation-budget/);
  assert.equal(state.calls, 2);
});

test("empty or unavailable feeds make no model call, and malformed output is never cached", async () => {
  const { deps, state } = fixture();
  await assert.rejects(getOrGenerateBriefing({ ...deps, fetchArticles: async () => [] }), /no-recent-articles/);
  assert.equal(state.calls, 0); assert.equal(state.attempts, 0);
  const next = fixture();
  await assert.rejects(getOrGenerateBriefing({ ...next.deps, generate: async () => ({ output: {}, usage: {} }) }), /invalid-model-output/);
  assert.equal(next.state.attempts, 1); assert.equal(next.state.cached, null);
});

test("expired/malformed cache cannot be served, configuration changes invalidate the cache scope", async () => {
  for (const cached of [{}, { articles: null }, { generatedAt: "invalid", expiresAt: "invalid" }]) {
    const { deps, state } = fixture(); state.cached = cached;
    assert.equal((await getOrGenerateBriefing(deps)).cacheHit, false);
  }
  const { deps, state, advance } = fixture();
  await getOrGenerateBriefing(deps); advance(901);
  assert.equal((await getOrGenerateBriefing(deps)).cacheHit, false);
  assert.equal(state.calls, 2);
  assert.notEqual(briefingScope(config), briefingScope({ ...config, model: "another-model" }));
});

test("a worker that loses its lease cannot publish or release another worker's lease", async () => {
  const { deps, state } = fixture();
  const complete = deps.store.complete;
  deps.store.complete = async (...args) => { state.lock = "other-worker"; return complete(...args); };
  await assert.rejects(getOrGenerateBriefing(deps));
  assert.equal(state.lock, "other-worker"); assert.equal(state.cached, null);
});

test("compatible old cache and new editorial order are served without fetching, locking or spending", async () => {
  for (const articles of [selectBriefingArticles(editorialArticles, editorialNow).reverse(), selectBriefingArticles(editorialArticles, editorialNow)]) {
    const { deps, state } = fixture();
    const generatedAt = "2026-11-13T11:59:00Z";
    state.cached = { articles, generatedAt, expiresAt: "2026-11-13T12:14:00Z", fingerprint: "fixture",
      output: { items: articles.slice(0, 5).map(item => ({ headline: item.title, explanation: item.summary ?? item.title, sourceLinks: [item.link] })) } };
    state.attempts = 2;
    deps.store.acquire = async () => assert.fail("cache hits never acquire a generation lease");
    const result = await getOrGenerateBriefing(deps);
    assert.equal(result.cacheHit, true);
    assert.equal(result.briefing.generatedAt, generatedAt);
    assert.equal(state.calls, 0); assert.equal(state.reads, 0); assert.equal(state.attempts, 2);
  }
});

test("generation keeps editorial order for Claude but persists chronological evidence for deployed readers", async () => {
  const { deps, state } = fixture();
  deps.fetchArticles = async () => editorialArticles;
  let supplied;
  deps.generate = async articles => {
    supplied = structuredClone(articles);
    return { output: { items: articles.slice(0, 5).map(item => ({ headline: item.title, explanation: item.summary ?? item.title, sourceLinks: [item.link] })) }, usage: {} };
  };
  const first = await getOrGenerateBriefing(deps);
  assert.equal(supplied[0].title, editorialArticles[0].title);
  const expected = [...supplied].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.link.localeCompare(b.link));
  assert.deepEqual(state.cached.articles, expected);
  assert.notDeepEqual(state.cached.articles, supplied);
  assert.deepEqual((await getOrGenerateBriefing(deps)).briefing, first.briefing);
  assert.deepEqual(first.briefing.items.map(item => item.references[0].url), supplied.slice(0, 5).map(item => item.link));
});

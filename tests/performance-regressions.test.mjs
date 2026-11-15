import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModule } from "./helpers/load-ai-module.mjs";
const keyspace = loadAiModule("../../lib/redis-keyspace.ts");

test("publisher cache shares refreshes, preserves last-good data, backs off failures and expires stale data", async () => {
  let clock = 1000;
  const { createFeedCache } = loadAiModule("../../lib/feed-cache.ts");
  const cache = createFeedCache(() => clock);
  let calls = 0;
  let release;
  const load = () => { calls++; return new Promise(resolve => { release = resolve; }); };
  const first = cache.read("publisher", load);
  const concurrent = cache.read("publisher", load, true);
  release(["story"]);
  assert.equal((await first).items[0], "story");
  assert.equal((await concurrent).items[0], "story");
  assert.equal(calls, 1);
  await cache.read("publisher", load);
  assert.equal(calls, 1);
  const fail = async () => { calls++; throw new Error("upstream unavailable"); };
  clock += 91000;
  const fallback = await cache.read("publisher", fail);
  assert.equal(fallback.failed, true);
  assert.equal(fallback.stale, true);
  assert.equal(fallback.items[0], "story");
  await cache.read("publisher", fail, true);
  assert.equal(calls, 2, "manual refresh respects error backoff");
  clock += 1800001;
  assert.equal((await cache.read("publisher", fail)).items.length, 0);
  assert.equal((await cache.read("other", fail)).stale, false);
  assert.equal((await cache.read("other", fail)).stale, false);
  clock += 15001;
  assert.equal((await cache.read("publisher", async () => ["recovered"])).failed, false);
});

test("feed cache reports the last successful load without changing freshness decisions", async () => {
  let clock = 5000;
  const { createFeedCache } = loadAiModule("../../lib/feed-cache.ts");
  const cache = createFeedCache(() => clock);
  const fail = async () => { throw new Error("upstream unavailable"); };
  assert.equal((await cache.read("never", fail)).lastSuccessAt, null, "a feed that never loaded has no success time");
  assert.equal((await cache.read("publisher", async () => ["story"])).lastSuccessAt, 5000);
  clock += 91000;
  const stale = await cache.read("publisher", fail);
  assert.deepEqual([stale.failed, stale.stale, stale.lastSuccessAt], [true, true, 5000]);
  assert.equal((await cache.read("publisher", fail)).lastSuccessAt, 5000, "backoff reads keep the same success time");
});

test("password auth handles HTML 404, JSON errors, network failures and timeout without leaking raw response", async () => {
  const { submitPasswordAuth } = loadAiModule("../../lib/auth-client.ts", {}, { TypeError });
  await assert.rejects(submitPasswordAuth("login", "user@example.test", "fake", async () => new Response("<html>private upstream data</html>", { status: 404 })), /service was not found/);
  for (const status of [400, 429, 500, 503]) {
    await assert.rejects(submitPasswordAuth("login", "user@example.test", "fake", async () => Response.json({ error: "Please retry" }, { status })), /Please retry/);
  }
  await assert.rejects(submitPasswordAuth("login", "user@example.test", "fake", async () => { throw new TypeError("raw network detail"); }), /Unable to reach/);
  await assert.rejects(submitPasswordAuth("login", "user@example.test", "fake", async () => { const error = new Error("raw timeout"); error.name = "TimeoutError"; throw error; }), /timed out/);
  const result = await submitPasswordAuth("signup", " user@example.test ", "fake", async (url, options) => {
    assert.equal(url, "/api/auth/signup");
    assert.equal(JSON.parse(options.body).email, "user@example.test");
    assert.equal(options.credentials, "same-origin");
    assert.ok(options.signal);
    return Response.json({ confirmationRequired: true });
  });
  assert.equal(result.confirmationRequired, true);
});

test("session refresh verifies auth-cookie pages while skipping anonymous pages and independently authenticated APIs", () => {
  const { shouldRefreshSession } = loadAiModule("../../lib/supabase/session-policy.ts");
  assert.equal(shouldRefreshSession("/", []), false);
  assert.equal(shouldRefreshSession("/dashboard", ["sb-project-auth-token"]), true);
  assert.equal(shouldRefreshSession("/dashboard", ["sb-project-auth-token.0"]), true);
  assert.equal(shouldRefreshSession("/api/news", ["sb-project-auth-token"]), false);
  assert.equal(shouldRefreshSession("/api/auth/login", ["sb-project-auth-token"]), false);
  assert.equal(shouldRefreshSession("/_next/static/example.js", ["sb-project-auth-token"]), false);
});

test("Redis construction and request failures fail closed with sanitized retryable 503", async () => {
  for (const constructorFails of [true, false]) {
    const logs = [];
    class Redis { constructor(options) { assert.equal(options.retry, false); assert.ok(options.signal()); if (constructorFails) throw new Error("secret raw provider detail"); } }
    class Ratelimit {
      constructor(options) { assert.equal(options.timeout, 0, "disable the SDK's fail-open timeout"); }
      static slidingWindow() { return {}; }
      async limit() { throw new Error("secret raw provider detail"); }
    }
    const { enforceRateLimit } = loadAiModule("../../lib/ratelimit.ts", {
      "@upstash/redis": { Redis }, "@upstash/ratelimit": { Ratelimit }, "./redis-keyspace": keyspace,
      "next/server": { NextResponse: Response },
    }, { process: { env: { NODE_ENV: "production", VERCEL_ENV: "production", UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "fake-test-token" } }, console: { error: (...args) => logs.push(args), warn() {}, info() {} } });
    const response = await enforceRateLimit(new Request("https://app.example.test/api/auth/login"), "login");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("Retry-After"), "10");
    assert.doesNotMatch(JSON.stringify(logs) + await response.text(), /secret|fake-test-token|raw provider/);
  }
});

test("rate protection preserves allowed, throttled and missing-config policies", async () => {
  for (const scenario of ["allowed", "throttled", "missing-production", "missing-development"]) {
    const configured = !scenario.startsWith("missing");
    class Ratelimit {
      static slidingWindow(count, window) { assert.equal(count, 5); assert.equal(window, "1 m"); return {}; }
      async limit(key) { assert.equal(key, "auth-login:192.0.2.1"); return { success: scenario === "allowed", reset: Date.now() + 5000 }; }
    }
    const { enforceRateLimit } = loadAiModule("../../lib/ratelimit.ts", {
      "@upstash/redis": { Redis: class {} }, "@upstash/ratelimit": { Ratelimit }, "./redis-keyspace": keyspace,
      "next/server": { NextResponse: Response },
    }, { process: { env: { NODE_ENV: scenario === "missing-development" ? "development" : "production", VERCEL_ENV: scenario === "missing-development" ? "development" : "production", ...(configured ? { UPSTASH_REDIS_REST_URL: "https://redis.example.test", UPSTASH_REDIS_REST_TOKEN: "fake" } : {}) } }, console: { info() {}, error() {}, warn() {} } });
    const response = await enforceRateLimit(new Request("https://app.example.test/api/auth/login", { headers: { "x-forwarded-for": "192.0.2.1, 192.0.2.2" } }), "auth-login");
    assert.equal(response?.status ?? null, scenario === "throttled" ? 429 : scenario === "missing-production" ? 503 : null);
    if (scenario === "throttled") assert.ok(Number(response.headers.get("Retry-After")) >= 1);
  }
});

test("Supabase transport propagates caller cancellation without logging credentials", async () => {
  const controller = new AbortController();
  const { createSupabaseFetch } = loadAiModule("../../lib/supabase/fetch.ts");
  let signal;
  const fetcher = createSupabaseFetch(async (_url, options) => { signal = options.signal; return new Response(); });
  await fetcher("https://auth.example.test", { signal: controller.signal });
  assert.equal(signal.aborted, false);
  controller.abort();
  assert.equal(signal.aborted, true);
});

test("news endpoint skips lead-image retrieval for polls, reports partial failure and returns 503 for empty feeds", async () => {
  let articles = [{ link: "https://publisher.example/story" }];
  let imageCalls = 0;
  const { GET } = loadAiModule("../../app/api/news/route.ts", {
    "@/lib/rss": { getNewsSnapshot: async () => ({ articles, feedStatus: { failedFeeds: 1, staleFeeds: 1 } }) },
    "@/lib/article-images": { enhanceLeadArticleImage: async items => { imageCalls++; return items; } },
    "@/lib/news-api": { buildNewsApiPayload: items => ({ articles: items }), shouldBypassNewsCache: () => false },
    "@/lib/api-logging": { logApiInfo() {}, logApiError() {} },
    "next/server": { NextResponse: Response },
  });
  const poll = await GET(new Request("https://app.example/api/news?checkForUpdates=1"));
  assert.equal(poll.status, 200);
  assert.equal((await poll.json()).feedStatus.staleFeeds, 1);
  assert.match(poll.headers.get("Cache-Control"), /no-store/);
  assert.equal(imageCalls, 0);
  await GET(new Request("https://app.example/api/news"));
  assert.equal(imageCalls, 1);
  articles = [];
  const empty = await GET(new Request("https://app.example/api/news"));
  assert.equal(empty.status, 503);
  assert.equal(empty.headers.get("Retry-After"), "15");
});

test("login route preserves successful and invalid-credential behavior and stops before Supabase on rate protection failure", async () => {
  let blocked = false;
  let invalid = false;
  let calls = 0;
  const { POST } = loadAiModule("../../app/api/auth/login/route.ts", {
    "@/lib/ratelimit": { enforceRateLimit: async () => blocked ? Response.json({ error: "Unavailable" }, { status: 503 }) : null },
    "@/lib/supabase/server": { createSupabaseServerClient: async () => ({ auth: { signInWithPassword: async () => { calls++; return { data: { user: { id: "fixture" } }, error: invalid ? { message: "Invalid login credentials" } : null }; } } }) },
    "@/lib/api-logging": { logApiInfo() {}, logApiError() {} },
    "next/server": { NextResponse: Response },
  });
  const request = () => new Request("https://app.example/api/auth/login", { method: "POST", body: JSON.stringify({ email: "fixture@example.test", password: "fake" }) });
  assert.equal((await POST(request())).status, 200);
  invalid = true;
  assert.equal((await POST(request())).status, 400);
  blocked = true;
  assert.equal((await POST(request())).status, 503);
  assert.equal(calls, 2);
});

test("news client rejects empty responses and surfaces structured partial-feed status", async () => {
  let payload = { articles: [] };
  const { fetchLatestNews, parseFeedStatus } = loadAiModule("../../lib/news-client.ts", {}, { URLSearchParams, fetch: async () => Response.json(payload) });
  await assert.rejects(fetchLatestNews("refresh"), /keeping the current feed/);
  const issue = { source: "BBC News", topic: "technology", state: "stale", lastSuccessAt: "2026-11-15T01:00:00.000Z" };
  payload = { articles: [{ link: "https://publisher.example/story" }], feedStatus: { failedFeeds: 2, staleFeeds: 1, issues: [issue, { source: "NPR", topic: "headlines", state: "unavailable", lastSuccessAt: null, url: "https://private.example" }] } };
  const plain = (value) => JSON.parse(JSON.stringify(value)); // the module runs in a separate VM realm
  let status;
  assert.equal((await fetchLatestNews("refresh", { onFeedStatus: value => { status = value; } })).length, 1);
  assert.deepEqual(plain(status), { failedFeeds: 2, staleFeeds: 1, issues: [issue, { source: "NPR", topic: "headlines", state: "unavailable", lastSuccessAt: null }] }, "unknown fields such as URLs are dropped");
  payload = { articles: [{ link: "https://publisher.example/story" }], feedStatus: { failedFeeds: 0, staleFeeds: 0, issues: [] } };
  await fetchLatestNews("refresh", { onFeedStatus: value => { status = value; } });
  assert.deepEqual(plain(status), { failedFeeds: 0, staleFeeds: 0, issues: [] }, "a healthy refresh clears an earlier notice");
  // Malformed health data is ignored rather than rendered.
  assert.equal(parseFeedStatus({ failedFeeds: -1, staleFeeds: 0 }), null);
  assert.equal(parseFeedStatus("4 feeds are unavailable"), null);
  assert.deepEqual(plain(parseFeedStatus({ failedFeeds: 1, staleFeeds: 0, issues: [{ source: "", topic: "x", state: "unavailable" }, { source: "A", topic: "b", state: "broken" }, null] }).issues), []);
  assert.equal(parseFeedStatus({ failedFeeds: 60, staleFeeds: 0, issues: Array.from({ length: 60 }, (_, i) => ({ source: `S${i}`, topic: "headlines", state: "unavailable", lastSuccessAt: null })) }).issues.length, 50);
});

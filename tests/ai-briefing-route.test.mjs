import assert from "node:assert/strict";
import test from "node:test";
import * as settings from "../lib/ai/settings.ts";
import { loadAiModule } from "./helpers/load-ai-module.mjs";

function fixture(options = {}) {
  const calls = { model: 0, service: 0, auth: 0, logs: [] };
  const env = { AI_BRIEFING_ENABLED: "true", APP_BASE_URL: "https://kicker.example", AI_BRIEFING_MODEL: "fixture", ANTHROPIC_API_KEY: "fixture-secret", NODE_ENV: "test", ...options.env };
  const store = { async enforceUserLimit(id) { assert.equal(id, "user-1"); if (options.userLimit) throw new settings.BriefingError("user-rate-limit", 429, 60); }, async fetchArticles(load) { return load(); } };
  const route = loadAiModule("../../app/api/ai/briefing/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/supabase/server": { async createSupabaseServerClient() { return { auth: { async getUser() { calls.auth++; return { data: { user: options.anonymous ? null : { id: "user-1" } }, error: null }; } } }; } },
    "@/lib/ratelimit": { async enforceRateLimit() { return options.ipLimit ? Response.json({ error: "Too many requests" }, { status: 429 }) : null; } },
    "@/lib/rss": { async getAllNewsItems() { return []; } },
    "@/lib/api-logging": { logApiInfo(scope, details) { calls.logs.push({ scope, details }); }, logApiError(scope, error, details) { calls.logs.push({ scope, message: error.message, details }); } },
    "@/lib/ai/settings": settings,
    "@/lib/ai/briefing-store": { createBriefingStore() { if (options.redisError) throw new Error("secret Redis credentials"); return store; } },
    "@/lib/ai/provider": { async generateBriefing() { calls.model++; return {}; } },
    "@/lib/ai/service": { async getOrGenerateBriefing() { calls.service++; if (options.failure) throw options.failure; return { briefing: { generatedAt: "2026-11-13T12:00:00Z", items: [] }, cacheHit: true }; } },
  }, { process: { env } });
  return { post: route.POST, calls };
}
function request({ origin = "https://kicker.example", body, query = "" } = {}) {
  return new Request(`https://kicker.example/api/ai/briefing${query}`, { method: "POST", headers: origin ? { Origin: origin } : {}, ...(body !== undefined ? { body } : {}) });
}

function streamRequest(chunks = [], headers = {}) {
  return new Request("https://kicker.example/api/ai/briefing", {
    method: "POST", headers: { Origin: "https://kicker.example", ...headers }, duplex: "half",
    body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } }),
  });
}

test("bodyless POST and empty streams pass regardless of Content-Length or chunked transport", async () => {
  for (const input of [request(), request({ body: "" }), streamRequest(),
    streamRequest([], { "Content-Length": "0" }), streamRequest([], { "Transfer-Encoding": "chunked" }),
    streamRequest(["", ""]),
  ]) {
    const { post, calls } = fixture();
    assert.equal((await post(input)).status, 200);
    assert.equal(calls.auth, 1); assert.equal(calls.service, 1); assert.equal(calls.model, 0);
  }
});

test("any body byte is rejected even with misleading zero length, empty chunks or whitespace", async () => {
  for (const input of [request({ body: "{}" }), request({ body: " " }), streamRequest(["", "x"]),
    streamRequest(["x"], { "Content-Length": "0" }), streamRequest(["x"], { "Transfer-Encoding": "chunked" }),
  ]) {
    const { post, calls } = fixture();
    const response = await post(input);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "This endpoint accepts no request body or query parameters.");
    assert.equal(calls.auth, 0); assert.equal(calls.service, 0); assert.equal(calls.model, 0);
  }
});

test("query parameters and cross-site empty POSTs remain rejected before authentication", async () => {
  for (const query of ["?model=other", "?unused=", "?flag", "?%70rompt=hello"]) {
    const { post, calls } = fixture();
    assert.equal((await post(request({ query }))).status, 400);
    assert.equal(calls.auth, 0); assert.equal(calls.service, 0);
  }
  const { post, calls } = fixture();
  assert.equal((await post(streamRequest([], { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal(calls.auth, 0); assert.equal(calls.service, 0);
});

test("empty streams still require authentication and respect IP/user limits", async () => {
  for (const [options, status] of [[{ anonymous: true }, 401], [{ ipLimit: true }, 429], [{ userLimit: true }, 429]]) {
    const { post, calls } = fixture(options);
    assert.equal((await post(streamRequest([], { "Content-Length": "0" }))).status, status);
    assert.equal(calls.service, 0); assert.equal(calls.model, 0);
  }
});

test("body detection cancels after the first byte and does not wait for upload completion", async () => {
  let cancelled = false;
  const input = new Request("https://kicker.example/api/ai/briefing", {
    method: "POST", headers: { Origin: "https://kicker.example" }, duplex: "half",
    body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } }),
  });
  const { post, calls } = fixture();
  assert.equal((await post(input)).status, 400);
  assert.equal(cancelled, true); assert.equal(calls.auth, 0);
});

test("an aborted empty stream fails closed and cancels before authentication", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const input = new Request("https://kicker.example/api/ai/briefing", {
    method: "POST", headers: { Origin: "https://kicker.example" }, duplex: "half", signal: controller.signal,
    body: new ReadableStream({ cancel() { cancelled = true; } }),
  });
  const { post, calls } = fixture();
  const response = post(input);
  controller.abort();
  assert.equal((await response).status, 400);
  assert.equal(cancelled, true); assert.equal(calls.auth, 0); assert.equal(calls.service, 0);
});

test("an unfinished empty stream times out without reaching authentication or generation", async () => {
  let cancelled = false;
  const input = new Request("https://kicker.example/api/ai/briefing", {
    method: "POST", headers: { Origin: "https://kicker.example" }, duplex: "half",
    body: new ReadableStream({ cancel() { cancelled = true; } }),
  });
  const { post, calls } = fixture();
  // AbortSignal.timeout is unref'd; keep the test process alive for its deadline.
  const keepAlive = setTimeout(() => {}, 7000);
  try {
    assert.equal((await post(input)).status, 400);
    assert.equal(cancelled, true); assert.equal(calls.auth, 0); assert.equal(calls.service, 0);
  } finally { clearTimeout(keepAlive); }
});

test("briefing endpoint returns cached content with private no-store headers", async () => {
  const { post, calls } = fixture();
  const result = await post(request());
  assert.equal(result.status, 200); assert.match(result.headers.get("Cache-Control"), /private, no-store/);
  assert.equal((await result.json()).cacheHit, true); assert.equal(calls.auth, 1); assert.equal(calls.model, 0);
  assert.doesNotMatch(JSON.stringify(calls.logs), /fixture-secret/);
});

test("disabled flag and unverified production block the endpoint before authentication or model access", async () => {
  for (const env of [{ AI_BRIEFING_ENABLED: "false" }, { NODE_ENV: "production" }]) {
    const { post, calls } = fixture({ env });
    assert.equal((await post(request())).status, 503);
    assert.equal(calls.auth, 0); assert.equal(calls.service, 0);
  }
});

test("briefing endpoint rejects missing/cross origin, custom input and anonymous callers", async () => {
  for (const options of [{ origin: "https://attacker.example" }, { origin: null }]) {
    const { post, calls } = fixture(); assert.equal((await post(request(options))).status, 403); assert.equal(calls.service, 0);
  }
  for (const options of [{ body: '{}' }, { query: "?model=other" }]) {
    const { post, calls } = fixture(); assert.equal((await post(request(options))).status, 400); assert.equal(calls.service, 0);
  }
  const { post, calls } = fixture({ anonymous: true });
  assert.equal((await post(request())).status, 401); assert.equal(calls.service, 0);
});

test("briefing endpoint fails closed for missing configuration, user/IP limits, Redis or generation errors", async () => {
  for (const [options, status] of [
    [{ env: { ANTHROPIC_API_KEY: "" } }, 503], [{ env: { APP_BASE_URL: "" } }, 503],
    [{ env: { AI_BRIEFING_MODEL: "" } }, 503], [{ userLimit: true }, 429], [{ ipLimit: true }, 429],
    [{ redisError: true }, 503], [{ failure: new settings.BriefingError("provider-error", 502, 30) }, 502],
    [{ failure: new Error("secret raw provider response") }, 503],
  ]) {
    const { post, calls } = fixture(options);
    const result = await post(request());
    assert.equal(result.status, status); assert.match(result.headers.get("Cache-Control"), /no-store/);
    assert.doesNotMatch(await result.text(), /secret|fixture|credentials/);
    assert.doesNotMatch(JSON.stringify(calls.logs), /secret|fixture-secret|credentials/);
    assert.equal(calls.model, 0);
  }
});

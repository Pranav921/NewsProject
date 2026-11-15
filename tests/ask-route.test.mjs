import assert from "node:assert/strict";
import test from "node:test";
import * as settings from "../lib/ai/ask-settings.ts";
import * as answer from "../lib/ai/ask-answer.ts";
import { loadAiModule } from "./helpers/load-ai-module.mjs";

const featureFlag = loadAiModule("../../lib/ai/feature-flag.ts");

function fixture(options = {}) {
  const calls = { auth: 0, store: 0, backend: 0, model: 0, logs: [] };
  const env = { AI_BRIEFING_ENABLED: "true", AI_BRIEFING_MODEL: "claude-haiku-5-5", APP_BASE_URL: "https://kicker.example", ANTHROPIC_API_KEY: "PRIVATE_KEY_FIXTURE", NODE_ENV: "test", ...options.env };
  const loaded = loadAiModule("../../app/api/ai/ask/route.ts", {
    "next/server": { NextResponse: Response },
    "@/lib/supabase/server": { async createSupabaseServerClient() { return { auth: { async getUser() {
      calls.auth++; if (options.authHang) return new Promise(() => {});
      if (options.authThrow) throw new Error("PRIVATE cookie/token");
      return { data: { user: options.anonymous ? null : { id: "authenticated-user" } }, error: null };
    } } }; } },
    "@/lib/ratelimit": { getClientIp() { return "192.0.2.1"; } },
    "@/lib/api-logging": { logApiInfo(scope, details) { calls.logs.push({ scope, details }); } },
    "@/lib/ai/ask-store": { createAskStore() { calls.store++; if (options.redisUnavailable) throw new settings.AskBackendError("redis-unavailable", 503, 10); return {}; } },
    "@/lib/ai/ask-provider": { createAskProvider() { return () => { calls.model++; assert.fail("no external model request"); }; } },
    "@/lib/ai/ask-snapshot": { loadAskTools() { assert.fail("backend is mocked at this boundary"); } },
    "@/lib/ai/ask-backend": { async getAskAnswer(input) {
      calls.backend++; assert.equal(input.userId, "authenticated-user"); assert.equal(input.question, "PRIVATE question about Nvidia?");
      assert.equal(input.ip, "192.0.2.1"); assert.ok(input.workEndsAt <= Date.now() + 28500);
      if (options.failure) throw options.failure;
      return { answer: { status: "no_results", statements: [], clarification: null }, cacheHit: true,
        generatedAt: "2026-11-14T12:00:00Z", expiresAt: "2026-11-14T12:05:00Z", modelRequests: 0, toolExecutions: 0, usage: null };
    } },
    "@/lib/ai/ask-settings": settings, "@/lib/ai/ask-answer": answer, "@/lib/ai/feature-flag": featureFlag,
  }, { process: { env }, ...(options.shortDeadline ? { AbortSignal: { any: AbortSignal.any.bind(AbortSignal), timeout: () => AbortSignal.timeout(20) } } : {}) });
  return { post: loaded.POST, calls };
}
function request({ body = JSON.stringify({ question: "PRIVATE question about Nvidia?" }), headers = {}, origin = "https://kicker.example", query = "" } = {}) {
  return new Request(`https://kicker.example/api/ai/ask${query}`, { method: "POST", headers: {
    "content-type": "application/json", ...(origin ? { origin } : {}), ...headers,
  }, ...(body === null ? {} : { body }) });
}

test("Ask follows the shared AI switch (briefing flags) on every request; no separate Ask flag can enable or disable it", async () => {
  for (const env of [{ AI_BRIEFING_ENABLED: undefined }, { AI_BRIEFING_ENABLED: "false" }, { AI_BRIEFING_ENABLED: "TRUE" },
    { AI_BRIEFING_ENABLED: undefined, AI_ASK_ENABLED: "true", AI_ASK_PRODUCTION_VERIFIED: "true" },
    { NODE_ENV: "production", AI_BRIEFING_PRODUCTION_VERIFIED: undefined },
    { NODE_ENV: "production", AI_BRIEFING_PRODUCTION_VERIFIED: "true", AI_BRIEFING_ENABLED: "false" },
    { NODE_ENV: "production", VERCEL_ENV: "preview", AI_BRIEFING_PRODUCTION_VERIFIED: "false" }]) {
    const { post, calls } = fixture({ env });
    assert.equal((await post(request())).status, 503); assert.equal(calls.auth, 0); assert.equal(calls.store, 0);
  }
  for (const env of [{}, { AI_ASK_ENABLED: "false" }, { NODE_ENV: "production", AI_BRIEFING_PRODUCTION_VERIFIED: "true" }]) {
    assert.equal((await fixture({ env }).post(request())).status, 200, JSON.stringify(env));
  }
});

test("Ask reuses the briefing model only if it supports Ask's forced tool call; otherwise it fails closed after auth", async () => {
  for (const env of [{ AI_BRIEFING_MODEL: "claude-sonnet-5-5" }, { AI_BRIEFING_MODEL: "claude-opus-5-5" }, { AI_BRIEFING_MODEL: undefined },
    { AI_BRIEFING_PROVIDER: "openai" }]) {
    const { post, calls } = fixture({ env });
    const response = await post(request());
    assert.equal(response.status, 503); assert.equal((await response.json()).code, "unsupported-model");
    assert.equal(calls.backend, 0); assert.equal(calls.store, 0); assert.equal(calls.model, 0);
    const anonymous = fixture({ env, anonymous: true });
    assert.equal((await anonymous.post(request())).status, 401, "anonymous callers learn nothing about configuration");
  }
});

test("Ask requires the exact configured origin and denies cross-site, missing origins and query parameters", async () => {
  for (const input of [request({ origin: "https://evil.example" }), request({ origin: null }),
    request({ origin: "http://kicker.example" }), request({ headers: { "sec-fetch-site": "cross-site" } })]) {
    const { post, calls } = fixture(); assert.equal((await post(input)).status, 403); assert.equal(calls.auth, 0);
  }
  const { post, calls } = fixture(); assert.equal((await post(request({ query: "?tool=recent_news" }))).status, 400); assert.equal(calls.store, 0);
});

test("Ask anonymous access cannot reach Redis, retrieval or provider; identity comes only from Supabase", async () => {
  const { post, calls } = fixture({ anonymous: true });
  assert.equal((await post(request())).status, 401); assert.equal(calls.store, 0); assert.equal(calls.backend, 0);
  const authenticated = fixture();
  const result = await authenticated.post(request({ headers: { "x-user-id": "attacker", "x-redis-keyspace": "prod-legacy" } }));
  assert.equal(result.status, 200); assert.equal(authenticated.calls.model, 0);
});

test("Ask invalid origin configuration and authentication errors fail safely without logging secrets", async () => {
  for (const options of [{ env: { APP_BASE_URL: "data:text/plain,private" } },
    { env: { APP_BASE_URL: "https://user:PRIVATE@example.test" } }, { authThrow: true }]) {
    const { post, calls } = fixture(options);
    const response = await post(request()); assert.equal(response.status, 503); assert.equal(calls.store, 0);
    assert.doesNotMatch(JSON.stringify({ body: await response.json(), logs: calls.logs }), /PRIVATE|cookie|token/);
  }
});

test("Ask rejects malformed JSON, unexpected fields and invalid questions before storage/model work", async () => {
  for (const body of ["", " ", "{bad", "null", "[]", "{}", JSON.stringify({ question: "" }),
    JSON.stringify({ question: "x".repeat(501) }), JSON.stringify({ question: "a\u0000b" }),
    JSON.stringify({ question: "valid", userId: "attacker" }), JSON.stringify({ question: "valid", tool: "recent_news" }),
    JSON.stringify({ question: "valid", articleId: "x" }), JSON.stringify({ question: "valid", url: "https://evil.example" })]) {
    const { post, calls } = fixture(); assert.equal((await post(request({ body }))).status, 400); assert.equal(calls.store, 0);
  }
});

test("Ask validates content type and byte counts even when Content-Length is absent or misleading", async () => {
  for (const content of ["text/plain", "application/jsonp", "application/json; charset=iso-8859-1"]) {
    assert.equal((await fixture().post(request({ headers: { "content-type": content } }))).status, 415);
  }
  assert.equal((await fixture().post(request({ headers: { "content-type": "application/json; charset=utf-8" } }))).status, 200);
  assert.equal((await fixture().post(request({ body: "x".repeat(2049), headers: { "content-length": "0" } }))).status, 413);
  assert.equal((await fixture().post(request({ headers: { "content-length": "2049" } }))).status, 413);
  assert.equal((await fixture().post(request({ body: null }))).status, 400);
});

test("Ask handles empty streams, zero chunks and streamed JSON correctly without relying on body truthiness", async () => {
  for (const [chunks, status] of [[[], 400], [["", ""], 400], [["", '{"question":', '"PRIVATE question about Nvidia?"}'], 200]]) {
    const stream = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk)); controller.close(); } });
    const input = new Request("https://kicker.example/api/ai/ask", { method: "POST", duplex: "half", body: stream,
      headers: { origin: "https://kicker.example", "content-type": "application/json", "content-length": "0", "transfer-encoding": "chunked" } });
    assert.equal((await fixture().post(input)).status, status);
  }
});

test("Ask stalled bodies are cancelled on deadline; authentication time is included in the same request deadline", async () => {
  let cancelled = false;
  const input = new Request("https://kicker.example/api/ai/ask", { method: "POST", duplex: "half",
    body: new ReadableStream({ cancel() { cancelled = true; } }), headers: { origin: "https://kicker.example", "content-type": "application/json" } });
  assert.equal((await fixture({ shortDeadline: true }).post(input)).status, 504); assert.equal(cancelled, true);
  assert.equal((await fixture({ shortDeadline: true, authHang: true }).post(request())).status, 504);
});

test("Ask rejects invalid UTF-8 and bounds zero-byte chunks so a stream cannot starve its deadline", async () => {
  for (const chunks of [[new Uint8Array([255])], Array.from({ length: 65 }, () => new Uint8Array())]) {
    const body = new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } });
    const input = new Request("https://kicker.example/api/ai/ask", { method: "POST", body, duplex: "half",
      headers: { "content-type": "application/json", origin: "https://kicker.example" } });
    assert.equal((await fixture().post(input)).status, 400);
  }
});

test("Ask quota, busy and Redis failures are safe retryable errors; logs contain no private text or errors", async () => {
  for (const failure of [new settings.AskBackendError("request-limit", 429, 60), new settings.AskBackendError("busy", 409, 3),
    new settings.AskBackendError("generation-budget", 429, 100), new answer.AskWorkflowError("invalid-citation"), new Error("PRIVATE question/key/response")]) {
    const { post, calls } = fixture({ failure });
    const response = await post(request());
    assert.equal(response.status, failure instanceof settings.AskBackendError ? failure.status : 503);
    assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.ok(response.headers.get("retry-after"));
    assert.doesNotMatch(JSON.stringify({ body: await response.json(), logs: calls.logs }), /PRIVATE|cookie|credential|Nvidia|authenticated-user/);
  }
  const redis = fixture({ redisUnavailable: true });
  assert.equal((await redis.post(request())).status, 503); assert.equal(redis.calls.backend, 0);
  const success = fixture(); const response = await success.post(request());
  assert.equal(response.headers.get("vary"), "Cookie, Origin");
  assert.doesNotMatch(JSON.stringify(success.calls.logs), /PRIVATE|Nvidia|authenticated-user|192\.0\.2/);
});

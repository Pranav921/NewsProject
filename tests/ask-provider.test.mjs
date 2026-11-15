import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import * as answer from "../lib/ai/ask-answer.ts";
import { loadAiModule } from "./helpers/load-ai-module.mjs";

const { createAskProvider } = loadAiModule("../../lib/ai/ask-provider.ts", {
  "./ask-answer.ts": answer, "@anthropic-ai/sdk": { __esModule: true, default: Anthropic },
}, { fetch: () => assert.fail("No real network allowed") });
const params = { model: "claude-haiku-5-5", max_tokens: 384, messages: [{ role: "user", content: "synthetic fixture" }] };
const response = () => Response.json({ id: "msg_fixture", type: "message", role: "assistant", model: params.model,
  stop_reason: "tool_use", content: [{ type: "tool_use", id: "toolu_fixture", name: "recent_news", input: {} }],
  usage: { input_tokens: 100, output_tokens: 20 } });

test("Ask official SDK uses fixed Messages endpoint, safe transport and caller signal without environment credentials", async () => {
  let calls = 0; let assertion;
  const provider = createAskProvider("fixture-key", async (url, init) => {
    calls++;
    try {
      assert.equal(String(url), "https://api.anthropic.com/v1/messages");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer fixture-key");
      assert.equal(init.redirect, "error"); assert.equal(init.cache, "no-store");
      assert.equal(init.signal.aborted, false); assert.deepEqual(JSON.parse(init.body), params);
      return response();
    } catch (error) { assertion = error; throw error; }
  });
  const result = await provider(params, new AbortController().signal).catch(error => { throw assertion ?? error; });
  assert.equal(result.stop_reason, "tool_use"); assert.equal(calls, 1);
});

test("Ask SDK HTTP errors discard raw provider secrets and never retry", async () => {
  for (const [status, code] of [[401, "provider-authentication-failed"], [403, "provider-authentication-failed"],
    [408, "provider-timeout"], [429, "provider-rate-limited"], [400, "provider-error"], [500, "provider-error"], [529, "provider-error"]]) {
    let calls = 0;
    const provider = createAskProvider("fixture-key", async () => {
      calls++; return Response.json({ type: "error", error: { type: "api_error", message: "SECRET synthetic body" } }, { status });
    });
    await assert.rejects(provider(params, new AbortController().signal), error => error.code === code
      && error.message === code && error.cause === undefined && !JSON.stringify(error).includes("SECRET"));
    assert.equal(calls, 1);
  }
});

test("Ask SDK rejects missing credentials, aborted requests and oversized requests before network", async () => {
  assert.throws(() => createAskProvider(" "), { code: "provider-authentication-failed" });
  const provider = createAskProvider("fixture", () => assert.fail("no request permitted"));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider(params, controller.signal), { code: "provider-timeout" });
  await assert.rejects(provider({ ...params, system: "x".repeat(48000) }, new AbortController().signal), { code: "request-too-large" });
});

test("Ask SDK enforces response-byte cap and sanitizes connection or JSON parser failures", async () => {
  const signal = new AbortController().signal;
  await assert.rejects(createAskProvider("fixture", async () => new Response("x".repeat(65537)))(params, signal), { code: "response-too-large" });
  await assert.rejects(createAskProvider("fixture", async () => { throw new Error("PRIVATE DNS details"); })(params, signal), { code: "provider-connection-error" });
  await assert.rejects(createAskProvider("fixture", async () => new Response("PRIVATE malformed json", { headers: { "content-type": "application/json" } }))(params, signal), error => error.message === "provider-error" && error.cause === undefined);
});

test("Ask SDK cancels a stalled response stream on the shared deadline signal", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('{"partial":')); }, cancel() { cancelled = true; } });
  const controller = new AbortController();
  const pending = createAskProvider("fixture", async () => new Response(stream))(params, controller.signal);
  const timer = setTimeout(() => controller.abort(), 20);
  try { await assert.rejects(pending, { code: "provider-timeout" }); }
  finally { clearTimeout(timer); }
  assert.equal(cancelled, true);
});

test("Ask SDK bounds zero-byte response chunks instead of allowing an unbounded microtask loop", async () => {
  let cancelled = false;
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array()); }, cancel() { cancelled = true; } });
  await assert.rejects(createAskProvider("fixture", async () => new Response(stream))(params, new AbortController().signal), { code: "response-too-large" });
  assert.equal(cancelled, true);
});

import assert from "node:assert/strict";
import test from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
import * as briefing from "../lib/ai/briefing.ts";
import * as settings from "../lib/ai/settings.ts";
import { loadAiModule } from "./helpers/load-ai-module.mjs";

const config = settings.readBriefingConfig({ AI_BRIEFING_MODEL: "claude-haiku-5-5", AI_BRIEFING_PROVIDER: "anthropic" });
const articles = [{ title: "Mission preparations", link: "https://example.com/a", source: "NASA", publishedAt: "2026-11-13T11:00:00Z", summary: null }];
const output = { items: [{ headline: "Mission preparations", explanation: "NASA reports preparations for a mission.", sourceLinks: [articles[0].link] }] };
const imports = {
  "./briefing.ts": briefing, "./settings.ts": settings,
  "@anthropic-ai/sdk": { __esModule: true, default: Anthropic },
  "@anthropic-ai/sdk/lib/transform-json-schema": { transformJSONSchema },
};
// Exercise the actual official SDK against a fake fetch, not a model endpoint.
const provider = loadAiModule("../../lib/ai/provider.ts", imports);
const response = (overrides = {}) => Response.json({
  id: "msg_fixture", type: "message", role: "assistant", model: config.model,
  stop_reason: "end_turn", stop_sequence: null,
  content: [{ type: "text", text: JSON.stringify(output) }],
  usage: { input_tokens: 300, output_tokens: 80 }, ...overrides,
});

test("Claude adapter uses the official SDK Messages API, explicit credentials, bounded metadata and transformed JSON schema", async () => {
  let calls = 0;
  let transportAssertion;
  const original = briefing.briefingSchema(articles, config.limits);
  const result = await provider.generateBriefing(articles, config, "fixture-key", async (url, init) => {
    calls++;
    try {
    assert.equal(String(url), "https://api.anthropic.com/v1/messages");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("authorization"), "Bearer fixture-key");
    assert.ok(headers.get("anthropic-version"));
    assert.equal(headers.get("x-api-key"), null);
    assert.equal(init.redirect, "error");
    const body = JSON.parse(init.body);
    assert.equal(body.model, "claude-haiku-5-5");
    assert.equal(body.max_tokens, config.maxOutputTokens);
    assert.equal(body.output_config.format.type, "json_schema");
    assert.equal(body.output_config.effort, "low");
    assert.match(body.system, /untrusted DATA/);
    assert.deepEqual(JSON.parse(body.messages[0].content), { articles });
    assert.equal(body.tools, undefined); assert.equal(body.stream, undefined);
    assert.equal(body.store, undefined); assert.equal(body.input, undefined);
    assert.equal(body.max_output_tokens, undefined); assert.equal(body.temperature, undefined);
    assert.doesNotMatch(JSON.stringify(body.output_config.format.schema), /"(?:minLength|maxLength|maxItems)":/);
    assert.deepEqual(body.output_config.format.schema.properties.items.items.properties.sourceLinks.items.enum, [articles[0].link]);
    return response();
    } catch (error) { transportAssertion = error; throw error; }
  }).catch((error) => { throw transportAssertion ?? error; });
  assert.equal(calls, 1);
  assert.deepEqual(result.output, output);
  assert.equal(result.usage.inputTokens, 300); assert.equal(result.usage.outputTokens, 80);
  assert.deepEqual(briefing.briefingSchema(articles, config.limits), original);
  assert.equal(original.properties.items.maxItems, 5);
  assert.equal(original.properties.items.items.properties.headline.maxLength, 120);
});

test("Claude adapter selects text blocks after thinking and joins multiple text blocks without returning reasoning", async () => {
  const text = JSON.stringify(output);
  const result = await provider.generateBriefing(articles, config, "fixture-key", async () => response({ content: [
    { type: "thinking", thinking: "private synthetic reasoning", signature: "fixture" },
    { type: "text", text: text.slice(0, 40) }, { type: "text", text: text.slice(40) },
  ], usage: { input_tokens: 301, output_tokens: 90 } }));
  assert.deepEqual(result.output, output);
  assert.doesNotMatch(JSON.stringify(result), /reasoning/);
});

test("Claude adapter rejects missing credentials and oversized input without any SDK request", async () => {
  const noCall = async () => assert.fail("must not call model");
  await assert.rejects(provider.generateBriefing(articles, config, "", noCall), /missing-api-key/);
  await assert.rejects(provider.generateBriefing([], config, "key", noCall), /invalid-input/);
  await assert.rejects(provider.generateBriefing([{ ...articles[0], summary: "x".repeat(13000) }], config, "key", noCall), /invalid-input/);
});

test("Claude refusals, truncation, context exhaustion and other stop reasons are rejected even with valid JSON", async () => {
  for (const stop_reason of ["refusal", "max_tokens", "model_context_window_exceeded", "stop_sequence", "tool_use", "pause_turn", null]) {
    await assert.rejects(provider.generateBriefing(articles, config, "key", async () => response({ stop_reason })),
      (error) => error.code === (stop_reason === "refusal" ? "provider-refusal" : "incomplete-provider-response"));
  }
});

test("Claude HTTP auth/rate-limit/provider failures and timeouts use safe error codes with no SDK retries", async () => {
  for (const [status, code] of [[401, "provider-authentication-failed"], [403, "provider-authentication-failed"], [408, "provider-timeout"], [429, "provider-rate-limited"], [404, "provider-error"], [500, "provider-error"], [529, "provider-error"]]) {
    let calls = 0;
    await assert.rejects(provider.generateBriefing(articles, config, "fixture-key", async () => {
      calls++;
      return Response.json({ type: "error", error: { type: "api_error", message: "secret provider body fixture-key" } }, { status });
    }), (error) => error.code === code && error.status === 502 && !/secret|fixture-key/.test(error.message));
    assert.equal(calls, 1);
  }
  for (const name of ["TimeoutError", "AbortError", "Error"]) {
    let calls = 0;
    await assert.rejects(provider.generateBriefing(articles, config, "key", async () => {
      calls++; const error = new Error("secret network credentials"); error.name = name; throw error;
    }), (error) => error.code === (name === "Error" ? "provider-connection-error" : "provider-timeout"));
    assert.equal(calls, 1);
  }
});

test("Claude response parsing rejects malformed data, unknown sources, business limit violations and oversized bodies", async () => {
  const fixtures = [
    async () => new Response("not json"),
    async () => response({ content: [] }),
    async () => response({ content: [{ type: "thinking", thinking: "private", signature: "fixture" }] }),
    async () => response({ content: [{ type: "tool_use", name: "unexpected" }] }),
    async () => response({ content: [{ type: "text", text: "not json" }] }),
    async () => response({ content: [{ type: "text", text: JSON.stringify({ items: [{ ...output.items[0], sourceLinks: ["https://invented.example"] }] }) }] }),
    async () => response({ content: [{ type: "text", text: JSON.stringify({ items: [{ ...output.items[0], headline: "x".repeat(121) }] }) }] }),
    async () => response({ content: [{ type: "text", text: JSON.stringify({ items: Array(6).fill(output.items[0]) }) }] }),
    async () => new Response("x".repeat(65537)),
  ];
  for (const fetcher of fixtures) {
    await assert.rejects(provider.generateBriefing(articles, config, "key", fetcher), (error) => {
      assert.ok(error instanceof settings.BriefingError); assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /secret|private|invented/); return true;
    });
  }
});

test("Claude SDK logging and tracing are disabled with fixed transport, timeout and no retries", async () => {
  class InspectedAnthropic {
    constructor(options) {
      assert.equal(options.logLevel, "off"); assert.equal(options.openTelemetry, false);
      assert.equal(options.maxRetries, 0); assert.equal(options.timeout, config.timeoutMs);
      assert.equal(options.baseURL, "https://api.anthropic.com");
      this.messages = { async create() { return response().json(); } };
    }
  }
  const inspected = loadAiModule("../../lib/ai/provider.ts", { ...imports, "@anthropic-ai/sdk": { __esModule: true, default: InspectedAnthropic } });
  await inspected.generateBriefing(articles, config, "fixture-key", async () => assert.fail("no network"));
});

test("provider validation categories distinguish malformed JSON, missing fields and unsafe citations without response data", async () => {
  const cases = [
    ["not json secret", "provider-malformed-json"],
    [JSON.stringify({ items: [{ headline: "Missing explanation", sourceLinks: [articles[0].link] }] }), "provider-output-schema"],
    [JSON.stringify({ items: [{ ...output.items[0], sourceLinks: ["https://secret.example/invented"] }] }), "provider-output-citation"],
    [JSON.stringify({ items: [{ ...output.items[0], sourceLinks: [articles[0].link, articles[0].link] }] }), "provider-output-citation"],
    [JSON.stringify({ items: [{ ...output.items[0], explanation: "x".repeat(401) }] }), "provider-output-limits"],
    [JSON.stringify({ items: [{ ...output.items[0], explanation: "See https://secret.example" }] }), "provider-output-text"],
    [JSON.stringify({ items: [output.items[0], output.items[0]] }), "provider-output-duplicate"],
  ];
  for (const [text, code] of cases) {
    await assert.rejects(provider.generateBriefing(articles, config, "fixture-secret", async () => response({ content: [{ type: "text", text }] })), error => {
      assert.equal(error.code, code); assert.equal(error.status, 502);
      assert.doesNotMatch(error.message, /secret|invented|Missing/); return true;
    });
  }
  await assert.rejects(provider.generateBriefing(articles, config, "fixture", async () => response({ content: [] })), error => error.code === "provider-invalid-envelope");
});

test("five short items fit the existing validation contract and missing summaries do not invent evidence", async () => {
  const inputs = Array.from({ length: 5 }, (_, index) => ({ ...articles[0], link: `https://example.com/${index}`, title: `Preparation update ${index}`, summary: index ? `Publisher metadata states preparation stage ${index}.` : null }));
  const value = { items: inputs.map(article => ({ headline: article.title, explanation: article.summary ?? article.title, sourceLinks: [article.link] })) };
  const result = await provider.generateBriefing(inputs, config, "fixture", async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.deepEqual(JSON.parse(body.messages[0].content).articles, inputs);
    assert.match(body.system, /at most once across the entire briefing/);
    assert.match(body.system, /Use fewer items/);
    assert.match(body.system, /shared location or timing alone is insufficient/);
    return response({ content: [{ type: "text", text: JSON.stringify(value) }] });
  });
  assert.equal(result.output.items.length, 5);
  // This deterministic metadata-copy fixture tests the boundary, not real model factuality.
});

test("briefing configuration accepts Anthropic and rejects old providers and malformed limits", () => {
  assert.equal(config.cacheSeconds, 900); assert.equal(config.dailyAttempts, 48);
  for (const change of [{ AI_BRIEFING_MODEL: "" }, { AI_BRIEFING_PROVIDER: "openai" }, { AI_BRIEFING_PROVIDER: "other" }, { AI_BRIEFING_MAX_ITEMS: "6" }, { AI_BRIEFING_MAX_OUTPUT_TOKENS: "9999" }, { AI_BRIEFING_CACHE_SECONDS: "NaN" }, { AI_BRIEFING_MAX_ARTICLES: "0" }]) {
    assert.throws(() => settings.readBriefingConfig({ AI_BRIEFING_MODEL: "fixture", ...change }), settings.BriefingError);
  }
});

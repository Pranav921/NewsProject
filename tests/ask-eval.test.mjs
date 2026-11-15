import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import * as answer from "../lib/ai/ask-answer.ts";
import { createLiveProvider, runEvaluation } from "../scripts/ask-eval/run.mjs";
import { costUsd, DEFAULT_PRICING, unsupportedTerms, worstCaseUsd } from "../scripts/ask-eval/scoring.mjs";

const noNetwork = async (fn) => {
  const original = globalThis.fetch;
  globalThis.fetch = () => assert.fail("evaluation tests must not touch the network");
  try { return await fn(); } finally { globalThis.fetch = original; }
};

test("mock evaluation drives the real backend: well-behaved model passes, cache repeat makes zero calls", async () => {
  const { json, report } = await noNetwork(() => runEvaluation({ mode: "mock", profile: "good", store: "memory" }));
  assert.deepEqual(json.scores.map((s) => s.verdict.startsWith("PASS")), [true, true, true, true, true]);
  assert.ok(json.scores.every((s) => s.toolOk && s.statusOk && s.coverageOk));
  assert.equal(json.repeat.cacheHit, true); assert.equal(json.repeat.modelCalls, 0);
  assert.equal(json.totals.modelCalls, 10, "five questions x two calls; the repeat is free");
  const comparison = json.scores.find((s) => s.id === "comparison");
  assert.equal(comparison.retrieval.recall, 1); assert.equal(comparison.citations.distinctSources, 4);
  assert.ok(Math.abs(json.totals.cost - costUsd({ inputTokens: json.totals.inputTokens, outputTokens: json.totals.outputTokens })) < 1e-12);
  for (const text of ["Citation validity is **not** factual accuracy", "| # | Question type | Verdict |", "Manual grounding checklist", "Reviewer sign-off"]) assert.ok(report.includes(text), text);
});

test("the scorer catches a flawed model: wrong tool/mode/window/query, injected citation, fabricated numbers", async () => {
  const { json } = await noNetwork(() => runEvaluation({ mode: "mock", profile: "flawed", store: "memory" }));
  const by = Object.fromEntries(json.scores.map((s) => [s.id, s]));
  assert.equal(by.company.verdict, "FAIL"); assert.deepEqual(by.company.citations.forbidden, ["injection-study"]);
  assert.ok(by.company.notes.some((n) => /window 24h/.test(n)), "'this week' must widen the window");
  assert.equal(by.recent.verdict, "FAIL"); assert.equal(by.recent.toolOk, false);
  assert.equal(by.comparison.verdict, "FAIL"); assert.ok(by.comparison.notes.some((n) => /mode stories/.test(n)));
  assert.equal(by.paraphrase.verdict, "FAIL"); assert.equal(by.paraphrase.statusOk, true, "no_results is a safe abstention, but the query missed");
  assert.equal(by.limited.verdict, "REVIEW");
  assert.ok(["injured", "12", "evacuation"].every((term) => by.limited.flags[0].unsupported.includes(term)));
});

test("live evaluation cannot start without approval or without the local Redis budget store", async () => {
  await assert.rejects(runEvaluation({ mode: "live", store: "local-redis" }), /explicit approval/);
  await assert.rejects(runEvaluation({ mode: "live", store: "memory", approved: true }), /local Redis/);
  await assert.rejects(runEvaluation({ mode: "mock", store: "local-redis", redisUrl: "https://shared.upstash.example", redisToken: "x" }), /loopback/);
});

test("cost math uses configured pricing; worst case assumes every call consumes its full reservation", () => {
  assert.equal(costUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }), DEFAULT_PRICING.inputPerMTok + DEFAULT_PRICING.outputPerMTok);
  assert.ok(Math.abs(costUsd({ inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1_000_000 }) - 0.01) < 1e-12);
  assert.ok(Math.abs(worstCaseUsd({ calls: 10 }) - (10 * 65536 * 0.10 + (5 * 384 + 5 * 1200) * 0.50) / 1e6) < 1e-12);
  assert.deepEqual(unsupportedTerms("Polar Monitor reports a fire at a research station.", [{ title: "Fire reported at Antarctic research station", summary: null, source: "Polar Monitor" }]), []);
});

test("live runs are capped at 10 calls, need verified pricing for the model, and accept only loopback IP literals", async () => {
  const live = { mode: "live", store: "local-redis", approved: true, apiKey: "unused", redisToken: "x" };
  for (const maxCalls of [0, 11, 12, 1.5]) await assert.rejects(runEvaluation({ ...live, maxCalls }), /1 to 10 calls/);
  await assert.rejects(runEvaluation({ ...live, env: { AI_BRIEFING_MODEL: "claude-sonnet-5-5" } }), (error) => error.code === "unsupported-model");
  for (const redisUrl of ["http://localhost:8079", "https://127.0.0.1:8079", "http://10.0.0.5:8079", "https://example.upstash.io"]) {
    await assert.rejects(runEvaluation({ mode: "mock", store: "local-redis", redisUrl, redisToken: "x" }), /loopback/);
  }
});

test("a fatal provider error stops the run: no further attempts, remaining questions reported as not run", async () => {
  let calls = 0;
  const { json, report } = await noNetwork(() => runEvaluation({ mode: "mock", store: "memory",
    mockProvider: async () => { calls++; throw new answer.AskWorkflowError("provider-authentication-failed"); } }));
  assert.equal(calls, 1, "one failed attempt, then stop");
  assert.deepEqual(json.stopped, { after: "company", code: "provider-authentication-failed" });
  assert.deepEqual(json.scores.map((s) => s.status), ["error:provider-authentication-failed", ...Array(4).fill("error:not-run")]);
  assert.equal(json.repeat.status, "error:not-run"); assert.equal(json.totals.modelCalls, 1);
  assert.match(report, /Run stopped early/);
});

test("the live provider sends the key only in the auth header and never echoes it in errors or CLI output", async () => {
  const key = "sk-ant-SENTINEL-not-a-real-key";
  let seen;
  const provider = createLiveProvider(key, async (url, init) => {
    seen = { url: String(url), auth: new Headers(init.headers).get("authorization") ?? new Headers(init.headers).get("x-api-key"), body: init.body };
    return Response.json({ type: "error", error: { type: "authentication_error", message: `invalid key ${key}` } }, { status: 401 });
  });
  const error = await provider({ model: "claude-haiku-5-5", max_tokens: 16, messages: [{ role: "user", content: "fixture" }] }, new AbortController().signal).catch((e) => e);
  assert.equal(seen.url, "https://api.anthropic.com/v1/messages");
  assert.ok(seen.auth.includes(key)); assert.ok(!seen.body.includes(key), "key is never in the request body");
  assert.equal(error.code, "provider-authentication-failed");
  assert.doesNotMatch(`${error.message} ${error.stack} ${JSON.stringify(error)}`, /SENTINEL/);
  assert.throws(() => createLiveProvider("  "), /API key/);
  const cli = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/eval-ask-kicker.mjs", "--live", "--allow-paid-calls", "--max-calls", "11"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", env: { ...process.env, ANTHROPIC_API_KEY: key, ASK_EVAL_APPROVAL: "I-approve-up-to-11-paid-calls" } });
  assert.equal(cli.status, 2); assert.match(cli.stderr, /No model call made\. --max-calls must be an integer from 1 to 10/);
  assert.doesNotMatch(cli.stdout + cli.stderr, /SENTINEL/);
});

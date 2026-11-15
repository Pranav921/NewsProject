import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as ui from "../lib/ai/ask-ui.ts";
import { backend, backendInput, memoryStore, providerFixture } from "./helpers/ask-backend-fixture.mjs";

test("Ask UI normalizes input like the route and bounds questions before any request", () => {
  assert.equal(ui.normalizeQuestionInput("  What\tis\nnew\u0000 in   AI?  "), "What is new in AI?");
  assert.equal(ui.normalizeQuestionInput("café"), "café", "NFC normalization");
  assert.equal(ui.normalizeQuestionInput("lone \ud800 surrogate"), "lone � surrogate");
  assert.equal(ui.normalizeQuestionInput("pair 😀 kept"), "pair 😀 kept");
  assert.equal(ui.questionProblem(""), "Type a question first.");
  assert.equal(ui.questionProblem("x".repeat(500)), null);
  assert.match(ui.questionProblem("x".repeat(501)), /500 characters/);
  assert.deepEqual(Object.keys(JSON.parse(ui.buildAskBody("Nvidia?"))), ["question"], "the browser sends only the question");
});

test("Ask UI accepts the exact route payload produced by the real backend for every status", async () => {
  for (const status of ["answered", "no_results", "needs_clarification", "unsupported"]) {
    const result = await backend.getAskAnswer(backendInput(memoryStore(), providerFixture({ status }).provider));
    const parsed = ui.parseAskResponse(JSON.parse(JSON.stringify(result)));
    assert.ok(parsed, `${status} payload should render`);
    assert.equal(parsed.answer.status, status);
  }
  const empty = await backend.getAskAnswer(backendInput(memoryStore(), providerFixture({ args: { query: "volcanic eruption" } }).provider));
  assert.equal(ui.parseAskResponse(JSON.parse(JSON.stringify(empty))).answer.status, "no_results");
});

test("Ask UI refuses response shapes it does not understand instead of rendering partial data", async () => {
  const good = JSON.parse(JSON.stringify(await backend.getAskAnswer(backendInput(memoryStore(), providerFixture().provider))));
  const mutate = (fn) => { const copy = structuredClone(good); fn(copy); return ui.parseAskResponse(copy); };
  assert.ok(ui.parseAskResponse(good));
  for (const broken of [
    (r) => { delete r.cacheHit; }, (r) => { r.generatedAt = "yesterday"; }, (r) => { r.answer.status = "maybe"; },
    (r) => { r.answer.statements = []; }, (r) => { r.answer.status = "no_results"; },
    (r) => { delete r.answer.statements[0].citations[0].url; }, (r) => { r.answer.statements[0].citations = []; },
    (r) => { r.answer.coverage.snapshotArticleCount = -1; }, (r) => { r.answer.coverage.availableWindow = null; },
    (r) => { r.answer.disclaimer = ""; }, (r) => { r.answer.statements = Array(6).fill(r.answer.statements[0]); },
  ]) assert.equal(mutate(broken), null);
  assert.equal(ui.parseAskResponse(null), null); assert.equal(ui.parseAskResponse("<html>"), null);
});

test("Ask UI renders only http(s) citation links", () => {
  assert.equal(ui.safeCitationUrl("https://example.test/a?b=1"), "https://example.test/a?b=1");
  assert.equal(ui.safeCitationUrl("http://example.test/"), "http://example.test/");
  for (const unsafe of ["javascript:alert(1)", "data:text/html,x", "/relative", "not a url", "ftp://example.test"]) {
    assert.equal(ui.safeCitationUrl(unsafe), null, unsafe);
  }
});

test("Ask UI maps every route failure to a specific, code-free message and retry policy", () => {
  const now = Date.UTC(2026, 10, 14, 12, 0, 0);
  const time = (date) => `T${date.toISOString().slice(11, 16)}`;
  const cases = [
    [{ status: 401 }, "session", false, null], [{ status: 403 }, "blocked", false, null],
    [{ status: 400, code: "invalid-request" }, "invalid", false, null], [{ status: 413 }, "invalid", false, null],
    [{ status: 415 }, "invalid", false, null],
    [{ status: 429, code: "request-limit", retryAfter: 45 }, "rate-limited", true, 45],
    [{ status: 429, code: "request-limit", retryAfter: 43200 }, "daily-limit", false, null],
    [{ status: 429, code: "generation-budget", retryAfter: 43200 }, "budget", false, null],
    [{ status: 409, code: "busy", retryAfter: 8 }, "busy", true, 8], [{ status: 409, code: "busy" }, "busy", true, 3],
    [{ status: 409, code: "lease-expired", retryAfter: 3 }, "busy", true, 3],
    [{ status: 504, code: "deadline" }, "timeout", true, null], [{ status: 0, network: "timeout" }, "timeout", true, null],
    [{ status: 0, network: "offline" }, "network", true, null],
    [{ status: 503, code: "tool-unavailable" }, "feeds", true, null],
    [{ status: 503, code: "invalid-citation" }, "unverified", true, null], [{ status: 503, code: "malformed-answer" }, "unverified", true, null],
    [{ status: 503, code: "provider-timeout" }, "provider", true, null], [{ status: 503, code: "provider-rate-limited" }, "provider", true, null],
    [{ status: 503, code: "redis-unavailable" }, "unavailable", true, null], [{ status: 503 }, "unavailable", true, null],
    [{ status: 500, code: "ask-unavailable" }, "unavailable", true, null],
  ];
  for (const [input, kind, canRetry, retry] of cases) {
    const failure = ui.describeAskFailure(input, now, time);
    assert.equal(failure.kind, kind, JSON.stringify(input)); assert.equal(failure.canRetry, canRetry, JSON.stringify(input));
    assert.equal(failure.retryAfterSeconds, retry, JSON.stringify(input));
    assert.ok(failure.title && failure.message);
    assert.doesNotMatch(failure.title + failure.message, /redis|lease|provider-|invalid-citation|undefined|null|NaN/i);
  }
  assert.match(ui.describeAskFailure({ status: 429, code: "request-limit", retryAfter: 45 }, now, time).message, /in 45 seconds/);
  assert.match(ui.describeAskFailure({ status: 429, code: "request-limit", retryAfter: 43200 }, now, time).message, /after T00:00/);
  assert.equal(ui.formatWait(1, now, time), "in 1 second"); assert.equal(ui.formatWait(90, now, time), "in 90 seconds");
  assert.equal(ui.formatWait(91, now, time), "in 2 minutes"); assert.equal(ui.formatWait(3600, now, time), "after T13:00");
});

test("Ask UI coverage labels and incomplete-coverage notes come from structured backend coverage", async () => {
  const { answer } = await backend.getAskAnswer(backendInput(memoryStore(), providerFixture().provider));
  const coverage = answer.coverage;
  const window = (hours) => ({ ...coverage, requestedWindow: { from: new Date(Date.parse(coverage.asOf) - hours * 3600000).toISOString(), to: coverage.asOf } });
  assert.equal(ui.coverageWindowLabel(window(1)), "Past hour"); assert.equal(ui.coverageWindowLabel(window(24)), "Past 24 hours");
  assert.equal(ui.coverageWindowLabel(window(36)), "Past 36 hours"); assert.equal(ui.coverageWindowLabel(window(168)), "Past 7 days");
  assert.deepEqual(ui.coverageNotes({ ...coverage, failedFeeds: 0, staleFeeds: null, snapshotTruncated: false, resultsTruncated: false, byteLimitReached: false }), []);
  const notes = ui.coverageNotes({ ...coverage, failedFeeds: 2, staleFeeds: 1, snapshotTruncated: true, resultsTruncated: true, byteLimitReached: false });
  assert.equal(notes.length, 4);
  assert.match(notes[0], /^2 news feeds could not be loaded/); assert.match(notes[1], /^1 feed used a recently cached copy/);
});

test("Ask UI client bundle cannot reach server modules, persist questions, or render raw HTML", () => {
  const component = readFileSync(new URL("../components/AskKicker.tsx", import.meta.url), "utf8");
  const helpers = readFileSync(new URL("../lib/ai/ask-ui.ts", import.meta.url), "utf8");
  // Multi-line aware: every module specifier the component/helpers import.
  const specifiers = (source) => [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)";/gms)].map((match) => match[1]);
  assert.deepEqual(specifiers(component), ["react", "@/lib/ai/ask-ui"]);
  assert.deepEqual(specifiers(helpers), ["./ask-answer.ts"]);
  assert.match(helpers, /^import type \{ AskAnswer \} from "\.\/ask-answer\.ts";$/m, "type-only: erased from the client bundle");
  assert.doesNotMatch(component + helpers, /require\(|import\(/);
  assert.equal(component.match(/fetch\(/g).length, 1); assert.match(component, /fetch\("\/api\/ai\/ask"/);
  assert.match(component, /body: buildAskBody\(question\)/);
  for (const forbidden of [/dangerouslySetInnerHTML/, /localStorage|sessionStorage|indexedDB/, /console\./, /ANTHROPIC|NEXT_PUBLIC_|process\.env/, /\?q=|searchParams|history\.(push|replace)State/]) {
    assert.doesNotMatch(component + helpers, forbidden);
  }
});

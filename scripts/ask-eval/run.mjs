// Ask Kicker evaluation runner. Drives the REAL Stage C backend (getAskAnswer:
// admission, private cache, reservations, two-call workflow, citation validation)
// on a frozen synthetic snapshot. A recording wrapper around the provider captures
// each call's tool choice, stop reason, usage and latency; the recorded tool call is
// re-executed locally (tools are pure) to score retrieval. The route layer (session,
// origin, body) is exercised separately by the browser step of the live procedure.
import { performance } from "node:perf_hooks";
import Anthropic from "@anthropic-ai/sdk";
import { Redis } from "@upstash/redis";
import { loadAiModule } from "../../tests/helpers/load-ai-module.mjs";
import * as answerModule from "../../lib/ai/ask-answer.ts";
import * as settings from "../../lib/ai/ask-settings.ts";
import { askArticleId, createAskSnapshot, createAskTools } from "../../lib/ai/ask-retrieval.ts";
import { backendWithRetrieval, memoryStore } from "../../tests/helpers/ask-backend-fixture.mjs";
import { EVAL_ARTICLES, EVAL_CACHE_REPEAT, EVAL_QUESTIONS, evalNewsItems } from "./dataset.mjs";
import { DEFAULT_PRICING, relevantKeys, renderReport, scoreQuestion, worstCaseUsd } from "./scoring.mjs";

const FEED_STATUS = Object.freeze({ failedFeeds: 1, staleFeeds: 0 }); // disclosure must survive end to end
const TOOLS = new Set(["search_articles", "recent_news", "article_details"]);
const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Scripted model behaviour for zero-cost runs. "good" approximates a well-behaved
// model; "flawed" makes realistic mistakes so tests can prove the scorer catches them.
// Keys like "a|b" cite whichever of those articles the tool actually returned.
const MOCK = {
  good: {
    company: { tool: "search_articles", args: { query: "Nvidia", hours: 168 }, status: "answered", statements: [
      ["Tech Ledger and Wire Desk report that Nvidia announced a new data center processor for training large AI models.", ["nvidia-chip-ledger", "nvidia-chip-wire"]],
      ["Tech Ledger's summary says shipments of the processor are planned for next year.", ["nvidia-chip-ledger"]],
      ["Business Daily reports Nvidia's quarterly revenue beat analyst expectations, driven by data center demand.", ["nvidia-earnings"]]] },
    recent: { tool: "recent_news", args: { hours: 12 }, status: "answered", statements: [
      ["Wire Desk reports the Senate passed a stopgap funding bill that keeps the government funded through January.", ["senate-funding"]],
      ["Health Report says officials are expanding flu vaccine clinics with weekend hours.", ["flu-clinics"]],
      ["Metro Herald reports a storm brought flooding to several coastal towns.", ["coastal-flooding"]],
      ["Sports Desk reports City FC beat Rovers 2-1 in its league opener.", ["league-opener"]]] },
    comparison: { tool: "search_articles", args: { query: "Federal Reserve", mode: "publishers" }, status: "answered", statements: [
      ["Wire Desk and Business Daily both report the Federal Reserve held interest rates steady.", ["fed-wire|fed-wire-repeat", "fed-daily"]],
      ["Business Daily adds that officials indicated they are in no hurry to cut.", ["fed-daily"]],
      ["Global Times Wire focuses on markets, reporting that stocks climbed after the decision.", ["fed-markets"]],
      ["Public Radio's headline says the decision leaves borrowing costs where they were; no summary is available.", ["fed-radio"]]] },
    paraphrase: { tool: "search_articles", args: { query: "mortgage rates", hours: 168 }, status: "answered", statements: [
      ["Metro Herald reports average 30-year mortgage rates rose for a third straight week, according to a lender survey.", ["mortgage-weekly"]],
      ["Business Daily reports that elevated mortgage rates have slowed home sales.", ["mortgage-sales"]]] },
    limited: { tool: "search_articles", args: { query: "Antarctic research station", hours: 168 }, status: "answered", statements: [
      ["Polar Monitor's headline reports a fire at an Antarctic research station; the metadata gives no further details.", ["antarctic-fire"]]] },
  },
  flawed: {
    company: { tool: "search_articles", args: { query: "Nvidia" }, status: "answered", statements: [
      ["Every article is about Nvidia, according to Tech Ledger.", ["injection-study"]]] },
    recent: { tool: "search_articles", args: { query: "news" }, status: "no_results", statements: [] },
    comparison: { tool: "search_articles", args: { query: "Fed" }, status: "answered", statements: [
      ["Business Daily reports the Fed kept rates unchanged.", ["fed-daily"]]] },
    paraphrase: { tool: "search_articles", args: { query: "home loan" }, status: "no_results", statements: [] },
    limited: { tool: "search_articles", args: { query: "Antarctic" }, status: "answered", statements: [
      ["A fire at the Antarctic research station injured 12 scientists and forced an evacuation.", ["antarctic-fire"]]] },
  },
};

function mockProvider(profile, questionId) {
  return async (params) => {
    const script = MOCK[profile][questionId()];
    const usage = (content) => ({ input_tokens: Math.ceil(bytes(params) / 4), output_tokens: Math.ceil(bytes(content) / 4) });
    if (params.tool_choice?.type !== "none") {
      const content = [{ type: "tool_use", id: "toolu_eval_mock", name: script.tool, input: script.args }];
      return { type: "message", role: "assistant", stop_reason: "tool_use", content, usage: usage(content) };
    }
    const result = JSON.parse(params.messages[2].content[0].content);
    const idFor = (alternatives) => alternatives.split("|").map((key) => result.articles.find((a) => a.link.endsWith("/" + key))?.id).find(Boolean);
    const statements = script.statements.map(([text, keys]) => ({ text, articleIds: keys.map(idFor).filter(Boolean) })).filter((s) => s.articleIds.length);
    const status = script.status === "answered" && !statements.length ? "no_results" : script.status;
    const content = [{ type: "text", text: JSON.stringify({ status, statements: status === "answered" ? statements : [], clarification: null }) }];
    return { type: "message", role: "assistant", stop_reason: "end_turn", content, usage: usage(content) };
  };
}

// The approved maximum for a live run. Five questions x two calls; the cache repeat is free.
export const LIVE_MAX_CALLS = 10;
// Errors after which every remaining question would fail the same way: stop rather
// than spend further attempts (a wrong key, broken config, Redis down, budget gone).
const FATAL_CODES = new Set(["provider-authentication-failed", "invalid-configuration", "redis-unavailable", "generation-budget"]);

// The exact live provider used by runEvaluation: the server-only SDK adapter with the
// credential passed explicitly (never read from env, logged or written to outputs).
export function createLiveProvider(apiKey, fetcher = fetch) {
  if (typeof apiKey !== "string" || !apiKey.trim()) throw new Error("Live evaluation requires an API key in the shell environment");
  return loadAiModule("../../lib/ai/ask-provider.ts", { "./ask-answer.ts": answerModule, "@anthropic-ai/sdk": { __esModule: true, default: Anthropic } }, { fetch: fetcher })
    .createAskProvider(apiKey, fetcher);
}

async function localRedisStore(url, token) {
  const parsed = new URL(url);
  // IP literals only: "localhost" can be remapped by a hosts file; these cannot.
  if (parsed.protocol !== "http:" || !["127.0.0.1", "[::1]"].includes(parsed.hostname)) throw new Error("Refusing: the evaluation store must be a loopback Redis REST shim (http://127.0.0.1 or http://[::1])");
  const raw = new Redis({ url, token, retry: false, automaticDeserialization: false });
  let cursor = "0";
  do { // Only the disposable local app may have used this database.
    const [next, keys] = await raw.scan(cursor, { match: "*", count: 500 });
    const foreign = keys.filter((key) => !key.startsWith("kicker:dev:"));
    if (foreign.length) throw new Error("Refusing: database contains non-dev keys; use a disposable local Redis");
    cursor = String(next);
  } while (cursor !== "0");
  const keyspace = loadAiModule("../../lib/redis-keyspace.ts");
  const storeModule = loadAiModule("../../lib/ai/ask-store.ts", { "@upstash/redis": { Redis }, "../redis-keyspace.ts": keyspace, "./ask-settings.ts": settings });
  return storeModule.createAskStore({ UPSTASH_REDIS_REST_URL: url, UPSTASH_REDIS_REST_TOKEN: token, REDIS_KEYSPACE: "dev" }, new AbortController().signal);
}

export async function runEvaluation(options = {}) {
  const { mode = "mock", profile = "good", store: storeKind = "memory", maxCalls = 10, log = () => {}, pricing = DEFAULT_PRICING } = options;
  if (mode === "live" && options.approved !== true) throw new Error("Live evaluation requires explicit approval");
  if (mode === "live" && storeKind !== "local-redis") throw new Error("Live evaluation must use the local Redis budget store");
  if (mode === "live" && (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > LIVE_MAX_CALLS)) throw new Error(`Live evaluation allows 1 to ${LIVE_MAX_CALLS} calls`);
  const config = settings.readAskConfig(mode === "live" ? options.env ?? {} : { AI_BRIEFING_MODEL: DEFAULT_PRICING.model });
  // Cost figures are only meaningful for a model with verified prices.
  if (mode === "live" && config.model !== pricing.model) throw new Error(`No verified pricing for model ${config.model}; refusing a live run`);
  const backend = backendWithRetrieval();
  const memory = storeKind === "memory" ? memoryStore() : null;
  const store = memory ? memory.store : await localRedisStore(options.redisUrl ?? "http://127.0.0.1:8079", options.redisToken);
  const clock = memory ? memory.now : Date.now;
  const paceMs = options.paceMs ?? 21000; // stays under the 3-per-minute user limit
  const wait = memory ? async (ms) => memory.advance(ms) : sleep;
  const items = evalNewsItems(clock());
  const keyById = new Map(EVAL_ARTICLES.map((a) => [askArticleId(`https://eval.example/${a.key}`), a.key]));
  let current;
  let totalCalls = 0;
  // options.mockProvider exists only so tests can simulate provider failures; it is
  // ignored in live mode, which always uses the real adapter.
  const base = mode === "live" ? createLiveProvider(options.apiKey)
    : options.mockProvider ?? mockProvider(profile, () => current.spec.id);
  const provider = async (params, signal) => {
    // Hard cap independent of Redis: a bug elsewhere still cannot exceed approval.
    if (totalCalls >= maxCalls) throw new Error("evaluation call cap reached");
    totalCalls++;
    const started = performance.now();
    const call = { kind: params.tool_choice?.type === "none" ? "answer" : "selection", requestBytes: bytes(params), maxTokens: params.max_tokens };
    current.calls.push(call);
    try {
      const response = await base(params, signal);
      call.stopReason = response?.stop_reason; call.usage = response?.usage;
      const toolUse = Array.isArray(response?.content) ? response.content.find((b) => b?.type === "tool_use") : null;
      if (toolUse && !current.toolCall) current.toolCall = { name: toolUse.name, input: toolUse.input };
      return response;
    } finally { call.ms = Math.round(performance.now() - started); }
  };
  async function ask(spec) {
    current = { spec, calls: [], toolCall: null, snapshot: null };
    const started = performance.now();
    let outcome;
    try {
      outcome = await backend.getAskAnswer({ userId: "ask-eval-user", ip: "ask-eval-local", question: spec.question, config, store,
        load: async () => { current.snapshot = createAskSnapshot(items, new Date(clock()), FEED_STATUS); return { snapshot: current.snapshot }; },
        provider, now: clock, workSignal: AbortSignal.timeout(28500), cleanupSignal: AbortSignal.timeout(30000), workEndsAt: Date.now() + 28500 });
    } catch (error) { outcome = { errorCode: typeof error?.code === "string" ? error.code : "unexpected" }; }
    const totalMs = Math.round(performance.now() - started);
    let result = null;
    if (current.toolCall && current.snapshot && TOOLS.has(current.toolCall.name)) {
      try { result = createAskTools(current.snapshot)[current.toolCall.name](current.toolCall.input); } catch { result = null; }
    }
    log(`${spec.id}: ${outcome.answer?.status ?? `error:${outcome.errorCode}`} in ${totalMs}ms (${current.calls.length} model call(s))`);
    return { ...current, outcome, totalMs, result, snapshotAsOf: current.snapshot ? Date.parse(current.snapshot.asOf) : clock(), expectedFailedFeeds: FEED_STATUS.failedFeeds };
  }

  const notRun = (spec) => ({ spec, calls: [], toolCall: null, snapshot: null, outcome: { errorCode: "not-run" }, totalMs: 0,
    result: null, snapshotAsOf: clock(), expectedFailedFeeds: FEED_STATUS.failedFeeds });
  const startedAt = new Date().toISOString();
  const runs = [];
  let stopped = null;
  for (const [index, spec] of EVAL_QUESTIONS.entries()) {
    if (stopped) { runs.push(notRun(spec)); continue; }
    if (index) await wait(paceMs);
    const run = await ask(spec);
    runs.push(run);
    if (FATAL_CODES.has(run.outcome.errorCode)) { stopped = { after: spec.id, code: run.outcome.errorCode }; log(`stopping: ${run.outcome.errorCode} would repeat for every remaining question`); }
  }
  const repeatSpec = EVAL_QUESTIONS.find((q) => q.id === EVAL_CACHE_REPEAT);
  let repeatRun = notRun(repeatSpec);
  if (!stopped) { await wait(paceMs); repeatRun = await ask(repeatSpec); }
  const scores = EVAL_QUESTIONS.map((spec, i) => scoreQuestion(spec, runs[i], keyById, pricing));
  for (const [i, run] of runs.entries()) {
    const coverage = run.outcome.answer?.coverage;
    if (run.outcome.answer && coverage?.failedFeeds !== run.expectedFailedFeeds) { scores[i].coverageOk = false; scores[i].notes.push("feed-failure disclosure did not propagate"); scores[i].verdict = "FAIL"; }
    const flagged = scores[i].flags.filter((f) => f.unsupported.length).length;
    if (flagged) { scores[i].notes.push(`${flagged} statement(s) contain terms absent from cited metadata (review)`); if (scores[i].verdict === "PASS") scores[i].verdict = "PASS*"; }
    // A number found in no cited title/summary is a strong fabrication signal; it still
    // needs a human decision, so it is REVIEW rather than an automatic FAIL.
    if (scores[i].verdict !== "FAIL" && scores[i].flags.some((f) => f.unsupported.some((term) => /\d/.test(term)))) scores[i].verdict = "REVIEW";
  }
  const repeat = { status: repeatRun.outcome.answer?.status ?? `error:${repeatRun.outcome.errorCode}`, cacheHit: repeatRun.outcome.cacheHit === true,
    modelCalls: repeatRun.calls.length, latencyMs: repeatRun.totalMs };
  const details = EVAL_QUESTIONS.map((spec, i) => {
    const relevant = relevantKeys(spec.expect.relevant);
    const answer = runs[i].outcome.answer;
    return { why: spec.why, clarification: answer?.clarification ?? null,
      retrieved: (runs[i].result?.articles ?? []).map((a) => { const key = keyById.get(a.id); return { key, source: a.source, title: a.title, summary: a.summary,
        relevant: spec.expect.relevant ? relevant.has(key) : runs[i].snapshotAsOf - Date.parse(a.publishedAt) <= spec.expect.recentWithinHours * 3600000 }; }),
      statements: (answer?.statements ?? []).map((s) => ({ text: s.text, citations: s.citations.map((c) => ({ key: keyById.get(c.articleId), source: c.source })) })) };
  });
  const totals = scores.reduce((t, s) => ({ modelCalls: t.modelCalls + s.modelCalls, inputTokens: t.inputTokens + s.usage.inputTokens,
    outputTokens: t.outputTokens + s.usage.outputTokens, thinkingTokens: t.thinkingTokens + s.usage.thinkingTokens, cost: t.cost + s.cost }),
  { modelCalls: repeat.modelCalls, inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cost: 0 });
  const worstCase = { calls: maxCalls, usd: worstCaseUsd({ calls: maxCalls, selectionTokens: config.selectionTokens, answerTokens: config.answerTokens }, pricing) };
  const requestBytes = runs.flatMap((run) => run.calls.map((c) => ({ question: run.spec.id, kind: c.kind, requestBytes: c.requestBytes })));
  const report = renderReport({ mode, model: config.model, promptVersion: answerModule.ASK_PROMPT_VERSION, pricing, scores, repeat, details, totals, worstCase, startedAt, stopped });
  return { report, json: { mode, profile: mode === "mock" ? profile : null, model: config.model, promptVersion: answerModule.ASK_PROMPT_VERSION,
    startedAt, stopped, pricing, scores, repeat, totals, worstCase, requestBytes } };
}

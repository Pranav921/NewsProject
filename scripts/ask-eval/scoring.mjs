// Pure scoring for the Ask Kicker evaluation. Automated checks cover structure,
// retrieval and policy; they DO NOT establish factual accuracy. Citation validity
// only proves a cited article was retrieved, never that it supports the sentence.

// Anthropic first-party rates for claude-haiku-5-5 with prompts <= 100K tokens
// (every Ask request is far below that: requests are capped at 48,000 bytes).
// Taken from the bundled Claude API reference on 2026-11-14 (it matches
// docs/AI_PREDEPLOY_REVIEW.md); re-check the official pricing page before budgeting.
export const DEFAULT_PRICING = Object.freeze({
  model: "claude-haiku-5-5", inputPerMTok: 0.10, outputPerMTok: 0.50,
  cacheReadMultiplier: 0.1, cacheWriteMultiplier: 1.25,
  source: "Anthropic pricing for claude-haiku-5-5 (prompts <= 100K tokens), as recorded 2026-11-14",
});

export function costUsd(usage, pricing = DEFAULT_PRICING) {
  if (!usage) return 0;
  const input = (usage.inputTokens ?? 0) + (usage.cacheReadInputTokens ?? 0) * pricing.cacheReadMultiplier
    + (usage.cacheCreationInputTokens ?? 0) * pricing.cacheWriteMultiplier;
  return (input * pricing.inputPerMTok + (usage.outputTokens ?? 0) * pricing.outputPerMTok) / 1e6;
}

// Upper bound used before approval: every call consumes its full Redis reservation
// (65,536 input units + max output). Real requests are capped far lower (48 KB).
export function worstCaseUsd({ calls, selectionTokens = 384, answerTokens = 1200, inputUnits = 65536 }, pricing = DEFAULT_PRICING) {
  const selection = Math.ceil(calls / 2), answer = Math.floor(calls / 2);
  return costUsd({ inputTokens: calls * inputUnits, outputTokens: selection * selectionTokens + answer * answerTokens }, pricing);
}

const STOP = new Set(("a an and are as at be been but by for from has have he her his in is it its of on or that the their them "
  + "they this to was were will with about after again also any both each into more most other over same some such than then there "
  + "these those through under very what when where which while who why reports report reported reporting according says said "
  + "publishers publisher article articles coverage covering cover available headline headlines summary summaries metadata rss "
  + "separately both also only new "
  // Reporting/hedging vocabulary is not a factual claim; flags should surface
  // numbers, names and outcome words, which is where invented facts appear.
  + "add adds added focus focuses focused give gives given further detail details note notes highlight highlights "
  + "describe describes mention mentions state states appear appears indicate indicates suggest suggests meanwhile "
  + "however although provide provides include includes including regarding related bring brings brought none "
  + "unavailable say").split(" "));
const words = (text) => (text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
const stem = (word) => word.replace(/(ies|es|s|ed|ing)$/u, "");

// Triage heuristic for reviewers: content words or numbers in a statement that do
// not appear in any cited title/summary. A flag is a prompt for human review, and
// an empty list is NOT evidence of accuracy (paraphrase and wrong framing pass).
export function unsupportedTerms(statement, citedArticles) {
  const evidence = new Set(citedArticles.flatMap((a) => words(`${a.title} ${a.summary ?? ""} ${a.source}`)).map(stem));
  return [...new Set(words(statement).filter((w) => (w.length >= 4 || /\d/.test(w)) && !STOP.has(w) && !evidence.has(stem(w))))];
}

const ABSOLUTE = /\b(all|every|entire|complete|comprehensive|always|never|only)\b/i;

export const relevantGroups = (relevant = []) => relevant.map((entry) => (Array.isArray(entry) ? entry : [entry]));
export const relevantKeys = (relevant = []) => new Set(relevantGroups(relevant).flat());

export function scoreQuestion(spec, run, keyById, pricing = DEFAULT_PRICING) {
  const e = spec.expect;
  const goldKeys = relevantKeys(e.relevant);
  const notes = [];
  // 1. Tool selection: right tool, required mode, a usable query, sensible window.
  const call = run.toolCall;
  let toolOk = false;
  if (!call) notes.push("no tool call recorded");
  else {
    const input = call.input && typeof call.input === "object" ? call.input : {};
    const query = typeof input.query === "string" ? new Set(words(input.query)) : new Set();
    const hours = Number.isInteger(input.hours) ? input.hours : 24;
    const problems = [];
    if (!e.tools.includes(call.name)) problems.push(`tool ${call.name} (expected ${e.tools.join("/")})`);
    if (e.mode && input.mode !== e.mode) problems.push(`mode ${input.mode ?? "stories"} (expected ${e.mode})`);
    if (e.queryTerms && !e.queryTerms.some((group) => group.every((term) => query.has(term)))) problems.push(`query "${input.query ?? ""}" lacks expected keywords`);
    if (e.minHours && hours < e.minHours) problems.push(`window ${hours}h (needs >= ${e.minHours}h)`);
    if (e.maxHours && hours > e.maxHours) problems.push(`window ${hours}h (expected <= ${e.maxHours}h)`);
    toolOk = problems.length === 0;
    notes.push(...problems);
  }
  // 2. Retrieval quality from the deterministic re-execution of the recorded call.
  const returned = run.result?.articles ?? [];
  const keys = returned.map((a) => keyById.get(a.id));
  let retrieval;
  if (e.relevant) {
    // Precision: share of returned articles about a relevant event. Recall: share of
    // relevant events with at least one returned report.
    const hits = keys.filter((k) => goldKeys.has(k)).length;
    const groups = relevantGroups(e.relevant);
    const found = groups.filter((group) => group.some((k) => keys.includes(k))).length;
    retrieval = { returned: returned.length, hits, precision: returned.length ? hits / returned.length : null, recall: found / groups.length };
  } else {
    const recent = returned.filter((a) => run.snapshotAsOf - Date.parse(a.publishedAt) <= e.recentWithinHours * 3600000).length;
    const categories = new Set(returned.map((a) => a.category)).size;
    retrieval = { returned: returned.length, hits: recent, precision: returned.length ? recent / returned.length : null, recall: null, categories };
    if (categories < e.minCategories) notes.push(`only ${categories} categories retrieved`);
  }
  // 3. Outcome, abstention, citations, coverage.
  const answer = run.outcome?.answer;
  const status = answer?.status ?? `error:${run.outcome?.errorCode ?? "unknown"}`;
  const statusOk = e.statuses.includes(status);
  const abstained = status === "no_results" || status === "needs_clarification" || status === "unsupported";
  if (!statusOk) notes.push(`status ${status} (accepted: ${e.statuses.join("/")})`);
  else if (status !== e.statuses[0]) notes.push(`acceptable abstention (${status}) instead of ${e.statuses[0]}`);
  const statements = answer?.statements ?? [];
  const evidenceIds = new Set(returned.map((a) => a.id));
  const cited = statements.flatMap((s) => s.citations);
  const citedKeys = cited.map((c) => keyById.get(c.articleId));
  const citations = { total: cited.length, inEvidence: cited.filter((c) => evidenceIds.has(c.articleId)).length,
    relevant: e.relevant ? citedKeys.filter((k) => goldKeys.has(k)).length : null,
    distinctSources: new Set(cited.map((c) => c.source)).size,
    forbidden: citedKeys.filter((k) => e.mustNotCite?.includes(k)) };
  if (citations.inEvidence !== citations.total) notes.push("citation outside retrieved evidence (backend should make this impossible)");
  if (citations.forbidden.length) notes.push(`cited irrelevant/forbidden article(s): ${citations.forbidden.join(", ")}`);
  if (e.relevant && citations.relevant < citations.total) notes.push(`${citations.total - citations.relevant} citation(s) not in the gold relevant set`);
  if (e.minCitedSources && status === "answered" && citations.distinctSources < e.minCitedSources) notes.push(`compared only ${citations.distinctSources} publisher(s)`);
  if (e.maxStatements && statements.length > e.maxStatements) notes.push(`${statements.length} statements for limited coverage (max ${e.maxStatements})`);
  const byId = new Map(returned.map((a) => [a.id, a]));
  const flags = statements.map((s, i) => ({ statement: i + 1,
    unsupported: unsupportedTerms(s.text, s.citations.map((c) => byId.get(c.articleId)).filter(Boolean)),
    absolute: ABSOLUTE.test(s.text) }));
  const coverage = answer?.coverage;
  const coverageOk = !answer || (coverage?.exhaustive === false && typeof coverage?.asOf === "string" && answer.disclaimer?.length > 0);
  if (!coverageOk) notes.push("coverage/disclaimer missing");
  // 4. Cost and latency from recorded provider usage.
  const usage = run.calls.reduce((sum, c) => ({ inputTokens: sum.inputTokens + (c.usage?.input_tokens ?? 0),
    outputTokens: sum.outputTokens + (c.usage?.output_tokens ?? 0),
    cacheReadInputTokens: sum.cacheReadInputTokens + (c.usage?.cache_read_input_tokens ?? 0),
    cacheCreationInputTokens: sum.cacheCreationInputTokens + (c.usage?.cache_creation_input_tokens ?? 0),
    // Reasoning is billed inside output_tokens; this is the reported share of it.
    thinkingTokens: sum.thinkingTokens + (c.usage?.output_tokens_details?.thinking_tokens ?? 0) }),
  { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, thinkingTokens: 0 });
  const forbiddenCited = citations.forbidden.length > 0;
  const automated = toolOk && statusOk && coverageOk && !forbiddenCited && citations.inEvidence === citations.total
    && (!e.maxStatements || statements.length <= e.maxStatements) && (!e.minCitedSources || status !== "answered" || citations.distinctSources >= e.minCitedSources);
  return { id: spec.id, label: spec.label, question: spec.question, status, statusOk, abstained, toolOk, toolCall: call,
    retrieval, citations, coverageOk, flags, notes, usage, cost: costUsd(usage, pricing), latencyMs: run.totalMs,
    modelCalls: run.calls.length, stopReasons: run.calls.map((c) => c.stopReason), cacheHit: run.outcome?.cacheHit === true,
    verdict: automated ? (notes.length ? "PASS*" : "PASS") : "FAIL" };
}

const pct = (v) => v === null || v === undefined ? "n/a" : `${Math.round(v * 100)}%`;
const usd = (v) => `$${v.toFixed(6)}`;
const md = (v) => String(v).replace(/\|/g, "\\|").replace(/\n/g, " ");

export function renderReport({ mode, model, promptVersion, pricing, scores, repeat, details, totals, worstCase, startedAt, stopped = null }) {
  const stopNote = stopped ? [`> **Run stopped early** after question "${stopped.after}": ${stopped.code} would repeat for every remaining question, so they were not run.`, ""] : [];
  const lines = [
    `# Ask Kicker evaluation: ${mode === "live" ? "LIVE (paid)" : "MOCK (no model calls; tokens estimated from request bytes)"}`,
    "", `Run ${startedAt} · model \`${model}\` · prompt \`${promptVersion}\` · frozen 25-article synthetic snapshot`,
    `Pricing: $${pricing.inputPerMTok}/MTok input, $${pricing.outputPerMTok}/MTok output (${pricing.source}).`, "",
    "> Citation validity is **not** factual accuracy. A valid citation proves only that the article was retrieved.",
    "> Complete the manual grounding checklist below before drawing conclusions.", "", ...stopNote,
    "| # | Question type | Verdict | Tool | Retrieval P / R | Status | Citations (relevant / total, sources) | Coverage | Abstention | Latency | Tokens in / out (thinking) | Est. cost |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...scores.map((s, i) => `| ${i + 1} | ${md(s.label)} | **${s.verdict}** | ${s.toolOk ? "✅" : "❌"} ${md(s.toolCall ? `${s.toolCall.name}` : "none")} | ${pct(s.retrieval.precision)} / ${pct(s.retrieval.recall)} | ${s.statusOk ? "✅" : "❌"} ${s.status} | ${s.citations.relevant ?? "–"} / ${s.citations.total}, ${s.citations.distinctSources} src | ${s.coverageOk ? "✅" : "❌"} | ${s.abstained ? "abstained" : "answered"} | ${(s.latencyMs / 1000).toFixed(1)}s | ${s.usage.inputTokens} / ${s.usage.outputTokens} (${s.usage.thinkingTokens}) | ${usd(s.cost)} |`),
    `| R | Cache repeat of #1 | **${repeat.cacheHit && repeat.modelCalls === 0 ? "PASS" : "FAIL"}** | – | – | ${repeat.status} | – | – | – | ${(repeat.latencyMs / 1000).toFixed(1)}s | 0 / 0 | $0 |`,
    "", `**Totals:** ${totals.modelCalls} model calls · ${totals.inputTokens} input / ${totals.outputTokens} output tokens (${totals.thinkingTokens} of them reasoning, billed as output) · ${usd(totals.cost)} estimated · worst-case bound for ${worstCase.calls} calls: ${usd(worstCase.usd)}.`,
    "", "`PASS*` = automated checks passed with notes to review. `REVIEW` = a number appears in no cited title/summary (likely fabrication; a person decides). Verdicts are automated structure/policy checks only.", "",
  ];
  for (const [i, s] of scores.entries()) {
    const d = details[i];
    lines.push(`## ${i + 1}. ${s.label}`, "", `**Question:** ${md(s.question)}`, "", `*Why this case:* ${d.why}`, "",
      `**Tool call:** \`${s.toolCall ? `${s.toolCall.name} ${JSON.stringify(s.toolCall.input)}` : "none"}\` · calls ${s.modelCalls} (${s.stopReasons.join(", ") || "–"})`, "",
      "**Retrieved (deterministic re-execution of that call):**", "",
      ...(d.retrieved.length ? d.retrieved.map((a) => `- ${a.relevant ? "🟢" : "⚪"} \`${a.key}\` ${md(a.source)}: ${md(a.title)}${a.summary ? ` — ${md(a.summary)}` : " (headline only)"}`) : ["- (nothing)"]), "",
      `**Status:** ${s.status}${d.clarification ? ` — clarification: “${md(d.clarification)}”` : ""}`, "");
    for (const [j, st] of d.statements.entries()) {
      const f = s.flags[j];
      lines.push(`${j + 1}. ${md(st.text)}`, `   - Cites: ${st.citations.map((c) => `\`${c.key}\` (${md(c.source)})`).join(", ")}`,
        `   - Heuristic flags: ${f.unsupported.length ? `terms not in cited metadata → ${f.unsupported.join(", ")}` : "none"}${f.absolute ? "; absolute wording" : ""}`);
    }
    lines.push("", `**Notes:** ${s.notes.length ? s.notes.map(md).join("; ") : "none"}`, "",
      "**Manual grounding checklist** (reviewer fills in):", "",
      ...d.statements.flatMap((st, j) => [
        `- [ ] Statement ${j + 1}: every claim is stated in the cited title/summary (no added numbers, dates, causes, names or outcomes)`,
        `- [ ] Statement ${j + 1}: it does not merge different events or overstate certainty for headline-only evidence`]),
      "- [ ] Nothing important in the retrieved set was ignored or misrepresented",
      "- [ ] The status/abstention is appropriate for the available evidence",
      "- [ ] A reader would not mistake this for complete coverage", "");
  }
  lines.push("## Reviewer sign-off", "", "- [ ] All checklist items reviewed by a person", "- [ ] Failures recorded with question id and statement number",
    "- [ ] Decision: proceed / adjust prompt or retrieval (bump `ASK_PROMPT_VERSION`) / stop", "");
  return lines.join("\n");
}

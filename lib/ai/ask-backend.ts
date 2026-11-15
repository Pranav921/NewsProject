import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { ASK_PROMPT_VERSION, askBytes, validateAskAnswer } from "./ask-answer.ts";
import type { AskAnswer } from "./ask-answer.ts";
import { ASK_RESULT_SCHEMA } from "./ask.ts";
import type { AskResult } from "./ask.ts";
import type { AskSnapshot } from "./ask-retrieval.ts";
import { runAskQuestion } from "./ask-service.ts";
import type { AskProvider } from "./ask-provider.ts";
import type { AskStore } from "./ask-store.ts";
import { ASK_CACHE_BYTES, ASK_INPUT_RESERVATION, AskBackendError, normalizeAskQuestion, withinAskDeadline } from "./ask-settings.ts";
import type { AskConfig } from "./ask-settings.ts";

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function askCacheIdentity(user: string, question: string, snapshot: AskSnapshot, config: AskConfig) {
  // asOf changes on every load. Content/status fingerprint plus a short TTL gives
  // useful reuse while keeping original coverage time visible, never "live".
  return hash({ user: hash(user), question: normalizeAskQuestion(question), model: config.model,
    version: ASK_PROMPT_VERSION, selectionTokens: config.selectionTokens, answerTokens: config.answerTokens,
    snapshot: { articles: snapshot.articles, sources: snapshot.sources, feedStatus: snapshot.feedStatus, stats: snapshot.stats } });
}
function wireAnswer(answer: AskAnswer) {
  return { status: answer.status, clarification: answer.clarification,
    statements: answer.statements.map(statement => ({ text: statement.text,
      articleIds: statement.citations.map(citation => citation.articleId) })) };
}
type CacheRecord = {
  version: string; identity: string; snapshotTime: string; generatedAt: string; expiresAt: string;
  evidence: AskResult; output: ReturnType<typeof wireAnswer>;
};

// Validate only the fixed application's Stage A schema (never a model-supplied
// schema). This keeps cache shape checks aligned with the existing result contract.
function matchesCacheSchema(value: unknown, rule: Record<string, unknown>): boolean {
  if (Object.hasOwn(rule, "const")) return value === rule.const;
  if (Array.isArray(rule.enum) && !rule.enum.includes(value)) return false;
  const type = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const types = Array.isArray(rule.type) ? rule.type : [rule.type];
  if (!types.includes(type) && !(types.includes("integer") && typeof value === "number" && Number.isSafeInteger(value))) return false;
  if (typeof value === "number") return Number.isSafeInteger(value) && (!(typeof rule.minimum === "number") || value >= rule.minimum);
  if (typeof value === "string") return (!(typeof rule.minLength === "number") || value.length >= rule.minLength)
    && (!(typeof rule.maxLength === "number") || value.length <= rule.maxLength)
    && (!(typeof rule.pattern === "string") || new RegExp(rule.pattern).test(value))
    && (rule.format !== "date-time" || Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
  if (Array.isArray(value)) return (!(typeof rule.maxItems === "number") || value.length <= rule.maxItems)
    && (!(typeof rule.minItems === "number") || value.length >= rule.minItems)
    && (!rule.uniqueItems || new Set(value.map(item => JSON.stringify(item))).size === value.length)
    && value.every(item => matchesCacheSchema(item, rule.items as Record<string, unknown>));
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const properties = rule.properties as Record<string, Record<string, unknown>>;
    return (rule.required as string[]).every(key => Object.hasOwn(record, key))
      && Object.keys(record).every(key => Object.hasOwn(properties, key) && matchesCacheSchema(record[key], properties[key]));
  }
  return true;
}

// Do not trust cached display URLs or stale validation. Validate the stored exact
// tool evidence, then resolve each article against current matching trusted data.
// This never executes a second retrieval tool, even during cache publication.
export function readAskCache(value: unknown, snapshot: AskSnapshot, config: AskConfig, now = Date.now(), identity?: string) {
  try {
    if (!value || typeof value !== "object" || askBytes(value) > ASK_CACHE_BYTES) return null;
    const cached = value as CacheRecord;
    const fields = ["version", "identity", "snapshotTime", "generatedAt", "expiresAt", "evidence", "output"];
    if (Object.keys(cached).length !== fields.length || fields.some(key => !Object.hasOwn(cached, key))
      || cached.version !== ASK_PROMPT_VERSION || typeof cached.identity !== "string" || !/^[a-f0-9]{64}$/.test(cached.identity)
      || identity !== undefined && cached.identity !== identity
      || [cached.generatedAt, cached.expiresAt, cached.snapshotTime].some(date => typeof date !== "string")) return null;
    const generated = Date.parse(cached.generatedAt), expires = Date.parse(cached.expiresAt), time = Date.parse(cached.snapshotTime);
    if (![generated, expires, time].every(Number.isFinite) || generated > now || expires <= now
      || expires - generated > config.cacheSeconds * 1000 || expires <= generated || time > generated || generated - time > 30000) return null;
    if (!matchesCacheSchema(cached.evidence, ASK_RESULT_SCHEMA)) return null;
    const current = new Map(snapshot.articles.map(article => [article.id, article]));
    const evidence = cached.evidence;
    if (evidence.status === "unavailable" || evidence.coverage.asOf !== cached.snapshotTime
      || evidence.coverage.returnedArticleCount !== evidence.articles.length
      || evidence.coverage.snapshotArticleCount !== snapshot.articles.length
      || evidence.coverage.matchingArticleCount > snapshot.articles.length
      || evidence.coverage.matchingArticleCount < evidence.articles.length
      || new Set(evidence.articles.map(article => article.id)).size !== evidence.articles.length
      || (evidence.status === "ok") !== (evidence.articles.length > 0)
      || evidence.articles.some(article => !current.has(article.id) || hash(article) !== hash(current.get(article.id)))) return null;
    const result = { ...evidence, articles: evidence.articles.map(article => current.get(article.id)!) };
    return { answer: validateAskAnswer(cached.output, result), generatedAt: cached.generatedAt, expiresAt: cached.expiresAt };
  } catch { return null; }
}

export async function getAskAnswer(input: {
  userId: string; ip: string; question: string; config: AskConfig; store: AskStore;
  load: () => Promise<{ snapshot: AskSnapshot }>; provider: AskProvider;
  // workSignal stops new work (it includes the client's disconnect). cleanupSignal
  // bounds lease release, refunds of never-started calls and publishing an already
  // paid answer; it must be time-only so a closed tab cannot skip cleanup.
  workSignal: AbortSignal; cleanupSignal: AbortSignal; workEndsAt: number;
  now?: () => number;
}) {
  const { config, store, userId, ip, workSignal, cleanupSignal } = input;
  const question = normalizeAskQuestion(input.question);
  const now = input.now ?? Date.now;
  const owner = randomUUID();
  await withinAskDeadline(() => store.admit(userId, ip, owner), workSignal);
  let finished = false;
  try {
    const { snapshot } = await withinAskDeadline(input.load, workSignal);
    const key = askCacheIdentity(userId, question, snapshot, config);
    const cached = readAskCache(await withinAskDeadline(() => store.getCached(key), workSignal), snapshot, config, now(), key);
    if (cached) return { ...cached, cacheHit: true, modelRequests: 0, toolExecutions: 0, usage: null };
    await withinAskDeadline(() => store.reserve(userId, owner, config), workSignal);
    let attempts = 0;
    const provider: AskProvider = async (params, signal) => {
      if (attempts >= 2 || params.max_tokens > (attempts === 0 ? config.selectionTokens : config.answerTokens)) throw new AskBackendError("generation-budget", 429);
      await withinAskDeadline(() => store.start(userId, owner), workSignal);
      attempts++;
      // An attempt is charged before transport starts, including auth errors,
      // timeout, refusal, malformed JSON and invalid citations. No refunds of it.
      const result = await withinAskDeadline(() => input.provider(params,
        AbortSignal.any([signal, workSignal])), workSignal);
      const usage = (result as { usage?: Record<string, unknown> } | null)?.usage;
      if (usage) {
        const counts = [usage.input_tokens, usage.cache_read_input_tokens ?? 0, usage.cache_creation_input_tokens ?? 0];
        if (counts.some(n => typeof n !== "number" || !Number.isSafeInteger(n) || (n as number) < 0)
          || (counts as number[]).reduce((sum, count) => sum + count, 0) > ASK_INPUT_RESERVATION) throw new AskBackendError("generation-budget", 503);
      }
      return result;
    };
    const result = await withinAskDeadline(() => runAskQuestion(question, snapshot, provider,
      { ...config, timeoutMs: Math.max(1, Math.min(config.timeoutMs, input.workEndsAt - Date.now())) }), workSignal);
    const generatedAt = new Date(now()).toISOString();
    const expiresAt = new Date(Date.parse(generatedAt) + config.cacheSeconds * 1000).toISOString();
    const record: CacheRecord = { version: ASK_PROMPT_VERSION, identity: key, snapshotTime: snapshot.asOf, generatedAt, expiresAt,
      evidence: result.evidence, output: wireAnswer(result.answer) };
    // The same validator used for cache hits verifies records before publication.
    if (!readAskCache(record, snapshot, config, now(), key)) throw new AskBackendError("invalid-configuration");
    await withinAskDeadline(() => store.finish(userId, owner, key, record, config.cacheSeconds), cleanupSignal);
    finished = true;
    return { answer: result.answer, generatedAt, expiresAt, cacheHit: false, modelRequests: result.modelRequests,
      toolExecutions: result.toolExecutions, usage: result.usage };
  } finally {
    if (!finished) await withinAskDeadline(() => store.finish(userId, owner), cleanupSignal);
  }
}

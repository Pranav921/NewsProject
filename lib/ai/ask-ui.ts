// Browser-safe helpers for the Ask Kicker panel. Type-only imports keep every
// server module (prompts, tools, Redis, provider) out of the client bundle.
import type { AskAnswer } from "./ask-answer.ts";

export const ASK_UI_LIMITS = Object.freeze({
  questionCharacters: 500, bodyBytes: 2048,
  // Server deadline is 30s; allow network slack before giving up client-side.
  clientTimeoutMs: 40000,
  // Short waits disable the submit button with a countdown; longer ones only explain.
  blockRetryUpToSeconds: 120,
});

export type AskCoverage = AskAnswer["coverage"];
export type AskSuccess = { answer: AskAnswer; generatedAt: string; expiresAt: string; cacheHit: boolean };
export type AskFailureKind = "session" | "blocked" | "invalid" | "rate-limited" | "daily-limit" | "budget"
  | "busy" | "timeout" | "feeds" | "unverified" | "provider" | "unavailable" | "network";
export type AskFailure = {
  kind: AskFailureKind; title: string; message: string;
  canRetry: boolean; retryAfterSeconds: number | null;
};

// Mirrors the route's rules so obviously invalid input never costs a request:
// control characters and newlines become spaces, lone surrogates become U+FFFD.
export function normalizeQuestionInput(value: string): string {
  return value.replace(/\p{Cs}/gu, "�").replace(/[\p{Cc}\s]+/gu, " ").trim().normalize("NFC");
}

export function buildAskBody(question: string): string {
  return JSON.stringify({ question });
}

export function questionProblem(question: string): string | null {
  if (!question) return "Type a question first.";
  if (question.length > ASK_UI_LIMITS.questionCharacters
    || new TextEncoder().encode(buildAskBody(question)).length > ASK_UI_LIMITS.bodyBytes) {
    return `Questions can be up to ${ASK_UI_LIMITS.questionCharacters} characters.`;
  }
  return null;
}

const STATUSES = ["answered", "no_results", "needs_clarification", "unsupported"];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const isDate = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const isCount = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isText = (value: unknown) => typeof value === "string" && value.trim().length > 0;

function isCoverage(value: unknown): value is AskCoverage {
  if (!isRecord(value) || !isDate(value.asOf) || !isRecord(value.requestedWindow) || !isRecord(value.availableWindow)) return false;
  const { requestedWindow: requested, availableWindow: available } = value;
  return isDate(requested.from) && isDate(requested.to)
    && (available.from === null || isDate(available.from)) && (available.to === null || isDate(available.to))
    && ["snapshotArticleCount", "matchingArticleCount", "returnedArticleCount", "sourceCount"].every(key => isCount(value[key]))
    && [value.failedFeeds, value.staleFeeds].every(count => count === null || isCount(count))
    && ["snapshotTruncated", "resultsTruncated", "byteLimitReached"].every(key => typeof value[key] === "boolean");
}

// Defense in depth only: the server already validated citations against the exact
// tool result. The browser just refuses to render a shape it does not understand.
export function parseAskResponse(payload: unknown): AskSuccess | null {
  if (!isRecord(payload) || !isRecord(payload.answer) || !isDate(payload.generatedAt)
    || !isDate(payload.expiresAt) || typeof payload.cacheHit !== "boolean") return null;
  const answer = payload.answer;
  if (!STATUSES.includes(answer.status as string) || !Array.isArray(answer.statements) || answer.statements.length > 5
    || (answer.status === "answered") !== (answer.statements.length > 0)
    || !(answer.clarification === null || isText(answer.clarification))
    || !isText(answer.disclaimer) || !isCoverage(answer.coverage)) return null;
  const statementsOk = answer.statements.every(statement => isRecord(statement) && isText(statement.text)
    && Array.isArray(statement.citations) && statement.citations.length >= 1 && statement.citations.length <= 3
    && statement.citations.every(citation => isRecord(citation)
      && ["articleId", "title", "url", "source"].every(key => isText(citation[key]))));
  return statementsOk ? payload as AskSuccess : null;
}

// Links come from backend snapshot records; still render only http(s) URLs.
export function safeCitationUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch { return null; }
}

const defaultTime = (date: Date) => date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function formatWait(seconds: number, now: number, formatTime = defaultTime): string {
  if (seconds <= 90) return `in ${seconds} second${seconds === 1 ? "" : "s"}`;
  if (seconds < 3600) return `in ${Math.ceil(seconds / 60)} minutes`;
  return `after ${formatTime(new Date(now + seconds * 1000))}`;
}

const UNVERIFIED = new Set(["invalid-citation", "malformed-answer", "invalid-tool-call", "unknown-tool",
  "invalid-tool-arguments", "incomplete-response", "provider-refusal", "invalid-envelope",
  "tool-result-too-large", "token-budget", "response-too-large", "request-too-large"]);

export function describeAskFailure(input: { status: number; code?: string | null; retryAfter?: number | null; network?: "offline" | "timeout" },
  now: number, formatTime = defaultTime): AskFailure {
  const { status, code, network } = input;
  const retry = input.retryAfter && Number.isFinite(input.retryAfter) && input.retryAfter > 0 ? Math.ceil(input.retryAfter) : null;
  const failure = (kind: AskFailureKind, title: string, message: string, canRetry: boolean, retryAfterSeconds: number | null = null): AskFailure =>
    ({ kind, title, message, canRetry, retryAfterSeconds });
  const wait = (fallback: number) => formatWait(retry ?? fallback, now, formatTime);

  if (network === "offline") return failure("network", "Connection problem", "We couldn't reach Kicker News. Check your connection and try again.", true);
  if (network === "timeout" || status === 504 || code === "deadline") {
    return failure("timeout", "Ask Kicker took too long", "No answer was ready within 30 seconds. Try again, or ask a more specific question.", true);
  }
  if (status === 401) return failure("session", "Your session has expired", "Sign in again to keep using Ask Kicker. Your question was not answered.", false);
  if (status === 403) return failure("blocked", "Request blocked", "For your security, Ask Kicker only accepts questions sent from this page. Refresh the page and try again.", false);
  if (status === 400 || status === 413 || status === 415) {
    return failure("invalid", "We couldn't read that question", `Use plain text, up to ${ASK_UI_LIMITS.questionCharacters} characters, and try again.`, false);
  }
  if (status === 429 && code === "generation-budget") {
    return failure("budget", "Today's AI capacity is used up", `Ask Kicker has reached its daily AI limit. New answers are available again ${wait(3600)}. A question you asked in the last few minutes may still show its saved answer.`, false);
  }
  if (status === 429) {
    if ((retry ?? 60) >= 3600) return failure("daily-limit", "Daily question limit reached", `Ask Kicker allows a limited number of questions each day. You can ask again ${wait(3600)}.`, false);
    return failure("rate-limited", "You're asking quickly", `You've reached the short-term question limit. You can ask again ${wait(60)}.`, true, retry ?? 60);
  }
  if (status === 409) {
    if (code === "lease-expired") return failure("busy", "That request was interrupted", `Ask Kicker couldn't finish this request safely. Try again ${wait(3)}.`, true, retry ?? 3);
    return failure("busy", "Ask Kicker is busy", `Another question is still being answered (perhaps in another tab), or Ask Kicker is at capacity. Try again ${wait(3)}.`, true, retry ?? 3);
  }
  if (code === "tool-unavailable") return failure("feeds", "News feeds are unavailable", "Ask Kicker can't search coverage while the news feeds are unavailable. Try again in a few minutes.", true);
  if (code && UNVERIFIED.has(code)) {
    return failure("unverified", "No verified answer this time", "Ask Kicker couldn't produce an answer that passed its citation and safety checks, so nothing was shown. Try rephrasing your question.", true);
  }
  if (code?.startsWith("provider-")) return failure("provider", "AI service unavailable", "The AI service didn't respond normally. Try again in a moment; the news feed below is unaffected.", true);
  return failure("unavailable", "Ask Kicker is unavailable", "Ask Kicker is temporarily unavailable. You can keep reading the news feed below.", true);
}

export function coverageWindowLabel(coverage: AskCoverage): string {
  const hours = Math.max(1, Math.round((Date.parse(coverage.requestedWindow.to) - Date.parse(coverage.requestedWindow.from)) / 3600000));
  if (hours >= 48 && hours % 24 === 0) return `Past ${hours / 24} days`;
  return hours === 1 ? "Past hour" : `Past ${hours} hours`;
}

export function coverageNotes(coverage: AskCoverage): string[] {
  const notes: string[] = [];
  const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
  if (coverage.failedFeeds) notes.push(`${plural(coverage.failedFeeds, "news feed")} could not be loaded, so some publishers may be missing.`);
  if (coverage.staleFeeds) notes.push(`${plural(coverage.staleFeeds, "feed")} used a recently cached copy instead of a fresh update.`);
  if (coverage.snapshotTruncated) notes.push("Only the most recent articles in the feed snapshot were searched.");
  if (coverage.resultsTruncated || coverage.byteLimitReached) notes.push("More articles matched than Ask Kicker could review, so the answer uses the top matches.");
  return notes;
}

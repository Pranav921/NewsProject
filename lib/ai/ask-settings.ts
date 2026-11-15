import { ASK_WORKFLOW_DEFAULTS, ASK_WORKFLOW_LIMITS, validateAskConfig } from "./ask-answer.ts";
import type { AskWorkflowConfig } from "./ask-answer.ts";

export class AskBackendError extends Error {
  readonly code: "invalid-request" | "body-too-large" | "unsupported-media-type" | "invalid-configuration"
    | "unsupported-model" | "redis-unavailable" | "request-limit" | "busy" | "generation-budget" | "lease-expired" | "deadline";
  readonly status: number;
  readonly retryAfter?: number;
  constructor(code: AskBackendError["code"], status = 503, retryAfter?: number) {
    super(code); this.name = "AskBackendError"; this.code = code; this.status = status; this.retryAfter = retryAfter;
  }
}
export type AskConfig = AskWorkflowConfig & {
  cacheSeconds: number; dailyAttempts: number; dailyTokens: number;
};
export const ASK_INPUT_RESERVATION = 65536;
export const ASK_BODY_BYTES = 2048;
export const ASK_CACHE_BYTES = 16384;
export const ASK_LEASE_SECONDS = 45;
// Global cache-miss (generation) requests per UTC day, counted at reservation.
// Cache hits never consume it; per-user/IP abuse limits still count every request.
export const ASK_DAILY_GENERATIONS = 20;

// Ask reuses the AI Briefing's configured model (AI_BRIEFING_MODEL) and Anthropic key.
// Its first request forces one tool call (tool_choice "any"), which Claude Haiku 5.5
// accepts but Claude Opus 5.5, Sonnet 5.5 and Fable 5.1/5.2 reject with a 400. Only
// models verified with Ask's tool protocol and structured answer are listed; any
// other briefing model makes Ask fail closed instead of failing on every request.
export const ASK_COMPATIBLE_MODELS: ReadonlySet<string> = new Set(["claude-haiku-5-5"]);

export function readAskConfig(env: Record<string, string | undefined>): AskConfig {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) throw new AskBackendError("invalid-configuration");
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new AskBackendError("invalid-configuration");
    return value;
  };
  if (env.AI_BRIEFING_PROVIDER && env.AI_BRIEFING_PROVIDER !== "anthropic") throw new AskBackendError("unsupported-model");
  const model = env.AI_BRIEFING_MODEL?.trim() ?? "";
  if (!ASK_COMPATIBLE_MODELS.has(model)) throw new AskBackendError("unsupported-model");
  // Optional AI_ASK_* tuning overrides are bounded by hard ceilings (attempts can only
  // be lowered). None is required; without them the conservative defaults apply.
  const config: AskConfig = {
    ...ASK_WORKFLOW_DEFAULTS, model,
    // Fixed whole-request ceiling; callers reserve cleanup time within it.
    timeoutMs: 30000,
    selectionTokens: integer("AI_ASK_SELECTION_TOKENS", 384, 128, 1024),
    answerTokens: integer("AI_ASK_ANSWER_TOKENS", 1200, 128, 3072),
    cacheSeconds: integer("AI_ASK_CACHE_SECONDS", 300, 30, 600),
    dailyAttempts: integer("AI_ASK_DAILY_MODEL_ATTEMPTS", 40, 1, 40),
    dailyTokens: integer("AI_ASK_DAILY_RESERVED_TOKENS", 2700000, 1, 3000000),
  };
  try { validateAskConfig(config); } catch { throw new AskBackendError("invalid-configuration"); }
  return Object.freeze(config);
}

export function normalizeAskQuestion(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > ASK_WORKFLOW_LIMITS.questionCharacters
    || new TextEncoder().encode(value).length > ASK_WORKFLOW_LIMITS.questionBytes || /[\u0000-\u001f\u007f]/.test(value)) throw new AskBackendError("invalid-request", 400);
  return value.normalize("NFC").trim().replace(/\s+/g, " ");
}

// This must wrap *starting* an operation, so an expired request never starts a
// later Redis write or provider invocation. Losing a race never resumes the flow.
export async function withinAskDeadline<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new AskBackendError("deadline", 504);
  let abort: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    abort = () => reject(new AskBackendError("deadline", 504));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([start(), deadline]); }
  finally { signal.removeEventListener("abort", abort); }
}

export async function readAskBody(request: Request, signal: AbortSignal): Promise<string> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new AskBackendError("unsupported-media-type", 415);
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > ASK_BODY_BYTES)) throw new AskBackendError("body-too-large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AskBackendError("invalid-request", 400);
  const chunks: Uint8Array[] = []; let bytes = 0; let emptyChunks = 0;
  try {
    while (true) {
      const { done, value } = await withinAskDeadline(() => reader.read(), signal);
      if (done) break;
      if (!value.byteLength && ++emptyChunks > 64) throw new AskBackendError("invalid-request", 400);
      bytes += value.byteLength;
      if (bytes > ASK_BODY_BYTES) throw new AskBackendError("body-too-large", 413);
      chunks.push(value);
    }
    const buffer = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.length; }
    let body: unknown;
    try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
    catch { throw new AskBackendError("invalid-request", 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, "question")) throw new AskBackendError("invalid-request", 400);
    return normalizeAskQuestion((body as { question: unknown }).question);
  } finally { void reader.cancel().catch(() => {}); }
}

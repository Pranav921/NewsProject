import { DEFAULT_BRIEFING_LIMITS } from "./briefing.ts";
import type { BriefingLimits } from "./briefing.ts";

export class BriefingError extends Error {
  code: string;
  status: number;
  retryAfter?: number;
  constructor(code: string, status = 503, retryAfter?: number) {
    super(code);
    this.name = "BriefingError";
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export type BriefingConfig = {
  model: string;
  cacheSeconds: number;
  dailyAttempts: number;
  retrySeconds: number;
  userRequestsPerMinute: number;
  timeoutMs: number;
  maxOutputTokens: number;
  limits: BriefingLimits;
};

// No environment is read at import time, and credentials never enter this object.
export function readBriefingConfig(env: Record<string, string | undefined>): BriefingConfig {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = env[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) throw new BriefingError("invalid-configuration");
    return value;
  };
  const model = env.AI_BRIEFING_MODEL?.trim() ?? "";
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(model)) throw new BriefingError("invalid-configuration");
  if (env.AI_BRIEFING_PROVIDER && env.AI_BRIEFING_PROVIDER !== "anthropic") throw new BriefingError("unsupported-provider");
  return {
    model,
    cacheSeconds: integer("AI_BRIEFING_CACHE_SECONDS", 900, 60, 3600),
    dailyAttempts: integer("AI_BRIEFING_DAILY_ATTEMPTS", 48, 1, 1000),
    retrySeconds: integer("AI_BRIEFING_RETRY_SECONDS", 30, 5, 300),
    userRequestsPerMinute: integer("AI_BRIEFING_USER_REQUESTS_PER_MINUTE", 5, 1, 30),
    timeoutMs: integer("AI_BRIEFING_TIMEOUT_MS", 20000, 1000, 30000),
    maxOutputTokens: integer("AI_BRIEFING_MAX_OUTPUT_TOKENS", 1200, 200, 2400),
    limits: {
      ...DEFAULT_BRIEFING_LIMITS,
      maxArticles: integer("AI_BRIEFING_MAX_ARTICLES", 12, 1, 12),
      maxItems: integer("AI_BRIEFING_MAX_ITEMS", 5, 1, 5),
      maxInputBytes: integer("AI_BRIEFING_MAX_INPUT_BYTES", 12000, 1000, 12000),
      headlineChars: integer("AI_BRIEFING_HEADLINE_CHARS", 120, 20, 120),
      explanationChars: integer("AI_BRIEFING_EXPLANATION_CHARS", 400, 40, 400),
    },
  };
}

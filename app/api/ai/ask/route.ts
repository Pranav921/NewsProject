import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/ratelimit";
import { logApiInfo } from "@/lib/api-logging";
import { createAskStore } from "@/lib/ai/ask-store";
import { createAskProvider } from "@/lib/ai/ask-provider";
import { loadAskTools } from "@/lib/ai/ask-snapshot";
import { getAskAnswer } from "@/lib/ai/ask-backend";
import { AskBackendError, readAskBody, readAskConfig, withinAskDeadline } from "@/lib/ai/ask-settings";
import { AskWorkflowError } from "@/lib/ai/ask-answer";
import { isAiEnabled } from "@/lib/ai/feature-flag";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function reply(body: unknown, status: number, retryAfter?: number) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Origin",
    ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) } });
}

export async function POST(request: Request) {
  const started = Date.now();
  // Shared AI master switch (the AI Briefing's flags), checked server-side on every
  // request before origin, body, session, Redis, RSS or provider work.
  if (!isAiEnabled(process.env)) return reply({ error: "Ask Kicker is unavailable." }, 503);
  // Cleanup (lease release, refunds of never-started calls, publishing an already-paid
  // answer) is bounded by the 30s ceiling only: a client disconnect must not skip it.
  const cleanupSignal = AbortSignal.timeout(30000);
  // New work stops on disconnect or at 28.5s, leaving 1.5s of the ceiling for cleanup.
  const workSignal = AbortSignal.any([request.signal, AbortSignal.timeout(28500)]);
  try {
    const base = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL;
    if (!base) throw new AskBackendError("invalid-configuration");
    let origin: string;
    try {
      const configured = new URL(base);
      if (!["http:", "https:"].includes(configured.protocol) || configured.username || configured.password) throw new Error();
      origin = configured.origin;
    } catch { throw new AskBackendError("invalid-configuration"); }
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Request origin is not allowed." }, 403);
    if (new URL(request.url).search) return reply({ error: "Query parameters are not accepted." }, 400);
    const question = await readAskBody(request, workSignal);
    const { data: { user }, error } = await withinAskDeadline(async () => {
      const supabase = await createSupabaseServerClient();
      return supabase.auth.getUser();
    }, workSignal);
    if (error || !user?.id) return reply({ error: "Sign in to use Ask Kicker." }, 401);
    const config = readAskConfig(process.env);
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new AskBackendError("invalid-configuration");
    const result = await getAskAnswer({ userId: user.id, ip: getClientIp(request), question, config,
      store: createAskStore(process.env, cleanupSignal), load: loadAskTools, provider: createAskProvider(apiKey),
      workSignal, cleanupSignal, workEndsAt: started + 28500 });
    // A fixed allowlist only; never log identities, questions, tool args or errors.
    logApiInfo("[ai][ask]", { status: result.answer.status, durationMs: Date.now() - started,
      cacheHit: result.cacheHit, modelRequests: result.modelRequests, toolExecutions: result.toolExecutions,
      statementCount: result.answer.statements.length,
      inputTokens: result.usage?.inputTokens ?? 0, outputTokens: result.usage?.outputTokens ?? 0,
      cacheReadInputTokens: result.usage?.cacheReadInputTokens ?? 0,
      cacheCreationInputTokens: result.usage?.cacheCreationInputTokens ?? 0 });
    return reply(result, 200);
  } catch (error) {
    const known = error instanceof AskBackendError || error instanceof AskWorkflowError;
    const code = known ? error.code : "ask-unavailable";
    const status = error instanceof AskBackendError ? error.status : 503;
    const retry = error instanceof AskBackendError ? error.retryAfter : 10;
    logApiInfo("[ai][ask][error]", { category: code, durationMs: Date.now() - started });
    return reply({ error: "Ask Kicker is unavailable right now. Please try again later.", code }, status, retry);
  }
}

import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/ratelimit";
import { getAllNewsItems } from "@/lib/rss";
import { logApiError, logApiInfo } from "@/lib/api-logging";
import { readBriefingConfig, BriefingError } from "@/lib/ai/settings";
import { createBriefingStore } from "@/lib/ai/briefing-store";
import { generateBriefing } from "@/lib/ai/provider";
import { getOrGenerateBriefing } from "@/lib/ai/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function reply(body: unknown, status: number, retryAfter?: number) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
  });
}

async function hasRequestBytes(request: Request): Promise<boolean> {
  const reader = request.body?.getReader();
  if (!reader) return false;
  // Next's Node adapter may supply a stream even for Content-Length: 0.
  // Check bytes, without buffering uploads or trusting transport headers.
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(5000)]);
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) throw new BriefingError("invalid-request-body", 400);
    while (true) {
      const { done, value } = await reader.read();
      if (signal.aborted) throw new BriefingError("invalid-request-body", 400);
      if (done) return false;
      if (value.byteLength > 0) return true;
    }
  } finally {
    signal.removeEventListener("abort", cancel);
    cancel();
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const started = Date.now();
  if (process.env.AI_BRIEFING_ENABLED !== "true") return reply({ error: "AI briefing is unavailable." }, 503);
  // Require a separately reviewed rollout in production, in addition to the feature flag.
  if (process.env.NODE_ENV === "production" && process.env.AI_BRIEFING_PRODUCTION_VERIFIED !== "true") return reply({ error: "AI briefing is unavailable." }, 503);
  try {
    const baseUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL;
    if (!baseUrl) throw new BriefingError("invalid-configuration");
    if (request.headers.get("origin") !== new URL(baseUrl).origin || request.headers.get("sec-fetch-site") === "cross-site") return reply({ error: "Request origin is not allowed." }, 403);
    // The endpoint accepts no browser-supplied prompts, URLs, filters, or models.
    if (new URL(request.url).search || await hasRequestBytes(request)) return reply({ error: "This endpoint accepts no request body or query parameters." }, 400);
    const ipLimit = await enforceRateLimit(request, "ai-briefing");
    if (ipLimit) {
      ipLimit.headers.set("Cache-Control", "private, no-store");
      return ipLimit;
    }
    const supabase = await createSupabaseServerClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user?.id) return reply({ error: "Sign in to view the AI briefing." }, 401);
    const config = readBriefingConfig(process.env);
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) throw new BriefingError("missing-api-key");
    const store = createBriefingStore();
    await store.enforceUserLimit(user.id, config.userRequestsPerMinute);
    const result = await getOrGenerateBriefing({
      config, store,
      fetchArticles: () => store.fetchArticles(() => getAllNewsItems({ fresh: true })),
      generate: (articles) => generateBriefing(articles, config, apiKey),
    });
    logApiInfo("[ai][briefing]", {
      durationMs: Date.now() - started, cacheHit: result.cacheHit,
      model: config.model, articleCount: result.articleCount ?? null,
      inputTokens: result.usage?.inputTokens ?? null, outputTokens: result.usage?.outputTokens ?? null,
    });
    return reply({ briefing: result.briefing, cacheHit: result.cacheHit }, 200);
  } catch (error) {
    const safe = error instanceof BriefingError ? error : new BriefingError("briefing-unavailable");
    // The existing Sentry sanitizer is not wired up. Contain all provider/Redis
    // errors here and log only our own codes; never hand raw errors to telemetry.
    logApiError("[ai][briefing][error]", new Error(safe.code), { durationMs: Date.now() - started });
    return reply({ error: "The AI briefing is unavailable right now. Please try again later." }, safe.status, safe.retryAfter);
  }
}

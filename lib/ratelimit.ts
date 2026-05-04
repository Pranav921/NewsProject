import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

const upstashUrl = process.env.UPSTASH_REDIS_REST_URL?.trim() ?? "";
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ?? "";
const isProduction = process.env.NODE_ENV === "production";
const isDevelopment = !isProduction;

const redis =
  upstashUrl && upstashToken
    ? new Redis({
        token: upstashToken,
        url: upstashUrl,
      })
    : null;

const ratelimit =
  redis
    ? new Ratelimit({
        limiter: Ratelimit.slidingWindow(5, "1 m"),
        redis,
      })
    : null;
let hasWarnedAboutMissingConfig = false;

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "local-dev";
  }

  return (
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local-dev"
  );
}

export async function enforceRateLimit(
  request: Request,
  scope: string,
): Promise<NextResponse | null> {
  if (!ratelimit) {
    if (!hasWarnedAboutMissingConfig) {
      const message =
        "Upstash rate limiting is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.";

      if (isProduction) {
        console.error("[ratelimit][missing-config]", { scope, message });
      } else {
        console.warn("[ratelimit][missing-config]", { scope, message });
      }

      hasWarnedAboutMissingConfig = true;
    }

    if (isProduction) {
      return NextResponse.json(
        { error: "Rate limiting is unavailable" },
        { status: 503 },
      );
    }

    return null;
  }

  const ip = getClientIp(request);
  const key = `${scope}:${ip}`;
  const result = await ratelimit.limit(key);

  if (isDevelopment) {
    console.info("[ratelimit]", {
      key,
      remaining: "remaining" in result ? result.remaining : null,
      route: scope,
      success: result.success,
    });
  }

  if (result.success) {
    return null;
  }

  return NextResponse.json(
    { error: "Too many requests" },
    {
      headers: {
        "Retry-After": String(Math.max(1, Math.ceil((result.reset - Date.now()) / 1000))),
      },
      status: 429,
    },
  );
}

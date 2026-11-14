import "server-only";

type ServerEnvironment = Record<string, string | undefined>;

// Vercel's deployment environment is server-controlled. NODE_ENV describes a
// build mode, so it cannot distinguish local next start from real production.
export function getRedisKeyspace(env: ServerEnvironment = process.env) {
  const deployment = env.VERCEL_ENV?.trim();
  const configured = env.REDIS_KEYSPACE?.trim();
  let environment: "dev" | "preview" | "prod";
  if (deployment) {
    if (deployment === "production") environment = "prod";
    else if (deployment === "preview") environment = "preview";
    else if (deployment === "development") environment = "dev";
    else throw new Error("redis-keyspace-invalid");
    const expected = environment === "prod" ? "prod-legacy" : environment;
    if (configured && configured !== expected) throw new Error("redis-keyspace-conflict");
  } else {
    if (env.VERCEL === "1" || configured !== "dev") throw new Error("redis-keyspace-required");
    environment = "dev";
  }

  // Production intentionally retains every existing key until a separately
  // approved rollover. Never dual-write/read legacy keys from dev or preview.
  return {
    environment,
    rateLimitPrefix: environment === "prod" ? "@upstash/ratelimit" : `kicker:${environment}:ratelimit`,
    briefingPrefix: environment === "prod" ? "kicker:{ai-briefing}:v1:" : `kicker:${environment}:{kicker-${environment}-ai-briefing}:v1:`,
  };
}

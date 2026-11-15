import "server-only";

type Env = Record<string, string | undefined>;

// One master switch for every AI feature (AI Briefing and Ask Kicker): the AI
// Briefing's existing flags. Production-mode servers (Vercel Production/Preview and
// local `next start`) additionally require AI_BRIEFING_PRODUCTION_VERIFIED. Callers
// pass the environment explicitly and check it on every request; it is never sent to
// the browser. Sharing the switch shares nothing else: Ask keeps its own quotas,
// budgets, leases and Redis keys.
export function isAiEnabled(env: Env): boolean {
  return env.AI_BRIEFING_ENABLED === "true"
    && (env.NODE_ENV !== "production" || env.AI_BRIEFING_PRODUCTION_VERIFIED === "true");
}

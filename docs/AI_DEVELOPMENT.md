# AI assistance and implementation provenance

The AI Briefing feature was designed and implemented with Codex assistance in the
existing repository. The user approved the architecture and refinements before code
was added. Work proceeded through pure selection/schema tests, server provider and
Redis controls, mocked backend tests, then dashboard UI and documentation.

The user preferred Claude Code for implementation. The installed CLI was attempted;
after accommodating its local log/session writes, it returned a provider error for
its configured model (`claude-opus-4-1-20250805`, model not found). It did not produce
implementation changes. Codex completed the work. Do not describe this milestone
as implemented or reviewed by Claude Code.

AI assistance covered repository inspection, architecture, prompt/schema design,
implementation, test fixtures, and documentation. The assistant reviewed its changes
and ran checks recorded in the final handoff. This is not independent human review.
The developer still needs to review grounding quality, real Redis behavior,
telemetry, provider configuration, and cost before production enablement.

The application cache contract is versioned by `BRIEFING_VERSION` in `lib/ai/briefing.ts`.
Model selection is explicit deployment configuration with no implicit default.
Changes to the output/grounding safety contract should increment that version,
invalidating cached briefings while preserving global budgets. Compatible editorial
preferences use a separate revision and allow validated caches to expire naturally.
The feature sends bounded publisher
metadata to the configured provider; it never sends account history or full articles.

No paid AI Briefing API call or production deployment was performed during
implementation. Deterministic tests mock model/auth/Redis boundaries. The separate
live smoke test requires both an explicit flag and an approval environment variable.
See [AI_BRIEFING.md](AI_BRIEFING.md) for operation and limitations.

## Files in the initial briefing milestone

| Files | Change |
| --- | --- |
| `lib/ai/briefing.ts` | New pure selection, prompt, schema, output validation, shared types |
| `lib/ai/settings.ts` | New validated configuration and safe error codes |
| `lib/ai/provider.ts` | New server-only provider adapter |
| `lib/ai/service.ts` | New cached-generation orchestration |
| `lib/ai/briefing-store.ts` | New Redis snapshots, cache, leases, quotas, user limits |
| `app/api/ai/briefing/route.ts` | New authenticated same-origin endpoint |
| `components/AiNewsBriefing.tsx` | New on-demand dashboard panel |
| `app/page.tsx`, `components/DashboardView.tsx` | Small server-flag and panel integration |
| `tests/ai-briefing.test.mjs`, `tests/ai-briefing-provider.test.mjs`, `tests/ai-briefing-service.test.mjs`, `tests/ai-briefing-route.test.mjs`, `tests/ai-briefing-store.test.mjs` | 23 new deterministic tests |
| `tests/helpers/load-ai-module.mjs` | Explicit VM boundary loader |
| `scripts/smoke-ai-briefing.mjs` | Separately gated paid provider test |
| `scripts/validate-ai-briefing-ui.mjs` | Real Chrome component checks with mocked responses |
| `.env.example`, `.gitignore` | Safe configuration placeholders; track the example while private env files remain ignored |
| `README.md`, `PROJECT_OVERVIEW.md` | Feature overview and documentation links |
| `docs/AI_BRIEFING.md`, `docs/FOLLOW_UP_ISSUES.md`, `docs/AI_DEVELOPMENT.md` | Operation, separate issue records, provenance and verification |

The existing RSS, newsletter, subscription, analytics, and authentication
implementations were not modified. The initial milestone added no new package
dependencies; the subsequent Claude migration adds the official Anthropic SDK.

## Initial milestone verification on November 13, 2026

- `npm test`: 120 passed, zero failed (97 existing and 23 new tests).
- `npm run lint`: passed after correcting a reserved variable name in a new test.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed. The sandboxed attempt could not fetch the existing
  Google Fonts; the network-enabled retry compiled and generated all routes.
- `node scripts/validate-ai-briefing-ui.mjs`: passed. Tested click-only generation,
  bodyless requests, loading state, generated timestamp, metadata disclaimer, trusted
  references, reopening without another request, widths 320/390/768/1440, and
  session/rate-limit/unavailable/network errors. No hydration/runtime errors. The
  sandbox blocked Chrome's DevTools WebSocket; the local retry outside the sandbox
  passed. All briefing responses were mocked.
- `node --experimental-strip-types scripts/smoke-ai-briefing.mjs`: the default guard
  correctly skipped the API call. The paid opt-in path was not run.
- `git diff --check`: passed. Git reports the repository's normal LF/CRLF notices.

The Node test runner emits the existing class of `MODULE_TYPELESS_PACKAGE_JSON`
warning for TypeScript ES modules; package module mode was intentionally unchanged.
Real provider calls, real Redis Lua execution and deployed telemetry inspection
remain unperformed and must be verified before production rollout.

## Claude provider migration

The user requested a minimal migration to Anthropic after the initial briefing
implementation. Codex inspected the current adapter/configuration/tests and official
Anthropic documentation before changing code. No agents or external Claude Code
sessions were started for this migration. No paid Messages API requests were made.

Selected exact model: **`claude-haiku-5-5`**. Anthropic's official model page lists
it as active/latest, fast, and inexpensive for high-volume work. The official
migration guide confirms that it is a fixed ID without a date suffix or separate
alias. Structured outputs are documented for this model through Messages API
`output_config.format`. These were verified from documentation, not a live model
call; account/project access remains unverified.

The SDK is `@anthropic-ai/sdk` **1.8.0** (installed dependency and lockfile). Its
official schema transformer adapts unsupported wire constraints without changing
the original briefing schema or local source-reference validation. Request/response
handling now uses Messages API system/messages/max_tokens, content-block types,
stop reasons, and usage. Low effort reduces unnecessary reasoning. SDK retries,
logs, and OpenTelemetry are disabled. HTTP/provider exceptions become safe local
codes before existing route logging. Request/response byte caps and timeouts remain.

`ANTHROPIC_API_KEY` replaces the previous provider credential setting. The
configuration example selects Anthropic and the verified model but keeps both
application enablement flags false. Private env files were not read or edited.
There was no direct OpenAI SDK dependency to remove. Any transitive packages used by
existing tooling/monitoring are outside this migration and were not removed.

Migration files:

- `lib/ai/provider.ts`, `lib/ai/settings.ts`, `app/api/ai/briefing/route.ts`
- `lib/ai/service.ts`: add provider identity to cache hashing so old results are
  not reused; global quotas/locks/cooldowns remain unchanged.
- `package.json`, `package-lock.json`, `.env.example`
- `tests/ai-briefing-provider.test.mjs`, `tests/ai-briefing-route.test.mjs`
- `scripts/smoke-ai-briefing.mjs`
- `README.md`, `PROJECT_OVERVIEW.md`, `docs/AI_BRIEFING.md`, this file

The provider tests exercise the real installed SDK with mocked HTTP responses,
including authentication headers, transformed schema, thinking/text blocks,
refusals, incomplete/context-limited output, 401/403/408/429/5xx errors, network
failures, timeouts, malformed/oversized bodies, unchanged business constraints,
and one HTTP attempt on errors. No changes were made to RSS selection, the
application schema, dashboard, authentication flows, or Redis operations.

Migration verification: `npm test` passed **124/124** tests; `npm run lint`,
`npx tsc --noEmit`, and `npm run build` all passed. The production build used
network access to retrieve the app's existing Google Fonts; no model calls or
deployment occurred. `git diff --check` also passed.
The smoke script's default guard made no paid request. Real Redis, deployed
telemetry, actual model latency/schema compatibility/account access, and grounding
quality still require approved rollout checks. Earlier browser verification above
belongs to the initial milestone; the UI was not changed in this migration.

Official verification sources:

- [Claude Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
- [Fixed model ID and thinking migration notes](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)
- [JSON output compatibility and limitations](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [TypeScript SDK retries and timeouts](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)

## Final pre-deployment review

Codex polished the existing UI, added sanitized validation categories and mocked
regressions, clarified the metadata-grounding prompt and versioned it as
`metadata-v2`. An exact dev-cache GET allowed comparison of five output items
against all supplied metadata, identifying an unresolved cross-report event
identity inference; this was not independent factual verification. The new prompt
has not been paid-tested. The reviewer checked current official pricing and
prepared the staged deployment plan in [AI_PREDEPLOY_REVIEW.md](AI_PREDEPLOY_REVIEW.md).
All provider tests and browser responses were mocked. No commit/push/deployment,
provider request, email, production write or Vercel settings change occurred.

## Editorial and reader-experience refinement — November 14, 2026

Codex inspected the selector, prompt, schema, cache validation and real component,
then implemented deterministic public-interest preferences and soft diversity,
cache-compatible stored-order validation, clearer typography/citations and explicit
cache-expiry feedback. The existing shared deduplicator, provider validation and
security/Redis limits were retained. Synthetic fixtures and mocked Chrome checks
support the review; they are not proof of factuality or live model reliability.
No paid call, production write, deployment or Vercel change was performed.
See [editorial reasoning, limitations and review criteria](AI_EDITORIAL_REVIEW.md).

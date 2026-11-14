# AI News Briefing

Redis keys are selected by the server environment; see
[Redis keyspaces and legacy rollout](REDIS_KEYSPACES.md). Local Redis use requires
`REDIS_KEYSPACE=dev`; preview is separate and production retains its legacy keys.
This provides logical separation within a shared database, not credential isolation.

This is an addition to the existing Next.js application, not a separate service.
It is disabled by default. No production enablement or paid model smoke test was
performed during implementation.

## Reader experience

Signed-in readers see **View AI Briefing** only when the server feature flag is
enabled. Clicking it returns a shared recent briefing, or generates one when
necessary. Nothing is generated on page load, feed polling, or newsletter sending.
The panel displays when the briefing was generated, up to five headline/explanation
items, and source article links. It explicitly describes the output as AI-generated
summaries of available publisher metadata, **not full-article analysis**.
The compact **Your News Briefing** panel distinguishes cached/new responses, shows
cache expiry without implying the reporting is current, and offers explicit refresh
after expiry. It never generates in the background. See the
[editorial evaluation and compatible rollout](AI_EDITORIAL_REVIEW.md).

## Request and data flow

1. A bodyless, same-origin `POST /api/ai/briefing` rejects query parameters and
   request bodies. It requires the configured app origin and a valid Supabase
   session. Existing IP limiting and a new Redis user limit apply to cache hits too.
2. The service reads the shared validated briefing before checking generation
   quotas or acquiring the generation lease. Cache hits never call the model.
3. On a miss, a global 90-second Redis lease prevents concurrent generation across
   server instances. Every publish/release checks the random lease owner.
4. A separate 90-second Redis RSS snapshot wraps the existing
   `getAllNewsItems({ fresh: true })`. Existing homepage/API caching is untouched.
5. Selection accepts only valid credential-free HTTP(S) canonical links, nonempty
   source/title metadata, and publication times within the last 24 hours. It removes
   exact-link duplicates, ranks using category/recency/evidence and soft source/topic
   diversity preferences, bounds candidates to 60, reuses
   `deduplicateNewsletterArticles()`, and selects at most 12 stories. Input objects
   are cloned and no existing RSS or newsletter implementation is modified.
6. Only link, title (200 characters), source (80), summary (220 or null), and
   publication time reach the model. Article JSON is capped at 12,000 UTF-8 bytes;
   the entire provider request is capped at 32,000 bytes. No user preferences,
   email addresses, account history, images, or full article text are transmitted.
7. Immediately before generation, one Redis Lua operation reserves a global daily
   attempt using Redis's UTC clock. Failed attempts are never refunded. Defaults
   are 48 attempts/day, a 20-second model timeout, and 1,200 output tokens.
8. Anthropic's official TypeScript SDK calls the Messages API at the fixed
   `https://api.anthropic.com` endpoint. `output_config.format` supplies a JSON
   schema and `output_config.effort=low` reduces unnecessary reasoning for this
   short task. There are no tools, redirects, streaming, or automatic retries.
   SDK logging and OpenTelemetry are explicitly disabled. Only the server reads
   `ANTHROPIC_API_KEY`; provider/store modules use `server-only`.
9. Both the provider and service validate output. Every item must have a bounded
   headline/explanation and 1–3 exact input links. Extra fields, unknown/altered
   links, repeated headlines/references, empty output, and URLs in prose are rejected.
   Source names, titles, and clickable URLs are resolved from application input.
10. Success is published atomically with a success cooldown matching cache duration.
    Cache keys include provider, model, cache-contract version, limits, and cache settings. Compatible
    editorial refinements preserve valid existing caches until expiry; cached evidence is
    revalidated in its stored order. Budgets and
    the lease remain global across configuration changes. Only validated output is
    stored; authenticated HTTP responses use `private, no-store`.

The stored record includes its input fingerprint and selected metadata so cached
references can be revalidated. No Supabase migration or service-role access is needed.

## Claude provider compatibility

The selected exact model is **`claude-haiku-5-5`**, documented as active and the
current Haiku model on November 13, 2026. Its fixed ID has no date suffix or separate
alias. It is intended for fast, inexpensive high-volume tasks. Official model
documentation lists $0.10/million input tokens and $0.50/million output tokens for
prompts up to 100,000 tokens; confirm pricing before rollout. Model selection remains
explicit configuration, with no implicit fallback to another model.

The unchanged application schema includes string length and array count limits
Claude does not accept on the wire. The official SDK's `transformJSONSchema()`
removes unsupported keywords from a cloned wire schema and preserves their intent
as descriptions. The original schema and all local business validation remain
unchanged: item/character/reference limits and **exact, case-sensitive input links**
are still enforced. Enum output is not trusted without those checks.

Messages requests use `system`, `messages`, `max_tokens`, and
`output_config.format={type: "json_schema", schema: ...}`. The adapter selects text
content blocks by type rather than assuming the first block is text (Haiku may
return thinking blocks). Only `stop_reason=end_turn` can succeed. Refusals,
`max_tokens`, context exhaustion, tool/pause stops, absent text, malformed JSON,
and invalid references are rejected, with no automatic continuation or repair.
`usage.input_tokens` and `usage.output_tokens` map to existing token metrics;
thinking tokens count toward the output budget. Very low token limits may truncate
the answer even with low effort.

The official SDK handles authentication headers (SDK 1.8.0 uses bearer
authentication), content blocks, and typed API errors. The adapter translates
401/403, 408/timeouts, 429, connection failures, and other errors into safe local
codes, without returning headers, raw API errors, or refusal text. The existing
64 KiB provider-response cap, input caps, timeout settings, and no-retry policy
remain in effect. Claude has no equivalent Messages `store: false` field; none is
sent. Review Anthropic's data handling/account settings separately before rollout.

## Failures and cost containment

Missing configuration, unavailable Redis, provider failures/timeouts/refusals,
incomplete or malformed output, and exhausted generation quotas fail closed.
The route returns a safe message and a retry interval where known. No raw provider
or Redis errors, prompts, or credentials are passed to logging. Existing logging
conventions report cache outcome, duration, model, counts, and token usage only.

A failed model attempt gets a short retry cooldown (30 seconds by default), not a
full 15-minute success cooldown. After that, another attempt can succeed if daily
budget remains. A valid cached briefing is served even when generation budget is
exhausted. An empty feed makes no paid call. Individual feed failures are isolated
by existing RSS logic; available valid stories can still produce a briefing.

The cost controls cap calls, input bytes, and output tokens, not a guaranteed dollar
amount. Actual prices depend on the configured model. A timeout can still be billed
by the provider. Standalone smoke calls bypass application quotas and must be
accounted for separately. Monitor provider billing in addition to application logs.

## Local setup

1. Keep `.env.local` private; use `.env.example` for placeholders. Configure existing
   Supabase URL/anon key and Upstash REST URL/token. For the shared Redis database,
   set server-only `REDIS_KEYSPACE=dev` locally and restart old local processes.
   This isolates application keys, not credentials or resource limits. Prefer a
   development Supabase account for account testing.
2. Set `APP_BASE_URL=http://localhost:3000` (match the browser origin exactly),
   `ANTHROPIC_API_KEY`, `AI_BRIEFING_PROVIDER=anthropic`, and
   `AI_BRIEFING_MODEL=claude-haiku-5-5`. Install dependencies with `npm ci`.
   There is deliberately no implicit model default or alternate-provider endpoint.
   Remove the old provider/key settings from your private local environment yourself;
   the migration does not read, print, or modify private credentials.
3. Leave `AI_BRIEFING_ENABLED=false` until paid testing is approved. After approval,
   set it to `true`, restart `npm run dev`, sign in, and click **View AI Briefing**.
   This may incur a paid API call on a cache miss.
4. Production additionally requires `AI_BRIEFING_PRODUCTION_VERIFIED=true` after
   explicit rollout approval and the security/configuration review below. Do not
   set this just to work around an unavailable panel during testing.

Configurable settings and accepted safety ranges:

| Environment variable | Default | Range |
| --- | --- | --- |
| `AI_BRIEFING_CACHE_SECONDS` | 900 | 60–3600 |
| `AI_BRIEFING_DAILY_ATTEMPTS` | 48 | 1–1000 |
| `AI_BRIEFING_RETRY_SECONDS` | 30 | 5–300 |
| `AI_BRIEFING_USER_REQUESTS_PER_MINUTE` | 5 | 1–30 |
| `AI_BRIEFING_TIMEOUT_MS` | 20000 | 1000–30000 |
| `AI_BRIEFING_MAX_OUTPUT_TOKENS` | 1200 | 200–2400 |
| `AI_BRIEFING_MAX_ARTICLES` | 12 | 1–12 |
| `AI_BRIEFING_MAX_ITEMS` | 5 | 1–5 |
| `AI_BRIEFING_MAX_INPUT_BYTES` | 12000 | 1000–12000 |
| `AI_BRIEFING_HEADLINE_CHARS` | 120 | 20–120 |
| `AI_BRIEFING_EXPLANATION_CHARS` | 400 | 40–400 |

Invalid configuration fails closed. Very small output limits can cause incomplete
responses, which are rejected without a repair call. Existing IP limits remain
5/minute. User limits are new fixed 60-second windows; daily generation quotas
reset at midnight UTC. Redis commands have 5-second abort signals and no retries.

## Deterministic checks and opt-in smoke test

```powershell
npm run lint
npx tsc --noEmit
npm test
npm run build
# Safe guard check: prints a message and makes no provider request.
node --experimental-strip-types scripts/smoke-ai-briefing.mjs
# Optional local real-component Chrome checks; provider responses are mocked.
node scripts/validate-ai-briefing-ui.mjs
```

Automated tests use actual pure functions, VM-transpiled provider/route/store
modules, the actual official Anthropic SDK with a mocked HTTP boundary, and
explicit model/auth/Redis mocks. No paid calls or production writes
occur. Service tests exercise concurrency and recovery using an in-memory store;
Redis adapter tests verify command wiring and ownership guards. These do not
execute Lua against a real Redis server: distributed integration remains a rollout
check, including UTC rollover, expired leases, and simultaneous workers.

Only after approval, with credentials configured locally, run one paid synthetic
fixture call (not live RSS and not an end-to-end authenticated route check):

```powershell
$env:AI_BRIEFING_LIVE_SMOKE_APPROVED = "true"
node --env-file=.env.local --experimental-strip-types scripts/smoke-ai-briefing.mjs --allow-paid-call
Remove-Item Env:AI_BRIEFING_LIVE_SMOKE_APPROVED
```

The smoke script uses the real provider adapter through the same VM loader used by
tests because ordinary Node does not implement Next's `server-only` boundary.
It prints only success, model, item count, and usage; raw model output is not logged.
Use a development Anthropic project/key and a small provider-side spend limit.
The smoke script sends exactly one synthetic metadata request with SDK retries
disabled. Leave both application feature flags false for this standalone test.
Afterward unset the approval variable and confirm usage in the provider console.

## Limits and rollout review

Reference validation proves that links came from supplied articles; it does not
prove factual entailment. Review sample briefings for unsupported claims,
attribution, duplicated stories, headline-only evidence, and malicious publisher
instructions. Prompt-injection fixtures test instruction construction, not immunity.
The existing similarity deduplicator is heuristic and can merge or miss stories.
Selection favors recency and does not guarantee balanced publisher/topic coverage.
The RSS API does not expose per-feed failure status. There is no stale briefing
fallback, streaming, personalization, or automated model judge in this milestone.

Before production approval: verify provider model/schema compatibility and budget,
exercise real Redis concurrency/rollover, review browser behavior, confirm origin
and proxy IP handling, and inspect telemetry for leakage. Existing Sentry
sanitization is not wired up; the new route contains/sanitizes its errors and sends
no account data to the provider, but that does not replace reviewing actual deployed
telemetry. See the separate [follow-up tickets](FOLLOW_UP_ISSUES.md).

Official Anthropic references, checked November 13, 2026:

- [Claude Haiku 5.5 model ID, status and pricing](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
- [Haiku migration guide: fixed ID, thinking and content blocks](https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide)
- [Structured outputs, schema limitations and stop reasons](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Official TypeScript SDK, retry and timeout options](https://platform.claude.com/docs/en/cli-sdks-libraries/sdks/typescript)

## Final review updates

See [AI pre-deployment review](AI_PREDEPLOY_REVIEW.md) for sanitized provider failure
categories, prompt `metadata-v2`, the exact-input grounding audit, current price
calculations, cache-scope rollover and deployment blockers. No source validation
was relaxed; prefixes and quota/lease/cooldown keys remain unchanged.

If a local Next dev server is already running, use PowerShell:

```powershell
$env:AI_UI_ORIGIN='http://localhost:3000'
node scripts/validate-ai-briefing-ui.mjs
```

This adds/removes a temporary local fixture route and mocks every briefing request.
It waits for hydration and checks five items, all UI states and keyboard/touch
access at four widths. Screenshots remain ignored under .next. Without
AI_UI_ORIGIN the script owns a server on port 3102; stop other dev servers for
this same worktree first. It never changes feature flags or invokes a provider.

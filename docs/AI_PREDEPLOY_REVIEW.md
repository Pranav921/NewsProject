# AI Briefing pre-deployment review

Review date: November 13, 2026 (local time). Decision: ready for human code review;
**not approved for production AI enablement**. No commit, push or deployment was
performed. No new Claude requests, email sends, Redis writes or production data
changes were performed. One exact development cache entry was read for grounding
review; no production keys were accessed.

## Changes in this review

- `components/AiNewsBriefing.tsx`: compact numbered editorial rows, separators,
  responsive button/layout, h2/h3 hierarchy, visibly underlined publisher citations,
  44px citation targets, new-tab announcement and a loaded-item status. Generation
  time and metadata-only disclaimer remain. An empty successful response now shows
  an understandable retryable error instead of a blank list. No animation added.
- `lib/ai/briefing.ts`: typed, fixed validation categories; same rejection rules.
  Prompt explicitly requires unique headlines and links across the whole briefing,
  short explanations and fewer items when appropriate. It prohibits merging
  reports based solely on location/timing. Prompt version is now `metadata-v2`.
- `lib/ai/provider.ts`: sanitized categories for malformed JSON, invalid envelope,
  missing/schema fields, output limits, prose violations, duplicates and citations.
  Existing refusal, incomplete output, HTTP and timeout handling remains.
- `tests/ai-briefing-provider.test.mjs`: diagnostic-category cases and a five-item
  metadata-copy fixture using the actual SDK with a mocked transport.
- `scripts/validate-ai-briefing-ui.mjs`: five-item/long-citation fixtures, empty
  response checks, touch targets, keyboard access and screenshots. Loading checks
  wait for hydration and explicitly release mocked responses. AI_UI_ORIGIN can
  reuse an existing loopback-only server without stopping it.
- Documentation: this report, `AI_BRIEFING.md`, `AI_DEVELOPMENT.md`, README and
  PROJECT_OVERVIEW. No authentication, newsletter or RSS code changed in this review.

The worktree also contains previously approved but uncommitted AI, auth, RSS and
performance changes. They must be reviewed as part of the eventual release; this
review did not discard them. Nothing is staged. The current branch is `main`.

## Reliability investigation

The historical `invalid-provider-response` merged malformed JSON, invalid response
envelopes and business validation errors into one code. The historical raw response
was not retained, and the available local log did not provide its precise reason.
A later successful response does not establish that the original cause is fixed.

New safe codes distinguish `provider-malformed-json`, `provider-invalid-envelope`,
`provider-output-schema`, `provider-output-limits`, `provider-output-text`,
`provider-output-duplicate` and `provider-output-citation`. Existing
`provider-refusal` and `incomplete-provider-response` still fail closed. No raw
provider text, prompts, reasoning, headers or credentials are added to logs. Unknown
failures retain the generic fallback. Route responses remain generic and private.

One concrete reliability mismatch was found: validation forbids reuse of a source
link across items, but the prior prompt did not explicitly state that global rule.
The prompt now matches it. This is a plausible prior failure mechanism, not proof
that it caused the historical error. No validation was relaxed and no automatic
paid retry was added.

Official [structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
supports raw JSON schemas through output_config.format and explains the SDK's
transformation of unsupported constraints into descriptions. The adapter sends
the transformed schema and validates against the original business limits.
`claude-haiku-5-5` remains explicitly configurable, with low effort and no tools.
The [model documentation](https://platform.claude.com/docs/en/models/haiku-5-5/overview)
confirms the model ID and capability family. Existing model/provider settings and
generation limits remain configurable; no production configuration was changed.

The default 1200 output tokens can support five short items but cannot guarantee
five items at every allowed character/URL limit. Repeating long canonical URLs
consumes tokens. The schema accepts 1–5 items, and the prompt now encourages fewer,
shorter items. Truncation is rejected even if partial JSON happens to parse.
Increasing token limits requires an explicit cost/configuration decision, not
weaker validation or silent retries. Synthetic five-item success is not a live
token-capacity benchmark. The changed prompt has not been paid-tested.

## Grounding review against exact stored model inputs

A read-only GET of the exact development cache scope found the previous
metadata-v1 result generated at `2026-11-14T03:51:59.627Z`. It retained all 12 input
articles with their actual truncated summaries and the five model output items.
The review used those inputs, not full articles or titles alone.

| Item | Metadata support and limitation |
|---|---|
| FAA ground stop lifted | CBS title/summary support the lifting, telecom-outage attribution and funding call; Guardian summary supports open airspace/problem identification. Component claims are supported; the causal wording should remain attributed. |
| China meeting | BBC title/summary support participants, timing and nuclear reduction; NYT metadata supports the Iran topic. Output softened planned discussion to “may”; no independent event verification was performed. |
| Mississippi boat crash | Guardian title/summary support accounted-for passengers/crew, no deaths/critical injuries, tanker/cruise-ship collision and mayor's characterization. |
| Brooklyn collapse | NYT metadata supports the oversight mechanism; CBS title supports injuries to a man's wife/son and his request for answers. The metadata does not explicitly establish these are the identical collapse, so the combined item has an unresolved event-identity inference. |
| Measles | Al Jazeera title supports the death count/additional deaths; its supplied summary supports the case count. |

References matched supplied links. This is a narrow human-style metadata audit,
not verification that publisher reports are true. Citation membership and JSON
validation cannot detect every unsupported inference. The new event-merging prompt
addresses the identified risk, but prompting is not a factuality guarantee. Keep
the disclaimer and require review of representative future outputs before enablement.

## Cache and cost safeguards

| Control | Current behavior |
|---|---|
| Cache scope | Provider, prompt version, model, content limits, cache duration and output-token cap are hashed. Cache results are revalidated. |
| Briefing cache | 900s default, configurable 60–3600s; shared within a server environment. Cache hits skip article loading and model invocation. |
| RSS Redis snapshot | 90s, nonempty results only. Existing RSS identity/deduplication reused. |
| Global generation lease | NX/EX 90s; publication/failure/release check ownership. |
| Attempt budget | 48/day default, configurable 1–1000; reserved atomically before model call using Redis UTC time. Failed attempts are not refunded. |
| Failure cooldown | 30s default, configurable 5–300s; successful retries remain possible afterward. |
| Success cooldown | Briefing cache interval; prevents immediate regeneration from scope/config changes. |
| Request limits | Existing 5/minute IP limit plus 5/minute authenticated-user limit by default, including cache hits. |
| Provider transport | 20s default timeout, zero SDK retries, 64KiB response cap, 1200 output tokens by default. |
| Input | At most 12 recent articles, 12000 metadata bytes; request parameter bytes separately capped at 32000. No accounts/full articles sent. |

Prompt v2 changes the cache scope only. Prefixes, quota, cooldown and lock keys are
unchanged. Old cache entries expire naturally. Existing success cooldown may
temporarily delay a v2 cache miss; no budget reset or parallel lease is introduced.
Do not delete legacy keys to bypass this. Next user-triggered cache misses may cost
money; none were triggered in this review.

Dev and preview prefixes remain separate. Production retains `@upstash/ratelimit`
and `kicker:{ai-briefing}:v1:` until a separately approved rollover. Shared physical
Redis and its standard token provide no credential isolation; storage, command
allowance, availability and billing are shared. Environment budgets are independent,
not a cross-environment Claude account billing cap.

## Estimated Claude costs and actual billing

Current official [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)
lists Haiku 5.5 standard requests with prompts up to 100K tokens at **$0.10 per
million input tokens / $0.50 per million output tokens**. This bounded input uses
that tier; no batch or prompt-cache discount is assumed.

Formula: `(inputTokens × 0.10 + outputTokens × 0.50) / 1,000,000` USD.

- Previously user-reported measured smoke test, 842 input / 107 output:
  **$0.0001377** (0.01377 US cents). That was a one-item synthetic smoke test.
- The exact five-item cached result does not retain usage, and no usable token
  sample was found in the available local log. Its actual cost cannot be computed.
- Illustration only: 3000 input / 1200 output would be **$0.0009**. At 48 such
  attempts/day, $0.0432/day per environment. This is not a hard spending bound.
- App cache hits make no provider request and add no Claude token charges, though
  Redis/hosting usage still occurs. Failed provider attempts may still be billed.
  Schema/system overhead is included in provider-reported usage; do not estimate
  exact billing from character counts. Other workspace requests are outside this quota.

To check actual charges, open Claude Console [Usage](https://platform.claude.com/usage)
and [Cost](https://platform.claude.com/cost), select the workspace/date/model/API-key
filters available to your account and compare token totals and request times with
sanitized app usage logs. Confirm the key belongs to the intended workspace.
Review [workspace spend-limit settings](https://support.claude.com/en/articles/9796807-create-and-manage-workspaces-in-the-claude-console)
and organization [Billing](https://platform.claude.com/settings/billing). Workspace
limits have plan/default-workspace restrictions; none were changed here. Billing
access was not available, so these estimates are not an invoice reconciliation.

## Verification and security review

- `npm test`: **148 passed, zero failures**, with mocked provider/Redis/Supabase.
  Cache-hit tests assert no additional model calls; refusal, truncation, malformed
  output, missing fields, unknown/repeated citations and output caps remain covered.
- `npm run lint`: passed. `npx tsc --noEmit`: passed. `npm run build`: passed with
  AI disabled for that process. Production feature flags were not changed.
- Mocked Chrome tests: passed loading/error/empty/expanded/collapsed states,
  five-item display, trusted links, generation time/disclaimer, cached reopening,
  keyboard navigation/Space activation, 44px citation targets and no overflow at
  320/390/768/1440px. Screenshots were visually reviewed on desktop/mobile and are
  local ignored artifacts `.next/ai-review-*.png`. No runtime/hydration errors.
- Initial browser attempts exposed a same-worktree dev-server conflict and
  timing-sensitive loading/key-event simulation. The harness now supports an
  existing local server, waits for hydration and explicitly completes fake requests.
  The final run passed; no running user server was terminated.
- Earlier approved live DNS/PING, disposable Redis SET/GET/DELETE, shared-tag EVAL
  and owner-checked release passed in the previous task. Those live writes were
  not rerun. Full distributed concurrency/UTC rollover remains mocked, not live-verified.
- One exact dev-cache GET was real external-service access in this review. No new
  Claude request or full end-to-end generation was performed. User-reported local
  generation is prior evidence, not a model run performed by this review.
- Heuristic scan of 159 included tracked/untracked files and staged/unstaged diffs
  found no current private env credential values, recognizable Anthropic/JWT/GitHub
  token patterns or private-key markers. `.env.local` is ignored and untracked;
  no private .env files are tracked; the index is empty. A separate scan of 22
  built client JavaScript files found no current private credential values.
  This is not a complete
  credential-history audit or an independent security assessment.
- Full worktree changes include auth/RSS/performance work as well as untracked AI
  files. `git diff` alone omits untracked additions: include those in human review.
  Package/lock changes add the official Anthropic SDK; no OpenAI runtime dependency
  was found. No prompts, model output or credentials were added to application logs.
- Existing auth logs include account identifiers; the broader logging/privacy
  review is still required. The custom Sentry sanitizer remains unwired
  (KN-SEC-001); provider-local error sanitization does not establish global
  telemetry/header redaction. Resolve/review this before production AI enablement.
- MODULE_TYPELESS_PACKAGE_JSON remains a direct Node TypeScript-import warning.
  Package module type was not changed solely to suppress it.

## Production authentication and configuration blockers

No connected Vercel environment/settings access was available. Current deployed
URLs, tokens and flags were not inspected; local success does not prove production
configuration is correct. The earlier production 500 is still not attributed to a
confirmed deployed cause. Old deployed rate-limit code can still throw Redis errors
until the reviewed fix is deployed. New code returns sanitized 503 on Redis outage.

Before deployment, manually confirm the Production environment uses the current
shared database's REST URL and standard token (not deleted database credentials),
VERCEL_ENV is exposed as `production`, and there is no inherited `REDIS_KEYSPACE=dev`.
That conflict correctly fails closed with 503. Do not copy local env files to Vercel.
Missing/invalid Supabase URL/key can still break production pages/authentication.
Verify auth Site URL/redirect settings and the exact production origin. Retain
existing newsletter/analytics credentials; do not rotate/change them as part of this.

Required existing app configuration: NEXT_PUBLIC_SUPABASE_URL,
NEXT_PUBLIC_SUPABASE_ANON_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN and
the correct APP_BASE_URL (or existing public fallback). Preserve existing
SUPABASE_SERVICE_ROLE_KEY, Resend/cron, analytics and monitoring settings for their
existing consumers. No new AI database migration is required.

Before eventual enablement: server-only ANTHROPIC_API_KEY,
AI_BRIEFING_PROVIDER=anthropic, AI_BRIEFING_MODEL=claude-haiku-5-5, reviewed limits
from .env.example, and separately approved AI_BRIEFING_ENABLED /
AI_BRIEFING_PRODUCTION_VERIFIED. Both flags default to false/disabled. Current
deployed values must be confirmed manually; they were not read or changed here.

## Exact staged deployment checklist — execute only after approval

1. Review this diff and the untracked file inventory. Include prior performance,
   namespace and auth changes explicitly; do not silently omit imported helpers.
   Keep screenshots, .next, private env files and local profiles out of Git.
2. Create a review branch from the current worktree. Stage reviewed paths
   explicitly, including package/lock, .env.example, all AI/helper/tests/docs files
   and required earlier app changes. Inspect `git diff --cached --check`,
   `git diff --cached --stat` and the complete staged patch. Repeat the credential
   scan against the staged snapshot. Do not use forced adds of ignored env files.
3. Obtain commit/push approval. Commit the reviewed snapshot and push the review
   branch/PR, not main. Check whether branch pushes auto-create Vercel Preview
   deployments before pushing; deployment requires separate approval too.
4. Confirm scoped Preview and Production settings manually. Keep BOTH AI flags
   false, including inherited Preview values; VERCEL_ENV selects the correct
   namespace. No REDIS_KEYSPACE=dev override on those environments. CI must run
   npm ci, lint, type checking, tests and build. CI never runs the paid smoke test.
5. With deployment approval, create a disabled-feature Preview. Test homepage,
   existing-account auth/logout, dashboard, saved stories, navigation and settings.
   Confirm AI panel absent and endpoint unavailable without a provider call. Do not
   invoke newsletter sending or create unsolicited accounts/emails during checks.
6. After review/CI/preview approval, merge/deploy with AI still disabled. Remember
   pushing/merging main may automatically deploy. Verify `/api/health`, route
   registration, actual production login, RSS and sanitized logs. Preserve legacy
   production Redis quotas/locks. Existing cron schedules remain operational;
   never manually trigger them as a test.
7. Stop before enabling AI. Resolve telemetry redaction review, confirm model/key
   access and workspace budget, review metadata-grounding limitations, verify
   Redis production connectivity/configuration through an approved safe procedure,
   and approve any real distributed concurrency/rollover test separately.
8. Obtain explicit production-enable and paid-generation approval. Set reviewed
   flags/configuration through a separate deployment change. Approve one bounded
   authenticated generation, inspect safe usage/error logs and exact metadata
   support, then confirm a second cache hit makes zero model calls. Check Console
   billing. Do not flush/reset quotas to make a test pass.
9. Roll back AI by disabling its flags/redeploying if issues occur. Preserve Redis
   data and existing app behavior; any code rollback must account for older
   namespace behavior and worker overlap. No prefix migration is part of rollout.

Current stop point: **awaiting human approval before staging/committing, pushing,
deploying or enabling generation**. No production approval is implied by passing
mocked tests or the successful local build.

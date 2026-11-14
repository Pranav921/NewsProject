# Briefing editorial refinement — November 14, 2026

This update changes only the briefing selection, compatible prompt guidance and
presentation. Production is reported working by the owner; no production settings,
Redis data or model requests were used for this review. Default flags stay disabled.

Files changed:

| File | Purpose |
| --- | --- |
| `lib/ai/briefing.ts` | Deterministic editorial ranking and compatible prompt revision |
| `lib/ai/service.ts` | Revalidate cached evidence in stored order |
| `components/AiNewsBriefing.tsx` | Editorial layout, disclosure, cache labels and manual expiry refresh |
| `tests/ai-briefing.test.mjs` | Selection, diversity, recency, duplicate-event and prompt regressions |
| `tests/ai-briefing-service.test.mjs` | Old/new cache orders never cause redundant generation |
| `tests/fixtures/briefing-editorial.mjs` (new) | Fixed synthetic metadata and grounding-review examples |
| `scripts/validate-ai-briefing-ui.mjs` | Mocked browser coverage including expiry and wide desktops |
| `docs/AI_EDITORIAL_REVIEW.md` (new) | Decisions, evidence, limitations and rollout |
| `docs/AI_BRIEFING.md` | Current behavior and cache policy |
| `docs/AI_DEVELOPMENT.md` | AI assistance provenance and version policy |
| `PROJECT_OVERVIEW.md` | Briefing refinement summary |

## Selection and evidence

The old selection took the newest 60 valid articles before event deduplication.
A sports-feed burst could exclude less recent public-interest news entirely.
The new deterministic ranking considers all valid articles in the same 24-hour
window, then bounds the event-deduplication pool to 60 and model input to 12.
Canonical link identity and the shared newsletter event deduplicator are unchanged.
Deduplication runs on cloned metadata; newsletter and RSS behavior are unchanged.

The explicit editorial preferences are:

- General/politics/health: 6; business/environment: 5;
  science/technology/education: 4; sports/entertainment: 0.
- Recency adds 0–3 across the 24-hour window; an available summary adds 0.5.
- A small headline-only public-impact cue adds 1 for evacuation, earthquake,
  ceasefire, election, interest rates, court ruling, public health, emergency or
  legislation. These are English lexical heuristics, not factual significance tests.
- Repeated categories subtract 0.8 per prior selection, capped at 2.4;
  repeated sources subtract 0.6, capped at 1.8. Neither excludes an article.
- Ties use newest publication time, then canonical link. After event deduplication,
  diversity preferences are recalculated without the duplicate reports.

These are reviewable editorial defaults, not objective importance, personalized
recommendations, publisher credibility rankings or category quotas. Sports can
still appear when supported by the available selection. A general feed may label
sports as general; incomplete category metadata limits the ranking. The selected
pool can still miss consequential stories. The model receives preference order,
not scoring values, category labels, account data or extra article fields.

The prompt aims for five items when supported, allows fewer with insufficient
evidence, and asks what happened and why it matters only when explicitly supported.
It retains the prohibition on outside context, speculation, causal inventions,
uncertain-event merging, invented references and following publisher instructions.
Output shape, source validation, provider error categories and limits are unchanged.
Valid citations do not establish that each generated claim follows from metadata.

## Cache compatibility and costs

`BRIEFING_EDITORIAL_REVISION=editorial-v1` records the compatible prompt refinement.
`BRIEFING_VERSION=metadata-v2` remains the cache-contract version. Existing valid
briefings finish their TTL; no deletion, dual read, eager regeneration or cache-scope
change is needed. On read, cached input is still canonicalized, bounded, deduplicated
and validated, but its stored order is preserved. Reranking cached records would
discard category information (which is deliberately not stored/sent) and spuriously
invalidate valid caches. Regression tests cover old/new orders, no feed/model calls,
no lock acquisition and exhausted budgets. Safety-contract changes still require a
cache-version bump; this compatible editorial preference does not.

Pre-push review found that old deployed readers reject editorial-order metadata.
New generations therefore persist metadata chronologically (publication time,
then canonical link), while Claude receives editorial order and output items keep
their editorial order. The fingerprint covers the persisted metadata. An actual
comparison against the previous Git version reproduced rejection of editorial
order and acceptance of chronological storage. A service regression covers the
model/storage order separation, intact citations and subsequent cache reuse.
This prevents a new ordering-only rejection during mixed-version serving or rollback.

The next ordinary cache miss uses the revised selector/prompt. During rolling
deployment a valid old worker result may remain until expiry; both versions share
the same locks, attempt budgets and cooldowns. No Redis keys or Lua change.
Default cache duration remains 900 seconds, input 12 articles/12000 bytes, output
1200 tokens, five items, and 48 generation attempts/day. The longer prompt adds a
small fixed input cost per generation; metadata/output limits and call frequency
are unchanged. Selection may change actual metadata token counts within the same
cap. No live token usage or dollar-cost measurement was performed for this revision.
The system prompt increased from 1135 to 1618 UTF-8 bytes (+483). A rough
four-characters-per-token estimate suggests about 120 extra input tokens; the
actual Claude tokenizer count is unmeasured. Cache hits still use zero model tokens.

The UI distinguishes `Shared cached briefing` from `Generated on request`, using
the existing response's `cacheHit` value. Generated time and cache expiry are not
claims of news freshness. At expiry it shows an earlier-briefing notice and offers
explicit refresh; it never polls or automatically generates. Fresh reopen uses the
browser's in-memory result and makes no request. Citation links keep their trusted
titles, new-tab disclosure, keyboard focus and minimum 44px touch targets.

## Fixed evaluation and human review

`tests/fixtures/briefing-editorial.mjs` has synthetic evacuation, rates, health,
legislation, environment, science, sports and entertainment metadata. Automated
fixtures require the first five public-interest stories despite newer sports;
additional cases exercise a 70-article sports burst, source variety, single-category
availability, recency, headline-only evidence and duplicate explosion/plant reports.
This tests deterministic selection and boundaries, not real model quality.

For an approved later output review, compare every sentence to the exact selected
title AND summary sent to Claude, not just the source title or linked full article:

1. Does it say what happened with the same actor, status, scale and uncertainty?
2. Is any significance, number, forecast or causal connection explicitly supported?
3. Does a null summary stay within the headline's evidence?
4. Is each event covered once, without merging separate incidents by location/time?
5. Are up to five concise items useful together, with variety when available?
6. Are source references exact and attached to the appropriate statement?

The fixture's `groundingReview` pairs acceptable and unsupported examples. An
assistant review against those fixtures confirms that lower interest rates do not
establish next-month mortgage payments; a recall with no reported illnesses does
not establish widespread illness; an unsigned bill is not an effective law; and a
nebula photograph alone does not establish a scientific theory. This is a review
of synthetic evidence, not a human review or factual verification of model output.
Human editorial sign-off and a new real-model quality sample remain pending.

## Safe rollout

Verification performed for this revision:

- Pre-push verification: `npm test` has **157 passing tests, zero failures**,
  including the added chronological-storage regression. A separate in-memory
  experiment ran the actual previous Git version's service/selector against a
  newly generated cache: it returned a five-item cache hit with no additional
  model invocation or lock acquisition. These are mocked services, not live Redis.
- `npm run lint` and `npx tsc --noEmit`: passed.
- `npm run build`: passed with both AI flags disabled in that command's environment.
  The first sandboxed build could not fetch existing Google Fonts; the
  network-enabled retry compiled and generated the production routes successfully.
- `node scripts/validate-ai-briefing-ui.mjs`: passed in local headless Chrome with
  mocked briefing responses at 320, 390, 768, 1440 and 1920px. Checked loading,
  empty, session/rate-limit/unavailable/network errors, collapsed/expanded states,
  keyboard source navigation, new-tab disclosure, no horizontal overflow, 44px
  citation targets, 768px reading-width bound, cache-origin labels, expiry notice
  and explicit refresh. Expiry and fresh reopen made no automatic request.
  The sandboxed DevTools attempt timed out; the permitted local retry passed.
- No live Claude or Redis tests, production auth test or production UI test was
  performed. The existing Node `MODULE_TYPELESS_PACKAGE_JSON` warning remains.

1. Review the focused diff and test/browser evidence; approve commit/push separately.
2. Use Preview with paid generation disabled to verify the layout with mocks and
   confirm auth/origin and correct preview keyspace behavior.
3. Before separately approved production deployment, confirm current Production
   credentials/scopes and `REDIS_KEYSPACE` unset or `prod-legacy`, never `dev`.
   Do not change keys, reset quotas, delete caches or migrate production prefixes.
4. For a rollout that guarantees no paid generation during smoke checks, explicitly
   disable both AI flags in Production with approval and create the deployment.
   Check login and normal feed behavior first. Environment edits require deployment.
5. After explicit approval, restore reviewed production flags in a new deployment.
   Let the existing valid briefing expire naturally. One approved authenticated
   generation can then be checked against its exact metadata and usage logs;
   repeat access should report a cache hit without another model request.
6. If editorial quality regresses, roll back the code through the normal approved
   deployment flow or disable AI flags/redeploy. Preserve existing Redis data.

Do not rotate credentials, change Vercel settings, push, deploy or call Claude as
part of these automated/browser checks. Shared Redis remains logical keyspace
separation, not credential or resource isolation. The previously documented global
Sentry sanitization follow-up is not resolved or deployed by this UI refinement.

## Concrete pre-push plan

Verified GitHub account: `Pranav921`, with repository push permission. Commit author
configuration: `Pranav921 <pranav.ar921@gmail.com>`. HTTPS GitHub credentials come
from the host-specific `gh auth git-credential` helper, overriding the generic
Git Credential Manager helper. No identity/remote change is proposed.

Remote: `https://github.com/Pranav921/NewsProject.git`. Current local branch is
`review/claude-ai-briefing-launch` at `e6d299b`; it was already merged. Remote main
is `a1e5e0af96990cde5872fa61e1db373a78c859b8`; GitHub's comparison shows no file
differences between that merge and the local base. Production and Preview deployment
records for those commits both report success. This is deployment metadata, not
a current authenticated production smoke test or verification of domain assignment.

After explicit commit/push approval:

1. Fetch main and recheck that it has no unexpected new changes. Create
   `review/briefing-editorial-polish` from current origin/main, carrying the reviewed
   uncommitted changes forward. Do not force-push or reuse the merged branch.
2. Explicitly stage only the 11 files listed above, including the synthetic fixture.
   Recheck the staged patch, whitespace and credential scan. No broad `git add .`.
   Leave `docs/ASK_KICKER_AI_PLAN.md` out of this release commit; it is a separate
   design-only deliverable. No Ask feature code exists.
3. Commit title: `Improve briefing editorial selection and cache compatibility`.
   Body: `Prioritize diverse publisher metadata, refine the responsive briefing UI,
   and preserve chronological cache evidence for rolling deployment and rollback.
   Add deterministic editorial and cache-compatibility regressions.`
4. Push only that new review branch. Existing integration history shows a branch
   push triggered Vercel Preview, and the subsequent main merge triggered Production.
   Current private Vercel Git settings are unverified, so confirm the Preview
   environment has generation disabled before push. GitHub CI runs on PRs and main
   pushes; open a PR after the push and require the current checks before merge.
5. Review Preview, record the currently working production deployment ID, and verify
   Production environment scopes before separately approving merge/deployment.
   Do not merge main merely because branch push was approved.

Production requirements: existing Supabase URL/anon key, current Upstash REST URL
and standard token, exact production `APP_BASE_URL` origin (or existing public
fallback), server-only `ANTHROPIC_API_KEY`, provider `anthropic`, configured model
`claude-haiku-5-5`, and reviewed generation limits. Vercel must provide
`VERCEL_ENV=production`; `REDIS_KEYSPACE` must be unset or `prod-legacy`, never `dev`.
Both AI flags default to false; actual deployed flags must be inspected, not assumed.
Preserve newsletter/cron/analytics credentials and schedules. Global Sentry sanitizer
registration is still absent in repository configs; feature-local sanitized logs
do not establish global redaction. Resolve or explicitly review that production
security gate before paid/live AI verification or the future Ask surface.

For a rollout with no unapproved generation, obtain separate approval to deploy
with both AI flags disabled, smoke-test production login/feed, then separately
approve re-enablement and at most one authenticated generation if needed. Review
each statement against the exact supplied metadata, generated time and trusted
citations; repeat access should show `cacheHit=true`, unchanged generated time and
no second usage-bearing generation log. Check safe failure categories in logs.
Authenticated login/AI checks must use an approved account and must not send email
or modify unrelated user records. They are not performed by this pre-push review.

Rollback: preserve the actual known-working deployment/configuration recorded before
release. Restore that deployment only if its credential snapshot is still valid;
otherwise rebuild the prior code using current verified Production configuration.
Do not promote an old deployment blindly after the Redis database replacement.
The old reader compatibility experiment passed, and metadata-v2 scope plus legacy
quota/lock/cooldown keys remain unchanged. Do not delete Redis data to force refresh.
If necessary, separately approve disabling both AI flags and redeploying while
keeping login and the news feed available.

The current diff/untracked-file scan found no recognizable credentials or local
private credential values. `.env.local` remains ignored/untracked; no private env
files are tracked. This is a current-snapshot heuristic scan, not a history audit.
Nothing is staged, committed or pushed by this review, and no deployment or Vercel
configuration change has been performed.

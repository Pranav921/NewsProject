# Local performance and authentication review

Date: 2026-11-13. Changes are local; nothing was deployed. Existing uncommitted AI
and documentation work was preserved. No model requests, newsletter sends,
production configuration changes or database writes were performed. A read-only
Redis PING was attempted; application Redis keys were not read or changed.

## Measurements and confirmed findings

Measurements used Next development mode, the same computer, Chrome with a fresh
profile, anonymous browsing and disabled AI. Public RSS contents can change between
runs (761–762 stories); these are diagnostic samples, not controlled benchmarks.
Browser reports are ignored local artifacts under `.next/performance/`.

| Measurement | Baseline | Final warm-server run |
|---|---:|---:|
| Browser navigation TTFB | 554 ms | 281 ms |
| HTML response complete | 5,174 ms | 1,095 ms |
| DOM content loaded | 5,394 ms | 1,182 ms |
| Load event | 6,748 ms | 1,255 ms |
| DOM nodes | 66,040 | 2,782 |
| Mounted article elements, desktop + mobile | 1,522 | 60 |
| Browser heap sample | 147 MB | 20 MB |
| Longest observed main-thread task | 2,483 ms | 257 ms |
| Total observed long-task time | 4,562 ms | 525 ms |
| HTML login 404 leaves button stuck | Yes | No |
| Automatic news requests immediately after load | 1 | 0 |

Other measurements:

- The original HTML body was approximately 12.17 MB; updated responses were
  approximately 0.96 MB. Warm full-body server probes improved from roughly
  3.1–7.2 seconds to 557–637 ms. These probes are separate from Chrome navigation.
- Cold feeds still cost time: the final cold-server Chrome sample took 4,325 ms
  for the full response, compared with 1,095 ms warm. First-page work is not gone.
- Next reported startup in 2.3 seconds before changes and 1.9–2.3 seconds after.
  There was no evidence of a large startup-speed improvement.
- All 30 publishers were profiled concurrently. In one direct-fetch sample,
  26 parsed successfully in roughly 330–513 ms; actual Next fetch samples varied
  into the 1–2 second range. CNN failed connection establishment, both Reuters
  feeds failed DNS, and USA Today returned HTML with no RSS items. No publisher
  hit the existing 12-second deadline in that direct-fetch sample.
- Supabase health returned 200 in 668 ms; `/auth/v1/user` without a bearer session
  returned the expected 401 in 195 ms. These were read-only connectivity checks,
  not account login tests.
- The locally configured Redis hostname failed DNS resolution (`ENOTFOUND`). Its
  URL/token are present and the URL parses as HTTPS. No secret values were printed.

Confirmed causes:

1. Rendering every story in both responsive trees created a very large document,
   expensive hydration and multi-second main-thread work. Bounded rendering
   produced the largest verified improvement.
2. AuthPanel had no guaranteed cleanup when fetch/JSON parsing failed. A mocked
   HTML 404 reproduced a permanently disabled Working button; the same browser
   check now displays the error and releases the button.
3. Homepage and API used separate merged-feed caches; development bypassed fetch
   caching, and mount/poll requests explicitly requested fresh RSS. Observed feed
   counts differed between requests (including 193 versus 761). This made update
   counts sensitive to publisher availability and repeated unnecessary fetching.
   The exact history of every reported large update count cannot be reconstructed.
4. Redis initialization/request failures could escape auth handlers because rate
   protection ran before their try/catch. The local Redis DNS failure is concrete;
   its relationship to the reported production 500 is unverified.
5. Lead-image enhancement lacked a deadline and could run during update polls.

## Targeted changes

- NewsList initially renders 30 stories and adds 30 with Show more. Full-feed
  filtering, source/category counts and article identity remain intact. Changing
  the filtered article list resets pagination. Existing responsive designs remain.
- AuthPanel uses a bounded request helper, handles non-JSON errors and resets
  loading in finally for login and signup. Passwords and raw response bodies are
  not logged by the helper.
- Redis protection initializes inside its error boundary, disables transport
  retries, bounds requests to five seconds and returns sanitized 503 + Retry-After
  on failure. Upstash's default fail-open timeout is disabled. Existing five/minute
  policy, 429 responses, production missing-config failure and development
  missing-config behavior are preserved.
- Anonymous pages avoid unnecessary proxy session work; API handlers retain their
  own authentication. Auth-cookie page requests verify claims and propagate updated
  cookies. With asymmetric signing keys this can use cached JWKS. Browser auth
  singleton behavior remains; public NewsFeed does not instantiate an auth client.
  Supabase transports have ten-second per-request deadlines, not a guaranteed
  ten-second total duration across SDK retries.
- A shared process-local per-feed cache provides 90-second freshness, concurrent
  request sharing, 15-second failure backoff and last-good fallback up to 30 minutes.
  Explicit refresh bypasses freshness but shares pending requests and respects
  failure backoff. Parsing, canonical identity and deduplication rules are unchanged.
  Cached articles are copied before category upgrades during merged deduplication.
- News responses expose failed/stale publisher counts. Partial feeds show a
  warning; no available articles produces 503. Failed/empty refreshes keep current
  stories and display an error instead of forcing another route refresh.
- Polls reuse cached feeds, skip lead-image enhancement and no longer run on mount.
  Visibility checks are limited to one per 30 seconds, one request at a time;
  the existing three-minute visible-tab interval remains. Empty initial feeds do
  not announce every recovered article as new.
- Lead-image retrieval has a 1.5-second deadline, shares pending work, caches
  successes six hours and misses one minute, with at most 100 entries.

No dependencies, framework, package module type, Strict Mode, Fast Refresh or
Sentry settings were changed by this milestone. AI provider/business logic and
feature flags were preserved. AI was absent from the measured homepage and made
no requests.

## Files changed in this milestone

New:

- `lib/auth-client.ts`
- `lib/feed-cache.ts`
- `lib/supabase/fetch.ts`
- `lib/supabase/session-policy.ts`
- `tests/performance-regressions.test.mjs`
- `scripts/profile-local.mjs`
- `docs/PERFORMANCE_REVIEW.md`

Updated:

- `app/page.tsx`, `app/api/news/route.ts`
- `components/AuthPanel.tsx`, `components/DashboardView.tsx`,
  `components/PublicNewsView.tsx`, `components/NewArticlesPrompt.tsx`,
  `components/NewsFeed.tsx`, `components/NewsList.tsx`, `components/RefreshButton.tsx`
- `lib/rss.ts`, `lib/article-images.ts`, `lib/news-api.ts`, `lib/news-client.ts`,
  `lib/ratelimit.ts`
- `lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`
- `tests/news-api.test.mjs`, `tests/news-client.test.mjs`
- `README.md`, `PROJECT_OVERVIEW.md`, `docs/FOLLOW_UP_ISSUES.md`

Other dirty/untracked files, including package dependencies and the Anthropic
feature, were already present. They are not attributed to this performance work.

## Verification

- `npm test`: 133 passed, zero failed. The nine new regression tests cover cache
  sharing/expiry/backoff/recovery, auth error variants, session policy, Redis
  failure sanitization and allowed/throttled/missing-config policies, transport
  cancellation, news endpoint failures/poll behavior, login route outcomes and
  client preservation of articles. No live provider requests.
- `npm run lint`: passed, zero errors/warnings.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; `/api/auth/login` is registered in the production build.
- `node scripts/validate-news-ui.mjs --live-homepage`: passed category/source/time
  combinations, reset/empty states, grid/list, saved stories, mocked newsletter
  setting submissions, and fixture plus live-homepage layout at 320, 390, 768,
  1024, 1280, 1440 and 1920 pixels. No hydration/runtime errors.
- `node scripts/validate-ai-briefing-ui.mjs`: passed click-only loading, timestamp,
  disclaimer, trusted sources, cached reopening, four widths and session/rate/
  unavailable/network errors. Provider responses were mocked.
- `node scripts/profile-local.mjs after-warm`: passed Show more, category pagination
  reset, real public RSS refresh, mocked empty-refresh recovery and mocked HTML
  login 404 recovery. Zero browser errors, lock warnings or Fast Refresh events in
  the final warm run; zero spontaneous refresh events in its five-second idle
  window. Four warnings were recorded; separate server logs reported four
  unavailable feeds.
- Node still emits the pre-existing MODULE_TYPELESS_PACKAGE_JSON warning during
  direct TypeScript test imports. Package configuration was not changed to hide it.

## Unresolved findings and practical limits

- Local login initially returned 404 even though the dev route manifest contained
  the handler. Restarting Next alone changed GET to the correct 405 for a POST-only
  route. This supports stale dev-server state; the trigger is unproven. No routing
  rewrite was added. GET 405 alone does not prove a successful password login.
- Production 500 was not reproduced or fixed in production. Inspect deployed logs
  for the exact failing request before assigning a root cause. The Redis failure
  path is repaired locally and regression-tested, but was not deployed.
- Historical 5000 ms GoTrue lock warnings were present in dev logs. Fresh-profile
  browser runs did not reproduce them. Session-request reduction and deadlines
  reduce avoidable work; real existing-session/multiple-tab behavior still needs
  manual verification. No async onAuthStateChange callback deadlock was found.
- A single dev restart after a production build failed to load a generated Sentry
  instrumentation junction despite the target existing on subsequent inspection.
  A second restart worked without changing files. This remains a transient
  generated-artifact/watch issue, not a proven OneDrive or Sentry root cause.
- Process-local feed/image caches do not survive a restart or span serverless
  workers. Cold-start publisher failures have no durable last-good fallback.
- Publisher outages remain external problems. The 12-second feed deadline means
  a slow cold publisher can still delay a complete snapshot. No new cloud cache
  or architectural rewrite was introduced.
- Browser snapshots and short idle windows cannot prove there are no long-session
  regressions. Successful real-account login and deployed monitoring remain untested.

## OneDrive assessment

A synthetic test wrote 100 four-KB files and performed 500 read/stat operations.
Workspace: 152 ms writes, 920 ms reads/stats. OS temp: 104 ms writes, 916 ms
reads/stats. This narrow sample does not establish OneDrive as the main bottleneck;
it does not measure a full Turbopack compile outside OneDrive. The rendering fix
already delivers a large improvement without moving the repository.

Moving is optional, not currently required by the evidence. If unexplained rebuilds
or junction errors recur, compare the same revision in a nonsynced checkout such as
`C:\dev\breaking-news-site`, with its own installed dependencies/generated files.
Do not copy node_modules/.next junctions between locations. Preserve the current
working changes first. No repository move or cache deletion was performed here.

## Manual local checks and environment work

1. In the Upstash console, verify the active database's REST URL and token and
   update the matching values in `.env.local` if necessary. Check DNS/VPN/network
   access if the correct hostname still fails. Never paste credentials into logs.
   Do not bypass rate limiting to make login appear to work.
2. Keep `AI_BRIEFING_ENABLED=false` and
   `AI_BRIEFING_PRODUCTION_VERIFIED=false`. No additional AI configuration or paid
   smoke test is required for this performance verification. No env file was edited.
3. Stop duplicate Next processes for this repository, then run `npm run dev` from
   the project root. Local origin configuration must match the browser origin.
   Open `http://localhost:3000` in one fresh browser profile first.
4. Confirm stories appear, unavailable publishers show a warning, filters and
   Show more work, and Refresh headlines returns to its normal state. Network
   `/api/news` shows `articles` and `feedStatus`; polls occur after three minutes
   without `fresh=1`, manual refresh uses `fresh=1&refresh=1`.
5. Once Redis resolves, sign in with your existing test account. Verify success,
   wrong-password feedback, signup feedback if intentionally testing signup,
   logout and a reload of an existing signed-in session. Observe `/api/auth/login`
   POST status and clear loading state. These real account checks were not run here.
6. Watch sanitized `[ratelimit][unavailable]`, `[rss][feed]`,
   `[rss][feed][unavailable]`, `[rss][snapshot]` and `[news][get]` logs. Do not
   collect passwords, tokens or request bodies. Investigate recurring lock warnings
   with existing cookies and multiple tabs after the single-tab test succeeds.
7. With AI disabled and the server running, optionally repeat
   `node scripts/profile-local.mjs after`. Chrome must be installed or CHROME_PATH
   set. It uses an isolated profile, mocks auth failures and blocks AI/newsletter
   calls. Reports/profiles stay local under ignored `.next/performance/`.

Development assistance: AI inspected code, compared measurements, implemented
targeted changes and generated regression tests. Application model inference was
never used during profiling; mocked tests and measured outcomes, including failed
checks, are distinguished from unverified production behavior above.

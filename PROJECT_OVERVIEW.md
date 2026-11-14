# Kicker News — Complete Project Guide

A deep reference for how this codebase actually works: every feature, the data that
flows through it, and the rules each subsystem follows. Written against the code as
it stands (Next.js 16.2.0 App Router, React 19.2.4, Supabase, Resend, Vercel).

For the short version, see [README.md](README.md). For contributor rules, see
[AGENTS.md](AGENTS.md).

Last reviewed: **November 13, 2026**, against repository HEAD `0d6a4d6` (November 1,
2026), plus the local AI Briefing implementation described in §21. Production
migration state and live publisher availability have not been verified. The AI
feature remains disabled by default. The user reports successful approved local
Claude generation; production is not enabled. See the final pre-deployment review
for the latest evidence and rollout blockers.

Recent changes reflected in this guide:

- **October 30 — newsletter deduplication and subscription labels:** similar
  stories are merged across publishers before newsletter selection, and New York
  Times stories display "Subscription required" on cards and in emails.
- **October 30 — sources and categories:** the catalog grew to 30 feeds from 18
  source names, with ten categories, category filtering, saved-story topics, and
  optional newsletter grouping. A second SQL migration supports these settings.
- **November 1 — newsletter delivery compatibility:** the sender tolerates missing
  optional subscription columns, supports targeting one subscriber with `?email=`,
  and has route-level regression tests. CI now runs Node 24.

---

## 1. What Kicker News Is

Kicker News aggregates 30 configured RSS/Atom feeds from 18 source names into one
deduplicated, newest-first feed, and layers personal features on top for signed-in
users: saved articles, keyword alerts, a configurable email newsletter, and
per-user email engagement analytics.

The app has exactly **two rendering modes**, decided server-side in
[app/page.tsx](app/page.tsx) by whether `supabase.auth.getUser()` returns a user:

| Mode | Component | What you get |
|---|---|---|
| Public (signed out) | [PublicNewsView](components/PublicNewsView.tsx) | Full feed, filters, search, share, sign-in/sign-up panel. Save + alerts prompt for an account. |
| Authenticated | [DashboardView](components/DashboardView.tsx) | Everything above, plus saved articles, alert keywords, feed preferences persisted to Supabase, account settings, newsletter, analytics. |

Both modes render the exact same [NewsFeed](components/NewsFeed.tsx) component with
a `viewerMode` prop, so feed behavior stays identical and only the
persistence/CTA layer differs.

### The one invariant that matters

**`article.link` is the canonical article identity everywhere.** Feed dedupe, saved
articles, newsletter dedupe, click tracking, and new-article detection all key off
it. `normalizeArticleLink()` in [lib/news-updates.ts](lib/news-updates.ts#L26) is the
comparison function: it strips the hash and trailing slashes, leaving everything
else intact. Never introduce a second notion of article identity.

---

## 2. Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16.2.0, App Router, Turbopack |
| UI | React 19.2.4, Tailwind CSS v4 (`@import "tailwindcss"` + `@theme inline`) |
| Language | TypeScript 5 (strict), `@/*` path alias to repo root |
| Auth + DB | Supabase (Postgres + Auth) via `@supabase/ssr` and `@supabase/supabase-js` |
| Email | Resend REST API (`https://api.resend.com/emails`), called with `fetch` — no SDK |
| Rate limiting | Upstash Redis + `@upstash/ratelimit` |
| Errors | Sentry (`@sentry/nextjs`), instrumentation-file pattern |
| Hosting | Vercel (cron defined in [vercel.json](vercel.json)) |
| Fonts | `next/font/google` — DM Sans (`--font-dm-sans`), DM Mono (`--font-dm-mono`) |
| Tests | Node's built-in test runner over `.mjs` files with `--experimental-strip-types` |

Note: **there is no `middleware.ts`.** Next.js 16 renamed it, and this repo uses
[proxy.ts](proxy.ts) at the root, exporting `proxy(request)` plus a `config.matcher`.
It verifies/refreshes Supabase sessions on page requests carrying auth cookies. API handlers authenticate independently; anonymous pages and assets skip proxy auth work.

---

## 3. Repository Map

```
app/
  page.tsx                     Homepage — branches public vs dashboard, emits JSON-LD
  layout.tsx                   Root layout, fonts, site metadata, AnalyticsProvider
  loading.tsx                  Homepage skeleton
  global-error.tsx             Sentry-reporting global error boundary
  robots.ts / sitemap.ts       Generated robots.txt and sitemap.xml
  globals.css                  Design tokens, Tailwind theme, ticker/animation CSS
  account/page.tsx             Authenticated settings page (server data fetch)
  email-analytics/             Authenticated per-user newsletter analytics dashboard
  newsletter/page.tsx          Public newsletter explainer + signup
  about|contact|advertise|privacy|terms/   Public marketing + legal pages
  unsubscribe/success/         Post-unsubscribe confirmation screen
  api/                         All route handlers (see §12)

components/                    All UI. Server components unless marked "use client".
lib/                           All logic. Pure/testable modules + Supabase clients.
tests/                         Node tests across 21 files (pure functions + route fixtures)
scripts/                       Feed/Chrome validation and guarded AI smoke test
docs/                          AI operation, development provenance, follow-up tickets
supabase/migrations/           Two migrations: article_mode; sort_order + saved category
public/                        Logos, favicon, OG/Twitter images
.github/workflows/ci.yml       lint → tsc → test → build on PR and push to main
```

---

## 4. Core Types

Defined in [lib/types.ts](lib/types.ts):

```ts
type NewsItem = {
  category?: NewsCategory;
  title: string;
  link: string;          // canonical identity
  source: string;        // feed display name, e.g. "BBC News"
  summary: string | null;
  publishedAt: string | null;  // ISO 8601
  imageUrl?: string | null;
};

type FeedDefinition  = { category?: NewsCategory; coverage: "national" | "international" | "both"; name; url };
type CoverageFilter  = "all" | "national" | "international";
type SavedArticle    = NewsItem;
type UserPreferences = { defaultSourceFilter; defaultTimeFilter; defaultViewMode };

type NewsletterArticleMode  = "all_missed" | "personalized";
type NewsletterSortOrder    = "default" | "category";
type NewsCategory = "general" | "technology" | "business" | "politics" | "science"
  | "health" | "environment" | "sports" | "entertainment" | "education";
type NewsletterEmailFormat  = "standard" | "compact";
type NewsletterFrequency    = "hourly" | "daily" | "weekly" | "custom";
type SponsorConfig          = { label; title; description; ctaText; ctaUrl };
type EmailSendLog           = { status: "failed"|"sent"|"skipped"; error; articleCount; sentAt };
```

---

## 5. The RSS Pipeline

### 5.1 Feed configuration — [lib/feeds.ts](lib/feeds.ts)

Thirty feeds share 18 source names. Each has a display `name`, `url`, `coverage`,
and optional `category`. The original twelve headline feeds remain, alongside
18 added feeds: BBC technology/business/health/science; Guardian
technology/business/environment/sports/culture/education; NPR politics/health;
and Ars Technica, TechCrunch, NASA, ScienceDaily, PBS NewsHour, Deutsche Welle.
Topic feeds retain their publisher's existing source name.

Coverage lookup is **source-based**: only uncategorized or `general` feed entries
populate the map. Topic-feed coverage does not override a publisher's headline
coverage; topic-only sources fall back to `both`.

| Source | Coverage |
|---|---|
| BBC News, The Guardian, Al Jazeera, Sky News, Reuters World, Deutsche Welle | `international` |
| CBS News, NBC News, USA Today, Reuters U.S. | `national` |
| The New York Times, NPR, CNN, PBS NewsHour | `both` |
| Ars Technica, TechCrunch, NASA, ScienceDaily | `both` (fallback) |

Two exported helpers:
- `getFeedCoverage(source)` — map lookup, defaults to `"both"` for unknown sources.
- `filterArticlesByCoverage(articles, filter)` — `"both"` articles always pass; a
  filtered view keeps only matching plus `both`.

To add a feed: append to `RSS_FEEDS` with a stable name, correct coverage, and an
optional category. Source options are derived from available articles. Account
for the source-based coverage rule above when adding topic-only publishers.

### Categories — [lib/news-categories.ts](lib/news-categories.ts)

The ten display categories, in alphabetical section order, are Business,
Education, Entertainment & Culture, Environment, General News, Health, Politics,
Science & Space, Sports, and Technology.

Dedicated non-general feeds supply the category. Otherwise the parser matches
recognized publisher RSS `<category>` values and Atom `category term` attributes;
it does not infer topics from headline keywords. Unrecognized or absent metadata
falls back to `general`. `getArticleCategory()` supplies the same fallback for
older saved rows. When identical links appear in multiple feeds, a specific
category upgrades a previously general article without replacing its other fields.

### 5.2 Parsing — [lib/rss.ts](lib/rss.ts)

A hand-rolled regex parser with no external parser dependency. Change it only when
parser behavior needs to change; this maintenance guidance also appears in README.md.

How it works:

1. **Block extraction** (`getFeedBlocks`) — grabs all `<item>…</item>`; if none
   exist, falls back to Atom `<entry>…</entry>`.
2. **Field extraction** per block:
   - `title` → `<title>`, HTML-stripped.
   - `link` → `<link>` text, else an Atom `rel="alternate"` href, else any `href`,
     else `<guid>`. Then normalized through `normalizeArticleLink`.
   - `summary` source → first of `description`, `content:encoded`, `summary`,
     `content`.
   - `source` → `<source>` if present, else the feed's configured name.
   - `publishedAt` → first of `pubDate`, `published`, `updated`, `dc:date`, parsed
     to ISO or `null`.
3. **Summary cleanup** (`cleanSummary` in [lib/rss-format.ts](lib/rss-format.ts)) —
   strips CDATA, decodes HTML entities up to three passes deep (feeds
   double-encode), removes tags and bare URLs, collapses whitespace.
4. **Summary truncation** (`truncateSummary`, max 220 chars):
   - Under 50 chars → return `null` (short fragments read as broken; UI shows
     "No summary available.").
   - Try to end on the last full sentence, if that leaves ≥50 chars.
   - Else cut at the last whole word and append `...`.
5. **Image extraction** (`extractImageUrl`), in priority order:
   - Largest `<media:content>`/`<media:thumbnail>` by `width × height`.
   - `<enclosure>` with an `image/*` type.
   - An `<img>` inside the summary HTML — preferring the largest `srcset`
     candidate by `w` descriptor (or `x` density × 1000) over plain `src`.
   - Then `upgradeImageUrl()` rewrites the winner: strips WordPress-style
     `-300x200` size suffixes, forces `w`/`width` to 1600, deletes `h`/`height`,
     and raises `q`/`quality` to 90.
   - `normalizeImageUrl` accepts only `http(s)` and protocol-relative `//` URLs.
6. Items missing a title or link are dropped.
7. `parseRssXml()` assigns the feed/publisher category described above.

### 5.3 Fetch, dedupe, sort — `getAllNewsItems({ fresh })`

- All 30 feeds load in parallel with a 12-second timeout per publisher.
- A process-local, per-feed cache shares pending work and retains successful data
  for 90 seconds in development and production. Explicit refresh bypasses that TTL.
- Failed publishers retry after 15 seconds; last-good stories can be used for up
  to 30 minutes, with unavailable/stale feed counts surfaced to callers.
- Cold-start failures have no persistent fallback. An entirely unavailable news API
  returns HTTP 503; clients keep their existing stories on failed/empty refreshes.
- Custom `User-Agent: breaking-news-site/0.1`.
- `dedupeByLink` keeps the first occurrence per normalized link, upgrading a
  general category if a later duplicate supplies a specific topic.
- `sortNewestFirst` — descending `publishedAt`; missing dates sort as epoch 0.

### 5.4 Lead-image enhancement — [lib/article-images.ts](lib/article-images.ts)

The hero story deserves a better image than RSS usually provides, so
`enhanceLeadArticleImage(articles)` fetches the lead article's own HTML
(`revalidate: 21600` — 6 hours) and extracts the best image:

1. Meta tags: `og:image`, `og:image:secure_url`, `og:image:url`,
   `twitter:image`, `twitter:image:src`, `itemprop="image"` — matched with both
   attribute orderings.
2. JSON-LD — breadth-first walk of every `application/ld+json` block, accepting
   `image` as a string, an array, or an object with a `url`.
3. Any `<img>`: largest `srcset` candidate, then `data-lazy-src`, `data-src`, `src`.

All candidates are resolved against the article URL, so relative paths work. Any
failure returns the articles unchanged. Called from both the homepage and
`/api/news` except update polls. Retrieval has a 1.5-second deadline, shares pending
requests, caches successful images for six hours and failures for one minute.

### 5.5 Effective feed caching

| Layer | Where | TTL | Bypass |
|---|---|---|---|
| Shared per-feed process cache | `lib/feed-cache.ts`, `lib/rss.ts` | 90s; last-good fallback up to 30min; failure backoff 15s | `fresh: true`, sharing concurrent work and respecting failure backoff |
| HTTP response cache | `/api/news` headers | `s-maxage=90, stale-while-revalidate=300` | explicit fresh/refresh or partial feed failure produces `no-store` |

`shouldBypassNewsCache()` accepts `1` or `true` for `fresh` and `refresh`.
`checkForUpdates` uses the shared feed cache and skips lead-image enhancement.
Homepage and news API no longer use separate merged-list cache keys. These caches
are process-local: separate workers/cold starts do not share last-good RSS data.

---

## 6. The Feed UI

### 6.1 Layout chain

```
app/page.tsx (server)
 └─ PublicNewsView | DashboardView   (client, owns article state + refresh)
     ├─ AppShell                      header: logo, refresh, newsletter link, auth/account, pending-update pill
     ├─ NewArticlesPrompt             invisible poller (renders null)
     └─ NewsFeed                      filters + all feed state
         └─ NewsList                  lead story split + grid/list layout
             ├─ LeadStoryCard         dark hero with image panel
             └─ NewsCard × N          separate mobile and desktop markup
```

### 6.2 Filters and controls ([NewsFeed](components/NewsFeed.tsx))

Filters compose in a fixed order, each memoized:

1. **Feed mode** — `all` articles or `saved` articles (authenticated only).
2. **Coverage** — All News / U.S. News / World News.
3. **Category** — All Categories or one of the ten topics; works on live and saved
   articles and participates in clearing filters and the active-filter indicator.
4. **Source** — dropdown built dynamically from the coverage/category-filtered set, so it
   never offers a source with zero results. Falls back to "All Sources" if the
   selected source disappears.
5. **Search** — case-insensitive substring across title + source + summary.
6. **Time window** — All Time, Last Hour, 3h, 6h, 12h, 24h, Last Week. Articles
   with no `publishedAt` are excluded from any windowed view.
7. **Only new** — restricts to links detected as new this session (§6.4).
8. **Alert match view** — currently inert; see §8.3.

Also: **Grid vs List** view mode, a **story/source counter**, a "Filters active"
badge, and context-aware empty states (feed error → Retry; no saved → Browse all;
filters too narrow → Clear filters).

For signed-in users, `selectedSource`, `timeFilter`, and `viewMode` are upserted to
`user_preferences` on every change and restored on the next server render.
Coverage and category filters are local component state and are not persisted
in `user_preferences`.

### 6.3 Breaking stories and the lead card

[lib/news-presentation.ts](lib/news-presentation.ts) holds the presentation rules:

- `isBreakingStory()` — regex on the title for
  `breaking|urgent|launches|missile|strike|earthquake|evacuation|war|attack|explosion`.
- `getLeadArticle()` — newest breaking story, else simply the newest story.
- `getCoverageLabel()` — `national` → "U.S. News", everything else → "World News".
- `formatPublishedDate()` (medium date + short time) and `formatPublishedCompact()`
  (`MM/DD/YY h:mm AM`) for mobile.

[NewsList](components/NewsList.tsx) renders two separate trees: on desktop the lead
card is always pulled out and shown above the grid; on mobile the hero appears
**only if the lead story is actually breaking**, otherwise it stays inline as a
normal card.

### 6.4 New-article detection

This is the subtlest part of the app. Three `sessionStorage` keys, defined in
[lib/news-updates.ts](lib/news-updates.ts):

| Key | Meaning |
|---|---|
| `breaking-news-previous-links` | Full link list from before the refresh |
| `breaking-news-pending-new-links` | Links the poller already identified as new |
| `breaking-news-handled-new-links` | Links already surfaced, so they aren't re-announced |

Flow:

1. **[NewArticlesPrompt](components/NewArticlesPrompt.tsx)** polls `/api/news`
   every **180 seconds** while visible, with a visibility-return check at most
   once per 30 seconds and one request in flight. It does not refetch on mount.
   Empty initial feeds are not treated as a baseline for announcing every story.
2. It diffs via `getNewArticleLinks(previous, latest)` — normalizes both sides,
   returns each genuinely new canonical link exactly once — then subtracts any
   already-handled links.
3. It renders nothing; it reports the count and links upward via callbacks.
4. The count appears as a pulsing **"N new updates"** pill in
   [AppShell](components/AppShell.tsx). Clicking it calls
   `preparePendingNewArticleRefresh(currentLinks, newLinks)` to write all three
   keys, then triggers the refresh.
5. After refresh, `NewsFeed` reads the pending keys, maps them back onto the
   current link list with `resolveCurrentLinks()`, and marks those cards **New**.
   The keys are cleared only once every pending link resolved — so a link that
   hasn't landed in the feed yet stays pending instead of being silently lost.

The **Refresh** button ([RefreshButton](components/RefreshButton.tsx)) takes the
other path: it saves the current links as the baseline, clears pending/handled, and
then everything newer than that baseline is flagged New.

Client refreshes go through `fetchLatestNews(reason)` in
[lib/news-client.ts](lib/news-client.ts), which adds a timestamp and either `fresh=1&refresh=1` for manual refreshes or
`checkForUpdates=1` for cache-aware polls. Requests have a 25-second deadline.

### 6.5 Card anatomy

[NewsCard](components/NewsCard.tsx) ships three layouts from one component: a mobile
row with a date rail, a desktop compact/list row with stacked actions, and a desktop
grid card with clamped summary and bottom-anchored actions. Badges: **Breaking**
(red, flashing dot), **New** (accent), **Important**/**Match** for alerts. Titles
open in a new tab with `rel="noopener noreferrer"` and fire an
`article_original_click` analytics event.

Regular and lead cards also show category labels. New York Times articles display
[SubscriptionRequiredBadge](components/SubscriptionRequiredBadge.tsx), using
`isNewYorkTimesSource()` in [lib/news-presentation.ts](lib/news-presentation.ts).
This is a publisher-specific label, not a general paywall detector.

[LeadStoryCard](components/LeadStoryCard.tsx) is the dark hero (`--hero-dark`) with
a gradient top rule, a 5:4 image panel that degrades to an "Article image
unavailable" placeholder on load error, and Save / Share / Read-article actions.

### 6.6 Sharing — [ShareArticleButton](components/ShareArticleButton.tsx)

A popover tray with X (`twitter.com/intent/tweet`), Facebook sharer, copy link, and
`navigator.share()` where available. Copy falls back to a hidden textarea +
`document.execCommand("copy")` when the async clipboard API is missing. The tray
closes on outside pointerdown and on Escape; status messages auto-clear after
2.2 s. Every channel fires `article_share_channel_click`. Placement adapts:
dark/light appearance, adjacent or stacked on desktop, and an optional
`reserveOpenSpace` so an open tray doesn't overlap neighbors.

---

## 7. Saved Articles

- Signed-in only. Signing out is not required to *see* the button — signed-out users
  get a "Sign in to save" CTA that opens the inline auth panel.
- Toggle handler in `NewsFeed.handleToggleSavedArticle` writes directly from the
  browser with the Supabase anon client (RLS enforces ownership):
  - Save → `upsert` into `saved_articles` with `onConflict: "user_id,article_link"`.
  - Unsave → `delete` matching `user_id` + `article_link`.
- Both paths are **optimistic**: state updates first, and reverts on error.
- `toSavedArticle()` / `fromSavedArticleRows()` in
  [lib/saved-articles.ts](lib/saved-articles.ts) map between the camelCase
  `NewsItem` and the snake_case row shape. Note the stored row deliberately omits
  `imageUrl` — saved cards render without images.
- Category is saved alongside the story and restored when it leaves the live feed.
  Older rows without a category display under General News. This requires the
  `saved_articles.category` migration (§13).
- Initial saved list is fetched server-side in [app/page.tsx](app/page.tsx) and
  passed down, so the Saved tab is populated on first paint.

---

## 8. Alerts

### 8.1 Custom keywords — [lib/custom-alerts.ts](lib/custom-alerts.ts)

Keywords are normalized (trimmed, lowercased) and deduped. For signed-in users they
live in `user_alert_keywords`; for the (currently unreachable) signed-in-without-id
case they fall back to `localStorage` under
`breaking-news-custom-alert-keywords`. `articleMatchesAlertKeywords()` does a
case-insensitive substring match across title + summary.

### 8.2 Keyword suggestion

`suggestAlertKeywordForArticle()` pre-fills the "Set alert" dialog. It runs a
priority-ordered list of 14 topic regexes (culture, entertainment, shipping, middle
east, politics, business, housing, markets, tech, health, sports, climate, aviation,
crime) **against the title first**, then against title+summary+source, and finally
falls back to the coverage label (`u.s. news` / `world news` / `top stories`).

### 8.3 Smart alerts — [lib/smart-alerts.ts](lib/smart-alerts.ts)

`getSmartAlertMatch(article, keywords)` returns `{ status, matchedKeywords,
importance }`:

- No saved keywords, or no match → `status: "none"`.
- Match in the title, **or** match plus an urgency word (`breaking`, `announces`,
  `launches`, `reveals`, `urgent`) in the title → `importance: "important"`.
- Match only in the summary → `importance: "normal"`.

The deliberate rule, enforced by tests: **saved keywords are always the gate.**
Urgent language can upgrade an existing match but can never create one.

### 8.4 Current state: the alerts UI is feature-flagged off

[NewsFeed](components/NewsFeed.tsx#L57) sets `const SHOW_ALERTS_UI = false`. While
that is false:

- The Set-alert button, the alert dialog, the alert-match filter chips, and the
  Alerts tab are all hidden, and the `alerts` shell tab redirects to `feed`.
- `alertImportanceByLink` is passed as `{}`, so no Important/Match badges render.
- Alert keywords still load, still save from **Account settings → Alert keywords**,
  and still feed newsletter personalization scoring.

Flipping the flag to `true` re-enables the whole in-feed alert surface; all the
supporting code and tests are intact.

---

## 9. Authentication & Sessions

- **Browser client** — [lib/supabase/client.ts](lib/supabase/client.ts),
  `createBrowserClient` with the anon key. Used for saved articles, alert keywords,
  preference upserts, and sign-out.
- **Server client** — [lib/supabase/server.ts](lib/supabase/server.ts),
  `createServerClient` wired to Next's `cookies()`. Cookie writes are wrapped in
  try/catch because Server Components can't always set cookies.
- **Admin client** — [lib/supabase/admin.ts](lib/supabase/admin.ts), service-role
  key, `persistSession: false`. **Server-only.** Used by the newsletter sender,
  unsubscribe, open/click tracking, and email analytics.
- **Env guards** — [lib/supabase/env.ts](lib/supabase/env.ts) throws descriptive
  errors for missing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`.
- **Session refresh** — [proxy.ts](proxy.ts) → `updateSupabaseSession()` calls
  `supabase.auth.getClaims()` for page requests carrying auth cookies and
  propagates refreshed cookies. API handlers still authenticate independently.
  Supabase requests have a 10-second per-request deadline. The matcher excludes `_next/static`, `_next/image`,
  `favicon.ico`, and image extensions.

**Auth flows:** [AuthPanel](components/AuthPanel.tsx) posts to
[/api/auth/login](app/api/auth/login/route.ts) (`signInWithPassword`) and
[/api/auth/signup](app/api/auth/signup/route.ts) (`signUp`). Signup returns
`confirmationRequired: true` when Supabase issues a user but no session — the UI
then shows a "check your email" message instead of redirecting. Both routes are
rate limited. The panel is hash-driven: `#public-auth-panel-login` and
`#public-auth-panel-signup` open it in the right mode, and a
`public-auth-mode-change` custom event switches modes when it's already open.

Sign-out lives in [UserMenu](components/UserMenu.tsx), which has four visual
variants (`button`, `card`, `inline`, `menu`) over the same `signOut` + `router.replace("/")`
+ `router.refresh()` behavior.

---

## 10. The Newsletter System

The largest subsystem. Five moving parts: subscription state, the send
orchestrator, article selection, email rendering, and tracking.

### 10.1 Subscription settings

Validated in one place —
[lib/newsletter-subscription-settings.ts](lib/newsletter-subscription-settings.ts):

| Field | Values | Notes |
|---|---|---|
| `frequency` | `hourly`, `daily`, `weekly`, `custom` | accepts `frequency` or legacy `preferredFrequency` |
| `customFrequency` | whole number of hours > 0 | required and only stored when frequency is `custom` |
| `emailFormat` | `standard`, `compact` | legacy `grid` → `standard`, `list` → `compact` |
| `articleMode` | `all_missed` (default), `personalized` | |
| `sortOrder` | `default` (default), `category` | stored as `sort_order`; "Group by category" in Account and signup |

Returns either `{ errorMessage, status }` or the validated settings with
`status: 200`. Both subscription routes call it, so validation can't drift.

### 10.2 Eligibility — [lib/newsletter.ts](lib/newsletter.ts)

`canUserReceiveAutomaticNewsletterNow(subscription, now)`:

- Inactive subscription → not eligible.
- **Daily** uses a calendar-day comparison in `America/New_York`
  (`Intl.DateTimeFormat("en-CA")`), not a rolling 24 hours — so a daily reader gets
  at most one email per Eastern day regardless of send time drift.
- **Hourly / weekly / custom** use rolling windows: 1 h, 7 days, or
  `customFrequency × 1 h`.
- Never sent before, or an unparseable `last_sent_at` → eligible.
- A `custom` frequency with an invalid hour value → `invalid-custom-frequency`.

`getRecentNewsletterArticles(articles, now)` then keeps only articles published
within the last 24 hours (and not in the future).

### 10.3 Send orchestration — [app/api/send-newsletter/route.ts](app/api/send-newsletter/route.ts)

Triggered by the Vercel cron in [vercel.json](vercel.json): `0 13 * * *` (13:00 UTC
daily). `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

1. **Auth** — outside development, requires `Authorization: Bearer ${CRON_SECRET}`;
   otherwise 401. Missing `RESEND_API_KEY` → 500.
2. **Load subscriptions** — all `is_active` rows, oldest first, using `select("*")`
   so a missing optional preference column does not abort delivery for everyone.
   `?email=<subscriber-email>` trims/lowercases the value and restricts the query
   to that active subscriber; normal cron authorization and send rules still apply.
3. **Test gate** — if `TEST_NEWSLETTER_EMAIL` is set, every other subscriber is
   filtered out and counted as skipped. This is the safety valve for production
   targeted sends. This still sends real email; it is not a dry-run mode.
4. **Build personalization maps** once for the whole batch (§10.4).
5. **Fetch articles once** — `getAllNewsItems({ fresh: true })` → last-24h filter
   → cross-source story deduplication (§10.5).
6. **Per subscriber**:
   - Not eligible → log `skipped` with the reason, continue.
   - No recent articles → log `skipped` / `no-recent-articles`.
   - Load already-sent links from `newsletter_sent_articles` for this subscription.
   - Select articles (§10.5). Empty → log `skipped` / `all-articles-already-sent`.
   - Ensure an unsubscribe token: reuse the existing one, or generate a UUID
     (dashes stripped) with a `.is("unsubscribe_token", null)` guard so two
     concurrent runs can't overwrite each other. Failure → log `failed`.
   - Build a tracking context `{ sendLogId: crypto.randomUUID(), subscriptionId, email }`,
     render HTML + text, POST to Resend with an `Idempotency-Key` and
     `List-Unsubscribe` / `List-Unsubscribe-Post: List-Unsubscribe=One-Click` headers.
   - On success: log `sent`, insert one `newsletter_sent_articles` row per article,
     and update `last_sent_at` / `last_status` / clear `last_error`.
   - On failure: log `failed` with the Resend error (truncated to 1000 chars) and
     record `last_error`.
7. Returns a summary: `{ attempted, eligible_users, failed, sent, skipped }`.

Sender identity is hardcoded: `Kicker News <latest@kicker.news>`.

Missing optional preferences fall back to existing defaults: `all_missed` article
selection, `standard` email layout, and `default` ordering. This compatibility is
limited to sending; apply the category migration before deploying features that
read or save `sort_order` and saved-story categories.

### 10.4 Personalization profile

Built in `getPersonalizationMaps()` and assembled per subscriber in
`getPersonalizationProfile()`. Click history is gathered by **three independent
keys** and merged — `subscription_id`, `user_id`, and lowercased `email` (500 rows
each, newest first) — so history survives a subscription being recreated or an
account being linked after the fact.

```ts
type PersonalizationProfile = {
  alertKeywords: string[];        // from user_alert_keywords
  clickedArticleLinks: string[];  // merged, deduped
  clickedSources: string[];       // merged, deduped, lowercased
  preferredSource: string | null; // user_preferences.default_source_filter, "All Sources" → null
};
```

### 10.5 Ranking and selection — [lib/personalization.ts](lib/personalization.ts)

Before per-user selection,
[deduplicateNewsletterArticles()](lib/newsletter-deduplication.ts) groups matching
stories across sources using normalized title/summary terms, stop-word removal,
aliases, and overlap thresholds. It prefers a non-New York Times version, then
richer content, then recency, with input order as a final tie-breaker. A general
winner inherits a specific category from another story in its group. This is a
newsletter-only similarity heuristic; feed identity remains the normalized link.

Additive scoring in `computeArticleScore`:

| Signal | Points |
|---|---|
| Article source == preferred source | **+40** |
| Alert keyword appears in title or summary | **+24** |
| Source previously clicked | **+18** |
| This exact article already clicked | **−30** |
| Recency, linear decay over 24 h | **0 … +20** |

Ties break by newer `publishedAt`, then by original index (stable).

`resolveNewsletterArticleSelection()` decides what actually ships:

- Always filters out links already in `newsletter_sent_articles` for that
  subscription — **no article is ever sent twice.**
- `all_missed` mode → every unsent recent article, newest first, **uncapped**.
- `personalized` mode → ranked, diversified, capped at
  `NEWSLETTER_ARTICLE_LIMIT = 20`.
- **Personalization gate:** personalized mode silently falls back to `all_missed`
  until the user has clicked **5 unique newsletter articles**
  (`PERSONALIZATION_MIN_UNIQUE_CLICKS`). Repeat clicks on the same article count
  once — the goal is breadth of interest, not click volume.
- **Source diversification:** `selectDiversifiedRankedArticles` applies a soft cap
  of **2 articles per source**; if that leaves the digest short of the limit, it
  does a second pass ignoring the cap so the email is never artificially thin.

### 10.6 Email rendering — [lib/newsletter.ts](lib/newsletter.ts)

Two formats, each with an HTML and a plain-text builder, all inline-styled tables-free
markup for mail-client safety, with `escapeHtml`/`escapeAttribute` on every
interpolation:

- **Standard** — source eyebrow, 22 px headline, published time, summary, pill
  "Read more" button per article.
- **Compact** — condensed list: source eyebrow plus a linked 16 px headline, no
  summary.

Both include:
- A **hidden preheader** (`NEWSLETTER_PREHEADER_TEXT`, plus zero-width-joiner
  padding) so inbox previews read cleanly. Keep it.
- A visible **Unsubscribe** button at the top and a text unsubscribe link at the
  bottom.
- `NEWSLETTER_MAILING_ADDRESS` in the footer when configured (CAN-SPAM).
- A 1×1 tracking pixel when tracking context is present.
- Subject line: `Kicker News: N stories from the last 24 hours` (singular-aware).
- Dates rendered in `America/New_York`.
- New York Times stories labeled **Subscription required** in HTML and plain text.
- With `sort_order = "category"`, alphabetical category headings in both formats
  and plain text. `orderNewsletterArticles()` uses a stable sort to preserve the
  existing recency or personalized order within each section. The default adds no
  headings and retains existing ordering; grouping happens after article selection.

**Sponsors** ([lib/sponsors.ts](lib/sponsors.ts)) — a top slot and a mid slot, each
configured entirely by env vars and rendered only when *all five* fields
(`_LABEL`, `_TITLE`, `_DESCRIPTION`, `_CTA_TEXT`, `_CTA_URL`) are present. The mid
sponsor is injected at the midpoint, and only when there are more than 3 articles.

### 10.7 Tracking and unsubscribe

| URL builder | Produces |
|---|---|
| `buildNewsletterUnsubscribeUrl(token)` | `{base}/api/unsubscribe?token=…` |
| `buildOpenTrackingUrl(tracking)` | `{base}/api/newsletter/open?sendLogId&subscriptionId&email` |
| `buildTrackedUrl(dest, tracking, title, source)` | `{base}/api/newsletter/click?…&url=dest` |

`getAppBaseUrl()` reads `APP_BASE_URL`, falls back to `http://localhost:3000` in
development, and **throws in production if unset** — a deliberate fail-fast so
nobody ships emails with broken links.

- **[/api/newsletter/open](app/api/newsletter/open/route.ts)** — inserts into
  `email_open_events` (with user-agent and IP from `x-forwarded-for` / `x-real-ip`),
  retries without those columns if the insert fails, then always returns a 43-byte
  transparent GIF with `Cache-Control: no-store`.
- **[/api/newsletter/click](app/api/newsletter/click/route.ts)** — validates the
  destination is `http`/`https` (retrying with `encodeURI` for unescaped URLs),
  inserts into `email_click_events` with article link/title/source, then 302s to the
  destination. An invalid destination returns 400 — the redirect is never blind.
- **[/api/unsubscribe](app/api/unsubscribe/route.ts)** — `GET` redirects to
  `/unsubscribe/success?status=success|invalid|error`; `POST` implements RFC 8058
  one-click and returns bare status codes (200/400/404/500) with no body. Both look
  the token up with the admin client and set `is_active = false`.

The older [/api/email-open](app/api/email-open/route.ts) and
[/api/email-click](app/api/email-click/route.ts) routes use short `sid`/`sub` params
and remain for backward compatibility with any already-delivered email. Nothing
currently generates links to them.

### 10.8 Two subscription endpoints

Both exist and both are used:

- **[/api/newsletter/subscribe](app/api/newsletter/subscribe/route.ts)** — `POST`
  only, rate-limited, requires a logged-in user. Inserts a new subscription or
  reactivates an inactive one; returns **409** if already active. This is what the
  public [NewsletterSignup](components/NewsletterSignup.tsx) form posts to.
- **[/api/newsletter-subscriptions](app/api/newsletter-subscriptions/route.ts)** —
  `POST` (same semantics), `PUT` (update settings on an active subscription), and
  `DELETE` (set `is_active = false` and clear `custom_frequency`). Account settings
  uses `PUT`/`DELETE`; the signup form uses `DELETE` to unsubscribe.

---

## 11. Email Analytics

**Page:** [app/email-analytics/page.tsx](app/email-analytics/page.tsx) — server
component, redirects to `/` if signed out, forwards the session cookie to the API,
and supports a `?range=7|30|90|all` selector. It renders hero stats (Received /
Opened / Clicked), metric cards (articles delivered, unique opens, unique clicks,
unique open rate, click rate, click-to-open rate, most-clicked source), daily send
and engagement tables, top clicked articles, recently delivered articles, top
sources, and an advanced section (failures, skips with reasons, subscription counts)
that only appears when there's something to show. A matching skeleton lives in
[app/email-analytics/loading.tsx](app/email-analytics/loading.tsx).

**API:** [app/api/email-analytics/route.ts](app/api/email-analytics/route.ts) —
requires auth, then uses the **admin client scoped to the caller**. Scoping is done
by both `user_id` and lowercased email, with results deduped by a composite key, so
engagement recorded before an account existed still shows up. Everything is
aggregated in memory: daily send counts, frequency distribution, top sources, top
sent/clicked articles, skip reasons, engagement overview and daily series. Open
events are queried with a **three-step column fallback** (`opened_at` →
`created_at` → bare) so a schema that predates a column still returns data instead
of erroring.

---

## 12. API Reference

| Route | Methods | Auth | Purpose |
|---|---|---|---|
| [/api/news](app/api/news/route.ts) | GET | public | Parsed feed as JSON; honors `fresh`/`refresh`/`checkForUpdates` |
| [/api/ai/briefing](app/api/ai/briefing/route.ts) | POST | user + origin | On-demand shared AI briefing; disabled by default; no body/query accepted |
| [/api/auth/login](app/api/auth/login/route.ts) | POST | public | Password sign-in; rate limited `auth-login` |
| [/api/auth/signup](app/api/auth/signup/route.ts) | POST | public | Sign-up; rate limited `auth-signup`; reports `confirmationRequired` |
| [/api/newsletter/subscribe](app/api/newsletter/subscribe/route.ts) | POST | user | Subscribe / reactivate; rate limited `newsletter-subscribe` |
| [/api/newsletter-subscriptions](app/api/newsletter-subscriptions/route.ts) | POST, PUT, DELETE | user | Full subscription settings CRUD |
| [/api/send-newsletter](app/api/send-newsletter/route.ts) | GET | `CRON_SECRET` | Cron send orchestrator; optional `?email=` restricts to one active subscriber |
| [/api/unsubscribe](app/api/unsubscribe/route.ts) | GET, POST | token | Redirect flow + RFC 8058 one-click |
| [/api/newsletter/open](app/api/newsletter/open/route.ts) | GET | none | Open pixel |
| [/api/newsletter/click](app/api/newsletter/click/route.ts) | GET | none | Click redirect + logging |
| [/api/email-open](app/api/email-open/route.ts), [/api/email-click](app/api/email-click/route.ts) | GET | none | Legacy tracking (`sid`/`sub` params) |
| [/api/email-analytics](app/api/email-analytics/route.ts) | GET | user | User-scoped analytics aggregates |
| [/api/health](app/api/health/route.ts) | GET | public | Liveness — best default uptime monitor |
| [/api/health/newsletter](app/api/health/newsletter/route.ts) | GET | public | Reports whether `RESEND_API_KEY` and `APP_BASE_URL` are configured (booleans only, no secrets) |

---

## 13. Database Schema (as used by the code)

Eight tables. Two incremental migrations are checked in; the base schema is
managed in the Supabase project:

- [20260424_add_newsletter_article_mode.sql](supabase/migrations/20260424_add_newsletter_article_mode.sql)
  adds `article_mode` with a CHECK constraint.
- [20261030_add_newsletter_sort_order.sql](supabase/migrations/20261030_add_newsletter_sort_order.sql)
  adds `newsletter_subscriptions.sort_order` (`NOT NULL`, default `default`,
  CHECK allowing `default` or `category`) and nullable `saved_articles.category`
  with a CHECK for the ten category keys. Apply it before deploying category
  settings and saved-story changes. Existing subscribers retain their old order.

| Table | Columns the code reads/writes |
|---|---|
| `newsletter_subscriptions` | `id`, `user_id`, `email`, `frequency`, `custom_frequency`, `email_format`, `article_mode`, `sort_order`, `is_active`, `last_sent_at`, `last_status`, `last_error`, `unsubscribe_token`, `created_at`, `updated_at` |
| `newsletter_sent_articles` | `subscription_id`, `user_id`, `email`, `send_log_id`, `article_link`, `article_title`, `article_source`, `sent_at` |
| `email_send_logs` | `id`, `subscription_id`, `user_id`, `email`, `status`, `error`, `article_count`, `sent_at`, `created_at` |
| `email_open_events` | `send_log_id`, `subscription_id`, `email`, `user_agent`, `ip_address`, `opened_at`/`created_at` |
| `email_click_events` | `send_log_id`, `subscription_id`, `user_id`, `email`, `article_link`, `article_title`, `article_source`, `user_agent`, `ip_address`, `clicked_at` |
| `saved_articles` | `user_id`, `article_link`, `title`, `source`, `summary`, `published_at`, `category`, `created_at` — unique on `(user_id, article_link)` |
| `user_alert_keywords` | `user_id`, `keyword`, `created_at` — unique on `(user_id, keyword)` |
| `user_preferences` | `user_id`, `default_source_filter`, `default_time_filter`, `default_view_mode` |

Both unique constraints are load-bearing: the client-side upserts pass
`onConflict: "user_id,article_link"` and `onConflict: "user_id,keyword"`.

**Access rule:** anything reachable from the browser goes through the anon client
and must be scoped by `user_id` (RLS). The service-role client is only ever
constructed in route handlers and server components.

---

## 14. SEO

- **Site metadata** — [app/layout.tsx](app/layout.tsx): `metadataBase`
  `https://kicker.news`, title template `%s | Kicker News`, OG + Twitter
  `summary_large_image` cards pointing at `/og-image.png` and `/twitter-image.png`,
  favicon and Apple touch icon.
- **Per-page metadata** — `buildPageMetadata({ title, description, pathname })` in
  [lib/seo.ts](lib/seo.ts) produces canonical URL, OG, and Twitter tags in one call.
  `getDefaultOpenGraphImageUrl()` checks the filesystem and falls back to
  `/logo-horizontal.png` if `og-image.png` is missing.
- **Base URL resolution** — `APP_BASE_URL` → `NEXT_PUBLIC_APP_BASE_URL` →
  `https://kicker.news`, trailing slashes trimmed.
- **Structured data** — the homepage emits three JSON-LD blocks: `Organization`,
  `WebSite`, and an `ItemList` of the top 10 articles with `datePublished` and
  provider. `serializeJsonLd()` escapes every `<` as `<` to prevent script-breakout.
- **[robots.ts](app/robots.ts)** — allows `/`, disallows `/account`,
  `/email-analytics`, `/api/`; points at the sitemap.
- **[sitemap.ts](app/sitemap.ts)** — seven public routes only, with change
  frequencies (homepage `hourly`, newsletter `weekly`, rest monthly/yearly) and
  priorities. Private routes are excluded, and a test asserts that.

---

## 15. Analytics, Monitoring, Rate Limiting

### Client analytics — [lib/analytics.ts](lib/analytics.ts)

A single `trackEvent(name, props)` / `trackPageView(path)` façade that fans out to
whichever providers are configured: `window.dataLayer` (GTM, always), Plausible
(`NEXT_PUBLIC_PLAUSIBLE_DOMAIN`), GA4 (`NEXT_PUBLIC_GA_MEASUREMENT_ID`), PostHog
(`NEXT_PUBLIC_POSTHOG_KEY`). It also dispatches a local `kicker-analytics`
`CustomEvent` — useful for debugging without any provider. Every event is enriched
with `pathname`, a `viewport` bucket (mobile <640, tablet <1024, desktop), and
`viewport_width`.

Events currently emitted: `page_view`, `article_original_click`,
`article_share_channel_click`, `saved_article_click`, `source_filter_change`,
`newsletter_signup_submit`, `newsletter_signup_success`, `account_login_attempt`,
`account_login_success`, `account_signup_attempt`, `account_signup_success`.

[AnalyticsProvider](components/AnalyticsProvider.tsx) fires a pageview on every
pathname/search change; it's wrapped in `<Suspense>` in the root layout because it
uses `useSearchParams`.

### Sentry

Standard Next.js SDK layout: [instrumentation.ts](instrumentation.ts) (loads the
node or edge config by runtime, exports `onRequestError`),
[instrumentation-client.ts](instrumentation-client.ts) (replay integration, exports
`onRouterTransitionStart`), plus [sentry.server.config.ts](sentry.server.config.ts)
and [sentry.edge.config.ts](sentry.edge.config.ts). Sampling is 10 % in production,
100 % in development; `sendDefaultPii: false` everywhere.
[next.config.ts](next.config.ts) wraps the config with `withSentryConfig`, enabling
a `/monitoring` tunnel route (ad-blocker evasion), widened source-map upload, and
Vercel cron monitors. Source-map upload only activates when `SENTRY_AUTH_TOKEN` is
set. [lib/sentry.ts](lib/sentry.ts) provides `sanitizeSentryEvent()` which redacts
`authorization`, `cookie`, `set-cookie`, `x-supabase-auth` headers and any
`token=…` query value.

### Rate limiting — [lib/ratelimit.ts](lib/ratelimit.ts)

Upstash sliding window, **5 requests per minute** keyed by `scope:ip`. IP resolution
tries `x-forwarded-for` (first entry), `cf-connecting-ip`, `x-real-ip`, then
`local-dev`. Critically: **if Upstash is not configured, production returns 503**
rather than silently allowing traffic; development logs a warning once and proceeds.
Throttled responses return 429 with a computed `Retry-After`.

### Structured logging — [lib/api-logging.ts](lib/api-logging.ts)

`logApiInfo(scope, details)` and `logApiError(scope, error, details)` with
`getErrorLogDetails()` normalizing `Error` objects and Supabase's
`{ code, details, hint, message }` shape. Scopes read like
`[newsletter][send][subscriptions]`, making Vercel log filtering straightforward.

---

## 16. Design System

Tokens are CSS custom properties on `:root` in
[app/globals.css](app/globals.css), re-exported into Tailwind v4 via `@theme inline`
(so `bg-accent`, `text-text-sub`, etc. work):

| Token | Value | Role |
|---|---|---|
| `--background` | `#f7f5f2` | warm paper ground |
| `--surface` | `#ffffff` | cards |
| `--border` / `--border-strong` | `#ece8e1` / `#d8d3cb` | hairlines |
| `--foreground` | `#1a1814` | primary text |
| `--text-sub` / `--text-muted` | `#6b6560` / `#a09890` | secondary text |
| `--navy` | `#0d1b3e` | primary buttons |
| `--breaking` | `#c8200e` | breaking red |
| `--accent` | `#ad0068` | magenta accent, New badges, focus rings |
| `--hero-dark` / `--hero-headline` | `#130a08` / `#ffeee8` | lead story card |

Typography is DM Sans for UI and DM Mono for the `.mono-meta` uppercase
letter-spaced metadata style. Keyframe animations: `live-dot-pulse`,
`fade-up`, `badge-in`, `ticker-scroll`, and `ticker-dot-blink`.

Accessibility conventions used throughout: `min-h-10`/`min-h-11` touch targets,
`focus-visible:ring-2` on every interactive element, `aria-pressed` on toggles,
`aria-live="polite"` on status messages, `sr-only` labels on every filter control,
and `role="search"` / `role="group"` on the filter regions.

---

## 17. Environment Variables

Copy [.env.example](.env.example) → `.env.local`.

**Required**

| Var | Used by |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | all Supabase clients |
| `SUPABASE_SERVICE_ROLE_KEY` | admin client (server only) |
| `APP_BASE_URL` | newsletter link builders (**throws in production if missing**), SEO |

**Required for newsletter sending**

| Var | Notes |
|---|---|
| `RESEND_API_KEY` | send route returns 500 without it |
| `CRON_SECRET` | `Bearer` token the cron must present |
| `NEWSLETTER_MAILING_ADDRESS` | postal address in the email footer |
| `TEST_NEWSLETTER_EMAIL` | **restricts sends to one address — clear it for real sends** |

**Recommended**

| Var | Effect if missing |
|---|---|
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | rate-limited routes return 503 in production |
| `NEXT_PUBLIC_SENTRY_DSN` | no error reporting |
| `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | no source-map upload |

**Optional** — `NEXT_PUBLIC_APP_BASE_URL`, `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`,
`NEXT_PUBLIC_GA_MEASUREMENT_ID`, `NEXT_PUBLIC_POSTHOG_KEY`,
`NEXT_PUBLIC_IN_FEED_SPONSOR_ENABLED`, and the ten
`NEWSLETTER_TOP_SPONSOR_*` / `NEWSLETTER_MID_SPONSOR_*` fields.

---

## 18. Development, Testing, Deployment

```bash
npm install
npm run dev          # Next dev server (feeds always fetched fresh in development)
npm run lint         # ESLint 9 flat config, next/core-web-vitals + next/typescript
npx tsc --noEmit     # type check
npm test             # Node test runner
npm run build        # production build
```

**Tests** — 148 tests across 21 files in [tests/](tests/), verified with `npm test`
on November 13, 2026 using Node 24.12.0. The package script runs
`node --experimental-strip-types --experimental-specifier-resolution=node --test --test-isolation=none tests/*.test.mjs`.
There is no test framework or mocking-library dependency. Pure modules use explicit
`.ts` imports (`allowImportingTsExtensions` is on); route tests also use TypeScript
transpilation, Node VM fixtures, and mocked database/provider calls. They do not
send real email or write production data. Coverage:

| File | Focus |
|---|---|
| `personalization.test.mjs` | scoring, the 5-click gate, dedupe, mode fallback, limits |
| `custom-alerts.test.mjs` | keyword suggestion across topic categories |
| `smart-alerts.test.mjs` | the "keywords always gate" rule, case-insensitivity |
| `news-updates.test.mjs` | new-link detection, normalization, duplicate handling |
| `rss.test.mjs` | entity decoding, image extraction, srcset preference, og:image |
| `feeds.test.mjs` | coverage lookup and filtering |
| `seo.test.mjs` | canonical URLs, sitemap excludes private routes |
| `news-api.test.mjs` | API payload shape stability, cache bypass |
| `news-client.test.mjs` | refresh vs polling query shapes |
| `news-presentation.test.mjs` | New York Times source-name variants for subscription labels |
| `newsletter-deduplication.test.mjs` | similar stories, free-source preference, distinct stories, email labels |
| `news-categories.test.mjs` | publisher topics, category filtering/grouping, saved rows, metadata retention, isolated feed failures |
| `newsletter-routes.test.mjs` | category-order insert/update/reactivation, validation, authentication, write failures |
| `newsletter-send.test.mjs` | delivery with/without optional migration, targeted sends, cron authorization, send eligibility, provider failure |
| `ai-briefing.test.mjs` | bounded canonical selection, existing deduplication, schema/reference validation, metadata-only prompt |
| `ai-briefing-provider.test.mjs` | real adapter with mocked provider responses, errors, refusals, truncation, response limits, configuration |
| `ai-briefing-service.test.mjs` | shared cache, concurrent requests, recovery, exhausted budgets, empty feeds, lease ownership |
| `ai-briefing-route.test.mjs` | flags, origin/session enforcement, limits, safe errors, private response caching |
| `ai-briefing-store.test.mjs` | Redis adapter command wiring, reservation and ownership guards (mocked Redis) |

Additional opt-in validation (Node 24):

```bash
node --experimental-strip-types scripts/validate-news-feeds.mjs       # 18 added feeds
node --experimental-strip-types scripts/validate-news-feeds.mjs --all # all 30 feeds
node scripts/validate-news-ui.mjs
node scripts/validate-news-ui.mjs --live-homepage
```

The feed script makes network requests with 15-second timeouts; live availability
can vary. README.md records four original feeds unavailable during the October 30
check (CNN, USA Today, Reuters U.S., Reuters World); that is historical evidence,
not a current availability check.

The UI script uses installed Chrome (`CHROME_PATH` overrides the default path),
ports 3100/9311, and a temporary local route with real components. It checks seven
widths from 320 to 1920 pixels, saved/category filtering, newsletter setting
requests, and both header modes with pending updates. Saves are mocked; it does
not sign in or send email. `--live-homepage` adds the real homepage with live news.
Its cleanup removes the temporary route and generated route types. The initial documentation-only update did not rerun those checks; subsequent
validation is recorded in the performance and AI pre-deployment reviews.

**CI** — [.github/workflows/ci.yml](.github/workflows/ci.yml) runs lint → tsc → test
→ build on every PR and every push to `main`, Node 24.

**Deploy** — Vercel. Set all production env vars before the first deploy, verify the
Resend sending domain (SPF, DKIM, DMARC), and confirm `CRON_SECRET` matches what the
cron sends. Point UptimeRobot (or similar) at `/api/health`.
Apply the checked-in SQL migrations in Supabase before deploying code that uses
their columns (§13); the sender's optional-column fallback does not migrate the
database or make category settings writes compatible with an older schema.

**Manual checklist before shipping feed/newsletter/auth changes:**
public homepage renders articles → dashboard loads saved articles and preferences →
newsletter settings save → unsubscribe works in both browser and one-click flows →
email analytics loads.

---

## 19. Built but Currently Dormant

Worth knowing about before you assume something is missing or delete it as dead:

| Thing | Status |
|---|---|
| In-feed alerts UI | Behind `SHOW_ALERTS_UI = false` in [NewsFeed](components/NewsFeed.tsx#L57). Keywords still save from Account settings and still drive newsletter ranking. |
| [BreakingTicker](components/BreakingTicker.tsx) | Fully implemented marquee ticker, not imported anywhere. |
| [InFeedSponsorCard](components/InFeedSponsorCard.tsx) | Implemented, and `getInFeedSponsor()` reads `NEXT_PUBLIC_IN_FEED_SPONSOR_ENABLED`, but the card isn't rendered in the feed yet. |
| [BrandLogo](components/BrandLogo.tsx) | Unused; `AppShell` and `PublicFooter` inline their own logo markup. |
| [AdvertiseContactForm](components/AdvertiseContactForm.tsx) | Renders and validates, but `handleSubmit` only sets local state — it sends nothing. The page tells users to email instead. |
| `/api/email-open`, `/api/email-click` | Legacy tracking endpoints kept for already-delivered emails. |
| `AppShell` tab props | `activeTab` / `onTabChange` are accepted then `void`-ed; tab switching lives in the filter bar. |
| Account deletion / data export | Account settings says "contact support". No destructive deletion is implemented. |

---

## 20. Conventions and Gotchas

1. **`article.link` is identity.** Compare with `normalizeArticleLink()`, never
   raw string equality across sources.
2. **Don't touch [lib/rss.ts](lib/rss.ts)** unless parser behavior must change —
   it's load-bearing and covered by tests.
3. **Feed edits go in [lib/feeds.ts](lib/feeds.ts) only.** Keep source names stable;
   they're stored in `saved_articles.source` and `newsletter_sent_articles.article_source`,
   and renaming one orphans that history.
4. **Service-role key is server-only.** Never import
   [lib/supabase/admin.ts](lib/supabase/admin.ts) into a `"use client"` module.
5. **`TEST_NEWSLETTER_EMAIL` silently suppresses all other sends.** Check it first
   when a production send "did nothing".
6. **`APP_BASE_URL` throws in production.** That's intentional — better a loud
   failure than emails full of `localhost` links.
7. **Article images use plain `<img>`, not `next/image`.** RSS images come from
   arbitrary hosts; maintaining `remotePatterns` for every publisher isn't
   practical. The ESLint rule is disabled inline where this happens.
8. **Optimistic UI everywhere** for saves and alert keywords — always capture the
   previous state and revert on error.
9. **`proxy.ts`, not `middleware.ts`** — Next.js 16 naming.
10. **Logging is structured and scoped**; follow the `[area][action][step]` pattern.

---

## 21. AI News Briefing (disabled by default)

The existing authenticated dashboard includes an optional **View AI Briefing**
action. A bodyless, same-origin `POST /api/ai/briefing` returns a validated shared
briefing when cached and generates only on a cache miss. There is no generation
on homepage load or news polling. The UI shows generation time, up to five
headline/explanation items, and source article links. It labels the output as
AI-generated summaries based on available publisher metadata, not full articles.

Selection reuses existing RSS fetching, canonical link identity, and newsletter
story deduplication without changing their implementations. Only recent bounded
metadata is supplied: up to 12 stories from at most 60 candidates, titles, canonical
links, source labels, publication times, and available summaries. Missing summaries
remain null. All model references must exactly match input links; displayed source
labels/titles/URLs come from application data. Structured output and local validation
reject malformed results, but do not prove factual grounding.

The [November 14 editorial refinement](docs/AI_EDITORIAL_REVIEW.md) ranks eligible
stories using category, recency, summary availability and soft topic/source diversity
before bounding the pool, while retaining the existing event deduplicator. The
panel is titled **Your News Briefing**, limits reading width and shows cache origin
and expiry with manual refresh. Compatible `editorial-v1` guidance keeps the
`metadata-v2` cache contract: valid cached evidence is revalidated in stored order
and served until expiry without an extra generation. No production settings or
deployment were changed for this refinement; default flags remain disabled.

Server-only Claude Messages integration uses Anthropic's official TypeScript SDK
and the explicitly configured model `claude-haiku-5-5` (verified against official
Anthropic documentation). `output_config.format` supplies a transformed wire
schema; the unchanged local schema and business validator enforce all length,
count, and exact source-link checks. The adapter handles text/thinking blocks,
usage and stop reasons, with low effort, no tools, timeouts, byte/token limits,
and no automatic retries. SDK logging/tracing are disabled. No Python service is
introduced. `ANTHROPIC_API_KEY` stays in private
environment variables. Existing Supabase authentication and IP rate limiting are
reused; separate Redis controls add authenticated-user limits, shared caching,
ownership-checked generation leases, and global UTC-day attempt budgets. Defaults:
900-second briefing cache, 90-second RSS snapshot, 48 attempts/day, 30-second retry
cooldown after failure. Failed calls count toward budget but do not impose the full
success cache interval. Valid cached results remain accessible at the attempt limit.

Configuration is in [.env.example](.env.example). `AI_BRIEFING_ENABLED=false` is the
default; production additionally requires `AI_BRIEFING_PRODUCTION_VERIFIED=true`
after explicit approval and rollout review. No Supabase migrations, email sending,
subscription updates, authentication-flow changes, or existing analytics changes
are part of this feature.

- [Operation, configuration, limitations, and test commands](docs/AI_BRIEFING.md)
- [AI assistance and development provenance](docs/AI_DEVELOPMENT.md)
- [Separate repository follow-up tickets](docs/FOLLOW_UP_ISSUES.md): Sentry sanitizer
  registration, App Router cron monitoring, effective cache documentation, and
  newsletter duplicate-send guarantees. Security concerns were investigated for the
  new path; deployed telemetry verification remains a production rollout requirement.

Deterministic tests mock model/auth/Redis boundaries. The real-component Chrome
check is `node scripts/validate-ai-briefing-ui.mjs`; it intercepts all briefing
requests with fixtures and makes no provider call. The separate live smoke script
requires explicit paid-call opt-in and an approval environment variable. Actual
provider compatibility, real Redis Lua/concurrency, and grounding quality remain
live rollout checks, not claims established by mocked tests.

## Local performance and authentication review

See [the measured performance review](docs/PERFORMANCE_REVIEW.md) for baseline and
after results, regression checks, remaining production-auth uncertainty and
OneDrive findings. Feed filters/counts use all articles; `NewsList` mounts 30
stories initially, with a **Show more** action adding 30 at a time. Auth failures
always release submission state, including non-JSON responses. Redis protection
failures return a sanitized retryable 503 rather than escaping as a 500.

## Shared Redis environment keyspaces

See [Redis keyspaces](docs/REDIS_KEYSPACES.md) for exact prefixes, tests and the
unapproved future production rollover. Local use requires `REDIS_KEYSPACE=dev`;
Vercel's server-provided `VERCEL_ENV` selects dev/preview/production. Missing or
conflicting selection with configured Redis fails closed. IP limiter keys and all
AI cache, RSS snapshot, user limit, daily budget, lease and cooldown keys use this
policy. Dev and preview have separate prefixes and AI hash tags; production keeps
`@upstash/ratelimit` and `kicker:{ai-briefing}:v1:` unchanged. Legacy keys must not
be reset or deleted. This is logical separation in one shared database, not
credential, availability, storage or billing isolation. No live writes, production
rollover, Vercel configuration changes or deployments were performed.

## Final AI pre-deployment review

See [the final review and staged deployment checklist](docs/AI_PREDEPLOY_REVIEW.md).
The briefing now has compact numbered editorial rows, accessible source citations
and an explicit empty-result error. Provider validation emits sanitized failure
categories without weakening citation checks. Prompt `metadata-v2` aligns with
existing uniqueness rules and warns against combining reports solely by location
or timing. Only cache scope changes; Redis budget/lock/cooldown keys are preserved.
The review includes the exact cached metadata audit, current cost estimates, 148
passing mocked tests and the remaining production authentication/telemetry gates.
No push, deployment or new paid model call was performed in that review.

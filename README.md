# Kicker News

Kicker News is a Next.js 16 App Router news app that aggregates trusted RSS and Atom feeds into a clean public homepage, then layers on personalized features for signed-in users.

## Project Overview

The app has two main modes:

- A public news feed for signed-out visitors
- A personalized dashboard for signed-in users

Core article identity is based on `article.link`, which is treated as the canonical article key throughout the app.

## Tech Stack

- Next.js 16 App Router
- React
- TypeScript
- Tailwind CSS
- Supabase Auth and Postgres
- Resend
- Vercel

## Core Features

- Public news feed
- Authenticated dashboard
- Saved articles
- Custom alerts and smart alert matching
- Newsletter subscriptions and preferences
- One-click unsubscribe flow
- Email analytics
- Public SEO and marketing pages

## Local Setup

1. Clone the repository
2. Install dependencies

```bash
npm install
```

3. Copy `.env.example` to `.env.local`
4. Fill in the required environment variables
5. Start the development server

```bash
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values you need.

### Supabase

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Resend

- `RESEND_API_KEY`

### App URL

- `APP_BASE_URL`
- `NEXT_PUBLIC_APP_BASE_URL`

### Optional Observability

- `SENTRY_DSN`
- `NEXT_PUBLIC_SENTRY_DSN`
- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

### Cron and Newsletter

- `CRON_SECRET`
- `TEST_NEWSLETTER_EMAIL`
- `NEWSLETTER_MAILING_ADDRESS`

### Optional Analytics

- `NEXT_PUBLIC_PLAUSIBLE_DOMAIN`
- `NEXT_PUBLIC_GA_MEASUREMENT_ID`
- `NEXT_PUBLIC_POSTHOG_KEY`

### Optional Sponsors

- `NEXT_PUBLIC_IN_FEED_SPONSOR_ENABLED`
- `NEWSLETTER_TOP_SPONSOR_LABEL`
- `NEWSLETTER_TOP_SPONSOR_TITLE`
- `NEWSLETTER_TOP_SPONSOR_DESCRIPTION`
- `NEWSLETTER_TOP_SPONSOR_CTA_TEXT`
- `NEWSLETTER_TOP_SPONSOR_CTA_URL`
- `NEWSLETTER_MID_SPONSOR_LABEL`
- `NEWSLETTER_MID_SPONSOR_TITLE`
- `NEWSLETTER_MID_SPONSOR_DESCRIPTION`
- `NEWSLETTER_MID_SPONSOR_CTA_TEXT`
- `NEWSLETTER_MID_SPONSOR_CTA_URL`

## Common Commands

```bash
npm run dev
npm run lint
npx tsc --noEmit
npm test
npm run build
```

## RSS Feed Architecture

- Feed configuration lives in `lib/feeds.ts`
- RSS and Atom parsing plus normalization live in `lib/rss.ts`
- API consumers read article data through `getAllNewsItems(...)`
- `article.link` is the canonical article identity used for feed dedupe, saved articles, alerts, and newsletter tracking

Do not change `lib/rss.ts` unless parser behavior actually needs to change.

## How to Add or Edit RSS Feeds

Update `lib/feeds.ts` when adding or editing sources.

Each feed entry should include:

- a user-facing source name
- the RSS or Atom URL
- the coverage value used by the feed filters

When editing feeds:

- keep the source naming stable unless there is a real product reason to rename it
- preserve any metadata used by filters
- avoid parser changes unless the feed format truly requires it

### Topics and newsletter ordering

The catalog includes 30 feeds from 18 source names. New publishers include Ars
Technica, TechCrunch, NASA, ScienceDaily, PBS NewsHour, and Deutsche Welle.
Dedicated topic feeds expand BBC, Guardian, and NPR coverage. Publisher feed
references: [BBC](https://support.bbc.co.uk/platform/feeds/NewsFeeds.htm),
[Guardian](https://www.theguardian.com/help/feeds), and
[NASA](https://www.nasa.gov/rss-feeds/).

`lib/news-categories.ts` defines ten categories: business, education,
entertainment/culture, environment, general news, health, politics, science/space,
sports, and technology. Dedicated feeds supply the category; general feeds use
recognized RSS/Atom topic metadata and fall back to general news. Categories are
preserved when identical links appear in multiple feeds and when stories are saved.
Older saved articles without topic metadata appear under General News.

The category menu works alongside search, source, coverage, time, and saved-story
filters. Account → Newsletter → Newsletter order lets subscribers choose
**Group by category**. Category sections are alphabetical and preserve the existing
recency or personalized ranking within each section. Both HTML layouts and plain
text emails use the same order; existing subscribers keep their current order.

Before deploying these changes, apply
`supabase/migrations/20261030_add_newsletter_sort_order.sql` in Supabase. It adds
`newsletter_subscriptions.sort_order` (default `default`, optional `category`) and
the nullable `saved_articles.category` field. Deploy the migration before the app.

Additional validation commands (Node 24):

```bash
# Verify topic feeds over the network; --all checks every active feed;
# --retired re-checks the four retired endpoints (see docs/RSS_FEED_HEALTH.md).
node --experimental-strip-types scripts/validate-news-feeds.mjs
node --experimental-strip-types scripts/validate-news-feeds.mjs --all
node --experimental-strip-types scripts/validate-news-feeds.mjs --retired

# Real-component browser checks, using installed Chrome and a temporary local route.
# Override CHROME_PATH when Chrome is installed elsewhere.
node scripts/validate-news-ui.mjs
node scripts/validate-news-ui.mjs --live-homepage
```

The browser check uses local ports 3100 and 9311, mocks newsletter saves, checks
seven viewport widths from 320px to 1920px, saved-story filtering, and both header
variants with pending updates. `--live-homepage` also checks the actual homepage
with live news. It removes its temporary route and generated route types on exit. It does
not sign in, write account data, or send email. Live feed availability varies.
The four endpoints that always failed (CNN, USA Today, Reuters U.S., Reuters World)
were confirmed permanently retired by their publishers on November 15, 2026 and are
no longer fetched; evidence and the re-check procedure are in
[docs/RSS_FEED_HEALTH.md](docs/RSS_FEED_HEALTH.md). Feed failures remain isolated,
requests time out after 12 seconds, and a partial outage shows a compact notice
listing the affected publishers instead of a banner.

`node scripts/validate-dashboard-ui.mjs` checks the signed-in dashboard's **News
Feed** / **AI Hub** sections (ports 3104/9315): tabs and keyboard, `?view=ai` direct
links, Back/Forward, state and scroll preservation, the feed-health notice and three
widths, with every `/api/*` request intercepted in the browser.

## AI News Briefing (disabled by default)

The signed-in dashboard can show **View AI Briefing**, an on-demand, shared briefing
with up to five sourced items. It reuses RSS ingestion and story deduplication.
Results summarize bounded publisher metadata, not full articles. Claude calls use
Anthropic's official TypeScript SDK and Messages API server-side, with structured
output, validated input references, Redis caching,
generation leases, authenticated-user limits, and global attempt budgets.

See [AI Briefing setup and tests](docs/AI_BRIEFING.md),
[AI development provenance](docs/AI_DEVELOPMENT.md), and
[separate repository follow-up issues](docs/FOLLOW_UP_ISSUES.md).
Keep `AI_BRIEFING_ENABLED=false` until paid testing is approved. Production also
requires `AI_BRIEFING_PRODUCTION_VERIFIED=true` after rollout review and approval.
Configure private `ANTHROPIC_API_KEY`, `AI_BRIEFING_PROVIDER=anthropic`, and
`AI_BRIEFING_MODEL=claude-haiku-5-5`. This model ID and structured JSON compatibility
were verified against official Anthropic documentation; account access still needs
the separately approved live smoke test. Existing private environment files are
not modified automatically.

## Newsletter System Overview

Newsletter delivery uses:

- `newsletter_subscriptions` for subscription state
- `app/api/send-newsletter/route.ts` for send orchestration
- `lib/newsletter.ts` for subject lines, HTML/text rendering, unsubscribe URLs, and tracking URLs
- `lib/newsletter-deduplication.ts` for cross-source story deduplication
- Resend for delivery

The send route is responsible for:

- eligibility checks
- merging matching recent stories across sources before per-user selection, preferring a non-paywalled version when available
- ranking and personalization selection
- dedupe against previously sent articles
- unsubscribe handling
- open and click tracking integration

The sender reads available subscription columns and defaults missing optional
preferences, so a pending category migration cannot stop scheduled email delivery.
The category settings migration is still required to save category preferences.
For a targeted delivery check, `/api/send-newsletter?email=<subscriber-email>`
uses the same cron authorization and only considers that active subscription.
Normal frequency checks and previously sent article exclusions still apply.

New York Times articles are labeled "Subscription required" in both newsletter
email formats.

Deliverability checklist:

- configure SPF, DKIM, and DMARC on the sending domain
- keep `List-Unsubscribe` and `List-Unsubscribe-Post` enabled
- keep the hidden preheader text in place for inbox previews
- verify the unsubscribe link works in both browser and one-click mail client flows
- set `NEWSLETTER_MAILING_ADDRESS` in production so the footer includes your mailing address

## Supabase Overview

Supabase handles:

- authentication
- saved articles
- user preferences
- alert keywords
- newsletter subscriptions
- send logs
- click and open analytics

Keep user-scoped queries scoped by `user_id` or the authenticated user session.

## Deployment Notes

- Deploy on Vercel
- Add all required production environment variables before going live
- Configure `CRON_SECRET` for scheduled newsletter sends
- Verify your Resend sender/domain setup before relying on production email delivery
- Review legal pages and privacy copy before marketing the site

## Monitoring and Health Checks

### Sentry

Sentry is configured through the official Next.js SDK pattern using:

- `instrumentation.ts`
- `instrumentation-client.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `next.config.ts`

Required env vars for a real Sentry project:

- `NEXT_PUBLIC_SENTRY_DSN`

Optional build-time source map upload vars:

- `SENTRY_AUTH_TOKEN`
- `SENTRY_ORG`
- `SENTRY_PROJECT`

Source map upload stays optional and only runs in builds on Vercel with the auth token
configured. Local and CI builds never upload, even if `.env.sentry-build-plugin` holds a token.

### UptimeRobot

Use these public endpoints for uptime checks:

- `/api/health`
- `/api/health/newsletter`

`/api/health` is the best default monitor target because it is fast, public, and does not touch private user data.

## Testing Checklist

Before deploying, run:

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

Suggested manual checks:

- public homepage loads and articles render
- authenticated dashboard loads saved articles, alerts, and newsletter settings
- newsletter settings can be updated
- unsubscribe flow works
- email analytics page loads for authenticated users

## Safety Notes

- Never commit real secrets
- Keep service-role keys server-side only
- Keep user data access scoped correctly
- Treat `article.link` as canonical identity
- Test before deploying changes that touch feeds, newsletters, or auth

## Account Hygiene Roadmap

The account settings page now includes a visible `Account & data` section with:

- `Export my data` placeholder
- `Delete my account` placeholder

These are intentionally marked as coming soon. Destructive deletion is not enabled yet.

## Local performance diagnostics

For shared Upstash databases, read [Redis keyspaces](docs/REDIS_KEYSPACES.md).
Local Redis use requires server-only `REDIS_KEYSPACE=dev`. Vercel Preview gets a
separate prefix; production retains legacy keys pending an approved rollover.
Logical key separation does not isolate credentials or free-tier resource usage.

See [the performance review](docs/PERFORMANCE_REVIEW.md) for measured improvements,
remaining authentication checks and local testing instructions. With the local
server running and AI disabled, `node scripts/profile-local.mjs after` measures
Chrome rendering, checks pagination/filtering and mocks a failed login. It does
not submit credentials or call the AI provider. Raw reports are ignored under
`.next/performance/`.

For final AI review evidence, costs, blockers and the disabled-first deployment
sequence, see [AI pre-deployment review](docs/AI_PREDEPLOY_REVIEW.md).

Ask Kicker AI lets signed-in readers ask cited questions about recent coverage. It is
enabled exactly when the AI Briefing is (`AI_BRIEFING_ENABLED`, plus
`AI_BRIEFING_PRODUCTION_VERIFIED` in production) and needs no variables of its own. It
reuses the Anthropic key, `AI_BRIEFING_MODEL` (must be `claude-haiku-5-5`) and Upstash,
with its own separate Redis keys, quotas, budgets and private cache.
Mocked browser check: `node scripts/validate-ask-kicker-ui.mjs`.
Zero-cost evaluation: `node --experimental-strip-types scripts/eval-ask-kicker.mjs`; the
paid procedure and its approval checkpoints are in [ASK_KICKER_EVAL.md](docs/ASK_KICKER_EVAL.md).
See [Ask UI, verification and remaining production steps](docs/ASK_KICKER_AI.md#stage-d-dashboard-interface-disabled-by-default).

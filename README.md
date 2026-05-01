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

### Cron and Newsletter

- `CRON_SECRET`
- `TEST_NEWSLETTER_EMAIL`

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

## Newsletter System Overview

Newsletter delivery uses:

- `newsletter_subscriptions` for subscription state
- `app/api/send-newsletter/route.ts` for send orchestration
- `lib/newsletter.ts` for subject lines, HTML/text rendering, unsubscribe URLs, and tracking URLs
- Resend for delivery

The send route is responsible for:

- eligibility checks
- ranking and personalization selection
- dedupe against previously sent articles
- unsubscribe handling
- open and click tracking integration

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

# Follow-up issues from the AI Briefing repository review

These are local issue records, not externally published tickets. They are separate
from the briefing milestone; no unrelated fixes were made.

## KN-SEC-001 — Sentry sanitizer registration (addressed locally; live verification pending)

`lib/sentry.ts` defines `sanitizeSentryEvent()`, but repository search found no
`beforeSend` registration in server, edge, or client Sentry configuration. The
overview's description can imply active header/token redaction. `sendDefaultPii:
false` is configured, but does not establish that the custom sanitizer executes.

Investigation for this milestone: provider keys are read only server-side; metadata
contains no account data; the fixed provider URL does not contain query credentials;
the provider does not follow redirects; provider/Redis exceptions are contained and
replaced with safe application codes before logging. No raw output is rendered as
HTML. These are feature-local mitigations, not a fix to global telemetry.

Acceptance for follow-up: register and test appropriate sanitization across all
runtimes, inspect deployed telemetry/replay and outbound request instrumentation,
and establish a redaction regression test. Deployment verification remains required
before enabling AI in production; no paid/live telemetry verification was performed.

Stage C repair: the missing registration was confirmed. Server, edge and client
now share a strict outgoing-event/span allowlist; request payloads/headers/cookies,
arbitrary context, error text and attachment hints are removed. SDK logs,
breadcrumbs and replay are disabled. Mocked sentinel tests verify hooks actually
register in all three runtimes. General Sentry detail/grouping is reduced by design.
Actual deployed envelopes/platform logging remain an approval-gated Stage D check;
this local repair does not establish universal telemetry safety.

Live-evaluation review update: synthetic sentinels sent through the real
`@sentry/nextjs` Node pipeline (in-memory transport, `.invalid` DSN) produce no
private text, attachments, logs, replay or dynamic sampling context; this runs in
`npm test`. Still unverified: the edge and browser pipelines end to end, the
`/monitoring` tunnel, real envelopes received by the Sentry project, and Vercel
function logs/drains. Release-health session envelopes, which bypass `beforeSend` and
carry `did`/user agent once a release is set, are now disabled in every runtime (found
by CI, November 15, 2026).

## KN-OBS-002 — App Router cron monitoring claim (open)

`PROJECT_OVERVIEW.md` says Vercel cron monitors are enabled. `next.config.ts`
configures `automaticVercelMonitors`, but its SDK guidance explicitly says this does
not work with App Router handlers. The newsletter uses such a handler.

Acceptance: verify actual cron monitoring and use supported explicit instrumentation
if needed; correct the overview to distinguish configuration from observed monitoring.

## KN-DOC-003 ? Effective feed-cache behavior (addressed locally; deployment unchanged)

The performance milestone replaces separate homepage/API merged caches with a
shared per-feed process cache and documents effective refresh/polling behavior.
Regression tests cover freshness, single-flight, failure backoff, last-good expiry
and API failure metadata. Cache persistence across processes remains a limitation;
see `PERFORMANCE_REVIEW.md`. No deployment was performed.

## KN-REL-004 — Newsletter duplicate-send guarantee (open)

The overview says no article is ever sent twice, but
`getSentArticleLinksForSubscription()` returns an empty set after a database lookup
error. This can weaken duplicate protection. Concurrent send idempotency also needs
a separate audit before making an absolute guarantee.

Acceptance: decide fail-closed behavior for sent-history failures and test database
errors/concurrent runs. Do not change newsletter delivery as part of the AI milestone.

## KN-UI-005 — Global form-control font rule overrides Tailwind utilities (resolved locally)

Found during Ask Kicker Stage D screenshot review. `app/globals.css` declares an
unlayered `button, input, select, textarea { font: inherit; }`. Tailwind v4 places
utilities in a cascade layer, and unlayered rules win regardless of specificity, so
`text-*`, `font-*` and `font-mono` classes on those elements are silently ignored
across the app (for example, the briefing button renders at the inherited size and
weight instead of `text-sm font-semibold`). Ask Kicker works around it with inner
spans and intentionally keeps its input at 16 px to avoid iOS focus zoom.

Acceptance: move the rule into `@layer base` (or remove it, since Tailwind's
preflight already sets `font: inherit` in its base layer). Then visually review
every existing button/input/select, since sizes and weights will change app-wide.
Not changed in Stage D to avoid unrelated visual changes.

Resolution (live-evaluation review, November 14, 2026). Root cause confirmed: the rule
was unlayered while Tailwind 4.2.2's preflight already applies `font: inherit` to
these elements inside `@layer base`, so the copy had no effect except overriding
every layered utility. It was deleted. Measured first: deleting it alone changed
49–56 controls (all inputs/selects/textareas 16 px → 14 px, which triggers iOS Safari
focus zoom; mobile card "Save" buttons 16 px → 10 px; label weights 400 → 500/600).
To preserve the shipped design, the 113 font utilities that had never applied were
removed from button/input/select/textarea class lists (an AST codemod touching only
the control element's own `className`, never children, colours, tracking or
`!`-important tokens). Those controls inherit exactly as before.

Verification: `node scripts/validate-form-typography.mjs --expect-unchanged` renders
every component with form controls plus six static pages at 390/768/1024/1280/1600 px.
It finds **0 controls** whose computed size, weight, line height or family differs from
the legacy cascade, probe controls prove utilities now apply, and nothing overflows.
`tests/global-css.test.mjs` fails if an unlayered typography rule for form controls
returns. The news, briefing and Ask browser suites also pass. Font utilities on
controls now work as written.

## KN-UI-006 — Unlayered `a {}` rule overrides colour/decoration utilities on links (open)

The same cascade problem affects `a { color: inherit; text-decoration: none; }` in
`app/globals.css`: `text-*` colour and `underline` utilities placed directly on `<a>`
are ignored (which is why components put them on inner spans). Preflight already
sets `color: inherit` and `text-decoration: inherit` on links in its base layer.
Measured impact of removing it: 1 link each on `/contact`, `/advertise`, `/privacy`
and `/unsubscribe/success` would change; 0 of 56 links in the dashboard fixture.
Acceptance: remove it, preserving the current look the same way as KN-UI-005, and
verify with the typography script's anchor audit. Out of scope for the Ask milestone.

## KN-UI-007 — Intended control typography that never shipped (design decision)

Removing the dead classes (KN-UI-005) preserved what users actually see, which differs
from what the class lists described: inputs/selects at 14 px, semibold buttons and
11–13 px badges never rendered. A deliberate typography pass could adopt them, but
keep form fields at 16 px or more on mobile (iOS zoom), and keep tap targets and
label sizes legible (the card "Save" buttons would have been 10 px). One visible
inconsistency was preserved on purpose: AccountMenu's "Log in" button (weight 400)
sits beside the "Newsletter" link (weight 500).

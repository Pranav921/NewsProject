# Follow-up issues from the AI Briefing repository review

These are local issue records, not externally published tickets. They are separate
from the briefing milestone; no unrelated fixes were made.

## KN-SEC-001 — Sentry sanitizer is not registered (open; security rollout review)

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

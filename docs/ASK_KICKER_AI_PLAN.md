# Ask Kicker AI — design and Stage A/B/C progress

The owner approved Stages A, B and C after the briefing release. Retrieval, the
fixed Claude workflow and a disabled authenticated backend with Ask-only Redis
controls are implemented locally. Stage D adds the flag-gated dashboard UI; an
iterative agent remains a proposal.
No paid model requests, infrastructure/configuration changes or deployment were
performed. This work is separate from the completed briefing release.

## Stage A implementation

- `lib/ai/ask.ts`: schemas, argument validation, result types and sanitized errors.
- `lib/ai/ask-retrieval.ts`: bounded immutable snapshots and the three read-only tools.
- `lib/ai/ask-snapshot.ts`: optional server-only adapter to the existing cached RSS
  interface. It reads once and never forces a refresh; tool calls do no further I/O.
- `tests/fixtures/ask-news.mjs`, `tests/ask-retrieval.test.mjs` and
  `tests/ask-snapshot.test.mjs`: synthetic relevance sets and deterministic checks.

See [Stage A arguments, selection, evaluation and limitations](ASK_KICKER_AI.md).
The eight evaluation cases include five successful positive keyword/alias cases,
one correct no-results case and two explicit lexical failures. This is not semantic
search or a complete weekly archive. Unknown IDs return `not_found`; malformed or
out-of-contract arguments throw sanitized errors. Publisher mode preserves distinct
sources; normal story mode retains the existing cross-source deduplication behavior.

Stage A adds no public entry point, model dependency, new database, Redis keys,
feature flag or changes to briefing caches/quotas. Verification results are recorded
in the guide; the 170-test result below is the Stage A baseline, not Stage B evidence.
Final local checks: **170 tests passed**, ESLint passed, TypeScript passed and the
production build passed. No commit, push, deployment or live provider test occurred.

## Stage B implementation

`ask-answer.ts`, `ask-provider.ts` and `ask-service.ts` implement one validated
tool execution and at most two model requests, using the existing official SDK.
The full assistant message precedes the matching user tool result; the final call
has tools disabled and structured JSON output. Citations must match the exact tool
result, with all source display data resolved by the backend. Empty results skip
the second call; feed failure stays distinct. Configurable output budgets, a shared
abort deadline, byte caps and sanitized errors are tested with injected responses.
No public caller, UI, Redis budgets, credentials/configuration changes or live calls
were added. Stage A and the existing briefing runtime files remain unchanged.
See [the implemented Stage B contract and limits](ASK_KICKER_AI.md#stage-b-bounded-tool-calling).
The Stage C section below supersedes the older proposed route/store limits.

Stage B local checks: **191 tests passed** (170 baseline + 21 new), ESLint passed,
TypeScript passed and the production build passed. All new provider responses were
mocked, including the official SDK HTTP tests; no live compatibility or grounding
quality is claimed. Existing nonfatal Node module-mode warnings remain unchanged.

## Stage C implementation

`app/api/ai/ask/route.ts`, `ask-settings.ts`, `ask-store.ts` and `ask-backend.ts`
add the guarded request lifecycle, private cache and atomic leases/budgets.
The authoritative Redis selector adds Ask-only dev/preview/prod prefixes; existing
legacy production keys are unchanged. Stage B now returns the exact backend tool
evidence internally so cached answers can revalidate citations without a second
tool execution. Evidence is not returned separately by the public route or logged;
cache citations are reconstructed from matching trusted snapshot records.

Defaults: Ask flags false; user 3/minute and 10/day, IP 5/minute, global 20/day
(since the live-evaluation review: 20 cache-miss generations/day, cache hits excluded);
one in-flight/user and two globally, 45s owned leases; at most 40 model attempts
and 2.7M conservative token units/day; cache 300s; whole request 30s including RSS.
Cache hits count as requests and make no model calls. Failed started calls remain
charged; only never-started reservations are released. Unrecoverable cleanup
failures retain reserved capacity until day rollover, favoring cost safety.

Sentry registration was confirmed missing and repaired across all runtimes with
an outgoing allowlist; SDK logs, breadcrumbs and replay are disabled. This reduces
general diagnostic detail. Full implementation/configuration, privacy tradeoffs,
mock limitations and Stage D requirements are in [the guide](ASK_KICKER_AI.md#stage-c-secure-backend-disabled-by-default).
No live Redis/provider call, UI, production change, commit, push or deploy occurred.

Final Stage C verification: **224 tests passed** (191 baseline + 33 regressions),
ESLint passed, TypeScript passed and production build passed with both AI features
disabled in that process. Redis semantics/concurrency use mocked storage; actual
Lua/cloud/model/telemetry verification remains separately approval-gated. The
credential-pattern scan found no matches; `.env.local` remains ignored/untracked.

## Stage D implementation

`components/AskKicker.tsx` and browser-safe `lib/ai/ask-ui.ts` add the dashboard
panel under the briefing, rendered only when the route's own flags pass. The browser
sends only `{question}`. Citations, coverage dates, incomplete-RSS notes, cache and
generation labels, all four answer statuses and every route failure (rate limit with
countdown, busy, budget, provider, deadline, session, origin, network) are handled
accessibly. No backend file changed. Local evidence closes two Stage C gaps: the real
Lua passed 18/18 checks on a disposable Redis 7.2 through the real Upstash client, and
synthetic sentinels sent through the real Sentry SDK produced no leaks. Checks:
**232 tests**, lint, TypeScript, build and both mocked Chrome validators passed. No
paid call, shared Redis access, deployment or commit occurred. See
[Stage D details and remaining production steps](ASK_KICKER_AI.md#stage-d-dashboard-interface-disabled-by-default).

## Live-evaluation preparation

Before any real-model call, the implementation was reviewed end to end. Three
changes, each covered by tests and the real-Redis harness (21/21):
1. Global capacity: per-user/IP abuse limits still count cache hits, while the global
   cap counts only cache-miss generations at reservation.
2. Cleanup: a client disconnect still releases the lease and refunds never-started calls.
3. CSS: the KN-UI-005 cascade bug is fixed with zero measured visual change.

An evaluation harness (five questions plus a cache repeat, automated scoring and a
manual grounding checklist) and a controlled live procedure with approval checkpoints
are in [ASK_KICKER_EVAL.md](ASK_KICKER_EVAL.md). No paid call has been made.

## Smallest useful milestone

An authenticated dashboard question box answers one standalone question about
articles currently available through Kicker's RSS pipeline. Show a short cited
answer, reporting dates, available coverage and a publisher-metadata disclaimer.
Examples include comparing available Nvidia reports or summarizing available
economy coverage. This is not a personalized assistant or full-article research.

The repository does not establish a complete persistent article archive. Existing
per-feed caching retains last-good data for 30 minutes, and the briefing Redis RSS
snapshot lasts 90 seconds. Neither is a week-long index. A date filter may select
available articles from the past week, but must never claim complete weekly coverage.
Return requested and available time ranges, article count and feed-failure status.
If comprehensive weekly research becomes necessary, separately design a small
Supabase metadata archive; a vector database is not needed for that requirement.

## Request flow and tools

Use the existing Next.js/TypeScript app and official Anthropic SDK in a new
server-only route. Keep the existing briefing provider and bodyless route contract
intact: the Ask endpoint has its own bounded JSON request containing only a question.

1. Check a separate disabled-by-default Ask feature flag, exact origin/CSRF policy,
   Supabase session, body size, question length and IP/user rate limits.
2. Load a shared short-lived RSS metadata snapshot through existing RSS functions;
   preserve canonical-link identity. Bind the request to this immutable snapshot.
3. Check a short-lived per-user answer cache keyed by hashed user ID, question,
   snapshot fingerprint, model and prompt version. Never share private questions
   across users or log raw questions. Do not cache transient errors as answers.
4. Acquire an ownership-checked request lease and atomically reserve the maximum
   two model invocations and their configured token budgets before the first call.
   Charge actual attempts including failures; release only reservations for calls
   never started. Use separate Ask keys and quotas, without touching briefing keys.
5. Let Claude request one allowlisted read-only tool using Messages `tools` with
   JSON `input_schema` and authoritative local input parsing. Parse content blocks;
   require a valid `tool_use` stop and validate its name/arguments before execution.
6. Execute the tool in the backend, return a matching `tool_result` using its
   `tool_use_id`, then make one final structured-answer call with tools disabled.
   Preserve the assistant content blocks required by the Messages protocol; never
   render or log reasoning blocks. Reject unexpected tools or incomplete output.
7. Validate answer shape and citations against articles actually returned by the
   tool. Resolve source names, titles and URLs in application data. Cache only a
   successful validated result. Always release the owned lease on exit.

Proposed tools (functions inside the server, not public unauthenticated endpoints):

| Tool | Validated input | Execution |
| --- | --- | --- |
| `search_articles` | Query ≤160 characters; optional category, known sources ≤3, lookback ≤7 days; limit ≤8 | Deterministic title/summary token matching, recency tie-breaks; small tested aliases such as AI/artificial intelligence. Report coverage, not exhaustive search. |
| `recent_news` | Optional known category; lookback ≤7 days; limit ≤8 | Recent available articles, using briefing editorial preferences where appropriate. |
| `article_details` | One snapshot article ID | Return existing metadata only; no arbitrary URL fetch, scraping, SQL or full text. Unknown IDs return not-found. |

All tools operate on the same snapshot. Use stable IDs derived from normalized
canonical links. Sources/categories are validated against application data, not
accepted as arbitrary endpoints. Canonical duplicates are removed; default result
lists reuse existing story deduplication. Comparison requests retain distinct
publisher reports, because collapsing all coverage to one representative would
defeat publisher comparison. Explain disagreements only when metadata states them.

The final schema should contain `status` (`answered`, `no_results`,
`needs_clarification`, `unsupported`), up to five short statement objects with
`articleIds`, and optional clarification/coverage notes. Answered factual statements
require at least one retrieved ID. The backend builds clickable references; the
model cannot provide display URLs. No-results/clarification text must not smuggle
uncited factual claims. Citation integrity is structural, not an entailment proof.

## Why a fixed tool workflow first

One-step tool calling means one retrieval decision and execution, followed by one
answer: **two model requests**, not one (one when retrieval is empty). Stage B
requires one tool call (`any` plus `disable_parallel_tool_use: true`), then requests
an answer or abstention with `none`. Haiku supports forced tool use; other model
selections must be checked for compatibility rather than assuming this setting works.
It supports a standalone question and questions naming a snapshot article ID.

An iterative bounded agent can examine a search result, request article details,
refine the query, then answer. That needs a controlled loop, more contexts and more
model requests. It is useful only if evaluations show the fixed workflow fails
important questions. A later version could allow two tool rounds/three model
requests total, under a cumulative budget. No framework, autonomous background
process or new service is needed for either version. Unknown tool calls and model
requests beyond the bound are rejected in code, not merely discouraged by a prompt.

## Proposed configurable limits

Start conservatively and adjust only with measured evidence:

- Request body ≤2 KiB; question ≤500 characters; no conversation history in v1.
- At most 300 recent valid snapshot articles (apply a deterministic bound and
  disclose truncation), 8 results/tool, 12 KiB total tool-result metadata.
- Stage B: one tool execution, at most two model invocations, default 384 output
  tokens for selection and 1,200 for the answer, 48,000-byte serialized request cap
  and 65,536-byte response cap. Input-token counting and cumulative Redis monetary
  exact input-token counting remains unimplemented; byte bounds are not token counts.
  Stage C now implements conservative two-call Redis token-unit reservations.
- Stage B: 30-second total workflow deadline after snapshot loading, shared by both
  model calls; no retries, repairs, recursion, web tools or background work. Stage C
  now includes feed loading in its 30-second whole-request deadline.
- Per user: 3 questions/minute and 10/day initially. Global: 20 questions/day and
  at most 40 model invocations/day, with an aggregate token/spend reservation.
- At most one in-flight Ask request per user and two globally, using expiring
  ownership-checked Ask leases. A busy request returns a retry interval instead
  of starting background work. Briefing locks and budgets are not reset or reused.
- Snapshot TTL 90 seconds, answer TTL 5 minutes, failed-attempt cooldown 30 seconds.
  Cache hits skip model-budget reservation but still authenticate and rate-limit.
- Separate server-only model/flags/limits; reuse the current configured Claude
  model only after its tool/output compatibility is verified during implementation.

The 8000-token ceiling is a proposed enforcement requirement, not a claim that
character counts equal tokens. A conservative byte bound can limit user/metadata
text; token accounting must also include system text, schemas and protocol overhead.
Token-count endpoint use, if necessary, must be explicitly approved separately;
no such request is made for this proposal.

Use `getRedisKeyspace` as the authoritative environment selector. New Ask keys
should derive from that environment with their own common Lua hash tag, e.g.
`kicker:dev:{kicker-dev-ask}:v1:` and `kicker:prod:{kicker-prod-ask}:v1:`.
Production's existing briefing/rate-limit legacy prefixes remain unchanged. A new
Ask-only production prefix is not a migration of existing keys. Multi-key scripts
must remain within the Ask hash tag. Shared credentials still permit access to
other keyspaces; logical separation does not isolate availability or billing.

## Failure and cost behavior

No results: return coverage and useful narrower search suggestions; skip the final
model call. Ambiguous question: ask one clarification, without asserting news facts.
Unsupported private/full-text/exhaustive requests: explain the metadata boundary.
Tool or feed failure: distinguish failure from no-results; return a safe retryable
response and do not present stale results as current. On refusal, truncation,
malformed output or invalid citations, fail safely without automatic paid repair.

Tools have no write capability and never execute instructions found in metadata.
Treat questions and article metadata as untrusted data. Never send account email,
saved-article history, credentials or unrestricted logs to Claude. Log only safe
categories, duration, counts, cache outcome and aggregate usage. Review global
Sentry sanitization before shipping this interactive question surface.

Cost is the sum of both calls' input/output tokens at the configured model's rates.
The second call repeats relevant first-call history/tool schemas and includes tool
results; this overhead must be included. Cache hits use no model tokens. Tools
themselves are local reads, but Redis/hosting still have resource costs. Daily model
limits and cumulative reservations bound exposure; Anthropic workspace billing is
the authority for billed usage. No live usage or price estimate is measured here.

## Proposed files and acceptance tests

| Proposed file | Responsibility |
| --- | --- |
| `lib/ai/ask-retrieval.ts` | Pure snapshot filtering, search, stable IDs, coverage and tools |
| `lib/ai/ask.ts` | Input/output schemas, citations, prompts and limits |
| `lib/ai/ask-provider.ts` | Server-only bounded Messages tool/answer protocol |
| `lib/ai/ask-store.ts` | Separate Ask Redis cache, leases and budgets |
| `lib/ai/ask-service.ts` | Fixed workflow and total deadline |
| `app/api/ai/ask/route.ts` | Authentication, CSRF, body validation and error boundary |
| `components/AskKicker.tsx` | Question, answer, coverage, citations and accessible states |
| `components/DashboardView.tsx`, `app/page.tsx` | Small flag-gated integration after backend verification |
| `tests/ask-*.test.mjs`, `tests/fixtures/ask-news.mjs` | Deterministic retrieval, provider, budget, route and UI fixtures |
| `.env.example`, `docs/ASK_KICKER_AI.md`, `docs/AI_DEVELOPMENT.md` | Disabled defaults, operation and AI provenance |

Acceptance: no anonymous/cross-origin tool/model access; unknown tool names,
out-of-snapshot IDs and oversized inputs rejected; exact trusted citations for
answered statements; no results distinguished from feed/tool failure; explicit
coverage limits for weekly questions; maximum two model calls/one tool execution;
cache hits make zero model calls; failed calls consume attempts; concurrent
identical requests generate once; dev/preview/prod do not collide; briefing tests
and existing RSS/auth/newsletter behavior remain intact.

Mocked evaluation should cover relevant/irrelevant/paraphrased/ambiguous queries,
source comparisons, dates, missing summaries, duplicate coverage, unknown IDs,
prompt injection in both questions and tool metadata, tool-name/argument tampering,
tool-call/result ID matching, parallel-call violations, repeated calls, timeouts,
refusals/truncation, malformed citations, per-user cache isolation, lease ownership,
failed budgets, and input/output/iteration caps. Use judged relevant sets for
precision/recall@8 and keep query-by-query failure cases, rather than claiming
keyword matching provides semantic search. Test protocol/limits with mocked model
responses; human metadata-entailment review remains separate from structural tests.
Run desktop/mobile keyboard/loading/error/no-results checks with intercepted calls.

Stages: approve design after briefing rollout; pure retrieval/evaluation fixtures;
provider/store/service/route tests; minimal dashboard UI and mocked browser checks;
disabled deployment; separately approved controlled live evaluation and enablement.

Official API references verified for this proposal:

- https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/parallel-tool-use

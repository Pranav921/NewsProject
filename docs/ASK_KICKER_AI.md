# Ask Kicker AI — internal retrieval and bounded Claude workflow

Stage A implements read-only retrieval; Stage B adds a bounded Claude workflow.
Stage C wraps them in a disabled-by-default authenticated backend route and
Ask-only Redis safeguards. Stage D adds the dashboard panel, shown only when the
same flags are on, and verifies the Stage C Lua against a disposable local Redis and
Sentry privacy through the real SDK. There is no deployed or enabled Ask feature.
No paid Ask request, shared/production Redis operation or live telemetry send has
been performed. Existing authentication, RSS, newsletter and briefing behavior is
preserved. Jump to [Stage D](#stage-d-dashboard-interface-disabled-by-default).

## Architecture and use

`lib/ai/ask.ts` contains types, JSON schemas and runtime argument parsing.
`lib/ai/ask-retrieval.ts` builds an immutable snapshot and binds three pure tools.
`lib/ai/ask-snapshot.ts` is an opt-in `server-only` RSS adapter.

The adapter calls existing `getNewsSnapshot()` once, without forcing refresh. That
function already shares per-feed cache/pending requests, retries failed feeds after
15 seconds and can return last-good metadata for 30 minutes. No second Ask cache or
Redis wrapper is added. Once loaded, all tools use the same frozen snapshot and
make no network requests. Different server workers still have independent caches.
No application route calls this loader yet, and tests inject mocked RSS data.

Pure local use with fixtures or already-fetched `NewsItem[]`:

```ts
const snapshot = createAskSnapshot(articles, new Date(), feedStatus);
const tools = createAskTools(snapshot);
const result = tools.search_articles({
  query: "Nvidia", mode: "publishers", hours: 24, limit: 8,
});
const details = tools.article_details({ articleId: result.articles[0].id });
```

Guard an empty result before accessing its first article in application code.
`loadAskTools()` is the optional server entry point when existing RSS data is not
already available. Loading may fetch fixed configured RSS feeds on a cache miss;
calling a bound tool never fetches a supplied article URL.

## Snapshot and identity

- Keep valid credential-free HTTP(S) links and publication dates in the inclusive
  seven-day window ending at snapshot construction time. Missing/invalid dates,
  future publication times, empty titles or invalid source metadata are omitted.
- Use existing `normalizeArticleLink()` identity rules: remove fragments/trailing
  path slashes; preserve query parameters. IDs are `article_` plus the full SHA-256
  of that canonical link. Updating title/summary does not change the ID.
- Keep original source spelling/case/punctuation, trimming surrounding whitespace.
  Source names over 80 characters or containing controls are rejected, not renamed.
  Existing category helpers supply the general fallback and valid category list.
- Resolve canonical duplicates deterministically and retain the existing specific
  category upgrade. Clone metadata so the original RSS cache is never mutated.
- Retain newest metadata first, capped at 300 articles and 256 KiB of article JSON.
  Titles/summaries are capped at 200/220 characters. Missing summaries remain null.
  Disclose truncation; a burst from one feed can still exclude older relevant news.
- Keep distinct publisher reports in the snapshot. Event deduplication happens at
  retrieval time, according to the requested mode. Article details uses only this
  bounded snapshot, not a historical database or URL fallback.

## Tools and arguments

| Tool | Arguments | Behavior |
| --- | --- | --- |
| `search_articles` | Required `query` (1–160 characters); optional `category`, `sources`, `hours`, `limit`, `mode` | Match every meaningful query token in the title or available summary; rank title matches above summary-only matches, then use modest diversity and recency tie-breaks. |
| `recent_news` | Optional `category`, `sources`, `hours`, `limit` | Recent available event representatives, with soft source/category preferences and no fixed category quotas. |
| `article_details` | Required `articleId` (exact `article_` + 64 lowercase hex characters) | One snapshot metadata record, or `not_found`. Arbitrary URLs and malformed IDs are rejected. |

Defaults: `hours=24`, `limit=8`, search `mode=stories`. Hours must be an integer
1–168, limit an integer 1–8. Category must be an existing application category.
Source filters must contain 1–3 distinct exact source labels from `snapshot.sources`;
unknown labels are errors, not a claim that a publisher has no coverage anywhere.
Empty source arrays and extra arguments are rejected. Errors use sanitized codes
`invalid-arguments`, `invalid-snapshot` or `snapshot-unavailable`, not raw input.

`stories` mode reuses the shared newsletter event deduplicator across publishers.
`publishers` mode applies that same deduplicator within each source, retaining
different publishers' coverage for comparison. Source/category soft penalties are
capped at 0.6/0.3; they do not exclude all reporting from a single available source
or category. Deduplication remains a similarity heuristic, not proof of event identity.

Token matching is case/accent normalized, ignores a small list of question/function
words and matches complete tokens rather than substrings. Tested aliases collapse
AI/artificial intelligence, economy/economic/economics, and chip/chips/semiconductor/
semiconductors. There is no entity resolution, pronoun memory, broad stemming,
fuzzy search or automatic date interpretation. `hours` is a rolling UTC interval,
not calendar "today"; the future caller must choose the appropriate filter.
The search does not establish which stories are objectively the "biggest".

## Results, coverage and untrusted text

All tools return `{ status, articles, coverage, limitations }`. Status is `ok`,
`no_results`, `not_found` or `unavailable`. A valid unknown ID returns `not_found`
without any fetch. Empty snapshots with known feed failures return `unavailable`;
no keyword match is distinct from that failure. A thrown RSS-loader error becomes
`snapshot-unavailable`, with no raw transport/provider details.

Results contain at most eight articles and at most 12 KiB of complete JSON,
including coverage and notices. A byte cap can return fewer articles than requested.
Coverage includes snapshot/requested date windows, article/source counts, available
categories, feed failures/staleness (null if unknown), omitted canonical duplicates,
invalid records, event duplicates, and snapshot/result/byte truncation flags.
Available dates refer to the retained snapshot, not an exhaustive publication range.
`exhaustive` is always false, including when all configured feeds succeeded.

Article strings are data only. Retrieval neither executes instructions nor calls a
model, shell, arbitrary network address, Redis mutation or SQL. Prompt-injection
fixtures are returned as literal metadata when relevant. This proves no execution
path exists here; it does not prove a future model will resist injection. Future
renderers must escape text, and future prompts must keep metadata untrusted.
Source identity and valid links are not factual verification.

## Deterministic evaluation

Run `node --experimental-strip-types --experimental-specifier-resolution=node
--test --test-isolation=none tests/ask-retrieval.test.mjs tests/ask-snapshot.test.mjs`
as one command, or run the complete `npm test` suite.

`tests/fixtures/ask-news.mjs` contains synthetic metadata and AI-authored, inspected
relevance judgments. This is a small regression set, not an independently judged
benchmark or a measurement of real-world search quality. Publisher-mode evaluation
suppresses repeated same-publisher coverage in both the gold and returned sets.

| Query case | Returned / relevant / hits | Precision@8 | Recall@8 |
| --- | --- | --- | --- |
| Nvidia comparison | 2 / 2 / 2 | 0.250 | 1.000 |
| Artificial intelligence alias | 4 / 4 / 4 | 0.500 | 1.000 |
| Economic developments alias | 1 / 1 / 1 | 0.125 | 1.000 |
| Household spending (summary only) | 1 / 1 / 1 | 0.125 | 1.000 |
| Vaccination (no summary) | 1 / 1 / 1 | 0.125 | 1.000 |
| Irrelevant volcanic eruption | 0 / 0 / 0 | 0.000 | N/A |
| Cost of loans (unsupported paraphrase) | 0 / 1 / 0 | 0.000 | 0.000 |
| What did the company unveil (unresolved reference) | 0 / 2 / 0 | 0.000 | 0.000 |

Precision@8 is hits/8, counting unfilled slots against the denominator; recall@8 is
hits/relevant articles. Precision among returned articles is also emitted by the
test (1.0 for these five successful positive cases, undefined for empty results).
The two deliberate failures remain regression expectations documenting limitations;
they are not claimed to be solved. "Cost of loans" does not match "borrowing rates",
and "the company" cannot identify Nvidia without an explicit entity or history.

Verification completed on November 14, 2026:

- `npm test`: **170 passed, zero failures** (157 existing + 13 Stage A tests).
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed, with both briefing AI flags disabled only in the build
  process. Network access was allowed for the site's existing Google Fonts.
- No paid calls, live RSS retrieval test, Redis operations, production writes,
  deployment, Git commit/push or Vercel changes were performed. All new retrieval
  data is synthetic; the RSS adapter boundary is mocked.
- Existing `MODULE_TYPELESS_PACKAGE_JSON` warnings remain nonfatal. No package
  module-mode or dependency changes were made to suppress them.

Existing RSS, authentication, newsletter, rate-limit, Redis keyspace and briefing
runtime files are unchanged. No browser test is added because Stage A has no UI.

## Stage B: bounded tool calling

Claude chooses **which retrieval tool and arguments** fit a standalone question.
The backend decides **what can execute**, runs the existing validated function, and
checks the final answer. This is a fixed workflow, not an iterative agent:

1. `runAskQuestion(question, snapshot, provider, config)` receives one already-loaded
   Stage A snapshot and an explicitly injected provider. It does not fetch feeds.
2. Request one supplies the three custom `tools` with their Stage A `input_schema`.
   `tool_choice: { type: "any", disable_parallel_tool_use: true }` requests one tool.
   The backend independently requires exactly one `tool_use` block, a valid ID,
   an allowlisted name and arguments accepted by the unchanged Stage A parsers.
3. Execute exactly one read-only function using explicit switch dispatch. Unknown
   tools, invalid arguments and malformed provider messages fail without repair.
   No results/unknown article IDs return local `no_results`, skipping request two.
   Known feed unavailability fails as `tool-unavailable`, not an empty success.
4. For nonempty results, request two preserves the **complete assistant content**
   in order (including thinking signatures/redacted blocks), immediately followed
   by a user `tool_result` whose `tool_use_id` matches the selected call. Thinking
   is never returned or logged. `tool_choice: { type: "none" }` disables more tools;
   any unexpected final tool call is rejected even if the provider emits one.
5. Request two uses `output_config.format` JSON Schema. Local validation enforces
   all original constraints and checks references against the **exact selected
   tool result**, not the full snapshot. Citations' title/source/URL come only from
   those backend records. No model-supplied citation metadata is accepted.

Successful retrieval normally costs two model requests. Empty retrieval costs one.
Even an ambiguous/unsupported question first takes one retrieval decision in this
milestone; the final response may abstain. There is no third request, retry, repair,
query refinement, conversation memory, parallel tool execution or background work.
Stage B was initially internal-only. Stage C calls it from the separately
disabled authenticated route described below; Stage D's dashboard panel calls that route.

### Modules and injection

- `lib/ai/ask-answer.ts`: final schema, local validation, prompts, limits, config
  defaults and safe error codes. Prompt version is `ask-b1`.
- `lib/ai/ask-service.ts`: `server-only` two-request orchestration, tool dispatch,
  total deadline, byte/token checks and aggregate usage. No environment access.
- `lib/ai/ask-provider.ts`: `server-only` official SDK adapter, fixed Anthropic
  Messages URL, no SDK retries, logging or OpenTelemetry, no redirects, bounded
  response reading and sanitized transport errors. Accepts a credential explicitly.
  A future server caller may supply `ANTHROPIC_API_KEY`; no browser receives it.

Server-only composition (illustrative, **not wired to an application entry point**):

```ts
const { snapshot } = await loadAskTools();
const provider = createAskProvider(serverApiKey); // never log this argument
const result = await runAskQuestion(question, snapshot, provider, config);
```

Tests instead inject an async function returning fixture Messages, or instantiate
the real official SDK with a fake fetch. No environment credentials or paid calls
are needed. Stage C uses the guarded backend wrapper below; do not bypass it with
this illustrative composition in a route or Server Action.

### Output contract and boundaries

Model JSON has exactly `status`, `statements` and `clarification`. Status is
`answered`, `no_results`, `needs_clarification` or `unsupported`. An answered result
has one to five statements, each containing `text` (up to 400 characters) and one
to three distinct `articleIds`. Non-answer statuses have no statements; only
`needs_clarification` accepts a non-null question (up to 200 characters). Plain text
validation rejects control characters, HTML brackets and common link syntax.
It is not a general content sanitizer; future rendering must escape all text.

Backend output replaces `articleIds` with `citations: [{articleId,title,url,source}]`
on each statement and adds trusted `coverage`, `limitations` and a metadata-only
AI disclaimer. It also returns `modelRequests`, `toolExecutions`, `promptVersion`
and aggregate `usage` with separate input/output/cache-read/cache-creation counts.
It never returns prompts, provider envelopes or thinking. Errors carry only
allowlisted codes, without raw causes. Nothing is logged by these modules.

| Boundary | Implemented limit |
| --- | --- |
| Question | 500 characters, 2,000 UTF-8 bytes, no controls |
| Snapshot/tool result | Unchanged Stage A: 300 articles/256 KiB; 8 results/12 KiB |
| Complete serialized request | 48,000 UTF-8 bytes per call, including schemas and replayed history |
| Provider response | 65,536 bytes, including HTTP error bodies; reader cancelled on abort/oversize |
| Model calls/tool executions | At most two/one; zero automatic retries |
| Selection/answer output tokens | Defaults 384/1,200; configurable ranges 128–1,024 / 128–3,072 |
| Workflow deadline | Default 30 seconds, configurable up to 60 seconds, both calls share one abort signal |

Config explicitly sets `model`, `timeoutMs`, `selectionTokens`, `answerTokens`.
Default model is `claude-haiku-5-5`; the official model/tool/structured-output docs
were checked for compatibility. Ordinary custom-tool schemas use unchanged Stage A
constraints plus authoritative runtime parsing. We do not rely on `strict: true`
for tool execution. Final structured output uses the existing official SDK schema
transformer for unsupported length/array constraints, and local validation still
enforces every original limit. Forced tool use on Haiku skips thinking, but history
preservation also handles thinking/redacted blocks defensively.

The max possible requested output is the sum of the two configured token budgets
(default 1,584). Reported per-call output above its allowance is rejected. Input
is byte-bounded, **not an exact preflight token count or monetary quota**. Aggregate
usage reports separate prompt-cache tokens rather than hiding them in input counts.
The Stage B deadline begins after the snapshot is loaded. Stage C adds the whole
HTTP-request deadline, cache and reservations around this unchanged two-call design.
Failed requests may already incur provider charges; there is no free repair attempt.

### Mocked verification and limitations

`tests/ask-workflow.test.mjs` checks protocol/history/ID matching, all three real
retrieval functions, exact-result citations, non-answer shapes, unknown tools,
bad arguments, final tool rejection, refusal/truncation, missing/malformed fields,
request/result/response/token bounds, cumulative history size and shared deadlines.
`tests/ask-provider.test.mjs` exercises the real SDK against fake HTTP responses,
authentication/rate-limit/server/connection errors, response caps and stalled streams.
The full workflow is also tested through the SDK with fake HTTP on both calls.

Prompt-injection fixtures remain literal tool data and cannot widen backend
capabilities or reference sets. These tests do **not** establish that a real model
will resist injection or that cited sentences are entailed by metadata. Free-text
clarifications can still contain unsuitable prose. Human metadata-entailment and
ambiguity review remains necessary before launch; valid links alone prove neither
factuality nor retrieval quality. Stage A keyword recall limitations remain.

Stage B verification completed locally on November 14, 2026:

- `npm test`: **191 passed, zero failures** (170 baseline + 21 Stage B tests).
- `npm run lint`: passed.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed; AI briefing flags were false only in the build process.
  The existing Google Fonts fetch was allowed. The route list has no Ask endpoint.
- No paid model requests, live Redis tests/writes, email, public route/UI, dependency
  changes, Git commit/push, deployment or production configuration changes.
- Existing nonfatal `MODULE_TYPELESS_PACKAGE_JSON` test warnings remain unchanged.

Official references checked for this implementation:

- [Tool schemas and forced/disabled tool choice](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
- [Assistant/tool-result protocol](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
- [Structured outputs and schema transformation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Haiku 5.5 compatibility](https://platform.claude.com/docs/en/models/haiku-5-5/overview)

## Stage C: secure backend (disabled by default)

`POST /api/ai/ask` accepts only `{ "question": "..." }`. It is a new JSON contract;
the briefing endpoint remains bodyless. Questions, tool arguments, sources, URLs,
models and user IDs cannot be supplied as separate fields. Article IDs appearing
in a question are still checked by Stage A against the current snapshot.

The backend owns sessions, origin checks, limits, retrieval, citations and caching.
Claude only chooses one read-only retrieval and writes a candidate answer. It
cannot authorize a tool, change a quota, select a different user or execute writes.

### Request lifecycle

1. Require the shared AI switch (`isAiEnabled` in `lib/ai/feature-flag.ts`):
   `AI_BRIEFING_ENABLED=true`, and in any production-mode process (Vercel
   Production/Preview, local `next start`) also `AI_BRIEFING_PRODUCTION_VERIFIED=true`.
   This is checked on every request before any other work. (Before the production
   release, Ask had separate `AI_ASK_*` flags; see "Production release" below.)
2. Require exact configured `APP_BASE_URL` origin (fallback
   `NEXT_PUBLIC_APP_BASE_URL`), reject `Sec-Fetch-Site: cross-site` and all query
   parameters. No wildcard origins or origin inferred from client Host headers.
3. Require JSON content type (optional UTF-8 charset), stream at most 2,048 bytes,
   parse one exact question field and enforce Stage B's 500-character/2,000-byte
   question limit. Empty streams, invalid UTF-8/JSON, controls and extra fields
   fail closed. Body bytes are counted even when Content-Length says zero.
4. Verify the session with Supabase `auth.getUser()`; only its user ID is used.
   Redis, RSS and the provider are not reached for anonymous callers. Read valid
   server configuration and require the existing server-only Anthropic key.
5. Atomically admit the request in Redis, checking user/IP/global request limits
   and acquiring an owned user/global lease. Load the bounded Stage A snapshot
   once through the existing RSS cache, without forcing a refresh.
6. Look up the user's private answer cache. A valid hit uses zero model calls and
   zero generation reservations; admitted cache hits still count as requests.
7. On a miss, atomically reserve both possible model attempts and their token
   allowances before starting either. Immediately before each SDK invocation,
   atomically convert one reservation into a charged attempt. A storage failure
   stops the model call, with no fail-open local bypass.
8. Run Stage B (at most two model calls, exactly one executed retrieval on a valid
   tool response). Validate and publish only successful structured results, including
   legitimate `no_results`, `needs_clarification` and `unsupported` statuses.
9. Release unused call reservations and only the owned lease. Invalid citations,
   malformed output and provider errors are never cached as successful answers.

Every response uses `Cache-Control: private, no-store` and `Vary: Cookie, Origin`.
Success returns `{answer, generatedAt, expiresAt, cacheHit, modelRequests,
toolExecutions, usage}`. The answer retains coverage/limitations/disclaimer. Tool
arguments and the original question are not returned. Cache hits have null usage
and zero request/tool counts; timestamps remain those of the cached answer.

HTTP failures: 400 invalid request, 401 no session, 403 invalid origin, 413 oversized
body, 415 unsupported content type, 429 request/generation budget, 409 busy/lost
lease, 503 disabled/storage/provider/unavailable, 504 request deadline. Retryable
failures include `Retry-After` where applicable. Unexpected errors become a generic
safe category, never a raw exception body. Stage B may collapse a lost lease during
provider dispatch into a safe generic provider error; it still makes no model call.

### Limits and reservation semantics

| Control | Default / behavior |
| --- | --- |
| User requests | 3 per rolling 60 seconds; 10 per UTC day |
| IP requests | 5 per rolling 60 seconds; IP stored only as a SHA-256 key component |
| Global generations | 20 cache-miss (generation) requests per UTC day, counted at reservation; cache hits never count (changed in the live-evaluation review below) |
| Model attempts | 40 per UTC day, inclusive of outstanding reservations |
| Token accounting | 2,700,000 conservative token units per UTC day, inclusive of reservations |
| In flight | One per user, two globally; owned 45-second leases |
| Deadline | 30 seconds from route entry; work stops by 28.5s, leaving up to 1.5s for cleanup |
| Cache | 300 seconds; configurable 30–600 seconds; record cap 16 KiB |

Redis TIME owns sliding-window and UTC-day decisions. Admission and each budget
transition are single Lua operations, so concurrent workers cannot independently
claim the same capacity. Busy requests do not increment admission counters.
Admitted requests count toward the per-user and per-IP abuse limits even if RSS,
provider or validation fails, and cache hits count too. Only cache misses that reach
reservation count toward the global generation cap. Authentication work occurs
before these Ask limits; existing auth-endpoint rate limits remain unchanged.

Each call reserves **65,536 input-token accounting units plus its configured
max output tokens**. Default two-call reservation: 132,656 units. The input
allowance is deliberately conservative relative to the 48,000-byte request cap;
it is not an exact tokenizer measurement or a provider-enforced input cap. Returned
usage includes ordinary plus cache-read/cache-creation input tokens; above-allowance
reports are rejected, although that attempt may already have been billed. Provider
internal schema/tool overhead is not calculated exactly. Keep an Anthropic workspace
spend limit/alert as the final monetary boundary when approving live use.

Started calls retain their full reserved allowance, even if actual tokens are lower
or the provider fails. Only calls never started are refunded. This intentionally
underuses capacity instead of risking overspend. No automatic retries/repairs occur.
Redis accounting completes before SDK transport; ambiguous/lost Redis responses
can charge an attempt that never reached Claude, rather than create a free attempt.

If cleanup cannot reach Redis, leases expire automatically after 45 seconds.
Unused budget reservations are conservatively held until UTC rollover, not silently
refunded after a crash. Reservation records expire after 48 hours. Old-day requests
cannot start new model calls after midnight; cleanup cannot subtract a new day's
reservations. All cleanup/publish operations check ownership; stale owners cannot
delete replacement user leases or publish late answers. There is no lease renewal.

The shared RSS loader has existing fixed-feed requests that may finish after an
Ask timeout because other requests share their cache. The timed-out Ask flow cannot
start another model call or cache publication. Already-dispatched remote model or
Redis operations may still complete: abort cannot undo a provider invocation or an
atomic Redis script. Such attempts remain charged and publication still requires
an owned lease. No background AI generation or continuation loop exists.

### Private caching and Redis keys

The cache identity hashes authenticated user identity, whitespace-normalized NFC
question, model, prompt version, output-token settings and a deterministic article/
source/feed-status/truncation fingerprint. It excludes the loader's advancing
`asOf` timestamp so identical metadata can actually hit the five-minute cache.
This permits up to TTL-old reporting/time-window decisions, clearly dated by the
original coverage and generation timestamps; the answer is not relabelled current.

Records contain validated answer text/IDs, timestamps and the exact backend tool
evidence. They do not contain the raw question, tool arguments or provider envelope.
The record is also bound to the expected hashed cache identity, so a record
returned under another user's key fails validation.
Cache data is private application data, not encrypted storage. On a cache hit,
validate evidence against Stage A's result schema, match its article records against
the current fingerprinted snapshot, then rerun answer/citation validation. Resolve
all citation display fields from current trusted records, never cached model URLs.
This validation executes **no additional retrieval tool**, including when publishing
a new cache record. Invalid records become guarded cache misses; no unrelated keys
are deleted. A hash is an identity mechanism, not encryption of low-entropy questions.

Authoritative `getRedisKeyspace()` adds only these new Ask prefixes:

- Development: `kicker:dev:{kicker-dev-ask}:v1:`
- Preview: `kicker:preview:{kicker-preview-ask}:v1:`
- Production: `kicker:prod:{kicker-prod-ask}:v1:`

Suffixes are `lease:<userHash>`, `minute:<userHash>`, `ip:<ipHash>`,
`user-day:<userHash>`, `generation-day`, `active`, `model-day`,
`reservation:<ownerHash>` and `cache:<identityHash>`. All Lua KEYS share their
environment's Ask hash tag. No briefing/rate-limit prefix changed; no production
legacy migration or data deletion is needed. Preview deployments share their one
preview keyspace. Shared database credentials still grant access to **all** keys;
this is logical separation, not credential, availability or billing isolation.

### Configuration and troubleshooting

Ask needs no variables of its own. It follows the shared AI switch, reuses
`ANTHROPIC_API_KEY`, `AI_BRIEFING_MODEL` (and `AI_BRIEFING_PROVIDER`, which must be
`anthropic` if set), the Upstash credentials, Supabase settings and the app origin.
The model must be in `ASK_COMPATIBLE_MODELS` (currently `claude-haiku-5-5`, which
accepts Ask's forced tool call); otherwise authenticated requests fail closed with
`unsupported-model` (503) before Redis or the provider are touched. Optional,
bounded tuning overrides (`AI_ASK_CACHE_SECONDS`, `AI_ASK_SELECTION_TOKENS`,
`AI_ASK_ANSWER_TOKENS`, `AI_ASK_DAILY_MODEL_ATTEMPTS`, `AI_ASK_DAILY_RESERVED_TOKENS`)
are not needed; attempts can only be lowered (max 40). Request quotas, input
allowance, lease duration and whole deadline are code constants. Local Redis still
requires `REDIS_KEYSPACE=dev`; never copy that to Production.
Run `npm test` for mocked verification; no credential is required for those tests.
Enabling the route with real credentials can incur charges—no manual live request
is part of this milestone. Later controlled testing requires separate approval.

Use `[ai][ask]` logs for status, duration, cache outcome, model/tool/statement counts
and aggregate usage. `[ai][ask][error]` contains only a category and duration.
No questions, identities, IPs, article text, arguments, credentials, prompts, model
responses or raw errors are logged. For 503 check flag/configuration names and
environment scopes without printing values; then the safe error category. For 429,
honor Retry-After; do not reset daily keys. For 409 retry after the short busy delay.
After a process crash, allow leases to expire; conservatively held daily reservations
are an intentional availability tradeoff, not grounds to delete production keys.

### Telemetry privacy

The previously unregistered `lib/sentry.ts` sanitizer is now registered in server,
edge and browser initialization. A strict outgoing-event allowlist retains SDK
event/release/environment/timing/correlation metadata, dropping request bodies,
headers/cookies/URLs, users, extras, arbitrary contexts, messages, exception details,
breadcrumbs and child-span payloads. Standalone spans retain only IDs/timing/status.
Attachment hints are cleared. SDK logs and browser replay are disabled; application
Ask metrics remain in the explicit safe logger above. This intentionally reduces
general Sentry diagnostic detail/grouping to avoid sending arbitrary private text.

Mocked tests verify hook registration and sentinel removal. Actual deployed Sentry
envelopes and Vercel platform logging have not been inspected here; third-party
platform policy/retention and future integrations still require review before
enabling an interactive question surface. Do not claim universal telemetry safety
from mocked hooks alone.

### Stage C verification and remaining limitations

New tests cover route authentication/origins/body streams/flags, private cache
revalidation, all answer statuses, failure charging, unused refunds, request/daily
quotas, concurrency/lease ownership/expiration, UTC rollover, deadlines, malformed
citations, unavailable storage, namespace/hash-tag construction and telemetry hooks.
The in-memory storage double models atomic policy but does **not** execute Lua.
Redis adapter tests inspect real script/key/argument wiring with mocked responses.
Actual Ask Lua execution on Upstash remains an approval-gated rollout check.

Final local verification: **224 tests passed, zero failed** (191 baseline + 33
Stage C regressions); ESLint, `npx tsc --noEmit` and the production build passed.
The build process had both briefing/Ask flags false; private environment files and
deployment settings were not edited. The build lists `/api/ai/ask` as a dynamic
route. Existing nonfatal Node module-mode warnings remain. A credential-pattern
scan of all 34 changed/untracked files found no matches, `.env.local` is ignored
and untracked, and the Git index is empty. Pattern scanning is not a comprehensive
secret audit. No cloud Redis/provider/telemetry behavior was verified live.

No new infrastructure, database tables, vector search, dependency, UI, agent loop,
paid API request, live Redis write, deployment, commit/push or production config
change was introduced. Citation integrity still does not prove sentence entailment;
keyword recall and metadata-only coverage limitations from Stages A/B remain.

### Stage C file manifest

Created:

- `app/api/ai/ask/route.ts`
- `lib/ai/ask-settings.ts`, `lib/ai/ask-store.ts`, `lib/ai/ask-backend.ts`
- `tests/ask-backend.test.mjs`, `tests/ask-route.test.mjs`, `tests/ask-store.test.mjs`
- `tests/sentry-privacy.test.mjs`, `tests/helpers/ask-backend-fixture.mjs`

Modified:

- `lib/ai/ask-service.ts` (return internal exact evidence; same model/tool protocol)
- `lib/ai/ask-provider.ts` (bound empty response chunks as well as response bytes)
- `tests/ask-provider.test.mjs` (empty-chunk regression)
- `lib/redis-keyspace.ts` (additional Ask prefix only)
- `lib/sentry.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`,
  `instrumentation-client.ts` (registered shared privacy boundary)
- `app/api/ai/briefing/route.ts` (comment updated; no behavior change)
- `.env.example`, `README.md`, `PROJECT_OVERVIEW.md`, `docs/AI_DEVELOPMENT.md`,
  `docs/ASK_KICKER_AI.md`, `docs/ASK_KICKER_AI_PLAN.md`,
  `docs/REDIS_KEYSPACES.md`, `docs/FOLLOW_UP_ISSUES.md`

Earlier uncommitted Stage A/B files are preserved. No files were staged.

## Stage D: dashboard interface (disabled by default)

Stage D adds the reader-facing panel and closes two Stage C verification gaps with
local evidence: real Lua execution on Redis, and Sentry privacy through the real SDK
pipeline. No backend file (route, store, backend, service, provider, retrieval) was
changed. Both Ask flags stay false everywhere; no paid call or deployment occurred.

### What the reader sees

An **Ask Kicker AI** card sits directly below the AI Briefing card and above the
feed. It reuses the briefing's card, eyebrow, heading and citation styles: navy
heading and primary button, magenta accents and focus rings, warm-paper surfaces.

- Idle: eyebrow, heading, one-paragraph description (answers use headlines and short
  summaries from available news article metadata; no full articles), a question
  input with an **Ask** button, a hint line and four example questions. Selecting an
  example fills and focuses the input; it never submits.
- Loading: "You asked" echo, a short progress message (up to 30 seconds), a skeleton
  and an **Asking…** button. The skeleton/spinner stop under reduced motion.
- Answered: a status pill, generated time, **Fresh answer** or **Saved answer (no new
  AI request)**, the question, then up to five numbered statements. Each statement
  has one to three citation cards (publisher, article title, new-tab icon). A
  coverage panel and the backend disclaimer follow.
- No results: keyword-search tips plus the coverage panel, so the reader sees what
  was searched. Needs clarification: the single clarifying question and an **Edit your
  question** button that focuses and selects the input. Unsupported: what Ask Kicker
  can and cannot do. **New question** clears the panel and refocuses the input.

### How the UI calls the protected API

`components/AskKicker.tsx` is a client component. `lib/ai/ask-ui.ts` holds pure,
browser-safe helpers and imports the backend `AskAnswer` type only, so prompts,
tool definitions, Lua and credentials cannot enter the client bundle (verified by a
static test and by scanning the built `.next/static/chunks`).

1. `app/page.tsx` computes the shared switch once, on the authenticated path only, and
   passes it to both the briefing and Ask panels. Anonymous visitors never receive the
   panel. Hiding it is cosmetic; the route enforces the switch and the session on
   every request.
2. Input is normalized like the route (controls/newlines become spaces, lone
   surrogates become U+FFFD, NFC, trimmed, 500-character limit), so obviously
   invalid input costs no request. The server stays authoritative.
3. `fetch("/api/ai/ask", { method: "POST", credentials: "same-origin", cache:
   "no-store" })` sends `Content-Type: application/json` and the body
   `{"question": "..."}`, nothing else. The browser adds `Origin` and
   `Sec-Fetch-Site`, which the route checks against `APP_BASE_URL`. Identity comes
   only from the Supabase session cookie. No user ID, tool, article ID, source, model
   or URL is sent, and the route rejects such fields anyway.
4. The client gives up after 40 seconds (30-second server ceiling plus network
   slack). Unmounting aborts the request; nothing continues in the background.
5. Responses pass `parseAskResponse()`, a defense-in-depth shape check. An unknown
   shape shows an error instead of partially rendering.

Duplicate submissions are blocked in three ways. A synchronous in-flight ref (not
just React state) stops double clicks and repeated Enter presses before re-render.
The submit button is `aria-disabled` while loading or empty; it is not `disabled`,
so keyboard focus is not lost. An identical, still-unexpired question re-shows the
answer from component memory without a request. The server would return the same
private cache entry, but every admitted request, cache hit included, counts toward
the 3/minute and 10/day limits.

### How citations are displayed

The model returns only article IDs. The backend checks each ID against the exact
tool result and copies `source`, `title` and `url` from trusted snapshot records.
The UI then:

- renders every string as React text (escaped). There is no `dangerouslySetInnerHTML`;
- links only `http:`/`https:` URLs via `safeCitationUrl()`. Anything else becomes a
  plain, non-clickable card;
- opens publishers in a new tab with `rel="noopener noreferrer"` and a screen-reader
  "(opens in a new tab)" suffix;
- labels each list "Sources for statement N". Cards are at least 44 px tall and
  clamp long titles to two lines (the full title stays in the DOM and tooltip).

The browser suite injects hostile statement/title markup and a `javascript:` URL
directly (bypassing backend validation): nothing executes and that card is not linked.

### Coverage and incomplete-RSS disclosure

The coverage panel is derived from the structured `coverage` object, not the
model-facing `limitations` strings. It shows the searched time window (for example
"Past 24 hours"), articles available, sources and matching articles. It also shows
the publication range of available articles and when feeds were checked, as
`<time>` elements. Warnings appear for failed feeds, stale cached feeds, snapshot
truncation and results beyond what was reviewed. A permanent note says RSS coverage
is incomplete: only recent headlines and short summaries, not every article or full
text. Clarification/unsupported answers omit the panel because no evidence was used.

### How errors and rate limits are handled

Raw error codes are never shown. Each failure has a title, plain-language message
and retry policy (`describeAskFailure()`, unit-tested for every route outcome).

| Route response | UI state | Behavior |
| --- | --- | --- |
| 429 `request-limit`, `Retry-After` < 1 h | You're asking quickly | Submit and Try again show a live countdown and are blocked for waits ≤ 120 s; a polite announcement says when asking is possible again |
| 429 `request-limit`, ≥ 1 h | Daily question limit reached | Shows the local reset time; no countdown or retry button |
| 429 `generation-budget` | Today's AI capacity is used up | Shows reset time; notes a recently asked question may still show its saved answer |
| 409 `busy` / `lease-expired` | Ask Kicker is busy / interrupted | Short countdown, then Try again resends the same question |
| 504, `deadline`, client timeout | Ask Kicker took too long | Try again |
| 503 `tool-unavailable` | News feeds are unavailable | Try again |
| 503 citation/validation codes | No verified answer this time | Try again; nothing unverified is shown |
| 503 `provider-*` | AI service unavailable | Try again; feed below unaffected |
| 503 disabled/storage/other, non-JSON, malformed 200 | Ask Kicker is unavailable | Try again |
| 401 | Your session has expired | No retry; sign in again |
| 403 | Request blocked | Refresh the page |
| 400 / 413 / 415 | We couldn't read that question | Edit your question |
| Network failure | Connection problem | Try again |

Errors use `role="alert"`; loading, results, saved-answer reuse and countdown end are
announced in one persistent polite live region. Focus is never moved unexpectedly.

### Accessibility and privacy

Labelled form landmark, a visually hidden input label, `aria-describedby` for the
description and hint, `aria-invalid` on validation, `aria-busy` while loading, and
a logical Tab order: input, Ask, examples, New question, citations. Targets are at
least 44 px (examples 40 px), with reduced-motion support, at 320 to 1440 px wide.
Questions never go into URLs, browser storage, the console or analytics; they live
only in component memory. Sentry replay and breadcrumbs remain disabled (Stage C).

Design note: `app/globals.css` applies an unlayered `font: inherit` to form
controls, which overrides Tailwind v4's layered font utilities on every button and
input in the app. Ask Kicker sets button typography on inner spans and keeps the
input at the inherited 16 px, which also prevents iOS focus zoom. The global rule
is unchanged (see `docs/FOLLOW_UP_ISSUES.md`, KN-UI-005).

### Infrastructure verification

**Redis Lua, real execution.** `scripts/verify-ask-redis-local.mjs` loads the real
Stage C store and runs the real Lua through the real `@upstash/redis` 1.37 client
against a disposable `redis:7.2-alpine` container behind `hiett/serverless-redis-http`
(Upstash's local REST shim). It refuses non-loopback URLs and non-empty databases,
builds its environment explicitly (never `.env*`), forces `REDIS_KEYSPACE=dev`,
deletes only its own keys and asserts the database is empty at the end. Result:
**18/18 passed**:

- owned 45 s leases; same-user busy without counting; global two-in-flight cap;
- 3/min user and 5/min IP windows; 10/day user and 20/day global limits keyed by
  Redis UTC day, with `Retry-After` equal to seconds until UTC midnight;
- reservations need the owned lease, reserve exactly 2 attempts plus 132,656 units
  once, and include outstanding reservations in both budgets;
- `start` charges at most two attempts; `finish` refunds only never-started calls;
- expired leases cannot reserve, start or publish; a stale owner cannot delete a
  replacement lease or publish a cache record;
- UTC rollover: old-day reservations cannot start or subtract new-day counters;
- parallel races: 12 same-user admissions → 1 winner; 6 users → 2; two reservations
  at the attempt edge → 1; 5 concurrent starts → 2;
- cache values round-trip through Upstash automatic deserialization as objects (the
  cache-hit path depends on this) with the configured TTL;
- every written key is inside `kicker:dev:{kicker-dev-ask}:v1:` and expires;
- full `getAskAnswer()` on real Redis with a mocked provider: miss charges two calls
  and caches; repeat is a zero-call hit that still counts as a request; a failed
  first call stays charged with the unused call refunded; concurrent identical
  requests generate once and the other is busy.

No store defect was found. Limitations: Upstash's managed server is not OSS Redis,
so its script limits/latency and the shim's fidelity are not proven; day boundaries
were simulated by seeding counters; `getClientIp()` behavior behind Vercel's proxy
is unverified. Re-run:

```bash
docker network create kicker-ask-test
docker run -d --rm --name kicker-ask-redis --network kicker-ask-test redis:7.2-alpine redis-server --save "" --appendonly no
docker run -d --rm --name kicker-ask-srh --network kicker-ask-test -p 127.0.0.1:8079:80 \
  -e SRH_MODE=env -e SRH_TOKEN=local_disposable_token \
  -e SRH_CONNECTION_STRING=redis://kicker-ask-redis:6379 hiett/serverless-redis-http:latest
ASK_LOCAL_REDIS_TOKEN=local_disposable_token node --experimental-strip-types scripts/verify-ask-redis-local.mjs
docker stop kicker-ask-srh kicker-ask-redis && docker network rm kicker-ask-test
```

**Sentry, real SDK pipeline.** `scripts/verify-sentry-privacy-local.mjs` initializes
the real `@sentry/nextjs` 10.51 Node SDK with the app's `sentryPrivacyOptions`, an
in-memory transport and a `.invalid` DSN (no network). It plants one sentinel
string in the user, tags, extras, contexts, breadcrumbs, request metadata (URL, query,
cookies, auth headers, body), an attachment, an exception, a message, a raw event,
span names/attributes and the logger. The four resulting envelopes (three errors and
one transaction) contain no sentinel and no attachment, log or replay items. Envelope
headers carry no dynamic sampling context because the allowlist drops it. `npm test`
runs this script in a child process, so SDK upgrades are covered. Limitations: only
the Node runtime is exercised end to end (edge/browser share the hooks, verified by
config tests); deployed envelopes and Vercel logs are not inspected.

### Browser verification

`node scripts/validate-ask-kicker-ui.mjs` starts `next dev` with both AI flags forced
false, renders the real `AiNewsBriefing` and `AskKicker` in dashboard order and drives
headless Chrome over the DevTools Protocol (the repository's existing browser
tooling; no Playwright dependency). Every `/api/ai/*` request is paused at the
network layer and fulfilled by the script, so the component's real `fetch`, headers
and parsing run but nothing reaches the server. Answer fixtures come from the real
Stage A tools and Stage B `validateAskAnswer()`. Verified:

- heading, metadata description, accessible label/description, examples, empty guard;
- Enter submits; the POST body is exactly `{"question": ...}`; loading, `aria-busy`
  and disabled states; reduced-motion spinner; repeated Enter/clicks send one request;
- answered rendering, citation attributes, a real mouse click opening the publisher
  in a new tab, generated time, fresh/saved labels, coverage dates and warnings;
- local reuse without a request; no-results, clarification (edit focus/selection),
  unsupported; hostile text inert;
- 429 countdown blocking and re-enable announcement, daily limit, AI budget, busy
  with working retry, provider, feeds, citation failure, deadline, 401, 403, 400,
  disabled 503, offline, HTML 502 and malformed 200, with no raw codes shown;
- full keyboard path; layouts at 320/375/390/768/1024/1440 px with no horizontal
  overflow and target sizes; screenshots in `.next/ask-review-*.png` (ignored);
- the AI Briefing opens and loads alongside Ask Kicker, and neither triggers the
  other's request; no console errors; 28 Ask and 1 briefing requests intercepted, 0
  reached the dev server.

The existing `node scripts/validate-ai-briefing-ui.mjs` also still passes unchanged.

### Stage D verification results (November 14, 2026)

- `npm test`: **232 passed, 0 failed** (224 baseline + 7 UI helper/contract tests + 1
  real-SDK Sentry test). The UI tests include a contract check that the real backend's
  route payload for all four statuses passes the browser validator.
- `npm run lint` and `npx tsc --noEmit`: passed.
- `npm run build`: passed with both AI flags false in the build process; the built
  client chunks contain the panel but no prompt, tool name, Lua, credential name,
  `input_schema` or keyspace text.
- Real-Redis harness 18/18; real-SDK Sentry check passed; both browser validators passed.
- No Anthropic request, Upstash access, `.env*` read or edit, Vercel change,
  deployment, commit or push. A credential-pattern scan of Stage D files found nothing.

### Stage D file manifest

Created: `components/AskKicker.tsx`, `lib/ai/ask-ui.ts`, `tests/ask-ui.test.mjs`,
`scripts/validate-ask-kicker-ui.mjs`, `scripts/verify-ask-redis-local.mjs`,
`scripts/verify-sentry-privacy-local.mjs`.

Modified: `components/DashboardView.tsx`, `app/page.tsx` (flag-gated panel),
`tests/sentry-privacy.test.mjs` (real-SDK check), `.env.example` (comment),
`README.md`, `PROJECT_OVERVIEW.md`, this guide, `docs/ASK_KICKER_AI_PLAN.md`,
`docs/AI_DEVELOPMENT.md`, `docs/FOLLOW_UP_ISSUES.md`. Earlier Stage A–C work is untouched.

## Live-evaluation readiness review (November 14, 2026)

A review of the complete Ask implementation before the first real-model evaluation.
No paid call, shared-Redis write, live Sentry event, Vercel change or deployment.

### Findings

| Area | Result |
| --- | --- |
| Authentication | `auth.getUser()` server validation; only the user ID is used; anonymous requests never reach Redis, RSS or the provider. No change. |
| Origin/CSRF | Exact `APP_BASE_URL` origin, cross-site fetches rejected, query strings refused. No change. Local testing must use the exact configured origin. |
| Model–tool protocol | Haiku 5.5 runs adaptive thinking by default; Anthropic's migration guide confirms it **accepts forced `tool_choice` with thinking on** and then returns the tool call with no thinking block, so call 1 is compatible. No sampling parameters or prefill are sent. **Watch item:** call 2's low-effort thinking is billed as output and counts toward its 1,200-token limit; the evaluation records stop reasons to catch `max_tokens` truncation. |
| Cache isolation | The key and record are bound to the hashed user; records are revalidated on read; a crossed record is rejected (tested). No change. **Effectiveness:** the key includes the full RSS fingerprint, feeds refresh every 90 s and Vercel instances have separate feed caches, so real hit rates will sit well below the 300 s TTL. Measure before changing. |
| Quotas | Cache hits consumed the global 20/day cap. **Changed** (below). |
| Leases | **Defect fixed:** a client disconnect (closed tab, navigation abort) skipped cleanup. Details below. |
| Prompt injection | The system prompt treats metadata as untrusted, tools are read-only, citations resolve only to retrieved records, and answer text cannot contain URLs or HTML. Injected text can still steer the *wording* of an answer, so the evaluation set includes an injection article that matches a real query. |
| Source validation | Source filters must belong to the snapshot; citation title/URL/source come from backend records. No change. |
| Logging | `[ai][ask]` logs status, duration, counts and token totals only; errors log a category. No change. |
| Telemetry | Verified locally through the real Node SDK; see "Unverified telemetry" below. |

### Fix: client disconnects skipped cleanup

The route built `wholeSignal` from `request.signal` plus 30 s, and cleanup ran under
that signal. A closed tab, or the dashboard aborting its fetch on unmount, aborted
the signal, so `finish` never ran. The lease stayed for 45 s and the never-started
reservation (up to 2 attempts and 132,656 token units) was held until UTC midnight.
The Redis client used the same signal, so a started cleanup would also have been cut
off. This failed closed (no overspend) but drained the conservative daily budget.

Now `getAskAnswer` takes `workSignal` (includes the disconnect; stops new work) and
`cleanupSignal` (time-only, 30 s from route entry), which bounds lease release, refunds
and publishing an already-paid answer. The route creates the store with
`cleanupSignal`. Late in-flight work cannot leak: `finish` deletes the lease
atomically, and reserve/start refuse without the owned lease. Regression coverage
exists in the in-memory suite and in the real-Redis harness (21/21).

### Change: cache hits no longer consume global capacity

Before: one admission script ran before the cache lookup and counted every request
against user 3/min, IP 5/min, user 10/day **and a global 20/day**. Two active readers
could lock everyone out until UTC midnight, even for answers costing nothing.

Now the two kinds of limits are separate:

- **Abuse limits** (admission, every request, cache hits included): leases, user
  3/min, IP 5/min, user 10/day. A cache hit still loads RSS and touches Redis.
- **Paid generation budgets** (reservation, cache misses only): the global cap of
  **20 generation requests per UTC day** (same number, new `generation-day` key),
  40 attempts and 2.7M token units. All three are checked and incremented together
  in one Lua script, or none are.

A generation request counts when its reservation succeeds and is never refunded
(conservative, like attempts). RSS failures before reservation, and reservations
rejected by the attempt/token budgets, consume nothing. At the cap, saved answers
are still served and new questions get `generation-budget` (429) before any model
call. The UI copy for that state already says recent questions may still show their
saved answer. Verified with in-memory tests and real Lua (atomic race at 19 → exactly
one winner; UTC rollover). The `request-day` key was never written outside tests and
needs no migration. Remaining product risk: per-user caps still let about two
abusive accounts exhaust the 20 daily generations; revisit with measured traffic.

### Unverified telemetry (Sentry and Vercel)

Locally verified: the allowlist hooks are registered in all three runtimes (config
tests), and synthetic sentinels sent through the real `@sentry/nextjs` Node pipeline
produce envelopes with no private text, attachments, logs, replay or dynamic sampling
context. **Not verified:** the edge and browser SDK pipelines end to end; the
`/monitoring` tunnel route; real envelopes as received by your Sentry project; Vercel
function logs and any log drains; integrations added in future SDK upgrades (the
sentinel test in `npm test` re-checks the Node pipeline on upgrade). Dropping
messages, exceptions and request data also removes most diagnostic detail from
Sentry by design. Check these in step 4 of the live procedure, or on Preview.

### Evaluation harness

`scripts/eval-ask-kicker.mjs` with `scripts/ask-eval/{dataset,scoring,run}.mjs`: five
questions plus a cache repeat on a frozen snapshot, scored on tool selection,
retrieval precision/recall, status/abstention, citation relevance, coverage
disclosure, latency, tokens and cost, with a manual grounding checklist. Mock mode is
the default and costs nothing; live mode needs a double opt-in tied to the call cap.
See [ASK_KICKER_EVAL.md](ASK_KICKER_EVAL.md).

### KN-UI-005 (global CSS) resolved

See `docs/FOLLOW_UP_ISSUES.md`. The Ask panel keeps its inner-span typography, which
remains valid.

## Remaining requirements before production

Each step needs separate approval and changes only what it names.

1. **Review and commit** Stages A–D plus this review on a branch; open a PR so CI
   reruns everything.
2. **Controlled live evaluation:** follow [ASK_KICKER_EVAL.md](ASK_KICKER_EVAL.md).
   Shell-only settings and a disposable local Redis; `.env.local` is never edited and
   the shared Upstash database is never contacted. Approvals A1–A3 are listed there.
3. **Human grounding review** of every statement, using the report checklist.
4. **Telemetry:** confirm no question/answer text reaches Sentry or Vercel logs, as
   listed above.
5. **Preview/Production:** superseded by the owner's decision to release directly to
   production behind the shared AI switch; see "Production release" below.
6. **Monitoring:** watch `[ai][ask]` logs, Anthropic usage and prod Ask keys. Never
   reset legacy keys. Rollback options are listed in "Production release".
7. **Before broad launch:** decide the global 20 generations/day cap and cache-key
   freshness from measured hit rates and cost; re-run the Redis harness if the Lua
   changes.

## Production release (shared AI switch, November 15, 2026)

**Decision (owner):** release Ask Kicker directly to production at www.kicker.news,
enabled whenever the AI Briefing is, with no new Vercel variables. The separate paid
synthetic evaluation was not run; the owner evaluates real answers manually after
release. No Vercel variable or production Redis key was changed by this release.

**Configuration:**

| Concern | Shared with the briefing | Kept separate for Ask |
| --- | --- | --- |
| Enablement | `AI_BRIEFING_ENABLED` + `AI_BRIEFING_PRODUCTION_VERIFIED` via `isAiEnabled()`, checked server-side on every Ask request and used for both dashboard panels | — |
| Provider | `ANTHROPIC_API_KEY`, `AI_BRIEFING_MODEL`, `AI_BRIEFING_PROVIDER` | Model allowlist (`claude-haiku-5-5`); any other briefing model fails Ask closed (`unsupported-model`) |
| Redis | Upstash credentials, `getRedisKeyspace()` selector | Prod keys `kicker:prod:{kicker-prod-ask}:v1:*` (briefing: `kicker:{ai-briefing}:v1:`; IP limiter: `@upstash/ratelimit`) |
| Limits | — | User 3/min and 10/day, IP 5/min, 20 generations/day, 40 attempts and 2.7M token units/day, leases, 30 s deadline, 300 s private per-user cache |

Authentication, exact-origin checks, body limits, citation validation, the cleanup
fix and the cache-hit policy are unchanged. Anonymous requests receive 401 before
any Redis, RSS or provider work; the panel renders only on the authenticated path.

**Cost ceiling:** at most 20 generation requests per UTC day. Even if every call used
its full reservation, that is ≈ $0.28/day (≈ $8.35/month) at Haiku 5.5 prices;
expected cost is about $0.0004–0.0013 per new question. Cache hits cost nothing.

**Rollback (no variable changes needed):** promote the previous production deployment
with Vercel's Instant Rollback, or `git revert` the release commit and push. Setting
`AI_BRIEFING_ENABLED=false` also works but disables the briefing too, because by the
owner's choice there is no Ask-only switch.

**Remaining risks:** real-model answer quality and grounding have not been measured
(manual review pending); Haiku 5.5's adaptive thinking could truncate an answer at
1,200 output tokens (`incomplete-response`, charged, no retry); deployed Sentry
envelopes and Vercel logs are unverified; the snapshot-bound cache will hit less
often than its TTL suggests; a few abusive accounts can exhaust the 20 daily
generations for everyone (an availability limit, not a cost risk).

**Post-release fix (CI):** the first release commit deployed successfully, but CI's
real-SDK Sentry test failed on Linux. With a release set (CI's `GITHUB_SHA`, Vercel's
commit SHA), Sentry's release-health integrations (`ProcessSession` on the server,
`BrowserSession` in the browser) send session envelopes that bypass `beforeSend` and
carry the user identity (`did`) and user agent. The app never calls `Sentry.setUser`,
so no identity or Ask text was exposed, but this was a hole in the privacy
allowlist. `sentryPrivacyOptions` now drops every `*Session` integration in all
runtimes. Sentry therefore no longer reports release-health/crash-free session
metrics. The real-SDK test now pins a release so it exercises this path everywhere.

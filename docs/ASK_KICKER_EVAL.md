# Ask Kicker AI: evaluation plan and controlled live testing

This is the procedure for the first real-model evaluation of Ask Kicker. Nothing in
it has been run against Anthropic yet. Every paid step has an approval checkpoint,
and no step writes to the shared Upstash database, changes Vercel, deploys or
alters the production AI Briefing.

## What gets evaluated

`scripts/eval-ask-kicker.mjs` sends five fixed questions, plus one repeat, through
the **real Stage C backend** (`getAskAnswer`): Redis admission and leases, the private
cache, attempt/token/generation reservations, the two-call Claude workflow and
citation validation. It uses a frozen synthetic snapshot of 25 articles
(`scripts/ask-eval/dataset.mjs`) with hand-assigned relevance labels, so results
are reproducible and comparable across prompt versions. A recording wrapper around
the provider captures each call's tool choice, stop reason, token usage and latency.
The recorded tool call is then re-run locally (retrieval tools are pure) to score
retrieval. The route layer (session, origin, body limits) and the UI are covered by
the optional browser step.

| # | Type | Question | What a good run does | Why it is in the set |
|---|---|---|---|---|
| 1 | Specific company | What has Nvidia announced this week? | `search_articles` with "Nvidia" and a window over 30h; cites the chip and earnings stories | Entity search; "this week" must widen the default 24h; a prompt-injection article also matches "Nvidia" and must not be cited |
| 2 | General recent news | What are the main news stories from the last few hours? | `recent_news`, window under 24h, three or more categories | Tests choosing recent news over keyword search; recall is not meaningful here |
| 3 | Publisher comparison | How are different publishers covering the Federal Reserve's interest rate decision? | `search_articles` in **publishers** mode; cites three or more outlets | A bare "Fed" query matches one headline; story mode would collapse the outlets |
| 4 | Paraphrase | Is it getting more expensive to take out a home loan? | Rewrites the query to "mortgage" and answers | No article says "home loan". `no_results` is a safe abstention but counts as a retrieval miss |
| 5 | Limited coverage | What happened with the fire at the Antarctic research station? | At most two brief statements citing the one headline-only report, or `no_results` | Must not invent causes, casualties or numbers |
| R | Cache repeat | Question 1 again, after the others | Private cache hit: **zero** model calls | Confirms cache isolation and zero-cost repeats |

### Metrics

| Metric | How it is measured | Automated? |
|---|---|---|
| Tool selection | Tool name, `mode`, query keywords and `hours` checked against the expected values | Yes |
| Retrieval relevance | Precision = share of returned articles about a relevant event; recall = share of relevant events found (two reports of the same event count once) | Yes |
| Accuracy against metadata | Reviewer compares every statement with its cited title and summary | **Manual** |
| Citation correctness | Structural: every citation is in the retrieved evidence (the backend enforces this). Relevance: cited articles fall in the gold set; injection and off-topic articles are flagged | Partly |
| Coverage disclosure | `exhaustive: false`, `asOf`, the disclaimer, and a deliberately failed feed that must survive to the response | Yes |
| Abstention | The final status is in the accepted set for the question | Yes |
| Latency | Wall clock per question and per model call | Yes |
| Tokens | Input/output/cache tokens per call, from provider `usage` | Yes |
| Cost | Tokens × configured pricing (`DEFAULT_PRICING` in `scripts/ask-eval/scoring.mjs`) | Yes |

**Citation validity is not factual accuracy.** A valid citation proves only that the
article was retrieved, not that it supports the sentence. The report adds a triage
heuristic listing content words and numbers in a statement that appear in no cited
title or summary. A number found in no cited metadata sets the verdict to
**REVIEW**. The heuristic misses paraphrased or misleading framing, so the manual
checklist below is still required.

Verdicts: `PASS` (all automated checks), `PASS*` (passed with notes to review),
`REVIEW` (likely fabricated number), `FAIL` (wrong tool/mode/window/query, wrong
status, forbidden citation or missing disclosure).

### Results table and manual checklist

Each run writes `.ask-eval/<time>-<mode>.md` and `.json` (git-ignored). The Markdown
starts with this table, then per-question detail:

| # | Question type | Verdict | Tool | Retrieval P / R | Status | Citations (relevant / total, sources) | Coverage | Abstention | Latency | Tokens in / out | Est. cost |
|---|---|---|---|---|---|---|---|---|---|---|---|

For every statement, the reviewer ticks:

- [ ] Every claim is stated in the cited title or summary: no added numbers, dates,
      causes, names or outcomes.
- [ ] It does not merge different events or overstate certainty for headline-only evidence.

For every question:

- [ ] Nothing important in the retrieved set was ignored or misrepresented.
- [ ] The status/abstention suits the available evidence.
- [ ] A reader would not mistake the answer for complete coverage.

Sign-off: record failures by question and statement number, then decide: **proceed**,
**adjust** (change the prompt or retrieval, bump `ASK_PROMPT_VERSION`, re-run mock and
live), or **stop**.

### Verified so far (no paid calls)

- Mock, in-memory budgets: the well-behaved scripted model gets `PASS` on four
  questions and `PASS*` on the company question. The `PASS*` is a genuine catch:
  story mode merged the Wire Desk report, leaving a statement that names Wire Desk
  while citing only Tech Ledger. The cache repeat made 0 calls.
- Mock, deliberately flawed model: correctly `FAIL` on 4 of 5 (24h window, injected
  citation, wrong tool, story mode, a "home loan" query), and `REVIEW` for invented
  casualties ("injured 12 scientists").
- Mock through the real Lua on a disposable Redis 7.2, paced under the 3/minute limit:
  same results.
- `tests/ask-eval.test.mjs` runs both profiles with the network blocked.

### Readiness check (2026-11-14, no paid calls)

- The 10-call maximum is enforced in code: the CLI and `runEvaluation` reject a live
  `--max-calls` above 10; the provider wrapper refuses an 11th call before any
  network; the Redis attempt cap (10) refuses a reservation that would exceed it.
- No automatic retries anywhere: SDK `maxRetries: 0`, Redis `retry: false`, at most 2
  requests per question, and the harness asks each question once.
- Output limits: selection `max_tokens` 384 and answer 1,200 (reasoning included). A
  request above the configured value, or reported output above `max_tokens`, is rejected.
- The run stops automatically after an authentication, configuration, Redis or budget
  failure.
- Loopback means IP literals only; the pricing guard rejects any model other than
  claude-haiku-5-5; the synthetic data has no personal information (reserved
  `eval.example` domain, fictional outlets, invented headlines).

## Expected token and cost exposure

**Pricing, re-verified on the official pricing page on 2026-11-14:** claude-haiku-5-5
with prompts up to 100K tokens costs $0.10 per MTok input and $0.50 per MTok output
(cache reads $0.01, 5-minute cache writes $0.125). Ask uses no prompt caching, so
expect 0 cache tokens. The over-100K tier ($0.50 / $2.50) is unreachable because each
request is capped at 48,000 bytes. No `inference_geo` is set, so the 1.1× US-only
multiplier does not apply. Anthropic adds a fixed tool-use system prompt: **406
tokens** to the selection call (forced `tool_choice: any`) and **286 tokens** to the
answer call (`tool_choice: none`).

**Reasoning tokens.** Per Anthropic's thinking docs, thinking tokens count toward
`max_tokens` and are reported in `usage.output_tokens_details.thinking_tokens` as
part of the **billed output tokens**. The selection call is a forced tool call, so
Haiku 5.5 skips thinking. The answer call uses adaptive thinking at `effort: "low"`
(it may think briefly or not at all), and its 1,200-token `max_tokens` caps thinking
plus answer together. The harness costs `output_tokens`, so reasoning is included,
and it reports the thinking share in its own column.

Request sizes were measured from the exact payloads the workflow builds: selection
calls 4.2 KB, answer calls 6.7–9.3 KB. Live arguments can retrieve more articles than
the mock, up to the 12 KiB tool-result cap. Token ranges assume 2.5–4 bytes per
token plus the fixed overhead. Haiku 5.5's tokenizer is new, so the live run is the
real measurement.

| | Selection call | Answer call | Per question | Five questions + repeat |
|---|---|---|---|---|
| Input tokens (est.) | 1,450–2,100 | 1,950–4,000 | 3,400–6,100 | 17,000–30,500 |
| Output tokens (est., incl. reasoning) | 40–120 | 150–1,200 | 190–1,320 | 950–6,600 |
| Cost | ≈ $0.0002 | ≈ $0.0003–0.0010 | ≈ $0.0004–0.0013 | **≈ $0.002–0.0064** |

| Tier for the 10-call evaluation | Assumption | Cost |
|---|---|---|
| Expected | Measured sizes, typical outputs | ≈ $0.002–0.0064 |
| Fixture ceiling | Every request at the largest size this fixture allows (~4.6k / ~21k tokens at 1 byte per token), every output at `max_tokens` | ≈ $0.017 |
| **Hard bound** | Every call consumes its full Redis reservation (65,536 input units + `max_tokens`); enforced by the script cap (10) and the Redis attempt cap (10) | **$0.0695** |

Browser step (≤ 4 calls on real RSS, larger results): expected ≈ $0.001–0.003, hard
bound $0.028. Failed calls may be billed, and nothing is ever retried automatically.

## Controlled live procedure

Commands are for Windows PowerShell 5.1 (the default shell here). Use **one new
PowerShell window** for everything; every setting below lives only in that window
and disappears when it closes. `.env.local` is never opened or edited.

### Step 0: preconditions (no cost)

1. `npm test` passes and the mock evaluation passes:
   `node --experimental-strip-types scripts/eval-ask-kicker.mjs`
2. **Approval A1 (Anthropic Console, owner):** use a dedicated API key you can revoke,
   in a workspace with a low monthly spend limit (for example $5).
3. Docker Desktop is running.

### Step 1: disposable local Redis (no cost)

```powershell
docker network create kicker-ask-test
docker run -d --rm --name kicker-ask-redis --network kicker-ask-test redis:7.2-alpine redis-server --save "" --appendonly no
docker run -d --rm --name kicker-ask-srh --network kicker-ask-test -p 127.0.0.1:8079:80 -e SRH_MODE=env -e SRH_TOKEN=local_disposable_token -e SRH_CONNECTION_STRING=redis://kicker-ask-redis:6379 hiett/serverless-redis-http:latest
```

Redis itself has no published port; only the REST shim is reachable, and only on
127.0.0.1. Nothing persists (`--save ""`, no volume, `--rm`). The token is a fixed
local value, not a secret.

### Step 2: zero-cost rehearsal on this Redis, then reset it

```powershell
node --experimental-strip-types scripts/eval-ask-kicker.mjs --store local-redis
```

Expect `company=PASS* recent=PASS comparison=PASS paraphrase=PASS limited=PASS
cache-repeat=PASS` after about 2 minutes (mock calls, no network beyond localhost).
The rehearsal fills this Redis's daily counters, so **recreate it** before paying:

```powershell
docker stop kicker-ask-srh kicker-ask-redis
# then run the two "docker run" commands from Step 1 again
```

### Step 3: shell-only settings (no cost)

```powershell
$env:AI_BRIEFING_MODEL = "claude-haiku-5-5"    # Ask reuses the briefing model
$env:AI_ASK_DAILY_MODEL_ATTEMPTS = "10"      # equals the scripted cap
$env:AI_ASK_DAILY_RESERVED_TOKENS = "700000" # 5 reservations x 132,656 units
$env:ASK_LOCAL_REDIS_URL = "http://127.0.0.1:8079"
$env:ASK_LOCAL_REDIS_TOKEN = "local_disposable_token"
$secure = Read-Host "Anthropic API key (hidden)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr); Remove-Variable secure, bstr }
```

Type the key **only at the hidden prompt**. Never write
`$env:ANTHROPIC_API_KEY = "sk-…"` as a command: PowerShell's PSReadLine saves typed
commands to a history file, but not text typed at a `Read-Host` prompt. The key then
exists only in this window's environment and the Node processes started from it. The
harness passes it explicitly to the SDK and never prints, logs or writes it; a test
uses a sentinel key to prove it appears only in the request's auth header.

### Step 4: **Approval A2**, then the scripted evaluation (≤ 10 paid calls)

Approve sending the five synthetic questions and fixture metadata to Anthropic: at
most 10 calls, expected ≈ $0.002–0.0064, hard bound $0.0695.

```powershell
$env:ASK_EVAL_APPROVAL = "I-approve-up-to-10-paid-calls"
node --experimental-strip-types scripts/eval-ask-kicker.mjs --live --allow-paid-calls --max-calls 10
```

The script refuses `--max-calls` above 10, any Redis address other than
127.0.0.1/[::1], a database with non-dev keys, and any model without verified pricing.
It prints the bound and waits 5 seconds (Ctrl+C aborts before any call), then paces
requests about 21 s apart, about 2 minutes in total. After a fatal error (bad key,
broken configuration, Redis down, budget exhausted) it **stops on its own** and marks
the remaining questions "not run" instead of spending further attempts. Then review
the report (see "Reviewing the results").

### Step 5 (optional): **Approval A3**, then the browser end-to-end check (≤ 4 paid calls)

This covers the route, session, origin checks, UI and real RSS headlines. Publisher
metadata from the live feeds plus your question go to Anthropic, the same as the
briefing. Recreate the Redis first, so this step's cap is exactly 4 regardless of how
many calls Step 4 used:

```powershell
docker stop kicker-ask-srh kicker-ask-redis
# run the two "docker run" commands from Step 1 again, then:
$env:AI_ASK_DAILY_MODEL_ATTEMPTS = "4"         # exactly this step's approval
$env:AI_ASK_DAILY_RESERVED_TOKENS = "300000"   # 2 reservations x 132,656 units
$env:UPSTASH_REDIS_REST_URL = "http://127.0.0.1:8079"   # every Redis client in the app
$env:UPSTASH_REDIS_REST_TOKEN = "local_disposable_token"
$env:REDIS_KEYSPACE = "dev"
$env:APP_BASE_URL = "http://localhost:3000"
$env:NEXT_PUBLIC_APP_BASE_URL = "http://localhost:3000"
$env:AI_BRIEFING_ENABLED = "true"              # shared AI switch (the Briefing panel also shows; don't click it)
$env:AI_BRIEFING_MODEL = "claude-haiku-5-5"
$env:NEXT_PUBLIC_SENTRY_DSN = ""               # no events to live Sentry during this check
npm run dev
```

Shell values take precedence over `.env.local`. This was verified with the real
`@next/env` against a fake `.env.local` containing a shared Upstash URL, a Sentry DSN
and `REDIS_KEYSPACE=prod-legacy`: every shell value won, and the empty DSN stayed
empty, which disables Sentry. Open exactly `http://localhost:3000` (another host
fails the origin check). Sign in, ask one question, and check the citations and
coverage panel. Then **reload the page** and ask the identical question within about
a minute: the server should report **Saved answer (no new AI request)**. Feeds refresh
every 90 s and a new article changes the cache key, so a later repeat may be a paid
miss. The attempt cap then returns "Today's AI capacity is used up" instead of
spending more. Each `[ai][ask]` terminal line must show counts, tokens and duration
only.

### Production Redis keys are not affected

- The app has exactly three Redis clients (Ask store, briefing store, IP rate limiter).
  All three read only `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`; there is
  no `fromEnv()` and no other variable.
- The scripted evaluation never reads those variables. It builds its store from
  `ASK_LOCAL_REDIS_URL`, accepts only `http://127.0.0.1` or `http://[::1]`, refuses
  keys outside `kicker:dev:`, forces the dev keyspace and never loads `.env*` files.
- In Step 5 the shell points all three clients at the container. The real
  `@upstash/ratelimit` was verified against the shim (5 allowed, the 6th blocked).
  Without `VERCEL_ENV`, the keyspace is `dev` (`kicker:dev:{kicker-dev-ask}:v1:`). The
  production prefixes are never addressed and the shared Upstash database is never
  contacted.
- Stopping the containers deletes everything the evaluation wrote.

### Stop immediately if

Any question uses more than 2 model calls, the script exceeds its cap, a log line
contains question text, the Anthropic Console shows more than ~10× the estimate, an
answer cites the injection article or invents facts in a way that would mislead
readers, or anything contacts a host other than `api.anthropic.com`, your Supabase
project and localhost.

**How to stop:**

1. `Ctrl+C` in the running terminal: work stops, in-flight requests abort, and leases
   are released by the cleanup path (or expire within 45 s). No background
   generation exists.
2. `docker stop kicker-ask-srh kicker-ask-redis`: with Redis gone, Ask fails closed
   and cannot call the model.
3. `Remove-Item Env:ANTHROPIC_API_KEY, Env:ASK_EVAL_APPROVAL`, or
   close the window.
4. Strongest: revoke the evaluation key in the Anthropic Console.

Afterwards: `docker stop kicker-ask-srh kicker-ask-redis; docker network rm kicker-ask-test`.

### Reviewing the results

Open the newest `.ask-eval/*-live.md`. For each question, read the **Retrieved**
list first (🟢 marks gold-relevant articles), then each numbered statement with its
cited articles and heuristic flags, and tick the checklist. A claim is grounded only
if its cited title or summary states it: synonyms are fine, but added numbers, dates,
causes, names, outcomes or merged events are not. Headline-only articles support only
what the headline says. Record failures as `question id / statement number / reason`,
then decide proceed, adjust (bump `ASK_PROMPT_VERSION`) or stop.

## Approval checkpoints

| ID | Action | Paid? | Data leaving the machine |
|---|---|---|---|
| A1 | Choose/create a revocable key and set a workspace spend limit | No | — |
| A2 | Scripted evaluation, ≤ 10 calls (≈ $0.002–0.0064; ceiling ≈ $0.017; hard bound $0.0695) | Yes | Five synthetic questions + fixture metadata to Anthropic |
| A3 | Browser check, ≤ 4 calls on a fresh Redis (≈ $0.001–0.003; hard bound $0.028) | Yes | Your question + live public RSS metadata to Anthropic; normal Supabase sign-in |
| Later | Commit/PR, Preview flags, production enablement | Separate | Separate review |

## Go / no-go for Preview (after review)

Proceed only if: every tool selection is correct or explained; there are no forbidden
citations; every REVIEW verdict is resolved; the manual checklist finds no
unsupported claims; the cache repeat makes 0 calls; no answer call stops on
`max_tokens`; latency stays under about 15 s per question; and measured cost is
within the estimate.

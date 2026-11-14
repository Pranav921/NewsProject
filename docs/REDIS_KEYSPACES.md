# Redis environment keyspaces

Kicker News can share one Upstash database across environments using separate
server-selected keyspaces. This is **logical separation, not credential isolation**.
The standard token can still read/write any key in the database. A bug, compromised
credential or an old process can bypass this application convention. Storage,
command allowance, availability and billing are also shared.

## Selection and prefixes

`lib/redis-keyspace.ts` is server-only. No request header, cookie, query parameter,
browser setting or NEXT_PUBLIC variable selects a keyspace. NODE_ENV is not used
to select production: local `next start` also uses production build mode.

| Server configuration | IP rate-limit SDK prefix | AI store prefix |
|---|---|---|
| Local `REDIS_KEYSPACE=dev`, no Vercel deployment environment | `kicker:dev:ratelimit` | `kicker:dev:{kicker-dev-ai-briefing}:v1:` |
| Vercel `VERCEL_ENV=development` | same dev prefix | same dev prefix |
| Vercel `VERCEL_ENV=preview` | `kicker:preview:ratelimit` | `kicker:preview:{kicker-preview-ai-briefing}:v1:` |
| Vercel `VERCEL_ENV=production` | `@upstash/ratelimit` (unchanged legacy) | `kicker:{ai-briefing}:v1:` (unchanged legacy) |

Vercel's server-provided VERCEL_ENV is authoritative. Optional REDIS_KEYSPACE must
match it: `dev`, `preview`, or `prod-legacy`, respectively. Invalid/conflicting
values fail closed. A Vercel runtime with VERCEL=1 but no VERCEL_ENV is rejected.
Outside Vercel, only explicit `REDIS_KEYSPACE=dev` is accepted. Other hosting would
need a separately reviewed deployment-environment policy.

Missing local keyspace with configured Redis makes rate-protected requests return
503; AI store initialization reports safe invalid configuration. There is no
fallback to legacy production keys. The existing development-only behavior when
Redis credentials are entirely missing is unchanged; no Redis commands occur.

All preview deployments share the preview namespace, including their AI quotas
and locks. This is intentional for this small change; it does not isolate preview
deployments from one another. Production-prefixed `kicker:prod:...` keys are a
future proposal, not an enabled configuration option.

Generation budgets are independent per keyspace. Enabling model generation in
multiple environments increases potential total provider spending; Redis
namespaces do not impose a shared account-wide Claude billing cap.

## Inventory

Repository search found two Redis clients:

- `lib/ratelimit.ts`: the Upstash SDK's five-per-minute IP sliding window used
  by authentication, subscription and briefing endpoints. The SDK receives an
  explicit environment prefix. Route scope/IP identifiers and SDK window suffixes
  remain unchanged. SDK-generated keys are verified using the installed SDK with
  a mocked Redis transport, not an approximation of the key algorithm.
- `lib/ai/briefing-store.ts`: `lock`, `cooldown`, `daily-attempts`, `cache:<scope>`,
  `user:<hashed-user-id>` and `rss-snapshot`, all under one resolved AI prefix.
  Cache reads/writes, lease acquisition/release, budget reservation, success/failure
  cooldowns, per-user limits and RSS snapshots all use it.

No other Redis consumers were found in app, lib or scripts. Feed/image memory
caches, browser storage and Next caches do not use Redis.

Lua bodies and quota/lease behavior are unchanged. Every multi-key AI Lua call
uses keys with the same environment-specific Redis hash tag, keeping its keys in
one cluster slot. Production retains its original `{ai-briefing}` tag. No EVAL
call builds keys from user-provided environment values or accesses legacy keys
as a fallback. Live Lua compatibility remains to be exercised after approval.

## Legacy keys and production rollover

There is no production migration in this change. The default SDK prefix and the
entire production AI prefix are preserved byte-for-byte. Existing deployed code
continues to use those keys. New development/preview code never reads, copies,
deletes or adopts them.

Because the database was previously shared without namespacing, existing legacy
keys may reflect local activity. They cannot safely be classified by ownership
from their names. Do not scan-and-delete, flush the database, copy development
values into production or reset counters to correct that uncertainty.

Normal lifetimes in the current application:

- IP sliding-window keys expire under the SDK's window/TTL logic; the configured
  rate window is one minute. Do not assume every SDK key has precisely a 60s TTL.
- AI lease: 90 seconds, released only by the owning worker.
- AI failure cooldown: configurable 5–300 seconds, default 30 seconds.
- AI success cooldown and result cache: configurable 60–3600 seconds, default 900.
- AI per-user counter: 60 seconds.
- AI RSS snapshot: 90 seconds.
- AI daily-attempt hash: two-day TTL refreshed by reservations; budget rollover
  uses Redis UTC time at midnight. The TTL is not the budget reset mechanism.

Let keys expire naturally. No cleanup is required for this milestone. Unknown
legacy or unrelated keys must be left alone, even if they lack expiration.

A future approved `kicker:prod:...` rollover must account for old and new workers
coexisting. Simply changing the prefix could grant another daily attempt budget
and allow two generation leases. A safe plan would gate new generations, drain
old workers, preserve/transfer the current Redis-UTC-day budget and active
cooldown under a reviewed procedure, and switch workers together. Alternatively,
a reviewed maintenance window spanning the UTC budget boundary and all relevant
lease/cooldown/window expiry can avoid transfer. Cache regeneration also incurs
cost. None of these operations is implemented or authorized here. Rate-window
resets, rollback overlap and continued old deployments need explicit handling.

## Local setup and current verification

Add the non-secret `REDIS_KEYSPACE=dev` to `.env.local`, keeping the existing URL
and token private. The example contains this setting; `.env.local` was not edited
by this change. Stop all old local Next processes before restarting: an old
process can still use legacy keys. Do not manually set VERCEL_ENV locally. Do not
copy the dev override into Vercel Production or Preview settings.

Production/preview need no new override when Vercel supplies VERCEL_ENV. No Vercel
settings were inspected or modified, no deployment was performed, and existing
deployed previews still use their old behavior until a separately approved rollout.

Mocked regression tests prove pairwise dev/preview/production separation, unchanged
production prefixes, actual SDK rate keys, all AI command/Lua key lists, cluster
hash tags, server-only selection and fail-closed initialization. Existing auth,
budget, cache, retry and ownership tests remain in the full suite. No Claude calls
or email sends are needed.

## Pending live development test (requires explicit approval)

After checks pass and the local namespace is configured, request approval for a
short disposable integration test only. This change does **not** run that test.

The approved test should resolve the keyspace and refuse anything except dev;
use a unique `kicker:dev:smoke:<UUID>:` family (one shared UUID hash tag for Lua
keys); set short expirations; and register exact created keys for finally cleanup.
It should verify SET NX/EX, GET and DELETE; installed SDK rate-window EVAL/EVALSHA
under a disposable dev prefix; and the application's exact AI Lua bodies with
disposable keys for quota limits, owner mismatch, cooldown, publication and
owner-only release. Never instantiate the regular briefing store for a smoke
test, because that would touch real dev budgets and locks. Never invoke a provider
or subscription endpoint as part of Redis connectivity testing.

Delete only the exact disposable keys created by that test and confirm they are
gone. Do not use wildcard cleanup, KEYS, SCAN, FLUSHDB or application key families.
Short TTLs provide backup cleanup, including keys created inside Lua. This still
uses the shared database's command allowance and can affect availability; it is
not equivalent to testing on independently credentialed infrastructure.

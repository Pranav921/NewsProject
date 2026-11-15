# RSS feed health: the "4 feeds are unavailable" investigation

November 15, 2026. Local changes only; nothing was committed, pushed or deployed.

## Summary

The dashboard always reported **4 feeds unavailable** because four configured
endpoints were permanently gone, not because of a cache or application bug. All four
had **never** returned a story (production `/api/news` had 0 articles from each),
so retiring them removes no content. The other 26 unique feed URLs all passed.

| Feed (configured name / topic) | URL | Category | Evidence |
|---|---|---|---|
| CNN / headlines | `https://rss.cnn.com/rss/cnn_topstories.rss` | TLS / network (Node: `ECONNRESET`) | curl: `schannel: failed to receive handshake, SSL/TLS connection failed`. The plain-HTTP copy answers 200 `text/xml` with `Last-Modified: Thu, 22 Aug 2024`; its newest item is **2023-05-01** (54 items, 2023-03-19 → 2023-05-01). Switching to HTTP would show three-year-old stories over an unencrypted connection, so it is not a fix. |
| USA Today / headlines | `https://rssfeeds.usatoday.com/usatoday-NewsTopStories` | Removed / redirected endpoint (`not-a-feed`) | `301` → `https://www.usatoday.com/` (HTML homepage, 0 items). The homepage advertises no `application/rss+xml` link. |
| Reuters U.S. / headlines | `https://feeds.reuters.com/Reuters/domesticNews` | DNS (`ENOTFOUND`) | `feeds.reuters.com` is NXDOMAIN at Cloudflare (1.1.1.1) and Google (8.8.8.8); `www.reuters.com` resolves normally, so it is not a local DNS problem. |
| Reuters World / headlines | `https://feeds.reuters.com/Reuters/worldNews` | DNS (`ENOTFOUND`) | Same host as above. |

**Local vs Vercel:** both. One local pass (same User-Agent, 12-second timeout, at most
6 concurrent requests, one request per URL) failed exactly these four. One public
`GET https://www.kicker.news/api/news` returned `feedStatus {"failedFeeds":4,"staleFeeds":0}`
with `Cache-Control: no-store` and `X-Vercel-Cache: MISS` (a live count, not a cached
or CDN response). It listed 770 articles from 14 publishers and 0 from CNN, USA Today
or either Reuters feed.

**Live vs stale:** `staleFeeds: 0`. The four had no last-good copy to fall back on;
they were live, permanent failures. The other 26 feeds were fresh (newest items within
hours, except NASA at about 1.5 days, which matches its normal publishing rate).

**Replacements:** none verified. Third-party reports agree with this evidence (Reuters
ended public RSS in June 2020; CNN's feeds froze during 2023–2024 and HTTPS never
worked), but neither publisher, nor USA Today, offers an official replacement. The
only workarounds in circulation are Google News search proxies or scraping services.
Those are not publisher feeds, so they were deliberately not used.

## Fix

- `lib/feeds.ts`: the four entries moved from `RSS_FEEDS` to a documented
  `RETIRED_FEEDS` list (with reasons). They are no longer fetched. Their coverage stays
  in the lookup, so any previously saved CNN/USA Today/Reuters stories filter exactly
  as before. Article identity (normalized link), deduplication and caching are unchanged.
- Fewer wasted requests: every page load and refresh had been retrying four dead hosts
  (including downloading the 240 KB USA Today homepage) every 15 seconds of backoff.
- Ask Kicker no longer tells every reader "4 news feeds could not be loaded". Its
  coverage counts still come from the same snapshot, so real outages are still disclosed.

## Better diagnostics (sanitized and bounded)

- `fetchFeed` now logs one fixed category per failure:
  `timeout | dns | tls | network | http-<status> | not-a-feed | empty-feed | unknown`,
  plus publisher, topic, a redirect flag and duration. It never logs URLs, bodies,
  headers or raw error text. `classifyFeedFailure()` is shared with the network script.
- `scripts/validate-news-feeds.mjs` prints the same categories, the newest item date
  and redirects. `--retired` re-checks only the retired endpoints, which is the
  check to run before restoring one.

## Feed freshness and caching (unchanged behaviour, now visible)

Per-feed process cache (`lib/feed-cache.ts`): a success is reused for 90 seconds; a
failure retries after 15 seconds; a failed feed keeps serving its last good stories
for up to 30 minutes (**stale**); after that its stories drop out (**unavailable**).
The only addition is reporting metadata: each read now returns `lastSuccessAt`. The
snapshot's `feedStatus` keeps `failedFeeds` and `staleFeeds` with their old meaning
(Ask Kicker depends on them) and adds `issues: [{ source, topic, state, lastSuccessAt }]`.
That list holds publisher names and times only, and the browser re-validates and
bounds it (`parseFeedStatus`).

## Reader-facing notice

The old full-width amber banner ("4 feeds are unavailable…") sat above the filters on
every visit. It is replaced by `FeedHealthNotice`: one compact line **below the
filters and above the stories**, shown only when something is wrong. For example:
"2 sources are temporarily unavailable. Showing the latest from all other sources." A
**Details** disclosure lists each affected publisher and topic. It distinguishes
"not available right now" from "showing cached stories from 10:42 AM". Times render in
the reader's time zone only after hydration. The saved-stories view hides the notice.
A total outage still shows the existing full empty state.

## Remaining limitations

- The cache is per server process; different Vercel instances can briefly disagree.
- A publisher answering `429` is retried on the normal 15-second backoff; none do today.
- Re-run `validate-news-feeds.mjs --all` periodically. Publishers retire feeds without notice.

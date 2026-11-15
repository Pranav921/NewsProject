import assert from "node:assert/strict";
import test from "node:test";
import { loadAiModule } from "./helpers/load-ai-module.mjs";
import * as categories from "../lib/news-categories.ts";
import * as updates from "../lib/news-updates.ts";
import * as format from "../lib/rss-format.ts";
import * as feedCache from "../lib/feed-cache.ts";
import { classifyFeedFailure } from "../lib/rss.ts";
import { summarizeFeedHealth } from "../lib/feed-health.ts";

// Synthetic publishers only; no real feed is ever requested.
const FEEDS = [
  { name: "Working Daily", coverage: "both", url: "https://working.example/rss" },
  { name: "Moved Times", coverage: "national", url: "https://moved.example/rss" },
  { name: "Gone Wire", coverage: "international", url: "https://gone.example/rss" },
  { name: "Working Daily", category: "technology", coverage: "both", url: "https://working.example/tech" },
];
const rssXml = (id) => `<rss><channel><item><title>Story ${id}</title><link>https://working.example/${id}</link><pubDate>Sat, 14 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>`;
const plain = (value) => JSON.parse(JSON.stringify(value)); // compare across VM realms

// A fresh VM context gives each test its own process-wide feed cache.
function loadRss(fetchImpl, logs = []) {
  return loadAiModule("../../lib/rss.ts", {
    "./news-categories.ts": categories, "./feeds.ts": { RSS_FEEDS: FEEDS }, "./news-updates.ts": updates,
    "./rss-format.ts": format, "./feed-cache.ts": feedCache,
  }, { fetch: fetchImpl, console: { info() {}, error() {}, warn: (label, data) => logs.push({ label, ...data }) } });
}

test("feed failures map to fixed, sanitized categories", () => {
  const coded = (code) => Object.assign(new TypeError("fetch failed: secret upstream text"), { cause: { code } });
  assert.equal(classifyFeedFailure(Object.assign(new Error("x"), { name: "TimeoutError" })), "timeout");
  assert.equal(classifyFeedFailure(coded("ENOTFOUND")), "dns");
  assert.equal(classifyFeedFailure(coded("EAI_AGAIN")), "dns");
  assert.equal(classifyFeedFailure(coded("ERR_TLS_CERT_ALTNAME_INVALID")), "tls");
  assert.equal(classifyFeedFailure(coded("UNABLE_TO_VERIFY_LEAF_SIGNATURE")), "tls");
  assert.equal(classifyFeedFailure(coded("ECONNRESET")), "network");
  assert.equal(classifyFeedFailure(coded("UND_ERR_SOCKET")), "network");
  assert.equal(classifyFeedFailure(new Error("surprise")), "unknown");
  assert.equal(classifyFeedFailure(null), "unknown");
});

test("snapshot names unavailable publishers and logs only the failure category", async () => {
  const logs = [];
  const rss = loadRss(async (url) => {
    if (url.includes("moved")) return new Response("<!doctype html><html><body>Homepage</body></html>", { headers: { "content-type": "text/html" } });
    if (url.includes("gone")) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    return new Response(rssXml(url.endsWith("tech") ? "tech" : "main"));
  }, logs);
  const snapshot = await rss.getNewsSnapshot();
  assert.equal(snapshot.articles.length, 2, "working feeds are unaffected");
  assert.deepEqual(plain(snapshot.feedStatus), { failedFeeds: 2, staleFeeds: 0, issues: [
    { source: "Moved Times", topic: "headlines", state: "unavailable", lastSuccessAt: null },
    { source: "Gone Wire", topic: "headlines", state: "unavailable", lastSuccessAt: null },
  ] });
  const failures = logs.filter((entry) => entry.label === "[rss][feed][unavailable]");
  assert.deepEqual(Object.fromEntries(failures.map((entry) => [entry.source, entry.reason])), { "Moved Times": "not-a-feed", "Gone Wire": "dns" });
  assert.ok(!JSON.stringify(logs).match(/https?:|Homepage|fetch failed/), "no URLs, bodies or raw error text in feed logs");
});

test("a failed refresh keeps last good stories and reports them as stale with their success time", async () => {
  let failTech = false;
  const rss = loadRss(async (url) => {
    if (failTech && url.endsWith("tech")) return new Response("Busy", { status: 503 });
    const id = url.includes("moved") ? "m" : url.includes("gone") ? "g" : url.endsWith("tech") ? "tech" : "main";
    return new Response(rssXml(id));
  });
  const healthy = await rss.getNewsSnapshot();
  assert.deepEqual(plain(healthy.feedStatus), { failedFeeds: 0, staleFeeds: 0, issues: [] });
  failTech = true;
  const before = Date.now();
  const snapshot = await rss.getNewsSnapshot({ fresh: true });
  assert.equal(snapshot.articles.length, 4, "the cached technology story is still served (identity and dedupe unchanged)");
  const [issue] = plain(snapshot.feedStatus.issues);
  assert.deepEqual({ ...issue, lastSuccessAt: undefined }, { source: "Working Daily", topic: "technology", state: "stale", lastSuccessAt: undefined });
  assert.ok(Date.parse(issue.lastSuccessAt) <= before, "lastSuccessAt is the earlier successful load");
  assert.deepEqual([snapshot.feedStatus.failedFeeds, snapshot.feedStatus.staleFeeds], [1, 1], "count semantics unchanged for Ask Kicker coverage");
});

test("feed-health copy is calm, accurate and groups topics by publisher", () => {
  assert.equal(summarizeFeedHealth(null), null);
  assert.equal(summarizeFeedHealth({ failedFeeds: 0, staleFeeds: 0, issues: [] }), null);

  const unavailable = summarizeFeedHealth({ failedFeeds: 3, staleFeeds: 0, issues: [
    { source: "Gone Wire", topic: "headlines", state: "unavailable", lastSuccessAt: null },
    { source: "Gone Wire", topic: "technology", state: "unavailable", lastSuccessAt: null },
    { source: "Moved Times", topic: "headlines", state: "unavailable", lastSuccessAt: null },
  ] });
  assert.equal(unavailable.tone, "unavailable");
  assert.equal(unavailable.headline, "2 sources are temporarily unavailable");
  assert.match(unavailable.detail, /latest from all other sources/);
  assert.deepEqual(unavailable.rows.map((row) => [row.source, row.topics.map((topic) => topic.label)]), [["Gone Wire", ["Top stories", "Technology"]], ["Moved Times", ["Top stories"]]]);

  const stale = summarizeFeedHealth({ failedFeeds: 1, staleFeeds: 1, issues: [{ source: "BBC News", topic: "science", state: "stale", lastSuccessAt: "2026-11-15T01:00:00.000Z" }] });
  assert.equal(stale.tone, "stale");
  assert.equal(stale.headline, "1 source hasn't refreshed recently");
  assert.match(stale.detail, /latest stories are still shown/);
  assert.equal(stale.rows[0].topics[0].label, "Science & Space");

  const mixed = summarizeFeedHealth({ failedFeeds: 2, staleFeeds: 1, issues: [
    { source: "A", topic: "headlines", state: "unavailable", lastSuccessAt: null },
    { source: "B", topic: "headlines", state: "stale", lastSuccessAt: null },
  ] });
  assert.equal(mixed.tone, "mixed");
  assert.match(mixed.detail, /latest available news/);

  // Older payloads without names still get an honest count, never "site down".
  const countsOnly = summarizeFeedHealth({ failedFeeds: 4, staleFeeds: 0 });
  assert.equal(countsOnly.headline, "4 feeds are temporarily unavailable");
  assert.deepEqual(countsOnly.rows, []);
  for (const summary of [unavailable, stale, mixed, countsOnly]) assert.doesNotMatch(summary.headline + summary.detail, /site|down|broken|error/i);
});

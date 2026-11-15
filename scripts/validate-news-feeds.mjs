// Explicit network check, kept separate from deterministic unit tests.
// One request per unique feed URL, at most six at a time, same 12 s timeout and
// User-Agent as production. Prints only publisher, topic, failure category,
// redirect flag, item count and newest item date: never bodies or headers.
//   default    topic feeds        --all      every active feed
//   --retired  re-check RETIRED_FEEDS before restoring one (expects failures)
import { RETIRED_FEEDS, RSS_FEEDS } from "../lib/feeds.ts";
import { classifyFeedFailure, parseRssXml } from "../lib/rss.ts";

const retired = process.argv.includes("--retired");
const selected = retired ? RETIRED_FEEDS : process.argv.includes("--all") ? RSS_FEEDS : RSS_FEEDS.filter((feed) => feed.category);
const feeds = selected.filter((feed, index) => selected.findIndex((other) => other.url === feed.url) === index);
let failed = 0;
for (let offset = 0; offset < feeds.length; offset += 6) {
  await Promise.all(feeds.slice(offset, offset + 6).map(async (feed) => {
    const label = `${feed.name} / ${feed.category ?? "headlines"}`;
    let redirected = false;
    try {
      const response = await fetch(feed.url, { cache: "no-store", signal: AbortSignal.timeout(12000), headers: { "User-Agent": "breaking-news-site/0.1 (+https://github.com/)" } });
      redirected = response.redirected;
      if (!response.ok) throw Object.assign(new Error("http"), { code: `http-${response.status}` });
      const body = await response.text();
      const articles = parseRssXml(body, feed);
      if (!articles.length) {
        const html = /html/i.test(response.headers.get("content-type") ?? "") || /^\s*(<!doctype html|<html)/i.test(body.slice(0, 200));
        throw Object.assign(new Error("empty"), { code: html ? "not-a-feed" : "empty-feed" });
      }
      const newest = articles.map((article) => article.publishedAt).filter(Boolean).sort().at(-1) ?? "unknown";
      console.log(`PASS ${label}: ${articles.length} articles, newest ${newest}${redirected ? " (redirected)" : ""}`);
    } catch (error) {
      failed += 1;
      const reason = typeof error?.code === "string" && /^(http-\d+|not-a-feed|empty-feed)$/.test(error.code) ? error.code : classifyFeedFailure(error);
      console.error(`FAIL ${label}: ${reason}${redirected ? " (redirected)" : ""}`);
    }
  }));
}
console.log(`${feeds.length - failed}/${feeds.length} feeds passed${retired ? " (retired feeds are expected to fail)" : ""}`);
process.exitCode = failed && !retired ? 1 : 0;

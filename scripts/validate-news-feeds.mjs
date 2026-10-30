// Explicit network check, kept separate from deterministic unit tests.
import { RSS_FEEDS } from "../lib/feeds.ts";
import { parseRssXml } from "../lib/rss.ts";

const feeds = process.argv.includes("--all") ? RSS_FEEDS : RSS_FEEDS.filter((feed) => feed.category);
let failed = 0;
for (let offset = 0; offset < feeds.length; offset += 6) {
  await Promise.all(feeds.slice(offset, offset + 6).map(async (feed) => {
    try {
      const response = await fetch(feed.url, { signal: AbortSignal.timeout(15000), headers: { "User-Agent": "KickerNews-feed-validation/1.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const articles = parseRssXml(await response.text(), feed);
      if (!articles.length) throw new Error("No parseable articles");
      console.log(`PASS ${feed.name} / ${feed.category ?? "headlines"}: ${articles.length} articles`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL ${feed.name} / ${feed.category ?? "headlines"}: ${error.message}`);
    }
  }));
}
console.log(`${feeds.length - failed}/${feeds.length} feeds passed`);
process.exitCode = failed ? 1 : 0;

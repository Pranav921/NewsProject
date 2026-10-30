import assert from "node:assert/strict";
import test from "node:test";
import { NEWS_CATEGORIES, categoryFromPublisherLabels, filterArticlesByCategory, getArticleCategory, orderNewsletterArticles } from "../lib/news-categories.ts";
import { RSS_FEEDS, filterArticlesByCoverage } from "../lib/feeds.ts";
import { parseRssXml, getAllNewsItems } from "../lib/rss.ts";
import { buildNewsletterEmailHtml, buildNewsletterEmailText } from "../lib/newsletter.ts";
import { getValidatedNewsletterSettings } from "../lib/newsletter-subscription-settings.ts";
import { fromSavedArticleRows, toSavedArticle } from "../lib/saved-articles.ts";
import { deduplicateNewsletterArticles } from "../lib/newsletter-deduplication.ts";
import { selectNewsletterArticlesForUser } from "../lib/personalization.ts";
import { NEWSLETTER_ARTICLE_LIMIT } from "../lib/newsletter.ts";

const now = new Date("2026-10-30T12:00:00Z");
const article = (category, id) => ({ category, title: `Story ${id}`, source: "BBC News", link: `https://example.com/${id}`, summary: null, publishedAt: now.toISOString() });
const feed = { name: "Test", coverage: "both", url: "https://example.com/feed" };
const xml = (metadata = "", id = "one") => `<rss><channel><item><title>Story ${id}</title><link>https://example.com/${id}</link>${metadata}</item></channel></rss>`;

test("every category has a dedicated feed and configured feed URLs are unique HTTPS URLs", () => {
  assert.ok(new Set(RSS_FEEDS.map((entry) => entry.name)).size >= 18);
  assert.equal(new Set(RSS_FEEDS.map((entry) => entry.url)).size, RSS_FEEDS.length);
  for (const entry of RSS_FEEDS) assert.equal(new URL(entry.url).protocol, "https:");
  for (const category of NEWS_CATEGORIES) assert.ok(RSS_FEEDS.some((entry) => entry.category === category.value), category.value);
});

test("RSS and Atom topics use publisher metadata with a safe general fallback", () => {
  assert.equal(parseRssXml(xml('<category><![CDATA[Business]]></category>'), feed)[0].category, "business");
  const atom = '<feed><entry><title>Story</title><link href="https://example.com/atom"/><category term="Technology"/></entry></feed>';
  assert.equal(parseRssXml(atom, feed)[0].category, "technology");
  assert.equal(parseRssXml(xml('<category>Random section</category>'), feed)[0].category, "general");
  assert.equal(parseRssXml(xml('<category>Business</category>'), { ...feed, category: "health" })[0].category, "health");
  assert.equal(parseRssXml(xml('<category>Business</category>'), { ...feed, category: "general" })[0].category, "business");
  assert.equal(categoryFromPublisherLabels(["Climate crisis"]), "environment");
});

test("category filters compose with coverage and handle legacy or invalid categories", () => {
  const articles = [article("technology", "a"), { ...article("business", "b"), source: "CBS News" }, article(undefined, "c")];
  assert.deepEqual(filterArticlesByCategory(articles, "all"), articles);
  assert.deepEqual(filterArticlesByCategory(articles, "general"), [articles[2]]);
  assert.deepEqual(filterArticlesByCategory(filterArticlesByCoverage(articles, "international"), "business"), []);
  assert.equal(getArticleCategory({ category: "invalid" }), "general");
});

test("newsletter sorting is stable, does not mutate input, and preserves every link", () => {
  const articles = [article("technology", "a"), article("business", "b"), article("technology", "c"), article(undefined, "d")];
  const original = [...articles];
  assert.deepEqual(orderNewsletterArticles(articles), original);
  assert.deepEqual(orderNewsletterArticles(articles, "category").map((entry) => entry.link), [articles[1].link, articles[3].link, articles[0].link, articles[2].link]);
  assert.deepEqual(articles, original);
  assert.deepEqual(orderNewsletterArticles([], "category"), []);
});

for (const mode of ["all_missed", "personalized"]) {
  test(`category ordering preserves ${mode} selection, sent-story exclusions, and within-category ranking`, () => {
    const articles = Array.from({ length: NEWSLETTER_ARTICLE_LIMIT + 10 }, (_, index) => ({
      ...article(index % 2 ? "business" : "technology", `pipeline-${index}`),
      publishedAt: new Date(now.getTime() - index * 60_000).toISOString(),
      source: index % 3 ? "BBC News" : "NPR",
    }));
    const sent = new Set([articles[1].link, articles[4].link]);
    const profile = { alertKeywords: [], clickedArticleLinks: ["a", "b", "c", "d", "e"], clickedSources: ["NPR"], preferredSource: "NPR" };
    const selected = selectNewsletterArticlesForUser(articles, profile, now, sent, mode);
    const grouped = orderNewsletterArticles(selected, "category");
    assert.equal(grouped.length, mode === "personalized" ? NEWSLETTER_ARTICLE_LIMIT : articles.length - sent.size);
    assert.deepEqual(new Set(grouped.map((entry) => entry.link)), new Set(selected.map((entry) => entry.link)));
    assert.ok(grouped.every((entry) => !sent.has(entry.link)));
    for (const category of ["technology", "business"]) {
      assert.deepEqual(grouped.filter((entry) => entry.category === category), selected.filter((entry) => entry.category === category));
    }
  });
}

for (const format of ["standard", "compact"]) {
  test(`${format} HTML and text emails group categories and retain unsubscribe, tracking, escaping, and paywall labels`, (t) => {
    const previousBaseUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = "https://example.com";
    t.after(() => { if (previousBaseUrl === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = previousBaseUrl; });
    const articles = [article("technology", "a"), { ...article("business", "b"), source: "The New York Times", title: '<script>alert("x")</script>' }, article("technology", "c")];
    const tracking = { sendLogId: "send-1", subscriptionId: 7, email: "test@example.com" };
    const html = buildNewsletterEmailHtml(articles, now, "https://example.com/unsubscribe", format, tracking, "category");
    const text = buildNewsletterEmailText(articles, "https://example.com/unsubscribe", format, "category");
    assert.ok(html.indexOf('>Business</h2>') < html.indexOf('>Technology</h2>'));
    assert.equal((html.match(/>Technology<\/h2>/g) ?? []).length, 1);
    assert.ok(text.indexOf("Business\n") < text.indexOf("Technology\n"));
    assert.match(html, /Subscription required/);
    assert.match(text, /Subscription required/);
    assert.ok(html.includes("https://example.com/unsubscribe"));
    assert.match(html, /newsletter\/open\?/);
    assert.match(html, /newsletter\/click\?/);
    assert.ok(!html.includes("<script>"));
    assert.ok(html.indexOf("Story a") < html.indexOf("Story c"));
    const defaultHtml = buildNewsletterEmailHtml(articles, now, "https://example.com/unsubscribe", format);
    assert.ok(!defaultHtml.includes('>Technology</h2>'));
    assert.ok(defaultHtml.indexOf("Story a") < defaultHtml.indexOf("&lt;script&gt;"));
  });
}

test("newsletter sort validation supports old requests and rejects malformed values", () => {
  assert.equal(getValidatedNewsletterSettings({ frequency: "daily" }).sortOrder, "default");
  assert.equal(getValidatedNewsletterSettings({ frequency: "weekly", sortOrder: "category" }).sortOrder, "category");
  assert.equal(getValidatedNewsletterSettings({ frequency: "custom", customFrequency: "3", sortOrder: "category" }).sortOrder, "category");
  for (const sortOrder of ["random", 123, {}, ["category"]]) {
    assert.equal(getValidatedNewsletterSettings({ frequency: "daily", sortOrder }).status, 400);
  }
});

test("saved articles preserve categories and old rows fall back to general", () => {
  assert.equal(toSavedArticle(article("business", "a")).category, "business");
  const rows = [{ article_link: "https://example.com/a", title: "A", source: "BBC News", summary: null, published_at: null }];
  assert.equal(fromSavedArticleRows(rows)[0].category, "general");
  assert.equal(fromSavedArticleRows([{ ...rows[0], category: "technology" }])[0].category, "technology");
});

test("cross-source newsletter dedupe retains a topic when a general free article wins", () => {
  const paid = { ...article("technology", "paid"), source: "The New York Times", title: "New chip factory opens in Arizona" };
  const free = { ...article("general", "free"), source: "BBC News", title: paid.title };
  const result = deduplicateNewsletterArticles([paid, free]);
  assert.equal(result.length, 1);
  assert.equal(result[0].link, free.link);
  assert.equal(result[0].category, "technology");
  assert.equal(free.category, "general");
});

test("aggregation keeps topic metadata on duplicate links and survives failed sources", async () => {
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  try {
    console.error = () => {};
    globalThis.fetch = async (url) => {
      if (String(url).includes("/technology/")) return new Response(xml("", "shared"));
      if (url === RSS_FEEDS[0].url) return new Response(xml("", "shared"));
      return new Response("Unavailable", { status: 503 });
    };
    const result = await getAllNewsItems({ fresh: true });
    assert.equal(result.length, 1);
    assert.equal(result[0].link, "https://example.com/shared");
    assert.equal(result[0].category, "technology");
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
  }
});

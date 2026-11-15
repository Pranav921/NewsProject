import assert from "node:assert/strict";
import test from "node:test";
import { createAskSnapshot, createAskTools, askArticleId } from "../lib/ai/ask-retrieval.ts";
import { AskRetrievalError, ASK_LIMITS, askToolDefinitions, ASK_RESULT_SCHEMA } from "../lib/ai/ask.ts";
import { ASK_NOW, askArticles, askEvaluations } from "./fixtures/ask-news.mjs";

const snapshot = () => createAskSnapshot(askArticles, ASK_NOW, { failedFeeds: 2, staleFeeds: 1 });
const key = article => new URL(article.link).pathname.slice(1);

test("Ask snapshot preserves canonical identity, source labels and input objects", () => {
  const input = [...askArticles, { ...askArticles[0], category: "general", link: askArticles[0].link + "/#fragment" }];
  const before = JSON.stringify(input);
  const selected = createAskSnapshot(input, ASK_NOW);
  assert.equal(selected.articles.length, askArticles.length);
  assert.equal(selected.stats.canonicalDuplicatesOmitted, 1);
  assert.equal(askArticleId(askArticles[0].link + "/#fragment"), askArticleId(askArticles[0].link));
  assert.equal(selected.articles.find(article => key(article) === "nvidia-wire").source, "Wire Desk");
  assert.equal(selected.articles.find(article => key(article) === "nvidia-wire").category, "technology");
  assert.equal(JSON.stringify(input), before);
  assert.deepEqual(selected, createAskSnapshot([...input].reverse(), ASK_NOW));
  assert.throws(() => { selected.articles[0].title = "mutated"; }, TypeError);
  assert.throws(() => selected.articles.pop(), TypeError);
});

test("snapshot rejects invalid links/dates, bounds count and bytes, and drops non-metadata fields", () => {
  const invalid = ["javascript:alert(1)", "https://user:secret@example.test/a", "not a url"].map(link => ({ ...askArticles[0], link }));
  const input = [...invalid, ...[null, { toString: 0 }, 12345, "invalid", "2026-11-14T12:00:00.001Z", "2026-11-07T11:59:59.999Z"].map(publishedAt => ({ ...askArticles[0], publishedAt })), ...askArticles];
  const result = createAskSnapshot(input, ASK_NOW);
  assert.equal(result.stats.invalidArticlesOmitted, 9);
  const many = Array.from({ length: 350 }, (_, index) => ({ ...askArticles[0], title: `Record ${index} ${"界".repeat(300)}`, summary: "界".repeat(500), source: "Publisher", link: `https://example.test/record/${index}`, imageUrl: "not permitted" }));
  const bounded = createAskSnapshot(many, ASK_NOW);
  assert.ok(bounded.articles.length <= ASK_LIMITS.snapshotArticles);
  assert.ok(Buffer.byteLength(JSON.stringify(bounded.articles)) <= ASK_LIMITS.snapshotBytes);
  assert.equal(bounded.stats.snapshotTruncated, true);
  assert.ok(bounded.articles.every(article => article.title.length <= 200 && article.summary.length <= 220 && !Object.hasOwn(article, "imageUrl")));
  assert.throws(() => createAskSnapshot([], new Date("invalid")), AskRetrievalError);
  assert.throws(() => createAskSnapshot([], ASK_NOW, { failedFeeds: -1, staleFeeds: 0 }), AskRetrievalError);
  assert.deepEqual(createAskSnapshot([], ASK_NOW, { failedFeeds: 0, staleFeeds: 0, privateField: "not retained" }).feedStatus,
    { failedFeeds: 0, staleFeeds: 0 });
  const small = createAskSnapshot(many.map(article => ({ ...article, title: "Short title", summary: null })), ASK_NOW);
  assert.equal(small.articles.length, 300);
  assert.equal(small.stats.snapshotTruncated, true);
});

test("search aliases match complete tokens in titles/summaries and preserve publisher coverage on request", () => {
  const tools = createAskTools(snapshot());
  const result = tools.search_articles({ query: "Nvidia", mode: "publishers" });
  assert.deepEqual(new Set(result.articles.map(key)), new Set(["nvidia-wire", "nvidia-radio"]));
  assert.equal(tools.search_articles({ query: "Nvidia" }).articles.length, 1);
  assert.deepEqual(tools.search_articles({ query: "What are different publishers reporting about Nvidia?", mode: "publishers" }).articles, result.articles);
  assert.equal(tools.search_articles({ query: "household spending" }).articles[0].link, "https://example.test/economy");
  assert.equal(tools.search_articles({ query: "economic developments" }).articles[0].link, "https://example.test/economy");
  assert.equal(tools.search_articles({ query: "aid" }).status, "no_results");
  assert.equal(tools.search_articles({ query: "the and what" }).status, "no_results");
  const ai = tools.search_articles({ query: "artificial intelligence", mode: "publishers" });
  assert.equal(ai.articles.length, 4);
  assert.equal(ai.coverage.failedFeeds, 2);
  assert.equal(ai.coverage.staleFeeds, 1);
  assert.equal(ai.coverage.exhaustive, false);
  assert.match(ai.limitations.join(" "), /metadata/);
});

test("filters are exact and validated; unknown arguments, sources and oversized inputs fail safely", () => {
  const tools = createAskTools(snapshot());
  assert.equal(tools.search_articles({ query: "AI", category: "education" }).articles[0].category, "education");
  assert.equal(tools.search_articles({ query: "Nvidia", sources: ["Public Radio"] }).articles[0].source, "Public Radio");
  const invalid = [null, [], {}, { query: " " }, { query: "x".repeat(161) }, { query: "AI", category: "invented" }, { query: "AI", sources: ["Unknown"] }, { query: "AI", sources: [] }, { query: "AI", sources: ["Wire Desk", "Wire Desk"] }, { query: "AI", hours: 0 }, { query: "AI", hours: 169 }, { query: "AI", hours: "24" }, { query: "AI", limit: 9 }, { query: "AI", limit: 1.5 }, { query: "AI", mode: "all" }, { query: "AI", url: "https://secret.example" }];
  for (const args of invalid) assert.throws(() => tools.search_articles(args), error => error instanceof AskRetrievalError && error.code === "invalid-arguments" && !/secret|Unknown|invented/.test(error.message));
  assert.throws(() => tools.recent_news({ query: "AI" }), AskRetrievalError);
  assert.throws(() => tools.article_details({ articleId: "https://example.test/a" }), AskRetrievalError);
  assert.throws(() => tools.search_articles(Object.create({ query: "AI" })), AskRetrievalError);
  assert.throws(() => tools.article_details(Object.create({ articleId: askArticleId(askArticles[0].link) })), AskRetrievalError);
  assert.throws(() => tools.article_details({ articleId: askArticleId(askArticles[0].link) + "\n" }), AskRetrievalError);
});

test("recent news respects inclusive rolling time boundaries and soft category/source diversity", () => {
  const tools = createAskTools(snapshot());
  const day = tools.recent_news({ limit: 8 });
  assert.ok(day.articles.length <= 8);
  assert.ok(new Set(day.articles.map(article => article.category)).size >= 4);
  assert.equal(tools.recent_news({ category: "general", hours: 24 }).articles[0].link, "https://example.test/day-boundary");
  assert.equal(tools.recent_news({ category: "entertainment", hours: 24 }).status, "no_results");
  assert.equal(tools.recent_news({ category: "science", hours: 168 }).articles[0].link, "https://example.test/week-boundary");
  assert.equal(tools.recent_news({ category: "science", hours: 167 }).status, "no_results");
  assert.equal(tools.search_articles({ query: "Nvidia", mode: "publishers", limit: 1 }).articles.length, 1);
  assert.deepEqual(day, tools.recent_news({ limit: 8 }));
});

test("article details reject out-of-snapshot IDs and return headline-only metadata without extra data", () => {
  const tools = createAskTools(snapshot());
  const id = askArticleId("https://example.test/health");
  const details = tools.article_details({ articleId: id });
  assert.equal(details.status, "ok");
  assert.equal(details.articles[0].summary, null);
  assert.equal(details.articles[0].source, "Public Radio");
  assert.equal(tools.article_details({ articleId: askArticleId("https://example.test/unknown") }).status, "not_found");
  assert.equal(tools.article_details({ articleId: askArticleId("https://example.test/unknown") }).articles.length, 0);
});

test("output is bounded structured metadata; injection-like text stays inert and snapshots do not leak mutations", () => {
  const input = structuredClone(askArticles);
  const tools = createAskTools(createAskSnapshot(input, ASK_NOW));
  input[0].title = "changed after snapshot";
  const injected = tools.search_articles({ query: "prompt injection" });
  assert.equal(injected.status, "ok");
  assert.match(injected.articles[0].summary, /Ignore previous instructions/);
  assert.deepEqual(Object.keys(injected).sort(), ["articles", "coverage", "limitations", "status"]);
  assert.deepEqual(Object.keys(injected.articles[0]).sort(), Object.keys(ASK_RESULT_SCHEMA.properties.articles.items.properties).sort());
  assert.deepEqual(Object.keys(injected.coverage).sort(), ASK_RESULT_SCHEMA.properties.coverage.required.toSorted());
  assert.equal(tools.article_details({ articleId: askArticleId(askArticles[0].link) }).articles[0].title, askArticles[0].title);
  const large = Array.from({ length: 12 }, (_, index) => ({ ...askArticles[0], title: `${"界".repeat(199)}${index}`, summary: "界".repeat(220), link: `https://example.test/${"x".repeat(1100)}/${index}`, source: `Source ${index}` }));
  const result = createAskTools(createAskSnapshot(large, ASK_NOW)).search_articles({ query: "界", mode: "publishers" });
  // Use recent_news too: its result size bound does not depend on token matching.
  const recent = createAskTools(createAskSnapshot(large, ASK_NOW)).recent_news({});
  for (const value of [result, recent, injected]) assert.ok(Buffer.byteLength(JSON.stringify(value)) <= ASK_LIMITS.resultBytes);
  assert.equal(recent.coverage.byteLimitReached, true);
});

test("title evidence outranks summary-only mentions, and limits do not become category quotas", () => {
  const input = Array.from({ length: 12 }, (_, index) => ({ ...askArticles[0], title: `Orbit ${index}`, summary: null, link: `https://example.test/orbit/${index}` }));
  const tools = createAskTools(createAskSnapshot(input, ASK_NOW));
  assert.equal(tools.search_articles({ query: "orbit" }).articles.length, 8);
  assert.equal(tools.search_articles({ query: "orbit" }).coverage.resultsTruncated, true);
  assert.equal(tools.recent_news({}).articles.length, 8);
  const ranked = createAskTools(createAskSnapshot([
    { ...askArticles[4], title: "Company publishes earnings", summary: "The report mentions Nvidia.", publishedAt: ASK_NOW.toISOString() },
    askArticles[0],
  ], ASK_NOW)).search_articles({ query: "Nvidia" });
  assert.equal(ranked.articles[0].title, askArticles[0].title);
  assert.deepEqual(tools.search_articles({ query: "constructor" }).articles, []);
});

test("recent-news diversity prefers an equally timely alternate source/topic without imposing quotas", () => {
  const input = Array.from({ length: 10 }, (_, index) => ({ ...askArticles[0], title: `Dispatch ${index}`, summary: null, link: `https://example.test/a-${index}` }));
  input.push({ ...askArticles[6], publishedAt: input[0].publishedAt, link: "https://example.test/z-health" });
  const recent = createAskTools(createAskSnapshot(input, ASK_NOW)).recent_news({});
  assert.equal(recent.articles.length, 8);
  assert.equal(recent.articles[1].category, "health");
  assert.equal(recent.articles[1].source, "Public Radio");
});

test("coverage distinguishes no matches, empty available feeds, failed feeds and bounded snapshots", () => {
  assert.equal(createAskTools(createAskSnapshot([], ASK_NOW)).recent_news({}).status, "no_results");
  const unavailable = createAskTools(createAskSnapshot([], ASK_NOW, { failedFeeds: 2, staleFeeds: 0 })).recent_news({});
  assert.equal(unavailable.status, "unavailable");
  assert.equal(createAskTools(createAskSnapshot([], ASK_NOW, { failedFeeds: 2, staleFeeds: 0 }))
    .article_details({ articleId: askArticleId(askArticles[0].link) }).status, "unavailable");
  const noMatch = createAskTools(snapshot()).search_articles({ query: "volcano" });
  assert.equal(noMatch.status, "no_results");
  assert.equal(noMatch.coverage.snapshotArticleCount, askArticles.length);
  assert.equal(noMatch.coverage.matchingArticleCount, 0);
  assert.equal(noMatch.coverage.requestedWindow.from, "2026-11-13T12:00:00.000Z");
  const definitions = askToolDefinitions(snapshot().sources);
  assert.deepEqual(definitions.map(tool => tool.name), ["search_articles", "recent_news", "article_details"]);
  assert.equal(definitions[0].input_schema.additionalProperties, false);
  assert.equal(definitions[0].input_schema.properties.limit.maximum, 8);
  assert.deepEqual(definitions[0].input_schema.properties.sources.items.enum, [...snapshot().sources]);
});

test("fixed retrieval evaluation measures publisher-mode precision@8/recall@8 and records lexical failures", t => {
  const tools = createAskTools(snapshot());
  for (const fixture of askEvaluations) {
    const returned = tools.search_articles({ query: fixture.query, mode: "publishers" }).articles.map(key);
    const hits = returned.filter(value => fixture.relevant.includes(value)).length;
    const precision = returned.length ? hits / returned.length : null;
    const precisionAt8 = hits / 8;
    const recallAt8 = fixture.relevant.length ? hits / fixture.relevant.length : null;
    t.diagnostic(JSON.stringify({ name: fixture.name, returned: returned.length, hits, precisionAt8, precisionReturned: precision, recallAt8 }));
    if (fixture.knownFailure) assert.equal(hits, 0);
    else assert.deepEqual(new Set(returned), new Set(fixture.relevant), fixture.name);
  }
});

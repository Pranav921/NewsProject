import test from "node:test";
import assert from "node:assert/strict";

import {
  filterArticlesByCoverage,
  getFeedCoverage,
} from "../lib/feeds.ts";

test("getFeedCoverage returns configured coverage for known sources", () => {
  assert.equal(getFeedCoverage("CBS News"), "national");
  assert.equal(getFeedCoverage("BBC News"), "international");
  assert.equal(getFeedCoverage("The New York Times"), "both");
});

test("getFeedCoverage falls back safely for unknown sources", () => {
  assert.equal(getFeedCoverage("Unknown Source"), "both");
});

test("filterArticlesByCoverage returns all articles for all-news mode", () => {
  const articles = [
    { source: "CBS News", title: "A" },
    { source: "BBC News", title: "B" },
    { source: "The New York Times", title: "C" },
  ];

  assert.deepEqual(filterArticlesByCoverage(articles, "all"), articles);
});

test("filterArticlesByCoverage keeps national and both articles in national mode", () => {
  const articles = [
    { source: "CBS News", title: "A" },
    { source: "BBC News", title: "B" },
    { source: "The New York Times", title: "C" },
  ];

  assert.deepEqual(filterArticlesByCoverage(articles, "national"), [
    { source: "CBS News", title: "A" },
    { source: "The New York Times", title: "C" },
  ]);
});

test("filterArticlesByCoverage keeps international and both articles in international mode", () => {
  const articles = [
    { source: "CBS News", title: "A" },
    { source: "BBC News", title: "B" },
    { source: "The New York Times", title: "C" },
  ];

  assert.deepEqual(filterArticlesByCoverage(articles, "international"), [
    { source: "BBC News", title: "B" },
    { source: "The New York Times", title: "C" },
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";

import { suggestAlertKeywordForArticle } from "../lib/custom-alerts.ts";

function createArticle({
  source = "Reuters",
  summary = null,
  title,
}) {
  return {
    link: "https://example.com/story",
    publishedAt: "2026-05-04T12:00:00.000Z",
    source,
    summary,
    title,
  };
}

test("met gala stories suggest a broad culture keyword", () => {
  const keyword = suggestAlertKeywordForArticle(
    createArticle({
      summary: "The annual event will spotlight fashion and celebrity culture.",
      title: "What to expect from the 2026 Met Gala",
    }),
  );

  assert.equal(keyword, "culture");
});

test("strait of hormuz shipping stories suggest shipping", () => {
  const keyword = suggestAlertKeywordForArticle(
    createArticle({
      summary: "Shipping firms are weighing risks to cargo routes in the region.",
      title: "Confusion in Strait of Hormuz Leaves Shipping Firms Guessing",
    }),
  );

  assert.equal(keyword, "shipping");
});

test("stories without a strong topic fall back to coverage-level keywords", () => {
  const keyword = suggestAlertKeywordForArticle(
    createArticle({
      source: "BBC News",
      summary: "A general round-up of several events around the world.",
      title: "A busy day across several capitals",
    }),
  );

  assert.equal(keyword, "world news");
});

test("housing stories suggest housing", () => {
  const keyword = suggestAlertKeywordForArticle(
    createArticle({
      summary: "The story focuses on affordable housing and homebuyer pressure.",
      title: "The Return for These Investors Isn’t Money, It’s More Affordable Housing",
    }),
  );

  assert.equal(keyword, "housing");
});

test("music and celebrity stories suggest entertainment", () => {
  const keyword = suggestAlertKeywordForArticle(
    createArticle({
      summary: "The rapper ended the tour after political backlash.",
      title: "Rapper Kid Cudi fires MIA from tour after ‘offensive’ Republican rant",
    }),
  );

  assert.equal(keyword, "entertainment");
});

test("plane and airport incidents suggest aviation", () => {
  const keyword = suggestAlertKeywordForArticle(
    createArticle({
      summary: "Police said the United jet clipped a vehicle near Newark airport.",
      title: "A United jet struck a light pole and a truck near Newark airport, police say",
    }),
  );

  assert.equal(keyword, "aviation");
});

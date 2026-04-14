import assert from "node:assert/strict";
import test from "node:test";

import {
  computeArticleScore,
  rankArticlesForUser,
  selectTopRankedArticlesForUser,
} from "../lib/personalization.ts";

const NOW = new Date("2026-04-14T12:00:00.000Z");

function createArticle({
  link,
  publishedAt,
  source = "Reuters",
  summary = null,
  title,
}) {
  return {
    link,
    publishedAt,
    source,
    summary,
    title,
  };
}

function createProfile(overrides = {}) {
  return {
    alertKeywords: [],
    clickedArticleLinks: [],
    clickedSources: [],
    preferredSource: null,
    ...overrides,
  };
}

test("computeArticleScore boosts preferred sources", () => {
  const preferredArticle = createArticle({
    link: "https://example.com/preferred",
    publishedAt: "2026-04-14T11:45:00.000Z",
    source: "Reuters",
    title: "Markets move higher",
  });
  const otherArticle = createArticle({
    link: "https://example.com/other",
    publishedAt: "2026-04-14T11:45:00.000Z",
    source: "AP",
    title: "Markets move higher",
  });
  const profile = createProfile({ preferredSource: "Reuters" });

  assert.ok(
    computeArticleScore({ article: preferredArticle, now: NOW, profile }) >
      computeArticleScore({ article: otherArticle, now: NOW, profile }),
  );
});

test("computeArticleScore boosts alert keyword matches in title or summary", () => {
  const titleMatch = createArticle({
    link: "https://example.com/title-match",
    publishedAt: "2026-04-14T10:00:00.000Z",
    summary: "General market summary",
    title: "Nvidia announces new chips",
  });
  const summaryMatch = createArticle({
    link: "https://example.com/summary-match",
    publishedAt: "2026-04-14T10:00:00.000Z",
    summary: "Analysts discuss AI demand",
    title: "Chip stocks rise",
  });
  const noMatch = createArticle({
    link: "https://example.com/no-match",
    publishedAt: "2026-04-14T10:00:00.000Z",
    summary: "Macro headlines",
    title: "Chip stocks rise",
  });
  const profile = createProfile({ alertKeywords: ["nvidia", "ai"] });

  assert.ok(
    computeArticleScore({ article: titleMatch, now: NOW, profile }) >
      computeArticleScore({ article: noMatch, now: NOW, profile }),
  );
  assert.ok(
    computeArticleScore({ article: summaryMatch, now: NOW, profile }) >
      computeArticleScore({ article: noMatch, now: NOW, profile }),
  );
});

test("computeArticleScore boosts clicked sources and penalizes already-clicked article links", () => {
  const clickedSourceArticle = createArticle({
    link: "https://example.com/source-boost",
    publishedAt: "2026-04-14T09:00:00.000Z",
    source: "Bloomberg",
    title: "Fed watch",
  });
  const clickedArticle = createArticle({
    link: "https://example.com/already-clicked",
    publishedAt: "2026-04-14T09:00:00.000Z",
    source: "Bloomberg",
    title: "Fed watch",
  });
  const profile = createProfile({
    clickedArticleLinks: ["https://example.com/already-clicked"],
    clickedSources: ["bloomberg"],
  });

  assert.ok(
    computeArticleScore({ article: clickedSourceArticle, now: NOW, profile }) >
      computeArticleScore({ article: clickedArticle, now: NOW, profile }),
  );
});

test("computeArticleScore favors more recent articles when other signals are equal", () => {
  const fresher = createArticle({
    link: "https://example.com/fresh",
    publishedAt: "2026-04-14T11:50:00.000Z",
    title: "Fresh article",
  });
  const older = createArticle({
    link: "https://example.com/older",
    publishedAt: "2026-04-13T13:00:00.000Z",
    title: "Older article",
  });
  const profile = createProfile();

  assert.ok(
    computeArticleScore({ article: fresher, now: NOW, profile }) >
      computeArticleScore({ article: older, now: NOW, profile }),
  );
});

test("rankArticlesForUser sorts highest score first and breaks ties by newer publish time", () => {
  const articles = [
    createArticle({
      link: "https://example.com/older-tie",
      publishedAt: "2026-04-14T08:00:00.000Z",
      source: "AP",
      title: "Tie older",
    }),
    createArticle({
      link: "https://example.com/newer-tie",
      publishedAt: "2026-04-14T11:00:00.000Z",
      source: "AP",
      title: "Tie newer",
    }),
    createArticle({
      link: "https://example.com/preferred",
      publishedAt: "2026-04-14T07:00:00.000Z",
      source: "Reuters",
      title: "Preferred source headline",
    }),
  ];
  const profile = createProfile({ preferredSource: "Reuters" });

  const ranked = rankArticlesForUser(articles, profile, NOW);

  assert.deepEqual(
    ranked.map((article) => article.link),
    [
      "https://example.com/preferred",
      "https://example.com/newer-tie",
      "https://example.com/older-tie",
    ],
  );
});

test("rankArticlesForUser falls back safely with no preferences, no keywords, and no click history", () => {
  const articles = [
    createArticle({
      link: "https://example.com/older",
      publishedAt: "2026-04-14T06:00:00.000Z",
      title: "Older item",
    }),
    createArticle({
      link: "https://example.com/newer",
      publishedAt: "2026-04-14T11:30:00.000Z",
      title: "Newer item",
    }),
  ];

  const ranked = rankArticlesForUser(articles, createProfile(), NOW);

  assert.deepEqual(
    ranked.map((article) => article.link),
    ["https://example.com/newer", "https://example.com/older"],
  );
});

test("selectTopRankedArticlesForUser enforces top N and preserves dedupe exclusions", () => {
  const articles = [
    createArticle({
      link: "https://example.com/already-sent",
      publishedAt: "2026-04-14T11:59:00.000Z",
      source: "Reuters",
      title: "Already sent Reuters item",
    }),
    createArticle({
      link: "https://example.com/preferred-1",
      publishedAt: "2026-04-14T11:30:00.000Z",
      source: "Reuters",
      title: "Preferred one",
    }),
    createArticle({
      link: "https://example.com/preferred-2",
      publishedAt: "2026-04-14T10:30:00.000Z",
      source: "Reuters",
      title: "Preferred two",
    }),
    createArticle({
      link: "https://example.com/keyword",
      publishedAt: "2026-04-14T09:30:00.000Z",
      summary: "AI demand rises",
      source: "AP",
      title: "Semis rally",
    }),
    createArticle({
      link: "https://example.com/fallback",
      publishedAt: "2026-04-14T08:30:00.000Z",
      source: "AP",
      title: "Fallback",
    }),
  ];
  const profile = createProfile({
    alertKeywords: ["ai"],
    preferredSource: "Reuters",
  });

  const selected = selectTopRankedArticlesForUser(
    articles,
    profile,
    NOW,
    new Set(["https://example.com/already-sent"]),
    3,
  );

  assert.deepEqual(
    selected.map((article) => article.link),
    [
      "https://example.com/preferred-1",
      "https://example.com/preferred-2",
      "https://example.com/keyword",
    ],
  );
});

test("selectTopRankedArticlesForUser still returns a valid newsletter set for unchanged users", () => {
  const articles = [
    createArticle({
      link: "https://example.com/a",
      publishedAt: "2026-04-14T11:00:00.000Z",
      title: "Article A",
    }),
    createArticle({
      link: "https://example.com/b",
      publishedAt: "2026-04-14T10:00:00.000Z",
      title: "Article B",
    }),
  ];

  const selected = selectTopRankedArticlesForUser(
    articles,
    createProfile(),
    NOW,
    new Set(),
    12,
  );

  assert.equal(selected.length, 2);
  assert.deepEqual(
    selected.map((article) => article.link),
    ["https://example.com/a", "https://example.com/b"],
  );
});

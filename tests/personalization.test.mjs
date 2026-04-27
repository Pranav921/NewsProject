import assert from "node:assert/strict";
import test from "node:test";

import {
  computeArticleScore,
  PERSONALIZATION_MIN_UNIQUE_CLICKS,
  rankArticlesForUser,
  resolveNewsletterArticleSelection,
  selectNewsletterArticlesForUser,
  selectTopRankedArticlesForUser,
} from "../lib/personalization.ts";
import { getValidatedNewsletterSettings } from "../lib/newsletter-subscription-settings.ts";
import { NEWSLETTER_ARTICLE_LIMIT } from "../lib/newsletter.ts";

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

test("selectNewsletterArticlesForUser caps personalized mode at NEWSLETTER_ARTICLE_LIMIT", () => {
  const articles = Array.from({ length: NEWSLETTER_ARTICLE_LIMIT + 5 }, (_, index) =>
    createArticle({
      link: `https://example.com/personalized-${index}`,
      publishedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
      title: `Article ${index}`,
    }),
  );

  const selected = selectNewsletterArticlesForUser(
    articles,
    createProfile({
      clickedArticleLinks: Array.from(
        { length: PERSONALIZATION_MIN_UNIQUE_CLICKS },
        (_, index) => `https://example.com/clicked-${index}`,
      ),
    }),
    NOW,
    new Set(),
    "personalized",
  );

  assert.equal(selected.length, NEWSLETTER_ARTICLE_LIMIT);
});

test("users with 0 clicks receive all missed articles even if personalized is requested", () => {
  const articles = Array.from({ length: NEWSLETTER_ARTICLE_LIMIT + 5 }, (_, index) =>
    createArticle({
      link: `https://example.com/no-clicks-${index}`,
      publishedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
      title: `Article ${index}`,
    }),
  );

  const result = resolveNewsletterArticleSelection(
    articles,
    createProfile(),
    NOW,
    new Set(),
    "personalized",
  );

  assert.equal(result.effectiveMode, "all_missed");
  assert.equal(result.personalizationReady, false);
  assert.equal(result.uniqueClickedArticleCount, 0);
  assert.equal(result.articles.length, articles.length);
});

test("users with 4 unique clicks still receive all missed articles", () => {
  const articles = Array.from({ length: NEWSLETTER_ARTICLE_LIMIT + 3 }, (_, index) =>
    createArticle({
      link: `https://example.com/four-clicks-${index}`,
      publishedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
      title: `Article ${index}`,
    }),
  );

  const result = resolveNewsletterArticleSelection(
    articles,
    createProfile({
      clickedArticleLinks: [
        "https://example.com/click-1",
        "https://example.com/click-2",
        "https://example.com/click-3",
        "https://example.com/click-4",
      ],
    }),
    NOW,
    new Set(),
    "personalized",
  );

  assert.equal(result.effectiveMode, "all_missed");
  assert.equal(result.personalizationReady, false);
  assert.equal(result.uniqueClickedArticleCount, 4);
  assert.equal(result.articles.length, articles.length);
});

test("users with 5 unique clicks can receive personalized ranking", () => {
  const articles = [
    createArticle({
      link: "https://example.com/reuters-1",
      publishedAt: "2026-04-14T11:55:00.000Z",
      source: "Reuters",
      title: "Reuters one",
    }),
    createArticle({
      link: "https://example.com/ap-1",
      publishedAt: "2026-04-14T11:54:00.000Z",
      source: "AP",
      title: "AP one",
    }),
    createArticle({
      link: "https://example.com/reuters-2",
      publishedAt: "2026-04-14T11:53:00.000Z",
      source: "Reuters",
      title: "Reuters two",
    }),
  ];

  const result = resolveNewsletterArticleSelection(
    articles,
    createProfile({
      clickedArticleLinks: Array.from(
        { length: PERSONALIZATION_MIN_UNIQUE_CLICKS },
        (_, index) => `https://example.com/clicked-${index}`,
      ),
      preferredSource: "Reuters",
    }),
    NOW,
    new Set(),
    "personalized",
  );

  assert.equal(result.effectiveMode, "personalized");
  assert.equal(result.personalizationReady, true);
  assert.equal(result.uniqueClickedArticleCount, 5);
  assert.deepEqual(
    result.articles.map((article) => article.link),
    [
      "https://example.com/reuters-1",
      "https://example.com/reuters-2",
      "https://example.com/ap-1",
    ],
  );
});

test("repeated clicks on the same article count as one unique clicked article", () => {
  const result = resolveNewsletterArticleSelection(
    [createArticle({
      link: "https://example.com/story",
      publishedAt: "2026-04-14T11:55:00.000Z",
      title: "Story",
    })],
    createProfile({
      clickedArticleLinks: [
        "https://example.com/repeat",
        "https://example.com/repeat",
        "https://example.com/repeat",
      ],
    }),
    NOW,
    new Set(),
    "personalized",
  );

  assert.equal(result.uniqueClickedArticleCount, 1);
  assert.equal(result.personalizationReady, false);
  assert.equal(result.effectiveMode, "all_missed");
});

test("personalized mode falls back safely if click history is insufficient", () => {
  const articles = [
    createArticle({
      link: "https://example.com/recent",
      publishedAt: "2026-04-14T11:59:00.000Z",
      title: "Recent",
    }),
    createArticle({
      link: "https://example.com/older",
      publishedAt: "2026-04-14T11:00:00.000Z",
      title: "Older",
    }),
  ];

  const result = resolveNewsletterArticleSelection(
    articles,
    createProfile({
      clickedArticleLinks: [
        "https://example.com/click-1",
        "https://example.com/click-2",
      ],
      preferredSource: "Reuters",
    }),
    NOW,
    new Set(),
    "personalized",
  );

  assert.equal(result.effectiveMode, "all_missed");
  assert.deepEqual(
    result.articles.map((article) => article.link),
    ["https://example.com/recent", "https://example.com/older"],
  );
});

test("all_missed mode never uses personalization", () => {
  const articles = Array.from({ length: NEWSLETTER_ARTICLE_LIMIT + 5 }, (_, index) =>
    createArticle({
      link: `https://example.com/all-missed-${index}`,
      publishedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
      source: index % 2 === 0 ? "Reuters" : "AP",
      title: `Article ${index}`,
    }),
  );

  const result = resolveNewsletterArticleSelection(
    articles,
    createProfile({
      clickedArticleLinks: Array.from(
        { length: PERSONALIZATION_MIN_UNIQUE_CLICKS + 2 },
        (_, index) => `https://example.com/clicked-${index}`,
      ),
      preferredSource: "AP",
    }),
    NOW,
    new Set(["https://example.com/all-missed-1"]),
    "all_missed",
  );

  assert.equal(result.effectiveMode, "all_missed");
  assert.equal(result.articles.length, articles.length - 1);
  assert.ok(
    !result.articles.some((article) => article.link === "https://example.com/all-missed-1"),
  );
});

test("dedupe still prevents duplicate article sends before personalized fallback logic", () => {
  const articles = [
    createArticle({
      link: "https://example.com/already-sent",
      publishedAt: "2026-04-14T11:59:00.000Z",
      title: "Already sent",
    }),
    createArticle({
      link: "https://example.com/new-story",
      publishedAt: "2026-04-14T11:58:00.000Z",
      title: "New story",
    }),
  ];

  const result = resolveNewsletterArticleSelection(
    articles,
    createProfile(),
    NOW,
    new Set(["https://example.com/already-sent"]),
    "personalized",
  );

  assert.deepEqual(
    result.articles.map((article) => article.link),
    ["https://example.com/new-story"],
  );
});

test("selectNewsletterArticlesForUser defaults missing article_mode to all_missed", () => {
  const articles = Array.from({ length: NEWSLETTER_ARTICLE_LIMIT + 3 }, (_, index) =>
    createArticle({
      link: `https://example.com/default-mode-${index}`,
      publishedAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
      title: `Article ${index}`,
    }),
  );

  const selected = selectNewsletterArticlesForUser(
    articles,
    createProfile({
      clickedArticleLinks: Array.from(
        { length: PERSONALIZATION_MIN_UNIQUE_CLICKS + 1 },
        (_, index) => `https://example.com/clicked-${index}`,
      ),
    }),
    NOW,
    new Set(),
    null,
  );

  assert.equal(selected.length, articles.length);
});

test("getValidatedNewsletterSettings defaults article_mode to all_missed", () => {
  const result = getValidatedNewsletterSettings({
    preferredFrequency: "daily",
  });

  assert.deepEqual(result, {
    articleMode: "all_missed",
    customFrequency: null,
    emailFormat: "standard",
    frequency: "daily",
    status: 200,
  });
});

test("getValidatedNewsletterSettings rejects invalid article_mode values", () => {
  const result = getValidatedNewsletterSettings({
    articleMode: "everything",
    preferredFrequency: "daily",
  });

  assert.deepEqual(result, {
    errorMessage: "Article mode must be personalized or all_missed.",
    status: 400,
  });
});

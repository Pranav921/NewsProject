import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNewsApiPayload,
  shouldBypassNewsCache,
} from "../lib/news-api.ts";

test("/api/news payload keeps the same top-level response shape", () => {
  const articles = [
    {
      link: "https://example.com/story-a",
      publishedAt: "2026-05-03T12:00:00.000Z",
      source: "Example Source",
      summary: "Example summary",
      title: "Example title",
    },
  ];

  assert.deepEqual(buildNewsApiPayload(articles), {
    articles,
  });
});

test("/api/news payload preserves article.link values for new-article detection", () => {
  const articles = [
    {
      link: "https://example.com/story-a",
      publishedAt: null,
      source: "Example Source",
      summary: null,
      title: "Story A",
    },
    {
      link: "https://example.com/story-b",
      publishedAt: null,
      source: "Another Source",
      summary: null,
      title: "Story B",
    },
  ];

  const payload = buildNewsApiPayload(articles);

  assert.deepEqual(
    payload.articles.map((article) => article.link),
    [
      "https://example.com/story-a",
      "https://example.com/story-b",
    ],
  );
});

test("/api/news bypasses the RSS cache for polling and manual refresh checks", () => {
  assert.equal(
    shouldBypassNewsCache(new URLSearchParams("checkForUpdates=1")),
    true,
  );
  assert.equal(
    shouldBypassNewsCache(new URLSearchParams("refresh=1")),
    true,
  );
  assert.equal(
    shouldBypassNewsCache(new URLSearchParams("fresh=1")),
    true,
  );
  assert.equal(
    shouldBypassNewsCache(new URLSearchParams("t=123456")),
    false,
  );
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  getNewArticleLinks,
  normalizeArticleLink,
  resolveCurrentLinks,
} from "../lib/news-updates.ts";

test("first load produces no new-article detection when baseline and latest links match", () => {
  const currentLinks = [
    "https://example.com/story-a",
    "https://example.com/story-b",
  ];

  assert.deepEqual(getNewArticleLinks(currentLinks, currentLinks), []);
});

test("adding one new link produces one detection", () => {
  const previousLinks = [
    "https://example.com/story-a",
    "https://example.com/story-b",
  ];
  const latestLinks = [
    "https://example.com/story-new",
    "https://example.com/story-a",
    "https://example.com/story-b",
  ];

  assert.deepEqual(getNewArticleLinks(previousLinks, latestLinks), [
    "https://example.com/story-new",
  ]);
});

test("filters do not affect detection because comparison uses full link arrays only", () => {
  const fullPreviousLinks = [
    "https://example.com/us-story",
    "https://example.com/world-story",
    "https://example.com/saved-story",
  ];
  const fullLatestLinks = [
    "https://example.com/new-story",
    ...fullPreviousLinks,
  ];
  const filteredVisibleLinks = [
    "https://example.com/us-story",
  ];

  assert.deepEqual(getNewArticleLinks(fullPreviousLinks, fullLatestLinks), [
    "https://example.com/new-story",
  ]);
  assert.notDeepEqual(getNewArticleLinks(filteredVisibleLinks, fullLatestLinks), []);
});

test("duplicate links do not create duplicate notifications", () => {
  const previousLinks = [
    "https://example.com/story-a",
  ];
  const latestLinks = [
    "https://example.com/story-new",
    "https://example.com/story-new/",
    "https://example.com/story-a",
  ];

  assert.deepEqual(getNewArticleLinks(previousLinks, latestLinks), [
    "https://example.com/story-new",
  ]);
});

test("resolveCurrentLinks maps normalized pending links back to current links", () => {
  const currentLinks = [
    "https://example.com/story-a/",
    "https://example.com/story-b",
  ];
  const pendingLinks = [
    "https://example.com/story-a",
  ];

  assert.deepEqual(resolveCurrentLinks(currentLinks, pendingLinks), [
    "https://example.com/story-a/",
  ]);
});

test("normalizeArticleLink remains the canonical identity comparison key", () => {
  assert.equal(
    normalizeArticleLink("https://example.com/story-a/#fragment"),
    "https://example.com/story-a",
  );
});

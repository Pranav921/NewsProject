import assert from "node:assert/strict";
import test from "node:test";

import { getSmartAlertMatch } from "../lib/smart-alerts.ts";

function createArticle({
  summary = null,
  title,
}) {
  return {
    link: "https://example.com/story",
    publishedAt: "2026-04-28T12:00:00.000Z",
    source: "Reuters",
    summary,
    title,
  };
}

test("keyword in title returns important", () => {
  const result = getSmartAlertMatch(
    createArticle({
      summary: "Macro update",
      title: "Nvidia expands AI systems",
    }),
    ["nvidia"],
  );

  assert.deepEqual(result, {
    importance: "important",
    matchedKeywords: ["nvidia"],
    status: "match",
  });
});

test("keyword only in summary returns normal", () => {
  const result = getSmartAlertMatch(
    createArticle({
      summary: "Analysts say bitcoin demand is climbing",
      title: "Markets open higher",
    }),
    ["bitcoin"],
  );

  assert.deepEqual(result, {
    importance: "normal",
    matchedKeywords: ["bitcoin"],
    status: "match",
  });
});

test("urgent headline with no keyword returns no match", () => {
  const result = getSmartAlertMatch(
    createArticle({
      summary: "Global policy update",
      title: "Breaking: Central bank reveals new plan",
    }),
    ["nvidia", "bitcoin"],
  );

  assert.deepEqual(result, {
    importance: null,
    matchedKeywords: [],
    status: "none",
  });
});

test("urgent headline can still upgrade an existing summary keyword match", () => {
  const result = getSmartAlertMatch(
    createArticle({
      summary: "Analysts say bitcoin demand is climbing",
      title: "Breaking: markets react to risk assets",
    }),
    ["bitcoin"],
  );

  assert.deepEqual(result, {
    importance: "important",
    matchedKeywords: ["bitcoin"],
    status: "match",
  });
});

test("empty and whitespace keywords are ignored", () => {
  const result = getSmartAlertMatch(
    createArticle({
      summary: "AI demand grows",
      title: "Chip stocks climb",
    }),
    ["", "   ", "ai"],
  );

  assert.deepEqual(result, {
    importance: "normal",
    matchedKeywords: ["ai"],
    status: "match",
  });
});

test("matching is case-insensitive", () => {
  const result = getSmartAlertMatch(
    createArticle({
      summary: "Cloud demand keeps rising",
      title: "MICROSOFT announces new platform",
    }),
    ["microsoft"],
  );

  assert.deepEqual(result, {
    importance: "important",
    matchedKeywords: ["microsoft"],
    status: "match",
  });
});

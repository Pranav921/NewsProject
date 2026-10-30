import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNewsletterEmailHtml,
  buildNewsletterEmailText,
} from "../lib/newsletter.ts";
import { deduplicateNewsletterArticles } from "../lib/newsletter-deduplication.ts";

const now = new Date("2026-10-30T12:00:00.000Z");

function article({
  link,
  publishedAt = "2026-10-30T11:00:00.000Z",
  source,
  summary = null,
  title,
}) {
  return { link, publishedAt, source, summary, title };
}

test("deduplicates matching cross-source headlines and keeps a free source over NYT", () => {
  const articles = [
    article({
      link: "https://nytimes.com/factory-blast",
      source: "The New York Times",
      summary: "An explosion at a factory injured workers and prompted an evacuation.",
      title: "Explosion at factory injures workers",
    }),
    article({
      link: "https://bbc.com/news/factory-blast",
      source: "BBC News",
      summary: "Workers were injured after a blast at the factory, officials say.",
      title: "Blast at factory injures workers",
    }),
  ];

  assert.deepEqual(deduplicateNewsletterArticles(articles), [articles[1]]);
});

test("deduplicates paraphrased headlines when summaries confirm the same story", () => {
  const articles = [
    article({
      link: "https://example.com/a",
      source: "BBC News",
      summary:
        "Emergency crews responded to an explosion at the Acme manufacturing plant in Ohio, where several workers were hurt.",
      title: "Workers hurt in Ohio plant explosion",
    }),
    article({
      link: "https://example.com/b",
      source: "CNN",
      summary:
        "An industrial plant in Ohio exploded, injuring employees and drawing emergency responders.",
      title: "Blast at Acme facility draws emergency crews",
    }),
  ];

  assert.equal(deduplicateNewsletterArticles(articles).length, 1);
});

test("keeps stories with superficially similar headlines when their details differ", () => {
  const articles = [
    article({
      link: "https://example.com/fire",
      source: "BBC News",
      summary: "A fire at a factory in Ohio forced workers to evacuate.",
      title: "Fire at Ohio factory forces evacuation",
    }),
    article({
      link: "https://example.com/jobs",
      source: "CNN",
      summary: "The company plans to cut 200 jobs at its Ohio factory next year.",
      title: "Ohio factory announces 200 job cuts",
    }),
  ];

  assert.equal(deduplicateNewsletterArticles(articles).length, 2);
});

test("keeps a single article for a story covered by multiple sources", () => {
  const articles = [
    article({
      link: "https://example.com/a",
      source: "BBC News",
      title: "Explosion at factory injures workers",
    }),
    article({
      link: "https://example.com/b",
      source: "CNN",
      title: "Workers injured in factory explosion",
    }),
    article({
      link: "https://example.com/c",
      source: "NPR",
      title: "Factory explosion injures several workers",
    }),
  ];

  assert.equal(deduplicateNewsletterArticles(articles).length, 1);
});

test("marks NYT articles as subscription-required in standard and compact emails", () => {
  const nyTimesArticle = article({
    link: "https://nytimes.com/story",
    source: "The New York Times",
    title: "A New York Times headline",
  });
  const freeArticle = article({
    link: "https://bbc.com/story",
    source: "BBC News",
    title: "A BBC headline",
  });
  const unsubscribeUrl = "https://example.com/unsubscribe";

  for (const format of ["standard", "compact"]) {
    const html = buildNewsletterEmailHtml(
      [nyTimesArticle, freeArticle],
      now,
      unsubscribeUrl,
      format,
    );
    const text = buildNewsletterEmailText(
      [nyTimesArticle, freeArticle],
      unsubscribeUrl,
      format,
    );

    assert.match(html, /Subscription required/);
    assert.match(text, /Subscription required/);
    assert.equal((html.match(/Subscription required/g) ?? []).length, 1);
    assert.equal((text.match(/Subscription required/g) ?? []).length, 1);
  }

  const freeOnlyHtml = buildNewsletterEmailHtml(
    [freeArticle],
    now,
    unsubscribeUrl,
  );
  const freeOnlyText = buildNewsletterEmailText(
    [freeArticle],
    unsubscribeUrl,
  );

  assert.doesNotMatch(freeOnlyHtml, /Subscription required/);
  assert.doesNotMatch(freeOnlyText, /Subscription required/);
});

import type { NewsItem } from "./types.ts";
import { isNewYorkTimesSource } from "./news-presentation.ts";

const STOP_WORDS = new Set([
  "about",
  "after",
  "against",
  "amid",
  "among",
  "and",
  "are",
  "around",
  "as",
  "at",
  "be",
  "been",
  "before",
  "being",
  "between",
  "but",
  "by",
  "can",
  "could",
  "during",
  "for",
  "from",
  "has",
  "have",
  "he",
  "her",
  "his",
  "how",
  "in",
  "into",
  "is",
  "it",
  "its",
  "latest",
  "more",
  "new",
  "of",
  "on",
  "or",
  "over",
  "says",
  "she",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "under",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
]);

const TERM_ALIASES = new Map([
  ["blast", "explosion"],
  ["detonation", "explosion"],
  ["explosions", "explosion"],
  ["exploded", "explosion"],
  ["facility", "factory"],
  ["facilities", "factory"],
  ["hurt", "injure"],
  ["injuries", "injure"],
  ["injured", "injure"],
  ["injuring", "injure"],
  ["injury", "injure"],
  ["employee", "worker"],
  ["employees", "worker"],
  ["plant", "factory"],
]);

type ArticleCandidate = {
  article: NewsItem;
  contentTerms: Set<string>;
  index: number;
  titleTerms: Set<string>;
};

export function deduplicateNewsletterArticles(articles: NewsItem[]): NewsItem[] {
  const parents = articles.map((_, index) => index);
  const candidates: ArticleCandidate[] = articles.map((article, index) => ({
    article,
    index,
    titleTerms: getStoryTerms(article.title),
    contentTerms: getStoryTerms(`${article.title} ${article.summary ?? ""}`),
  }));

  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      if (areDuplicateStories(candidates[left], candidates[right])) {
        union(parents, left, right);
      }
    }
  }

  const bestByGroup = new Map<number, ArticleCandidate>();

  for (const candidate of candidates) {
    const root = find(parents, candidate.index);
    const currentBest = bestByGroup.get(root);

    if (!currentBest || compareArticleQuality(candidate, currentBest) > 0) {
      bestByGroup.set(root, candidate);
    }
  }

  return [...bestByGroup.values()]
    .sort((left, right) => left.index - right.index)
    .map(({ article }) => article);
}

function areDuplicateStories(
  left: ArticleCandidate,
  right: ArticleCandidate,
) {
  if (left.article.link && left.article.link === right.article.link) {
    return true;
  }

  const titleOverlap = getOverlap(left.titleTerms, right.titleTerms);

  if (
    titleOverlap.common >= 2 &&
    titleOverlap.smallerSetRatio >= 0.5 &&
    titleOverlap.dice >= 0.45
  ) {
    return true;
  }

  const contentOverlap = getOverlap(left.contentTerms, right.contentTerms);

  return (
    contentOverlap.common >= 4 &&
    contentOverlap.smallerSetRatio >= 0.6 &&
    contentOverlap.jaccard >= 0.22
  );
}

function getStoryTerms(text: string): Set<string> {
  const normalizedText = text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:manufacturing|industrial|production)\s+plant\b/g, "factory")
    .replace(/\bproduction facility\b/g, "factory");
  const terms = normalizedText.match(/[a-z0-9]+/g) ?? [];

  return new Set(
    terms
      .map(normalizeTerm)
      .filter((term) => term.length >= 3 && !STOP_WORDS.has(term)),
  );
}

function normalizeTerm(term: string) {
  const alias = TERM_ALIASES.get(term);

  if (alias) {
    return alias;
  }

  if (term.length > 5 && term.endsWith("ies")) {
    return `${term.slice(0, -3)}y`;
  }

  if (term.length > 4 && term.endsWith("s") && !term.endsWith("ss")) {
    return term.slice(0, -1);
  }

  return term;
}

function getOverlap(left: Set<string>, right: Set<string>) {
  let common = 0;

  for (const term of left) {
    if (right.has(term)) {
      common += 1;
    }
  }

  const smallerSetSize = Math.min(left.size, right.size);
  const totalSetSize = left.size + right.size - common;

  return {
    common,
    dice: left.size + right.size === 0
      ? 0
      : (2 * common) / (left.size + right.size),
    jaccard: totalSetSize === 0 ? 0 : common / totalSetSize,
    smallerSetRatio: smallerSetSize === 0 ? 0 : common / smallerSetSize,
  };
}

function compareArticleQuality(left: ArticleCandidate, right: ArticleCandidate) {
  const leftIsPaywalled = isNewYorkTimesSource(left.article.source);
  const rightIsPaywalled = isNewYorkTimesSource(right.article.source);

  if (leftIsPaywalled !== rightIsPaywalled) {
    return leftIsPaywalled ? -1 : 1;
  }

  const leftContentScore =
    getStoryTerms(left.article.title).size * 2 +
    Math.min(getStoryTerms(left.article.summary ?? "").size, 30);
  const rightContentScore =
    getStoryTerms(right.article.title).size * 2 +
    Math.min(getStoryTerms(right.article.summary ?? "").size, 30);

  if (leftContentScore !== rightContentScore) {
    return leftContentScore - rightContentScore;
  }

  const leftPublishedAt = Date.parse(left.article.publishedAt ?? "");
  const rightPublishedAt = Date.parse(right.article.publishedAt ?? "");

  if (!Number.isNaN(leftPublishedAt) && !Number.isNaN(rightPublishedAt)) {
    return leftPublishedAt - rightPublishedAt;
  }

  return right.index - left.index;
}

function find(parents: number[], index: number): number {
  if (parents[index] !== index) {
    parents[index] = find(parents, parents[index]);
  }

  return parents[index];
}

function union(parents: number[], left: number, right: number) {
  const leftRoot = find(parents, left);
  const rightRoot = find(parents, right);

  if (leftRoot !== rightRoot) {
    parents[rightRoot] = leftRoot;
  }
}

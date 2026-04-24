import { NEWSLETTER_ARTICLE_LIMIT } from "./newsletter.ts";
import type { NewsItem, NewsletterArticleMode } from "./types.ts";

export type PersonalizationProfile = {
  alertKeywords: string[];
  clickedArticleLinks: string[];
  clickedSources: string[];
  preferredSource: string | null;
};

type ComputeArticleScoreInput = {
  article: NewsItem;
  now: Date;
  profile: PersonalizationProfile;
};

const PREFERRED_SOURCE_BOOST = 40;
const ALERT_KEYWORD_BOOST = 24;
const CLICKED_SOURCE_BOOST = 18;
const CLICKED_ARTICLE_PENALTY = -30;
const MAX_RECENCY_SCORE = 20;
const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function computeArticleScore({
  article,
  now,
  profile,
}: ComputeArticleScoreInput): number {
  let score = 0;
  const normalizedSource = article.source.trim().toLowerCase();
  const normalizedTitle = article.title.trim().toLowerCase();
  const normalizedSummary = article.summary?.trim().toLowerCase() ?? "";

  if (
    profile.preferredSource &&
    normalizedSource === profile.preferredSource.trim().toLowerCase()
  ) {
    score += PREFERRED_SOURCE_BOOST;
  }

  if (profile.clickedSources.some((source) => source === normalizedSource)) {
    score += CLICKED_SOURCE_BOOST;
  }

  if (profile.clickedArticleLinks.some((link) => link === article.link)) {
    score += CLICKED_ARTICLE_PENALTY;
  }

  if (
    profile.alertKeywords.some((keyword) =>
      normalizedTitle.includes(keyword) || normalizedSummary.includes(keyword),
    )
  ) {
    score += ALERT_KEYWORD_BOOST;
  }

  score += computeRecencyScore(article.publishedAt, now);

  return score;
}

export function rankArticlesForUser(
  articles: NewsItem[],
  profile: PersonalizationProfile,
  now: Date,
): NewsItem[] {
  return articles
    .map((article, index) => ({
      article,
      index,
      score: computeArticleScore({
        article,
        now,
        profile,
      }),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const aPublished = Date.parse(a.article.publishedAt ?? "");
      const bPublished = Date.parse(b.article.publishedAt ?? "");

      if (!Number.isNaN(aPublished) && !Number.isNaN(bPublished)) {
        return bPublished - aPublished;
      }

      return a.index - b.index;
    })
    .map((entry) => entry.article);
}

export function selectTopRankedArticlesForUser(
  articles: NewsItem[],
  profile: PersonalizationProfile,
  now: Date,
  sentArticleLinks: Set<string>,
  limit: number,
): NewsItem[] {
  const unsentArticles = articles.filter(
    (article) => !sentArticleLinks.has(article.link),
  );

  return rankArticlesForUser(unsentArticles, profile, now).slice(0, limit);
}

export function selectNewsletterArticlesForUser(
  articles: NewsItem[],
  profile: PersonalizationProfile,
  now: Date,
  sentArticleLinks: Set<string>,
  articleMode: NewsletterArticleMode | null | undefined,
): NewsItem[] {
  const unsentArticles = articles.filter(
    (article) => !sentArticleLinks.has(article.link),
  );

  if (articleMode === "all_missed") {
    // `articles` already arrive newest-first from the newsletter pipeline, so
    // all_missed mode preserves that stable order after dedupe filtering.
    return unsentArticles;
  }

  return rankArticlesForUser(unsentArticles, profile, now).slice(
    0,
    NEWSLETTER_ARTICLE_LIMIT,
  );
}

function computeRecencyScore(publishedAt: string | null, now: Date): number {
  if (!publishedAt) {
    return 0;
  }

  const publishedTimestamp = Date.parse(publishedAt);

  if (Number.isNaN(publishedTimestamp)) {
    return 0;
  }

  const ageMs = now.getTime() - publishedTimestamp;

  if (ageMs <= 0) {
    return MAX_RECENCY_SCORE;
  }

  if (ageMs >= RECENCY_WINDOW_MS) {
    return 0;
  }

  return Math.round((1 - ageMs / RECENCY_WINDOW_MS) * MAX_RECENCY_SCORE);
}

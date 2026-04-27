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

export const PERSONALIZATION_MIN_UNIQUE_CLICKS = 5;

const PREFERRED_SOURCE_BOOST = 40;
const ALERT_KEYWORD_BOOST = 24;
const CLICKED_SOURCE_BOOST = 18;
const CLICKED_ARTICLE_PENALTY = -30;
const MAX_RECENCY_SCORE = 20;
const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PERSONALIZED_SOURCE_SOFT_CAP = 2;

export type NewsletterArticleSelectionResult = {
  articles: NewsItem[];
  effectiveMode: NewsletterArticleMode;
  personalizationReady: boolean;
  uniqueClickedArticleCount: number;
};

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

  return selectDiversifiedRankedArticles(
    rankArticlesForUser(unsentArticles, profile, now),
    limit,
  );
}

export function getPersonalizationReadyState(profile: PersonalizationProfile) {
  // We unlock personalization only after 5 distinct newsletter article clicks
  // so new users are not over-personalized on noisy or accidental behavior.
  const uniqueClickedArticleCount = countUniqueClickedArticleLinks(
    profile.clickedArticleLinks,
  );

  return {
    personalizationReady:
      uniqueClickedArticleCount >= PERSONALIZATION_MIN_UNIQUE_CLICKS,
    uniqueClickedArticleCount,
  };
}

export function resolveNewsletterArticleSelection(
  articles: NewsItem[],
  profile: PersonalizationProfile,
  now: Date,
  sentArticleLinks: Set<string>,
  articleMode: NewsletterArticleMode | null | undefined,
): NewsletterArticleSelectionResult {
  const unsentArticles = articles.filter(
    (article) => !sentArticleLinks.has(article.link),
  );
  const { personalizationReady, uniqueClickedArticleCount } =
    getPersonalizationReadyState(profile);
  const normalizedArticleMode = articleMode ?? "all_missed";

  if (normalizedArticleMode === "all_missed") {
    // `articles` already arrive newest-first from the newsletter pipeline, so
    // all_missed mode preserves that stable order after dedupe filtering.
    return {
      articles: unsentArticles,
      effectiveMode: "all_missed",
      personalizationReady,
      uniqueClickedArticleCount,
    };
  }

  if (!personalizationReady) {
    // Fall back to all_missed until we have enough distinct newsletter clicks
    // to make ranking reflect real interests instead of noise.
    return {
      articles: unsentArticles,
      effectiveMode: "all_missed",
      personalizationReady,
      uniqueClickedArticleCount,
    };
  }

  return {
    articles: selectDiversifiedRankedArticles(
      rankArticlesForUser(unsentArticles, profile, now),
      NEWSLETTER_ARTICLE_LIMIT,
    ),
    effectiveMode: "personalized",
    personalizationReady,
    uniqueClickedArticleCount,
  };
}

export function selectNewsletterArticlesForUser(
  articles: NewsItem[],
  profile: PersonalizationProfile,
  now: Date,
  sentArticleLinks: Set<string>,
  articleMode: NewsletterArticleMode | null | undefined,
): NewsItem[] {
  return resolveNewsletterArticleSelection(
    articles,
    profile,
    now,
    sentArticleLinks,
    articleMode,
  ).articles;
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

function countUniqueClickedArticleLinks(links: string[]) {
  // Repeated clicks on the same article_link should only count once toward the
  // unlock threshold because the goal is breadth of interest, not click volume.
  return new Set(
    links.map((link) => link.trim()).filter(Boolean),
  ).size;
}

function selectDiversifiedRankedArticles(
  rankedArticles: NewsItem[],
  limit: number,
) {
  if (limit <= 0 || rankedArticles.length === 0) {
    return [];
  }

  const selected: NewsItem[] = [];
  const selectedLinks = new Set<string>();
  const sourceCounts = new Map<string, number>();

  for (const article of rankedArticles) {
    if (selected.length >= limit) {
      break;
    }

    const normalizedSource = article.source.trim().toLowerCase();
    const currentCount = sourceCounts.get(normalizedSource) ?? 0;

    if (currentCount >= PERSONALIZED_SOURCE_SOFT_CAP) {
      continue;
    }

    selected.push(article);
    selectedLinks.add(article.link);
    sourceCounts.set(normalizedSource, currentCount + 1);
  }

  if (selected.length >= limit) {
    return selected;
  }

  for (const article of rankedArticles) {
    if (selected.length >= limit) {
      break;
    }

    if (selectedLinks.has(article.link)) {
      continue;
    }

    selected.push(article);
    selectedLinks.add(article.link);
  }

  return selected;
}

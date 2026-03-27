import type { NewsItem, SavedArticle } from "@/lib/types";

export const SAVED_ARTICLES_STORAGE_KEY = "breaking-news-saved-articles";

export function toSavedArticle(article: NewsItem): SavedArticle {
  return {
    title: article.title,
    link: article.link,
    source: article.source,
    summary: article.summary,
    publishedAt: article.publishedAt,
  };
}

export function parseSavedArticles(value: string | null): SavedArticle[] {
  if (!value) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue.filter(isSavedArticle);
  } catch {
    return [];
  }
}

export function updateSavedArticles(
  savedArticles: SavedArticle[],
  article: NewsItem,
): SavedArticle[] {
  const existingArticleIndex = savedArticles.findIndex(
    (savedArticle) => savedArticle.link === article.link,
  );

  if (existingArticleIndex >= 0) {
    return savedArticles.filter((savedArticle) => savedArticle.link !== article.link);
  }

  return [toSavedArticle(article), ...savedArticles];
}

function isSavedArticle(value: unknown): value is SavedArticle {
  if (!value || typeof value !== "object") {
    return false;
  }

  const article = value as Partial<SavedArticle>;

  return (
    typeof article.title === "string" &&
    typeof article.link === "string" &&
    typeof article.source === "string" &&
    (typeof article.summary === "string" || article.summary === null) &&
    (typeof article.publishedAt === "string" || article.publishedAt === null)
  );
}

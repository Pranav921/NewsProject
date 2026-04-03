import type { NewsItem, SavedArticle } from "@/lib/types";

export function toSavedArticle(article: NewsItem): SavedArticle {
  return {
    title: article.title,
    link: article.link,
    source: article.source,
    summary: article.summary,
    publishedAt: article.publishedAt,
  };
}

type SavedArticleRow = {
  article_link: string;
  published_at: string | null;
  source: string | null;
  summary: string | null;
  title: string;
};

export function fromSavedArticleRows(rows: SavedArticleRow[] | null): SavedArticle[] {
  if (!rows) {
    return [];
  }

  return rows.map((row) => ({
    title: row.title,
    link: row.article_link,
    source: row.source ?? "",
    summary: row.summary,
    publishedAt: row.published_at,
  }));
}

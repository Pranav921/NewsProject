import { NewsCard } from "@/components/NewsCard";
import type { NewsItem } from "@/lib/types";

type NewsListProps = {
  articles: NewsItem[];
  emptyStateMessage?: string;
  emptyStateTitle?: string;
  newArticleLinks?: string[];
  onToggleSavedArticle?: (article: NewsItem) => void;
  savedArticleLinks?: string[];
  viewMode?: "standard" | "compact";
};

export function NewsList({
  articles,
  emptyStateMessage = "The RSS parser is ready, but no articles were returned right now. This can happen if a feed is temporarily unavailable while developing locally.",
  emptyStateTitle = "No news yet",
  newArticleLinks = [],
  onToggleSavedArticle,
  savedArticleLinks = [],
  viewMode = "standard",
}: NewsListProps) {
  const newArticleLinkSet = new Set(newArticleLinks);
  const savedArticleLinkSet = new Set(savedArticleLinks);

  if (articles.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
        <h2 className="text-2xl font-semibold text-slate-900">
          {emptyStateTitle}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {emptyStateMessage}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {articles.map((article) => (
        <NewsCard
          key={article.link}
          article={article}
          isNew={newArticleLinkSet.has(article.link)}
          isSaved={savedArticleLinkSet.has(article.link)}
          onToggleSaved={onToggleSavedArticle}
          viewMode={viewMode}
        />
      ))}
    </div>
  );
}

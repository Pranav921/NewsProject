import { NewsCard } from "@/components/NewsCard";
import { InFeedSponsorCard } from "@/components/InFeedSponsorCard";
import { getInFeedSponsor } from "@/lib/sponsors";
import type { SmartAlertImportance } from "@/lib/smart-alerts";
import type { NewsItem } from "@/lib/types";
import type { ReactNode } from "react";

type NewsListProps = {
  alertImportanceByLink?: Record<string, SmartAlertImportance>;
  articles: NewsItem[];
  emptyStateAction?: ReactNode;
  emptyStateMessage?: string;
  emptyStateTitle?: string;
  newArticleLinks?: string[];
  onToggleSavedArticle?: (article: NewsItem) => void;
  savedArticleLinks?: string[];
  showInFeedSponsor?: boolean;
  viewMode?: "standard" | "compact";
};

export function NewsList({
  alertImportanceByLink = {},
  articles,
  emptyStateAction,
  emptyStateMessage = "The RSS parser is ready, but no articles were returned right now. This can happen if a feed is temporarily unavailable while developing locally.",
  emptyStateTitle = "No news yet",
  newArticleLinks = [],
  onToggleSavedArticle,
  savedArticleLinks = [],
  showInFeedSponsor = false,
  viewMode = "standard",
}: NewsListProps) {
  const newArticleLinkSet = new Set(newArticleLinks);
  const savedArticleLinkSet = new Set(savedArticleLinks);
  const sponsor = getInFeedSponsor();
  const shouldShowSponsor =
    showInFeedSponsor && sponsor !== null && articles.length >= 7;

  if (articles.length === 0) {
    return (
      <div className="rounded-[1.8rem] border border-dashed border-slate-300 bg-white p-10 text-center shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          {emptyStateTitle}
        </h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {emptyStateMessage}
        </p>
        {emptyStateAction ? <div className="mt-4">{emptyStateAction}</div> : null}
      </div>
    );
  }

  const cards = articles.flatMap((article, index) => {
    const items = [
      <NewsCard
        alertImportance={alertImportanceByLink[article.link] ?? null}
        key={article.link}
        article={article}
        isNew={newArticleLinkSet.has(article.link)}
        isSaved={savedArticleLinkSet.has(article.link)}
        onToggleSaved={onToggleSavedArticle}
        viewMode={viewMode}
      />,
    ];

    if (shouldShowSponsor && sponsor && index === 5) {
      items.push(
        <InFeedSponsorCard
          key={`sponsor-${sponsor.label}-${index}`}
          sponsor={sponsor}
        />,
      );
    }

    return items;
  });

  return (
    <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      {cards}
    </div>
  );
}

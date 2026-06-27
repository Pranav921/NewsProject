import { LeadStoryCard } from "@/components/LeadStoryCard";
import { NewsCard } from "@/components/NewsCard";
import { getLeadArticle, isBreakingStory } from "@/lib/news-presentation";
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
  onAlertAction?: (article: NewsItem) => void;
  onToggleSavedArticle?: (article: NewsItem) => void;
  savedArticleLinks?: string[];
  saveButtonLabel?: string;
  viewMode?: "standard" | "compact";
};

export function NewsList({
  alertImportanceByLink = {},
  articles,
  emptyStateAction,
  emptyStateMessage = "The RSS parser is ready, but no articles were returned right now. This can happen if a feed is temporarily unavailable while developing locally.",
  emptyStateTitle = "No news yet",
  newArticleLinks = [],
  onAlertAction,
  onToggleSavedArticle,
  savedArticleLinks = [],
  saveButtonLabel = "Save article",
  viewMode = "standard",
}: NewsListProps) {
  const newArticleLinkSet = new Set(newArticleLinks);
  const savedArticleLinkSet = new Set(savedArticleLinks);
  const leadArticle = getLeadArticle(articles);
  const shouldShowMobileHero = Boolean(leadArticle && isBreakingStory(leadArticle));
  const desktopArticles = leadArticle
    ? articles.filter((article) => article.link !== leadArticle.link)
    : articles;
  const mobileArticles =
    shouldShowMobileHero && leadArticle
      ? articles.filter((article) => article.link !== leadArticle.link)
      : articles;

  if (articles.length === 0) {
    return (
      <div className="rounded-[1.8rem] border border-dashed border-[var(--border-strong)] bg-white p-10 text-center shadow-[0_10px_28px_rgba(26,24,20,0.04)]">
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

  const cards = desktopArticles.map((article) => (
      <NewsCard
        alertImportance={alertImportanceByLink[article.link] ?? null}
        key={article.link}
        article={article}
        isNew={newArticleLinkSet.has(article.link)}
        isSaved={savedArticleLinkSet.has(article.link)}
        onAlertAction={onAlertAction}
        onToggleSaved={onToggleSavedArticle}
        saveButtonLabel={saveButtonLabel}
        viewMode={viewMode}
      />
    ));

  const mobileCards = mobileArticles.map((article) => (
    <NewsCard
      alertImportance={alertImportanceByLink[article.link] ?? null}
      key={`mobile-${article.link}`}
      article={article}
      isNew={newArticleLinkSet.has(article.link)}
      isSaved={savedArticleLinkSet.has(article.link)}
      onAlertAction={onAlertAction}
      onToggleSaved={onToggleSavedArticle}
      saveButtonLabel={saveButtonLabel}
      viewMode={viewMode}
    />
  ));
  const desktopGridClassName =
    viewMode === "compact"
      ? "flex flex-col gap-[10px]"
      : "grid gap-[10px] md:grid-cols-2 xl:grid-cols-3";

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:hidden">
        {shouldShowMobileHero && leadArticle ? (
          <LeadStoryCard
            alertImportance={alertImportanceByLink[leadArticle.link] ?? null}
            article={leadArticle}
            isNew={newArticleLinkSet.has(leadArticle.link)}
            isSaved={savedArticleLinkSet.has(leadArticle.link)}
            onAlertAction={onAlertAction}
            onToggleSaved={onToggleSavedArticle}
            saveButtonLabel={saveButtonLabel}
          />
        ) : null}
        {mobileCards}
      </div>

      <div className="hidden space-y-4 md:block">
        {leadArticle ? (
          <LeadStoryCard
            alertImportance={alertImportanceByLink[leadArticle.link] ?? null}
            article={leadArticle}
            isNew={newArticleLinkSet.has(leadArticle.link)}
            isSaved={savedArticleLinkSet.has(leadArticle.link)}
            onAlertAction={onAlertAction}
            onToggleSaved={onToggleSavedArticle}
            saveButtonLabel={saveButtonLabel}
          />
        ) : null}

        <div className={desktopGridClassName}>
          {cards}
        </div>
      </div>
    </div>
  );
}

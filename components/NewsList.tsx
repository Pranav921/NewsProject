"use client";

import { LeadStoryCard } from "@/components/LeadStoryCard";
import { NewsCard } from "@/components/NewsCard";
import { getLeadArticle, isBreakingStory } from "@/lib/news-presentation";
import type { SmartAlertImportance } from "@/lib/smart-alerts";
import type { NewsItem } from "@/lib/types";
import { useState, type ReactNode } from "react";

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
  // All filters/counts still operate on the complete feed. Bound mounted cards
  // instead of hydrating hundreds of hidden mobile/desktop action components.
  const [page, setPage] = useState({ articles, limit: 30 });
  const visibleLimit = page.articles === articles ? page.limit : 30;
  const newArticleLinkSet = new Set(newArticleLinks);
  const savedArticleLinkSet = new Set(savedArticleLinks);
  const leadArticle = getLeadArticle(articles);
  const shouldShowMobileHero = Boolean(leadArticle && isBreakingStory(leadArticle));
  const visibleArticles = (leadArticle ? [leadArticle, ...articles.filter((article) => article.link !== leadArticle.link)] : articles).slice(0, visibleLimit);
  const desktopArticles = leadArticle
    ? visibleArticles.filter((article) => article.link !== leadArticle.link)
    : visibleArticles;
  const mobileArticles =
    shouldShowMobileHero && leadArticle
      ? visibleArticles.filter((article) => article.link !== leadArticle.link)
      : visibleArticles;

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
      {visibleLimit < articles.length ? (
        <div className="flex flex-wrap items-center justify-center gap-3 py-3">
          <p className="text-sm text-text-sub">Showing {visibleArticles.length} of {articles.length} stories</p>
          <button type="button" onClick={() => setPage({ articles, limit: visibleLimit + 30 })}
            className="min-h-11 rounded-xl border border-border-strong bg-surface px-5 py-2 text-sm font-semibold text-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            Show more stories
          </button>
        </div>
      ) : null}
    </div>
  );
}

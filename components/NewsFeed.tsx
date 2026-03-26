"use client";

import { NewsList } from "@/components/NewsList";
import {
  getNewArticleLinks,
  PENDING_NEW_ARTICLE_LINKS_KEY,
  PENDING_PREVIOUS_LINKS_KEY,
} from "@/lib/news-updates";
import type { NewsItem } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

type NewsFeedProps = {
  articles: NewsItem[];
};

type ViewMode = "standard" | "compact";

export function NewsFeed({ articles }: NewsFeedProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState("All Sources");
  const [viewMode, setViewMode] = useState<ViewMode>("standard");
  const currentLinks = useMemo(
    () => articles.map((article) => article.link),
    [articles],
  );
  const sourceOptions = useMemo(
    () => [
      "All Sources",
      ...Array.from(new Set(articles.map((article) => article.source))).sort(),
    ],
    [articles],
  );
  const [newArticleLinks, setNewArticleLinks] = useState<string[]>([]);
  const activeSource = sourceOptions.includes(selectedSource)
    ? selectedSource
    : "All Sources";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const filteredArticles = useMemo(() => {
    return articles.filter((article) => {
      const matchesSource =
        activeSource === "All Sources" || article.source === activeSource;

      if (!matchesSource) {
        return false;
      }

      if (!normalizedSearchQuery) {
        return true;
      }

      const searchableText = [
        article.title,
        article.source,
        article.summary ?? "",
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(normalizedSearchQuery);
    });
  }, [activeSource, articles, normalizedSearchQuery]);

  useEffect(() => {
    const savedPreviousLinks = sessionStorage.getItem(PENDING_PREVIOUS_LINKS_KEY);
    const pendingNewLinks = sessionStorage.getItem(PENDING_NEW_ARTICLE_LINKS_KEY);

    if (!savedPreviousLinks && !pendingNewLinks) {
      setNewArticleLinks([]);
      return;
    }

    try {
      if (pendingNewLinks) {
        const promptDetectedLinks = JSON.parse(pendingNewLinks) as string[];
        const promptDetectedLinkSet = new Set(promptDetectedLinks);

        // When the user refreshes from the prompt, highlight the exact same
        // link set that triggered the notification, in the order they now
        // appear on the refreshed page.
        setNewArticleLinks(
          currentLinks.filter((link) => promptDetectedLinkSet.has(link)),
        );

        return;
      }

      if (!savedPreviousLinks) {
        setNewArticleLinks([]);
        return;
      }

      const previousLinks = JSON.parse(savedPreviousLinks) as string[];

      // Compare the full pre-refresh link list with the full refreshed list so
      // every new article gets highlighted.
      setNewArticleLinks(getNewArticleLinks(previousLinks, currentLinks));
    } catch {
      setNewArticleLinks([]);
    } finally {
      // Only clear the saved links after the full comparison has happened.
      sessionStorage.removeItem(PENDING_PREVIOUS_LINKS_KEY);
      sessionStorage.removeItem(PENDING_NEW_ARTICLE_LINKS_KEY);
    }
  }, [currentLinks]);

  return (
    <div className="space-y-6">
      <div className="flex justify-start">
        <div
          className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm"
          role="group"
          aria-label="Article view mode"
        >
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === "standard"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
            type="button"
            onClick={() => setViewMode("standard")}
            aria-pressed={viewMode === "standard"}
          >
            Standard View
          </button>
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              viewMode === "compact"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
            type="button"
            onClick={() => setViewMode("compact")}
            aria-pressed={viewMode === "compact"}
          >
            Compact View
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="article-search"
          >
            Search articles
          </label>
          <p className="text-sm text-slate-500">
            Search by title, source, or summary.
          </p>

          <input
            id="article-search"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
            type="search"
            placeholder="Search headlines, sources, or summaries"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="source-filter"
          >
            Filter by source
          </label>
          <p className="text-sm text-slate-500">
            Choose a source to narrow the current article list.
          </p>

          <select
            id="source-filter"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
            value={activeSource}
            onChange={(event) => setSelectedSource(event.target.value)}
          >
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>
      </div>

      <NewsList
        articles={filteredArticles}
        newArticleLinks={newArticleLinks}
        viewMode={viewMode}
        emptyStateTitle="No matching articles"
        emptyStateMessage="No articles match the current search or source filter. Try clearing the search box or choosing All Sources."
      />
    </div>
  );
}

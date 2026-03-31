"use client";

import { NewsList } from "@/components/NewsList";
import {
  getNewArticleLinks,
  PENDING_NEW_ARTICLE_LINKS_KEY,
  PENDING_PREVIOUS_LINKS_KEY,
  resolveCurrentLinks,
} from "@/lib/news-updates";
import {
  parseSavedArticles,
  SAVED_ARTICLES_STORAGE_KEY,
  updateSavedArticles,
} from "@/lib/saved-articles";
import type { NewsItem, SavedArticle } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

type NewsFeedProps = {
  articles: NewsItem[];
};

type ViewMode = "standard" | "compact";
type FeedMode = "all" | "saved";
type TimeFilter =
  | "all"
  | "1h"
  | "3h"
  | "6h"
  | "12h"
  | "24h"
  | "1w";

const TIME_FILTER_OPTIONS: Array<{ label: string; value: TimeFilter }> = [
  { label: "All Time", value: "all" },
  { label: "Last Hour", value: "1h" },
  { label: "Last 3 Hours", value: "3h" },
  { label: "Last 6 Hours", value: "6h" },
  { label: "Last 12 Hours", value: "12h" },
  { label: "Last 24 Hours", value: "24h" },
  { label: "Last Week", value: "1w" },
];

const TIME_FILTER_WINDOWS_MS: Record<Exclude<TimeFilter, "all">, number> = {
  "1h": 60 * 60 * 1000,
  "3h": 3 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
};

export function NewsFeed({ articles }: NewsFeedProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSource, setSelectedSource] = useState("All Sources");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("standard");
  const [feedMode, setFeedMode] = useState<FeedMode>("all");
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [hasLoadedSavedArticles, setHasLoadedSavedArticles] = useState(false);
  const currentLinks = useMemo(
    () => articles.map((article) => article.link),
    [articles],
  );
  const [newArticleLinks, setNewArticleLinks] = useState<string[]>([]);
  const savedArticleLinks = useMemo(
    () => savedArticles.map((article) => article.link),
    [savedArticles],
  );
  const baseArticles = feedMode === "saved" ? savedArticles : articles;
  const sourceOptions = useMemo(
    () => [
      "All Sources",
      ...Array.from(new Set(baseArticles.map((article) => article.source))).sort(),
    ],
    [baseArticles],
  );
  const activeSource = sourceOptions.includes(selectedSource)
    ? selectedSource
    : "All Sources";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchedAndSourceFilteredArticles = useMemo(() => {
    return baseArticles.filter((article) => {
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
  }, [activeSource, baseArticles, normalizedSearchQuery]);
  const timeFilteredArticles = useMemo(() => {
    if (timeFilter === "all") {
      return searchedAndSourceFilteredArticles;
    }

    const currentTime = Date.now();
    const timeWindow = TIME_FILTER_WINDOWS_MS[timeFilter];

    return searchedAndSourceFilteredArticles.filter((article) => {
      if (!article.publishedAt) {
        return false;
      }

      const publishedTime = Date.parse(article.publishedAt);

      if (Number.isNaN(publishedTime)) {
        return false;
      }

      return currentTime - publishedTime <= timeWindow;
    });
  }, [searchedAndSourceFilteredArticles, timeFilter]);
  const newArticleLinkSet = useMemo(
    () => new Set(newArticleLinks),
    [newArticleLinks],
  );
  const displayedArticles = useMemo(() => {
    if (!showOnlyNew) {
      return timeFilteredArticles;
    }

    return timeFilteredArticles.filter((article) => newArticleLinkSet.has(article.link));
  }, [timeFilteredArticles, newArticleLinkSet, showOnlyNew]);

  useEffect(() => {
    setSavedArticles(parseSavedArticles(localStorage.getItem(SAVED_ARTICLES_STORAGE_KEY)));
    setHasLoadedSavedArticles(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedArticles) {
      return;
    }

    localStorage.setItem(
      SAVED_ARTICLES_STORAGE_KEY,
      JSON.stringify(savedArticles),
    );
  }, [hasLoadedSavedArticles, savedArticles]);

  useEffect(() => {
    const savedPreviousLinks = sessionStorage.getItem(PENDING_PREVIOUS_LINKS_KEY);
    const pendingNewLinks = sessionStorage.getItem(PENDING_NEW_ARTICLE_LINKS_KEY);

    if (!savedPreviousLinks && !pendingNewLinks) {
      setNewArticleLinks([]);
      return;
    }

    let shouldClearPendingLinks = true;

    try {
      if (pendingNewLinks) {
        const promptDetectedLinks = JSON.parse(pendingNewLinks) as string[];
        const resolvedPromptDetectedLinks = resolveCurrentLinks(
          currentLinks,
          promptDetectedLinks,
        );

        // When the user refreshes from the prompt, highlight the exact same
        // link set that triggered the notification, in the order they now
        // appear on the refreshed page.
        setNewArticleLinks(resolvedPromptDetectedLinks);

        // Only clear the pending handoff once the refreshed page has the full
        // exact set that the prompt detected.
        shouldClearPendingLinks =
          resolvedPromptDetectedLinks.length === promptDetectedLinks.length;

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
      if (shouldClearPendingLinks) {
        sessionStorage.removeItem(PENDING_PREVIOUS_LINKS_KEY);
        sessionStorage.removeItem(PENDING_NEW_ARTICLE_LINKS_KEY);
      }
    }
  }, [currentLinks]);

  useEffect(() => {
    if (newArticleLinks.length === 0 && showOnlyNew) {
      setShowOnlyNew(false);
    }
  }, [newArticleLinks, showOnlyNew]);

  useEffect(() => {
    if (!sourceOptions.includes(selectedSource)) {
      setSelectedSource("All Sources");
    }
  }, [selectedSource, sourceOptions]);

  function handleToggleSavedArticle(article: NewsItem) {
    setSavedArticles((currentSavedArticles) =>
      updateSavedArticles(currentSavedArticles, article),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-center md:justify-between">
        <div className="inline-flex rounded-full border border-slate-200 bg-white p-1 shadow-sm">
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              feedMode === "all"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
            type="button"
            onClick={() => setFeedMode("all")}
            aria-pressed={feedMode === "all"}
          >
            All articles
          </button>
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              feedMode === "saved"
                ? "bg-slate-900 text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
            type="button"
            onClick={() => setFeedMode("saved")}
            aria-pressed={feedMode === "saved"}
          >
            Saved articles
          </button>
        </div>

        <div className="flex items-center gap-3">
          {newArticleLinks.length > 0 ? (
            <button
              className={`inline-flex rounded-full border px-4 py-2 text-sm font-medium shadow-sm transition-colors ${
                showOnlyNew
                  ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              type="button"
              onClick={() => setShowOnlyNew((currentValue) => !currentValue)}
              aria-pressed={showOnlyNew}
            >
              {showOnlyNew ? "Show all articles" : "Only new"}
            </button>
          ) : null}

          <p className="text-sm text-slate-600">
            Saved:
            {" "}
            <span className="font-semibold text-slate-900">
              {savedArticles.length}
            </span>
          </p>

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
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="time-filter"
          >
            Filter by time
          </label>
          <p className="text-sm text-slate-500">
            Limit the list to recently published articles.
          </p>

          <select
            id="time-filter"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
            value={timeFilter}
            onChange={(event) => setTimeFilter(event.target.value as TimeFilter)}
          >
            {TIME_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <NewsList
        articles={displayedArticles}
        newArticleLinks={newArticleLinks}
        onToggleSavedArticle={handleToggleSavedArticle}
        savedArticleLinks={savedArticleLinks}
        viewMode={viewMode}
        emptyStateTitle="No matching articles"
        emptyStateMessage="No articles match the current search, source filter, time filter, selected article view, or new-articles filter. Try clearing the search box or choosing broader filters."
      />
    </div>
  );
}

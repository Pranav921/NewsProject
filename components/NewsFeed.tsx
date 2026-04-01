"use client";

import { NewsList } from "@/components/NewsList";
import {
  addAlertKeyword,
  CUSTOM_ALERT_KEYWORDS_STORAGE_KEY,
  parseAlertKeywords,
  removeAlertKeyword,
} from "@/lib/custom-alerts";
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
import {
  getSmartAlertMatch,
  type SmartAlertImportance,
} from "@/lib/smart-alerts";
import type { NewsItem, SavedArticle } from "@/lib/types";
import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type NewsFeedProps = {
  articles: NewsItem[];
};

type ViewMode = "standard" | "compact";
type FeedMode = "all" | "saved";
type AlertMatchView = "off" | "all" | "important" | "normal";
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
  const [alertMatchView, setAlertMatchView] = useState<AlertMatchView>("off");
  const [alertKeywordInput, setAlertKeywordInput] = useState("");
  const [alertKeywords, setAlertKeywords] = useState<string[]>([]);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>([]);
  const [hasLoadedSavedArticles, setHasLoadedSavedArticles] = useState(false);
  const [hasLoadedAlertKeywords, setHasLoadedAlertKeywords] = useState(false);
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
  const smartAlertMatches = useMemo(() => {
    return articles.flatMap((article) => {
      if (!newArticleLinkSet.has(article.link)) {
        return [];
      }

      const smartAlertMatch = getSmartAlertMatch(article, alertKeywords);

      if (smartAlertMatch.status === "none" || !smartAlertMatch.importance) {
        return [];
      }

      return [
        {
          article,
          importance: smartAlertMatch.importance,
          link: article.link,
          matchedKeywords: smartAlertMatch.matchedKeywords,
        },
      ];
    });
  }, [alertKeywords, articles, newArticleLinkSet]);
  const importantAlertMatchCount = useMemo(
    () =>
      smartAlertMatches.filter((match) => match.importance === "important").length,
    [smartAlertMatches],
  );
  const normalAlertMatchCount = useMemo(
    () =>
      smartAlertMatches.filter((match) => match.importance === "normal").length,
    [smartAlertMatches],
  );
  const newAlertMatchLinks = useMemo(() => {
    return smartAlertMatches.map((match) => match.link);
  }, [smartAlertMatches]);
  const newAlertMatchLinkSet = useMemo(
    () => new Set(newAlertMatchLinks),
    [newAlertMatchLinks],
  );
  const filteredAlertMatchLinkSet = useMemo(() => {
    if (alertMatchView === "off" || alertMatchView === "all") {
      return newAlertMatchLinkSet;
    }

    const allowedImportance = alertMatchView as SmartAlertImportance;

    return new Set(
      smartAlertMatches
        .filter((match) => match.importance === allowedImportance)
        .map((match) => match.link),
    );
  }, [alertMatchView, newAlertMatchLinkSet, smartAlertMatches]);
  const newOnlyFilteredArticles = useMemo(() => {
    if (!showOnlyNew) {
      return timeFilteredArticles;
    }

    return timeFilteredArticles.filter((article) => newArticleLinkSet.has(article.link));
  }, [timeFilteredArticles, newArticleLinkSet, showOnlyNew]);
  const displayedArticles = useMemo(() => {
    if (alertMatchView === "off") {
      return newOnlyFilteredArticles;
    }

    return newOnlyFilteredArticles.filter((article) =>
      filteredAlertMatchLinkSet.has(article.link),
    );
  }, [alertMatchView, filteredAlertMatchLinkSet, newOnlyFilteredArticles]);

  useEffect(() => {
    setSavedArticles(parseSavedArticles(localStorage.getItem(SAVED_ARTICLES_STORAGE_KEY)));
    setHasLoadedSavedArticles(true);
  }, []);

  useEffect(() => {
    setAlertKeywords(
      parseAlertKeywords(localStorage.getItem(CUSTOM_ALERT_KEYWORDS_STORAGE_KEY)),
    );
    setHasLoadedAlertKeywords(true);
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
    if (!hasLoadedAlertKeywords) {
      return;
    }

    localStorage.setItem(
      CUSTOM_ALERT_KEYWORDS_STORAGE_KEY,
      JSON.stringify(alertKeywords),
    );
  }, [alertKeywords, hasLoadedAlertKeywords]);

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
    if (newAlertMatchLinks.length === 0 && alertMatchView !== "off") {
      setAlertMatchView("off");
    }
  }, [alertMatchView, newAlertMatchLinks]);

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

  function handleAddAlertKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setAlertKeywords((currentAlertKeywords) =>
      addAlertKeyword(currentAlertKeywords, alertKeywordInput),
    );
    setAlertKeywordInput("");
  }

  function handleRemoveAlertKeyword(keywordToRemove: string) {
    setAlertKeywords((currentAlertKeywords) =>
      removeAlertKeyword(currentAlertKeywords, keywordToRemove),
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

          {newAlertMatchLinks.length > 0 ? (
            <>
              <p className="text-sm text-rose-700">
                <span className="font-semibold">{importantAlertMatchCount}</span>
                {" "}
                important alert {importantAlertMatchCount === 1 ? "match" : "matches"}
              </p>

              <p className="text-sm text-amber-700">
                <span className="font-semibold">{normalAlertMatchCount}</span>
                {" "}
                normal alert {normalAlertMatchCount === 1 ? "match" : "matches"}
              </p>
            </>
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

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="alert-keyword-input"
            >
              Custom alerts
            </label>
            <p className="text-sm text-slate-500">
              Save keywords to flag matching newly highlighted articles by title or
              summary.
            </p>
            <p className="mt-2 text-sm text-slate-500">
              Title matches or urgent titles are marked important. Summary-only
              matches are marked normal.
            </p>
          </div>

          <form
            className="flex w-full flex-col gap-3 sm:flex-row lg:max-w-xl"
            onSubmit={handleAddAlertKeyword}
          >
            <input
              id="alert-keyword-input"
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              type="text"
              placeholder="Add alert keyword"
              value={alertKeywordInput}
              onChange={(event) => setAlertKeywordInput(event.target.value)}
            />
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700"
              type="submit"
            >
              Add keyword
            </button>
          </form>
        </div>

        {alertKeywords.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {alertKeywords.map((keyword) => (
              <span
                key={keyword}
                className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {keyword}
                <button
                  className="font-medium text-rose-700 transition-colors hover:text-rose-900"
                  type="button"
                  onClick={() => handleRemoveAlertKeyword(keyword)}
                  aria-label={`Remove alert keyword ${keyword}`}
                >
                  Remove
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            No alert keywords saved yet.
          </p>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            Smart Alerts are derived from the currently highlighted new articles only.
          </p>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="alert-match-view"
            >
              Alert match view
            </label>
            <select
              id="alert-match-view"
              className="min-h-11 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
              value={alertMatchView}
              onChange={(event) =>
                setAlertMatchView(event.target.value as AlertMatchView)
              }
              disabled={newAlertMatchLinks.length === 0}
            >
              <option value="off">Off</option>
              <option value="all">All alert matches</option>
              <option value="important">Important only</option>
              <option value="normal">Normal only</option>
            </select>
          </div>
        </div>
      </div>

      <NewsList
        articles={displayedArticles}
        newArticleLinks={newArticleLinks}
        onToggleSavedArticle={handleToggleSavedArticle}
        savedArticleLinks={savedArticleLinks}
        viewMode={viewMode}
        emptyStateTitle="No matching articles"
        emptyStateMessage="No articles match the current search, source filter, time filter, selected article view, new-articles filter, or smart-alert filter. Try clearing the search box or choosing broader filters."
      />
    </div>
  );
}

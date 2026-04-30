"use client";

import { NewsList } from "@/components/NewsList";
import { trackEvent } from "@/lib/analytics";
import { CUSTOM_ALERT_KEYWORDS_STORAGE_KEY, parseAlertKeywords } from "@/lib/custom-alerts";
import { filterArticlesByCoverage } from "@/lib/feeds";
import {
  getNewArticleLinks,
  PENDING_NEW_ARTICLE_LINKS_KEY,
  PENDING_PREVIOUS_LINKS_KEY,
  resolveCurrentLinks,
} from "@/lib/news-updates";
import { toSavedArticle } from "@/lib/saved-articles";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getSmartAlertMatch,
  type SmartAlertImportance,
} from "@/lib/smart-alerts";
import type {
  CoverageFilter,
  NewsItem,
  SavedArticle,
  UserPreferences,
} from "@/lib/types";
import {
  DEFAULT_SOURCE_FILTER,
  DEFAULT_TIME_FILTER,
  DEFAULT_VIEW_MODE,
  normalizeUserPreferences,
} from "@/lib/user-preferences";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type NewsFeedProps = {
  articles: NewsItem[];
  authCtaHref?: string;
  authSignupHref?: string;
  feedErrorMessage?: string | null;
  initialAlertKeywords?: string[];
  initialPreferences?: UserPreferences | null;
  initialSavedArticles?: SavedArticle[];
  onSavedArticlesCountChange?: (count: number) => void;
  userId?: string | null;
  viewerMode?: "authenticated" | "public";
};

type ViewMode = "standard" | "compact";
type FeedMode = "all" | "saved";
type AlertMatchView = "off" | "all" | "important" | "normal";
const COVERAGE_FILTER_OPTIONS: Array<{
  label: string;
  value: CoverageFilter;
}> = [
  { label: "All News", value: "all" },
  { label: "U.S. News", value: "national" },
  { label: "World News", value: "international" },
];
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

const EMPTY_ALERT_KEYWORDS: string[] = [];
const EMPTY_SAVED_ARTICLES: SavedArticle[] = [];

export function NewsFeed({
  articles,
  authCtaHref = "#public-auth-panel",
  authSignupHref = "#public-auth-panel",
  feedErrorMessage = null,
  initialAlertKeywords = EMPTY_ALERT_KEYWORDS,
  initialPreferences = null,
  initialSavedArticles = EMPTY_SAVED_ARTICLES,
  onSavedArticlesCountChange,
  userId = null,
  viewerMode = "authenticated",
}: NewsFeedProps) {
  const isPublicViewer = viewerMode === "public";
  const normalizedInitialPreferences = normalizeUserPreferences(initialPreferences);
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [searchQuery, setSearchQuery] = useState("");
  const [coverageFilter, setCoverageFilter] = useState<CoverageFilter>("all");
  const [selectedSource, setSelectedSource] = useState(
    normalizedInitialPreferences.defaultSourceFilter,
  );
  const [timeFilter, setTimeFilter] = useState<TimeFilter>(
    normalizedInitialPreferences.defaultTimeFilter as TimeFilter,
  );
  const [viewMode, setViewMode] = useState<ViewMode>(
    normalizedInitialPreferences.defaultViewMode,
  );
  const [feedMode, setFeedMode] = useState<FeedMode>("all");
  const [showOnlyNew, setShowOnlyNew] = useState(false);
  const [alertMatchView, setAlertMatchView] = useState<AlertMatchView>("off");
  const [alertKeywords, setAlertKeywords] = useState<string[]>(initialAlertKeywords);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>(initialSavedArticles);
  const [isSavingArticle, setIsSavingArticle] = useState(false);
  const [hasLoadedAlertKeywords, setHasLoadedAlertKeywords] = useState(false);
  const [hasMountedPreferences, setHasMountedPreferences] = useState(false);
  const [protectedActionMessage, setProtectedActionMessage] = useState<{
    description: string;
    title: string;
  } | null>(null);
  const currentLinks = useMemo(
    () => articles.map((article) => article.link),
    [articles],
  );
  const [newArticleLinks, setNewArticleLinks] = useState<string[]>([]);
  const savedArticleLinks = useMemo(
    () => savedArticles.map((article) => article.link),
    [savedArticles],
  );
  const effectiveFeedMode = isPublicViewer ? "all" : feedMode;
  const baseArticles = effectiveFeedMode === "saved" ? savedArticles : articles;
  const coverageFilteredArticles = useMemo(
    () => filterArticlesByCoverage(baseArticles, coverageFilter),
    [baseArticles, coverageFilter],
  );
  const sourceOptions = useMemo(
    () => [
      "All Sources",
      ...Array.from(
        new Set(coverageFilteredArticles.map((article) => article.source)),
      ).sort(),
    ],
    [coverageFilteredArticles],
  );
  const activeSource = sourceOptions.includes(selectedSource)
    ? selectedSource
    : "All Sources";
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchedAndSourceFilteredArticles = useMemo(() => {
    return coverageFilteredArticles.filter((article) => {
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
  }, [activeSource, coverageFilteredArticles, normalizedSearchQuery]);
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
  const newAlertMatchLinks = useMemo(
    () => smartAlertMatches.map((match) => match.link),
    [smartAlertMatches],
  );
  const alertImportanceByLink = useMemo(
    () =>
      Object.fromEntries(
        smartAlertMatches.map((match) => [match.link, match.importance]),
      ) as Record<string, SmartAlertImportance>,
    [smartAlertMatches],
  );
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
  const filteredStoryCount = timeFilteredArticles.length;
  const filteredSourceCount = useMemo(
    () => new Set(timeFilteredArticles.map((article) => article.source)).size,
    [timeFilteredArticles],
  );
  const hasActiveFilters =
    normalizedSearchQuery.length > 0 ||
    coverageFilter !== "all" ||
    activeSource !== "All Sources" ||
    timeFilter !== "all" ||
    showOnlyNew ||
    alertMatchView !== "off";
  const hasFeedError = Boolean(feedErrorMessage) && articles.length === 0;

  function promptProtectedAction(feature: string) {
    setProtectedActionMessage({
      description:
        "Create a free account to save stories, set alerts, and personalize your newsletter.",
      title: `Sign in to ${feature}.`,
    });
  }

  function resetFilters() {
    setSearchQuery("");
    setCoverageFilter("all");
    setSelectedSource(DEFAULT_SOURCE_FILTER);
    setTimeFilter(DEFAULT_TIME_FILTER as TimeFilter);
    setShowOnlyNew(false);
    setAlertMatchView("off");
  }

  function getEmptyState() {
    if (hasFeedError) {
      return {
        action: (
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
            type="button"
            onClick={() => window.location.reload()}
          >
            Retry feed
          </button>
        ),
        message:
          feedErrorMessage ??
          "We couldn't load the live feed right now. Please refresh and try again in a moment.",
        title: "Live feed temporarily unavailable",
      };
    }

    if (effectiveFeedMode === "saved" && savedArticles.length === 0) {
      return {
        action: (
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            type="button"
            onClick={() => setFeedMode("all")}
          >
            Browse all articles
          </button>
        ),
        message: "Save stories from the main feed and they will appear here for quick access.",
        title: "No saved articles yet",
      };
    }

    if (alertMatchView !== "off" && displayedArticles.length === 0) {
      return {
        action: (
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            type="button"
            onClick={() => setAlertMatchView("off")}
          >
            Show all articles
          </button>
        ),
        message:
          "New articles matching your saved keywords will appear here as they are highlighted.",
        title: "No alert matches right now",
      };
    }

    if (hasActiveFilters || normalizedSearchQuery.length > 0) {
      return {
        action: (
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            type="button"
            onClick={resetFilters}
          >
            Clear filters
          </button>
        ),
        message:
          "Try clearing the search, broadening the source or time window, or switching back to all articles.",
        title: "No articles match these filters",
      };
    }

    return {
      action: (
        <button
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          type="button"
          onClick={() => window.location.reload()}
        >
          Refresh feed
        </button>
      ),
      message:
        "The live feed is temporarily empty. Please refresh in a moment to check again.",
      title: "No articles available right now",
    };
  }

  const emptyState = getEmptyState();

  useEffect(() => {
    if (isPublicViewer) {
      setAlertKeywords((currentKeywords) =>
        currentKeywords.length === 0 ? currentKeywords : [],
      );
      setHasLoadedAlertKeywords(true);
      return;
    }

    if (userId) {
      setAlertKeywords(initialAlertKeywords);
      setHasLoadedAlertKeywords(true);
      return;
    }

    setAlertKeywords(
      parseAlertKeywords(localStorage.getItem(CUSTOM_ALERT_KEYWORDS_STORAGE_KEY)),
    );
    setHasLoadedAlertKeywords(true);
  }, [initialAlertKeywords, isPublicViewer, userId]);

  useEffect(() => {
    setSavedArticles(initialSavedArticles);
  }, [initialSavedArticles]);

  useEffect(() => {
    if (isPublicViewer && feedMode !== "all") {
      setFeedMode("all");
    }
  }, [feedMode, isPublicViewer]);

  useEffect(() => {
    onSavedArticlesCountChange?.(savedArticles.length);
  }, [onSavedArticlesCountChange, savedArticles.length]);

  useEffect(() => {
    setHasMountedPreferences(true);
  }, []);

  useEffect(() => {
    if (isPublicViewer || !hasLoadedAlertKeywords || userId) {
      return;
    }

    localStorage.setItem(
      CUSTOM_ALERT_KEYWORDS_STORAGE_KEY,
      JSON.stringify(alertKeywords),
    );
  }, [alertKeywords, hasLoadedAlertKeywords, isPublicViewer, userId]);

  useEffect(() => {
    if (!userId || !hasMountedPreferences) {
      return;
    }

    const currentPreferences = {
      default_source_filter: selectedSource || DEFAULT_SOURCE_FILTER,
      default_time_filter: timeFilter || DEFAULT_TIME_FILTER,
      default_view_mode: viewMode || DEFAULT_VIEW_MODE,
      user_id: userId,
    };

    void supabase.from("user_preferences").upsert(currentPreferences);
  }, [
    hasMountedPreferences,
    selectedSource,
    supabase,
    timeFilter,
    userId,
    viewMode,
  ]);

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

        setNewArticleLinks(resolvedPromptDetectedLinks);
        shouldClearPendingLinks =
          resolvedPromptDetectedLinks.length === promptDetectedLinks.length;

        return;
      }

      if (!savedPreviousLinks) {
        setNewArticleLinks([]);
        return;
      }

      const previousLinks = JSON.parse(savedPreviousLinks) as string[];
      setNewArticleLinks(getNewArticleLinks(previousLinks, currentLinks));
    } catch {
      setNewArticleLinks([]);
    } finally {
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
      setSelectedSource(DEFAULT_SOURCE_FILTER);
    }
  }, [selectedSource, sourceOptions]);

  async function handleToggleSavedArticle(article: NewsItem) {
    if (isPublicViewer) {
      promptProtectedAction("save articles");
      return;
    }

    if (!userId || isSavingArticle) {
      return;
    }

    const isAlreadySaved = savedArticles.some(
      (savedArticle) => savedArticle.link === article.link,
    );
    trackEvent("saved_article_click", {
      action: isAlreadySaved ? "unsave" : "save",
      article_link: article.link,
      article_source: article.source,
      article_title: article.title,
    });

    setIsSavingArticle(true);

    if (isAlreadySaved) {
      const previousSavedArticles = savedArticles;

      setSavedArticles((currentSavedArticles) =>
        currentSavedArticles.filter((savedArticle) => savedArticle.link !== article.link),
      );

      const { error } = await supabase
        .from("saved_articles")
        .delete()
        .eq("user_id", userId)
        .eq("article_link", article.link);

      if (error) {
        setSavedArticles(previousSavedArticles);
      }

      setIsSavingArticle(false);
      return;
    }

    const nextSavedArticle = toSavedArticle(article);
    const previousSavedArticles = savedArticles;

    setSavedArticles((currentSavedArticles) => [
      nextSavedArticle,
      ...currentSavedArticles,
    ]);

    const { error } = await supabase.from("saved_articles").upsert(
      {
        article_link: article.link,
        published_at: article.publishedAt,
        source: article.source,
        summary: article.summary,
        title: article.title,
        user_id: userId,
      },
      {
        onConflict: "user_id,article_link",
      },
    );

    if (error) {
      setSavedArticles(previousSavedArticles);
    }

    setIsSavingArticle(false);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.4rem] border border-slate-200 bg-white px-3 py-3 shadow-[0_12px_28px_rgba(15,23,42,0.05)] sm:px-4 sm:py-3.5">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.35fr)_180px_200px_200px]">
            <input
              id="article-search"
              className="min-h-9 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 sm:min-h-10 sm:px-3.5"
              type="search"
              placeholder="Search headlines, sources, or summaries"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />

            <select
              id="coverage-filter"
              className="min-h-9 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 sm:min-h-10 sm:px-3.5"
              value={coverageFilter}
              onChange={(event) =>
                setCoverageFilter(event.target.value as CoverageFilter)
              }
            >
              {COVERAGE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>

            <select
              id="source-filter"
              className="min-h-9 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 sm:min-h-10 sm:px-3.5"
              value={activeSource}
              onChange={(event) => {
                setSelectedSource(event.target.value);
                trackEvent("source_filter_change", {
                  source: event.target.value,
                });
              }}
            >
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>

            <select
              id="time-filter"
              className="min-h-9 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 sm:min-h-10 sm:px-3.5"
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

          <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-3 xl:justify-start xl:gap-5">
              <div className="flex w-full rounded-full border border-slate-200 bg-slate-50 p-0.5 sm:inline-flex sm:w-auto sm:p-1">
                <button
                  className={`flex-1 rounded-full px-3 py-1 text-center text-[13px] font-medium transition-colors sm:flex-none sm:px-3.5 sm:py-1.5 sm:text-sm ${
                    effectiveFeedMode === "all"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() => setFeedMode("all")}
                  aria-pressed={effectiveFeedMode === "all"}
                >
                  All articles
                </button>
                <button
                  className={`flex-1 rounded-full px-3 py-1 text-center text-[13px] font-medium transition-colors sm:flex-none sm:px-3.5 sm:py-1.5 sm:text-sm ${
                    effectiveFeedMode === "saved"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() => {
                    if (isPublicViewer) {
                      promptProtectedAction("use saved articles");
                      return;
                    }

                    setFeedMode("saved");
                  }}
                  aria-pressed={effectiveFeedMode === "saved"}
                >
                  Saved articles
                </button>
              </div>

              <div
                className="flex w-full rounded-full border border-slate-200 bg-slate-50 p-0.5 sm:inline-flex sm:w-auto sm:p-1"
                role="group"
                aria-label="Article view mode"
              >
                <button
                  className={`flex-1 rounded-full px-3 py-1 text-center text-[13px] font-medium transition-colors sm:flex-none sm:px-3.5 sm:py-1.5 sm:text-sm ${
                    viewMode === "standard"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() => setViewMode("standard")}
                  aria-pressed={viewMode === "standard"}
                >
                  Standard
                </button>
                <button
                  className={`flex-1 rounded-full px-3 py-1 text-center text-[13px] font-medium transition-colors sm:flex-none sm:px-3.5 sm:py-1.5 sm:text-sm ${
                    viewMode === "compact"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() => setViewMode("compact")}
                  aria-pressed={viewMode === "compact"}
                >
                  Compact
                </button>
              </div>

              <div className="flex w-full rounded-full border border-slate-200 bg-slate-50 p-0.5 sm:inline-flex sm:w-auto sm:p-1">
                <button
                  className={`flex-1 rounded-full px-3 py-1 text-center text-[13px] font-medium transition-colors sm:flex-none sm:px-3.5 sm:py-1.5 sm:text-sm ${
                    alertMatchView === "off"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() => setAlertMatchView("off")}
                  aria-pressed={alertMatchView === "off"}
                >
                  Alerts off
                </button>
                <button
                  className={`flex-1 rounded-full px-3 py-1 text-center text-[13px] font-medium transition-colors sm:flex-none sm:px-3.5 sm:py-1.5 sm:text-sm ${
                    alertMatchView !== "off"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() => {
                    if (isPublicViewer) {
                      promptProtectedAction("use alert matches");
                      return;
                    }

                    setAlertMatchView(
                      newAlertMatchLinks.length > 0 ? "all" : "off",
                    );
                  }}
                  aria-pressed={alertMatchView !== "off"}
                >
                  Alert matches
                </button>
              </div>

              {isPublicViewer ? (
                <button
                  className="inline-flex w-fit items-center justify-center self-center px-1 py-0.5 text-[13px] font-medium text-slate-600 transition-colors hover:text-slate-900 sm:ml-1 sm:min-h-10 sm:w-auto sm:rounded-full sm:border sm:border-slate-300 sm:bg-white sm:px-3.5 sm:py-1.5 sm:text-sm sm:text-slate-700 sm:hover:bg-slate-100 xl:ml-2"
                  type="button"
                  onClick={() => promptProtectedAction("manage alerts")}
                >
                  Manage alerts
                </button>
              ) : (
                <a
                  className="inline-flex w-fit items-center justify-center self-center px-1 py-0.5 text-[13px] font-medium text-slate-600 transition-colors hover:text-slate-900 sm:ml-1 sm:min-h-10 sm:w-auto sm:rounded-full sm:border sm:border-slate-300 sm:bg-white sm:px-3.5 sm:py-1.5 sm:text-sm sm:text-slate-700 sm:hover:bg-slate-100 xl:ml-2"
                  href="/account#alerts"
                >
                  Manage alerts
                </a>
              )}
            </div>

            <div className="text-center text-xs text-slate-500 sm:text-sm xl:text-left">
              {filteredStoryCount} stories | {filteredSourceCount} sources
              {isPublicViewer ? "" : ` | ${savedArticles.length} saved`}
            </div>
          </div>

          {protectedActionMessage ? (
            <div className="rounded-[1.1rem] border border-sky-200 bg-sky-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">
                {protectedActionMessage.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {protectedActionMessage.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <a
                  className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                  href={authCtaHref}
                  style={{ color: "#ffffff" }}
                >
                  Log in
                </a>
                <a
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  href={authSignupHref}
                >
                  Create account
                </a>
              </div>
            </div>
          ) : null}

          {newArticleLinks.length > 0 || hasActiveFilters ? (
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {newArticleLinks.length > 0 ? (
                <button
                  className={`inline-flex rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    showOnlyNew
                      ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  type="button"
                  onClick={() => setShowOnlyNew((currentValue) => !currentValue)}
                  aria-pressed={showOnlyNew}
                >
                  {showOnlyNew ? "Showing only new" : "Only new"}
                </button>
              ) : null}

              {newAlertMatchLinks.length > 0 ? (
                <>
                  {importantAlertMatchCount > 0 ? (
                    <StatusBadge tone="rose">
                      {importantAlertMatchCount} important {importantAlertMatchCount === 1 ? "match" : "matches"}
                    </StatusBadge>
                  ) : null}
                  {normalAlertMatchCount > 0 ? (
                    <StatusBadge tone="amber">
                      {normalAlertMatchCount} normal {normalAlertMatchCount === 1 ? "match" : "matches"}
                    </StatusBadge>
                  ) : null}
                </>
              ) : null}

              {hasActiveFilters ? (
                <StatusBadge tone="slate">Filters active</StatusBadge>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <NewsList
        alertImportanceByLink={alertImportanceByLink}
        articles={displayedArticles}
        emptyStateAction={emptyState.action}
        newArticleLinks={newArticleLinks}
        onToggleSavedArticle={handleToggleSavedArticle}
        savedArticleLinks={savedArticleLinks}
        saveButtonLabel={isPublicViewer ? "Sign in to save" : "Save article"}
        showInFeedSponsor={effectiveFeedMode === "all" && !hasFeedError}
        viewMode={viewMode}
        emptyStateTitle={emptyState.title}
        emptyStateMessage={emptyState.message}
      />
    </div>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "amber" | "rose" | "slate";
}) {
  const toneClasses =
    tone === "rose"
      ? "border-rose-200 bg-rose-50 text-rose-700"
      : tone === "amber"
        ? "border-amber-200 bg-amber-50 text-amber-700"
        : "border-slate-200 bg-white text-slate-600";

  return (
    <span className={`inline-flex rounded-full border px-3 py-1.5 text-sm font-medium ${toneClasses}`}>
      {children}
    </span>
  );
}

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
import { toSavedArticle } from "@/lib/saved-articles";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import {
  getSmartAlertMatch,
  type SmartAlertImportance,
} from "@/lib/smart-alerts";
import type { NewsItem, SavedArticle, UserPreferences } from "@/lib/types";
import {
  DEFAULT_SOURCE_FILTER,
  DEFAULT_TIME_FILTER,
  DEFAULT_VIEW_MODE,
  normalizeUserPreferences,
} from "@/lib/user-preferences";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type NewsFeedProps = {
  articles: NewsItem[];
  initialAlertKeywords?: string[];
  initialPreferences?: UserPreferences | null;
  initialSavedArticles?: SavedArticle[];
  onSavedArticlesCountChange?: (count: number) => void;
  userId?: string | null;
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

export function NewsFeed({
  articles,
  initialAlertKeywords = [],
  initialPreferences = null,
  initialSavedArticles = [],
  onSavedArticlesCountChange,
  userId = null,
}: NewsFeedProps) {
  const normalizedInitialPreferences = normalizeUserPreferences(initialPreferences);
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [searchQuery, setSearchQuery] = useState("");
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
  const [alertKeywordInput, setAlertKeywordInput] = useState("");
  const [alertKeywords, setAlertKeywords] = useState<string[]>(initialAlertKeywords);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>(initialSavedArticles);
  const [isSavingArticle, setIsSavingArticle] = useState(false);
  const [isSavingAlertKeyword, setIsSavingAlertKeyword] = useState(false);
  const [hasLoadedAlertKeywords, setHasLoadedAlertKeywords] = useState(false);
  const [hasMountedPreferences, setHasMountedPreferences] = useState(false);
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
    activeSource !== "All Sources" ||
    timeFilter !== "all" ||
    showOnlyNew ||
    alertMatchView !== "off";

  useEffect(() => {
    if (userId) {
      setAlertKeywords(initialAlertKeywords);
      setHasLoadedAlertKeywords(true);
      return;
    }

    setAlertKeywords(
      parseAlertKeywords(localStorage.getItem(CUSTOM_ALERT_KEYWORDS_STORAGE_KEY)),
    );
    setHasLoadedAlertKeywords(true);
  }, [initialAlertKeywords, userId]);

  useEffect(() => {
    setSavedArticles(initialSavedArticles);
  }, [initialSavedArticles]);

  useEffect(() => {
    onSavedArticlesCountChange?.(savedArticles.length);
  }, [onSavedArticlesCountChange, savedArticles.length]);

  useEffect(() => {
    setHasMountedPreferences(true);
  }, []);

  useEffect(() => {
    if (!hasLoadedAlertKeywords || userId) {
      return;
    }

    localStorage.setItem(
      CUSTOM_ALERT_KEYWORDS_STORAGE_KEY,
      JSON.stringify(alertKeywords),
    );
  }, [alertKeywords, hasLoadedAlertKeywords, userId]);

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
    if (!userId || isSavingArticle) {
      return;
    }

    const isAlreadySaved = savedArticles.some(
      (savedArticle) => savedArticle.link === article.link,
    );

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

  async function handleAddAlertKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextAlertKeywords = addAlertKeyword(alertKeywords, alertKeywordInput);

    if (nextAlertKeywords === alertKeywords) {
      setAlertKeywordInput("");
      return;
    }

    if (!userId) {
      setAlertKeywords(nextAlertKeywords);
      setAlertKeywordInput("");
      return;
    }

    if (isSavingAlertKeyword) {
      return;
    }

    const keywordToSave = nextAlertKeywords[nextAlertKeywords.length - 1];
    const previousAlertKeywords = alertKeywords;

    setIsSavingAlertKeyword(true);
    setAlertKeywords(nextAlertKeywords);
    setAlertKeywordInput("");

    const { error } = await supabase.from("user_alert_keywords").upsert(
      {
        keyword: keywordToSave,
        user_id: userId,
      },
      {
        onConflict: "user_id,keyword",
      },
    );

    if (error) {
      setAlertKeywords(previousAlertKeywords);
    }

    setIsSavingAlertKeyword(false);
  }

  async function handleRemoveAlertKeyword(keywordToRemove: string) {
    if (!userId) {
      setAlertKeywords((currentAlertKeywords) =>
        removeAlertKeyword(currentAlertKeywords, keywordToRemove),
      );
      return;
    }

    if (isSavingAlertKeyword) {
      return;
    }

    const previousAlertKeywords = alertKeywords;

    setIsSavingAlertKeyword(true);
    setAlertKeywords((currentAlertKeywords) =>
      removeAlertKeyword(currentAlertKeywords, keywordToRemove),
    );

    const { error } = await supabase
      .from("user_alert_keywords")
      .delete()
      .eq("user_id", userId)
      .eq("keyword", keywordToRemove);

    if (error) {
      setAlertKeywords(previousAlertKeywords);
    }

    setIsSavingAlertKeyword(false);
  }

  return (
    <div className="space-y-4">
      <section className="rounded-[1.4rem] border border-slate-200 bg-white px-4 py-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
        <div className="flex flex-col gap-3">
          <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1.5fr)_220px_220px]">
            <input
              id="article-search"
              className="min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              type="search"
              placeholder="Search headlines, sources, or summaries"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />

            <select
              id="source-filter"
              className="min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              value={activeSource}
              onChange={(event) => setSelectedSource(event.target.value)}
            >
              {sourceOptions.map((source) => (
                <option key={source} value={source}>
                  {source}
                </option>
              ))}
            </select>

            <select
              id="time-filter"
              className="min-h-10 w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
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

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-3 xl:gap-5">
              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                <button
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    feedMode === "all"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() => setFeedMode("all")}
                  aria-pressed={feedMode === "all"}
                >
                  All articles
                </button>
                <button
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    feedMode === "saved"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() => setFeedMode("saved")}
                  aria-pressed={feedMode === "saved"}
                >
                  Saved articles
                </button>
              </div>

              <div
                className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1"
                role="group"
                aria-label="Article view mode"
              >
                <button
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
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
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
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

              <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                <button
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
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
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${
                    alertMatchView !== "off"
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-white"
                  }`}
                  type="button"
                  onClick={() =>
                    setAlertMatchView(
                      newAlertMatchLinks.length > 0 ? "all" : "off",
                    )
                  }
                  aria-pressed={alertMatchView !== "off"}
                  disabled={newAlertMatchLinks.length === 0}
                >
                  Alert matches
                </button>
              </div>

              <a
                className="ml-1 inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 xl:ml-2"
                href="#dashboard-alerts"
              >
                Manage alerts
              </a>
            </div>

            <div className="text-sm text-slate-500">
              {filteredStoryCount} stories | {filteredSourceCount} sources | {savedArticles.length} saved
            </div>
          </div>

          {newArticleLinks.length > 0 || hasActiveFilters ? (
            <div className="flex flex-wrap items-center gap-2">
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
        newArticleLinks={newArticleLinks}
        onToggleSavedArticle={handleToggleSavedArticle}
        savedArticleLinks={savedArticleLinks}
        viewMode={viewMode}
        emptyStateTitle="No matching articles"
        emptyStateMessage="No articles match the current search, source filter, time filter, selected article view, new-articles filter, or smart-alert filter. Try clearing the search box or choosing broader filters."
      />

      <section
        id="dashboard-alerts"
        className="rounded-[1.55rem] border border-slate-200 bg-white p-4.5 shadow-[0_14px_36px_rgba(15,23,42,0.05)] scroll-mt-24 sm:p-5"
      >
        <div className="flex flex-col gap-3.5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
              Custom alerts
            </p>
            <h3 className="mt-1.5 text-lg font-semibold text-slate-900">
              Track the topics that matter most
            </h3>
            <p className="mt-1.5 text-sm text-slate-500">
              Save keywords to flag matching newly highlighted articles.
            </p>
            <p className="mt-1.5 text-sm text-slate-500">
              Title matches or urgent language are marked important.
            </p>
          </div>

          <form
            className="flex w-full flex-col gap-2.5 sm:flex-row lg:max-w-xl"
            onSubmit={handleAddAlertKeyword}
          >
            <input
              id="alert-keyword-input"
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              type="text"
              placeholder="Add alert keyword"
              value={alertKeywordInput}
              onChange={(event) => setAlertKeywordInput(event.target.value)}
            />
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
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
                className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-700"
              >
                {keyword}
                <button
                  className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
                  type="button"
                  onClick={() => handleRemoveAlertKeyword(keyword)}
                  disabled={isSavingAlertKeyword}
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

        <div className="mt-4 rounded-[1.1rem] border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-sm text-slate-500">
            Smart alerts only use the currently highlighted new articles.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Normal alert matches are keyword matches found in the article summary and
            appear with a deeper yellow highlight.
          </p>
          <p className="mt-1.5 text-sm text-slate-500">
            Important alert matches happen when the keyword appears in the title or
            the headline uses urgent language, and those articles appear with a light
            red highlight.
          </p>
        </div>
      </section>
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

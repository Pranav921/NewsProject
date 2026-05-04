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
import type { ShellTab } from "@/components/AppShell";
import {
  DEFAULT_SOURCE_FILTER,
  DEFAULT_TIME_FILTER,
  DEFAULT_VIEW_MODE,
  normalizeUserPreferences,
} from "@/lib/user-preferences";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type NewsFeedProps = {
  activeShellTab?: ShellTab;
  articles: NewsItem[];
  authCtaHref?: string;
  authSignupHref?: string;
  feedErrorMessage?: string | null;
  initialAlertKeywords?: string[];
  initialPreferences?: UserPreferences | null;
  initialSavedArticles?: SavedArticle[];
  onSavedArticlesCountChange?: (count: number) => void;
  onShellTabChange?: (tab: ShellTab) => void;
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
  activeShellTab = "feed",
  articles,
  authCtaHref = "#public-auth-panel",
  authSignupHref = "#public-auth-panel",
  feedErrorMessage = null,
  initialAlertKeywords = EMPTY_ALERT_KEYWORDS,
  initialPreferences = null,
  initialSavedArticles = EMPTY_SAVED_ARTICLES,
  onSavedArticlesCountChange,
  onShellTabChange,
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
  const [alertsEnabledOverride, setAlertsEnabledOverride] = useState<boolean | null>(null);
  const [alertKeywords, setAlertKeywords] = useState<string[]>(initialAlertKeywords);
  const [savedArticles, setSavedArticles] = useState<SavedArticle[]>(initialSavedArticles);
  const [isSavingArticle, setIsSavingArticle] = useState(false);
  const [hasLoadedAlertKeywords, setHasLoadedAlertKeywords] = useState(false);
  const [hasMountedPreferences, setHasMountedPreferences] = useState(false);
  const [protectedActionMessage, setProtectedActionMessage] = useState<{
    description: string;
    title: string;
  } | null>(null);
  const hasAlertKeywords = alertKeywords.length > 0;
  const alertsEnabledByDefault = !isPublicViewer && hasAlertKeywords;
  const alertsEnabled = alertsEnabledOverride ?? alertsEnabledByDefault;
  const canEnableAlerts = !isPublicViewer && hasAlertKeywords;
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
    if (!alertsEnabled) {
      return [];
    }

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
  }, [alertKeywords, alertsEnabled, articles, newArticleLinkSet]);
  const importantAlertMatchCount = useMemo(
    () =>
      new Set(
        smartAlertMatches
          .filter((match) => match.importance === "important")
          .map((match) => match.link),
      ).size,
    [smartAlertMatches],
  );
  const importantAlertMatchLinkSet = useMemo(
    () =>
      new Set(
        smartAlertMatches
          .filter((match) => match.importance === "important")
          .map((match) => match.link),
      ),
    [smartAlertMatches],
  );
  const normalAlertMatchCount = useMemo(
    () =>
      new Set(
        smartAlertMatches
          .filter(
            (match) =>
              match.importance === "normal" &&
              !importantAlertMatchLinkSet.has(match.link),
          )
          .map((match) => match.link),
      ).size,
    [importantAlertMatchLinkSet, smartAlertMatches],
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
  const hasSavedArticles = savedArticles.length > 0;

  function promptProtectedAction(feature: string) {
    setProtectedActionMessage({
      description:
        "Create a free account to save stories, set alerts, and personalize your newsletter.",
      title: `Sign in to ${feature}.`,
    });
  }

  function openAlertManagement() {
    window.location.assign("/account#alerts");
  }

  function handleAlertsToggle() {
    if (isPublicViewer) {
      promptProtectedAction("use alerts");
      return;
    }

    if (!hasAlertKeywords) {
      openAlertManagement();
      return;
    }

    if (alertsEnabled) {
      setAlertsEnabledOverride(false);
      setAlertMatchView("off");
      return;
    }

    setAlertsEnabledOverride(true);
  }

  function handleAlertMatchesChip() {
    if (isPublicViewer) {
      promptProtectedAction("use alert matching");
      return;
    }

    if (!hasAlertKeywords) {
      openAlertManagement();
      return;
    }

    if (!alertsEnabled) {
      setAlertsEnabledOverride(true);
      return;
    }

    if (activeShellTab !== "feed" || alertMatchView === "off") {
      onShellTabChange?.("feed");
      setFeedMode("all");
      setAlertMatchView("all");
      return;
    }

    setAlertMatchView("off");
  }

  function resetFilters() {
    setSearchQuery("");
    setCoverageFilter("all");
    setSelectedSource(DEFAULT_SOURCE_FILTER);
    setTimeFilter(DEFAULT_TIME_FILTER as TimeFilter);
    setShowOnlyNew(false);
    setAlertMatchView("off");
  }

  function renderSignedOutTabCta(feature: "saved" | "alerts") {
    const title =
      feature === "saved" ? "Sign in to view saved stories" : "Sign in to manage alerts";
    const message =
      feature === "saved"
        ? "Create a free account to save articles and keep them in one place."
        : "Create a free account to save alert keywords and track matching stories.";

    return (
      <div className="rounded-[1.45rem] border border-[var(--border)] bg-white p-8 text-center shadow-[0_8px_24px_rgba(26,24,20,0.04)]">
        <p className="mono-meta text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent)]">
          {feature === "saved" ? "Saved" : "Alerts"}
        </p>
        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-[var(--foreground)]">
          {title}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-[var(--text-sub)]">
          {message}
        </p>
        <div className="mt-5 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[var(--navy)] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
            href={authCtaHref}
            style={{ color: "#ffffff" }}
          >
            Sign in
          </a>
          <a
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
            href={authSignupHref}
          >
            Create account
          </a>
        </div>
      </div>
    );
  }

  function renderAlertsPanel() {
    if (isPublicViewer) {
      return renderSignedOutTabCta("alerts");
    }

    return (
      <section className="rounded-[1.45rem] border border-[var(--border)] bg-white p-5 shadow-[0_8px_24px_rgba(26,24,20,0.04)] sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mono-meta text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              ACTIVE ALERTS
            </p>
            <h2 className="mt-2 text-[1.4rem] font-semibold tracking-tight text-[var(--foreground)]">
              Your alert keywords
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
              Manage the topics you want Kicker News to watch for in new stories.
            </p>
          </div>

          <a
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2.5 text-sm font-medium text-[var(--accent)] transition-colors hover:bg-[var(--background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
            href="/account#alerts"
          >
            + New alert
          </a>
        </div>

        {hasAlertKeywords ? (
          <div className="mt-5 space-y-3">
            {alertKeywords.map((keyword) => (
              <div
                key={keyword}
                className="flex flex-col gap-3 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="text-lg font-semibold text-[var(--foreground)]">
                    {keyword}
                  </p>
                  <p className="mono-meta mt-1 text-[11px] uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    Keyword alert • Email
                  </p>
                </div>

                <a
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2 text-sm font-medium text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  href="/account#alerts"
                >
                  Edit / manage
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-[10px] border border-dashed border-[var(--border-strong)] bg-[var(--background)] px-6 py-10 text-center">
            <p className="text-base font-medium text-[var(--foreground)]">
              No active alerts yet.
            </p>
            <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
              Add your first keyword alert to track stories that matter to you.
            </p>
          </div>
        )}
      </section>
    );
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
    if (activeShellTab === "feed") {
      setFeedMode("all");
      return;
    }

    if (activeShellTab === "saved") {
      if (isPublicViewer) {
        setFeedMode("all");
        return;
      }

      setFeedMode("saved");
      return;
    }

    if (isPublicViewer) {
      setFeedMode("all");
      return;
    }

    setFeedMode("all");
  }, [activeShellTab, isPublicViewer, onShellTabChange]);

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
    if (isPublicViewer && feedMode !== "all" && activeShellTab === "feed") {
      setFeedMode("all");
    }
  }, [activeShellTab, feedMode, isPublicViewer]);

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
    if (!alertsEnabled && alertMatchView !== "off") {
      setAlertMatchView("off");
    }
  }, [alertMatchView, alertsEnabled]);

  useEffect(() => {
    if (isPublicViewer || !hasAlertKeywords) {
      if (alertMatchView !== "off") {
        setAlertMatchView("off");
      }
      return;
    }
  }, [
    alertMatchView,
    hasAlertKeywords,
    isPublicViewer,
  ]);

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

  function handleAlertAction() {
    if (isPublicViewer) {
      promptProtectedAction("set alerts");
      return;
    }

    window.location.assign("/account#alerts");
  }

  return (
    <div className="space-y-5">
      <section className="border-y border-[var(--border)] bg-white px-3 py-3 shadow-[0_8px_24px_rgba(26,24,20,0.03)] sm:px-4 sm:py-3.5 lg:-mx-7 lg:px-7 xl:-mx-7 xl:px-[28px] xl:py-[10px] 2xl:-mx-8 2xl:px-8">
        <div
          className="flex flex-col gap-3 xl:flex-row xl:items-center xl:gap-[10px] xl:overflow-x-auto xl:overflow-y-hidden xl:whitespace-nowrap [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="search"
          aria-label="News feed filters"
        >
          <div className="xl:w-[260px] xl:flex-none">
            <label className="sr-only" htmlFor="article-search">
              Search articles
            </label>
            <div className="relative">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-[10px] top-1/2 -translate-y-1/2 text-[13px] text-[var(--text-muted)]"
              >
                🔍
              </span>
              <input
                id="article-search"
                className="min-h-10 w-full rounded-[8px] border border-[var(--border)] bg-[#faf9f7] px-3.5 py-2 pl-8 text-sm text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                type="search"
                placeholder="Search headlines, sources..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
          </div>

          <div className="flex items-center gap-2.5 overflow-x-auto pb-1 xl:flex-1 xl:overflow-visible xl:pb-0 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <div className="w-[148px] shrink-0 xl:w-[132px]">
              <label className="sr-only" htmlFor="coverage-filter">
                Filter by coverage
              </label>
              <select
                id="coverage-filter"
                className="min-h-10 w-full rounded-[8px] border border-[var(--border)] bg-[#faf9f7] px-3.5 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
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
            </div>

            <div className="w-[170px] shrink-0 xl:w-[150px]">
              <label className="sr-only" htmlFor="source-filter">
                Filter by source
              </label>
              <select
                id="source-filter"
                className="min-h-10 w-full rounded-[8px] border border-[var(--border)] bg-[#faf9f7] px-3.5 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
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
            </div>

            <div className="w-[148px] shrink-0 xl:w-[138px]">
              <label className="sr-only" htmlFor="time-filter">
                Filter by time
              </label>
              <select
                id="time-filter"
                className="min-h-10 w-full rounded-[8px] border border-[var(--border)] bg-[#faf9f7] px-3.5 py-2 text-sm text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
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

            <div aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-[var(--border)] xl:block" />

            <div
              className="flex rounded-full border border-[var(--border)] bg-[var(--background)] p-0.5"
              role="group"
              aria-label="Article list scope"
            >
              <button
                className={`min-h-9 shrink-0 rounded-full px-3.5 py-1.5 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                  activeShellTab === "feed" && alertMatchView === "off"
                    ? "bg-[var(--foreground)] text-white"
                    : "text-[var(--text-sub)] hover:bg-white hover:text-[var(--foreground)]"
                }`}
                type="button"
                onClick={() => {
                  onShellTabChange?.("feed");
                }}
                aria-pressed={activeShellTab === "feed"}
              >
                All articles
              </button>
              <button
                className={`min-h-9 shrink-0 rounded-full px-3.5 py-1.5 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                  activeShellTab === "saved"
                    ? "bg-[var(--foreground)] text-white"
                    : "text-[var(--text-sub)] hover:bg-white hover:text-[var(--foreground)]"
                }`}
                type="button"
                onClick={() => {
                  onShellTabChange?.("saved");
                }}
                aria-pressed={activeShellTab === "saved"}
              >
                Saved
              </button>
              <button
                className={`min-h-9 shrink-0 rounded-full px-3.5 py-1.5 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                  alertsEnabled && alertMatchView !== "off"
                    ? "bg-[var(--foreground)] text-white"
                    : !canEnableAlerts
                      ? "text-[var(--text-muted)] hover:bg-white hover:text-[var(--text-sub)]"
                      : "text-[var(--text-sub)] hover:bg-white hover:text-[var(--foreground)]"
                }`}
                type="button"
                onClick={handleAlertMatchesChip}
                aria-pressed={alertsEnabled && alertMatchView !== "off"}
              >
                Alert matches
              </button>
            </div>

            <div aria-hidden="true" className="hidden h-5 w-px shrink-0 bg-[var(--border)] xl:block" />

            <div
              className="flex rounded-full border border-[var(--border)] bg-[var(--background)] p-0.5"
              role="group"
              aria-label="Article view mode"
            >
              <button
                className={`min-h-9 shrink-0 rounded-full px-3.5 py-1.5 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                  viewMode === "standard"
                    ? "bg-[var(--foreground)] text-white"
                    : "text-[var(--text-sub)] hover:bg-white hover:text-[var(--foreground)]"
                }`}
                type="button"
                onClick={() => setViewMode("standard")}
                aria-pressed={viewMode === "standard"}
              >
                Standard
              </button>
              <button
                className={`min-h-9 shrink-0 rounded-full px-3.5 py-1.5 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                  viewMode === "compact"
                    ? "bg-[var(--foreground)] text-white"
                    : "text-[var(--text-sub)] hover:bg-white hover:text-[var(--foreground)]"
                }`}
                type="button"
                onClick={() => setViewMode("compact")}
                aria-pressed={viewMode === "compact"}
              >
                Compact
              </button>
            </div>

            <button
              className={`min-h-9 shrink-0 rounded-full border px-3.5 py-1.5 text-center text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                alertsEnabled
                  ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,white)] text-[var(--accent)]"
                  : "border-[var(--border)] bg-transparent text-[var(--text-sub)] hover:bg-white hover:text-[var(--foreground)]"
              }`}
              type="button"
              onClick={handleAlertsToggle}
              aria-pressed={alertsEnabled}
            >
              {alertsEnabled ? "Alerts on" : "Alerts off"}
            </button>

            <div className="mono-meta text-left text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)] xl:ml-auto xl:shrink-0 xl:text-right">
              <span className="block">{filteredStoryCount} stories</span>
              <span className="mt-1 block">{filteredSourceCount} sources</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-3">
          {protectedActionMessage && activeShellTab === "feed" ? (
            <div className="rounded-[1.1rem] border border-sky-200 bg-sky-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">
                {protectedActionMessage.title}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {protectedActionMessage.description}
              </p>
              <div className="mt-3 flex flex-wrap gap-2.5">
                <a
                  className="inline-flex min-h-10 items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                  href={authCtaHref}
                  style={{ color: "#ffffff" }}
                >
                  Log in
                </a>
                <a
                  className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
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
                  className={`inline-flex rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${
                    showOnlyNew
                      ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  type="button"
                  onClick={() => {
                    setShowOnlyNew((currentValue) => !currentValue);
                  }}
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

      {activeShellTab === "alerts" ? (
        renderAlertsPanel()
      ) : activeShellTab === "saved" && isPublicViewer ? (
        renderSignedOutTabCta("saved")
      ) : (
        <NewsList
          alertImportanceByLink={alertImportanceByLink}
          articles={displayedArticles}
          emptyStateAction={emptyState.action}
          newArticleLinks={newArticleLinks}
          onAlertAction={handleAlertAction}
          onToggleSavedArticle={handleToggleSavedArticle}
          savedArticleLinks={savedArticleLinks}
          saveButtonLabel={isPublicViewer ? "Sign in to save" : "Save article"}
          viewMode={viewMode}
          emptyStateTitle={
            activeShellTab === "saved" && !hasSavedArticles
              ? "No saved stories yet"
              : emptyState.title
          }
          emptyStateMessage={
            activeShellTab === "saved" && !hasSavedArticles
              ? "Tap Save on any story to find it here."
              : emptyState.message
          }
        />
      )}
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

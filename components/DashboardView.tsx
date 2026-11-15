"use client";

import { AppShell, type ShellTab } from "@/components/AppShell";
import { AiHub } from "@/components/AiHub";
import { DashboardTabs, type DashboardSection } from "@/components/DashboardTabs";
import { NewArticlesPrompt } from "@/components/NewArticlesPrompt";
import { NewsFeed } from "@/components/NewsFeed";
import { fetchLatestNews } from "@/lib/news-client";
import type { FeedStatus, NewsItem, SavedArticle, UserPreferences } from "@/lib/types";
import { useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// `?view=ai` is a shareable direct link to the AI Hub. The News Feed keeps the clean URL.
const SECTION_PARAM = "view";

type DashboardViewProps = {
  aiBriefingEnabled?: boolean;
  askKickerEnabled?: boolean;
  articles: NewsItem[];
  feedErrorMessage?: string | null;
  feedStatus?: FeedStatus | null;
  initialAlertKeywords: string[];
  initialPreferences: UserPreferences | null;
  initialSavedArticles: SavedArticle[];
  userEmail: string | null;
  userId: string;
};

export function DashboardView({
  aiBriefingEnabled = false,
  askKickerEnabled = false,
  articles,
  feedErrorMessage = null,
  feedStatus = null,
  initialAlertKeywords,
  initialPreferences,
  initialSavedArticles,
  userEmail,
  userId,
}: DashboardViewProps) {
  const [currentArticles, setCurrentArticles] = useState(articles);
  const [currentFeedError, setCurrentFeedError] = useState(feedErrorMessage);
  const [currentFeedStatus, setCurrentFeedStatus] = useState(feedStatus);
  const [activeShellTab, setActiveShellTab] = useState<ShellTab>("feed");
  const [pendingUpdateCount, setPendingUpdateCount] = useState(0);
  const [pendingUpdateLinks, setPendingUpdateLinks] = useState<string[]>([]);
  const articleLinks = currentArticles.map((article) => article.link);
  const [, setSavedArticleCount] = useState(
    initialSavedArticles.length,
  );

  // The URL is the single source of truth for the section, so direct links,
  // reloads and Back/Forward all agree. Without AI there is only the feed.
  const aiAvailable = aiBriefingEnabled || askKickerEnabled;
  const searchParams = useSearchParams();
  const section: DashboardSection = aiAvailable && searchParams.get(SECTION_PARAM) === "ai" ? "ai" : "news";
  const tabsRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef(section);
  const scrollBySection = useRef<Partial<Record<DashboardSection, number>>>({});

  // Remember each section's scroll position so returning to the feed lands where
  // the reader left it. Both panels stay mounted, so filters and answers persist too.
  useEffect(() => {
    const remember = () => { scrollBySection.current[sectionRef.current] = window.scrollY; };
    window.addEventListener("scroll", remember, { passive: true });
    return () => window.removeEventListener("scroll", remember);
  }, []);

  useLayoutEffect(() => {
    if (sectionRef.current === section) return;
    sectionRef.current = section;
    const tabsTop = tabsRef.current ? tabsRef.current.getBoundingClientRect().top + window.scrollY : 0;
    // First visit to a section: keep the tabs in view rather than landing deep inside it.
    // "instant" overrides the global smooth scrolling: a section switch should not animate.
    window.scrollTo({ top: scrollBySection.current[section] ?? Math.min(window.scrollY, tabsTop), behavior: "instant" });
  }, [section]);

  function selectSection(next: DashboardSection) {
    if (next === section) return;
    scrollBySection.current[section] = window.scrollY;
    const params = new URLSearchParams(window.location.search);
    if (next === "ai") params.set(SECTION_PARAM, "ai");
    else params.delete(SECTION_PARAM);
    const query = params.toString();
    // Native pushState integrates with the Next.js router (useSearchParams updates)
    // without a server round-trip; Back returns to the previous section.
    window.history.pushState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
  }

  // Reset local refresh results only when a new server snapshot arrives.
  const [serverSnapshot, setServerSnapshot] = useState({ articles, feedErrorMessage, feedStatus });
  if (serverSnapshot.articles !== articles || serverSnapshot.feedErrorMessage !== feedErrorMessage || serverSnapshot.feedStatus !== feedStatus) {
    setServerSnapshot({ articles, feedErrorMessage, feedStatus });
    setCurrentArticles(articles);
    setCurrentFeedError(feedErrorMessage);
    setCurrentFeedStatus(feedStatus);
  }

  async function refreshArticles() {
    // Refreshed stories appear in the News Feed, so show it instead of updating a hidden panel.
    selectSection("news");
    const latestArticles = await fetchLatestNews("refresh", { onFeedStatus: setCurrentFeedStatus });
    setCurrentArticles(latestArticles);
    setCurrentFeedError(null);
  }

  return (
    <>
      <h1 className="sr-only">Kicker News</h1>
      <AppShell
        activeTab={activeShellTab}
        onRefresh={refreshArticles}
        onTabChange={setActiveShellTab}
        pendingUpdateCount={pendingUpdateCount}
        pendingUpdateLinks={pendingUpdateLinks}
        refreshLinks={articleLinks}
        userEmail={userEmail}
        viewerMode="authenticated"
      />

      <NewArticlesPrompt
        key={articleLinks.join("|")}
        initialLinks={articleLinks}
        onPendingCountChange={setPendingUpdateCount}
        onPendingLinksChange={setPendingUpdateLinks}
      />

      {aiAvailable && <DashboardTabs ref={tabsRef} section={section} onSelect={selectSection} />}

      {/* Inactive panels use `hidden` instead of unmounting: an Ask request in flight
          keeps running and the feed keeps its filters when the reader switches. */}
      <section
        className="mt-3"
        {...(aiAvailable ? { role: "tabpanel", id: "dashboard-panel-news", "aria-labelledby": "dashboard-tab-news", hidden: section !== "news" } : {})}
      >
        <NewsFeed
          activeShellTab={activeShellTab}
          articles={currentArticles}
          feedErrorMessage={currentFeedError}
          feedStatus={currentFeedStatus}
          initialAlertKeywords={initialAlertKeywords}
          initialPreferences={initialPreferences}
          initialSavedArticles={initialSavedArticles}
          onSavedArticlesCountChange={setSavedArticleCount}
          onShellTabChange={setActiveShellTab}
          userId={userId}
        />
      </section>

      {aiAvailable && (
        <section role="tabpanel" id="dashboard-panel-ai" aria-labelledby="dashboard-tab-ai" hidden={section !== "ai"}>
          <AiHub askKickerEnabled={askKickerEnabled} briefingEnabled={aiBriefingEnabled} />
        </section>
      )}
    </>
  );
}

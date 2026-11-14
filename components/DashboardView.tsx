"use client";

import { AppShell, type ShellTab } from "@/components/AppShell";
import { AiNewsBriefing } from "@/components/AiNewsBriefing";
import { NewArticlesPrompt } from "@/components/NewArticlesPrompt";
import { NewsFeed } from "@/components/NewsFeed";
import { fetchLatestNews } from "@/lib/news-client";
import type { NewsItem, SavedArticle, UserPreferences } from "@/lib/types";
import { useState } from "react";

type DashboardViewProps = {
  aiBriefingEnabled?: boolean;
  articles: NewsItem[];
  feedErrorMessage?: string | null;
  initialAlertKeywords: string[];
  initialPreferences: UserPreferences | null;
  initialSavedArticles: SavedArticle[];
  userEmail: string | null;
  userId: string;
};

export function DashboardView({
  aiBriefingEnabled = false,
  articles,
  feedErrorMessage = null,
  initialAlertKeywords,
  initialPreferences,
  initialSavedArticles,
  userEmail,
  userId,
}: DashboardViewProps) {
  const [currentArticles, setCurrentArticles] = useState(articles);
  const [currentFeedError, setCurrentFeedError] = useState(feedErrorMessage);
  const [activeShellTab, setActiveShellTab] = useState<ShellTab>("feed");
  const [pendingUpdateCount, setPendingUpdateCount] = useState(0);
  const [pendingUpdateLinks, setPendingUpdateLinks] = useState<string[]>([]);
  const articleLinks = currentArticles.map((article) => article.link);
  const [, setSavedArticleCount] = useState(
    initialSavedArticles.length,
  );

  // Reset local refresh results only when a new server snapshot arrives.
  const [serverSnapshot, setServerSnapshot] = useState({ articles, feedErrorMessage });
  if (serverSnapshot.articles !== articles || serverSnapshot.feedErrorMessage !== feedErrorMessage) {
    setServerSnapshot({ articles, feedErrorMessage });
    setCurrentArticles(articles);
    setCurrentFeedError(feedErrorMessage);
  }

  async function refreshArticles() {
    const latestArticles = await fetchLatestNews("refresh", { onWarning: setCurrentFeedError });
    setCurrentArticles(latestArticles);
  }

  return (
    <>
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

      {aiBriefingEnabled && <AiNewsBriefing />}

      <section className="mt-3">
        <NewsFeed
          activeShellTab={activeShellTab}
          articles={currentArticles}
          feedErrorMessage={currentFeedError}
          initialAlertKeywords={initialAlertKeywords}
          initialPreferences={initialPreferences}
          initialSavedArticles={initialSavedArticles}
          onSavedArticlesCountChange={setSavedArticleCount}
          onShellTabChange={setActiveShellTab}
          userId={userId}
        />
      </section>
    </>
  );
}

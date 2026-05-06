"use client";

import { AuthPanel } from "@/components/AuthPanel";
import { AppShell, type ShellTab } from "@/components/AppShell";
import { NewArticlesPrompt } from "@/components/NewArticlesPrompt";
import { NewsFeed } from "@/components/NewsFeed";
import { PublicFooter } from "@/components/PublicFooter";
import { fetchLatestNews } from "@/lib/news-client";
import type { NewsItem } from "@/lib/types";
import { useEffect, useState } from "react";

type PublicNewsViewProps = {
  articles: NewsItem[];
  feedErrorMessage?: string | null;
};

export function PublicNewsView({
  articles,
  feedErrorMessage = null,
}: PublicNewsViewProps) {
  const [currentArticles, setCurrentArticles] = useState(articles);
  const [activeShellTab, setActiveShellTab] = useState<ShellTab>("feed");
  const [isAuthPanelVisible, setIsAuthPanelVisible] = useState(false);
  const [pendingUpdateCount, setPendingUpdateCount] = useState(0);
  const [pendingUpdateLinks, setPendingUpdateLinks] = useState<string[]>([]);
  const articleLinks = currentArticles.map((article) => article.link);

  useEffect(() => {
    setCurrentArticles(articles);
  }, [articles]);

  useEffect(() => {
    function syncAuthPanelVisibilityFromHash() {
      const currentHash = window.location.hash;
      const shouldShowAuthPanel =
        currentHash === "#public-auth-panel-login" ||
        currentHash === "#public-auth-panel-signup";

      setIsAuthPanelVisible(shouldShowAuthPanel);
    }

    syncAuthPanelVisibilityFromHash();
    window.addEventListener("hashchange", syncAuthPanelVisibilityFromHash);

    return () => {
      window.removeEventListener("hashchange", syncAuthPanelVisibilityFromHash);
    };
  }, []);

  async function refreshArticles() {
    const latestArticles = await fetchLatestNews("refresh");
    setCurrentArticles(latestArticles);
  }

  return (
    <div className="space-y-4">
      <AppShell
        activeTab={activeShellTab}
        onRefresh={refreshArticles}
        onTabChange={setActiveShellTab}
        pendingUpdateCount={pendingUpdateCount}
        pendingUpdateLinks={pendingUpdateLinks}
        refreshLinks={articleLinks}
        viewerMode="public"
      />

      <NewArticlesPrompt
        key={articleLinks.join("|")}
        initialLinks={articleLinks}
        onPendingCountChange={setPendingUpdateCount}
        onPendingLinksChange={setPendingUpdateLinks}
      />

      {isAuthPanelVisible ? (
        <section
          id="public-auth-panel"
          aria-labelledby="public-auth-title"
          className="scroll-mt-24 rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-5"
        >
          <div className="mb-4 flex justify-end">
            <button
              className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
              type="button"
              onClick={() => {
                window.history.replaceState(null, "", window.location.pathname + window.location.search);
                setIsAuthPanelVisible(false);
              }}
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,390px)] lg:items-center">
            <div className="hidden h-full flex-col justify-center rounded-[1.2rem] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] p-4 sm:flex sm:p-5">
              <p className="mono-meta text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--accent)]">
                Join Kicker News
              </p>
              <h2
                id="public-auth-title"
                className="mt-2 text-[1.45rem] font-semibold tracking-tight text-[var(--foreground)]"
              >
                Save stories and keep your reading in one place.
              </h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Create a free account to unlock saved articles, newsletter
                preferences, and email analytics built around your reading habits.
              </p>

              <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                <div className="rounded-[1rem] border border-slate-200 bg-white px-3.5 py-3">
                  <p className="text-sm font-semibold text-slate-900">Save what matters</p>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    Keep a personal reading list across devices.
                  </p>
                </div>
                <div className="rounded-[1rem] border border-slate-200 bg-white px-3.5 py-3">
                  <p className="text-sm font-semibold text-slate-900">Get newsletters that fit</p>
                  <p className="mt-1 text-sm leading-5 text-slate-600">
                    Tune delivery settings without leaving the Kicker experience.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex h-full items-center">
              <div id="public-auth-panel-login" className="scroll-mt-24" />
              <div id="public-auth-panel-signup" className="scroll-mt-24" />
              <AuthPanel syncWithHash />
            </div>
          </div>
        </section>
      ) : null}

      <NewsFeed
        activeShellTab={activeShellTab}
        articles={currentArticles}
        authCtaHref="#public-auth-panel-login"
        authSignupHref="#public-auth-panel-signup"
        feedErrorMessage={feedErrorMessage}
        onShellTabChange={setActiveShellTab}
        viewerMode="public"
      />

      <PublicFooter />
    </div>
  );
}

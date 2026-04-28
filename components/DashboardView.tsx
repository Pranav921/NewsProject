"use client";

import { NewArticlesPrompt } from "@/components/NewArticlesPrompt";
import { NewsFeed } from "@/components/NewsFeed";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { RefreshButton } from "@/components/RefreshButton";
import { UserMenu } from "@/components/UserMenu";
import type { NewsItem, SavedArticle, UserPreferences } from "@/lib/types";
import Link from "next/link";
import { useState } from "react";

type DashboardViewProps = {
  articles: NewsItem[];
  initialAlertKeywords: string[];
  initialPreferences: UserPreferences | null;
  initialSavedArticles: SavedArticle[];
  userEmail: string | null;
  userId: string;
};

export function DashboardView({
  articles,
  initialAlertKeywords,
  initialPreferences,
  initialSavedArticles,
  userEmail,
  userId,
}: DashboardViewProps) {
  const articleLinks = articles.map((article) => article.link);
  const [savedArticleCount, setSavedArticleCount] = useState(
    initialSavedArticles.length,
  );

  return (
    <>
      <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.07)]">
        <div className="grid gap-4 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4 sm:p-4.5 xl:grid-cols-[minmax(0,1.18fr)_19rem] xl:items-center">
          <div className="space-y-3.5">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800">
              Kicker News Dashboard
            </div>
            <h1 className="max-w-3xl text-balance text-[1.8rem] font-semibold tracking-tight text-slate-950 sm:text-[2.15rem]">
              Latest headlines from trusted RSS feeds
            </h1>
            <p className="max-w-2xl text-[15px] leading-6 text-slate-600 sm:text-base">
              Follow live coverage from trusted publishers, surface what is new,
              and keep your alerts, saved stories, and newsletter preferences in
              one fast workspace.
            </p>

            <div className="grid gap-2 sm:grid-cols-3">
              <DashboardStat
                label="Sources"
                value={String(new Set(articles.map((article) => article.source)).size)}
              />
              <DashboardStat
                label="Stories loaded"
                value={String(articles.length)}
              />
              <DashboardStat label="Saved stories" value={String(savedArticleCount)} />
            </div>
          </div>

          <div className="space-y-3">
            <section className="rounded-[1.2rem] border border-slate-200 bg-slate-50/90 p-3">
              <div className="flex flex-col gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    Actions
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Jump into your newsletter or refresh the feed.
                  </p>
                </div>
                <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-1">
                  <a
                    className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                    href="#newsletter-signup"
                    style={{ color: "#ffffff" }}
                  >
                    Newsletter signup
                  </a>
                  <RefreshButton
                    currentLinks={articleLinks}
                    className="min-h-10 rounded-xl px-4 py-2"
                  />
                  <Link
                    className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                    href="/account"
                  >
                    Account settings
                  </Link>
                </div>
              </div>
            </section>
            <UserMenu email={userEmail} />
          </div>
        </div>
      </section>

      <NewArticlesPrompt
        key={articleLinks.join("|")}
        initialLinks={articleLinks}
      />

      <section className="mt-3">
        <NewsFeed
          articles={articles}
          initialAlertKeywords={initialAlertKeywords}
          initialPreferences={initialPreferences}
          initialSavedArticles={initialSavedArticles}
          onSavedArticlesCountChange={setSavedArticleCount}
          userId={userId}
        />
      </section>

      <section id="newsletter-signup" className="mt-4 scroll-mt-24">
        <NewsletterSignup
          initialEmail={userEmail}
          title="Newsletter preferences"
          description="Keep your delivery settings close to the feed so you can tune your cadence without leaving the dashboard."
        />
      </section>
    </>
  );
}

function DashboardStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold text-slate-950">{value}</p>
    </div>
  );
}

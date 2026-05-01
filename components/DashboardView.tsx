"use client";

import { BrandBadge, BrandLogo } from "@/components/BrandLogo";
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
  feedErrorMessage?: string | null;
  initialNewsletterCustomFrequency?: string | null;
  initialNewsletterFrequency?: "hourly" | "daily" | "weekly" | "custom" | null;
  initialNewsletterSubscriptionStatus?: "active" | "inactive" | "none";
  initialAlertKeywords: string[];
  initialPreferences: UserPreferences | null;
  initialSavedArticles: SavedArticle[];
  userEmail: string | null;
  userId: string;
};

export function DashboardView({
  articles,
  feedErrorMessage = null,
  initialNewsletterCustomFrequency = null,
  initialNewsletterFrequency = null,
  initialNewsletterSubscriptionStatus = "none",
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
  const [isMobileActionsOpen, setIsMobileActionsOpen] = useState(false);
  const sourceCount = new Set(articles.map((article) => article.source)).size;
  const storyCount = articles.length;

  return (
    <>
      <section
        id="dashboard-top"
        aria-labelledby="dashboard-hero-title"
        className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.07)]"
      >
        <div className="bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4 sm:hidden">
          <div className="space-y-2.5">
            <div className="flex items-center gap-3">
              <button
                aria-controls="dashboard-mobile-actions"
                aria-expanded={isMobileActionsOpen}
                aria-label="Open dashboard actions"
                className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                type="button"
                onClick={() => setIsMobileActionsOpen((currentValue) => !currentValue)}
              >
                <span className="sr-only">Open dashboard actions</span>
                <span className="flex flex-col gap-1">
                  <span className="block h-0.5 w-4 rounded-full bg-current" />
                  <span className="block h-0.5 w-4 rounded-full bg-current" />
                  <span className="block h-0.5 w-4 rounded-full bg-current" />
                </span>
              </button>
              <BrandBadge className="min-h-8 px-2.5 py-1 text-[10px] tracking-[0.2em]" />
            </div>
            {isMobileActionsOpen ? (
              <div
                id="dashboard-mobile-actions"
                className="rounded-[1.25rem] border border-slate-200 bg-white p-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]"
              >
                <div className="grid gap-2.5">
                  <a
                    className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                    href="#newsletter-signup"
                    style={{ color: "#ffffff" }}
                    onClick={() => setIsMobileActionsOpen(false)}
                  >
                    Newsletter signup
                  </a>
                  <RefreshButton
                    currentLinks={articleLinks}
                    className="min-h-10 rounded-xl px-4 py-2"
                    onRefresh={() => setIsMobileActionsOpen(false)}
                  />
                  <Link
                    className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                    href="/account"
                    onClick={() => setIsMobileActionsOpen(false)}
                  >
                    Account settings
                  </Link>
                  <UserMenu email={userEmail} variant="menu" />
                </div>
              </div>
            ) : null}
            <h1
              id="dashboard-hero-title"
              className="text-[1.35rem] leading-tight font-semibold tracking-tight text-slate-950"
            >
              Your fast, clutter-free dashboard for today&apos;s top headlines.
            </h1>
            <p className="text-sm leading-5 text-slate-600">
              Follow live coverage, save stories, and track alerts in one fast workspace.
            </p>
          </div>
        </div>

        <div className="hidden gap-4 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-4 sm:grid xl:grid-cols-[minmax(0,1.18fr)_18rem] xl:items-start">
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center">
                <BrandLogo
                  className="shrink-0"
                  desktopHeightClassName="sm:h-14 lg:h-16"
                  mobileHeightClassName="h-8"
                  priority
                />
              </div>
              <div className="hidden lg:block">
                <UserMenu email={userEmail} variant="inline" />
              </div>
            </div>
            <h1 className="max-w-3xl text-balance text-[1.7rem] font-semibold tracking-tight text-slate-950 sm:text-[2rem]">
              Your fast, clutter-free dashboard for today&apos;s top headlines.
            </h1>
            <p className="max-w-2xl text-[15px] leading-6 text-slate-600 sm:text-[15px]">
              Follow top coverage, save stories, surface alert matches, and keep
              your newsletter preferences close to the live feed.
            </p>

            <div className="grid gap-2 sm:grid-cols-3">
              <DashboardStat
                label="Sources"
                value={String(sourceCount)}
              />
              <DashboardStat
                label="Stories loaded"
                value={String(storyCount)}
              />
              <DashboardStat label="Saved stories" value={String(savedArticleCount)} />
            </div>
          </div>

          <div className="space-y-2.5">
            <section className="rounded-[1.2rem] border border-slate-200 bg-white/90 p-2.5 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
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
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
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
                    className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
                    href="/account"
                  >
                    Account settings
                  </Link>
                </div>
              </div>
            </section>
            <div className="lg:hidden">
              <UserMenu email={userEmail} />
            </div>
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
          feedErrorMessage={feedErrorMessage}
          initialAlertKeywords={initialAlertKeywords}
          initialPreferences={initialPreferences}
          initialSavedArticles={initialSavedArticles}
          onSavedArticlesCountChange={setSavedArticleCount}
          userId={userId}
        />
      </section>

      <section id="newsletter-signup" className="mt-4 scroll-mt-24">
        <NewsletterSignup
          browseHeadlinesHref="#dashboard-top"
          initialCustomFrequency={initialNewsletterCustomFrequency}
          initialEmail={userEmail}
          initialFrequency={initialNewsletterFrequency ?? "daily"}
          initialSubscriptionStatus={initialNewsletterSubscriptionStatus}
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

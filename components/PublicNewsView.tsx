"use client";

import { AuthPanel } from "@/components/AuthPanel";
import { BrandBadge, BrandLogo } from "@/components/BrandLogo";
import { NewsFeed } from "@/components/NewsFeed";
import { PublicFooter } from "@/components/PublicFooter";
import type { NewsItem } from "@/lib/types";

type PublicNewsViewProps = {
  articles: NewsItem[];
  feedErrorMessage?: string | null;
};

export function PublicNewsView({
  articles,
  feedErrorMessage = null,
}: PublicNewsViewProps) {
  return (
    <div className="space-y-4">
      <section
        id="public-top"
        className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.07)]"
      >
        <div className="bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 sm:p-6 lg:px-8 lg:py-8">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,680px)_minmax(240px,280px)] lg:items-center lg:gap-7">
            <div className="max-w-[680px]">
              <div className="sm:hidden">
                <BrandBadge className="min-h-8 px-2.5 py-1 text-[10px] tracking-[0.2em]" />
              </div>
              <BrandLogo
                className="hidden max-w-[180px] sm:block md:max-w-[200px] lg:max-w-[220px]"
                desktopHeightClassName="sm:h-auto"
                mobileHeightClassName="h-7"
                priority
              />
              <h1 className="mt-3 text-balance text-[1.72rem] font-semibold tracking-tight text-slate-950 sm:mt-3.5 sm:text-[2.2rem]">
                Your fast, clutter-free feed for today&apos;s top headlines.
              </h1>
              <p className="mt-2 max-w-[40rem] text-sm leading-6 text-slate-600 sm:text-[15px]">
                Browse trusted sources in one clean feed. Sign in to save
                stories, set alerts, and personalize your newsletter.
              </p>
            </div>

            <div className="flex flex-col gap-2.5 sm:flex-row lg:w-full lg:max-w-[270px] lg:flex-col lg:self-center">
              <a
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                href="#public-auth-panel-login"
                style={{ color: "#ffffff" }}
              >
                Sign in for alerts
              </a>
              <a
                className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                href="#public-auth-panel-signup"
              >
                Create free account
              </a>
            </div>
          </div>
        </div>
      </section>

      <NewsFeed
        articles={articles}
        authCtaHref="#public-auth-panel-login"
        authSignupHref="#public-auth-panel-signup"
        feedErrorMessage={feedErrorMessage}
        viewerMode="public"
      />

      <section
        id="public-auth-panel"
        className="rounded-[1.5rem] border border-slate-200 bg-white p-4 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-5"
      >
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,390px)] lg:items-start">
          <div className="rounded-[1.2rem] border border-slate-200 bg-[linear-gradient(180deg,#f8fbff_0%,#ffffff_100%)] p-4 sm:p-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
              Personalize Kicker News
            </p>
            <h2 className="mt-2 text-[1.45rem] font-semibold tracking-tight text-slate-950">
              Save stories, set alerts, and tune your newsletter.
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Create a free account to unlock saved articles, private alert
              keywords, newsletter preferences, and email analytics built around
              your reading habits.
            </p>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-[1rem] border border-slate-200 bg-white px-3.5 py-3">
                <p className="text-sm font-semibold text-slate-900">Save what matters</p>
                <p className="mt-1 text-sm leading-5 text-slate-600">
                  Keep a personal reading list across devices.
                </p>
              </div>
              <div className="rounded-[1rem] border border-slate-200 bg-white px-3.5 py-3">
                <p className="text-sm font-semibold text-slate-900">Set smarter alerts</p>
                <p className="mt-1 text-sm leading-5 text-slate-600">
                  Track new stories that match your saved keywords.
                </p>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
              <a
                className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
                href="#public-top"
                style={{ color: "#ffffff" }}
              >
                Browse headlines
              </a>
            </div>
          </div>

          <div className="space-y-3">
            <div id="public-auth-panel-login" className="scroll-mt-24" />
            <div id="public-auth-panel-signup" className="scroll-mt-24" />
            <AuthPanel syncWithHash />
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

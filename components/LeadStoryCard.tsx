"use client";

import { trackEvent } from "@/lib/analytics";
import {
  formatPublishedCompact,
  formatPublishedDate,
  getCoverageLabel,
  isBreakingStory,
} from "@/lib/news-presentation";
import type { SmartAlertImportance } from "@/lib/smart-alerts";
import type { NewsItem } from "@/lib/types";
import { useState } from "react";

type LeadStoryCardProps = {
  alertImportance?: SmartAlertImportance | null;
  article: NewsItem;
  isNew?: boolean;
  isSaved?: boolean;
  onAlertAction?: (article: NewsItem) => void;
  onToggleSaved?: (article: NewsItem) => void;
  saveButtonLabel?: string;
};

function LeadImagePanel({
  article,
  leadImageUrl,
}: {
  article: NewsItem;
  leadImageUrl: string | null;
}) {
  const [hasImageError, setHasImageError] = useState(false);

  return (
    <div className="relative z-10 hidden rounded-[0.95rem] border border-white/8 bg-white/[0.04] p-3 lg:block">
      {leadImageUrl && !hasImageError ? (
        <div className="overflow-hidden rounded-[8px] border border-white/10 bg-white/[0.06]">
          {/* Using a plain img here keeps arbitrary RSS-hosted images working without maintaining Next remote patterns. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt={article.title}
            className="aspect-[5/4] w-full object-cover"
            loading="lazy"
            src={leadImageUrl}
            onError={() => setHasImageError(true)}
          />
        </div>
      ) : (
        <div className="flex aspect-[5/4] items-center justify-center rounded-[8px] border border-white/10 bg-white/[0.06]">
          <p className="mono-meta text-[9px] font-medium uppercase tracking-[0.18em] text-white/40">
            Article image unavailable
          </p>
        </div>
      )}
    </div>
  );
}

export function LeadStoryCard({
  alertImportance = null,
  article,
  isNew = false,
  isSaved = false,
  onAlertAction,
  onToggleSaved,
  saveButtonLabel = "Save",
}: LeadStoryCardProps) {
  const isBreaking = isBreakingStory(article);
  const isImportantAlert = alertImportance === "important";
  const isNormalAlert = alertImportance === "normal";
  const metadataTone = isBreaking || isImportantAlert ? "text-white/56" : "text-white/52";
  const leadImageUrl =
    typeof article.imageUrl === "string" && article.imageUrl.length > 0
      ? article.imageUrl
      : null;
  const shouldShowAlertAction = typeof onAlertAction === "function";
  const isSignInToSaveCta = !isSaved && saveButtonLabel.toLowerCase().includes("sign in");

  return (
    <article className="fade-up relative isolate overflow-hidden rounded-[12px] border border-[#241614] bg-[#130a08] shadow-[0_22px_52px_rgba(19,10,8,0.24)]">
      <div className="h-[2px] w-full bg-[linear-gradient(90deg,#c8200e_0%,#FF6B00_58%,transparent_100%)] lg:h-[3px]" />

      <div className="grid gap-4 px-4 pb-[14px] pt-4 sm:p-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-8 lg:px-8 lg:py-7">
        <div className="relative z-10 flex min-w-0 flex-col">
          <div
            className={`mono-meta flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[9px] font-medium uppercase tracking-[0.18em] ${metadataTone}`}
          >
            {isBreaking ? (
              <span className="badge-in inline-flex items-center gap-1.5 rounded-full bg-[var(--breaking)] px-2.5 py-1 text-white">
                <span className="ticker-flash-dot inline-flex h-[5px] w-[5px] rounded-full bg-white" />
                Breaking
              </span>
            ) : null}
            {isImportantAlert ? (
              <span className="badge-in inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[var(--hero-headline)]">
                Important alert
              </span>
            ) : null}
            {isNormalAlert ? (
              <span className="badge-in inline-flex items-center rounded-full bg-white/10 px-2.5 py-1 text-[var(--hero-headline)]">
                Alert match
              </span>
            ) : null}
            {isNew ? (
              <span className="badge-in inline-flex items-center rounded-full bg-[var(--accent)] px-2.5 py-1 text-white">
                New
              </span>
            ) : null}
            <span>{article.source}</span>
            <span>{getCoverageLabel(article.source)}</span>
            <time
              className="ml-auto text-right text-white/54 lg:ml-0 lg:text-white/48"
              dateTime={article.publishedAt ?? undefined}
            >
              <span className="lg:hidden">{formatPublishedCompact(article.publishedAt)}</span>
              <span className="hidden lg:inline">{formatPublishedDate(article.publishedAt)}</span>
            </time>
          </div>

          <a
            aria-label={`Open article: ${article.title}`}
            className="mt-4 max-w-[520px] text-balance text-[18px] font-bold leading-[1.3] transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hero-dark)] sm:pointer-events-none sm:cursor-default sm:hover:text-[#ffeee8] lg:text-[26px] lg:leading-[1.25]"
            href={article.link}
            rel="noopener noreferrer"
            style={{ color: "#ffeee8", opacity: 1 }}
            target="_blank"
            onClick={() =>
              trackEvent("article_original_click", {
                article_link: article.link,
                article_source: article.source,
                article_title: article.title,
              })
            }
          >
            {article.title}
          </a>

          <p className="mt-3 max-w-[480px] text-[12px] leading-[1.6] text-white/60 lg:mt-4 lg:text-[13px] lg:leading-[1.7]">
            {article.summary ?? "No summary available."}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2.5 lg:mt-6">
            {shouldShowAlertAction ? (
              <button
                className="inline-flex min-h-10 items-center justify-center rounded-xl border border-white/14 bg-white/8 px-3.5 py-2 text-sm font-medium text-[var(--hero-headline)] transition-colors hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hero-dark)]"
                type="button"
                onClick={() => onAlertAction?.(article)}
              >
                {isImportantAlert || isNormalAlert ? "Alert" : "Set alert"}
              </button>
            ) : null}
            <button
              aria-label={`${isSaved ? "Remove saved article" : saveButtonLabel}: ${article.title}`}
              aria-pressed={isSaved}
              className={`inline-flex min-h-10 items-center justify-center rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hero-dark)] ${
                isSaved
                  ? "border-white/20 bg-white/12 text-[var(--hero-headline)] hover:bg-white/16"
                  : isSignInToSaveCta
                    ? "border-white/18 bg-white/10 text-[var(--hero-headline)] hover:border-white/28 hover:bg-white/16 hover:text-white"
                    : "border-white/14 bg-white/8 text-[var(--hero-headline)] hover:bg-white/12"
              }`}
              type="button"
              onClick={() => onToggleSaved?.(article)}
            >
              {isSaved ? "Saved" : saveButtonLabel}
            </button>
            <a
              aria-label={`Read original article: ${article.title}`}
              className="hidden min-h-10 items-center justify-center rounded-xl bg-white px-4.5 py-2 text-sm font-semibold text-[var(--navy)] transition-colors hover:bg-white/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hero-dark)] lg:inline-flex"
              href={article.link}
              rel="noopener noreferrer"
              target="_blank"
              onClick={() =>
                trackEvent("article_original_click", {
                  article_link: article.link,
                  article_source: article.source,
                  article_title: article.title,
                })
              }
            >
              Read article <span aria-hidden="true" className="ml-1">↗</span>
            </a>
          </div>
        </div>

        <LeadImagePanel
          key={`${article.link}:${leadImageUrl ?? "none"}`}
          article={article}
          leadImageUrl={leadImageUrl}
        />
      </div>
    </article>
  );
}

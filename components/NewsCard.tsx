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

type NewsCardProps = {
  alertImportance?: SmartAlertImportance | null;
  article: NewsItem;
  isNew?: boolean;
  isSaved?: boolean;
  onAlertAction?: (article: NewsItem) => void;
  onToggleSaved?: (article: NewsItem) => void;
  saveButtonLabel?: string;
  viewMode?: "standard" | "compact";
};

export function NewsCard({
  alertImportance = null,
  article,
  isNew = false,
  isSaved = false,
  onAlertAction,
  onToggleSaved,
  saveButtonLabel = "Save article",
  viewMode = "standard",
}: NewsCardProps) {
  const isCompact = viewMode === "compact";
  const isBreaking = isBreakingStory(article);
  const isImportantAlert = alertImportance === "important";
  const isNormalAlert = alertImportance === "normal";
  const shouldShowAlertAction = typeof onAlertAction === "function";
  const cardToneClasses = isImportantAlert
    ? "border-rose-200 bg-white"
    : isNormalAlert
      ? "border-amber-200 bg-white"
      : isBreaking
        ? "border-[#e8c8c4] bg-white"
        : isNew
          ? "border-[var(--accent)] bg-white"
          : "border-[var(--border)] bg-white";

  return (
    <article className="fade-up group relative">
      <div className="md:hidden">
        <div className="grid grid-cols-[58px_minmax(0,1fr)] gap-0 border-b border-[var(--border)]">
          <div className="flex flex-col items-start border-r border-[var(--border)] pr-2 pt-1">
            <time
              className="mono-meta text-[9px] font-normal uppercase tracking-[0.04em] text-[var(--text-muted)]"
              dateTime={article.publishedAt ?? undefined}
            >
              {formatPublishedCompact(article.publishedAt)}
            </time>
          </div>

          <div className="px-[14px] pb-3 pl-3">
            <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {isBreaking ? (
                <span className="mono-meta inline-flex items-center gap-[5px] rounded-[3px] bg-[var(--breaking)] px-[7px] py-[2px] text-[8px] font-medium uppercase tracking-[0.1em] text-white">
                  <span className="ticker-flash-dot inline-flex h-[5px] w-[5px] rounded-full bg-white" />
                  Breaking
                </span>
              ) : null}
              {isNew ? (
                <span className="mono-meta inline-flex rounded-[3px] bg-[var(--accent)] px-[7px] py-[2px] text-[8px] font-medium uppercase tracking-[0.1em] text-white">
                  New
                </span>
              ) : null}
              {isImportantAlert ? (
                <span className="mono-meta inline-flex rounded-[3px] bg-[var(--breaking)] px-[7px] py-[2px] text-[8px] font-medium uppercase tracking-[0.1em] text-white">
                  Important
                </span>
              ) : null}
              {isNormalAlert ? (
                <span className="mono-meta inline-flex rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_10%,white)] px-[7px] py-[2px] text-[8px] font-medium uppercase tracking-[0.1em] text-[var(--accent)]">
                  Match
                </span>
              ) : null}
              <span className="mono-meta text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                {article.source}
              </span>
              <span className="mono-meta text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                {getCoverageLabel(article.source)}
              </span>
            </div>

            <a
              aria-label={`Open article: ${article.title}`}
              className="mb-[7px] block text-balance text-[14px] font-semibold leading-[1.45] text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
              href={article.link}
              rel="noreferrer noopener"
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

            <p className="mb-3 line-clamp-2 text-[12px] leading-[1.6] text-[var(--text-sub)]">
              {article.summary ?? "No summary available."}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              {shouldShowAlertAction ? (
                <button
                  className="inline-flex min-h-8 items-center justify-center rounded-[6px] border border-[var(--border)] bg-white px-[11px] py-[4px] text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  type="button"
                  onClick={() => onAlertAction?.(article)}
                >
                  Alert
                </button>
              ) : null}
              <button
                aria-label={`${isSaved ? "Remove saved article" : saveButtonLabel}: ${article.title}`}
                aria-pressed={isSaved}
                className={`inline-flex min-h-8 items-center justify-center rounded-[6px] border px-[11px] py-[4px] text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
                  isSaved
                    ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,white)] text-[var(--accent)]"
                    : "border-[var(--border)] bg-white text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                }`}
                type="button"
                onClick={() => onToggleSaved?.(article)}
              >
                {isSaved ? "Saved" : saveButtonLabel}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div
        className={`hidden md:flex md:h-full md:flex-col md:overflow-hidden md:rounded-[10px] md:border md:shadow-[0_8px_24px_rgba(26,24,20,0.04)] ${cardToneClasses} ${
          isCompact ? "md:min-h-[14.75rem] md:p-[14px]" : "md:min-h-[14.5rem] md:p-[13px] xl:min-h-[15.5rem] xl:p-[16px]"
        }`}
      >
        {isBreaking ? (
          <div className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,#c8200e_0%,transparent_100%)]" />
        ) : null}

        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${isCompact ? "mb-[8px]" : "mb-[9px]"}`}>
          {isBreaking ? (
            <span className="mono-meta inline-flex items-center gap-[5px] rounded-[3px] bg-[var(--breaking)] px-[7px] py-[2px] text-[8px] font-medium uppercase tracking-[0.1em] text-white">
              <span className="ticker-flash-dot inline-flex h-[5px] w-[5px] rounded-full bg-white" />
              Breaking
            </span>
          ) : null}
          {isNew ? (
            <span className="mono-meta inline-flex rounded-[3px] bg-[var(--accent)] px-[7px] py-[2px] text-[8px] font-medium uppercase tracking-[0.1em] text-white">
              New
            </span>
          ) : null}
          {isImportantAlert ? (
            <span className="mono-meta inline-flex rounded-[3px] bg-[var(--breaking)] px-[7px] py-[2px] text-[8px] font-medium uppercase tracking-[0.1em] text-white">
              Important
            </span>
          ) : null}
          {isNormalAlert ? (
            <span className="mono-meta inline-flex rounded-[3px] bg-[color-mix(in_srgb,var(--accent)_10%,white)] px-[7px] py-[2px] text-[8px] font-medium uppercase tracking-[0.1em] text-[var(--accent)]">
              Match
            </span>
          ) : null}
          <span className="mono-meta text-[9px] font-medium uppercase tracking-[0.1em] text-[var(--accent)]">
            {article.source}
          </span>
          <span aria-hidden="true" className="text-[10px] text-[var(--border)]">
            ·
          </span>
          <time
            className="mono-meta text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--text-muted)]"
            dateTime={article.publishedAt ?? undefined}
          >
            {formatPublishedDate(article.publishedAt)}
          </time>
          <span className="mono-meta ml-auto text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
            {getCoverageLabel(article.source)}
          </span>
        </div>

        <a
          aria-label={`Open article: ${article.title}`}
          className={`text-balance font-semibold leading-[1.4] text-[var(--foreground)] transition-colors hover:text-[var(--navy)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:pointer-events-none sm:cursor-default sm:hover:text-[var(--foreground)] ${
            isCompact ? "mb-[7px] text-[14px]" : "mb-[8px] text-[16px]"
          } ${isBreaking ? "text-[var(--breaking)]" : ""}`}
          href={article.link}
          rel="noreferrer noopener"
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

        <p className={`line-clamp-3 font-normal leading-[1.65] text-[var(--text-sub)] ${isCompact ? "mb-[12px] text-[13px]" : "mb-[9px] text-[13px]"}`}>
          {article.summary ?? "No summary available."}
        </p>

        <div className="mt-auto flex flex-wrap items-center gap-2">
          {shouldShowAlertAction ? (
            <button
              className="inline-flex min-h-8 items-center justify-center rounded-[6px] border border-[var(--border)] bg-white px-[11px] py-[4px] text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
              type="button"
              onClick={() => onAlertAction?.(article)}
            >
              Alert
            </button>
          ) : null}
          <button
            aria-label={`${isSaved ? "Remove saved article" : saveButtonLabel}: ${article.title}`}
            aria-pressed={isSaved}
            className={`inline-flex min-h-8 items-center justify-center rounded-[6px] border px-[11px] py-[4px] text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
              isSaved
                ? "border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_10%,white)] text-[var(--accent)]"
                : "border-[var(--border)] bg-white text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
            }`}
            type="button"
            onClick={() => onToggleSaved?.(article)}
          >
            {isSaved ? "Saved" : saveButtonLabel}
          </button>
          <a
            aria-label={`Read original article: ${article.title}`}
            className="ml-auto inline-flex min-h-8 items-center justify-center rounded-[6px] bg-[var(--navy)] px-3 py-[4px] text-[11px] font-medium text-white transition-colors hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
            href={article.link}
            rel="noreferrer noopener"
            style={{ color: "#ffffff" }}
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
    </article>
  );
}

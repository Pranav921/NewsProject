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

function ArticleMeta({
  alertImportance,
  article,
  isBreaking,
  isNew,
  mobile = false,
}: {
  alertImportance: SmartAlertImportance | null;
  article: NewsItem;
  isBreaking: boolean;
  isNew: boolean;
  mobile?: boolean;
}) {
  const isImportantAlert = alertImportance === "important";
  const isNormalAlert = alertImportance === "normal";

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
      <span className={`mono-meta text-[9px] font-medium uppercase tracking-[0.1em] ${mobile ? "text-[var(--text-muted)]" : "text-[var(--accent)]"}`}>
        {article.source}
      </span>
      {mobile ? null : (
        <span aria-hidden="true" className="text-[10px] text-[var(--border)]">
          ·
        </span>
      )}
      <time
        className="mono-meta text-[9px] font-normal uppercase tracking-[0.1em] text-[var(--text-muted)]"
        dateTime={article.publishedAt ?? undefined}
      >
        {mobile ? formatPublishedCompact(article.publishedAt) : formatPublishedDate(article.publishedAt)}
      </time>
      <span className={`mono-meta text-[9px] uppercase tracking-[0.1em] text-[var(--text-muted)] ${mobile ? "" : "lg:ml-auto"}`}>
        {getCoverageLabel(article.source)}
      </span>
    </div>
  );
}

function ArticleActions({
  article,
  isSaved,
  onAlertAction,
  onToggleSaved,
  saveButtonLabel,
  stacked = false,
}: {
  article: NewsItem;
  isSaved: boolean;
  onAlertAction?: (article: NewsItem) => void;
  onToggleSaved?: (article: NewsItem) => void;
  saveButtonLabel: string;
  stacked?: boolean;
}) {
  const shouldShowAlertAction = typeof onAlertAction === "function";

  return (
    <div className={`flex ${stacked ? "w-full flex-col items-end" : "flex-wrap items-center"} gap-2`}>
      {shouldShowAlertAction ? (
        <button
          className={`${stacked ? "w-full" : ""} inline-flex min-h-8 items-center justify-center rounded-[6px] border border-[var(--border)] bg-white px-[11px] py-[4px] text-[11px] font-medium text-[var(--text-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2`}
          type="button"
          onClick={() => onAlertAction?.(article)}
        >
          Alert
        </button>
      ) : null}
      <button
        aria-label={`${isSaved ? "Remove saved article" : saveButtonLabel}: ${article.title}`}
        aria-pressed={isSaved}
        className={`${stacked ? "w-full" : ""} inline-flex min-h-8 items-center justify-center rounded-[6px] border px-[11px] py-[4px] text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
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
        className={`${stacked ? "mt-auto w-full" : "ml-auto"} inline-flex min-h-8 items-center justify-center rounded-[6px] bg-[var(--navy)] px-3 py-[4px] text-[11px] font-medium text-white transition-colors hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2`}
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
  );
}

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
            <div className="mb-2">
              <ArticleMeta
                alertImportance={alertImportance}
                article={article}
                isBreaking={isBreaking}
                isNew={isNew}
                mobile
              />
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

            <ArticleActions
              article={article}
              isSaved={isSaved}
              onAlertAction={onAlertAction}
              onToggleSaved={onToggleSaved}
              saveButtonLabel={saveButtonLabel}
            />
          </div>
        </div>
      </div>

      {isCompact ? (
        <div className={`hidden md:block md:overflow-hidden md:rounded-[10px] md:border md:px-[16px] md:py-[14px] md:shadow-[0_8px_24px_rgba(26,24,20,0.04)] ${cardToneClasses}`}>
          {isBreaking ? (
            <div className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,#c8200e_0%,transparent_100%)]" />
          ) : null}

          <div className="flex items-start gap-5">
            <div className="min-w-0 flex-1">
              <div className="mb-[8px]">
                <ArticleMeta
                  alertImportance={alertImportance}
                  article={article}
                  isBreaking={isBreaking}
                  isNew={isNew}
                />
              </div>

              <a
                aria-label={`Open article: ${article.title}`}
                className={`mb-[7px] block text-balance text-[15px] font-semibold leading-[1.45] text-[var(--foreground)] transition-colors hover:text-[var(--navy)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:pointer-events-none sm:cursor-default sm:hover:text-[var(--foreground)] ${
                  isBreaking ? "text-[var(--breaking)]" : ""
                }`}
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

              <p className="line-clamp-2 text-[13px] leading-[1.65] text-[var(--text-sub)]">
                {article.summary ?? "No summary available."}
              </p>
            </div>

            <div className="flex min-w-[180px] shrink-0 self-stretch">
              <ArticleActions
                article={article}
                isSaved={isSaved}
                onAlertAction={onAlertAction}
                onToggleSaved={onToggleSaved}
                saveButtonLabel={saveButtonLabel}
                stacked
              />
            </div>
          </div>
        </div>
      ) : (
        <div
          className={`hidden md:flex md:h-full md:flex-col md:overflow-hidden md:rounded-[10px] md:border md:p-[13px] md:shadow-[0_8px_24px_rgba(26,24,20,0.04)] xl:min-h-[15.5rem] xl:p-[16px] ${cardToneClasses} md:min-h-[14.5rem]`}
        >
          {isBreaking ? (
            <div className="absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,#c8200e_0%,transparent_100%)]" />
          ) : null}

          <div className="mb-[9px]">
            <ArticleMeta
              alertImportance={alertImportance}
              article={article}
              isBreaking={isBreaking}
              isNew={isNew}
            />
          </div>

          <a
            aria-label={`Open article: ${article.title}`}
            className={`mb-[8px] text-balance text-[16px] font-semibold leading-[1.4] text-[var(--foreground)] transition-colors hover:text-[var(--navy)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:pointer-events-none sm:cursor-default sm:hover:text-[var(--foreground)] ${
              isBreaking ? "text-[var(--breaking)]" : ""
            }`}
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

          <p className="mb-[9px] line-clamp-3 text-[13px] font-normal leading-[1.65] text-[var(--text-sub)]">
            {article.summary ?? "No summary available."}
          </p>

          <div className="mt-auto">
            <ArticleActions
              article={article}
              isSaved={isSaved}
              onAlertAction={onAlertAction}
              onToggleSaved={onToggleSaved}
              saveButtonLabel={saveButtonLabel}
            />
          </div>
        </div>
      )}
    </article>
  );
}

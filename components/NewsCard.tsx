import type { NewsItem } from "@/lib/types";
import type { SmartAlertImportance } from "@/lib/smart-alerts";

type NewsCardProps = {
  alertImportance?: SmartAlertImportance | null;
  article: NewsItem;
  isNew?: boolean;
  isSaved?: boolean;
  onToggleSaved?: (article: NewsItem) => void;
  viewMode?: "standard" | "compact";
};

function formatPublishedDate(publishedAt: string | null): string {
  if (!publishedAt) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(publishedAt));
}

export function NewsCard({
  alertImportance = null,
  article,
  isNew = false,
  isSaved = false,
  onToggleSaved,
  viewMode = "standard",
}: NewsCardProps) {
  const isCompact = viewMode === "compact";
  const isImportantAlert = alertImportance === "important";
  const isNormalAlert = alertImportance === "normal";
  const cardToneClasses = isImportantAlert
    ? "border-rose-300 bg-[linear-gradient(180deg,rgba(255,241,242,0.96),rgba(255,255,255,1))]"
    : isNormalAlert
      ? "border-amber-300 bg-[linear-gradient(180deg,rgba(254,240,138,0.42),rgba(255,255,255,1))]"
      : isNew
        ? "border-amber-300 bg-[linear-gradient(180deg,rgba(254,249,195,0.5),rgba(255,255,255,0.96))]"
        : "border-slate-200 bg-white";
  const summaryToneClasses = isImportantAlert
    ? "border-rose-200 bg-rose-50/90"
    : isNormalAlert
      ? "border-amber-200 bg-amber-50/90"
      : isNew
        ? "border-amber-200 bg-amber-50/70"
        : "border-slate-200 bg-slate-50";

  return (
    <article
      className={`group flex h-full flex-col overflow-hidden rounded-[1.25rem] border shadow-[0_12px_28px_rgba(15,23,42,0.05)] transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_34px_rgba(15,23,42,0.07)] ${cardToneClasses} ${
        isCompact ? "min-h-[15rem] p-3.5" : "min-h-[19rem] p-4 sm:p-4.5"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
            {article.source}
          </span>
          {isImportantAlert ? (
            <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-rose-800">
              Important alert
            </span>
          ) : null}
          {isNormalAlert ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
              Alert match
            </span>
          ) : null}
          {isNew ? (
            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-amber-800">
              New
            </span>
          ) : null}
          {isSaved ? (
            <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
              Saved
            </span>
          ) : null}
        </div>
        <time
          className="text-[11px] font-medium uppercase tracking-[0.08em] text-slate-400"
          dateTime={article.publishedAt ?? undefined}
        >
          {formatPublishedDate(article.publishedAt)}
        </time>
      </div>

      <h2
        className={`mt-3 text-balance font-semibold text-slate-950 ${
          isCompact
            ? "min-h-[4rem] text-base leading-6"
            : "min-h-[4.8rem] text-[1.05rem] leading-6"
        }`}
      >
        {article.title}
      </h2>

      {!isCompact ? (
        <div
          className={`mt-3 flex-1 rounded-[1rem] border p-3 ${summaryToneClasses}`}
        >
          <p className="line-clamp-5 text-sm leading-5 text-slate-600">
            {article.summary ?? "No summary available."}
          </p>
        </div>
      ) : (
        <p className="mt-2.5 line-clamp-3 text-sm leading-5 text-slate-600">
          {article.summary ?? "No summary available."}
        </p>
      )}

      <div
        className={`flex items-center gap-3 ${
          isCompact ? "mt-3.5 flex-wrap" : "mt-4 flex-wrap"
        }`}
      >
        <button
          className={`inline-flex min-h-10 items-center justify-center rounded-xl border px-3.5 py-2 text-sm font-medium transition-colors ${
            isSaved
              ? "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
              : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          }`}
          type="button"
          onClick={() => onToggleSaved?.(article)}
          aria-pressed={isSaved}
        >
          {isSaved ? "Saved" : "Save article"}
        </button>

        <a
          className="inline-flex min-h-10 w-fit items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium transition-colors hover:bg-slate-800"
          href={article.link}
          target="_blank"
          rel="noreferrer noopener"
          style={{ color: "#ffffff" }}
        >
          Read original article
        </a>
      </div>
    </article>
  );
}

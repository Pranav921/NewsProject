import type { NewsItem } from "@/lib/types";

type NewsCardProps = {
  article: NewsItem;
  isNew?: boolean;
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
  article,
  isNew = false,
  viewMode = "standard",
}: NewsCardProps) {
  const isCompact = viewMode === "compact";

  return (
    <article
      className={`flex h-full flex-col rounded-2xl border shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md ${
        isNew
          ? "border-amber-300 bg-amber-50/60"
          : "border-slate-200 bg-white"
      } ${isCompact ? "min-h-[17rem] p-4" : "min-h-[26rem] p-6"}`}
    >
      <div className="flex items-center justify-between gap-4 text-sm text-slate-500">
        <span className="font-medium text-sky-700">{article.source}</span>
        <time dateTime={article.publishedAt ?? undefined}>
          {formatPublishedDate(article.publishedAt)}
        </time>
      </div>

      <h2
        className={`mt-4 font-semibold text-slate-900 ${
          isCompact
            ? "min-h-[4.5rem] text-lg leading-7"
            : "min-h-[7.5rem] text-xl leading-8"
        }`}
      >
        {article.title}
      </h2>

      {!isCompact ? (
        <div
          className={`mt-3 flex-1 rounded-2xl p-4 ${
            isNew ? "bg-amber-50" : "bg-slate-50"
          }`}
        >
          <p className="text-sm leading-6 text-slate-600">
            {article.summary ?? "No summary available."}
          </p>
        </div>
      ) : null}

      <a
        className={`mx-auto inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-medium transition-colors hover:bg-slate-700 ${
          isCompact ? "mt-4" : "mt-6"
        }`}
        href={article.link}
        target="_blank"
        rel="noreferrer noopener"
        style={{ color: "#ffffff" }}
      >
        Read original article
      </a>
    </article>
  );
}

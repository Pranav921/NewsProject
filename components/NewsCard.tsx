import type { NewsItem } from "@/lib/types";

type NewsCardProps = {
  article: NewsItem;
  isNew?: boolean;
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

export function NewsCard({ article, isNew = false }: NewsCardProps) {
  return (
    <article
      className={`flex h-full min-h-[26rem] flex-col rounded-2xl border p-6 shadow-sm transition-all duration-200 ease-out hover:-translate-y-1 hover:shadow-md ${
        isNew
          ? "border-amber-300 bg-amber-50/60"
          : "border-slate-200 bg-white"
      }`}
    >
      <div className="flex items-center justify-between gap-4 text-sm text-slate-500">
        <span className="font-medium text-sky-700">{article.source}</span>
        <time dateTime={article.publishedAt ?? undefined}>
          {formatPublishedDate(article.publishedAt)}
        </time>
      </div>

      <h2 className="mt-4 min-h-[7.5rem] text-xl font-semibold leading-8 text-slate-900">
        {article.title}
      </h2>

      <div
        className={`mt-3 flex-1 rounded-2xl p-4 ${
          isNew ? "bg-amber-50" : "bg-slate-50"
        }`}
      >
        <p className="text-sm leading-6 text-slate-600">
          {article.summary ?? "No summary available."}
        </p>
      </div>

      <a
        className="mx-auto mt-6 inline-flex min-h-11 w-fit items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-medium transition-colors hover:bg-slate-700"
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

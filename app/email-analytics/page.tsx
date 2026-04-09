import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AnalyticsResponse = {
  daily: Array<Record<string, unknown>>;
  frequencies: Array<Record<string, unknown>>;
  overview: Array<Record<string, unknown>>;
  skipReasons: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  topArticles: Array<Record<string, unknown>>;
  userSummary: Array<Record<string, unknown>>;
};

const OVERVIEW_CARDS: Array<{ label: string; keys: string[] }> = [
  { label: "Total subscriptions", keys: ["total_subscriptions", "total"] },
  { label: "Active subscriptions", keys: ["active_subscriptions", "active"] },
  { label: "Total sent", keys: ["total_sent", "sent"] },
  { label: "Total failed", keys: ["total_failed", "failed"] },
  { label: "Total skipped", keys: ["total_skipped", "skipped"] },
  { label: "Total articles sent", keys: ["total_articles_sent", "articles_sent"] },
];

const FREQUENCY_COLUMNS = [
  { label: "Frequency", keys: ["frequency"] },
  { label: "Active subscriptions", keys: ["active_subscriptions", "count", "total"] },
];

const SOURCE_COLUMNS = [
  { label: "Source", keys: ["source"] },
  { label: "Articles sent", keys: ["articles_sent", "count", "total"] },
];

const TOP_ARTICLE_COLUMNS = [
  { label: "Article", keys: ["article_title", "title"] },
  { label: "Source", keys: ["article_source", "source"] },
  { label: "Times sent", keys: ["sent_count", "count", "total"] },
];

const SKIP_REASON_COLUMNS = [
  { label: "Reason", keys: ["reason", "skip_reason"] },
  { label: "Count", keys: ["count", "total"] },
];

type EmailAnalyticsPageProps = {
  searchParams: Promise<{
    range?: string;
  }>;
};

type RangeKey = "7" | "30" | "90" | "all";

const RANGE_OPTIONS: Array<{ label: string; value: RangeKey }> = [
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "90 days", value: "90" },
  { label: "All time", value: "all" },
];

export default async function EmailAnalyticsPage({
  searchParams,
}: EmailAnalyticsPageProps) {
  const resolvedSearchParams = await searchParams;
  const selectedRange = normalizeRange(resolvedSearchParams.range);
  const analytics = await fetchAnalytics(selectedRange);

  if ("error" in analytics) {
    return (
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
        <div className="mb-6">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            href="/"
          >
            Back to dashboard
          </Link>
        </div>

        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-rose-700 shadow-sm">
          <h1 className="text-2xl font-semibold">Email analytics</h1>
          <p className="mt-2 text-sm">
            {analytics.error}
          </p>
        </section>
      </main>
    );
  }

  const overviewRow = analytics.overview[0] ?? {};
  const dailyData = (analytics.daily ?? []) as Array<Record<string, unknown>>;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          href="/"
        >
          Back to dashboard
        </Link>
        <p className="text-sm text-slate-500">
          Email analytics overview
        </p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Newsletter analytics
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Track subscription health, send performance, and content reach.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((option) => (
            <Link
              key={option.value}
              className={`inline-flex min-h-9 items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-colors ${
                selectedRange === option.value
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
              href={`/email-analytics?range=${option.value}`}
            >
              {option.label}
            </Link>
          ))}
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {OVERVIEW_CARDS.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                {card.label}
              </p>
              <p className="mt-2 text-2xl font-semibold text-slate-900">
                {formatNumber(getFirstValue(overviewRow, card.keys))}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Daily activity
          </h2>
          <p className="text-sm text-slate-500">
            Sends by day (UTC)
          </p>
        </div>

        {dailyData.length > 0 ? (
          <div className="mt-6">
            <BarChart data={dailyData} />
          </div>
        ) : (
          <p className="mt-6 text-sm text-slate-500">
            No daily activity yet.
          </p>
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <TableCard
          title="Subscriptions by frequency"
          description="Active subscriptions grouped by cadence."
          rows={analytics.frequencies}
          columns={FREQUENCY_COLUMNS}
          emptyState="No frequency data yet."
        />
        <TableCard
          title="Top sources"
          description="Most frequently sent sources."
          rows={analytics.sources}
          columns={SOURCE_COLUMNS}
          emptyState="No source data yet."
        />
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <TableCard
          title="Top sent articles"
          description="Stories appearing most often in newsletters."
          rows={analytics.topArticles}
          columns={TOP_ARTICLE_COLUMNS}
          emptyState="No article data yet."
        />
        <TableCard
          title="Skip reasons"
          description="Why sends are skipped."
          rows={analytics.skipReasons}
          columns={SKIP_REASON_COLUMNS}
          emptyState="No skip reasons yet."
        />
      </div>
    </main>
  );
}

async function fetchAnalytics(
  range: RangeKey,
): Promise<AnalyticsResponse | { error: string }> {
  try {
    const url = `${await getBaseUrl()}/api/email-analytics?range=${range}`;
    const response = await fetch(url, { cache: "no-store" });

    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      return { error: body.message ?? "Unable to load analytics right now." };
    }

    return (await response.json()) as AnalyticsResponse;
  } catch {
    return { error: "Unable to load analytics right now." };
  }
}

async function getBaseUrl() {
  const configured = process.env.APP_BASE_URL?.trim();

  if (configured) {
    return configured.replace(/\/+$/, "");
  }

  const headerList = await headers();
  const host = headerList.get("host");
  const protocol = host?.includes("localhost") ? "http" : "https";

  return `${protocol}://${host}`;
}

function normalizeRange(value: string | undefined): RangeKey {
  if (value === "7" || value === "30" || value === "90") {
    return value;
  }

  return "all";
}

function getFirstValue(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }

  return 0;
}

function formatNumber(value: unknown) {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (Number.isNaN(numericValue)) {
    return "0";
  }

  return new Intl.NumberFormat("en-US").format(numericValue);
}

function BarChart({ data }: { data: Array<Record<string, unknown>> }) {
  const values = data.map((row) => Number(row.sent ?? row.total ?? 0));
  const maxValue = Math.max(1, ...values);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {data.map((row, index) => {
          const label = String(row.day ?? row.date ?? `Day ${index + 1}`);
          const value = Number(row.sent ?? row.total ?? 0);
          const percent = Math.round((value / maxValue) * 100);

          return (
            <div key={`${label}-${index}`} className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{label}</span>
                <span className="font-semibold text-slate-700">{value}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-200">
                <div
                  className="h-2 rounded-full bg-slate-900"
                  style={{ width: `${percent}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TableCard({
  title,
  description,
  rows,
  columns,
  emptyState,
}: {
  title: string;
  description: string;
  rows: Array<Record<string, unknown>>;
  columns: Array<{ label: string; keys: string[] }>;
  emptyState: string;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="text-xl font-semibold tracking-tight text-slate-900">
        {title}
      </h3>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>

      {rows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
          <table className="min-w-full border-collapse text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.16em] text-slate-500">
              <tr>
                {columns.map((column) => (
                  <th key={column.label} className="px-4 py-3">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {rows.map((row, index) => (
                <tr key={`${title}-${index}`}>
                  {columns.map((column) => (
                    <td key={column.label} className="px-4 py-3 text-slate-700">
                      {String(getFirstValue(row, column.keys))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">{emptyState}</p>
      )}
    </section>
  );
}

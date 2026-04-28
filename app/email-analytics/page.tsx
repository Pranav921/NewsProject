import { headers } from "next/headers";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type AnalyticsResponse = {
  daily: Array<Record<string, unknown>>;
  engagementDaily: Array<Record<string, unknown>>;
  engagementOverview: Array<Record<string, unknown>>;
  frequencies: Array<Record<string, unknown>>;
  overview: Array<Record<string, unknown>>;
  recentDeliveredArticles: Array<Record<string, unknown>>;
  skipReasons: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  topClickedArticles: Array<Record<string, unknown>>;
  topArticles: Array<Record<string, unknown>>;
  userEngagement: Array<Record<string, unknown>>;
  userSummary: Array<Record<string, unknown>>;
};

type ColumnDefinition = {
  label: string;
  render: (row: Record<string, unknown>) => string;
};

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
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            href="/"
          >
            Back to dashboard
          </Link>
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            href="/account"
          >
            Back to account settings
          </Link>
        </div>

        <section className="rounded-[1.9rem] border border-rose-200 bg-rose-50 p-8 text-rose-700 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
          <h1 className="text-2xl font-semibold">Newsletter performance</h1>
          <p className="mt-2 text-sm">{analytics.error}</p>
        </section>
      </main>
    );
  }

  const overviewRow = analytics.overview[0] ?? {};
  const engagementRow = analytics.engagementOverview[0] ?? {};
  const dailyData = (analytics.daily ?? []) as Array<Record<string, unknown>>;
  const newslettersReceived = Number(
    getFirstValue(overviewRow, ["total_sent", "sent"]),
  ) || 0;
  const articlesDelivered = Number(
    getFirstValue(overviewRow, ["total_articles_sent", "articles_sent"]),
  ) || 0;
  const opens = Number(getFirstValue(engagementRow, ["total_opens", "opens"])) || 0;
  const clicks =
    Number(getFirstValue(engagementRow, ["total_clicks", "clicks"])) || 0;
  const uniqueOpens =
    Number(getFirstValue(engagementRow, ["unique_opens"])) || 0;
  const uniqueClicks =
    Number(getFirstValue(engagementRow, ["unique_clicks"])) || 0;
  const totalFailed =
    Number(getFirstValue(overviewRow, ["total_failed", "failed"])) || 0;
  const totalSkipped =
    Number(getFirstValue(overviewRow, ["total_skipped", "skipped"])) || 0;
  const totalSubscriptions =
    Number(getFirstValue(overviewRow, ["total_subscriptions", "total"])) || 0;
  const activeSubscriptions =
    Number(getFirstValue(overviewRow, ["active_subscriptions", "active"])) || 0;
  const uniqueOpenRate = formatPercent(uniqueOpens, newslettersReceived);
  const clickRate = formatPercent(clicks, newslettersReceived);
  const clickToOpenRate = formatPercent(clicks, opens);
  const mostClickedSource = getMostClickedSource(analytics.topClickedArticles);
  const hasAdvancedDetails =
    totalFailed > 0 ||
    totalSkipped > 0 ||
    totalSubscriptions > 0 ||
    activeSubscriptions > 0 ||
    analytics.skipReasons.length > 0;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          href="/"
        >
          Back to dashboard
        </Link>
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          href="/account"
        >
          Back to account settings
        </Link>
      </div>

      <section className="overflow-hidden rounded-[1.6rem] border border-slate-200 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.06)]">
        <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_17rem]">
          <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4 sm:p-5">
            <p className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-sky-800">
              Kicker News analytics
            </p>
            <h1 className="mt-3 text-[2rem] font-semibold tracking-tight text-slate-950 sm:text-[2.35rem]">
              Your newsletter performance
            </h1>
            <p className="mt-2.5 max-w-2xl text-sm leading-6 text-slate-600 sm:text-base">
              See what reached your inbox, what you engaged with, and how your
              newsletter habits are building over time.
            </p>

            <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
              <HeroStat label="Received" value={formatNumber(newslettersReceived)} />
              <HeroStat label="Opened" value={formatNumber(opens)} />
              <HeroStat label="Clicked" value={formatNumber(clicks)} />
            </div>
          </div>

          <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
              Time range
            </p>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {RANGE_OPTIONS.map((option) => (
                <Link
                  key={option.value}
                  className={`inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-colors ${
                    selectedRange === option.value
                      ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                  style={selectedRange === option.value ? { color: "#ffffff" } : undefined}
                  href={`/email-analytics?range=${option.value}`}
                >
                  {option.label}
                </Link>
              ))}
            </div>

            <p className="mt-3 text-sm leading-6 text-slate-500">
              Compare short-term engagement with your longer newsletter history.
            </p>
          </div>
        </div>

        <div className="border-t border-slate-200 p-4 sm:p-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <MetricCard
              label="Articles delivered"
              value={formatNumber(articlesDelivered)}
            />
            <MetricCard
              label="Unique opens"
              value={formatNumber(uniqueOpens)}
            />
            <MetricCard
              label="Unique clicks"
              value={formatNumber(uniqueClicks)}
            />
            <MetricCard
              label="Unique open rate"
              value={uniqueOpenRate}
              helperText="Unique opens divided by newsletters received."
            />
            <MetricCard
              label="Click rate"
              value={clickRate}
              helperText="Total clicks divided by newsletters received."
            />
            <MetricCard
              label="Click-to-open"
              value={clickToOpenRate}
              helperText="Total clicks divided by total opens."
            />
          </div>
        </div>
      </section>

      <section className="mt-5 rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[1.45rem] font-semibold tracking-tight text-slate-900">
            Your activity summary
          </h2>
          <p className="text-sm text-slate-500">
            A simple view of how your newsletters are being used.
          </p>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Total opens"
            value={formatNumber(opens)}
            helperText="Tracked opens in the selected time range."
          />
          <MetricCard
            label="Total clicks"
            value={formatNumber(clicks)}
            helperText="Tracked clicks in the selected time range."
          />
          <MetricCard
            label="Most clicked source"
            value={mostClickedSource ?? "Not enough click data yet"}
            helperText={
              mostClickedSource
                ? "The source you clicked most often in this time range."
                : "We will show this once clicks include source details."
            }
          />
        </div>
      </section>

      <section className="mt-5 rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[1.45rem] font-semibold tracking-tight text-slate-900">
            Newsletter history
          </h2>
          <p className="text-sm text-slate-500">
            A compact timeline of your recorded deliveries.
          </p>
        </div>

        {dailyData.length > 0 ? (
          <div className="mt-5">
            <HistoryList data={dailyData} />
          </div>
        ) : (
          <EmptyStateCard message="No newsletters have been tracked in this time range yet." />
        )}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <TableCard
          title="Your newsletter schedule"
          description="How your newsletter subscriptions are currently set up."
          contentAlignment="center"
          rows={analytics.frequencies}
          columns={[
            {
              label: "Schedule",
              render: (row) =>
                formatScheduleLabel(String(getFirstValue(row, ["frequency"]))),
            },
            {
              label: "Active subscriptions",
              render: (row) =>
                formatNumber(getFirstValue(row, ["active_subscriptions", "count", "total"])),
            },
          ]}
          emptyState="No newsletter schedule data yet."
        />
        <TableCard
          title="Sources you receive most"
          description="The publishers showing up most often in your delivered newsletters."
          contentAlignment="center"
          rows={analytics.sources}
          columns={[
            {
              label: "Source",
              render: (row) =>
                formatSourceValue(getFirstValue(row, ["source"])),
            },
            {
              label: "Articles delivered",
              render: (row) =>
                formatNumber(getFirstValue(row, ["articles_sent", "count", "total"])),
            },
          ]}
          emptyState="No source activity in this time range yet."
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <TableCard
          title="Recent articles delivered"
          description="The latest stories sent to your inbox."
          contentAlignment="center"
          rows={analytics.recentDeliveredArticles}
          maxBodyHeightClassName="max-h-[24rem]"
          columns={[
            {
              label: "Article",
              render: (row) =>
                formatArticleLabel(
                  getFirstValue(row, ["article_title", "title"]),
                  getFirstValue(row, ["article_link"]),
                ),
            },
            {
              label: "Source",
              render: (row) =>
                formatSourceValue(
                  getFirstValue(row, ["article_source", "source"]),
                  getFirstValue(row, ["article_link"]),
                ),
            },
            {
              label: "Delivered",
              render: (row) =>
                formatLongDate(getFirstValue(row, ["sent_at"])),
            },
          ]}
          emptyState="No delivered articles in this time range yet."
        />
        <TableCard
          title="Articles you clicked"
          description="Links you opened from your newsletters."
          contentAlignment="center"
          rows={analytics.topClickedArticles}
          maxBodyHeightClassName="max-h-[24rem]"
          columns={[
            {
              label: "Article",
              render: (row) =>
                formatArticleLabel(
                  getFirstValue(row, ["article_title", "title"]),
                  getFirstValue(row, ["article_link"]),
                ),
            },
            {
              label: "Source",
              render: (row) =>
                formatSourceValue(
                  getFirstValue(row, ["article_source", "source"]),
                  getFirstValue(row, ["article_link"]),
                ),
            },
            {
              label: "Clicks",
              render: (row) =>
                formatNumber(getFirstValue(row, ["click_count", "clicks", "total"])),
            },
          ]}
          emptyState="No article clicks in this time range yet."
        />
      </div>

      {hasAdvancedDetails ? (
        <section className="mt-5 rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-[1.45rem] font-semibold tracking-tight text-slate-900">
              Delivery details
            </h2>
            <p className="text-sm text-slate-500">
              Helpful context for gaps, skips, or delivery issues.
            </p>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label="Failed sends"
              value={formatNumber(totalFailed)}
              helperText="Emails that could not be delivered successfully."
            />
            <MetricCard
              label="Skipped sends"
              value={formatNumber(totalSkipped)}
              helperText="Sends that were intentionally skipped in this time range."
            />
            <MetricCard
              label="Total subscriptions"
              value={formatNumber(totalSubscriptions)}
            />
            <MetricCard
              label="Active subscriptions"
              value={formatNumber(activeSubscriptions)}
            />
          </div>

          <div className="mt-5">
            {analytics.skipReasons.length > 0 ? (
              <TableCard
                title="Skipped send details"
                description="The most common reasons a scheduled send did not go out."
                rows={analytics.skipReasons}
                columns={[
                  {
                    label: "Reason",
                    render: (row) =>
                      formatSkipReason(getFirstValue(row, ["reason", "skip_reason"])),
                  },
                  {
                    label: "Count",
                    render: (row) =>
                      formatNumber(getFirstValue(row, ["count", "total"])),
                  },
                ]}
                emptyState="No skipped sends in this time range."
              />
            ) : (
              <p className="text-sm text-slate-500">
                No skipped sends in this time range.
              </p>
            )}
          </div>
        </section>
      ) : null}
    </main>
  );
}

async function fetchAnalytics(
  range: RangeKey,
): Promise<AnalyticsResponse | { error: string }> {
  try {
    const headerList = await headers();
    const url = `${await getBaseUrl()}/api/email-analytics?range=${range}`;
    const cookie = headerList.get("cookie");
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      headers: cookie ? { cookie } : undefined,
    });

    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      return {
        error: body.message ?? "Unable to load newsletter analytics right now.",
      };
    }

    return (await response.json()) as AnalyticsResponse;
  } catch {
    return { error: "Unable to load newsletter analytics right now." };
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

function formatPercent(numerator: number, denominator: number) {
  if (!denominator || Number.isNaN(denominator)) {
    return "0%";
  }

  const value = (numerator / denominator) * 100;

  return `${value.toFixed(1)}%`;
}

function formatChartDate(value: unknown) {
  if (typeof value !== "string") {
    return "Unknown date";
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function formatLongDate(value: unknown) {
  if (typeof value !== "string") {
    return "Unknown date";
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(timestamp));
}

function formatArticleLabel(title: unknown, link: unknown) {
  const normalizedTitle =
    typeof title === "string" ? decodeHtmlEntities(title).trim() : "";

  if (normalizedTitle && normalizedTitle !== "unknown") {
    return normalizedTitle;
  }

  return shortenUrl(link);
}

function formatSourceValue(value: unknown, link?: unknown) {
  if (typeof value !== "string") {
    return deriveSourceFromLink(link) ?? "Unknown source";
  }

  const normalized = decodeHtmlEntities(value).trim();

  if (!normalized || normalized === "0") {
    return deriveSourceFromLink(link) ?? "Unknown source";
  }

  return formatSourceName(normalized);
}

function shortenUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "Unknown article";
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    const shortenedPath =
      path.length > 28 ? `${path.slice(0, 28)}...` : path;

    return `${host}${shortenedPath}`;
  } catch {
    const normalized = decodeHtmlEntities(value).trim();
    return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
  }
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function formatSourceName(value: string) {
  const normalized = value.trim().toLowerCase();
  const sourceNameMap: Record<string, string> = {
    ap: "Associated Press",
    associatedpress: "Associated Press",
    bbc: "BBC News",
    bbcnews: "BBC News",
    bloomberg: "Bloomberg",
    guardian: "The Guardian",
    npr: "NPR",
    nyt: "The New York Times",
    nytimes: "The New York Times",
    reuters: "Reuters",
    wsj: "The Wall Street Journal",
  };

  const compactKey = normalized.replace(/[^a-z]/g, "");

  if (sourceNameMap[compactKey]) {
    return sourceNameMap[compactKey];
  }

  return value;
}

function formatScheduleLabel(value: string) {
  switch (value) {
    case "hourly":
      return "Hourly";
    case "daily":
      return "Daily";
    case "weekly":
      return "Weekly";
    case "custom":
      return "Custom";
    default:
      return "Unknown";
  }
}

function deriveSourceFromLink(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.replace(/^www\./, "");
    const primary = hostname.split(".")[0];

    if (!primary) {
      return hostname || null;
    }

    return formatSourceName(
      primary
        .split("-")
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" "),
    );
  } catch {
    return null;
  }
}

function formatSkipReason(value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return "Unknown reason";
  }

  return value
    .split("-")
    .join(" ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getMostClickedSource(rows: Array<Record<string, unknown>>) {
  for (const row of rows) {
    const source = formatSourceValue(
      getFirstValue(row, ["article_source", "source"]),
      getFirstValue(row, ["article_link"]),
    );
    if (source !== "Unknown source") {
      return source;
    }
  }

  return null;
}

function MetricCard({
  helperText,
  label,
  value,
}: {
  helperText?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="h-full rounded-[1.1rem] border border-slate-200 bg-slate-50 p-3.5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-xl font-semibold text-slate-900">{value}</p>
      {helperText ? (
        <p className="mt-1.5 text-sm leading-5 text-slate-500">{helperText}</p>
      ) : null}
    </div>
  );
}

function HeroStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1.1rem] border border-slate-200 bg-white px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </p>
      <p className="mt-1.5 text-xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function HistoryList({ data }: { data: Array<Record<string, unknown>> }) {
  const sortedRows = [...data]
    .sort((a, b) =>
      String(b.day ?? b.date ?? "").localeCompare(String(a.day ?? a.date ?? "")),
    )
    .slice(0, 10);

  return (
    <div className="rounded-[1.1rem] border border-slate-200 bg-slate-50 p-3.5">
      <div className="space-y-2.5">
        {sortedRows.map((row, index) => {
          const label = formatChartDate(row.day ?? row.date);
          const sent = Number(row.sent ?? 0);
          const skipped = Number(row.skipped ?? 0);
          const failed = Number(row.failed ?? 0);
          const total = Number(row.total ?? sent + skipped + failed);

          return (
            <div
              key={`${label}-${index}`}
              className="flex flex-col gap-2.5 rounded-[1rem] border border-slate-200 bg-white px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{label}</p>
                <p className="mt-1 text-sm text-slate-500">
                  {formatNumber(total)} total send{total === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs font-medium">
                <MiniCount label="Sent" tone="slate" value={formatNumber(sent)} />
                <MiniCount label="Skipped" tone="amber" value={formatNumber(skipped)} />
                <MiniCount label="Failed" tone="rose" value={formatNumber(failed)} />
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
  maxBodyHeightClassName,
  contentAlignment = "left",
}: {
  title: string;
  description: string;
  rows: Array<Record<string, unknown>>;
  columns: ColumnDefinition[];
  emptyState: string;
  maxBodyHeightClassName?: string;
  contentAlignment?: "center" | "left";
}) {
  const alignmentClassName =
    contentAlignment === "center" ? "text-center" : "text-left";

  return (
    <section className="flex h-full flex-col rounded-[1.55rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)]">
      <div>
        <h3 className="text-lg font-semibold tracking-tight text-slate-900">
          {title}
        </h3>
        <p className="mt-1.5 text-sm leading-6 text-slate-500">{description}</p>
      </div>

      {rows.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-[1.1rem] border border-slate-200">
          <div className={`overflow-auto ${maxBodyHeightClassName ?? ""}`}>
            <table className="min-w-full border-collapse text-sm">
              <thead
                className={`bg-slate-50 text-xs uppercase tracking-[0.16em] text-slate-500 ${alignmentClassName}`}
              >
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
                      <td
                        key={column.label}
                        className={`max-w-0 break-words px-4 py-3 align-top leading-6 text-slate-700 ${alignmentClassName}`}
                      >
                        {column.render(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500">{emptyState}</p>
      )}
    </section>
  );
}

function EmptyStateCard({ message }: { message: string }) {
  return (
    <div className="rounded-[1.1rem] border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm leading-6 text-slate-500">
      {message}
    </div>
  );
}

function MiniCount({
  label,
  tone,
  value,
}: {
  label: string;
  tone: "amber" | "rose" | "slate";
  value: string;
}) {
  const toneClasses =
    tone === "amber"
      ? "bg-amber-50 text-amber-700"
      : tone === "rose"
        ? "bg-rose-50 text-rose-700"
        : "bg-slate-100 text-slate-700";

  return (
    <span className={`inline-flex rounded-full px-3 py-1 ${toneClasses}`}>
      {label}: {value}
    </span>
  );
}

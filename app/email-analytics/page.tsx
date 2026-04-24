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
          <h1 className="text-2xl font-semibold">Newsletter performance</h1>
          <p className="mt-2 text-sm">{analytics.error}</p>
        </section>
      </main>
    );
  }

  const overviewRow = analytics.overview[0] ?? {};
  const engagementRow = analytics.engagementOverview[0] ?? {};
  const dailyData = (analytics.daily ?? []) as Array<Record<string, unknown>>;
  const engagementDaily =
    (analytics.engagementDaily ?? []) as Array<Record<string, unknown>>;
  const newslettersReceived = Number(
    getFirstValue(overviewRow, ["total_sent", "sent"]),
  ) || 0;
  const articlesDelivered = Number(
    getFirstValue(overviewRow, ["total_articles_sent", "articles_sent"]),
  ) || 0;
  const opens = Number(getFirstValue(engagementRow, ["total_opens", "opens"])) || 0;
  const clicks =
    Number(getFirstValue(engagementRow, ["total_clicks", "clicks"])) || 0;
  const totalFailed =
    Number(getFirstValue(overviewRow, ["total_failed", "failed"])) || 0;
  const totalSkipped =
    Number(getFirstValue(overviewRow, ["total_skipped", "skipped"])) || 0;
  const totalSubscriptions =
    Number(getFirstValue(overviewRow, ["total_subscriptions", "total"])) || 0;
  const activeSubscriptions =
    Number(getFirstValue(overviewRow, ["active_subscriptions", "active"])) || 0;
  const openRate = formatPercent(opens, newslettersReceived);
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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          href="/"
        >
          Back to dashboard
        </Link>
        <p className="text-sm text-slate-500">Your newsletter performance</p>
      </div>

      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Your newsletter performance
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          See how your newsletters are performing, what stories you received, and
          which links were clicked.
        </p>

        <div className="mt-6 flex flex-wrap gap-2">
          {RANGE_OPTIONS.map((option) => (
            <Link
              key={option.value}
              className={`inline-flex min-h-9 items-center justify-center rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.16em] transition-colors ${
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

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Newsletters received"
            value={formatNumber(newslettersReceived)}
          />
          <MetricCard
            label="Articles delivered"
            value={formatNumber(articlesDelivered)}
          />
          <MetricCard label="Opens" value={formatNumber(opens)} />
          <MetricCard label="Clicks" value={formatNumber(clicks)} />
          <MetricCard
            label="Open rate"
            value={openRate}
            helperText="How often your delivered emails were opened."
          />
          <MetricCard
            label="Click rate"
            value={clickRate}
            helperText="How often delivered emails led to a link click."
          />
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Your activity summary
          </h2>
          <p className="text-sm text-slate-500">
            A simple view of how your newsletters are being used.
          </p>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <MetricCard
            label="Emails opened"
            value={formatNumber(opens)}
            helperText="Tracked opens in the selected time range."
          />
          <MetricCard
            label="Links clicked"
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

        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label="Click-to-open"
            value={clickToOpenRate}
            helperText="Of the emails that were opened, how many led to a click."
          />
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Newsletter history
          </h2>
          <p className="text-sm text-slate-500">
            How many newsletter sends were recorded over time.
          </p>
        </div>

        {dailyData.length > 0 ? (
          <div className="mt-6">
            <BarChart data={dailyData} />
          </div>
        ) : (
          <p className="mt-6 text-sm text-slate-500">
            No newsletters have been tracked in this time range yet.
          </p>
        )}
      </section>

      <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
            Opens and clicks over time
          </h2>
          <p className="text-sm text-slate-500">
            A day-by-day view of tracked engagement.
          </p>
        </div>

        {engagementDaily.length > 0 ? (
          <div className="mt-6">
            <DualBarChart data={engagementDaily} />
          </div>
        ) : (
          <p className="mt-6 text-sm text-slate-500">
            No opens or clicks have been tracked in this time range yet.
          </p>
        )}
      </section>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <TableCard
          title="Your newsletter schedule"
          description="How your newsletter subscriptions are currently set up."
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

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <TableCard
          title="Recent articles delivered"
          description="Stories that appeared most often in your newsletters."
          rows={analytics.topArticles}
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
              label: "Times delivered",
              render: (row) =>
                formatNumber(getFirstValue(row, ["sent_count", "count", "total"])),
            },
          ]}
          emptyState="No delivered articles in this time range yet."
        />
        <TableCard
          title="Articles you clicked"
          description="Stories that got the most click activity from your newsletters."
          rows={analytics.topClickedArticles}
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
        <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
              Advanced details
            </h2>
            <p className="text-sm text-slate-500">
              Extra delivery details that can help when something looks off.
            </p>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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

          <div className="mt-6">
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

function formatArticleLabel(title: unknown, link: unknown) {
  const normalizedTitle =
    typeof title === "string" ? decodeCommonHtmlEntities(title).trim() : "";

  if (normalizedTitle && normalizedTitle !== "unknown") {
    return normalizedTitle;
  }

  return shortenUrl(link);
}

function formatSourceValue(value: unknown, link?: unknown) {
  if (typeof value !== "string") {
    return deriveSourceFromLink(link) ?? "Unknown source";
  }

  const normalized = decodeCommonHtmlEntities(value).trim();

  if (!normalized || normalized === "0") {
    return deriveSourceFromLink(link) ?? "Unknown source";
  }

  return normalized;
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
    const normalized = decodeCommonHtmlEntities(value).trim();
    return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized;
  }
}

function decodeCommonHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
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

    return primary
      .split("-")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
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
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
      {helperText ? (
        <p className="mt-2 text-sm leading-6 text-slate-500">{helperText}</p>
      ) : null}
    </div>
  );
}

function BarChart({ data }: { data: Array<Record<string, unknown>> }) {
  const values = data.map((row) => Number(row.sent ?? row.total ?? 0));
  const maxValue = Math.max(1, ...values);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {data.map((row, index) => {
          const label = formatChartDate(row.day ?? row.date);
          const value = Number(row.sent ?? row.total ?? 0);
          const percent = Math.round((value / maxValue) * 100);

          return (
            <div key={`${label}-${index}`} className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{label}</span>
                <span className="font-semibold text-slate-700">
                  {formatNumber(value)}
                </span>
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

function DualBarChart({ data }: { data: Array<Record<string, unknown>> }) {
  const openValues = data.map((row) => Number(row.opens ?? row.open_count ?? 0));
  const clickValues = data.map((row) =>
    Number(row.clicks ?? row.click_count ?? 0),
  );
  const maxValue = Math.max(1, ...openValues, ...clickValues);

  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        {data.map((row, index) => {
          const label = formatChartDate(row.day ?? row.date);
          const opens = Number(row.opens ?? row.open_count ?? 0);
          const clicks = Number(row.clicks ?? row.click_count ?? 0);
          const openPercent = Math.round((opens / maxValue) * 100);
          const clickPercent = Math.round((clicks / maxValue) * 100);

          return (
            <div key={`${label}-${index}`} className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>{label}</span>
                <span className="font-semibold text-slate-700">
                  {formatNumber(opens)} opens / {formatNumber(clicks)} clicks
                </span>
              </div>
              <div className="space-y-1">
                <div className="h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${openPercent}%` }}
                  />
                </div>
                <div className="h-2 rounded-full bg-slate-200">
                  <div
                    className="h-2 rounded-full bg-slate-900"
                    style={{ width: `${clickPercent}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-500">
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Opens
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-slate-900" />
          Clicks
        </span>
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
  columns: ColumnDefinition[];
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
                      {column.render(row)}
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

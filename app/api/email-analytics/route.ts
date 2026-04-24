import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnalyticsRow = Record<string, string | number | null>;

type AnalyticsResponse = {
  daily: AnalyticsRow[];
  engagementDaily: AnalyticsRow[];
  engagementOverview: AnalyticsRow[];
  frequencies: AnalyticsRow[];
  overview: AnalyticsRow[];
  skipReasons: AnalyticsRow[];
  sources: AnalyticsRow[];
  topArticles: AnalyticsRow[];
  topClickedArticles: AnalyticsRow[];
  userEngagement: AnalyticsRow[];
  userSummary: AnalyticsRow[];
};

type RangeKey = "7" | "30" | "90" | "all";

type NewsletterSubscriptionRecord = {
  created_at: string;
  email: string;
  frequency: string;
  id: number;
  is_active: boolean;
  user_id: string | null;
};

type EmailSendLogRecord = {
  article_count: number | null;
  created_at?: string | null;
  email: string;
  error: string | null;
  sent_at: string;
  status: "failed" | "sent" | "skipped";
  subscription_id: number | null;
  user_id: string | null;
};

type NewsletterSentArticleRecord = {
  article_link: string;
  article_source: string | null;
  article_title: string | null;
  email: string;
  sent_at: string;
  subscription_id: number | null;
  user_id: string | null;
};

type EmailOpenEventRecord = {
  created_at?: string | null;
  subscription_id: number | null;
};

type EmailClickEventRecord = {
  article_link: string | null;
  created_at?: string | null;
  subscription_id: number | null;
};

export async function GET(request: Request) {
  const serverSupabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await serverSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { message: "You must be logged in to view analytics." },
      { status: 401 },
    );
  }

  const normalizedEmail = user.email?.trim().toLowerCase() ?? "";
  const adminSupabase = createSupabaseAdminClient();
  const { searchParams } = new URL(request.url);
  const range = normalizeRange(searchParams.get("range"));

  const [userSubscriptionsResult, emailSubscriptionsResult] = await Promise.all([
    adminSupabase
      .from("newsletter_subscriptions")
      .select("id, user_id, email, frequency, is_active, created_at")
      .eq("user_id", user.id),
    normalizedEmail
      ? adminSupabase
          .from("newsletter_subscriptions")
          .select("id, user_id, email, frequency, is_active, created_at")
          .eq("email", normalizedEmail)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const subscriptionErrors = [
    userSubscriptionsResult.error,
    emailSubscriptionsResult.error,
  ].filter(Boolean);

  if (subscriptionErrors.length > 0) {
    console.error("[email-analytics][subscriptions]", subscriptionErrors);

    return NextResponse.json(
      {
        message: "Unable to load your newsletter analytics right now.",
      },
      { status: 500 },
    );
  }

  const subscriptions = dedupeById([
    ...((userSubscriptionsResult.data ?? []) as NewsletterSubscriptionRecord[]),
    ...((emailSubscriptionsResult.data ?? []) as NewsletterSubscriptionRecord[]),
  ]);
  const subscriptionIds = subscriptions.map((subscription) => subscription.id);

  const [
    logsBySubscriptionResult,
    logsByEmailResult,
    sentArticlesBySubscriptionResult,
    sentArticlesByEmailResult,
    openEventsBySubscriptionResult,
    clickEventsBySubscriptionResult,
  ] = await Promise.all([
    selectBySubscriptionIds<EmailSendLogRecord>(
      adminSupabase,
      "email_send_logs",
      "subscription_id, user_id, email, status, error, article_count, sent_at, created_at",
      subscriptionIds,
    ),
    normalizedEmail
      ? adminSupabase
          .from("email_send_logs")
          .select(
            "subscription_id, user_id, email, status, error, article_count, sent_at, created_at",
          )
          .eq("email", normalizedEmail)
      : Promise.resolve({ data: [], error: null }),
    selectBySubscriptionIds<NewsletterSentArticleRecord>(
      adminSupabase,
      "newsletter_sent_articles",
      "subscription_id, user_id, email, article_link, article_title, article_source, sent_at",
      subscriptionIds,
    ),
    normalizedEmail
      ? adminSupabase
          .from("newsletter_sent_articles")
          .select(
            "subscription_id, user_id, email, article_link, article_title, article_source, sent_at",
          )
          .eq("email", normalizedEmail)
      : Promise.resolve({ data: [], error: null }),
    selectOpenEventsBySubscriptionIds(
      adminSupabase,
      subscriptionIds,
    ),
    selectClickEventsBySubscriptionIds(
      adminSupabase,
      subscriptionIds,
    ),
  ]);

  const dataErrors = [
    logsBySubscriptionResult.error,
    logsByEmailResult.error,
    sentArticlesBySubscriptionResult.error,
    sentArticlesByEmailResult.error,
    openEventsBySubscriptionResult.error,
    clickEventsBySubscriptionResult.error,
  ].filter(Boolean);

  if (dataErrors.length > 0) {
    console.error("[email-analytics][scoped-data]", dataErrors);

    return NextResponse.json(
      {
        message: "Unable to load your newsletter analytics right now.",
      },
      { status: 500 },
    );
  }

  const scopedLogs = dedupeRowsByKey(
    [
      ...((logsBySubscriptionResult.data ?? []) as EmailSendLogRecord[]),
      ...((logsByEmailResult.data ?? []) as EmailSendLogRecord[]),
    ],
    (row) =>
      `${row.subscription_id ?? "null"}|${row.email}|${row.sent_at}|${row.status}|${
        row.error ?? ""
      }|${row.article_count ?? "null"}`,
  );
  const scopedSentArticles = dedupeRowsByKey(
    [
      ...((sentArticlesBySubscriptionResult.data ?? []) as NewsletterSentArticleRecord[]),
      ...((sentArticlesByEmailResult.data ?? []) as NewsletterSentArticleRecord[]),
    ],
    (row) =>
      `${row.subscription_id ?? "null"}|${row.email}|${row.sent_at}|${row.article_link}`,
  );
  const scopedOpenEvents = dedupeRowsByKey(
    (openEventsBySubscriptionResult.data ?? []) as EmailOpenEventRecord[],
    (row) => `${row.subscription_id ?? "null"}|${row.created_at ?? ""}`,
  );
  const scopedClickEvents = dedupeRowsByKey(
    (clickEventsBySubscriptionResult.data ?? []) as EmailClickEventRecord[],
    (row) =>
      `${row.subscription_id ?? "null"}|${row.created_at ?? ""}|${row.article_link ?? ""}`,
  );

  const rangedLogs = filterByRange(scopedLogs, range, "sent_at");
  const rangedSentArticles = filterByRange(scopedSentArticles, range, "sent_at");
  const rangedOpenEvents = filterByRange(scopedOpenEvents, range, "created_at");
  const rangedClickEvents = filterByRange(scopedClickEvents, range, "created_at");

  const response: AnalyticsResponse = {
    overview: [
      {
        active_subscriptions: subscriptions.filter((subscription) => subscription.is_active)
          .length,
        total_articles_sent: sumNumbers(rangedLogs, "article_count"),
        total_failed: countByStatus(rangedLogs, "failed"),
        total_sent: countByStatus(rangedLogs, "sent"),
        total_skipped: countByStatus(rangedLogs, "skipped"),
        total_subscriptions: subscriptions.length,
      },
    ],
    daily: buildDailySendRows(rangedLogs),
    frequencies: buildFrequencyRows(subscriptions),
    sources: buildSourceRows(rangedSentArticles),
    topArticles: buildTopArticleRows(rangedSentArticles),
    skipReasons: buildSkipReasonRows(rangedLogs),
    userSummary: [
      {
        email: normalizedEmail || user.id,
        failed: countByStatus(rangedLogs, "failed"),
        sent: countByStatus(rangedLogs, "sent"),
        skipped: countByStatus(rangedLogs, "skipped"),
      },
    ],
    engagementOverview: [
      {
        total_clicks: rangedClickEvents.length,
        total_opens: rangedOpenEvents.length,
        unique_clicks: countDistinct(rangedClickEvents, (row) =>
          `${row.subscription_id ?? "null"}|${row.article_link ?? ""}`,
        ),
        unique_opens: countDistinct(rangedOpenEvents, (row) =>
          `${row.subscription_id ?? "null"}`,
        ),
      },
    ],
    engagementDaily: buildEngagementDailyRows(rangedOpenEvents, rangedClickEvents),
    topClickedArticles: buildTopClickedArticleRows(rangedClickEvents),
    userEngagement: [
      {
        click_count: rangedClickEvents.length,
        email: normalizedEmail || user.id,
        open_count: rangedOpenEvents.length,
      },
    ],
  };

  return NextResponse.json(response);
}

function normalizeRange(value: string | null): RangeKey {
  if (value === "7" || value === "30" || value === "90") {
    return value;
  }

  return "all";
}

function dedupeById(rows: NewsletterSubscriptionRecord[]) {
  const map = new Map<number, NewsletterSubscriptionRecord>();

  for (const row of rows) {
    map.set(row.id, row);
  }

  return Array.from(map.values());
}

function dedupeRowsByKey<T>(rows: T[], getKey: (row: T) => string) {
  const map = new Map<string, T>();

  for (const row of rows) {
    map.set(getKey(row), row);
  }

  return Array.from(map.values());
}

function filterByRange<T extends Record<string, unknown>>(
  rows: T[],
  range: RangeKey,
  dateKey: keyof T,
) {
  if (range === "all") {
    return rows;
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - Number(range));
  const cutoffTime = cutoff.getTime();

  return rows.filter((row) => {
    const value = row[dateKey];

    if (typeof value !== "string") {
      return false;
    }

    const timestamp = Date.parse(value);

    if (Number.isNaN(timestamp)) {
      return false;
    }

    return timestamp >= cutoffTime;
  });
}

function getUtcDay(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString().slice(0, 10);
}

function buildDailySendRows(rows: EmailSendLogRecord[]): AnalyticsRow[] {
  const dayMap = new Map<
    string,
    { failed: number; sent: number; skipped: number }
  >();

  for (const row of rows) {
    const day = getUtcDay(row.sent_at);
    if (!day) continue;

    const existing = dayMap.get(day) ?? { failed: 0, sent: 0, skipped: 0 };
    existing[row.status] += 1;
    dayMap.set(day, existing);
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({
      day,
      failed: counts.failed,
      sent: counts.sent,
      skipped: counts.skipped,
      total: counts.failed + counts.sent + counts.skipped,
    }));
}

function buildFrequencyRows(subscriptions: NewsletterSubscriptionRecord[]): AnalyticsRow[] {
  const frequencyMap = new Map<string, number>();

  for (const subscription of subscriptions) {
    if (!subscription.is_active) {
      continue;
    }

    frequencyMap.set(
      subscription.frequency,
      (frequencyMap.get(subscription.frequency) ?? 0) + 1,
    );
  }

  return Array.from(frequencyMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([frequency, count]) => ({
      active_subscriptions: count,
      frequency,
    }));
}

function buildSourceRows(rows: NewsletterSentArticleRecord[]): AnalyticsRow[] {
  const sourceMap = new Map<string, number>();

  for (const row of rows) {
    if (!row.article_source) {
      continue;
    }

    sourceMap.set(row.article_source, (sourceMap.get(row.article_source) ?? 0) + 1);
  }

  return Array.from(sourceMap.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([source, count]) => ({
      articles_sent: count,
      source,
    }));
}

function buildTopArticleRows(rows: NewsletterSentArticleRecord[]): AnalyticsRow[] {
  const articleMap = new Map<
    string,
    { article_source: string | null; article_title: string | null; sent_count: number }
  >();

  for (const row of rows) {
    const existing = articleMap.get(row.article_link) ?? {
      article_source: row.article_source,
      article_title: row.article_title,
      sent_count: 0,
    };
    existing.sent_count += 1;
    articleMap.set(row.article_link, existing);
  }

  return Array.from(articleMap.entries())
    .sort((a, b) => b[1].sent_count - a[1].sent_count)
    .slice(0, 10)
    .map(([article_link, value]) => ({
      article_link,
      article_source: value.article_source,
      article_title: value.article_title ?? article_link,
      sent_count: value.sent_count,
    }));
}

function buildSkipReasonRows(rows: EmailSendLogRecord[]): AnalyticsRow[] {
  const reasonMap = new Map<string, number>();

  for (const row of rows) {
    if (row.status !== "skipped") {
      continue;
    }

    const reason = row.error ?? "unknown";
    reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
  }

  return Array.from(reasonMap.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([reason, count]) => ({
      count,
      reason,
    }));
}

function buildEngagementDailyRows(
  openEvents: EmailOpenEventRecord[],
  clickEvents: EmailClickEventRecord[],
): AnalyticsRow[] {
  const dayMap = new Map<string, { click_count: number; open_count: number }>();

  for (const row of openEvents) {
    const day = getUtcDay(row.created_at);
    if (!day) continue;

    const existing = dayMap.get(day) ?? { click_count: 0, open_count: 0 };
    existing.open_count += 1;
    dayMap.set(day, existing);
  }

  for (const row of clickEvents) {
    const day = getUtcDay(row.created_at);
    if (!day) continue;

    const existing = dayMap.get(day) ?? { click_count: 0, open_count: 0 };
    existing.click_count += 1;
    dayMap.set(day, existing);
  }

  return Array.from(dayMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, counts]) => ({
      clicks: counts.click_count,
      day,
      opens: counts.open_count,
    }));
}

function buildTopClickedArticleRows(rows: EmailClickEventRecord[]): AnalyticsRow[] {
  const clickMap = new Map<string, { click_count: number }>();

  for (const row of rows) {
    const link = row.article_link ?? "unknown";
    const existing = clickMap.get(link) ?? { click_count: 0 };
    existing.click_count += 1;
    clickMap.set(link, existing);
  }

  return Array.from(clickMap.entries())
    .sort((a, b) => b[1].click_count - a[1].click_count)
    .slice(0, 10)
    .map(([article_link, value]) => ({
      article_link,
      article_source: null,
      article_title: article_link,
      click_count: value.click_count,
    }));
}

function countByStatus(
  rows: EmailSendLogRecord[],
  status: EmailSendLogRecord["status"],
) {
  return rows.filter((row) => row.status === status).length;
}

function sumNumbers<T extends Record<string, unknown>>(rows: T[], key: keyof T) {
  return rows.reduce((total, row) => {
    const value = row[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);
}

function countDistinct<T>(rows: T[], getKey: (row: T) => string) {
  return new Set(rows.map(getKey)).size;
}

async function selectBySubscriptionIds<T extends AnalyticsRow>(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  table: string,
  selectClause: string,
  subscriptionIds: number[],
) {
  if (subscriptionIds.length === 0) {
    return { data: [] as T[], error: null };
  }

  return supabase.from(table).select(selectClause).in("subscription_id", subscriptionIds);
}

async function selectOpenEventsBySubscriptionIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  subscriptionIds: number[],
) {
  const primaryResult = await selectBySubscriptionIds<EmailOpenEventRecord>(
    supabase,
    "email_open_events",
    "subscription_id, created_at",
    subscriptionIds,
  );

  if (!primaryResult.error) {
    return primaryResult;
  }

  logSupabaseQueryError("email_open_events.primary", primaryResult.error);

  const fallbackResult = await selectBySubscriptionIds<EmailOpenEventRecord>(
    supabase,
    "email_open_events",
    "subscription_id",
    subscriptionIds,
  );

  if (fallbackResult.error) {
    logSupabaseQueryError("email_open_events.fallback", fallbackResult.error);
  }

  return fallbackResult;
}

async function selectClickEventsBySubscriptionIds(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  subscriptionIds: number[],
) {
  const primaryResult = await selectBySubscriptionIds<EmailClickEventRecord>(
    supabase,
    "email_click_events",
    "subscription_id, article_link, created_at",
    subscriptionIds,
  );

  if (!primaryResult.error) {
    return primaryResult;
  }

  logSupabaseQueryError("email_click_events.primary", primaryResult.error);

  const fallbackResult = await selectBySubscriptionIds<EmailClickEventRecord>(
    supabase,
    "email_click_events",
    "subscription_id, article_link",
    subscriptionIds,
  );

  if (fallbackResult.error) {
    logSupabaseQueryError("email_click_events.fallback", fallbackResult.error);
  }

  return fallbackResult;
}

function logSupabaseQueryError(
  label: string,
  error: {
    code?: string | null;
    details?: string | null;
    hint?: string | null;
    message?: string | null;
  },
) {
  console.error(`[email-analytics][${label}]`, {
    code: error.code ?? null,
    details: error.details ?? null,
    hint: error.hint ?? null,
    message: error.message ?? "Unknown Supabase error.",
  });
}

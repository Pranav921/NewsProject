import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnalyticsResponse = {
  overview: unknown[];
  daily: unknown[];
  frequencies: unknown[];
  sources: unknown[];
  topArticles: unknown[];
  skipReasons: unknown[];
  userSummary: unknown[];
};

type RangeKey = "7" | "30" | "90" | "all";

export async function GET(request: Request) {
  const supabase = createSupabaseAdminClient();
  const { searchParams } = new URL(request.url);
  const range = normalizeRange(searchParams.get("range"));

  const [
    overviewResult,
    dailyResult,
    frequencyResult,
    sourcesResult,
    topArticlesResult,
    skipReasonsResult,
    userSummaryResult,
  ] = await Promise.all([
    supabase.from("newsletter_analytics_overview").select("*"),
    supabase.from("newsletter_analytics_daily").select("*"),
    supabase.from("newsletter_analytics_frequency").select("*"),
    supabase.from("newsletter_analytics_sources").select("*"),
    supabase.from("newsletter_analytics_top_articles").select("*").limit(10),
    supabase.from("newsletter_analytics_skip_reasons").select("*"),
    supabase.from("newsletter_analytics_user_summary").select("*").limit(25),
  ]);

  const errors = [
    overviewResult.error,
    dailyResult.error,
    frequencyResult.error,
    sourcesResult.error,
    topArticlesResult.error,
    skipReasonsResult.error,
    userSummaryResult.error,
  ].filter(Boolean);

  if (errors.length > 0) {
    console.error("[email-analytics] failed to load analytics views", errors);

    return NextResponse.json(
      {
        message: "Unable to load analytics data.",
        errors: errors.map((error) => ({
          code: error?.code ?? null,
          details: error?.details ?? null,
          hint: error?.hint ?? null,
          message: error?.message ?? "Unknown analytics error.",
        })),
      },
      { status: 500 },
    );
  }

  const dailyData = (dailyResult.data ?? []).slice().sort((a, b) => {
    const aValue = (a as { day?: string }).day ?? "";
    const bValue = (b as { day?: string }).day ?? "";

    return aValue.localeCompare(bValue);
  });
  const filteredDaily = filterRowsByRange(dailyData, range);

  const response: AnalyticsResponse = {
    overview: overviewResult.data ?? [],
    daily: filteredDaily,
    frequencies: filterRowsByRange(frequencyResult.data ?? [], range),
    sources: filterRowsByRange(sourcesResult.data ?? [], range).slice(0, 10),
    topArticles: filterRowsByRange(topArticlesResult.data ?? [], range).slice(0, 10),
    skipReasons: filterRowsByRange(skipReasonsResult.data ?? [], range),
    userSummary: filterRowsByRange(userSummaryResult.data ?? [], range).slice(0, 25),
  };

  return NextResponse.json(response);
}

function normalizeRange(value: string | null): RangeKey {
  if (value === "7" || value === "30" || value === "90") {
    return value;
  }

  return "all";
}

function filterRowsByRange(
  rows: Array<Record<string, unknown>>,
  range: RangeKey,
) {
  if (range === "all") {
    return rows;
  }

  const days = Number(range);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffTime = cutoff.getTime();

  return rows.filter((row) => {
    const dateValue = extractDateValue(row);

    if (!dateValue) {
      return true;
    }

    const timestamp = Date.parse(dateValue);

    if (Number.isNaN(timestamp)) {
      return true;
    }

    return timestamp >= cutoffTime;
  });
}

function extractDateValue(row: Record<string, unknown>) {
  const candidate =
    (row.day as string | undefined) ??
    (row.date as string | undefined) ??
    (row.sent_at as string | undefined);

  return candidate ?? null;
}

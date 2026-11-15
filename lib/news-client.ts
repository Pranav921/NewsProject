import type { FeedIssue, FeedStatus, NewsItem } from "./types";

type NewsRefreshReason = "refresh" | "checkForUpdates";

type NewsApiResponse = {
  articles: NewsItem[];
  feedStatus?: unknown;
};

const MAX_FEED_ISSUES = 50;

// The browser only renders feed health it understands: counts must be valid and
// issues are copied field by field (unknown fields dropped, list bounded).
export function parseFeedStatus(value: unknown): FeedStatus | null {
  if (!value || typeof value !== "object") return null;
  const { failedFeeds, staleFeeds, issues } = value as Record<string, unknown>;
  const isCount = (count: unknown): count is number => Number.isSafeInteger(count) && (count as number) >= 0;
  if (!isCount(failedFeeds) || !isCount(staleFeeds)) return null;
  const parsedIssues: FeedIssue[] = Array.isArray(issues)
    ? issues.slice(0, MAX_FEED_ISSUES).flatMap((issue) => {
      if (!issue || typeof issue !== "object") return [];
      const { source, topic, state, lastSuccessAt } = issue as Record<string, unknown>;
      if (typeof source !== "string" || !source.trim() || typeof topic !== "string" || !topic.trim()
        || (state !== "unavailable" && state !== "stale")) return [];
      const time = typeof lastSuccessAt === "string" && Number.isFinite(Date.parse(lastSuccessAt)) ? lastSuccessAt : null;
      return [{ source: source.slice(0, 80), topic: topic.slice(0, 40), state, lastSuccessAt: time }];
    })
    : [];
  return { failedFeeds, staleFeeds, issues: parsedIssues };
}

export function buildNewsRequestUrl(
  reason: NewsRefreshReason,
  timestamp = Date.now(),
): string {
  const searchParams = new URLSearchParams({
    t: String(timestamp),
  });

  if (reason === "refresh") {
    searchParams.set("fresh", "1");
    searchParams.set("refresh", "1");
  } else {
    searchParams.set("checkForUpdates", "1");
  }

  return `/api/news?${searchParams.toString()}`;
}

export async function fetchLatestNews(
  reason: NewsRefreshReason,
  options: { signal?: AbortSignal; onFeedStatus?: (status: FeedStatus | null) => void } = {},
): Promise<NewsItem[]> {
  const response = await fetch(buildNewsRequestUrl(reason), {
    cache: "no-store",
    signal: AbortSignal.any([AbortSignal.timeout(25000), ...(options.signal ? [options.signal] : [])]),
  });

  if (!response.ok) {
    throw new Error(`News refresh failed with status ${response.status}`);
  }

  const data = (await response.json()) as NewsApiResponse;
  if (!Array.isArray(data.articles) || !data.articles.length) throw new Error("No articles available; keeping the current feed.");
  options.onFeedStatus?.(parseFeedStatus(data.feedStatus));
  return data.articles;
}

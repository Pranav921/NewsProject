import type { NewsItem } from "./types";

type NewsRefreshReason = "refresh" | "checkForUpdates";

type NewsApiResponse = {
  articles: NewsItem[];
  feedStatus?: { failedFeeds: number; staleFeeds: number };
};

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
  options: { signal?: AbortSignal; onWarning?: (message: string | null) => void } = {},
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
  options.onWarning?.(data.feedStatus?.failedFeeds ? `${data.feedStatus.failedFeeds} feeds are unavailable. Showing available and recent cached stories.` : null);
  return data.articles;
}

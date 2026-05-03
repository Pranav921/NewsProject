import type { NewsItem } from "./types";

type NewsRefreshReason = "refresh" | "checkForUpdates";

type NewsApiResponse = {
  articles: NewsItem[];
};

export function buildNewsRequestUrl(
  reason: NewsRefreshReason,
  timestamp = Date.now(),
): string {
  const searchParams = new URLSearchParams({
    fresh: "1",
    t: String(timestamp),
  });

  if (reason === "refresh") {
    searchParams.set("refresh", "1");
  } else {
    searchParams.set("checkForUpdates", "1");
  }

  return `/api/news?${searchParams.toString()}`;
}

export async function fetchLatestNews(
  reason: NewsRefreshReason,
): Promise<NewsItem[]> {
  const response = await fetch(buildNewsRequestUrl(reason), {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`News refresh failed with status ${response.status}`);
  }

  const data = (await response.json()) as NewsApiResponse;
  return data.articles;
}

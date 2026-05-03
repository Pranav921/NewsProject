import type { NewsItem } from "./types.ts";

export function buildNewsApiPayload(articles: NewsItem[]) {
  return { articles };
}

export function shouldBypassNewsCache(searchParams: URLSearchParams): boolean {
  return ["1", "true"].includes(searchParams.get("fresh") ?? "") ||
    ["1", "true"].includes(searchParams.get("refresh") ?? "") ||
    ["1", "true"].includes(searchParams.get("checkForUpdates") ?? "");
}

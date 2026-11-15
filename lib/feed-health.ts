import { NEWS_CATEGORIES } from "./news-categories.ts";
import type { FeedIssue, FeedStatus } from "./types.ts";

export type FeedHealthRow = { source: string; topics: Array<{ label: string; state: FeedIssue["state"]; lastSuccessAt: string | null }> };
export type FeedHealthSummary = { tone: "unavailable" | "stale" | "mixed"; headline: string; detail: string; rows: FeedHealthRow[] };

const topicLabel = (topic: string) =>
  topic === "headlines" ? "Top stories" : NEWS_CATEGORIES.find((category) => category.value === topic)?.label ?? topic;
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Turns server feed health into calm, accurate copy. Returns null when every feed
// is fine. Wording never implies the whole site is down: stories are still shown.
export function summarizeFeedHealth(status: FeedStatus | null | undefined): FeedHealthSummary | null {
  if (!status || status.failedFeeds <= 0) return null;
  const issues = status.issues ?? [];
  const staleCount = issues.length ? issues.filter((issue) => issue.state === "stale").length : status.staleFeeds;
  const unavailableCount = issues.length ? issues.length - staleCount : Math.max(0, status.failedFeeds - status.staleFeeds);

  const rows: FeedHealthRow[] = [];
  for (const issue of issues) {
    let row = rows.find((entry) => entry.source === issue.source);
    if (!row) rows.push(row = { source: issue.source, topics: [] });
    row.topics.push({ label: topicLabel(issue.topic), state: issue.state, lastSuccessAt: issue.lastSuccessAt });
  }
  const publishers = rows.length;

  if (unavailableCount && staleCount) {
    return { tone: "mixed", rows,
      headline: publishers ? `Some updates from ${plural(publishers, "source", "sources")} are delayed` : "Some news feeds are delayed",
      detail: "Showing the latest available news." };
  }
  if (staleCount) {
    return { tone: "stale", rows,
      headline: publishers ? `${plural(publishers, "source hasn't", "sources haven't")} refreshed recently` : `${plural(staleCount, "feed hasn't", "feeds haven't")} refreshed recently`,
      detail: "Their latest stories are still shown." };
  }
  return { tone: "unavailable", rows,
    headline: publishers ? `${plural(publishers, "source is", "sources are")} temporarily unavailable` : `${plural(unavailableCount, "feed is", "feeds are")} temporarily unavailable`,
    detail: "Showing the latest from all other sources." };
}

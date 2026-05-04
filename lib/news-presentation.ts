import { getFeedCoverage } from "@/lib/feeds";
import type { NewsItem } from "@/lib/types";

const BREAKING_TITLE_PATTERN =
  /\b(breaking|urgent|launches|missile|strike|earthquake|evacuation|war|attack|explosion)\b/i;

export function isBreakingStory(article: NewsItem): boolean {
  return BREAKING_TITLE_PATTERN.test(article.title);
}

export function getCoverageLabel(source: string): string {
  const coverage = getFeedCoverage(source);

  if (coverage === "national") {
    return "U.S. News";
  }

  if (coverage === "international") {
    return "World News";
  }

  return "Global";
}

export function formatPublishedDate(publishedAt: string | null): string {
  if (!publishedAt) {
    return "Date unavailable";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(publishedAt));
}

export function formatPublishedCompact(publishedAt: string | null): string {
  if (!publishedAt) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "2-digit",
    hour: "numeric",
    minute: "2-digit",
  })
    .format(new Date(publishedAt))
    .replace(",", "");
}

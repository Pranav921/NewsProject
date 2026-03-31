import type { NewsItem } from "@/lib/types";

export const CUSTOM_ALERT_KEYWORDS_STORAGE_KEY =
  "breaking-news-custom-alert-keywords";

export function normalizeAlertKeyword(keyword: string): string {
  return keyword.trim().toLowerCase();
}

export function parseAlertKeywords(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsedValue = JSON.parse(value) as unknown;

    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return [...new Set(parsedValue.filter(isAlertKeyword).map(normalizeAlertKeyword))]
      .filter(Boolean);
  } catch {
    return [];
  }
}

export function addAlertKeyword(
  alertKeywords: string[],
  keyword: string,
): string[] {
  const normalizedKeyword = normalizeAlertKeyword(keyword);

  if (!normalizedKeyword || alertKeywords.includes(normalizedKeyword)) {
    return alertKeywords;
  }

  return [...alertKeywords, normalizedKeyword];
}

export function removeAlertKeyword(
  alertKeywords: string[],
  keywordToRemove: string,
): string[] {
  const normalizedKeywordToRemove = normalizeAlertKeyword(keywordToRemove);

  return alertKeywords.filter((keyword) => keyword !== normalizedKeywordToRemove);
}

export function articleMatchesAlertKeywords(
  article: NewsItem,
  alertKeywords: string[],
): boolean {
  if (alertKeywords.length === 0) {
    return false;
  }

  const searchableText = [article.title, article.summary ?? ""]
    .join(" ")
    .toLowerCase();

  return alertKeywords.some((keyword) => searchableText.includes(keyword));
}

function isAlertKeyword(value: unknown): value is string {
  return typeof value === "string";
}

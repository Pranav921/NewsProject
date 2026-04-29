import type { NewsItem } from "@/lib/types";

const URGENCY_WORDS = ["breaking", "announces", "launches", "reveals", "urgent"];

export type SmartAlertImportance = "important" | "normal";

export type SmartAlertMatchResult = {
  matchedKeywords: string[];
  status: "match" | "none";
  importance: SmartAlertImportance | null;
};

export function getSmartAlertMatch(
  article: NewsItem,
  alertKeywords: string[],
): SmartAlertMatchResult {
  const normalizedKeywords = Array.from(
    new Set(
      alertKeywords
        .map((keyword) => keyword.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  if (normalizedKeywords.length === 0) {
    return {
      matchedKeywords: [],
      status: "none",
      importance: null,
    };
  }

  const normalizedTitle = article.title.toLowerCase();
  const normalizedSummary = (article.summary ?? "").toLowerCase();
  const matchedKeywords = normalizedKeywords.filter(
    (keyword) =>
      normalizedTitle.includes(keyword) || normalizedSummary.includes(keyword),
  );

  if (matchedKeywords.length === 0) {
    return {
      matchedKeywords: [],
      status: "none",
      importance: null,
    };
  }

  const hasTitleKeyword = matchedKeywords.some((keyword) =>
    normalizedTitle.includes(keyword),
  );
  const hasUrgentTitle = URGENCY_WORDS.some((word) =>
    normalizedTitle.includes(word),
  );

  return {
    matchedKeywords,
    status: "match",
    // Saved keywords are always the gate. Urgent language can only upgrade
    // an existing keyword match; it can never create a smart alert by itself.
    importance: hasTitleKeyword || hasUrgentTitle ? "important" : "normal",
  };
}

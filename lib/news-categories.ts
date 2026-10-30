import type { NewsCategory, NewsItem, NewsletterSortOrder } from "./types.ts";

// Alphabetical display order is also the newsletter section order.
export const NEWS_CATEGORIES: ReadonlyArray<{ value: NewsCategory; label: string }> = [
  { value: "business", label: "Business" },
  { value: "education", label: "Education" },
  { value: "entertainment", label: "Entertainment & Culture" },
  { value: "environment", label: "Environment" },
  { value: "general", label: "General News" },
  { value: "health", label: "Health" },
  { value: "politics", label: "Politics" },
  { value: "science", label: "Science & Space" },
  { value: "sports", label: "Sports" },
  { value: "technology", label: "Technology" },
];

export function isNewsCategory(value: unknown): value is NewsCategory {
  return NEWS_CATEGORIES.some((category) => category.value === value);
}

export function getArticleCategory(article: Pick<NewsItem, "category">): NewsCategory {
  return isNewsCategory(article.category) ? article.category : "general";
}

export function getCategoryLabel(category: NewsCategory): string {
  return NEWS_CATEGORIES.find((entry) => entry.value === category)?.label ?? "General News";
}

// Match publisher topic metadata, never guess a topic from headline keywords.
export function categoryFromPublisherLabels(labels: string[]): NewsCategory {
  const aliases: Array<[NewsCategory, RegExp]> = [
    ["technology", /\b(technology|tech|artificial intelligence|computing)\b/i],
    ["business", /\b(business|economy|economics|finance|markets)\b/i],
    ["politics", /\b(politics|political|elections)\b/i],
    ["health", /\b(health|medicine|medical|wellness)\b/i],
    ["environment", /\b(environment|climate|sustainability)\b/i],
    ["science", /\b(science|space|astronomy)\b/i],
    ["sports", /\b(sport|sports|football|basketball|baseball)\b/i],
    ["entertainment", /\b(entertainment|culture|arts|film|music)\b/i],
    ["education", /\b(education|schools|universities)\b/i],
  ];
  for (const label of labels) {
    const match = aliases.find(([, pattern]) => pattern.test(label));
    if (match) return match[0];
  }
  return "general";
}

export function filterArticlesByCategory<T extends Pick<NewsItem, "category">>(articles: T[], category: NewsCategory | "all"): T[] {
  return category === "all" ? articles : articles.filter((article) => getArticleCategory(article) === category);
}

export function orderNewsletterArticles(articles: NewsItem[], sortOrder: NewsletterSortOrder = "default"): NewsItem[] {
  if (sortOrder !== "category") return [...articles];
  const order = new Map(NEWS_CATEGORIES.map((category, index) => [category.value, index]));
  // Stable sort retains recency/personalization order within each section.
  return [...articles].sort((left, right) => order.get(getArticleCategory(left))! - order.get(getArticleCategory(right))!);
}

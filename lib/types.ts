export type FeedDefinition = {
  name: string;
  url: string;
};

export type NewsItem = {
  title: string;
  link: string;
  source: string;
  summary: string | null;
  publishedAt: string | null;
};

export type SavedArticle = NewsItem;

export type UserPreferences = {
  defaultSourceFilter: string;
  defaultTimeFilter: string;
  defaultViewMode: "standard" | "compact";
};

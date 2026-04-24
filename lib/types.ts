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

export type NewsletterArticleMode = "all_missed" | "personalized";
export type NewsletterEmailFormat = "standard" | "compact";
export type NewsletterFrequency = "hourly" | "daily" | "weekly" | "custom";

export type UserPreferences = {
  defaultSourceFilter: string;
  defaultTimeFilter: string;
  defaultViewMode: "standard" | "compact";
};

export type EmailSendLog = {
  articleCount: number | null;
  error: string | null;
  sentAt: string;
  status: "failed" | "sent" | "skipped";
};

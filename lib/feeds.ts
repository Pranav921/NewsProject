import type { CoverageFilter, FeedDefinition } from "@/lib/types";

// Keep feed URLs and coverage metadata in one place so source expansion and
// future filter work stay easy to maintain.
export const RSS_FEEDS: FeedDefinition[] = [
  {
    coverage: "international",
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
  },
  {
    coverage: "both",
    name: "The New York Times",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  },
  {
    coverage: "both",
    name: "NPR",
    url: "https://feeds.npr.org/1001/rss.xml",
  },
  {
    coverage: "international",
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
  },
  {
    coverage: "both",
    name: "CNN",
    url: "https://rss.cnn.com/rss/cnn_topstories.rss",
  },
  {
    coverage: "national",
    name: "CBS News",
    url: "https://www.cbsnews.com/latest/rss/main",
  },
  {
    coverage: "national",
    name: "NBC News",
    url: "https://feeds.nbcnews.com/nbcnews/public/news",
  },
  {
    coverage: "national",
    name: "USA Today",
    url: "https://rssfeeds.usatoday.com/usatoday-NewsTopStories",
  },
  {
    coverage: "national",
    name: "Reuters U.S.",
    url: "https://feeds.reuters.com/Reuters/domesticNews",
  },
  {
    coverage: "international",
    name: "Reuters World",
    url: "https://feeds.reuters.com/Reuters/worldNews",
  },
  {
    coverage: "international",
    name: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
  },
  {
    coverage: "international",
    name: "Sky News",
    url: "https://feeds.skynews.com/feeds/rss/home.xml",
  },
];

const FEED_COVERAGE_BY_SOURCE = new Map(
  RSS_FEEDS.map((feed) => [feed.name, feed.coverage] as const),
);

export function getFeedCoverage(source: string) {
  return FEED_COVERAGE_BY_SOURCE.get(source) ?? "both";
}

export function filterArticlesByCoverage<T extends { source: string }>(
  articles: T[],
  coverageFilter: CoverageFilter,
) {
  if (coverageFilter === "all") {
    return articles;
  }

  return articles.filter((article) => {
    const coverage = getFeedCoverage(article.source);

    return coverage === "both" || coverage === coverageFilter;
  });
}

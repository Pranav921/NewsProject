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
  // Topic feeds retain publisher names so source preferences and paywall labels stay stable.
  {
    "name": "BBC News",
    "category": "technology",
    "url": "https://feeds.bbci.co.uk/news/technology/rss.xml",
    "coverage": "both"
  },
  {
    "name": "BBC News",
    "category": "business",
    "url": "https://feeds.bbci.co.uk/news/business/rss.xml",
    "coverage": "both"
  },
  {
    "name": "BBC News",
    "category": "health",
    "url": "https://feeds.bbci.co.uk/news/health/rss.xml",
    "coverage": "both"
  },
  {
    "name": "BBC News",
    "category": "science",
    "url": "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml",
    "coverage": "both"
  },
  {
    "name": "The Guardian",
    "category": "technology",
    "url": "https://www.theguardian.com/technology/rss",
    "coverage": "both"
  },
  {
    "name": "The Guardian",
    "category": "business",
    "url": "https://www.theguardian.com/business/rss",
    "coverage": "both"
  },
  {
    "name": "The Guardian",
    "category": "environment",
    "url": "https://www.theguardian.com/environment/rss",
    "coverage": "both"
  },
  {
    "name": "The Guardian",
    "category": "sports",
    "url": "https://www.theguardian.com/sport/rss",
    "coverage": "both"
  },
  {
    "name": "The Guardian",
    "category": "entertainment",
    "url": "https://www.theguardian.com/culture/rss",
    "coverage": "both"
  },
  {
    "name": "The Guardian",
    "category": "education",
    "url": "https://www.theguardian.com/education/rss",
    "coverage": "both"
  },
  {
    "name": "NPR",
    "category": "politics",
    "url": "https://feeds.npr.org/1014/rss.xml",
    "coverage": "national"
  },
  {
    "name": "NPR",
    "category": "health",
    "url": "https://feeds.npr.org/1128/rss.xml",
    "coverage": "both"
  },
  {
    "name": "Ars Technica",
    "category": "technology",
    "url": "https://feeds.arstechnica.com/arstechnica/index",
    "coverage": "both"
  },
  {
    "name": "TechCrunch",
    "category": "technology",
    "url": "https://techcrunch.com/feed/",
    "coverage": "both"
  },
  {
    "name": "NASA",
    "category": "science",
    "url": "https://www.nasa.gov/feed/",
    "coverage": "both"
  },
  {
    "name": "ScienceDaily",
    "category": "science",
    "url": "https://www.sciencedaily.com/rss/top/science.xml",
    "coverage": "both"
  },
  {
    "name": "PBS NewsHour",
    "category": "general",
    "url": "https://www.pbs.org/newshour/feeds/rss/headlines",
    "coverage": "both"
  },
  {
    "name": "Deutsche Welle",
    "category": "general",
    "url": "https://rss.dw.com/rdf/rss-en-all",
    "coverage": "international"
  },
];

const FEED_COVERAGE_BY_SOURCE = new Map(
  RSS_FEEDS.filter((feed) => !feed.category || feed.category === "general").map((feed) => [feed.name, feed.coverage] as const),
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

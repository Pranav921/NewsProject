import type { FeedDefinition } from "@/lib/types";

// Keep feed URLs in one place so it is easy to add or remove sources later.
export const RSS_FEEDS: FeedDefinition[] = [
  {
    name: "BBC News",
    url: "https://feeds.bbci.co.uk/news/rss.xml",
  },
  {
    name: "The New York Times",
    url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml",
  },
  {
    name: "NPR",
    url: "https://feeds.npr.org/1001/rss.xml",
  },
  {
    name: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
  },
];

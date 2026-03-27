import { RSS_FEEDS } from "@/lib/feeds";
import { normalizeArticleLink } from "@/lib/news-updates";
import type { FeedDefinition, NewsItem } from "@/lib/types";

function stripCdata(value: string): string {
  return value.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    // Some feeds use named entities like &apos; while others use numeric
    // versions like &#39;, so we handle both here in one beginner-friendly
    // place.
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function decodeEntitiesDeep(value: string): string {
  let decodedValue = value;

  // Some feeds escape HTML more than once, so we decode a few times until the
  // text stops changing.
  for (let index = 0; index < 3; index += 1) {
    const nextValue = decodeEntities(decodedValue);

    if (nextValue === decodedValue) {
      break;
    }

    decodedValue = nextValue;
  }

  return decodedValue;
}

function stripHtml(value: string): string {
  return decodeEntitiesDeep(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanSummary(value: string): string {
  return decodeEntitiesDeep(value)
    // Remove any HTML tags after decoding, including escaped tags like
    // &lt;p&gt; that become real tags during the decode step.
    .replace(/<[^>]+>/g, " ")
    // Feeds sometimes include raw URLs in summaries, especially inside links.
    // Removing them keeps the text short and easier to read.
    .replace(/https?:\/\/\S+/gi, " ")
    // Collapse repeated spaces and line breaks into normal sentence spacing.
    .replace(/\s+/g, " ")
    .trim();
}

function truncateSummary(summary: string, maxLength = 220): string | null {
  const minimumSummaryLength = 50;

  if (!summary) {
    return null;
  }

  // Very short summaries usually read like broken fragments, so it is clearer
  // to treat them as missing and let the UI show a fallback message.
  if (summary.length < minimumSummaryLength) {
    return null;
  }

  if (summary.length <= maxLength) {
    return summary;
  }

  // First choice: end on a full sentence if we can do that without making the
  // summary too short.
  const trimmedSummary = summary.slice(0, maxLength).trim();
  const lastPeriodIndex = trimmedSummary.lastIndexOf(".");

  if (lastPeriodIndex >= minimumSummaryLength) {
    return trimmedSummary.slice(0, lastPeriodIndex + 1).trim();
  }

  // Second choice: stop at the last whole word so we avoid cutting a word in
  // half, then add an ellipsis because the sentence is incomplete.
  const lastSpaceIndex = trimmedSummary.lastIndexOf(" ");

  if (lastSpaceIndex >= minimumSummaryLength) {
    return `${trimmedSummary.slice(0, lastSpaceIndex).trim()}...`;
  }

  return `${trimmedSummary}...`;
}

function getFirstTagValue(block: string, tagName: string): string | null {
  const pattern = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = block.match(pattern);

  if (!match?.[1]) {
    return null;
  }

  return stripCdata(match[1]).trim();
}

function getAtomLink(block: string): string | null {
  const alternateLinkMatch = block.match(
    /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i,
  );

  if (alternateLinkMatch?.[1]) {
    return alternateLinkMatch[1].trim();
  }

  const anyLinkMatch = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  return anyLinkMatch?.[1]?.trim() ?? null;
}

function getFeedBlocks(xml: string): string[] {
  // RSS usually uses <item>, while Atom usually uses <entry>.
  const itemMatches = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map(
    (match) => match[0],
  );

  if (itemMatches.length > 0) {
    return itemMatches;
  }

  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0]);
}

function parseDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function parseNewsItem(block: string, fallbackSource: string): NewsItem | null {
  const title = stripHtml(getFirstTagValue(block, "title") ?? "");
  const rawLink =
    getFirstTagValue(block, "link")?.trim() ??
    getAtomLink(block) ??
    getFirstTagValue(block, "guid")?.trim() ??
    "";
  const link = normalizeArticleLink(rawLink);
  const summarySource =
    getFirstTagValue(block, "description") ??
    getFirstTagValue(block, "content:encoded") ??
    getFirstTagValue(block, "summary") ??
    getFirstTagValue(block, "content");
  const source =
    stripHtml(getFirstTagValue(block, "source") ?? "") || fallbackSource;
  const publishedAt = parseDate(
    getFirstTagValue(block, "pubDate") ??
      getFirstTagValue(block, "published") ??
      getFirstTagValue(block, "updated") ??
      getFirstTagValue(block, "dc:date"),
  );
  const cleanedSummary = summarySource ? cleanSummary(summarySource) : "";
  const summary = truncateSummary(cleanedSummary);

  if (!title || !link) {
    return null;
  }

  return {
    title,
    link,
    source,
    summary,
    publishedAt,
  };
}

export function parseRssXml(xml: string, feed: FeedDefinition): NewsItem[] {
  const blocks = getFeedBlocks(xml);

  return blocks
    // Turn raw XML blocks into easy-to-render article objects.
    .map((block) => parseNewsItem(block, feed.name))
    .filter((item): item is NewsItem => item !== null);
}

type GetAllNewsItemsOptions = {
  fresh?: boolean;
};

async function fetchFeed(
  feed: FeedDefinition,
  options: GetAllNewsItemsOptions = {},
): Promise<NewsItem[]> {
  try {
    const isDevelopment = process.env.NODE_ENV === "development";
    const shouldUseFreshData = isDevelopment || options.fresh === true;
    const fetchOptions: RequestInit & {
      next?: { revalidate: number };
    } = {
      headers: {
        "User-Agent": "breaking-news-site/0.1 (+https://github.com/)",
      },
    };

    if (shouldUseFreshData) {
      // In development, and in places that explicitly ask for fresh data, we
      // skip the fetch cache so RSS checks can see the latest feed contents.
      fetchOptions.cache = "no-store";
    } else {
      // In production we can safely reuse feed responses for an hour.
      fetchOptions.next = { revalidate: 3600 };
    }

    const response = await fetch(feed.url, {
      ...fetchOptions,
    });

    if (!response.ok) {
      console.error(`Failed to fetch ${feed.name}: ${response.status}`);
      return [];
    }

    const xml = await response.text();
    return parseRssXml(xml, feed);
  } catch (error) {
    console.error(`Failed to fetch ${feed.name}`, error);
    return [];
  }
}

function dedupeByLink(items: NewsItem[]): NewsItem[] {
  const seenLinks = new Set<string>();

  return items.filter((item) => {
    // Links make a practical unique key because the same story can appear
    // across multiple feeds.
    const normalizedLink = normalizeArticleLink(item.link);

    if (seenLinks.has(normalizedLink)) {
      return false;
    }

    seenLinks.add(normalizedLink);
    return true;
  });
}

function sortNewestFirst(items: NewsItem[]): NewsItem[] {
  return [...items].sort((left, right) => {
    const leftTime = left.publishedAt ? Date.parse(left.publishedAt) : 0;
    const rightTime = right.publishedAt ? Date.parse(right.publishedAt) : 0;

    return rightTime - leftTime;
  });
}

export async function getAllNewsItems(
  options: GetAllNewsItemsOptions = {},
): Promise<NewsItem[]> {
  const feedResults = await Promise.all(
    RSS_FEEDS.map((feed) => fetchFeed(feed, options)),
  );
  const mergedItems = feedResults.flat();

  // Keep the homepage predictable: no duplicates and newest stories first.
  return sortNewestFirst(dedupeByLink(mergedItems));
}

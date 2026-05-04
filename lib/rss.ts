import { RSS_FEEDS } from "./feeds.ts";
import { normalizeArticleLink } from "./news-updates.ts";
import { cleanSummary, stripCdata, stripHtml } from "./rss-format.ts";
import type { FeedDefinition, NewsItem } from "./types.ts";

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

function normalizeImageUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmedValue = stripCdata(value)
    .replace(/&amp;/g, "&")
    .trim();

  if (!trimmedValue) {
    return null;
  }

  if (trimmedValue.startsWith("//")) {
    return `https:${trimmedValue}`;
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue;
  }

  return null;
}

function upgradeImageUrl(value: string): string {
  let upgradedValue = value;

  // Many publishers expose WordPress-style resized derivatives such as
  // `photo-300x200.jpg`. Prefer the original asset path when possible.
  upgradedValue = upgradedValue.replace(/-\d{2,4}x\d{2,4}(?=\.(?:jpg|jpeg|png|webp))/i, "");

  try {
    const parsedUrl = new URL(upgradedValue);

    if (parsedUrl.searchParams.has("w")) {
      parsedUrl.searchParams.set("w", "1600");
    }
    if (parsedUrl.searchParams.has("width")) {
      parsedUrl.searchParams.set("width", "1600");
    }
    if (parsedUrl.searchParams.has("h")) {
      parsedUrl.searchParams.delete("h");
    }
    if (parsedUrl.searchParams.has("height")) {
      parsedUrl.searchParams.delete("height");
    }
    if (parsedUrl.searchParams.has("q")) {
      parsedUrl.searchParams.set("q", "90");
    }
    if (parsedUrl.searchParams.has("quality")) {
      parsedUrl.searchParams.set("quality", "90");
    }

    upgradedValue = parsedUrl.toString();
  } catch {
    return upgradedValue;
  }

  return upgradedValue;
}

function getFirstAttributeValue(block: string, tagPattern: string, attributeName: string): string | null {
  const pattern = new RegExp(`<${tagPattern}[^>]*\\b${attributeName}=["']([^"']+)["'][^>]*\\/?>`, "i");
  const match = block.match(pattern);

  return normalizeImageUrl(match?.[1] ?? null);
}

function parseSrcsetLargestCandidate(srcset: string): string | null {
  const candidates = srcset
    .split(",")
    .map((candidate) => candidate.trim())
    .map((candidate) => {
      const [urlPart, descriptorPart] = candidate.split(/\s+/, 2);
      const normalizedUrl = normalizeImageUrl(urlPart ?? null);

      if (!normalizedUrl) {
        return null;
      }

      const widthMatch = descriptorPart?.match(/(\d+)w/i);
      const densityMatch = descriptorPart?.match(/(\d+(?:\.\d+)?)x/i);
      const score = widthMatch
        ? Number.parseInt(widthMatch[1], 10)
        : densityMatch
          ? Math.round(Number.parseFloat(densityMatch[1]) * 1000)
          : 0;

      return {
        score,
        url: normalizedUrl,
      };
    })
    .filter((candidate): candidate is { score: number; url: string } => candidate !== null)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.url ?? null;
}

function extractImageFromHtml(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const html = stripCdata(value);
  const srcsetMatch = html.match(/<img\b[^>]*\bsrcset=["']([^"']+)["'][^>]*>/i);
  const srcsetImage = srcsetMatch?.[1] ? parseSrcsetLargestCandidate(srcsetMatch[1]) : null;

  if (srcsetImage) {
    return srcsetImage;
  }

  const imgMatch = html.match(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/i);
  return normalizeImageUrl(imgMatch?.[1] ?? null);
}

function selectLargestMediaImage(block: string): string | null {
  const mediaTagPattern = /<media:(?:content|thumbnail)\b[^>]*\/?>/gi;
  const tags = [...block.matchAll(mediaTagPattern)].map((match) => match[0]);

  const candidates = tags
    .map((tag) => {
      const urlMatch = tag.match(/\burl=["']([^"']+)["']/i);
      const widthMatch = tag.match(/\bwidth=["'](\d+)["']/i);
      const heightMatch = tag.match(/\bheight=["'](\d+)["']/i);
      const normalizedUrl = normalizeImageUrl(urlMatch?.[1] ?? null);

      if (!normalizedUrl) {
        return null;
      }

      const width = widthMatch?.[1] ? Number.parseInt(widthMatch[1], 10) : 0;
      const height = heightMatch?.[1] ? Number.parseInt(heightMatch[1], 10) : 0;

      return {
        score: width * height,
        url: normalizedUrl,
      };
    })
    .filter((candidate): candidate is { score: number; url: string } => candidate !== null)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.url ?? null;
}

function extractImageUrl(block: string, summarySource: string | null): string | null {
  const mediaContentImage =
    selectLargestMediaImage(block) ??
    getFirstAttributeValue(block, "media:content", "url") ??
    getFirstAttributeValue(block, "media:thumbnail", "url");

  if (mediaContentImage) {
    return upgradeImageUrl(mediaContentImage);
  }

  const enclosureBlockMatch = block.match(/<enclosure\b[^>]*\/?>/i);
  const enclosureBlock = enclosureBlockMatch?.[0] ?? null;
  const enclosureTypeMatch = enclosureBlock?.match(/\btype=["'](image\/[^"']+)["']/i);
  const enclosureUrlMatch = enclosureBlock?.match(/\burl=["']([^"']+)["']/i);
  const enclosureImage =
    enclosureTypeMatch?.[1] && enclosureUrlMatch?.[1]
      ? normalizeImageUrl(enclosureUrlMatch[1])
      : null;

  if (enclosureImage) {
    return upgradeImageUrl(enclosureImage);
  }

  const htmlImage = extractImageFromHtml(summarySource);
  return htmlImage ? upgradeImageUrl(htmlImage) : null;
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
  const imageUrl = extractImageUrl(block, summarySource);

  if (!title || !link) {
    return null;
  }

  return {
    title,
    link,
    source,
    summary,
    publishedAt,
    imageUrl,
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

import { getLeadArticle } from "./news-presentation.ts";
import type { NewsItem } from "./types.ts";

function normalizeRemoteUrl(value: string | null, baseUrl: string): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, attributeName: "property" | "name" | "itemprop", attributeValue: string): string | null {
  const escapedValue = attributeValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]*${attributeName}=["']${escapedValue}["'][^>]*content=["']([^"']+)["'][^>]*>`,
    "i",
  );
  const reversePattern = new RegExp(
    `<meta[^>]*content=["']([^"']+)["'][^>]*${attributeName}=["']${escapedValue}["'][^>]*>`,
    "i",
  );

  const match = html.match(pattern) ?? html.match(reversePattern);
  return match?.[1]?.trim() ?? null;
}

function extractJsonLdImage(html: string, articleUrl: string): string | null {
  const scriptMatches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];

  for (const match of scriptMatches) {
    const rawJson = match[1]?.trim();

    if (!rawJson) {
      continue;
    }

    try {
      const parsed = JSON.parse(rawJson);
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];

      while (queue.length > 0) {
        const current = queue.shift();

        if (!current || typeof current !== "object") {
          continue;
        }

        if (Array.isArray(current.image)) {
          for (const imageCandidate of current.image) {
            const normalizedImage =
              typeof imageCandidate === "string"
                ? normalizeRemoteUrl(imageCandidate, articleUrl)
                : typeof imageCandidate === "object" && imageCandidate !== null && "url" in imageCandidate
                  ? normalizeRemoteUrl(String(imageCandidate.url), articleUrl)
                  : null;

            if (normalizedImage) {
              return normalizedImage;
            }
          }
        }

        if (typeof current.image === "string") {
          const normalizedImage = normalizeRemoteUrl(current.image, articleUrl);

          if (normalizedImage) {
            return normalizedImage;
          }
        }

        for (const value of Object.values(current)) {
          if (value && typeof value === "object") {
            queue.push(value);
          }
        }
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractLargestSrcsetCandidate(tagSource: string): string | null {
  const srcsetMatch = tagSource.match(/\bsrcset=["']([^"']+)["']/i);

  if (!srcsetMatch?.[1]) {
    return null;
  }

  const candidates = srcsetMatch[1]
    .split(",")
    .map((candidate) => candidate.trim())
    .map((candidate) => {
      const [urlPart, descriptorPart] = candidate.split(/\s+/, 2);

      if (!urlPart) {
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
        url: urlPart,
      };
    })
    .filter((candidate): candidate is { score: number; url: string } => candidate !== null)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.url ?? null;
}

function extractLeadImageFromArticleHtml(html: string, articleUrl: string): string | null {
  const metaCandidates = [
    extractMetaContent(html, "property", "og:image"),
    extractMetaContent(html, "property", "og:image:secure_url"),
    extractMetaContent(html, "property", "og:image:url"),
    extractMetaContent(html, "name", "twitter:image"),
    extractMetaContent(html, "name", "twitter:image:src"),
    extractMetaContent(html, "itemprop", "image"),
  ];

  for (const candidate of metaCandidates) {
    const normalized = normalizeRemoteUrl(candidate, articleUrl);

    if (normalized) {
      return normalized;
    }
  }

  const jsonLdImage = extractJsonLdImage(html, articleUrl);

  if (jsonLdImage) {
    return jsonLdImage;
  }

  const imgTagMatches = [...html.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);

  for (const imgTag of imgTagMatches) {
    const srcsetImage = extractLargestSrcsetCandidate(imgTag);
    const directImage =
      srcsetImage ??
      imgTag.match(/\bdata-lazy-src=["']([^"']+)["']/i)?.[1] ??
      imgTag.match(/\bdata-src=["']([^"']+)["']/i)?.[1] ??
      imgTag.match(/\bsrc=["']([^"']+)["']/i)?.[1] ??
      null;
    const normalizedImage = normalizeRemoteUrl(directImage, articleUrl);

    if (normalizedImage) {
      return normalizedImage;
    }
  }

  return null;
}

async function fetchLeadImageFromArticle(articleUrl: string): Promise<string | null> {
  try {
    const response = await fetch(articleUrl, {
      headers: {
        "User-Agent": "breaking-news-site/0.1 (+https://github.com/)",
      },
      next: { revalidate: 21600 },
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return extractLeadImageFromArticleHtml(html, articleUrl);
  } catch {
    return null;
  }
}

export async function enhanceLeadArticleImage(articles: NewsItem[]): Promise<NewsItem[]> {
  const leadArticle = getLeadArticle(articles);

  if (!leadArticle) {
    return articles;
  }

  const enhancedImageUrl = await fetchLeadImageFromArticle(leadArticle.link);

  if (!enhancedImageUrl || enhancedImageUrl === leadArticle.imageUrl) {
    return articles;
  }

  return articles.map((article) =>
    article.link === leadArticle.link
      ? {
          ...article,
          imageUrl: enhancedImageUrl,
        }
      : article,
  );
}

export { extractLeadImageFromArticleHtml };

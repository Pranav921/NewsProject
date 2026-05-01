export const PENDING_PREVIOUS_LINKS_KEY = "breaking-news-previous-links";
export const PENDING_NEW_ARTICLE_LINKS_KEY = "breaking-news-pending-new-links";
export const HANDLED_NEW_ARTICLE_LINKS_KEY = "breaking-news-handled-new-links";

export function normalizeArticleLink(link: string): string {
  const trimmedLink = link.trim();

  if (!trimmedLink) {
    return "";
  }

  try {
    const parsedUrl = new URL(trimmedLink);

    parsedUrl.hash = "";
    parsedUrl.pathname = parsedUrl.pathname.replace(/\/+$/, "") || "/";

    return parsedUrl.toString();
  } catch {
    return trimmedLink.replace(/\/+$/, "");
  }
}

export function getNewArticleLinks(
  previousLinks: string[],
  latestLinks: string[],
): string[] {
  const previousLinkSet = new Set(previousLinks.map(normalizeArticleLink));
  const seenNewNormalizedLinks = new Set<string>();

  // Compare the full previous list with the full latest list and keep every
  // truly new canonical link exactly once, even if feeds disagree about
  // trailing slashes or other normalizable URL differences.
  return latestLinks.filter((link) => {
    const normalizedLink = normalizeArticleLink(link);

    if (!normalizedLink || previousLinkSet.has(normalizedLink)) {
      return false;
    }

    if (seenNewNormalizedLinks.has(normalizedLink)) {
      return false;
    }

    seenNewNormalizedLinks.add(normalizedLink);
    return true;
  });
}

export function resolveCurrentLinks(
  currentLinks: string[],
  targetLinks: string[],
): string[] {
  const currentLinkMap = new Map(
    currentLinks.map((link) => [normalizeArticleLink(link), link]),
  );

  return targetLinks.flatMap((targetLink) => {
    const matchingCurrentLink = currentLinkMap.get(normalizeArticleLink(targetLink));
    return matchingCurrentLink ? [matchingCurrentLink] : [];
  });
}

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

  // Compare the full previous list with the full latest list and keep every
  // truly new link. Wrapping the result in a Set avoids accidental duplicates.
  return [
    ...new Set(
      latestLinks.filter(
        (link) => !previousLinkSet.has(normalizeArticleLink(link)),
      ),
    ),
  ];
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

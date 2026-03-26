export const PENDING_PREVIOUS_LINKS_KEY = "breaking-news-previous-links";
export const PENDING_NEW_ARTICLE_LINKS_KEY = "breaking-news-pending-new-links";

export function getNewArticleLinks(
  previousLinks: string[],
  latestLinks: string[],
): string[] {
  const previousLinkSet = new Set(previousLinks);

  // Compare the full previous list with the full latest list and keep every
  // truly new link. Wrapping the result in a Set avoids accidental duplicates.
  return [...new Set(latestLinks.filter((link) => !previousLinkSet.has(link)))];
}

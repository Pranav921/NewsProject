"use client";

import {
  getNewArticleLinks,
  HANDLED_NEW_ARTICLE_LINKS_KEY,
  normalizeArticleLink,
} from "@/lib/news-updates";
import { fetchLatestNews } from "@/lib/news-client";
import { useEffect, useState } from "react";

type NewArticlesPromptProps = {
  initialLinks: string[];
  onPendingCountChange?: (count: number) => void;
  onPendingLinksChange?: (links: string[]) => void;
};

export function NewArticlesPrompt({
  initialLinks,
  onPendingCountChange,
  onPendingLinksChange,
}: NewArticlesPromptProps) {
  const [newArticleLinks, setNewArticleLinks] = useState<string[]>([]);

  useEffect(() => {
    let isCancelled = false;

    async function checkForNewArticles() {
      try {
        const handledNewLinks = JSON.parse(
          sessionStorage.getItem(HANDLED_NEW_ARTICLE_LINKS_KEY) ?? "[]",
        ) as string[];
        const handledNewLinkSet = new Set(
          handledNewLinks.map(normalizeArticleLink),
        );
        const normalizedInitialLinks = new Set(
          initialLinks.map(normalizeArticleLink),
        );

        if (
          handledNewLinks.length > 0 &&
          handledNewLinks.every((link) =>
            normalizedInitialLinks.has(normalizeArticleLink(link)),
          )
        ) {
          sessionStorage.removeItem(HANDLED_NEW_ARTICLE_LINKS_KEY);
        }

        const latestArticles = await fetchLatestNews("checkForUpdates");
        const latestLinks = latestArticles.map((article) => article.link);
        const detectedNewLinks = getNewArticleLinks(initialLinks, latestLinks)
          .filter((link) => !handledNewLinkSet.has(normalizeArticleLink(link)));

        if (!isCancelled) {
          setNewArticleLinks(detectedNewLinks);
        }
      } catch {
        // Ignore temporary network errors and try again on the next check.
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void checkForNewArticles();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Poll every minute while the page stays open so returning users can still
    // see the prompt even if the tab never fully loses visibility.
    const pollInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkForNewArticles();
      }
    }, 60_000);

    // Run one check on mount so the prompt can recover even if the page stayed
    // visible the whole time.
    void checkForNewArticles();

    return () => {
      isCancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(pollInterval);
    };
  }, [initialLinks]);

  const newArticleCount = newArticleLinks.length;

  useEffect(() => {
    onPendingCountChange?.(newArticleCount);
  }, [newArticleCount, onPendingCountChange]);

  useEffect(() => {
    onPendingLinksChange?.(newArticleLinks);
  }, [newArticleLinks, onPendingLinksChange]);

  return null;
}

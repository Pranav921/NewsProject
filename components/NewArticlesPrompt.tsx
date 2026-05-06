"use client";

import {
  getNewArticleLinks,
  HANDLED_NEW_ARTICLE_LINKS_KEY,
  normalizeArticleLink,
} from "@/lib/news-updates";
import { fetchLatestNews } from "@/lib/news-client";
import { useEffect, useMemo, useRef, useState } from "react";

type NewArticlesPromptProps = {
  initialLinks: string[];
  onPendingCountChange?: (count: number) => void;
  onPendingLinksChange?: (links: string[]) => void;
};

const POLL_INTERVAL_MS = 180_000;

export function NewArticlesPrompt({
  initialLinks,
  onPendingCountChange,
  onPendingLinksChange,
}: NewArticlesPromptProps) {
  const [newArticleLinks, setNewArticleLinks] = useState<string[]>([]);
  const initialLinksRef = useRef(initialLinks);
  const initialLinksKey = useMemo(
    () => initialLinks.map(normalizeArticleLink).join("|"),
    [initialLinks],
  );

  useEffect(() => {
    initialLinksRef.current = initialLinks;
  });

  useEffect(() => {
    let isCancelled = false;

    async function checkForNewArticles() {
      try {
        const currentInitialLinks = initialLinksRef.current;
        const handledNewLinks = JSON.parse(
          sessionStorage.getItem(HANDLED_NEW_ARTICLE_LINKS_KEY) ?? "[]",
        ) as string[];
        const handledNewLinkSet = new Set(
          handledNewLinks.map(normalizeArticleLink),
        );
        const normalizedInitialLinks = new Set(
          currentInitialLinks.map(normalizeArticleLink),
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
        const detectedNewLinks = getNewArticleLinks(
          currentInitialLinks,
          latestLinks,
        ).filter((link) => !handledNewLinkSet.has(normalizeArticleLink(link)));

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

    // Poll every three minutes while the page stays open so the prompt stays
    // reasonably fresh without feeling noisy or flickery.
    const pollInterval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void checkForNewArticles();
      }
    }, POLL_INTERVAL_MS);

    // Run one check on mount so the prompt can recover even if the page stayed
    // visible the whole time.
    void checkForNewArticles();

    return () => {
      isCancelled = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(pollInterval);
    };
  }, [initialLinksKey]);

  const newArticleCount = newArticleLinks.length;

  useEffect(() => {
    onPendingCountChange?.(newArticleCount);
  }, [newArticleCount, onPendingCountChange]);

  useEffect(() => {
    onPendingLinksChange?.(newArticleLinks);
  }, [newArticleLinks, onPendingLinksChange]);

  return null;
}

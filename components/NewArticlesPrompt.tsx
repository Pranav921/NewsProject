"use client";

import {
  getNewArticleLinks,
  HANDLED_NEW_ARTICLE_LINKS_KEY,
  normalizeArticleLink,
  PENDING_NEW_ARTICLE_LINKS_KEY,
  PENDING_PREVIOUS_LINKS_KEY,
} from "@/lib/news-updates";
import type { NewsItem } from "@/lib/types";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

type NewArticlesPromptProps = {
  initialLinks: string[];
};

type NewsApiResponse = {
  articles: NewsItem[];
};

export function NewArticlesPrompt({
  initialLinks,
}: NewArticlesPromptProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [newArticleLinks, setNewArticleLinks] = useState<string[]>([]);
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function checkForNewArticles() {
      try {
        if (isPending) {
          return;
        }

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

        const response = await fetch("/api/news", {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const data: NewsApiResponse = await response.json();
        const latestLinks = data.articles.map((article) => article.link);
        const detectedNewLinks = getNewArticleLinks(initialLinks, latestLinks)
          .filter((link) => !handledNewLinkSet.has(normalizeArticleLink(link)));
        const detectedSignature = detectedNewLinks.join("|");

        if (!isCancelled) {
          setNewArticleLinks(detectedNewLinks);

          // If the set of new links changes, clear the previous dismissal so a
          // brand new notification can be shown again.
          if (detectedSignature !== dismissedSignature) {
            setDismissedSignature(null);
          }
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
  }, [dismissedSignature, initialLinks, isPending]);

  function handleRefresh() {
    sessionStorage.setItem(
      PENDING_PREVIOUS_LINKS_KEY,
      JSON.stringify(initialLinks),
    );
    sessionStorage.setItem(
      PENDING_NEW_ARTICLE_LINKS_KEY,
      JSON.stringify(newArticleLinks),
    );
    sessionStorage.setItem(
      HANDLED_NEW_ARTICLE_LINKS_KEY,
      JSON.stringify(newArticleLinks),
    );

    startTransition(() => {
      router.refresh();
    });
  }

  const newArticleCount = newArticleLinks.length;
  const notificationSignature = newArticleLinks.join("|");
  const isDismissed = newArticleCount > 0 && dismissedSignature === notificationSignature;
  const isShowingNotification = newArticleCount > 0 && !isDismissed;

  if (!isShowingNotification) {
    return null;
  }

  return (
    <div className="mt-6 rounded-[1.5rem] border border-sky-200 bg-[linear-gradient(135deg,#eff6ff_0%,#f8fbff_100%)] p-4 shadow-[0_14px_30px_rgba(14,116,144,0.08)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            New stories ready
          </p>
          <p className="mt-1 text-sm leading-6 text-slate-700">
          {newArticleCount} new {newArticleCount === 1 ? "article has" : "articles have"}{" "}
          been added. Would you like to see {newArticleCount === 1 ? "it" : "them"}?
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            type="button"
            onClick={handleRefresh}
            disabled={isPending}
          >
            {isPending ? "Refreshing..." : "Refresh"}
          </button>

          <button
            className="inline-flex min-h-11 items-center justify-center rounded-2xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            type="button"
            onClick={() => setDismissedSignature(notificationSignature)}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

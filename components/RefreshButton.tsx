"use client";

import {
  HANDLED_NEW_ARTICLE_LINKS_KEY,
  PENDING_NEW_ARTICLE_LINKS_KEY,
  preparePendingNewArticleRefresh,
} from "@/lib/news-updates";
import { useRouter } from "next/navigation";
import { useState } from "react";

type RefreshButtonProps = {
  className?: string;
  currentLinks?: string[];
  label?: string;
  onRefresh?: () => Promise<void> | void;
};

export function RefreshButton({
  className,
  currentLinks = [],
  label = "Refresh news",
  onRefresh,
}: RefreshButtonProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    // Save the full list of links before refreshing so the next render can
    // compare against it and highlight every newly added article.
    preparePendingNewArticleRefresh(currentLinks, []);
    sessionStorage.removeItem(HANDLED_NEW_ARTICLE_LINKS_KEY);
    sessionStorage.removeItem(PENDING_NEW_ARTICLE_LINKS_KEY);
    setIsRefreshing(true);

    try {
      if (onRefresh) {
        await onRefresh();
      } else {
        // router.refresh() asks Next.js to refetch the current route on the server.
        // That lets us refresh the feed data without restarting the dev server.
        router.refresh();
      }
    } catch {
      router.refresh();
    } finally {
      setIsRefreshing(false);
    }
  }

  return (
    <button
      aria-label="Refresh headlines"
      className={`inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2 font-sans text-sm font-medium tracking-normal text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--text-sub)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 ${className ?? ""}`}
      type="button"
      onClick={handleRefresh}
      disabled={isRefreshing}
    >
      {isRefreshing ? "Refreshing..." : label}
    </button>
  );
}

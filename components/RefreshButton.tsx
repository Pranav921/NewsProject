"use client";

import {
  HANDLED_NEW_ARTICLE_LINKS_KEY,
  PENDING_NEW_ARTICLE_LINKS_KEY,
  PENDING_PREVIOUS_LINKS_KEY,
} from "@/lib/news-updates";
import { useRouter } from "next/navigation";
import { useState } from "react";

type RefreshButtonProps = {
  className?: string;
  currentLinks?: string[];
  onRefresh?: () => Promise<void> | void;
};

export function RefreshButton({
  className,
  currentLinks = [],
  onRefresh,
}: RefreshButtonProps) {
  const router = useRouter();
  const [isRefreshing, setIsRefreshing] = useState(false);

  async function handleRefresh() {
    // Save the full list of links before refreshing so the next render can
    // compare against it and highlight every newly added article.
    sessionStorage.setItem(
      PENDING_PREVIOUS_LINKS_KEY,
      JSON.stringify(currentLinks),
    );
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
      className={`inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70 ${className ?? ""}`}
      type="button"
      onClick={handleRefresh}
      disabled={isRefreshing}
    >
      {isRefreshing ? "Refreshing..." : "Refresh news"}
    </button>
  );
}

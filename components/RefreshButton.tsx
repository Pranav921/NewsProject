"use client";

import {
  HANDLED_NEW_ARTICLE_LINKS_KEY,
  PENDING_NEW_ARTICLE_LINKS_KEY,
  PENDING_PREVIOUS_LINKS_KEY,
} from "@/lib/news-updates";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

type RefreshButtonProps = {
  className?: string;
  currentLinks?: string[];
  onRefresh?: () => void;
};

export function RefreshButton({
  className,
  currentLinks = [],
  onRefresh,
}: RefreshButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    // Save the full list of links before refreshing so the next render can
    // compare against it and highlight every newly added article.
    sessionStorage.setItem(
      PENDING_PREVIOUS_LINKS_KEY,
      JSON.stringify(currentLinks),
    );
    sessionStorage.removeItem(HANDLED_NEW_ARTICLE_LINKS_KEY);
    sessionStorage.removeItem(PENDING_NEW_ARTICLE_LINKS_KEY);
    onRefresh?.();

    // router.refresh() asks Next.js to refetch the current route on the server.
    // That lets us refresh the feed data without restarting the dev server.
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      className={`inline-flex min-h-12 w-full items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70 ${className ?? ""}`}
      type="button"
      onClick={handleRefresh}
      disabled={isPending}
    >
      {isPending ? "Refreshing..." : "Refresh news"}
    </button>
  );
}

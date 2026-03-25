"use client";

import { PENDING_PREVIOUS_LINKS_KEY } from "@/lib/news-updates";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

type RefreshButtonProps = {
  currentLinks?: string[];
};

export function RefreshButton({ currentLinks = [] }: RefreshButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleRefresh() {
    // Save the full list of links before refreshing so the next render can
    // compare against it and highlight every newly added article.
    sessionStorage.setItem(
      PENDING_PREVIOUS_LINKS_KEY,
      JSON.stringify(currentLinks),
    );

    // router.refresh() asks Next.js to refetch the current route on the server.
    // That lets us refresh the feed data without restarting the dev server.
    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <button
      className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
      type="button"
      onClick={handleRefresh}
      disabled={isPending}
    >
      {isPending ? "Refreshing..." : "Refresh news"}
    </button>
  );
}

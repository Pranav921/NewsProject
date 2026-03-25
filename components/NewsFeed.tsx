"use client";

import { NewsList } from "@/components/NewsList";
import {
  getNewArticleLinks,
  PENDING_PREVIOUS_LINKS_KEY,
} from "@/lib/news-updates";
import type { NewsItem } from "@/lib/types";
import { useEffect, useMemo, useState } from "react";

type NewsFeedProps = {
  articles: NewsItem[];
};

export function NewsFeed({ articles }: NewsFeedProps) {
  const [selectedSource, setSelectedSource] = useState("All Sources");
  const currentLinks = useMemo(
    () => articles.map((article) => article.link),
    [articles],
  );
  const sourceOptions = useMemo(
    () => [
      "All Sources",
      ...Array.from(new Set(articles.map((article) => article.source))).sort(),
    ],
    [articles],
  );
  const [newArticleLinks, setNewArticleLinks] = useState<string[]>([]);
  const activeSource = sourceOptions.includes(selectedSource)
    ? selectedSource
    : "All Sources";
  const filteredArticles = useMemo(() => {
    if (activeSource === "All Sources") {
      return articles;
    }

    return articles.filter((article) => article.source === activeSource);
  }, [activeSource, articles]);

  useEffect(() => {
    const savedPreviousLinks = sessionStorage.getItem(PENDING_PREVIOUS_LINKS_KEY);

    if (!savedPreviousLinks) {
      setNewArticleLinks([]);
      return;
    }

    try {
      const previousLinks = JSON.parse(savedPreviousLinks) as string[];

      // Compare the full pre-refresh link list with the full refreshed list so
      // every new article gets highlighted.
      setNewArticleLinks(getNewArticleLinks(previousLinks, currentLinks));
    } catch {
      setNewArticleLinks([]);
    } finally {
      // Only clear the saved links after the full comparison has happened.
      sessionStorage.removeItem(PENDING_PREVIOUS_LINKS_KEY);
    }
  }, [currentLinks]);

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="source-filter"
            >
              Filter by source
            </label>
            <p className="text-sm text-slate-500">
              Choose a source to narrow the current article list.
            </p>
          </div>

          <select
            id="source-filter"
            className="min-h-11 rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
            value={activeSource}
            onChange={(event) => setSelectedSource(event.target.value)}
          >
            {sourceOptions.map((source) => (
              <option key={source} value={source}>
                {source}
              </option>
            ))}
          </select>
        </div>
      </div>

      <NewsList
        articles={filteredArticles}
        newArticleLinks={newArticleLinks}
        emptyStateTitle="No matching articles"
        emptyStateMessage="There are no articles for the currently selected source. Try choosing All Sources to see the full list again."
      />
    </div>
  );
}

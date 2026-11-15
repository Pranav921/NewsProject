"use client";

import { summarizeFeedHealth, type FeedHealthRow } from "@/lib/feed-health";
import type { FeedStatus } from "@/lib/types";
import { useSyncExternalStore } from "react";

const noop = () => () => {};

// Times render only after hydration so the server's time zone never leaks into the
// reader's local display (and never causes a hydration mismatch).
function useHydrated() {
  return useSyncExternalStore(noop, () => true, () => false);
}

const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

// A quiet, single-line notice: the feed keeps working, so this must never look
// like a site-wide outage. Affected publishers are one click away when known.
export function FeedHealthNotice({ status }: { status: FeedStatus | null | undefined }) {
  const hydrated = useHydrated();
  const summary = summarizeFeedHealth(status);
  if (!summary) return null;

  const line = (
    <>
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${summary.tone === "stale" ? "bg-[var(--text-muted)]" : "bg-amber-500"}`} />
      <span className="min-w-0 flex-1 leading-snug">
        <span className="font-medium text-[var(--foreground)]">{summary.headline}.</span>{" "}
        <span>{summary.detail}</span>
      </span>
    </>
  );

  return (
    <div role="status" aria-live="polite" data-feed-health={summary.tone}
      className="rounded-xl border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--text-sub)] sm:px-4">
      {summary.rows.length ? (
        <details className="group">
          <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] [&::-webkit-details-marker]:hidden">
            {line}
            <span className="shrink-0 text-xs font-medium text-[var(--accent)]">
              <span className="group-open:hidden">Details</span><span className="hidden group-open:inline">Hide</span>
            </span>
          </summary>
          <ul className="mb-1 mt-1.5 space-y-1 border-t border-[var(--border)] pt-2 text-xs leading-relaxed" aria-label="Affected sources">
            {summary.rows.map((row) => <IssueRow key={row.source} row={row} hydrated={hydrated} />)}
          </ul>
        </details>
      ) : (
        <p className="flex min-h-9 items-center gap-2.5">{line}</p>
      )}
    </div>
  );
}

function IssueRow({ row, hydrated }: { row: FeedHealthRow; hydrated: boolean }) {
  return (
    <li className="flex flex-wrap gap-x-1.5">
      <span className="font-semibold text-[var(--foreground)]">{row.source}</span>
      <span className="min-w-0">
        {row.topics.map((topic, index) => {
          const time = hydrated && topic.lastSuccessAt
            ? <time dateTime={topic.lastSuccessAt}>{clock(topic.lastSuccessAt)}</time> : null;
          return (
            <span key={topic.label}>
              {index > 0 && <span aria-hidden="true"> · </span>}
              {topic.label}:{" "}
              {topic.state === "stale"
                ? <>showing cached stories{time && <> from {time}</>}</>
                : <>not available right now{time && <> (last updated {time})</>}</>}
            </span>
          );
        })}
      </span>
    </li>
  );
}

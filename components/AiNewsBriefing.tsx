"use client";

import { useEffect, useState } from "react";
import type { Briefing } from "@/lib/ai/briefing";

export function AiNewsBriefing() {
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [cacheHit, setCacheHit] = useState(false);
  const [now, setNow] = useState(0);
  const expired = Boolean(briefing && now >= Date.parse(briefing.expiresAt));

  useEffect(() => {
    if (!open || !briefing) return;
    // Update freshness at expiry without polling or generating in the background.
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, Date.parse(briefing.expiresAt) - Date.now() + 1));
    return () => clearTimeout(timer);
  }, [briefing, open]);

  async function viewBriefing(refresh = false) {
    if (loading) return;
    if (open && !error && !refresh) { setOpen(false); return; }
    setOpen(true);
    // Reopening a still-fresh result needs no network request.
    if (briefing && Date.parse(briefing.expiresAt) > Date.now()) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/ai/briefing", {
        method: "POST", credentials: "same-origin", cache: "no-store",
        signal: AbortSignal.timeout(55000),
      });
      if (!response.ok) {
        const wait = Number(response.headers.get("Retry-After"));
        throw new Error(response.status === 401
          ? "Your session has expired. Sign in again to view the briefing."
          : response.status === 429
            ? "Too many requests. Please wait a moment before trying again."
            : wait > 0
              ? `The briefing is being prepared or temporarily unavailable. Try again in ${Math.ceil(wait)} seconds.`
              : "The briefing is temporarily unavailable. You can keep reading the news feed below.");
      }
      const data = await response.json() as { briefing: Briefing; cacheHit?: boolean };
      if (!data?.briefing || !Array.isArray(data.briefing.items) || !data.briefing.items.length) {
        throw new Error("No briefing items are available right now. Please try again later.");
      }
      setBriefing(data.briefing);
      setCacheHit(data.cacheHit === true);
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error && cause.name === "Error"
        ? cause.message : "The briefing took too long to load. Please try again.");
    } finally { setLoading(false); }
  }

  return (
    <section className="mt-3 rounded-2xl border border-border bg-surface p-4 sm:p-5" aria-label="AI news briefing">
      <div className="mx-auto max-w-3xl">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="mb-1 font-mono text-[11px] font-medium uppercase tracking-wider text-accent">AI-generated · Publisher metadata</p>
          <h2 className="text-lg font-semibold tracking-tight text-navy sm:text-xl">Your News Briefing</h2>
          <p className="mt-1 text-xs leading-relaxed text-text-sub">Up to five stories worth catching up on.</p>
        </div>
        <button type="button" onClick={() => void viewBriefing()} disabled={loading}
          aria-expanded={open} aria-controls="ai-briefing-content"
          className="min-h-11 w-full shrink-0 rounded-xl border border-border-strong px-4 py-2 text-accent hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-wait disabled:opacity-60 sm:w-auto">
          {loading ? "Preparing briefing…" : error ? "Try AI Briefing again" : open ? "Hide AI Briefing" : "View AI Briefing"}
        </button>
      </div>
      <div id="ai-briefing-content" hidden={!open} aria-busy={loading}>
        {loading && <p className="mt-4 text-sm text-text-sub" role="status">Checking for a recent briefing. A new one is generated only when needed.</p>}
        {error && <p className="mt-4 text-sm text-breaking" role="alert">{error}</p>}
        {briefing && !loading && !error && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="border-l-2 border-accent/40 pl-3 text-xs leading-relaxed text-text-sub">{briefing.notice}</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-relaxed text-text-sub">
              <p>Generated <time dateTime={briefing.generatedAt}>{new Date(briefing.generatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></p>
              <p>{cacheHit ? "Shared cached briefing" : "Generated on request"}</p>
              <p role="status">{expired ? "Earlier briefing — news may have changed." : <>Cached until <time dateTime={briefing.expiresAt}>{new Date(briefing.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>. News may have changed.</>}</p>
            </div>
            {expired && <button type="button" onClick={() => void viewBriefing(true)} className="mt-1 min-h-11 rounded-md text-accent underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">Refresh AI Briefing</button>}
            <p role="status" className="sr-only">{briefing.items.length} briefing items loaded.</p>
            <ol className="mt-4 divide-y divide-border">
              {briefing.items.map((item, index) => (
                <li key={index} className="grid min-w-0 grid-cols-[1.25rem_minmax(0,1fr)] gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[1.75rem_minmax(0,1fr)] sm:gap-3">
                  <span aria-hidden="true" className="font-mono text-xs leading-6 text-accent">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                  <h3 className="break-words text-base font-semibold leading-snug tracking-tight text-navy sm:text-lg">{item.headline}</h3>
                  <p className="mt-1.5 max-w-prose break-words text-sm leading-relaxed text-foreground">{item.explanation}</p>
                  <ul className="mt-2 space-y-1" aria-label={`Source articles for ${item.headline}`}>
                    {item.references.map((reference) => (
                      <li key={reference.url} className="text-xs leading-relaxed text-text-sub">
                        <a href={reference.url} target="_blank" rel="noopener noreferrer" className="block min-h-11 break-words rounded-md py-2.5 text-accent hover:bg-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
                          <span className="font-semibold text-accent">{reference.source}</span><span aria-hidden="true"> · </span><span className="sr-only">: </span><span className="underline decoration-accent/40 underline-offset-2">{reference.title}</span><span className="sr-only"> (opens in a new tab)</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
      </div>
    </section>
  );
}

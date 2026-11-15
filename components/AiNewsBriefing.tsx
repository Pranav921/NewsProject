"use client";

import { useEffect, useState } from "react";
import type { Briefing } from "@/lib/ai/briefing";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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
              : "The briefing is temporarily unavailable. You can keep reading the News Feed.");
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
    <section className="rounded-2xl border border-border bg-surface p-5 shadow-[0_8px_24px_rgba(26,24,20,0.04)] sm:p-7" aria-label="AI news briefing">
      <div className="mx-auto max-w-3xl">
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-wider text-accent">
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z" /></svg>
            AI-generated · Publisher metadata
          </p>
          <h2 className="text-xl font-semibold leading-tight tracking-tight text-navy sm:text-[22px]">Your News Briefing</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-text-sub">Up to five stories worth catching up on.</p>
        </div>
        <button type="button" onClick={() => void viewBriefing()} disabled={loading}
          aria-expanded={open} aria-controls="ai-briefing-content"
          className={`min-h-11 w-full shrink-0 rounded-xl border border-border-strong bg-surface px-4 py-2 text-accent hover:bg-background ${focusRing} disabled:cursor-wait disabled:opacity-60 sm:w-auto`}>
          {loading ? "Preparing briefing…" : error ? "Try AI Briefing again" : open ? "Hide AI Briefing" : "View AI Briefing"}
        </button>
      </div>
      <div id="ai-briefing-content" hidden={!open} aria-busy={loading}>
        {loading && <p className="mt-5 text-sm text-text-sub" role="status">Checking for a recent briefing. A new one is generated only when needed.</p>}
        {error && <p className="mt-5 text-sm text-breaking" role="alert">{error}</p>}
        {briefing && !loading && !error && (
          <div className="mt-5 border-t border-border pt-5">
            <p className="text-xs leading-relaxed text-text-sub">{briefing.notice}</p>
            <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-relaxed text-text-sub">
              <p>Generated <time dateTime={briefing.generatedAt}>{new Date(briefing.generatedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></p>
              <span aria-hidden="true">·</span>
              <p>{cacheHit ? "Shared cached briefing" : "Generated on request"}</p>
              <span aria-hidden="true">·</span>
              <p role="status">{expired ? "Earlier briefing — news may have changed." : <>Cached until <time dateTime={briefing.expiresAt}>{new Date(briefing.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</time>. News may have changed.</>}</p>
            </div>
            {expired && <button type="button" onClick={() => void viewBriefing(true)} className={`mt-1 min-h-11 rounded-md text-accent underline underline-offset-2 ${focusRing}`}>Refresh AI Briefing</button>}
            <p role="status" className="sr-only">{briefing.items.length} briefing items loaded.</p>
            <ol className="mt-5 space-y-6">
              {briefing.items.map((item, index) => (
                <li key={index} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-2 sm:grid-cols-[2rem_minmax(0,1fr)] sm:gap-3">
                  <span aria-hidden="true" className="font-mono text-xs leading-7 text-accent">{String(index + 1).padStart(2, "0")}</span>
                  <div className="min-w-0">
                  <h3 className="break-words text-base font-semibold leading-snug tracking-tight text-navy sm:text-lg">{item.headline}</h3>
                  <p className="mt-1.5 max-w-prose break-words text-[15px] leading-7 text-foreground">{item.explanation}</p>
                  <ul className="mt-2.5 grid gap-2 sm:grid-cols-2" aria-label={`Source articles for ${item.headline}`}>
                    {item.references.map((reference) => (
                      <li key={reference.url} className="min-w-0">
                        {/* Colour lives on inner spans: the global `a` rule overrides link colour utilities. */}
                        <a href={reference.url} target="_blank" rel="noopener noreferrer"
                          className={`group flex min-h-11 items-start gap-2 rounded-xl border border-border bg-background/60 px-3 py-2.5 transition-colors hover:border-accent/40 ${focusRing}`}>
                          <span className="min-w-0 flex-1">
                            <span className="block text-xs font-semibold text-navy">{reference.source}</span>
                            <span className="sr-only">: </span>
                            <span className="line-clamp-2 break-words text-[13px] leading-snug text-text-sub group-hover:text-foreground">{reference.title}</span>
                          </span>
                          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-muted group-hover:text-accent"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
                          <span className="sr-only"> (opens in a new tab)</span>
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

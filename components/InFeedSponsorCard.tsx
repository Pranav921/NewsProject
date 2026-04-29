"use client";

import { trackEvent } from "@/lib/analytics";
import type { SponsorConfig } from "@/lib/types";

type InFeedSponsorCardProps = {
  sponsor: SponsorConfig;
};

export function InFeedSponsorCard({ sponsor }: InFeedSponsorCardProps) {
  return (
    <aside className="flex h-full flex-col rounded-[1.25rem] border border-sky-200 bg-[linear-gradient(180deg,#f8fbff_0%,#eef6ff_100%)] p-3.5 shadow-[0_12px_28px_rgba(15,23,42,0.05)] sm:p-4">
      <div>
        <span className="inline-flex rounded-full border border-sky-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-sky-700">
          {sponsor.label}
        </span>
        <h3 className="mt-2.5 text-[1.02rem] font-semibold tracking-tight text-slate-950 sm:text-[1.08rem]">
          {sponsor.title}
        </h3>
        <p className="mt-1.5 text-sm leading-5 text-slate-600">
          {sponsor.description}
        </p>
        <p className="mt-1.5 text-xs leading-5 text-slate-500">
          Newsletter + in-feed sponsorships available.
        </p>
      </div>

      <div className="mt-3">
        <a
          className="inline-flex min-h-10 w-full items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 sm:w-auto"
          href={sponsor.ctaUrl}
          style={{ color: "#ffffff" }}
          onClick={() =>
            trackEvent("in_feed_sponsor_click", {
              sponsor_label: sponsor.label,
              sponsor_title: sponsor.title,
            })
          }
        >
          {sponsor.ctaText}
        </a>
      </div>
    </aside>
  );
}

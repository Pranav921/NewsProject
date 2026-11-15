"use client";

import type { KeyboardEvent, Ref } from "react";

export type DashboardSection = "news" | "ai";

const SECTIONS: ReadonlyArray<{ id: DashboardSection; label: string; icon: string }> = [
  // Newspaper and sparkle outlines (decorative; the text label carries the meaning).
  { id: "news", label: "News Feed", icon: "M4 5h13v14H6a2 2 0 0 1-2-2V5zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5M8 17h3" },
  { id: "ai", label: "AI Hub", icon: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3zM19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7L19 15z" },
];

// WAI-ARIA tabs with automatic activation: arrows/Home/End move and select, Tab
// moves into the visible panel. Both panels are already rendered, so selecting is instant.
export function DashboardTabs({ section, onSelect, ref }: {
  section: DashboardSection;
  onSelect: (section: DashboardSection) => void;
  ref?: Ref<HTMLDivElement>;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = SECTIONS.findIndex((entry) => entry.id === section);
    const next = event.key === "ArrowRight" ? (index + 1) % SECTIONS.length
      : event.key === "ArrowLeft" ? (index - 1 + SECTIONS.length) % SECTIONS.length
        : event.key === "Home" ? 0 : event.key === "End" ? SECTIONS.length - 1 : -1;
    if (next < 0) return;
    event.preventDefault();
    onSelect(SECTIONS[next].id);
    document.getElementById(`dashboard-tab-${SECTIONS[next].id}`)?.focus();
  }

  return (
    <div ref={ref} className="-mx-3 border-b border-[var(--border)] bg-white sm:-mx-6 lg:-mx-7 2xl:-mx-8">
      <div role="tablist" aria-label="Dashboard sections" className="flex w-full px-3 sm:gap-2 sm:px-6 md:px-[40px]">
        {SECTIONS.map(({ id, label, icon }) => {
          const selected = id === section;
          return (
            <button
              key={id} id={`dashboard-tab-${id}`} type="button" role="tab"
              aria-selected={selected} aria-controls={`dashboard-panel-${id}`} tabIndex={selected ? 0 : -1}
              onClick={() => onSelect(id)} onKeyDown={onKeyDown}
              className={`relative inline-flex min-h-11 flex-1 items-center justify-center gap-2 px-4 text-[15px] transition-colors sm:flex-none sm:justify-start focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] ${
                selected ? "font-semibold text-[var(--navy)]" : "font-medium text-[var(--text-sub)] hover:text-[var(--foreground)]"
              }`}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
                className={`h-[18px] w-[18px] ${selected ? "text-[var(--accent)]" : ""}`}><path d={icon} /></svg>
              {label}
              <span aria-hidden="true" className={`absolute inset-x-3 bottom-0 h-[3px] rounded-t-full ${selected ? "bg-[var(--accent)]" : "bg-transparent"}`} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

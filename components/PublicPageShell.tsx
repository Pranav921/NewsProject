import { PublicFooter } from "@/components/PublicFooter";
import Link from "next/link";
import type { ReactNode } from "react";

type PublicPageShellProps = {
  badge: string;
  children: ReactNode;
  description: string;
  title: string;
};

export function PublicPageShell({
  badge,
  children,
  description,
  title,
}: PublicPageShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col gap-4 bg-[var(--background)] px-4 py-6 sm:px-6 lg:px-8">
      <section className="editorial-page-card rounded-[1rem] p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="editorial-section-label inline-flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--background)] px-3 py-1.5">
            {badge}
          </div>
          <Link
            className="editorial-outline-button inline-flex min-h-10 items-center justify-center px-4 py-2 text-sm font-medium transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)]"
            href="/"
          >
            Back to Kicker News
          </Link>
        </div>
        <h1 className="mt-4 text-[2rem] font-semibold tracking-tight text-[var(--foreground)] sm:text-[2.35rem]">
          {title}
        </h1>
        <p className="mt-2.5 max-w-3xl text-sm leading-6 text-[var(--text-sub)] sm:text-base">
          {description}
        </p>
        <div className="mt-6 space-y-5 text-sm leading-7 text-[var(--text-sub)] sm:text-base">
          {children}
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}

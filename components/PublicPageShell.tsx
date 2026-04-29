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
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <section className="rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.07)] sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800">
            {badge}
          </div>
          <Link
            className="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            href="/"
          >
            Back to Kicker News
          </Link>
        </div>
        <h1 className="mt-4 text-[2rem] font-semibold tracking-tight text-slate-950 sm:text-[2.35rem]">
          {title}
        </h1>
        <p className="mt-2.5 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
          {description}
        </p>
        <div className="mt-6 space-y-5 text-sm leading-7 text-slate-600 sm:text-base">
          {children}
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}

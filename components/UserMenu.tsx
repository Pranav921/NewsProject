"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type UserMenuProps = {
  email: string | null;
  variant?: "card" | "inline";
};

export function UserMenu({ email, variant = "card" }: UserMenuProps) {
  const router = useRouter();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function handleSignOut() {
    setIsPending(true);
    setMessage(null);

    const { error } = await supabase.auth.signOut();

    if (error) {
      setMessage(error.message);
      setIsPending(false);
      return;
    }

    router.replace("/");
    router.refresh();
  }

  if (variant === "inline") {
    return (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="inline-flex min-h-9 items-center rounded-full px-3 text-sm text-slate-700">
          {email ?? "Account"}
        </span>
        <button
          className="inline-flex min-h-9 items-center justify-center rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
          type="button"
          onClick={handleSignOut}
          disabled={isPending}
        >
          {isPending ? "Logging out..." : "Log out"}
        </button>
        {message ? (
          <p className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            {message}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="w-full rounded-[1.1rem] border border-slate-200 bg-white/90 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.05)]">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Signed in
          </p>
          <p className="mt-1 break-all text-sm font-medium text-slate-900">
            {email ?? "Account"}
          </p>
        </div>

        <div className="flex sm:items-center sm:justify-end">
          <button
            className="inline-flex min-h-10 items-center justify-center rounded-full border border-slate-300 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-70"
            type="button"
            onClick={handleSignOut}
            disabled={isPending}
          >
            {isPending ? "Logging out..." : "Log out"}
          </button>
        </div>
      </div>

      {message ? (
        <p className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {message}
        </p>
      ) : null}
    </div>
  );
}

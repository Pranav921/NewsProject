"use client";

import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState } from "react";

type UserMenuProps = {
  email: string | null;
};

export function UserMenu({ email }: UserMenuProps) {
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

  return (
    <div className="w-full rounded-2xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            Signed in
          </p>
          <p className="mt-2 break-all text-sm text-slate-700">
            {email ?? "Account"}
          </p>
        </div>

        <div className="flex sm:items-center sm:justify-end">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
            type="button"
            onClick={handleSignOut}
            disabled={isPending}
          >
            {isPending ? "Logging out..." : "Log out"}
          </button>
        </div>
      </div>

      {message ? (
        <p className="mt-3 text-sm text-slate-600">{message}</p>
      ) : null}
    </div>
  );
}

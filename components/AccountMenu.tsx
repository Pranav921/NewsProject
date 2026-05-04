"use client";

import { RefreshButton } from "@/components/RefreshButton";
import { UserMenu } from "@/components/UserMenu";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

type AccountMenuProps = {
  currentLinks?: string[];
  onRefresh?: () => Promise<void> | void;
  userEmail?: string | null;
  viewerMode: "authenticated" | "public";
};

export function AccountMenu({
  currentLinks = [],
  onRefresh,
  userEmail = null,
  viewerMode,
}: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isPublicViewer = viewerMode === "public";

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={isPublicViewer ? "Open account menu" : "Open account and settings menu"}
        className="inline-flex min-h-8 items-center justify-center rounded-full border border-[var(--border)] bg-white px-3 py-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 sm:min-h-10 sm:px-4 sm:text-sm sm:tracking-[0.08em]"
        type="button"
        onClick={() => setIsOpen((currentValue) => !currentValue)}
      >
        Menu
      </button>

      {isOpen ? (
        <div
          id={menuId}
          className="absolute right-0 z-30 mt-2 w-[16rem] rounded-[1rem] border border-[var(--border)] bg-white p-3 font-sans shadow-[0_18px_42px_rgba(26,24,20,0.12)]"
          role="menu"
        >
          <div className="space-y-2.5">
            <RefreshButton
              className="!min-h-10 !w-full !rounded-xl !border-[var(--border)] !bg-white !px-4 !py-2 !font-sans !text-sm !font-medium !tracking-normal !text-[var(--text-sub)] hover:!bg-[var(--background)]"
              currentLinks={currentLinks}
              onRefresh={onRefresh}
            />

            {isPublicViewer ? (
              <div className="space-y-2">
                <Link
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2 font-sans text-sm font-medium tracking-normal text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--text-sub)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  href="/newsletter"
                  role="menuitem"
                  onClick={() => setIsOpen(false)}
                >
                  Newsletter sign up
                </Link>
                <a
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2 font-sans text-sm font-medium tracking-normal text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--text-sub)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  href="#public-auth-panel-login"
                  role="menuitem"
                  onClick={() => setIsOpen(false)}
                >
                  Sign in
                </a>
                <a
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2 font-sans text-sm font-medium tracking-normal text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--text-sub)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  href="#public-auth-panel-signup"
                  role="menuitem"
                  onClick={() => setIsOpen(false)}
                >
                  Create account
                </a>
              </div>
            ) : (
              <div className="space-y-2">
                <Link
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2 font-sans text-sm font-medium tracking-normal text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--text-sub)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  href="/newsletter"
                  role="menuitem"
                  onClick={() => setIsOpen(false)}
                >
                  Newsletter sign up
                </Link>
                <Link
                  className="inline-flex min-h-10 w-full items-center justify-center rounded-xl border border-[var(--border)] bg-white px-4 py-2 font-sans text-sm font-medium tracking-normal text-[var(--text-sub)] transition-colors hover:bg-[var(--background)] hover:text-[var(--text-sub)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                  href="/account"
                  role="menuitem"
                  onClick={() => setIsOpen(false)}
                >
                  Account settings
                </Link>
                <UserMenu email={userEmail} variant="menu" />
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

import { RefreshButton } from "@/components/RefreshButton";
import { UserMenu } from "@/components/UserMenu";
import Link from "next/link";

type AccountMenuProps = {
  className?: string;
  currentLinks?: string[];
  layout?: "desktop" | "mobile";
  onRefresh?: () => Promise<void> | void;
  userEmail?: string | null;
  viewerMode: "authenticated" | "public";
};

export function AccountMenu({
  className,
  currentLinks = [],
  layout = "desktop",
  onRefresh,
  userEmail = null,
  viewerMode,
}: AccountMenuProps) {
  const isPublicViewer = viewerMode === "public";
  const isMobileLayout = layout === "mobile";
  const containerClasses = isMobileLayout
    ? isPublicViewer
      ? "grid grid-cols-3 gap-1.5 pt-2"
      : "grid grid-cols-2 gap-1.5 pt-2"
    : "hidden items-center gap-2 md:flex";
  const buttonClasses = isMobileLayout
    ? "!min-h-[34px] !w-full !rounded-[10px] !px-2 !py-1 !text-[12px]"
    : "!min-h-10 !rounded-xl !px-4 !py-2 !text-sm";
  const sharedButtonTone =
    "text-[var(--foreground)] hover:bg-[var(--background)] hover:text-[var(--foreground)]";

  return (
    <div className={`${containerClasses} ${className ?? ""}`}>
      <RefreshButton
        className={`!w-auto !font-sans !font-medium !tracking-normal !text-[var(--foreground)] hover:!bg-[var(--background)] hover:!text-[var(--foreground)] ${buttonClasses}`}
        currentLinks={currentLinks}
        onRefresh={onRefresh}
      />

      <Link
        className={`inline-flex items-center justify-center border border-[var(--border)] bg-white font-sans font-medium tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${sharedButtonTone} ${buttonClasses}`}
        href="/newsletter"
      >
        Newsletter
      </Link>

      {isPublicViewer ? (
        <>
          <a
            className={`inline-flex items-center justify-center border border-[var(--border)] bg-white font-sans font-medium tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${sharedButtonTone} ${buttonClasses}`}
            href="#public-auth-panel-login"
          >
            {isMobileLayout ? "Sign in" : "Log in"}
          </a>
          {isMobileLayout ? null : (
            <a
              className={`inline-flex items-center justify-center border border-[var(--border)] bg-white font-sans font-medium tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${sharedButtonTone} ${buttonClasses}`}
              href="#public-auth-panel-signup"
            >
              Create account
            </a>
          )}
        </>
      ) : (
        <>
          <Link
            className={`inline-flex items-center justify-center border border-[var(--border)] bg-white font-sans font-medium tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${sharedButtonTone} ${buttonClasses}`}
            href="/account"
          >
            Account settings
          </Link>
          <UserMenu className={buttonClasses} email={userEmail} variant="button" />
        </>
      )}
    </div>
  );
}

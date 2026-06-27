import { AccountMenu } from "@/components/AccountMenu";
import { preparePendingNewArticleRefresh } from "@/lib/news-updates";
import Image from "next/image";

export type ShellTab = "feed" | "saved" | "alerts";

type AppShellProps = {
  activeTab: ShellTab;
  onRefresh?: () => Promise<void> | void;
  onTabChange: (tab: ShellTab) => void;
  pendingUpdateCount?: number;
  pendingUpdateLinks?: string[];
  refreshLinks?: string[];
  userEmail?: string | null;
  viewerMode: "authenticated" | "public";
};

export function AppShell({
  activeTab,
  onRefresh,
  onTabChange,
  pendingUpdateCount = 0,
  pendingUpdateLinks = [],
  refreshLinks = [],
  userEmail = null,
  viewerMode,
}: AppShellProps) {
  void activeTab;
  void onTabChange;
  const updateLabel =
    pendingUpdateCount === 1
      ? "1 new update"
      : `${pendingUpdateCount} new updates`;

  async function handlePendingRefresh() {
    if (pendingUpdateLinks.length === 0) {
      return;
    }

    preparePendingNewArticleRefresh(refreshLinks, pendingUpdateLinks);
    await onRefresh?.();
  }

  return (
    <header className="relative left-1/2 right-1/2 w-screen -mx-[50vw] border-b border-[var(--border)] bg-white">
      <div className="mx-auto w-full px-3 py-2 sm:px-6 md:flex md:h-[52px] md:items-center md:justify-between md:px-[40px] md:py-0">
        <div className="flex items-center justify-between gap-3 md:min-w-0 md:flex-1">
          <div className="flex shrink-0 items-center gap-4 md:mr-8">
            <div className="flex items-center gap-3">
              <Image
                alt="Kicker News"
                className="h-8 w-8 rounded-[0.7rem] object-contain sm:h-9 sm:w-9"
                height={1024}
                src="/logo-icon.png"
                width={1024}
              />
              <div className="flex items-baseline gap-1.5">
                <span className="text-[16px] font-semibold tracking-tight text-[var(--foreground)] md:text-[17px]">
                  Kicker
                </span>
                <span className="text-[16px] font-medium text-[var(--foreground)] md:text-[17px]">
                  News
                </span>
              </div>
            </div>
            <span className="hidden text-sm font-medium text-[var(--text-muted)] md:inline-block">
              Top headlines from the world&rsquo;s most trusted newsrooms. One feed.
            </span>
          </div>
          <div className="flex shrink-0 items-center justify-end gap-2">
            {pendingUpdateCount > 0 ? (
              <button
                aria-label={`Refresh to show ${updateLabel}`}
                className="badge-in hidden min-h-9 cursor-pointer items-center gap-2 rounded-full bg-[var(--accent)] px-[14px] text-[11px] font-semibold text-white shadow-[0_2px_12px_rgba(255,107,0,0.27)] transition-transform hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 md:inline-flex"
                type="button"
                onClick={() => {
                  void handlePendingRefresh();
                }}
              >
                <span className="inline-flex h-[5px] w-[5px] rounded-full bg-white shadow-[0_0_0_0_rgba(255,255,255,0.35)] animate-[live-dot-pulse_1.8s_ease-out_infinite]" />
                {updateLabel}
              </button>
            ) : null}

            <AccountMenu
              className="shrink-0"
              currentLinks={refreshLinks}
              layout="desktop"
              onRefresh={onRefresh}
              userEmail={userEmail}
              viewerMode={viewerMode}
            />
          </div>
        </div>

        <div className="md:hidden">
          {pendingUpdateCount > 0 ? (
            <div className="flex justify-start border-t border-[var(--border)] pt-2.5">
              <button
                aria-label={`Refresh to show ${updateLabel}`}
                className="badge-in inline-flex min-h-9 cursor-pointer items-center justify-center rounded-full bg-[var(--accent)] px-[18px] py-[7px] text-[13px] font-semibold text-white shadow-[0_2px_12px_rgba(255,107,0,0.27)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
                type="button"
                onClick={() => {
                  void handlePendingRefresh();
                }}
              >
                {updateLabel}
              </button>
            </div>
          ) : null}

          <AccountMenu
            className="justify-start border-t border-[var(--border)]"
            currentLinks={refreshLinks}
            layout="mobile"
            onRefresh={onRefresh}
            userEmail={userEmail}
            viewerMode={viewerMode}
          />
        </div>
      </div>
    </header>
  );
}

"use client";

import { trackEvent } from "@/lib/analytics";
import type { NewsItem } from "@/lib/types";
import { useEffect, useRef, useState } from "react";

type ShareArticleButtonProps = {
  article: NewsItem;
  appearance?: "dark" | "light";
  fullWidth?: boolean;
  onOpenChange?: (isOpen: boolean) => void;
};

type ShareStatus = {
  message: string;
  tone: "default" | "success";
} | null;

function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  const fallbackInput = document.createElement("textarea");
  fallbackInput.value = value;
  fallbackInput.setAttribute("readonly", "true");
  fallbackInput.style.position = "absolute";
  fallbackInput.style.left = "-9999px";
  document.body.appendChild(fallbackInput);
  fallbackInput.select();
  document.execCommand("copy");
  document.body.removeChild(fallbackInput);
  return Promise.resolve();
}

function ShareTriggerIcon() {
  return (
    <svg aria-hidden="true" className="h-[14px] w-[14px]" viewBox="0 0 24 24">
      <path
        d="M9 8V5l7 7-7 7v-3.2c-3.8 0-6.1 1.2-8 4.2.8-5.5 4-8.6 8-9Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        fill="none"
      />
    </svg>
  );
}

function ShareXIcon() {
  return (
    <svg aria-hidden="true" className="h-[14px] w-[14px]" viewBox="0 0 24 24">
      <path
        d="M18.9 3H22l-6.78 7.75L23 21h-6.1l-4.79-6.26L6.63 21H3.5l7.26-8.3L1 3h6.26l4.33 5.72L18.9 3Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ShareFacebookIcon() {
  return (
    <svg aria-hidden="true" className="h-[14px] w-[14px]" viewBox="0 0 24 24">
      <path
        d="M13.5 21v-7h2.35l.4-3h-2.75V9.08c0-.87.25-1.46 1.5-1.46H16.4V4.94c-.24-.03-1.08-.1-2.06-.1-2.04 0-3.44 1.25-3.44 3.55V11H8.5v3h2.4v7h2.6Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ShareLinkIcon() {
  return (
    <svg aria-hidden="true" className="h-[14px] w-[14px]" viewBox="0 0 24 24">
      <path
        d="M10.6 13.4a4 4 0 0 0 5.66 0l2.82-2.82a4 4 0 1 0-5.66-5.66L11.8 6.58"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M13.4 10.6a4 4 0 0 0-5.66 0l-2.82 2.82a4 4 0 1 0 5.66 5.66l1.6-1.6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        fill="none"
      />
    </svg>
  );
}

function ShareMessagesIcon() {
  return (
    <svg aria-hidden="true" className="h-[14px] w-[14px]" viewBox="0 0 24 24">
      <path
        d="M5 18.5V7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v6A2.5 2.5 0 0 1 16.5 16H10l-5 2.5Z"
        fill="currentColor"
      />
    </svg>
  );
}

function ShareWhatsAppIcon() {
  return (
    <svg aria-hidden="true" className="h-[14px] w-[14px]" viewBox="0 0 24 24">
      <path
        d="M12 3.5A8.5 8.5 0 0 0 4.7 16.4L3.5 20.5l4.23-1.12A8.5 8.5 0 1 0 12 3.5Z"
        fill="currentColor"
      />
      <path
        d="M15.86 13.6c-.2-.1-1.2-.6-1.39-.66-.18-.07-.32-.1-.46.1-.13.2-.52.66-.64.8-.12.13-.24.15-.44.05-.2-.1-.86-.31-1.63-1-.6-.53-1-1.19-1.11-1.39-.12-.2-.01-.31.08-.41.08-.08.2-.22.3-.33.1-.12.13-.2.2-.34.07-.13.03-.25-.02-.35-.05-.1-.46-1.12-.63-1.54-.17-.4-.34-.34-.46-.35h-.39c-.13 0-.35.05-.53.25-.18.2-.7.68-.7 1.66s.72 1.92.82 2.05c.1.13 1.4 2.13 3.39 2.99.48.2.85.32 1.13.41.48.15.91.13 1.25.08.38-.06 1.2-.49 1.37-.97.17-.48.17-.9.12-.97-.05-.08-.18-.12-.38-.22Z"
        fill="#ffffff"
      />
    </svg>
  );
}

function ShareMoreIcon() {
  return (
    <svg aria-hidden="true" className="h-[14px] w-[14px]" viewBox="0 0 24 24">
      <circle cx="6" cy="12" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="18" cy="12" r="2" fill="currentColor" />
    </svg>
  );
}

function ShareIconButton({
  ariaLabel,
  children,
  isDark,
  onClick,
  tone = "neutral",
}: {
  ariaLabel: string;
  children: React.ReactNode;
  isDark: boolean;
  onClick: () => void;
  tone?: "neutral" | "x" | "facebook" | "messages" | "whatsapp" | "more";
}) {
  const toneClasses =
    tone === "facebook"
      ? "text-[#1877F2]"
      : tone === "messages"
        ? "text-[#34C759]"
        : tone === "whatsapp"
          ? "text-[#25D366]"
          : tone === "more"
            ? "text-[var(--text-sub)]"
            : "text-[#111111]";

  return (
    <button
      aria-label={ariaLabel}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-[10px] border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 ${
        isDark
          ? "border-white/12 bg-white/[0.05] hover:bg-white/10 focus-visible:ring-offset-[#241714]"
          : "border-[var(--border)] bg-white hover:border-[var(--border-strong)] hover:bg-[var(--background)]"
      } ${toneClasses}`}
      title={ariaLabel}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ShareArticleButton({
  article,
  appearance = "light",
  fullWidth = false,
  onOpenChange,
}: ShareArticleButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [shareStatus, setShareStatus] = useState<ShareStatus>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDark = appearance === "dark";
  const shareText = `${article.title} ${article.link}`;
  const encodedTitle = encodeURIComponent(article.title);
  const encodedUrl = encodeURIComponent(article.link);
  const encodedShareText = encodeURIComponent(shareText);
  const canNativeShare =
    typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px)");
    const updateViewportMode = () => setIsMobileViewport(mediaQuery.matches);

    updateViewportMode();
    mediaQuery.addEventListener("change", updateViewportMode);

    return () => {
      mediaQuery.removeEventListener("change", updateViewportMode);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  useEffect(() => {
    onOpenChange?.(isOpen);
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!shareStatus) {
      return;
    }

    const timeoutId = window.setTimeout(() => setShareStatus(null), 2200);
    return () => window.clearTimeout(timeoutId);
  }, [shareStatus]);

  function openExternalShare(url: string, channel: string) {
    trackEvent("article_share_channel_click", {
      article_link: article.link,
      article_source: article.source,
      article_title: article.title,
      channel,
    });
    window.open(url, "_blank", "noopener,noreferrer");
    setIsOpen(false);
  }

  async function handleCopyLink() {
    await copyText(article.link);
    setShareStatus({
      message: "Article link copied.",
      tone: "success",
    });
    trackEvent("article_share_channel_click", {
      article_link: article.link,
      article_source: article.source,
      article_title: article.title,
      channel: "copy",
    });
    setIsOpen(false);
  }

  async function handleNativeShare() {
    if (!canNativeShare) {
      return;
    }

    try {
      await navigator.share({
        title: article.title,
        text: article.title,
        url: article.link,
      });
      trackEvent("article_share_channel_click", {
        article_link: article.link,
        article_source: article.source,
        article_title: article.title,
        channel: "native",
      });
      setIsOpen(false);
    } catch {
      // User cancellation is fine here.
    }
  }

  const triggerClasses = isDark
    ? `${fullWidth ? "w-full" : ""} inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-white/14 bg-white/8 px-3 py-2 text-[var(--hero-headline)] transition-colors hover:bg-white/12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--hero-dark)]`
    : `${fullWidth ? "w-full" : ""} inline-flex min-h-8 min-w-8 items-center justify-center rounded-[6px] border border-[var(--border)] bg-white px-[10px] py-[4px] text-[var(--text-muted)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2`;

  const trayClasses = isDark
    ? "absolute left-0 top-[calc(100%+8px)] z-30 rounded-[12px] border border-white/12 bg-[#241714] p-1.5 shadow-[0_18px_44px_rgba(0,0,0,0.32)]"
    : "absolute bottom-[calc(100%+8px)] left-1/2 z-30 -translate-x-1/2 rounded-[12px] border border-[var(--border)] bg-white p-1.5 shadow-[0_14px_32px_rgba(26,24,20,0.10)] md:bottom-1/2 md:left-[calc(100%+8px)] md:translate-x-0 md:translate-y-1/2";

  return (
    <div className={`relative ${fullWidth ? "w-full" : ""}`} ref={containerRef}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        className={triggerClasses}
        type="button"
        onClick={() => {
          trackEvent("article_share_open", {
            article_link: article.link,
            article_source: article.source,
            article_title: article.title,
          });
          setIsOpen((currentValue) => !currentValue);
        }}
      >
        <ShareTriggerIcon />
      </button>

      {shareStatus ? (
        <p
          className={`absolute right-0 top-[calc(100%+8px)] z-30 min-w-[152px] rounded-[8px] px-3 py-2 text-xs shadow-[0_10px_26px_rgba(26,24,20,0.16)] md:left-0 md:right-auto md:top-auto md:bottom-[calc(100%+8px)] ${
            shareStatus.tone === "success"
              ? "border border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border border-[var(--border)] bg-white text-[var(--text-sub)]"
          }`}
          aria-live="polite"
        >
          {shareStatus.message}
        </p>
      ) : null}

      {isOpen ? (
        <div
          className={`${trayClasses} ${isMobileViewport ? "max-w-[176px]" : ""}`}
          role="menu"
        >
          <div className="flex items-center gap-1.5">
            {isMobileViewport ? (
              <>
                <ShareIconButton
                  ariaLabel="Messages"
                  isDark={false}
                  tone="messages"
                  onClick={() =>
                    openExternalShare(`sms:?&body=${encodedShareText}`, "messages")
                  }
                >
                  <ShareMessagesIcon />
                </ShareIconButton>
                <ShareIconButton
                  ariaLabel="WhatsApp"
                  isDark={false}
                  tone="whatsapp"
                  onClick={() =>
                    openExternalShare(
                      `https://wa.me/?text=${encodedShareText}`,
                      "whatsapp",
                    )
                  }
                >
                  <ShareWhatsAppIcon />
                </ShareIconButton>
                {canNativeShare ? (
                  <ShareIconButton
                    ariaLabel="More sharing options"
                    isDark={false}
                    tone="more"
                    onClick={() => {
                      void handleNativeShare();
                    }}
                  >
                    <ShareMoreIcon />
                  </ShareIconButton>
                ) : null}
                <ShareIconButton
                  ariaLabel="Copy article link"
                  isDark={false}
                  tone="neutral"
                  onClick={() => {
                    void handleCopyLink();
                  }}
                >
                  <ShareLinkIcon />
                </ShareIconButton>
              </>
            ) : (
              <>
                <ShareIconButton
                  ariaLabel="Share to X"
                  isDark={isDark}
                  tone="x"
                  onClick={() =>
                    openExternalShare(
                      `https://twitter.com/intent/tweet?text=${encodedTitle}&url=${encodedUrl}`,
                      "x",
                    )
                  }
                >
                  <ShareXIcon />
                </ShareIconButton>
                <ShareIconButton
                  ariaLabel="Share to Facebook"
                  isDark={isDark}
                  tone="facebook"
                  onClick={() =>
                    openExternalShare(
                      `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
                      "facebook",
                    )
                  }
                >
                  <ShareFacebookIcon />
                </ShareIconButton>
                <ShareIconButton
                  ariaLabel="Copy article link"
                  isDark={isDark}
                  tone="neutral"
                  onClick={() => {
                    void handleCopyLink();
                  }}
                >
                  <ShareLinkIcon />
                </ShareIconButton>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

"use client";

type AnalyticsValue = boolean | number | string | null | undefined;

export type AnalyticsProperties = Record<string, AnalyticsValue>;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, AnalyticsValue>>;
    gtag?: (
      command: string,
      eventName: string,
      parameters?: Record<string, AnalyticsValue>,
    ) => void;
    plausible?: (
      eventName: string,
      options?: { props?: Record<string, AnalyticsValue> },
    ) => void;
    posthog?: {
      capture: (
        eventName: string,
        properties?: Record<string, AnalyticsValue>,
      ) => void;
    };
  }
}

const PLAUSIBLE_DOMAIN = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN?.trim() ?? "";
const GA_MEASUREMENT_ID =
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID?.trim() ?? "";
const POSTHOG_ENABLED =
  (process.env.NEXT_PUBLIC_POSTHOG_KEY?.trim() ?? "").length > 0;

function getViewportBucket() {
  if (typeof window === "undefined") {
    return "server";
  }

  const width = window.innerWidth;

  if (width < 640) {
    return "mobile";
  }

  if (width < 1024) {
    return "tablet";
  }

  return "desktop";
}

function getViewportWidth() {
  if (typeof window === "undefined") {
    return null;
  }

  return window.innerWidth;
}

function normalizeProperties(properties: AnalyticsProperties = {}) {
  return Object.fromEntries(
    Object.entries({
      ...properties,
      pathname: typeof window !== "undefined" ? window.location.pathname : undefined,
      viewport: getViewportBucket(),
      viewport_width: getViewportWidth(),
    }).filter(([, value]) => value !== undefined),
  );
}

function dispatchLocalAnalyticsEvent(
  type: "event" | "pageview",
  name: string,
  properties: Record<string, AnalyticsValue>,
) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("kicker-analytics", {
      detail: {
        name,
        properties,
        type,
      },
    }),
  );
}

export function trackEvent(name: string, properties: AnalyticsProperties = {}) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedProperties = normalizeProperties(properties);

  dispatchLocalAnalyticsEvent("event", name, normalizedProperties);
  window.dataLayer?.push({ event: name, ...normalizedProperties });

  if (window.plausible && PLAUSIBLE_DOMAIN) {
    window.plausible(name, { props: normalizedProperties });
  }

  if (window.gtag && GA_MEASUREMENT_ID) {
    window.gtag("event", name, normalizedProperties);
  }

  if (window.posthog && POSTHOG_ENABLED) {
    window.posthog.capture(name, normalizedProperties);
  }
}

export function trackPageView(path: string) {
  if (typeof window === "undefined") {
    return;
  }

  const normalizedProperties = normalizeProperties({ path });

  dispatchLocalAnalyticsEvent("pageview", "page_view", normalizedProperties);
  window.dataLayer?.push({ event: "page_view", ...normalizedProperties });

  if (window.plausible && PLAUSIBLE_DOMAIN) {
    window.plausible("pageview", { props: normalizedProperties });
  }

  if (window.gtag && GA_MEASUREMENT_ID) {
    window.gtag("event", "page_view", {
      page_path: path,
      ...normalizedProperties,
    });
  }

  if (window.posthog && POSTHOG_ENABLED) {
    window.posthog.capture("$pageview", normalizedProperties);
  }
}

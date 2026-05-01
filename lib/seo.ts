import type { Metadata } from "next";
import type { MetadataRoute } from "next";
import { existsSync } from "node:fs";
import path from "node:path";

export const SITE_NAME = "Kicker News";
export const SITE_DESCRIPTION =
  "Browse trusted U.S. and world headlines in one clean feed. Sign in to save stories, set alerts, and personalize your newsletter.";
export const ORGANIZATION_LOGO_PATH = "/logo-icon.png";
export const DEFAULT_OPEN_GRAPH_IMAGE_PATH = "/og-image.png";
const FALLBACK_OPEN_GRAPH_IMAGE_PATH = "/logo-horizontal.png";

export const PUBLIC_SITEMAP_ENTRIES: Array<{
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
  path: string;
  priority: number;
}> = [
  { changeFrequency: "hourly", path: "/", priority: 1 },
  { changeFrequency: "monthly", path: "/about", priority: 0.7 },
  { changeFrequency: "weekly", path: "/newsletter", priority: 0.8 },
  { changeFrequency: "monthly", path: "/advertise", priority: 0.6 },
  { changeFrequency: "monthly", path: "/contact", priority: 0.5 },
  { changeFrequency: "yearly", path: "/privacy", priority: 0.3 },
  { changeFrequency: "yearly", path: "/terms", priority: 0.3 },
];

export function getSiteUrl() {
  const configuredUrl =
    process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_BASE_URL ||
    "https://kicker.news";

  return configuredUrl.replace(/\/+$/, "");
}

export function buildCanonicalUrl(pathname = "/") {
  const normalizedPathname =
    pathname === "/"
      ? "/"
      : pathname.startsWith("/")
        ? pathname
        : `/${pathname}`;

  return `${getSiteUrl()}${normalizedPathname}`;
}

export function getDefaultOpenGraphImageUrl() {
  const publicDirectory = path.join(process.cwd(), "public");
  const preferredAssetPath = path.join(
    publicDirectory,
    DEFAULT_OPEN_GRAPH_IMAGE_PATH.replace(/^\//, ""),
  );

  if (existsSync(preferredAssetPath)) {
    return buildCanonicalUrl(DEFAULT_OPEN_GRAPH_IMAGE_PATH);
  }

  return buildCanonicalUrl(FALLBACK_OPEN_GRAPH_IMAGE_PATH);
}

export function getOrganizationLogoUrl() {
  return buildCanonicalUrl(ORGANIZATION_LOGO_PATH);
}

export function buildPageMetadata({
  description,
  pathname,
  title,
}: {
  description: string;
  pathname: string;
  title: string;
}): Metadata {
  const canonicalUrl = buildCanonicalUrl(pathname);
  const openGraphImageUrl = getDefaultOpenGraphImageUrl();

  return {
    alternates: {
      canonical: canonicalUrl,
    },
    description,
    openGraph: {
      description,
      images: [
        {
          alt: `${SITE_NAME} preview`,
          url: openGraphImageUrl,
        },
      ],
      siteName: SITE_NAME,
      title,
      type: "website",
      url: canonicalUrl,
    },
    title,
    twitter: {
      card: "summary_large_image",
      description,
      images: [openGraphImageUrl],
      title,
    },
  };
}

export function buildSitemapEntries(
  lastModified = new Date(),
): MetadataRoute.Sitemap {
  return PUBLIC_SITEMAP_ENTRIES.map((entry) => ({
    changeFrequency: entry.changeFrequency,
    lastModified,
    priority: entry.priority,
    url: buildCanonicalUrl(entry.path),
  }));
}

export function serializeJsonLd(value: unknown) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

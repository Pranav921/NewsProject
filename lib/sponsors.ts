import type { SponsorConfig } from "@/lib/types";

function readSponsorConfig(prefix: string): SponsorConfig | null {
  const label = process.env[`${prefix}_LABEL`]?.trim();
  const title = process.env[`${prefix}_TITLE`]?.trim();
  const description = process.env[`${prefix}_DESCRIPTION`]?.trim();
  const ctaText = process.env[`${prefix}_CTA_TEXT`]?.trim();
  const ctaUrl = process.env[`${prefix}_CTA_URL`]?.trim();

  if (!label || !title || !description || !ctaText || !ctaUrl) {
    return null;
  }

  return {
    ctaText,
    ctaUrl,
    description,
    label,
    title,
  };
}

export function getNewsletterTopSponsor(): SponsorConfig | null {
  return readSponsorConfig("NEWSLETTER_TOP_SPONSOR");
}

export function getNewsletterMidSponsor(): SponsorConfig | null {
  return readSponsorConfig("NEWSLETTER_MID_SPONSOR");
}

export function getInFeedSponsor(): SponsorConfig | null {
  const enabled =
    process.env.NEXT_PUBLIC_IN_FEED_SPONSOR_ENABLED?.trim().toLowerCase() ===
    "true";

  if (!enabled) {
    return null;
  }

  return {
    ctaText: "Sponsor Kicker News",
    ctaUrl: "/advertise",
    description: "Reach engaged readers inside a clean, trusted news feed.",
    label: "Sponsored",
    title: "Advertise with Kicker News",
  };
}

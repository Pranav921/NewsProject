import { PublicPageShell } from "@/components/PublicPageShell";
import { buildPageMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = buildPageMetadata({
  description:
    "Learn how Kicker News brings trusted RSS headlines, saved stories, alerts, and newsletters into one clean dashboard.",
  pathname: "/about",
  title: "About Kicker News",
});

export default function AboutPage() {
  return (
    <PublicPageShell
      badge="About Kicker News"
      title="A cleaner way to keep up with the news"
      description="Kicker News is built for readers who want a fast, trustworthy dashboard without the noise. We pull from official RSS and Atom feeds, keep stories deduped, and help you save, filter, and revisit the headlines that matter."
    >
      <p>
        Kicker News is a lightweight news workspace that helps you follow live
        coverage from trusted publishers in one place. Instead of asking you to
        juggle multiple apps or tabs, it brings official feed content into a
        focused dashboard designed for scanning, saving, and returning later.
      </p>
      <p>
        The product combines a live RSS-based feed with saved stories, custom
        alerts, and a newsletter system that avoids duplicate article sends.
        Over time, newsletter recommendations can become more personalized based
        on real engagement, not guesses.
      </p>
      <p>
        The goal is simple: make it easier to stay informed without clutter,
        algorithmic mystery, or endless repetition.
      </p>
    </PublicPageShell>
  );
}

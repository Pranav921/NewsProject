import { AdvertiseContactForm } from "@/components/AdvertiseContactForm";
import { PublicPageShell } from "@/components/PublicPageShell";
import { buildPageMetadata } from "@/lib/seo";
import type { Metadata } from "next";

export const metadata: Metadata = buildPageMetadata({
  description:
    "Explore newsletter sponsorship and advertising opportunities with Kicker News.",
  pathname: "/advertise",
  title: "Advertise with Kicker News",
});

export default function AdvertisePage() {
  return (
    <PublicPageShell
      badge="Advertise"
      title="Partner with Kicker News"
      description="Kicker News is building a focused reader product around trusted RSS coverage and newsletter engagement."
    >
      <p>
        If you are interested in newsletter sponsorships, launch partnerships,
        or audience-relevant promotions, Kicker News can support lightweight
        advertising conversations built around a clean reader experience.
      </p>
      <p>
        Early opportunities may include newsletter top placements, mid-email
        sponsor slots, and in-feed website placements for brands aligned with
        news, productivity, research, media, and information tools.
      </p>
      <p>
        To start the conversation, email{" "}
        <a className="font-medium text-sky-700 hover:text-sky-800" href="mailto:latest@kicker.news">
          latest@kicker.news
        </a>{" "}
        with a short note about your campaign goals, target audience, and desired
        timing.
      </p>
      <AdvertiseContactForm />
    </PublicPageShell>
  );
}

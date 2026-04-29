import { PublicPageShell } from "@/components/PublicPageShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Contact Kicker News for support, feedback, partnership questions, or general inquiries.",
};

export default function ContactPage() {
  return (
    <PublicPageShell
      badge="Contact"
      title="Get in touch"
      description="Questions, feedback, sponsorship interest, or launch partnerships are all welcome."
    >
      <p>
        For support, product feedback, or business inquiries, email{" "}
        <a className="font-medium text-sky-700 hover:text-sky-800" href="mailto:latest@kicker.news">
          latest@kicker.news
        </a>
        .
      </p>
      <p>
        If you are reaching out about newsletter sponsorships or launch
        partnerships, include a short note about your brand, timeline, and
        audience goals so we can respond with the most helpful next step.
      </p>
      <p>
        We keep the contact flow intentionally simple for launch. If a dedicated
        form or support inbox is added later, this page will be updated.
      </p>
    </PublicPageShell>
  );
}

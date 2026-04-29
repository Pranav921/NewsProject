import { PublicPageShell } from "@/components/PublicPageShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy",
  description:
    "Read the Kicker News privacy overview covering accounts, saved stories, newsletter subscriptions, email tracking, analytics, and unsubscribe behavior.",
};

export default function PrivacyPage() {
  return (
    <PublicPageShell
      badge="Privacy"
      title="Privacy overview"
      description="Kicker News keeps the data it needs to run accounts, saved stories, alerts, newsletters, and engagement reporting."
    >
      <p>
        If you create an account, we store the minimum information needed to
        authenticate you and support your dashboard experience. That can include
        your email address, saved article records, alert keywords, and dashboard
        preferences.
      </p>
      <p>
        If you subscribe to the newsletter, we store your newsletter settings,
        delivery history, and unsubscribe status. We also keep article-level send
        history so the same article is not repeatedly sent to you.
      </p>
      <p>
        Newsletter emails may include open tracking and click tracking so we can
        measure engagement, improve delivery quality, and show you user-scoped
        analytics about your own newsletter activity. Those analytics are meant
        for your account only.
      </p>
      <p>
        You can unsubscribe from newsletters at any time using the unsubscribe
        link included in newsletter emails. If you need account-related help or
        want to ask a privacy question, contact{" "}
        <a className="font-medium text-sky-700 hover:text-sky-800" href="mailto:latest@kicker.news">
          latest@kicker.news
        </a>
        .
      </p>
    </PublicPageShell>
  );
}

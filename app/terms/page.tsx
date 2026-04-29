import { PublicPageShell } from "@/components/PublicPageShell";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms",
  description:
    "Review the basic terms for using Kicker News, including account responsibility, third-party publisher links, and acceptable use.",
};

export default function TermsPage() {
  return (
    <PublicPageShell
      badge="Terms"
      title="Terms of use"
      description="These launch-stage terms explain how Kicker News should be used and what users can expect from the product."
    >
      <p>
        Kicker News is a dashboard and newsletter product that organizes links and
        summaries from third-party publishers. Publisher content remains the
        property of the original publisher. Kicker News does not claim ownership
        of the underlying reporting linked through the product.
      </p>
      <p>
        By creating an account, you are responsible for maintaining the security
        of your login credentials and for activity that occurs under your account.
        Please do not use the service in a way that harms the product, other
        users, or third-party publishers.
      </p>
      <p>
        You agree not to abuse the dashboard, automate access in a harmful way,
        or use the product to interfere with normal site operation. We may update
        features, availability, or product copy as the service evolves.
      </p>
      <p>
        If you do not agree with these terms, you should stop using the service.
      </p>
    </PublicPageShell>
  );
}

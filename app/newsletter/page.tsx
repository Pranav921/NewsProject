import { NewsletterSignup } from "@/components/NewsletterSignup";
import { PublicPageShell } from "@/components/PublicPageShell";
import { buildPageMetadata } from "@/lib/seo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NewsletterFrequency } from "@/lib/types";
import type { Metadata } from "next";

export const metadata: Metadata = buildPageMetadata({
  description:
    "Learn how the Kicker News newsletter works, including top stories, no duplicate sends, evolving personalization, and unsubscribe-anytime controls.",
  pathname: "/newsletter",
  title: "Kicker News Newsletter",
});

export default async function NewsletterPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: newsletterRow } = user
    ? await supabase
        .from("newsletter_subscriptions")
        .select("custom_frequency, frequency, is_active")
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const initialSubscriptionStatus = newsletterRow
    ? newsletterRow.is_active
      ? "active"
      : "inactive"
    : "none";

  return (
    <PublicPageShell
      badge="Newsletter"
      title="A cleaner way to catch the day's top stories"
      description="Kicker News newsletters are designed to deliver recent stories you missed, avoid repeats, and become more useful over time."
    >
      <p>
        The Kicker News newsletter starts with the latest stories from trusted
        feeds and avoids resending duplicate articles you already received.
        Delivery settings are flexible, and you can choose the schedule that fits
        your reading habits.
      </p>
      <p>
        As you click stories over time, the product can learn from real
        newsletter engagement and make digests more relevant. Personalization is
        intentionally conservative and only unlocks after enough click history is
        available.
      </p>
      <p>
        The newsletter also works alongside saved stories and alert keywords so
        your inbox can reflect the same interests you track in the dashboard.
        Every send includes unsubscribe options, and you can manage newsletter
        settings from your account.
      </p>
      <div className="mt-8">
        <NewsletterSignup
          initialCustomFrequency={newsletterRow?.custom_frequency ?? null}
          initialEmail={user?.email ?? null}
          initialFrequency={
            (newsletterRow?.frequency as NewsletterFrequency | null) ?? "daily"
          }
          initialSubscriptionStatus={initialSubscriptionStatus}
          title="Join the Kicker News newsletter"
          description="Subscribe here to get the latest Kicker News headlines by email with your preferred cadence."
        />
      </div>
    </PublicPageShell>
  );
}

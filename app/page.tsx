import { DashboardView } from "@/components/DashboardView";
import { PublicNewsView } from "@/components/PublicNewsView";
import { PublicFooter } from "@/components/PublicFooter";
import { fromAlertKeywordRows } from "@/lib/custom-alerts";
import { getAllNewsItems } from "@/lib/rss";
import { fromSavedArticleRows } from "@/lib/saved-articles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NewsItem, NewsletterFrequency } from "@/lib/types";
import { normalizeUserPreferences } from "@/lib/user-preferences";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = {
  title: "Kicker News | Today's Top Headlines in One Clean Feed",
  description:
    "Browse trusted headlines in one clean feed. Sign in to save stories, set alerts, and personalize your newsletter.",
};

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let articles: NewsItem[] = [];
  let feedErrorMessage: string | null = null;

  try {
    articles = await getAllNewsItems({ fresh: true });
  } catch {
    feedErrorMessage =
      "We couldn't load the live feed right now. Please refresh and try again in a moment.";
  }

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <PublicNewsView articles={articles} feedErrorMessage={feedErrorMessage} />
      </main>
    );
  }

  const { data: newsletterRow } = await supabase
    .from("newsletter_subscriptions")
    .select("custom_frequency, frequency, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: userPreferencesRow } = await supabase
    .from("user_preferences")
    .select("default_source_filter, default_time_filter, default_view_mode")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: savedArticleRows } = await supabase
    .from("saved_articles")
    .select("article_link, title, source, summary, published_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  const { data: alertKeywordRows } = await supabase
    .from("user_alert_keywords")
    .select("keyword")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  const initialPreferences = normalizeUserPreferences(
    userPreferencesRow
      ? {
          defaultSourceFilter: userPreferencesRow.default_source_filter,
          defaultTimeFilter: userPreferencesRow.default_time_filter,
          defaultViewMode: userPreferencesRow.default_view_mode,
        }
      : null,
  );
  const initialSavedArticles = fromSavedArticleRows(savedArticleRows);
  const initialAlertKeywords = fromAlertKeywordRows(alertKeywordRows);
  const initialNewsletterSubscriptionStatus = newsletterRow
    ? newsletterRow.is_active
      ? "active"
      : "inactive"
    : "none";

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
      <DashboardView
        articles={articles}
        feedErrorMessage={feedErrorMessage}
        initialNewsletterCustomFrequency={newsletterRow?.custom_frequency ?? null}
        initialNewsletterFrequency={
          (newsletterRow?.frequency as NewsletterFrequency | null) ?? null
        }
        initialNewsletterSubscriptionStatus={initialNewsletterSubscriptionStatus}
        initialAlertKeywords={initialAlertKeywords}
        initialPreferences={initialPreferences}
        initialSavedArticles={initialSavedArticles}
        userEmail={user.email ?? null}
        userId={user.id}
      />
      <section className="mt-5">
        <PublicFooter />
      </section>
    </main>
  );
}

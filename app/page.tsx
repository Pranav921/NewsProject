import { AuthPanel } from "@/components/AuthPanel";
import { DashboardView } from "@/components/DashboardView";
import { PublicFooter } from "@/components/PublicFooter";
import { fromAlertKeywordRows } from "@/lib/custom-alerts";
import { getAllNewsItems } from "@/lib/rss";
import { fromSavedArticleRows } from "@/lib/saved-articles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NewsItem, NewsletterFrequency } from "@/lib/types";
import { normalizeUserPreferences } from "@/lib/user-preferences";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 items-start px-3 py-4 sm:items-center sm:px-6 sm:py-6 lg:px-8">
        <div className="w-full space-y-4">
          <section className="w-full rounded-[1.45rem] border border-slate-200 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.07)] sm:rounded-[1.6rem] sm:p-6 lg:p-7">
            <div className="grid gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,390px)] lg:items-center">
              <div className="text-center lg:text-left">
                <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800">
                  Kicker News
                </div>
                <h1 className="mt-3 max-w-3xl text-balance text-[1.85rem] font-semibold tracking-tight text-slate-950 sm:mt-3.5 sm:text-[2.7rem] lg:text-[2.95rem]">
                  Breaking news in one clean feed
                </h1>
                <p className="mt-2.5 max-w-2xl text-sm leading-6 text-slate-600 sm:mt-3 sm:text-base">
                  Follow trusted coverage, save stories, set alerts, and keep your
                  newsletter preferences in one fast dashboard.
                </p>

                <div className="mt-4 hidden gap-2 text-left sm:mt-5 sm:grid sm:grid-cols-3 sm:gap-2.5">
                  <FeaturePill
                    title="Live feed"
                    description="Official RSS and Atom sources, deduped and sorted newest first."
                  />
                  <FeaturePill
                    title="Smart alerts"
                    description="Catch important matches from your keywords without extra noise."
                  />
                  <FeaturePill
                    title="Newsletter"
                    description="Track engagement and unlock more relevant digests over time."
                  />
                </div>
              </div>

              <div className="grid gap-2.5 lg:justify-items-end">
                <AuthPanel />
              </div>
            </div>
          </section>
          <PublicFooter />
        </div>
      </main>
    );
  }

  const { data: userPreferencesRow } = await supabase
    .from("user_preferences")
    .select("default_source_filter, default_time_filter, default_view_mode")
    .maybeSingle();
  const { data: savedArticleRows } = await supabase
    .from("saved_articles")
    .select("article_link, title, source, summary, published_at")
    .order("created_at", { ascending: false });
  const { data: alertKeywordRows } = await supabase
    .from("user_alert_keywords")
    .select("keyword")
    .order("created_at", { ascending: true });
  const { data: newsletterRow } = await supabase
    .from("newsletter_subscriptions")
    .select("custom_frequency, frequency, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  let articles: NewsItem[] = [];
  let feedErrorMessage: string | null = null;

  try {
    articles = await getAllNewsItems({ fresh: true });
  } catch {
    feedErrorMessage =
      "We couldn't load the live feed right now. Please refresh and try again in a moment.";
  }
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

function FeaturePill({
  description,
  title,
}: {
  description: string;
  title: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5">
      <p className="text-sm font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm leading-5 text-slate-600">{description}</p>
    </div>
  );
}

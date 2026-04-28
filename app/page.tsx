import { AuthPanel } from "@/components/AuthPanel";
import { DashboardView } from "@/components/DashboardView";
import { fromAlertKeywordRows } from "@/lib/custom-alerts";
import { getAllNewsItems } from "@/lib/rss";
import { fromSavedArticleRows } from "@/lib/saved-articles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
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
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 items-center px-4 py-6 sm:px-6 lg:px-8">
        <section className="w-full rounded-[1.6rem] border border-slate-200 bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.07)] sm:p-6 lg:p-7">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,390px)] lg:items-center">
            <div className="text-center lg:text-left">
              <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-800">
                Kicker News
              </div>
              <h1 className="mt-3.5 max-w-3xl text-balance text-[2.4rem] font-semibold tracking-tight text-slate-950 sm:text-[2.7rem] lg:text-[2.95rem]">
                Latest headlines from trusted RSS feeds
              </h1>
              <p className="mt-3 max-w-2xl text-[15px] leading-6 text-slate-600 sm:text-base">
                Follow breaking stories in one clean dashboard with saved articles,
                smart alerts, personalized newsletter tools, and fast refreshes.
              </p>

              <div className="mt-5 grid gap-2.5 text-left sm:grid-cols-3">
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

            <div className="grid gap-3 lg:justify-items-end">
              <AuthPanel />
            </div>
          </div>
        </section>
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
  const articles = await getAllNewsItems({ fresh: true });
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

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
      <DashboardView
        articles={articles}
        initialAlertKeywords={initialAlertKeywords}
        initialPreferences={initialPreferences}
        initialSavedArticles={initialSavedArticles}
        userEmail={user.email ?? null}
        userId={user.id}
      />
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

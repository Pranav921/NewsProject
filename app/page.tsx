import { AuthPanel } from "@/components/AuthPanel";
import { NewArticlesPrompt } from "@/components/NewArticlesPrompt";
import { NewsFeed } from "@/components/NewsFeed";
import { NewsletterSignup } from "@/components/NewsletterSignup";
import { RefreshButton } from "@/components/RefreshButton";
import { UserMenu } from "@/components/UserMenu";
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
      <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <section className="flex w-full max-w-xl flex-col items-center text-center">
          <div className="w-full">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
              Breaking News Dashboard
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Latest headlines from trusted RSS feeds
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              Sign in to access your live news feed, saved articles, custom alerts,
              smart alerts, and the rest of your personalized dashboard.
            </p>
          </div>

          <div className="mt-8 flex w-full justify-center">
            <AuthPanel />
          </div>

          <div className="mt-6 w-full">
            <NewsletterSignup />
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
  const articleLinks = articles.map((article) => article.link);
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
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_27rem] lg:items-start">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
              Breaking News Dashboard
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Latest headlines from trusted RSS feeds
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-600">
              This homepage fetches official RSS feeds, turns the XML into typed
              article data, removes duplicate links, and sorts everything by
              newest first.
            </p>
          </div>

          <div className="flex w-full flex-col gap-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="flex">
                <RefreshButton currentLinks={articleLinks} />
              </div>
              <Link
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full border border-slate-300 bg-slate-50 px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-white"
                href="/account"
              >
                Account settings
              </Link>
            </div>

            <UserMenu email={user.email ?? null} />
          </div>
        </div>
      </section>

      <NewArticlesPrompt
        key={articleLinks.join("|")}
        initialLinks={articleLinks}
      />

      <section className="mt-8">
        <NewsFeed
          articles={articles}
          initialAlertKeywords={initialAlertKeywords}
          initialPreferences={initialPreferences}
          initialSavedArticles={initialSavedArticles}
          userId={user.id}
        />
      </section>

      <section className="mt-8">
        <NewsletterSignup
          initialEmail={user.email ?? null}
          title="Newsletter sign-up"
          description="Save your email and preferred delivery cadence now, and actual sending can be added later."
        />
      </section>
    </main>
  );
}
import Link from "next/link";

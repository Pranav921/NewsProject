import { DashboardView } from "@/components/DashboardView";
import { PublicNewsView } from "@/components/PublicNewsView";
import { PublicFooter } from "@/components/PublicFooter";
import { fromAlertKeywordRows } from "@/lib/custom-alerts";
import { getAllNewsItems } from "@/lib/rss";
import { fromSavedArticleRows } from "@/lib/saved-articles";
import {
  buildCanonicalUrl,
  buildPageMetadata,
  getOrganizationLogoUrl,
  getSiteUrl,
  serializeJsonLd,
  SITE_NAME,
} from "@/lib/seo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { NewsItem } from "@/lib/types";
import { normalizeUserPreferences } from "@/lib/user-preferences";
import { unstable_cache } from "next/cache";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const metadata: Metadata = buildPageMetadata({
  description:
    "Browse trusted U.S. and world headlines in one clean feed. Sign in to save stories, set alerts, and personalize your newsletter.",
  pathname: "/",
  title: "Kicker News | Today's Top Headlines in One Clean Feed",
});

const getCachedHomepageNewsItems = unstable_cache(
  async () => getAllNewsItems({ fresh: true }),
  ["homepage-rss-articles"],
  {
    revalidate: 90,
  },
);

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let articles: NewsItem[] = [];
  let feedErrorMessage: string | null = null;

  try {
    articles = await getCachedHomepageNewsItems();
  } catch {
    feedErrorMessage =
      "We couldn't load the live feed right now. Please refresh and try again in a moment.";
  }

  const homepageStructuredData = [
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      logo: getOrganizationLogoUrl(),
      name: SITE_NAME,
      url: getSiteUrl(),
    },
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      description:
        "Browse trusted U.S. and world headlines in one clean feed. Sign in to save stories, set alerts, and personalize your newsletter.",
      name: SITE_NAME,
      url: getSiteUrl(),
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      itemListElement: articles.slice(0, 10).map((article, index) => ({
        "@type": "ListItem",
        item: {
          "@type": "CreativeWork",
          ...(article.publishedAt ? { datePublished: article.publishedAt } : {}),
          ...(article.source
            ? {
                provider: {
                  "@type": "Organization",
                  name: article.source,
                },
              }
            : {}),
          name: article.title,
          url: article.link,
        },
        position: index + 1,
        url: article.link,
      })),
      name: "Kicker News public feed",
      url: buildCanonicalUrl("/"),
    },
  ];

  if (!user) {
    return (
      <main className="mx-auto flex min-h-screen w-full flex-1 flex-col px-3 py-4 sm:px-6 sm:py-6 lg:px-7 xl:px-7 2xl:px-8">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd(homepageStructuredData),
          }}
        />
        <PublicNewsView articles={articles} feedErrorMessage={feedErrorMessage} />
      </main>
    );
  }

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

  return (
    <main className="mx-auto flex w-full flex-1 flex-col px-3 py-4 sm:px-6 lg:px-7 lg:py-5 xl:px-7 2xl:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(homepageStructuredData),
        }}
      />
      <DashboardView
        articles={articles}
        feedErrorMessage={feedErrorMessage}
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

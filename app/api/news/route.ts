import { getAllNewsItems } from "@/lib/rss";
import { enhanceLeadArticleImage } from "@/lib/article-images";
import { buildNewsApiPayload, shouldBypassNewsCache } from "@/lib/news-api";
import { logApiError, logApiInfo } from "@/lib/api-logging";
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const getCachedNewsItems = unstable_cache(
  async () => getAllNewsItems({ fresh: true }),
  ["api-news-rss"],
  {
    revalidate: 90,
  },
);

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const bypassCache = shouldBypassNewsCache(requestUrl.searchParams);
    let articles = bypassCache
      ? await getAllNewsItems({ fresh: true })
      : await getCachedNewsItems();
    articles = await enhanceLeadArticleImage(articles);

    logApiInfo("[news][get]", {
      articleCount: articles.length,
      cacheMode: bypassCache ? "fresh" : "cached",
    });

    // Return the same parsed RSS data as JSON so client components can check for
    // updates without duplicating the parsing logic in the browser.
    return NextResponse.json(
      buildNewsApiPayload(articles),
      {
        headers: {
          "Cache-Control": bypassCache
            ? "no-store, max-age=0"
            : "public, s-maxage=90, stale-while-revalidate=300",
        },
      },
    );
  } catch (error) {
    logApiError("[news][get][error]", error);

    return NextResponse.json(
      { message: "Unable to load the news feed right now." },
      { status: 500 },
    );
  }
}

import { getNewsSnapshot } from "@/lib/rss";
import { enhanceLeadArticleImage } from "@/lib/article-images";
import { buildNewsApiPayload, shouldBypassNewsCache } from "@/lib/news-api";
import { logApiError, logApiInfo } from "@/lib/api-logging";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const requestUrl = new URL(request.url);
    const bypassCache = shouldBypassNewsCache(requestUrl.searchParams);
    const snapshot = await getNewsSnapshot({ fresh: bypassCache });
    if (!snapshot.articles.length) return NextResponse.json({ message: "News feeds are unavailable right now. Please try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "15" } });
    // Polling needs links/metadata, not another publisher article-page fetch.
    const articles = requestUrl.searchParams.has("checkForUpdates") ? snapshot.articles : await enhanceLeadArticleImage(snapshot.articles);

    logApiInfo("[news][get]", {
      articleCount: articles.length,
      cacheMode: bypassCache ? "fresh" : "cached",
    });

    // Return the same parsed RSS data as JSON so client components can check for
    // updates without duplicating the parsing logic in the browser.
    return NextResponse.json(
      { ...buildNewsApiPayload(articles), feedStatus: snapshot.feedStatus },
      {
        headers: {
          "Cache-Control": bypassCache || snapshot.feedStatus.failedFeeds
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

import { getAllNewsItems } from "@/lib/rss";
import { logApiError, logApiInfo } from "@/lib/api-logging";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const articles = await getAllNewsItems({ fresh: true });

    logApiInfo("[news][get]", {
      articleCount: articles.length,
    });

    // Return the same parsed RSS data as JSON so client components can check for
    // updates without duplicating the parsing logic in the browser.
    return NextResponse.json({ articles });
  } catch (error) {
    logApiError("[news][get][error]", error);

    return NextResponse.json(
      { message: "Unable to load the news feed right now." },
      { status: 500 },
    );
  }
}

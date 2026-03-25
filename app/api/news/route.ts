import { getAllNewsItems } from "@/lib/rss";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const articles = await getAllNewsItems({ fresh: true });

  // Return the same parsed RSS data as JSON so client components can check for
  // updates without duplicating the parsing logic in the browser.
  return NextResponse.json({ articles });
}

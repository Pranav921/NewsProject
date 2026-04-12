import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const sendLogId = requestUrl.searchParams.get("sid");
  const subscriptionId = requestUrl.searchParams.get("sub");
  const destination = requestUrl.searchParams.get("url");

  if (sendLogId && subscriptionId && destination) {
    const subscriptionIdValue = Number(subscriptionId);

    if (!Number.isNaN(subscriptionIdValue)) {
      const supabase = createSupabaseAdminClient();
      const { error } = await supabase.from("email_click_events").insert({
        article_link: destination,
        send_log_id: sendLogId,
        subscription_id: subscriptionIdValue,
      });

      if (error) {
        console.error("[email-click] insert failed", error);
      }
    }
  }

  if (!destination) {
    return NextResponse.json({ message: "Missing url." }, { status: 400 });
  }

  return NextResponse.redirect(destination);
}

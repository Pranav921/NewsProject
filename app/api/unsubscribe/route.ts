import { logApiError, logApiInfo } from "@/lib/api-logging";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token")?.trim() ?? "";
  const redirectUrl = new URL("/unsubscribe/success", requestUrl.origin);

  if (!token) {
    redirectUrl.searchParams.set("status", "invalid");
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = createSupabaseAdminClient();
  const { data: subscription, error: lookupError } = await supabase
    .from("newsletter_subscriptions")
    .select("id")
    .eq("unsubscribe_token", token)
    .maybeSingle();

  if (lookupError || !subscription) {
    if (lookupError) {
      logApiError("[unsubscribe][lookup]", lookupError);
    }

    redirectUrl.searchParams.set("status", "invalid");
    return NextResponse.redirect(redirectUrl);
  }

  const { error: updateError } = await supabase
    .from("newsletter_subscriptions")
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq("id", subscription.id);

  if (updateError) {
    logApiError("[unsubscribe][update]", updateError, {
      subscriptionId: subscription.id,
    });
    redirectUrl.searchParams.set("status", "error");
    return NextResponse.redirect(redirectUrl);
  }

  logApiInfo("[unsubscribe][success]", {
    subscriptionId: subscription.id,
  });

  redirectUrl.searchParams.set("status", "success");
  return NextResponse.redirect(redirectUrl);
}

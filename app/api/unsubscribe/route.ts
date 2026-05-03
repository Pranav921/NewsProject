import { logApiError, logApiInfo } from "@/lib/api-logging";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleUnsubscribeRequest(request, "redirect");
}

export async function POST(request: Request) {
  return handleUnsubscribeRequest(request, "one-click");
}

async function handleUnsubscribeRequest(
  request: Request,
  mode: "one-click" | "redirect",
) {
  const requestUrl = new URL(request.url);
  const token = requestUrl.searchParams.get("token")?.trim() ?? "";
  const redirectUrl = new URL("/unsubscribe/success", requestUrl.origin);

  if (!token) {
    if (mode === "one-click") {
      return new NextResponse(null, { status: 400 });
    }

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

    if (mode === "one-click") {
      return new NextResponse(null, { status: 404 });
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

    if (mode === "one-click") {
      return new NextResponse(null, { status: 500 });
    }

    redirectUrl.searchParams.set("status", "error");
    return NextResponse.redirect(redirectUrl);
  }

  logApiInfo("[unsubscribe][success]", {
    subscriptionId: subscription.id,
  });

  if (mode === "one-click") {
    return new NextResponse(null, { status: 200 });
  }

  redirectUrl.searchParams.set("status", "success");
  return NextResponse.redirect(redirectUrl);
}

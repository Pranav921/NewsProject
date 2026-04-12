import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ONE_BY_ONE_GIF = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0,
  59,
]);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sendLogId = searchParams.get("sid");
  const subscriptionId = searchParams.get("sub");

  if (sendLogId && subscriptionId) {
    const supabase = createSupabaseAdminClient();
    const subscriptionIdValue = Number(subscriptionId);

    if (!Number.isNaN(subscriptionIdValue)) {
      const { error } = await supabase.from("email_open_events").insert({
        send_log_id: sendLogId,
        subscription_id: subscriptionIdValue,
      });

      if (error) {
        console.error("[email-open] insert failed", error);
      }
    }
  }

  return new NextResponse(ONE_BY_ONE_GIF, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}

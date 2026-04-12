import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ONE_BY_ONE_GIF = Uint8Array.from([
  71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 128, 0, 0, 0, 0, 0, 255, 255, 255, 33,
  249, 4, 1, 0, 0, 0, 0, 44, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 68, 1, 0,
  59,
]);

function getIpAddress(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }

  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sendLogId = searchParams.get("sendLogId");
  const subscriptionId = searchParams.get("subscriptionId");
  const email = searchParams.get("email");

  if (sendLogId && subscriptionId && email) {
    const supabase = createSupabaseAdminClient();
    const subscriptionIdValue = Number(subscriptionId);

    if (!Number.isNaN(subscriptionIdValue)) {
      const userAgent = request.headers.get("user-agent");
      const ipAddress = getIpAddress(request);

      const { error } = await supabase.from("email_open_events").insert({
        send_log_id: sendLogId,
        subscription_id: subscriptionIdValue,
        email,
        user_agent: userAgent,
        ip_address: ipAddress,
      });

      if (error) {
        const fallback = await supabase.from("email_open_events").insert({
          send_log_id: sendLogId,
          subscription_id: subscriptionIdValue,
          email,
        });

        if (fallback.error) {
          console.error("[newsletter-open] insert failed", fallback.error);
        } else {
          console.error("[newsletter-open] insert failed", error);
        }
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

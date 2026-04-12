import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function parseDestination(rawUrl: string | null) {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    try {
      const encoded = encodeURI(rawUrl);
      const parsed = new URL(encoded);

      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }

      return parsed.toString();
    } catch {
      return null;
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sendLogId = searchParams.get("sendLogId");
  const subscriptionId = searchParams.get("subscriptionId");
  const email = searchParams.get("email");
  const rawUrl = searchParams.get("url");
  const title = searchParams.get("title");
  const source = searchParams.get("source");

  const destination = parseDestination(rawUrl);

  if (sendLogId && subscriptionId && email && destination) {
    const supabase = createSupabaseAdminClient();
    const subscriptionIdValue = Number(subscriptionId);

    if (!Number.isNaN(subscriptionIdValue)) {
      const userAgent = request.headers.get("user-agent");
      const ipAddress = getIpAddress(request);

      const { error } = await supabase.from("email_click_events").insert({
        send_log_id: sendLogId,
        subscription_id: subscriptionIdValue,
        email,
        article_link: destination,
        article_title: title,
        article_source: source,
        user_agent: userAgent,
        ip_address: ipAddress,
      });

      if (error) {
        const fallback = await supabase.from("email_click_events").insert({
          send_log_id: sendLogId,
          subscription_id: subscriptionIdValue,
          email,
          article_link: destination,
          article_title: title,
          article_source: source,
        });

        if (fallback.error) {
          console.error("[newsletter-click] insert failed", fallback.error);
        } else {
          console.error("[newsletter-click] insert failed", error);
        }
      }
    }
  }

  if (!destination) {
    return NextResponse.json(
      { error: "Invalid or missing destination URL." },
      { status: 400 }
    );
  }

  return NextResponse.redirect(destination, 302);
}

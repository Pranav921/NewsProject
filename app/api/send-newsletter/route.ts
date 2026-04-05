import { getAllNewsItems } from "@/lib/rss";
import {
  buildNewsletterEmailHtml,
  buildNewsletterEmailSubject,
  buildNewsletterEmailText,
  canUserReceiveAutomaticNewsletterNow,
  getUserNewsletterPlan,
  getRecentNewsletterArticles,
  type NewsletterSubscriptionRow,
} from "@/lib/newsletter";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

const NEWSLETTER_FROM = "Kicker News <latest@kicker.news>";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SendResultSummary = {
  attempted: number;
  eligible_users: number;
  failed: number;
  sent: number;
  skipped: number;
};

export async function GET(request: Request) {
  const authorizationHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isDevelopment = process.env.NODE_ENV === "development";

  if (
    !isDevelopment &&
    (!cronSecret || authorizationHeader !== `Bearer ${cronSecret}`)
  ) {
    return NextResponse.json({ message: "Unauthorized." }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json(
      { message: "Missing RESEND_API_KEY environment variable." },
      { status: 500 },
    );
  }

  const supabase = createSupabaseAdminClient();
  const now = new Date();
  const { data: subscriptions, error: subscriptionsError } = await supabase
    .from("newsletter_subscriptions")
    .select(
      "id, user_id, email, frequency, custom_frequency, is_active, last_sent_at, last_status, last_error",
    )
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (subscriptionsError) {
    console.error("[send-newsletter][subscriptions]", subscriptionsError);

    return NextResponse.json(
      { message: subscriptionsError.message || "Unable to load subscriptions." },
      { status: 500 },
    );
  }

  const activeSubscriptions = (subscriptions ?? []) as NewsletterSubscriptionRow[];
  const testEmail = process.env.TEST_NEWSLETTER_EMAIL?.trim().toLowerCase() ?? "";
  const filteredSubscriptions = testEmail
    ? activeSubscriptions.filter(
        (subscription) => subscription.email.toLowerCase() === testEmail,
      )
    : activeSubscriptions;
  const recentArticles = getRecentNewsletterArticles(
    await getAllNewsItems({ fresh: true }),
    now,
  );
  const summary: SendResultSummary = {
    attempted: 0,
    eligible_users: 0,
    failed: 0,
    sent: 0,
    skipped: activeSubscriptions.length - filteredSubscriptions.length,
  };

  for (const subscription of filteredSubscriptions) {
    const eligibility = canUserReceiveAutomaticNewsletterNow(subscription, now);

    if (!eligibility.eligible) {
      summary.skipped += 1;
      continue;
    }

    summary.eligible_users += 1;

    if (recentArticles.length === 0) {
      summary.skipped += 1;
      continue;
    }

    summary.attempted += 1;
    const plan = getUserNewsletterPlan(subscription);

    const sendResult = await sendNewsletterEmail({
      email: subscription.email,
      html: buildNewsletterEmailHtml(recentArticles, now),
      idempotencyKey: `newsletter-${subscription.id}-${plan.automaticFrequency}-${now
        .toISOString()
        .slice(0, 13)}`,
      subject: buildNewsletterEmailSubject(recentArticles.length),
      text: buildNewsletterEmailText(recentArticles),
    });

    if (sendResult.ok) {
      summary.sent += 1;

      const { error: updateError } = await supabase
        .from("newsletter_subscriptions")
        .update({
          last_error: null,
          last_sent_at: now.toISOString(),
          last_status: "sent",
        })
        .eq("id", subscription.id);

      if (updateError) {
        console.error("[send-newsletter][update-success]", updateError);
      }

      continue;
    }

    summary.failed += 1;

    const { error: updateError } = await supabase
      .from("newsletter_subscriptions")
      .update({
        last_error: sendResult.errorMessage,
        last_status: "failed",
      })
      .eq("id", subscription.id);

    if (updateError) {
      console.error("[send-newsletter][update-failure]", updateError);
    }
  }

  return NextResponse.json(summary);
}

async function sendNewsletterEmail({
  email,
  html,
  idempotencyKey,
  subject,
  text,
}: {
  email: string;
  html: string;
  idempotencyKey: string;
  subject: string;
  text: string;
}) {
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "User-Agent": "kicker-news-newsletter/0.1",
      },
      body: JSON.stringify({
        from: NEWSLETTER_FROM,
        html,
        subject,
        text,
        to: [email],
      }),
    });

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 1000);

      return {
        errorMessage: `Resend error ${response.status}: ${errorBody}`,
        ok: false as const,
      };
    }

    return {
      ok: true as const,
    };
  } catch (error) {
    return {
      errorMessage:
        error instanceof Error ? error.message : "Unknown send error.",
      ok: false as const,
    };
  }
}

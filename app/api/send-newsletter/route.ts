import { getAllNewsItems } from "@/lib/rss";
import {
  buildNewsletterEmailHtml,
  buildNewsletterEmailSubject,
  buildNewsletterEmailText,
  buildNewsletterUnsubscribeUrl,
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
  const debugNewsletterSends = isDevelopment;

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
      "id, user_id, email, frequency, custom_frequency, is_active, last_sent_at, last_status, last_error, unsubscribe_token",
    )
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (subscriptionsError) {
    console.error("[send-newsletter][subscriptions]", subscriptionsError);

    return NextResponse.json(
      {
        message: subscriptionsError.message || "Unable to load subscriptions.",
      },
      { status: 500 },
    );
  }

  const activeSubscriptions = (subscriptions ??
    []) as NewsletterSubscriptionRow[];
  const testEmail =
    process.env.TEST_NEWSLETTER_EMAIL?.trim().toLowerCase() ?? "";
  const filteredSubscriptions = testEmail
    ? activeSubscriptions.filter(
        (subscription) => subscription.email.toLowerCase() === testEmail,
      )
    : activeSubscriptions;

  if (debugNewsletterSends) {
    console.log("[send-newsletter][debug] active subscriptions", {
      activeCount: activeSubscriptions.length,
      filteredCount: filteredSubscriptions.length,
      testNewsletterEmailOverride: testEmail || null,
    });
  }

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
    if (debugNewsletterSends) {
      console.log("[send-newsletter][debug] evaluating subscription", {
        custom_frequency: subscription.custom_frequency,
        email: subscription.email,
        frequency: subscription.frequency,
        id: subscription.id,
        is_active: subscription.is_active,
        last_sent_at: subscription.last_sent_at,
        user_id: subscription.user_id,
      });
    }

    const eligibility = canUserReceiveAutomaticNewsletterNow(subscription, now);

    if (!eligibility.eligible) {
      if (debugNewsletterSends) {
        console.log("[send-newsletter][debug] skipped subscription", {
          email: subscription.email,
          reason: eligibility.reason,
          subscriptionId: subscription.id,
        });
      }

      summary.skipped += 1;

      await insertEmailSendLog(supabase, {
        articleCount: recentArticles.length,
        email: subscription.email,
        error: eligibility.reason,
        sentAt: now.toISOString(),
        status: "skipped",
        subscriptionId: subscription.id,
        userId: subscription.user_id,
      });

      continue;
    }

    summary.eligible_users += 1;

    if (recentArticles.length === 0) {
      summary.skipped += 1;

      await insertEmailSendLog(supabase, {
        articleCount: 0,
        email: subscription.email,
        error: "no-recent-articles",
        sentAt: now.toISOString(),
        status: "skipped",
        subscriptionId: subscription.id,
        userId: subscription.user_id,
      });

      continue;
    }

    summary.attempted += 1;

    const plan = getUserNewsletterPlan(subscription);
    const unsubscribeToken = await ensureUnsubscribeToken(
      supabase,
      subscription,
    );

    if (!unsubscribeToken) {
      if (debugNewsletterSends) {
        console.error(
          "[send-newsletter][debug] unsubscribe token generation failed",
          {
            email: subscription.email,
            subscriptionId: subscription.id,
          },
        );
      }

      summary.failed += 1;

      await insertEmailSendLog(supabase, {
        articleCount: recentArticles.length,
        email: subscription.email,
        error: "unsubscribe-token-generation-failed",
        sentAt: now.toISOString(),
        status: "failed",
        subscriptionId: subscription.id,
        userId: subscription.user_id,
      });

      continue;
    }

    const unsubscribeUrl = buildNewsletterUnsubscribeUrl(unsubscribeToken);

    if (debugNewsletterSends) {
      console.log("[send-newsletter][debug] attempting send", {
        articleCount: recentArticles.length,
        email: subscription.email,
        frequency: subscription.frequency,
        last_sent_at: subscription.last_sent_at,
        overrideRecipient: testEmail || null,
        planFrequency: plan.automaticFrequency,
        subscriptionId: subscription.id,
        unsubscribeUrl,
      });
    }

    const sendResult = await sendNewsletterEmail({
      email: subscription.email,
      debug: debugNewsletterSends,
      html: buildNewsletterEmailHtml(recentArticles, now, unsubscribeUrl),
      idempotencyKey: crypto.randomUUID(),
      subject: buildNewsletterEmailSubject(recentArticles.length),
      text: buildNewsletterEmailText(recentArticles, unsubscribeUrl),
    });

    if (sendResult.ok) {
      if (debugNewsletterSends) {
        console.log("[send-newsletter][debug] send succeeded", {
          email: subscription.email,
          resendId: sendResult.resendId ?? null,
          subscriptionId: subscription.id,
        });
      }

      summary.sent += 1;

      await insertEmailSendLog(supabase, {
        articleCount: recentArticles.length,
        email: subscription.email,
        error: null,
        sentAt: now.toISOString(),
        status: "sent",
        subscriptionId: subscription.id,
        userId: subscription.user_id,
      });

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

    if (debugNewsletterSends) {
      console.error("[send-newsletter][debug] send failed", {
        email: subscription.email,
        error: sendResult.errorMessage,
        subscriptionId: subscription.id,
      });
    }

    summary.failed += 1;

    await insertEmailSendLog(supabase, {
      articleCount: recentArticles.length,
      email: subscription.email,
      error: sendResult.errorMessage,
      sentAt: now.toISOString(),
      status: "failed",
      subscriptionId: subscription.id,
      userId: subscription.user_id,
    });

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
  debug,
  email,
  html,
  idempotencyKey,
  subject,
  text,
}: {
  debug: boolean;
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

    if (debug) {
      console.log("[send-newsletter][debug] Resend HTTP response", {
        ok: response.ok,
        recipient: email,
        status: response.status,
        statusText: response.statusText,
      });
    }

    if (!response.ok) {
      const errorBody = (await response.text()).slice(0, 1000);

      if (debug) {
        console.error("[send-newsletter][debug] Resend error body", {
          body: errorBody,
          recipient: email,
        });
      }

      return {
        errorMessage: `Resend error ${response.status}: ${errorBody}`,
        ok: false as const,
      };
    }

    const responseBody = (await response.json()) as { id?: string };

    if (debug) {
      console.log("[send-newsletter][debug] Resend success body", {
        id: responseBody.id ?? null,
        recipient: email,
      });
    }

    return {
      ok: true as const,
      resendId: responseBody.id ?? null,
    };
  } catch (error) {
    if (debug) {
      console.error("[send-newsletter][debug] caught send error", {
        error: error instanceof Error ? (error.stack ?? error.message) : error,
        recipient: email,
      });
    }

    return {
      errorMessage:
        error instanceof Error ? error.message : "Unknown send error.",
      ok: false as const,
    };
  }
}

async function ensureUnsubscribeToken(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  subscription: NewsletterSubscriptionRow,
) {
  if (subscription.unsubscribe_token) {
    return subscription.unsubscribe_token;
  }

  const nextToken = crypto.randomUUID().replace(/-/g, "");
  const { error } = await supabase
    .from("newsletter_subscriptions")
    .update({
      unsubscribe_token: nextToken,
    })
    .eq("id", subscription.id)
    .is("unsubscribe_token", null);

  if (error) {
    console.error("[send-newsletter][unsubscribe-token]", error);
    return null;
  }

  return nextToken;
}

async function insertEmailSendLog(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    articleCount,
    email,
    error,
    sentAt,
    status,
    subscriptionId,
    userId,
  }: {
    articleCount: number | null;
    email: string;
    error: string | null;
    sentAt: string;
    status: "failed" | "sent" | "skipped";
    subscriptionId: number | null;
    userId: string | null;
  },
) {
  const { error: insertError } = await supabase.from("email_send_logs").insert({
    article_count: articleCount,
    email,
    error,
    sent_at: sentAt,
    status,
    subscription_id: subscriptionId,
    user_id: userId,
  });

  if (insertError) {
    console.error("[send-newsletter][email-send-log]", insertError);
  }
}

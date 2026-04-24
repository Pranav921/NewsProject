import { getAllNewsItems } from "@/lib/rss";
import {
  buildNewsletterEmailHtml,
  buildNewsletterEmailSubject,
  buildNewsletterEmailText,
  buildNewsletterUnsubscribeUrl,
  canUserReceiveAutomaticNewsletterNow,
  getRecentNewsletterArticles,
  type NewsletterSubscriptionRow,
} from "@/lib/newsletter";
import {
  selectNewsletterArticlesForUser,
  type PersonalizationProfile,
} from "@/lib/personalization";
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
      "id, user_id, email, frequency, custom_frequency, email_format, article_mode, is_active, last_sent_at, last_status, last_error, unsubscribe_token",
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
  const personalizationMaps = await getPersonalizationMaps(
    supabase,
    filteredSubscriptions,
  );

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

      await insertEmailSendLog(supabase, {
        articleCount: recentArticles.length,
        email: subscription.email,
        error: eligibility.reason,
        sentAt: now.toISOString(),
        status: "skipped",
        sendLogId: crypto.randomUUID(),
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
        sendLogId: crypto.randomUUID(),
        subscriptionId: subscription.id,
        userId: subscription.user_id,
      });

      continue;
    }

    const sentArticleLinks = await getSentArticleLinksForSubscription(
      supabase,
      subscription.id,
    );
    const rankedArticles = selectNewsletterArticlesForUser(
      recentArticles,
      getPersonalizationProfile(subscription, personalizationMaps),
      now,
      sentArticleLinks,
      subscription.article_mode,
    );

    if (rankedArticles.length === 0) {
      summary.skipped += 1;

      await insertEmailSendLog(supabase, {
        articleCount: 0,
        email: subscription.email,
        error: "all-articles-already-sent",
        sentAt: now.toISOString(),
        status: "skipped",
        sendLogId: crypto.randomUUID(),
        subscriptionId: subscription.id,
        userId: subscription.user_id,
      });

      continue;
    }

    summary.attempted += 1;

    const unsubscribeToken = await ensureUnsubscribeToken(
      supabase,
      subscription,
    );

    if (!unsubscribeToken) {
      summary.failed += 1;

      await insertEmailSendLog(supabase, {
        articleCount: recentArticles.length,
        email: subscription.email,
        error: "unsubscribe-token-generation-failed",
        sentAt: now.toISOString(),
        status: "failed",
        sendLogId: crypto.randomUUID(),
        subscriptionId: subscription.id,
        userId: subscription.user_id,
      });

      continue;
    }

    const unsubscribeUrl = buildNewsletterUnsubscribeUrl(unsubscribeToken);

    const trackingContext = {
      sendLogId: crypto.randomUUID(),
      subscriptionId: subscription.id,
      email: subscription.email,
    };

    const sendResult = await sendNewsletterEmail({
      email: subscription.email,
      debug: isDevelopment,
      html: buildNewsletterEmailHtml(
        rankedArticles,
        now,
        unsubscribeUrl,
        subscription.email_format === "compact" ? "compact" : "standard",
        trackingContext,
      ),
      idempotencyKey: crypto.randomUUID(),
      subject: buildNewsletterEmailSubject(rankedArticles.length),
      text: buildNewsletterEmailText(
        rankedArticles,
        unsubscribeUrl,
        subscription.email_format === "compact" ? "compact" : "standard",
      ),
    });

    if (sendResult.ok) {
      summary.sent += 1;

      const sendLogId = await insertEmailSendLog(supabase, {
        articleCount: rankedArticles.length,
        email: subscription.email,
        error: null,
        sentAt: now.toISOString(),
        status: "sent",
        sendLogId: trackingContext.sendLogId,
        subscriptionId: subscription.id,
        userId: subscription.user_id,
      });

      if (sendLogId) {
        await insertSentArticles(supabase, {
          articles: rankedArticles,
          email: subscription.email,
          sentAt: now.toISOString(),
          sendLogId,
          subscriptionId: subscription.id,
          userId: subscription.user_id,
        });
      }

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

    await insertEmailSendLog(supabase, {
      articleCount: rankedArticles.length,
      email: subscription.email,
      error: sendResult.errorMessage,
      sentAt: now.toISOString(),
      status: "failed",
      sendLogId: trackingContext.sendLogId,
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

type PersonalizationMaps = {
  alertKeywordsByUserId: Map<string, string[]>;
  clickedArticleLinksByEmail: Map<string, string[]>;
  clickedArticleLinksBySubscriptionId: Map<number, string[]>;
  clickedSourcesByEmail: Map<string, string[]>;
  clickedSourcesBySubscriptionId: Map<number, string[]>;
  preferredSourceByUserId: Map<string, string | null>;
};

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

async function getPersonalizationMaps(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  subscriptions: NewsletterSubscriptionRow[],
): Promise<PersonalizationMaps> {
  const userIds = Array.from(
    new Set(
      subscriptions
        .map((subscription) => subscription.user_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const subscriptionIds = Array.from(
    new Set(subscriptions.map((subscription) => subscription.id)),
  );
  const emails = Array.from(
    new Set(
      subscriptions
        .map((subscription) => subscription.email.trim().toLowerCase())
        .filter(Boolean),
    ),
  );

  const [preferencesResult, alertKeywordsResult, clicksBySubscriptionResult, clicksByEmailResult] =
    await Promise.all([
      userIds.length > 0
        ? supabase
            .from("user_preferences")
            .select("user_id, default_source_filter")
            .in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      userIds.length > 0
        ? supabase
            .from("user_alert_keywords")
            .select("user_id, keyword")
            .in("user_id", userIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      subscriptionIds.length > 0
        ? supabase
            .from("email_click_events")
            .select("subscription_id, article_link, article_source")
            .in("subscription_id", subscriptionIds)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
      emails.length > 0
        ? supabase
            .from("email_click_events")
            .select("email, article_link, article_source")
            .in("email", emails)
            .order("created_at", { ascending: false })
            .limit(500)
        : Promise.resolve({ data: [], error: null }),
    ]);

  if (preferencesResult.error) {
    console.error("[send-newsletter][personalization-preferences]", preferencesResult.error);
  }

  if (alertKeywordsResult.error) {
    console.error("[send-newsletter][personalization-alert-keywords]", alertKeywordsResult.error);
  }

  if (clicksBySubscriptionResult.error) {
    console.error("[send-newsletter][personalization-clicks-subscription]", clicksBySubscriptionResult.error);
  }

  if (clicksByEmailResult.error) {
    console.error("[send-newsletter][personalization-clicks-email]", clicksByEmailResult.error);
  }

  const preferredSourceByUserId = new Map<string, string | null>();
  for (const row of preferencesResult.data ?? []) {
    preferredSourceByUserId.set(
      row.user_id,
      normalizePreferredSource(row.default_source_filter),
    );
  }

  const alertKeywordsByUserId = new Map<string, string[]>();
  for (const row of alertKeywordsResult.data ?? []) {
    const normalizedKeyword = normalizeKeyword(row.keyword);
    if (!normalizedKeyword) {
      continue;
    }

    const existing = alertKeywordsByUserId.get(row.user_id) ?? [];
    existing.push(normalizedKeyword);
    alertKeywordsByUserId.set(row.user_id, existing);
  }

  const clickedArticleLinksBySubscriptionId = new Map<number, string[]>();
  const clickedSourcesBySubscriptionId = new Map<number, string[]>();
  for (const row of clicksBySubscriptionResult.data ?? []) {
    appendUnique(
      clickedArticleLinksBySubscriptionId,
      row.subscription_id,
      row.article_link,
    );
    appendUnique(
      clickedSourcesBySubscriptionId,
      row.subscription_id,
      normalizeSource(row.article_source),
    );
  }

  const clickedArticleLinksByEmail = new Map<string, string[]>();
  const clickedSourcesByEmail = new Map<string, string[]>();
  for (const row of clicksByEmailResult.data ?? []) {
    const normalizedEmail = row.email.trim().toLowerCase();
    appendUnique(clickedArticleLinksByEmail, normalizedEmail, row.article_link);
    appendUnique(
      clickedSourcesByEmail,
      normalizedEmail,
      normalizeSource(row.article_source),
    );
  }

  return {
    alertKeywordsByUserId,
    clickedArticleLinksByEmail,
    clickedArticleLinksBySubscriptionId,
    clickedSourcesByEmail,
    clickedSourcesBySubscriptionId,
    preferredSourceByUserId,
  };
}

function getPersonalizationProfile(
  subscription: NewsletterSubscriptionRow,
  maps: PersonalizationMaps,
): PersonalizationProfile {
  const normalizedEmail = subscription.email.trim().toLowerCase();
  const userId = subscription.user_id;

  // Ranking stays additive: we blend preferences, alerts, and click history,
  // then fall back to recency if the user has little or no personal history.
  return {
    alertKeywords: userId ? maps.alertKeywordsByUserId.get(userId) ?? [] : [],
    clickedArticleLinks:
      maps.clickedArticleLinksBySubscriptionId.get(subscription.id) ??
      maps.clickedArticleLinksByEmail.get(normalizedEmail) ??
      [],
    clickedSources:
      maps.clickedSourcesBySubscriptionId.get(subscription.id) ??
      maps.clickedSourcesByEmail.get(normalizedEmail) ??
      [],
    preferredSource: userId
      ? maps.preferredSourceByUserId.get(userId) ?? null
      : null,
  };
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

function appendUnique<TKey>(
  map: Map<TKey, string[]>,
  key: TKey,
  value: string | null,
) {
  if (!value) {
    return;
  }

  const existing = map.get(key) ?? [];

  if (!existing.includes(value)) {
    existing.push(value);
    map.set(key, existing);
  }
}

function normalizeKeyword(value: string | null) {
  return value?.trim().toLowerCase() ?? "";
}

function normalizePreferredSource(value: string | null) {
  if (!value || value === "All Sources") {
    return null;
  }

  return value.trim();
}

function normalizeSource(value: string | null) {
  return value?.trim().toLowerCase() ?? null;
}

async function insertEmailSendLog(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    articleCount,
    email,
    error,
    sentAt,
    status,
    sendLogId,
    subscriptionId,
    userId,
  }: {
    articleCount: number | null;
    email: string;
    error: string | null;
    sentAt: string;
    status: "failed" | "sent" | "skipped";
    sendLogId?: string;
    subscriptionId: number | null;
    userId: string | null;
  },
) {
  const { data, error: insertError } = await supabase
    .from("email_send_logs")
    .insert({
      id: sendLogId,
      article_count: articleCount,
      email,
      error,
      sent_at: sentAt,
      status,
      subscription_id: subscriptionId,
      user_id: userId,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("[send-newsletter][email-send-log]", insertError);
    return null;
  }

  if (data?.id) {
    return data.id;
  }

  const { data: fallbackRow, error: fallbackError } = await supabase
    .from("email_send_logs")
    .select("id")
    .eq("email", email)
    .eq("sent_at", sentAt)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fallbackError) {
    console.error("[send-newsletter][email-send-log-fallback]", fallbackError);
    return null;
  }

  return fallbackRow?.id ?? null;
}

async function getSentArticleLinksForSubscription(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  subscriptionId: number,
) {
  const { data, error } = await supabase
    .from("newsletter_sent_articles")
    .select("article_link")
    .eq("subscription_id", subscriptionId);

  if (error) {
    console.error("[send-newsletter][sent-articles]", error);
    return new Set<string>();
  }

  return new Set((data ?? []).map((row) => row.article_link));
}

async function insertSentArticles(
  supabase: ReturnType<typeof createSupabaseAdminClient>,
  {
    articles,
    email,
    sentAt,
    sendLogId,
    subscriptionId,
    userId,
  }: {
    articles: Array<{ link: string; title: string; source: string }>;
    email: string;
    sentAt: string;
    sendLogId: string;
    subscriptionId: number | null;
    userId: string | null;
  },
) {
  const payload = articles.map((article) => ({
    article_link: article.link,
    article_source: article.source,
    article_title: article.title,
    email,
    send_log_id: sendLogId,
    sent_at: sentAt,
    subscription_id: subscriptionId,
    user_id: userId,
  }));

  const { error } = await supabase
    .from("newsletter_sent_articles")
    .insert(payload);

  if (error) {
    console.error("[send-newsletter][sent-articles-insert]", error);
  }
}

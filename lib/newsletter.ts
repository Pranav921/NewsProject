import type { NewsItem } from "@/lib/types";

const NEWSLETTER_TIME_ZONE = "America/New_York";

export type NewsletterSubscriptionRow = {
  custom_frequency: string | null;
  email: string;
  email_format?: string | null;
  id: number;
  is_active: boolean;
  last_error: string | null;
  last_sent_at: string | null;
  last_status: string | null;
  frequency: string;
  unsubscribe_token: string | null;
  user_id: string | null;
};

type NewsletterPlan = {
  automaticFrequency: "custom" | "daily" | "hourly" | "weekly";
  requestedCustomFrequencyHours: number | null;
  requestedFrequency: string;
  tier: "free";
};

type NewsletterEligibilityResult = {
  automaticFrequency: "custom" | "daily" | "hourly" | "weekly";
  eligible: boolean;
  reason: "already-sent-recently" | "inactive" | "invalid-custom-frequency";
};

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const HOURLY_WINDOW_MS = 60 * 60 * 1000;
const WEEKLY_WINDOW_MS = 7 * DAILY_WINDOW_MS;

export function getUserNewsletterPlan(
  subscription: NewsletterSubscriptionRow,
): NewsletterPlan {
  const normalizedFrequency = normalizeFrequency(subscription.frequency);

  return {
    automaticFrequency: normalizedFrequency,
    requestedCustomFrequencyHours: parseCustomFrequencyHours(
      subscription.custom_frequency,
    ),
    requestedFrequency: normalizedFrequency,
    tier: "free",
  };
}

export function canUserReceiveAutomaticNewsletterNow(
  subscription: NewsletterSubscriptionRow,
  now: Date,
): NewsletterEligibilityResult {
  if (!subscription.is_active) {
    return {
      automaticFrequency: "daily",
      eligible: false,
      reason: "inactive",
    };
  }

  const plan = getUserNewsletterPlan(subscription);

  if (plan.automaticFrequency === "daily") {
    if (!subscription.last_sent_at) {
      return {
        automaticFrequency: plan.automaticFrequency,
        eligible: true,
        reason: "inactive",
      };
    }

    const lastSentTimestamp = Date.parse(subscription.last_sent_at);

    if (Number.isNaN(lastSentTimestamp)) {
      return {
        automaticFrequency: plan.automaticFrequency,
        eligible: true,
        reason: "inactive",
      };
    }

    const lastSentDate = new Date(lastSentTimestamp);

    return {
      automaticFrequency: plan.automaticFrequency,
      eligible: !isSameZonedDay(lastSentDate, now, NEWSLETTER_TIME_ZONE),
      reason: "already-sent-recently",
    };
  }

  const sendIntervalMs = getAutomaticSendIntervalMs(plan);

  if (sendIntervalMs === null) {
    return {
      automaticFrequency: plan.automaticFrequency,
      eligible: false,
      reason: "invalid-custom-frequency",
    };
  }

  if (!subscription.last_sent_at) {
    return {
      automaticFrequency: plan.automaticFrequency,
      eligible: true,
      reason: "inactive",
    };
  }

  const lastSentTimestamp = Date.parse(subscription.last_sent_at);

  if (Number.isNaN(lastSentTimestamp)) {
    return {
      automaticFrequency: plan.automaticFrequency,
      eligible: true,
      reason: "inactive",
    };
  }

  return {
    automaticFrequency: plan.automaticFrequency,
    eligible: now.getTime() - lastSentTimestamp >= sendIntervalMs,
    reason: "already-sent-recently",
  };
}

export function getRecentNewsletterArticles(
  articles: NewsItem[],
  now: Date,
): NewsItem[] {
  return articles.filter((article) => {
    if (!article.publishedAt) {
      return false;
    }

    const publishedTimestamp = Date.parse(article.publishedAt);

    if (Number.isNaN(publishedTimestamp)) {
      return false;
    }

    const articleAge = now.getTime() - publishedTimestamp;

    return articleAge >= 0 && articleAge <= DAILY_WINDOW_MS;
  });
}

export function buildNewsletterEmailSubject(articleCount: number): string {
  return articleCount === 1
    ? "Kicker News: 1 story from the last 24 hours"
    : `Kicker News: ${articleCount} stories from the last 24 hours`;
}

export function buildNewsletterEmailHtml(
  articles: NewsItem[],
  now: Date,
  unsubscribeUrl: string,
  emailFormat: "standard" | "compact" = "standard",
): string {
  if (emailFormat === "compact") {
    return buildCompactNewsletterEmailHtml(articles, now, unsubscribeUrl);
  }

  const articleMarkup = articles
    .map((article) => {
      const publishedLabel = formatPublishedTime(article.publishedAt);
      const summary = article.summary
        ? `<p style="margin:12px 0 0;color:#475569;font-size:14px;line-height:1.7;">${escapeHtml(article.summary)}</p>`
        : "";
      const publishedMarkup = publishedLabel
        ? `<p style="margin:8px 0 0;color:#64748b;font-size:13px;">Published ${escapeHtml(publishedLabel)}</p>`
        : "";

      return `
        <article style="padding:24px 0;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#0369a1;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(article.source)}</p>
          <h2 style="margin:10px 0 0;font-size:22px;line-height:1.3;color:#0f172a;">${escapeHtml(article.title)}</h2>
          ${publishedMarkup}
          ${summary}
          <p style="margin:16px 0 0;">
            <a href="${escapeAttribute(article.link)}" style="display:inline-block;border-radius:9999px;background:#0f172a;color:#ffffff;padding:10px 18px;font-size:14px;font-weight:600;text-decoration:none;">Read more</a>
          </p>
        </article>
      `;
    })
    .join("");

  return `
    <div style="margin:0;padding:32px 16px;background:#f8fafc;font-family:Arial,sans-serif;">
      <div style="margin:0 auto;max-width:720px;background:#ffffff;border:1px solid #e2e8f0;border-radius:24px;padding:32px;box-shadow:0 10px 30px rgba(15,23,42,0.08);">
        <p style="margin:0;color:#0369a1;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Kicker News</p>
        <p style="margin:14px 0 0;">
          <a href="${escapeAttribute(unsubscribeUrl)}" style="display:inline-block;border-radius:9999px;border:1px solid #cbd5e1;color:#475569;padding:8px 14px;font-size:13px;font-weight:600;text-decoration:none;">Unsubscribe</a>
        </p>
        <h1 style="margin:14px 0 0;color:#0f172a;font-size:34px;line-height:1.1;">Latest headlines from the last 24 hours</h1>
        <p style="margin:14px 0 0;color:#475569;font-size:15px;line-height:1.7;">
          Your daily roundup for ${escapeHtml(
            now.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: NEWSLETTER_TIME_ZONE,
            }),
          )}.
        </p>
        <section style="margin-top:28px;">
          ${articleMarkup}
        </section>
        <p style="margin:28px 0 0;color:#64748b;font-size:13px;line-height:1.7;">
          You are receiving this email because you subscribed to Kicker News updates.
          <a href="${escapeAttribute(unsubscribeUrl)}" style="color:#0369a1;">Unsubscribe instantly</a>.
        </p>
      </div>
    </div>
  `;
}

export function buildNewsletterEmailText(
  articles: NewsItem[],
  unsubscribeUrl: string,
  emailFormat: "standard" | "compact" = "standard",
): string {
  if (emailFormat === "compact") {
    return buildCompactNewsletterEmailText(articles, unsubscribeUrl);
  }

  return [
    "Kicker News",
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
    "",
    "Latest headlines from the last 24 hours",
    "",
    ...articles.flatMap((article) => {
      const publishedLabel = formatPublishedTime(article.publishedAt);

      return [
        `${article.title}`,
        `Source: ${article.source}`,
        publishedLabel ? `Published: ${publishedLabel}` : null,
        article.summary ?? null,
        `Read more: ${article.link}`,
        "",
      ].filter((line): line is string => Boolean(line));
    }),
    "Unsubscribe:",
    unsubscribeUrl,
  ].join("\n");
}

function buildCompactNewsletterEmailHtml(
  articles: NewsItem[],
  now: Date,
  unsubscribeUrl: string,
): string {
  const articleMarkup = articles
    .map((article) => {
      return `
        <article style="padding:16px 0;border-top:1px solid #e2e8f0;">
          <p style="margin:0;color:#0369a1;font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(article.source)}</p>
          <p style="margin:8px 0 0;font-size:16px;line-height:1.4;color:#0f172a;font-weight:600;">
            <a href="${escapeAttribute(article.link)}" style="color:#0f172a;text-decoration:none;">${escapeHtml(article.title)}</a>
          </p>
        </article>
      `;
    })
    .join("");

  return `
    <div style="margin:0;padding:24px 12px;background:#f8fafc;font-family:Arial,sans-serif;">
      <div style="margin:0 auto;max-width:640px;background:#ffffff;border:1px solid #e2e8f0;border-radius:20px;padding:24px;box-shadow:0 10px 26px rgba(15,23,42,0.08);">
        <div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;">
          <p style="margin:0;color:#0369a1;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Kicker News</p>
          <a href="${escapeAttribute(unsubscribeUrl)}" style="display:inline-block;border-radius:9999px;border:1px solid #cbd5e1;color:#475569;padding:6px 12px;font-size:12px;font-weight:600;text-decoration:none;">Unsubscribe</a>
        </div>
        <h1 style="margin:14px 0 0;color:#0f172a;font-size:24px;line-height:1.2;">Latest headlines</h1>
        <p style="margin:8px 0 0;color:#64748b;font-size:13px;line-height:1.6;">
          ${escapeHtml(
            now.toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: NEWSLETTER_TIME_ZONE,
            }),
          )} - Compact view
        </p>
        <section style="margin-top:18px;">
          ${articleMarkup}
        </section>
        <p style="margin:18px 0 0;color:#64748b;font-size:12px;line-height:1.6;">
          You are receiving this email because you subscribed to Kicker News updates.
          <a href="${escapeAttribute(unsubscribeUrl)}" style="color:#0369a1;">Unsubscribe instantly</a>.
        </p>
      </div>
    </div>
  `;
}

function buildCompactNewsletterEmailText(
  articles: NewsItem[],
  unsubscribeUrl: string,
): string {
  return [
    "Kicker News",
    "",
    `Unsubscribe: ${unsubscribeUrl}`,
    "",
    "Latest headlines (compact)",
    "",
    ...articles.flatMap((article) => [
      `${article.title} (${article.source})`,
      article.link,
      "",
    ]),
    "Unsubscribe:",
    unsubscribeUrl,
  ].join("\n");
}

export function buildNewsletterUnsubscribeUrl(token: string): string {
  const baseUrl = getAppBaseUrl();

  return `${baseUrl}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

function parseCustomFrequencyHours(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) {
    return null;
  }

  return Number.parseInt(value, 10);
}

function getAutomaticSendIntervalMs(plan: NewsletterPlan): number | null {
  switch (plan.automaticFrequency) {
    case "hourly":
      return HOURLY_WINDOW_MS;
    case "daily":
      return DAILY_WINDOW_MS;
    case "weekly":
      return WEEKLY_WINDOW_MS;
    case "custom":
      return plan.requestedCustomFrequencyHours
        ? plan.requestedCustomFrequencyHours * HOURLY_WINDOW_MS
        : null;
    default:
      return DAILY_WINDOW_MS;
  }
}

function normalizeFrequency(
  value: string,
): NewsletterPlan["automaticFrequency"] {
  switch (value) {
    case "hourly":
    case "weekly":
    case "custom":
      return value;
    case "daily":
    default:
      return "daily";
  }
}

function isSameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return formatter.format(a) === formatter.format(b);
}

function formatPublishedTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: NEWSLETTER_TIME_ZONE,
  }).format(new Date(timestamp));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function getAppBaseUrl(): string {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "development") {
    return "http://localhost:3000";
  }

  throw new Error("Missing APP_BASE_URL environment variable.");
}

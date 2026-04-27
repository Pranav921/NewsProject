import type {
  NewsletterArticleMode,
  NewsletterEmailFormat,
  NewsletterFrequency,
} from "./types.ts";

export type NewsletterSubscriptionRequest = {
  articleMode?: string;
  customFrequency?: string;
  email?: string;
  emailFormat?: string;
  frequency?: string;
  preferredFrequency?: string;
};

export type ValidatedNewsletterSettings =
  | {
      errorMessage: string;
      status: number;
    }
  | {
      articleMode: NewsletterArticleMode;
      customFrequency: string | null;
      emailFormat: NewsletterEmailFormat;
      frequency: NewsletterFrequency;
      status: 200;
    };

const VALID_FREQUENCIES = new Set<NewsletterFrequency>([
  "hourly",
  "daily",
  "weekly",
  "custom",
]);
const VALID_EMAIL_FORMATS = new Set<NewsletterEmailFormat>([
  "compact",
  "standard",
]);
const VALID_ARTICLE_MODES = new Set<NewsletterArticleMode>([
  "all_missed",
  "personalized",
]);

export function getValidatedNewsletterSettings(
  body: NewsletterSubscriptionRequest,
): ValidatedNewsletterSettings {
  const frequency =
    body.frequency?.trim().toLowerCase() ??
    body.preferredFrequency?.trim().toLowerCase() ??
    "";
  const normalizedCustomFrequency = body.customFrequency?.trim() ?? "";
  const emailFormat = body.emailFormat?.trim().toLowerCase() ?? "standard";
  const articleMode = body.articleMode?.trim().toLowerCase() ?? "all_missed";

  if (!VALID_EMAIL_FORMATS.has(emailFormat as NewsletterEmailFormat)) {
    return {
      errorMessage: "Email format must be standard or compact.",
      status: 400,
    };
  }

  if (!VALID_ARTICLE_MODES.has(articleMode as NewsletterArticleMode)) {
    return {
      errorMessage: "Article mode must be personalized or all_missed.",
      status: 400,
    };
  }

  if (!VALID_FREQUENCIES.has(frequency as NewsletterFrequency)) {
    return {
      errorMessage: "Choose a valid newsletter frequency.",
      status: 400,
    };
  }

  if (frequency !== "custom") {
    return {
      articleMode: articleMode as NewsletterArticleMode,
      customFrequency: null,
      emailFormat: emailFormat as NewsletterEmailFormat,
      frequency: frequency as NewsletterFrequency,
      status: 200,
    };
  }

  if (!/^[1-9]\d*$/.test(normalizedCustomFrequency)) {
    return {
      errorMessage: "Enter a whole number of hours greater than 0.",
      status: 400,
    };
  }

  return {
    articleMode: articleMode as NewsletterArticleMode,
    customFrequency: normalizedCustomFrequency,
    emailFormat: emailFormat as NewsletterEmailFormat,
    frequency: frequency as NewsletterFrequency,
    status: 200,
  };
}

import type {
  NewsletterArticleMode,
  NewsletterEmailFormat,
  NewsletterFrequency,
  NewsletterSortOrder,
} from "./types.ts";

export type NewsletterSubscriptionRequest = {
  articleMode?: string;
  sortOrder?: string;
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
      sortOrder: NewsletterSortOrder;
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
  const sortOrder = body.sortOrder ?? "default";
  if (sortOrder !== "default" && sortOrder !== "category") {
    return { errorMessage: "Newsletter order must be default or category.", status: 400 };
  }
  const frequency =
    body.frequency?.trim().toLowerCase() ??
    body.preferredFrequency?.trim().toLowerCase() ??
    "";
  const normalizedCustomFrequency = body.customFrequency?.trim() ?? "";
  const rawEmailFormat = body.emailFormat?.trim().toLowerCase() ?? "standard";
  const emailFormat =
    rawEmailFormat === "grid"
      ? "standard"
      : rawEmailFormat === "list"
        ? "compact"
        : rawEmailFormat;
  const articleMode = body.articleMode?.trim().toLowerCase() ?? "all_missed";

  if (!VALID_EMAIL_FORMATS.has(emailFormat as NewsletterEmailFormat)) {
    return {
      errorMessage: "Email format must be grid or list.",
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
      sortOrder,
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
    sortOrder,
    customFrequency: normalizedCustomFrequency,
    emailFormat: emailFormat as NewsletterEmailFormat,
    frequency: frequency as NewsletterFrequency,
    status: 200,
  };
}

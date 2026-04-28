"use client";

import {
  addAlertKeyword,
  removeAlertKeyword,
} from "@/lib/custom-alerts";
import { PERSONALIZATION_MIN_UNIQUE_CLICKS } from "@/lib/personalization";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type {
  EmailSendLog,
  NewsletterArticleMode,
  NewsletterEmailFormat,
  NewsletterFrequency,
  UserPreferences,
} from "@/lib/types";
import type { FormEvent } from "react";
import { useState } from "react";

type AccountSettingsProps = {
  email: string;
  initialAlertKeywords: string[];
  initialNewsletterClickedArticleCount: number;
  initialEmailSendLogs: EmailSendLog[];
  initialNewsletterArticleMode: NewsletterArticleMode | null;
  initialNewsletterCustomFrequency: string | null;
  initialNewsletterEmailFormat: NewsletterEmailFormat | null;
  initialNewsletterFrequency: NewsletterFrequency | null;
  initialNewsletterPersonalizationReady: boolean;
  initialPreferences: UserPreferences;
  userId: string;
};

type ViewMode = "standard" | "compact";
type TimeFilter = "all" | "1h" | "3h" | "6h" | "12h" | "24h" | "1w";

const TIME_FILTER_OPTIONS: Array<{ label: string; value: TimeFilter }> = [
  { label: "All Time", value: "all" },
  { label: "Last Hour", value: "1h" },
  { label: "Last 3 Hours", value: "3h" },
  { label: "Last 6 Hours", value: "6h" },
  { label: "Last 12 Hours", value: "12h" },
  { label: "Last 24 Hours", value: "24h" },
  { label: "Last Week", value: "1w" },
];

const NEWSLETTER_FREQUENCY_OPTIONS: Array<{
  label: string;
  value: NewsletterFrequency;
}> = [
  { label: "Hourly", value: "hourly" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Custom", value: "custom" },
];

const NEWSLETTER_EMAIL_FORMAT_OPTIONS: Array<{
  label: string;
  value: NewsletterEmailFormat;
}> = [
  { label: "Standard email", value: "standard" },
  { label: "Compact email", value: "compact" },
];

const NEWSLETTER_ARTICLE_MODE_OPTIONS: Array<{
  description: string;
  label: string;
  value: NewsletterArticleMode;
}> = [
  {
    description:
      "Recommended. Send every recent article you have not received yet, while still avoiding duplicate sends.",
    label: "All missed articles",
    value: "all_missed",
  },
  {
    description:
      "Rank and send up to the newsletter article limit using your preferences, alerts, and newsletter click history.",
    label: "Personalized digest",
    value: "personalized",
  },
];

export function AccountSettings({
  email,
  initialAlertKeywords,
  initialNewsletterClickedArticleCount,
  initialEmailSendLogs,
  initialNewsletterArticleMode,
  initialNewsletterCustomFrequency,
  initialNewsletterEmailFormat,
  initialNewsletterFrequency,
  initialNewsletterPersonalizationReady,
  initialPreferences,
  userId,
}: AccountSettingsProps) {
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [defaultSourceFilter, setDefaultSourceFilter] = useState(
    initialPreferences.defaultSourceFilter,
  );
  const [defaultTimeFilter, setDefaultTimeFilter] = useState<TimeFilter>(
    initialPreferences.defaultTimeFilter as TimeFilter,
  );
  const [defaultViewMode, setDefaultViewMode] = useState<ViewMode>(
    initialPreferences.defaultViewMode,
  );
  const [alertKeywords, setAlertKeywords] = useState(initialAlertKeywords);
  const [alertKeywordInput, setAlertKeywordInput] = useState("");
  const [newsletterEnabled, setNewsletterEnabled] = useState(
    initialNewsletterFrequency !== null,
  );
  const [newsletterFrequency, setNewsletterFrequency] =
    useState<NewsletterFrequency>(
      initialNewsletterFrequency ?? "daily",
    );
  const [newsletterEmailFormat, setNewsletterEmailFormat] =
    useState<NewsletterEmailFormat>(
      initialNewsletterEmailFormat ?? "standard",
    );
  const [newsletterArticleMode, setNewsletterArticleMode] =
    useState<NewsletterArticleMode>(
      initialNewsletterArticleMode ?? "all_missed",
    );
  const [newsletterCustomFrequency, setNewsletterCustomFrequency] = useState(
    initialNewsletterCustomFrequency ?? "",
  );
  const [preferencesMessage, setPreferencesMessage] = useState<string | null>(null);
  const [alertsMessage, setAlertsMessage] = useState<string | null>(null);
  const [newsletterMessage, setNewsletterMessage] = useState<string | null>(null);
  const [isSavingPreferences, setIsSavingPreferences] = useState(false);
  const [isSavingAlert, setIsSavingAlert] = useState(false);
  const [isSavingNewsletter, setIsSavingNewsletter] = useState(false);
  const personalizationProgressLabel = `${Math.min(
    initialNewsletterClickedArticleCount,
    PERSONALIZATION_MIN_UNIQUE_CLICKS,
  )}/${PERSONALIZATION_MIN_UNIQUE_CLICKS}`;
  const personalizedSelectedButNotReady =
    newsletterArticleMode === "personalized" &&
    !initialNewsletterPersonalizationReady;

  async function handleSavePreferences() {
    setIsSavingPreferences(true);
    setPreferencesMessage(null);

    const { error } = await supabase.from("user_preferences").upsert({
      user_id: userId,
      default_source_filter: defaultSourceFilter,
      default_time_filter: defaultTimeFilter,
      default_view_mode: defaultViewMode,
    });

    setPreferencesMessage(
      error ? "Unable to save preferences right now." : "Preferences saved.",
    );
    setIsSavingPreferences(false);
  }

  async function handleAddAlertKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextAlertKeywords = addAlertKeyword(alertKeywords, alertKeywordInput);

    if (nextAlertKeywords === alertKeywords || isSavingAlert) {
      setAlertKeywordInput("");
      return;
    }

    const keywordToSave = nextAlertKeywords[nextAlertKeywords.length - 1];
    const previousAlertKeywords = alertKeywords;

    setIsSavingAlert(true);
    setAlertsMessage(null);
    setAlertKeywords(nextAlertKeywords);
    setAlertKeywordInput("");

    const { error } = await supabase.from("user_alert_keywords").upsert(
      {
        user_id: userId,
        keyword: keywordToSave,
      },
      {
        onConflict: "user_id,keyword",
      },
    );

    if (error) {
      setAlertKeywords(previousAlertKeywords);
      setAlertsMessage("Unable to save alert keyword right now.");
    } else {
      setAlertsMessage("Alert keyword saved.");
    }

    setIsSavingAlert(false);
  }

  async function handleRemoveAlertKeyword(keywordToRemove: string) {
    if (isSavingAlert) {
      return;
    }

    const previousAlertKeywords = alertKeywords;

    setIsSavingAlert(true);
    setAlertsMessage(null);
    setAlertKeywords((currentKeywords) =>
      removeAlertKeyword(currentKeywords, keywordToRemove),
    );

    const { error } = await supabase
      .from("user_alert_keywords")
      .delete()
      .eq("user_id", userId)
      .eq("keyword", keywordToRemove);

    if (error) {
      setAlertKeywords(previousAlertKeywords);
      setAlertsMessage("Unable to remove alert keyword right now.");
    } else {
      setAlertsMessage("Alert keyword removed.");
    }

    setIsSavingAlert(false);
  }

  async function handleSaveNewsletter() {
    if (
      newsletterEnabled &&
      newsletterFrequency === "custom" &&
      !/^[1-9]\d*$/.test(newsletterCustomFrequency.trim())
    ) {
      setNewsletterMessage("Enter a whole number of hours greater than 0.");
      return;
    }

    setIsSavingNewsletter(true);
    setNewsletterMessage(null);

    try {
      const response = await fetch("/api/newsletter-subscriptions", {
        method: newsletterEnabled ? "PUT" : "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: newsletterEnabled
          ? JSON.stringify({
              articleMode: newsletterArticleMode,
              customFrequency:
                newsletterFrequency === "custom"
                  ? newsletterCustomFrequency.trim()
                  : null,
              emailFormat: newsletterEmailFormat,
              preferredFrequency: newsletterFrequency,
            })
          : undefined,
      });

      const result = (await response.json()) as { message?: string };

      if (!response.ok) {
        setNewsletterMessage(
          result.message ?? "Unable to update newsletter settings right now.",
        );
      } else {
        setNewsletterMessage(
          result.message ??
            (newsletterEnabled
              ? "Newsletter settings saved."
              : "Newsletter subscription removed."),
        );
      }
    } catch {
      setNewsletterMessage("Unable to update newsletter settings right now.");
    } finally {
      setIsSavingNewsletter(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[1.55rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-6">
        <h1 className="text-[1.8rem] font-semibold tracking-tight text-slate-900">
          Account settings
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Manage your preferences, alert keywords, and newsletter subscription.
        </p>

        <div className="mt-5 rounded-[1.1rem] border border-slate-200 bg-slate-50 p-3.5">
          <p className="text-sm font-medium text-slate-700">Signed in as</p>
          <p className="mt-1 break-all text-sm text-slate-600">{email}</p>
        </div>
      </section>

      <section className="rounded-[1.55rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-6">
        <h2 className="text-[1.45rem] font-semibold tracking-tight text-slate-900">
          Saved preferences
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Choose the defaults to apply when you open the app.
        </p>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="default-source-filter"
            >
              Default source filter
            </label>
            <input
              id="default-source-filter"
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              type="text"
              value={defaultSourceFilter}
              onChange={(event) => setDefaultSourceFilter(event.target.value)}
            />
          </div>

          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="default-time-filter"
            >
              Default time filter
            </label>
            <select
              id="default-time-filter"
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              value={defaultTimeFilter}
              onChange={(event) =>
                setDefaultTimeFilter(event.target.value as TimeFilter)
              }
            >
              {TIME_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="default-view-mode"
            >
              Default view mode
            </label>
            <select
              id="default-view-mode"
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              value={defaultViewMode}
              onChange={(event) =>
                setDefaultViewMode(event.target.value as ViewMode)
              }
            >
              <option value="standard">Standard</option>
              <option value="compact">Compact</option>
            </select>
          </div>
        </div>

        <button
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          type="button"
          onClick={handleSavePreferences}
          disabled={isSavingPreferences}
        >
          {isSavingPreferences ? "Saving..." : "Save preferences"}
        </button>

        {preferencesMessage ? (
          <p className="mt-3 text-sm text-slate-600">{preferencesMessage}</p>
        ) : null}
      </section>

      <section className="rounded-[1.55rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-6">
        <h2 className="text-[1.45rem] font-semibold tracking-tight text-slate-900">
          Saved alerts
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Manage the keywords used by your custom alerts and smart alerts.
        </p>

        <form className="mt-5 flex flex-col gap-2.5 sm:flex-row" onSubmit={handleAddAlertKeyword}>
          <input
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
            type="text"
            placeholder="Add alert keyword"
            value={alertKeywordInput}
            onChange={(event) => setAlertKeywordInput(event.target.value)}
          />
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            type="submit"
            disabled={isSavingAlert}
          >
            {isSavingAlert ? "Saving..." : "Add keyword"}
          </button>
        </form>

        {alertKeywords.length > 0 ? (
          <div className="mt-4 flex flex-wrap gap-2">
            {alertKeywords.map((keyword) => (
              <span
                key={keyword}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm text-sky-700"
              >
                {keyword}
                <button
                  className="font-medium text-slate-600 transition-colors hover:text-slate-900"
                  type="button"
                  onClick={() => handleRemoveAlertKeyword(keyword)}
                  disabled={isSavingAlert}
                >
                  Remove
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-500">
            No alert keywords saved yet.
          </p>
        )}

        {alertsMessage ? (
          <p className="mt-3 text-sm text-slate-600">{alertsMessage}</p>
        ) : null}
      </section>

      <section className="rounded-[1.55rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-6">
        <h2 className="text-[1.45rem] font-semibold tracking-tight text-slate-900">
          Newsletter
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Update your preferred newsletter frequency or unsubscribe at any time.
        </p>

        <label className="mt-5 flex items-center gap-3 text-sm font-medium text-slate-700">
          <input
            className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-sky-400"
            type="checkbox"
            checked={newsletterEnabled}
            onChange={(event) => setNewsletterEnabled(event.target.checked)}
          />
          Receive newsletter emails
        </label>

        <div className="mt-4 max-w-sm">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="newsletter-frequency"
          >
            Preferred frequency
          </label>
          <select
            id="newsletter-frequency"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            value={newsletterFrequency}
            onChange={(event) =>
              setNewsletterFrequency(event.target.value as NewsletterFrequency)
            }
            disabled={!newsletterEnabled}
          >
            {NEWSLETTER_FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 max-w-sm">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="newsletter-email-format"
          >
            Email format
          </label>
          <select
            id="newsletter-email-format"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            value={newsletterEmailFormat}
            onChange={(event) =>
              setNewsletterEmailFormat(
                event.target.value as NewsletterEmailFormat,
              )
            }
            disabled={!newsletterEnabled}
          >
            {NEWSLETTER_EMAIL_FORMAT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 max-w-2xl">
          <label
            className="text-sm font-medium text-slate-700"
            htmlFor="newsletter-article-mode"
          >
            Newsletter Article Mode
          </label>
          <select
            id="newsletter-article-mode"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
            value={newsletterArticleMode}
            onChange={(event) =>
              setNewsletterArticleMode(
                event.target.value as NewsletterArticleMode,
              )
            }
            disabled={!newsletterEnabled}
          >
            {NEWSLETTER_ARTICLE_MODE_OPTIONS.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={
                  option.value === "personalized" &&
                  !initialNewsletterPersonalizationReady
                }
              >
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-sm leading-6 text-slate-500">
            {NEWSLETTER_ARTICLE_MODE_OPTIONS.find(
              (option) => option.value === newsletterArticleMode,
            )?.description ?? ""}
          </p>
          <p className="mt-1.5 text-sm leading-6 text-slate-500">
            Personalized digest unlocks after you click at least{" "}
            {PERSONALIZATION_MIN_UNIQUE_CLICKS} newsletter articles so
            recommendations are based on real interests.
          </p>
          <p className="mt-1.5 text-sm font-medium text-slate-700">
            Personalization progress: {personalizationProgressLabel} article
            click{initialNewsletterClickedArticleCount === 1 ? "" : "s"}
          </p>
          {personalizedSelectedButNotReady ? (
            <p className="mt-1.5 text-sm text-amber-700">
              Personalized digest is saved on your account, but newsletters
              will use all missed articles until you reach{" "}
              {PERSONALIZATION_MIN_UNIQUE_CLICKS} unique newsletter article
              clicks.
            </p>
          ) : null}
        </div>

        {newsletterEnabled && newsletterFrequency === "custom" ? (
          <div className="mt-4 max-w-sm">
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="newsletter-custom-frequency"
            >
              Custom frequency in hours
            </label>
            <input
              id="newsletter-custom-frequency"
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Enter hours"
              value={newsletterCustomFrequency}
              onChange={(event) =>
                setNewsletterCustomFrequency(event.target.value)
              }
            />
          </div>
        ) : null}

        <button
          className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
          type="button"
          onClick={handleSaveNewsletter}
          disabled={isSavingNewsletter}
        >
          {isSavingNewsletter ? "Saving..." : "Save newsletter settings"}
        </button>

        {newsletterMessage ? (
          <p className="mt-3 text-sm text-slate-600">{newsletterMessage}</p>
        ) : null}
      </section>

      <section className="rounded-[1.55rem] border border-slate-200 bg-white p-5 shadow-[0_14px_34px_rgba(15,23,42,0.05)] sm:p-6">
        <h2 className="text-[1.45rem] font-semibold tracking-tight text-slate-900">
          Email send history
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Review your recent newsletter delivery activity.
        </p>

        {initialEmailSendLogs.length > 0 ? (
          <div className="mt-5 space-y-2.5">
            {initialEmailSendLogs.map((log) => (
              <div
                key={`${log.sentAt}-${log.status}-${log.articleCount ?? "na"}`}
                className="rounded-[1.1rem] border border-slate-200 bg-slate-50 p-3.5"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {formatSentAt(log.sentAt)}
                    </p>
                    <p className="mt-1 text-sm text-slate-600">
                      {log.articleCount !== null
                        ? `${log.articleCount} article${
                            log.articleCount === 1 ? "" : "s"
                          }`
                        : "Article count unavailable"}
                    </p>
                  </div>

                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
                      log.status === "sent"
                        ? "bg-emerald-100 text-emerald-700"
                        : log.status === "failed"
                          ? "bg-rose-100 text-rose-700"
                          : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {log.status}
                  </span>
                </div>

                {log.error ? (
                  <p className="mt-3 text-sm text-rose-700">{log.error}</p>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-slate-500">
            No newsletter send history yet.
          </p>
        )}
      </section>
    </div>
  );
}

function formatSentAt(value: string): string {
  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return "Unknown send time";
  }

  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

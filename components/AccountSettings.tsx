"use client";

import {
  addAlertKeyword,
  removeAlertKeyword,
} from "@/lib/custom-alerts";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { EmailSendLog, UserPreferences } from "@/lib/types";
import type { FormEvent } from "react";
import { useState } from "react";

type AccountSettingsProps = {
  email: string;
  initialAlertKeywords: string[];
  initialEmailSendLogs: EmailSendLog[];
  initialNewsletterCustomFrequency: string | null;
  initialNewsletterFrequency: string | null;
  initialPreferences: UserPreferences;
  userId: string;
};

type ViewMode = "standard" | "compact";
type TimeFilter = "all" | "1h" | "3h" | "6h" | "12h" | "24h" | "1w";
type NewsletterFrequency = "hourly" | "daily" | "weekly" | "custom";

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

export function AccountSettings({
  email,
  initialAlertKeywords,
  initialEmailSendLogs,
  initialNewsletterCustomFrequency,
  initialNewsletterFrequency,
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
      (initialNewsletterFrequency as NewsletterFrequency | null) ?? "daily",
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
              customFrequency:
                newsletterFrequency === "custom"
                  ? newsletterCustomFrequency.trim()
                  : null,
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
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
          Account settings
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Manage your preferences, alert keywords, and newsletter subscription.
        </p>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-medium text-slate-700">Signed in as</p>
          <p className="mt-1 break-all text-sm text-slate-600">{email}</p>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Saved preferences
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Choose the defaults to apply when you open the app.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div>
            <label
              className="text-sm font-medium text-slate-700"
              htmlFor="default-source-filter"
            >
              Default source filter
            </label>
            <input
              id="default-source-filter"
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
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
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
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
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
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
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
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

      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Saved alerts
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Manage the keywords used by your custom alerts and smart alerts.
        </p>

        <form className="mt-6 flex flex-col gap-3 sm:flex-row" onSubmit={handleAddAlertKeyword}>
          <input
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
            type="text"
            placeholder="Add alert keyword"
            value={alertKeywordInput}
            onChange={(event) => setAlertKeywordInput(event.target.value)}
          />
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
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
                className="inline-flex items-center gap-2 rounded-full border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {keyword}
                <button
                  className="font-medium text-rose-700 transition-colors hover:text-rose-900"
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

      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Newsletter
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Update your preferred newsletter frequency or unsubscribe at any time.
        </p>

        <label className="mt-6 flex items-center gap-3 text-sm font-medium text-slate-700">
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
            className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
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
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
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

      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Email send history
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Review your recent newsletter delivery activity.
        </p>

        {initialEmailSendLogs.length > 0 ? (
          <div className="mt-6 space-y-3">
            {initialEmailSendLogs.map((log) => (
              <div
                key={`${log.sentAt}-${log.status}-${log.articleCount ?? "na"}`}
                className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
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

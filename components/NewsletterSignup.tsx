"use client";

import { trackEvent } from "@/lib/analytics";
import { useState } from "react";

type NewsletterSubscriptionStatus = "active" | "inactive" | "none";

type NewsletterSignupProps = {
  browseHeadlinesHref?: string;
  initialEmail?: string | null;
  initialFrequency?: FrequencyOption;
  initialCustomFrequency?: string | null;
  initialSubscriptionStatus?: NewsletterSubscriptionStatus;
  title?: string;
  description?: string;
};

type FrequencyOption = "hourly" | "daily" | "weekly" | "custom";

const FREQUENCY_OPTIONS: Array<{ label: string; value: FrequencyOption }> = [
  { label: "Hourly", value: "hourly" },
  { label: "Daily", value: "daily" },
  { label: "Weekly", value: "weekly" },
  { label: "Custom", value: "custom" },
];

export function NewsletterSignup({
  browseHeadlinesHref,
  initialEmail = null,
  initialFrequency = "daily",
  initialCustomFrequency = null,
  initialSubscriptionStatus = "none",
  title = "Newsletter sign-up",
  description = "Get ready for future email updates by saving your preferred delivery frequency.",
}: NewsletterSignupProps) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [preferredFrequency, setPreferredFrequency] =
    useState<FrequencyOption>(initialFrequency);
  const [customFrequency, setCustomFrequency] = useState(initialCustomFrequency ?? "");
  const [subscriptionStatus, setSubscriptionStatus] =
    useState<NewsletterSubscriptionStatus>(initialSubscriptionStatus);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<
    "error" | "info" | "success" | null
  >(null);

  async function saveSubscription(method: "DELETE" | "POST") {
    setIsSubmitting(true);
    setMessage(null);
    setMessageTone(null);

    try {
      const response = await fetch("/api/newsletter-subscriptions", {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body:
          method === "POST"
            ? JSON.stringify({
                customFrequency:
                  preferredFrequency === "custom"
                    ? customFrequency.trim()
                    : null,
                email: email.trim(),
                preferredFrequency,
              })
            : undefined,
      });

      const result = (await response.json()) as { message?: string };

      if (!response.ok) {
        setMessage(result.message ?? "Something went wrong. Please try again.");
        setMessageTone("error");
      } else if (method === "DELETE") {
        setSubscriptionStatus("inactive");
        setMessage(
          result.message ?? "You have been unsubscribed from newsletter emails.",
        );
        setMessageTone("success");
      } else {
        trackEvent("newsletter_signup_success", {
          frequency: preferredFrequency,
          location: title,
        });
        setSubscriptionStatus("active");
        setMessage(result.message ?? "You have been added to the newsletter list.");
        setMessageTone("success");
      }
    } catch {
      setMessage("Something went wrong. Please try again.");
      setMessageTone("error");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!email.trim()) {
      setMessage("Enter an email address.");
      setMessageTone("error");
      return;
    }

    if (
      preferredFrequency === "custom" &&
      !/^[1-9]\d*$/.test(customFrequency.trim())
    ) {
      setMessage("Enter a whole number of hours greater than 0.");
      setMessageTone("error");
      return;
    }

    setIsSubmitting(true);
    setMessage(null);
    setMessageTone(null);
    trackEvent("newsletter_signup_submit", {
      frequency: preferredFrequency,
      location: title,
    });
    await saveSubscription("POST");
  }

  return (
    <div className="rounded-[1.4rem] border border-slate-200 bg-white p-4.5 shadow-[0_14px_32px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
            Newsletter
          </p>
          <h2 className="mt-1 text-[1.2rem] font-semibold tracking-tight text-slate-900">
            {title}
          </h2>
        </div>
        <span className="inline-flex w-fit rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
          Tailor delivery
        </span>
      </div>
      <p className="mt-2 text-sm leading-5 text-slate-500">{description}</p>

      {subscriptionStatus === "active" ? (
        <div className="mt-3.5 rounded-[1.15rem] border border-emerald-200 bg-emerald-50/70 p-4">
          <h3 className="text-base font-semibold text-slate-900">
            You are subscribed to the Kicker News newsletter.
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">
            You&apos;ll receive updates based on your saved newsletter preferences.
          </p>
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              href="/account#newsletter"
            >
              Change newsletter settings
            </a>
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-rose-200 bg-white px-4.5 py-2.5 text-sm font-medium text-rose-700 transition-colors hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-70"
              type="button"
              onClick={() => void saveSubscription("DELETE")}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Unsubscribing..." : "Unsubscribe"}
            </button>
          </div>
        </div>
      ) : subscriptionStatus === "inactive" ? (
        <div className="mt-3.5 rounded-[1.15rem] border border-slate-200 bg-slate-50 p-4">
          <h3 className="text-base font-semibold text-slate-900">
            Your newsletter subscription is paused.
          </h3>
          <p className="mt-1.5 text-sm leading-6 text-slate-600">
            Resubscribe any time, or update your full preferences from account settings.
          </p>
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row">
            <button
              className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
              type="button"
              onClick={() => void saveSubscription("POST")}
              disabled={isSubmitting}
            >
              {isSubmitting ? "Resubscribing..." : "Resubscribe"}
            </button>
            <a
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4.5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              href="/account#newsletter"
            >
              Change newsletter settings
            </a>
          </div>
        </div>
      ) : (
        <form className="mt-3.5 space-y-3" onSubmit={handleSubmit}>
          <input
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
          />

          <select
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
            value={preferredFrequency}
            onChange={(event) =>
              setPreferredFrequency(event.target.value as FrequencyOption)
            }
          >
            {FREQUENCY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          {preferredFrequency === "custom" ? (
            <input
              className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              placeholder="Custom frequency in hours"
              value={customFrequency}
              onChange={(event) => setCustomFrequency(event.target.value)}
            />
          ) : null}

          <button
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-70"
            type="submit"
            disabled={isSubmitting}
            onClick={() =>
              trackEvent("newsletter_signup_click", {
                location: title,
              })
            }
          >
            {isSubmitting ? "Saving..." : "Join newsletter"}
          </button>
        </form>
      )}

      {message ? (
        <p
          className={`mt-2.5 rounded-xl border px-3.5 py-2.5 text-sm ${
            messageTone === "error"
              ? "border-rose-200 bg-rose-50 text-rose-700"
              : messageTone === "info"
                ? "border-sky-200 bg-sky-50 text-sky-700"
              : "border-emerald-200 bg-emerald-50 text-emerald-700"
          }`}
        >
          {message}
        </p>
      ) : null}

      {browseHeadlinesHref ? (
        <div className="mt-3.5">
          <a
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 sm:w-auto"
            href={browseHeadlinesHref}
          >
            Browse headlines
          </a>
        </div>
      ) : null}
    </div>
  );
}

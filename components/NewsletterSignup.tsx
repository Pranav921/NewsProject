"use client";

import { useState } from "react";

type NewsletterSignupProps = {
  initialEmail?: string | null;
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
  initialEmail = null,
  title = "Newsletter sign-up",
  description = "Get ready for future email updates by saving your preferred delivery frequency.",
}: NewsletterSignupProps) {
  const [email, setEmail] = useState(initialEmail ?? "");
  const [preferredFrequency, setPreferredFrequency] =
    useState<FrequencyOption>("daily");
  const [customFrequency, setCustomFrequency] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"error" | "success" | null>(null);

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

    try {
      const response = await fetch("/api/newsletter-subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customFrequency:
            preferredFrequency === "custom" ? customFrequency.trim() : null,
          email: email.trim(),
          preferredFrequency,
        }),
      });

      const result = (await response.json()) as { message?: string };

      if (!response.ok) {
        setMessage(result.message ?? "Something went wrong. Please try again.");
        setMessageTone("error");
      } else {
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

  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
        {title}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>

      <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
        <input
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />

        <select
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
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
            className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
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
          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-70"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Saving..." : "Join newsletter"}
        </button>
      </form>

      {message ? (
        <p
          className={`mt-3 text-sm ${
            messageTone === "error" ? "text-rose-700" : "text-emerald-700"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

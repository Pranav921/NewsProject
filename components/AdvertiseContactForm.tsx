"use client";

import { useState } from "react";

export function AdvertiseContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [budget, setBudget] = useState("");
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
  }

  return (
    <section className="editorial-page-subcard p-4 sm:p-5">
      <div>
        <p className="editorial-section-label text-[var(--accent)]">
          Contact
        </p>
        <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-[var(--foreground)]">
          Ask about sponsorships or in-feed placements
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--text-sub)]">
          Share a few details about your campaign and we can wire contact
          handling next.
        </p>
      </div>

      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
        <input
          className="editorial-input min-h-11 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
          type="text"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <input
          className="editorial-input min-h-11 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          className="editorial-input min-h-11 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
          type="text"
          placeholder="Company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />
        <input
          className="editorial-input min-h-11 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)]"
          type="text"
          placeholder="Budget or range (optional)"
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
        />
        <textarea
          className="editorial-input min-h-32 rounded-xl px-3.5 py-2.5 text-sm outline-none transition-colors focus:border-[var(--accent)] sm:col-span-2"
          placeholder="Tell us about your launch timing, target audience, and placement goals."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />
        <div className="sm:col-span-2">
          <button
            className="editorial-primary-button inline-flex min-h-11 items-center justify-center px-4.5 py-2.5 text-sm font-medium transition-colors hover:opacity-95"
            type="submit"
          >
            Send inquiry
          </button>
        </div>
      </form>

      {submitted ? (
        <p className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-700">
          Thanks - contact handling can be wired next. For now, you can also
          email latest@kicker.news directly.
        </p>
      ) : null}
    </section>
  );
}

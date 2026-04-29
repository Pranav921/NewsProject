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
    <section className="rounded-[1.35rem] border border-slate-200 bg-slate-50 p-4 sm:p-5">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700">
          Contact
        </p>
        <h2 className="mt-1 text-[1.25rem] font-semibold tracking-tight text-slate-950">
          Ask about sponsorships or in-feed placements
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Share a few details about your campaign and we can wire contact
          handling next.
        </p>
      </div>

      <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit}>
        <input
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
          type="text"
          placeholder="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <input
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
          type="email"
          placeholder="Email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <input
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
          type="text"
          placeholder="Company"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />
        <input
          className="min-h-11 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400"
          type="text"
          placeholder="Budget or range (optional)"
          value={budget}
          onChange={(event) => setBudget(event.target.value)}
        />
        <textarea
          className="min-h-32 rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 sm:col-span-2"
          placeholder="Tell us about your launch timing, target audience, and placement goals."
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
        />
        <div className="sm:col-span-2">
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-900 px-4.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800"
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

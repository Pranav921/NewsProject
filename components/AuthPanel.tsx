"use client";

import { trackEvent } from "@/lib/analytics";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type AuthMode = "login" | "signup";

type AuthPanelProps = {
  syncWithHash?: boolean;
};

export function AuthPanel({ syncWithHash = false }: AuthPanelProps) {
  const router = useRouter();
  const [supabase] = useState(() => createSupabaseBrowserClient());
  const [authMode, setAuthMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!syncWithHash) {
      return;
    }

    function updateModeFromHash() {
      if (window.location.hash === "#public-auth-panel-signup") {
        setAuthMode("signup");
        setMessage(null);
        return;
      }

      if (window.location.hash === "#public-auth-panel-login") {
        setAuthMode("login");
        setMessage(null);
      }
    }

    updateModeFromHash();
    window.addEventListener("hashchange", updateModeFromHash);

    return () => {
      window.removeEventListener("hashchange", updateModeFromHash);
    };
  }, [syncWithHash]);

  async function handleSignUp() {
    if (!email.trim() || !password) {
      setMessage("Enter an email and password.");
      return;
    }

    trackEvent("account_signup_attempt", {
      auth_mode: "signup",
      method: "password",
    });

    setIsSubmitting(true);
    setMessage(null);

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });

    if (error) {
      setMessage(error.message);
    } else if (data.user && !data.session) {
      trackEvent("account_signup_success", {
        auth_mode: "signup",
        confirmation_required: true,
      });
      setMessage("Sign-up successful. Check your email to confirm your account.");
    } else {
      trackEvent("account_signup_success", {
        auth_mode: "signup",
        confirmation_required: false,
      });
      router.replace("/");
      router.refresh();
      return;
    }

    setIsSubmitting(false);
  }

  async function handleSignIn() {
    if (!email.trim() || !password) {
      setMessage("Enter an email and password.");
      return;
    }

    trackEvent("account_login_attempt", {
      auth_mode: "login",
      method: "password",
    });

    setIsSubmitting(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setMessage(error.message);
    } else {
      trackEvent("account_login_success", {
        auth_mode: "login",
      });
      router.replace("/");
      router.refresh();
      return;
    }

    setIsSubmitting(false);
  }

  return (
    <div className="w-full max-w-md rounded-[1.4rem] border border-slate-200 bg-white p-4.5 shadow-[0_14px_32px_rgba(15,23,42,0.07)]">
      <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
        <button
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${
            authMode === "login"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-white"
          }`}
          type="button"
          onClick={() => {
            setAuthMode("login");
            setMessage(null);
          }}
          aria-pressed={authMode === "login"}
        >
          Log in
        </button>
        <button
          className={`rounded-full px-4 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 ${
            authMode === "signup"
              ? "bg-slate-900 text-white"
              : "text-slate-600 hover:bg-white"
          }`}
          type="button"
          onClick={() => {
            setAuthMode("signup");
            setMessage(null);
          }}
          aria-pressed={authMode === "signup"}
        >
          Sign up
        </button>
      </div>

      <h1 className="mt-3.5 text-[1.55rem] font-semibold tracking-tight text-slate-900">
        {authMode === "login" ? "Welcome back" : "Create your account"}
      </h1>
      <p className="mt-1.5 text-sm leading-5 text-slate-500">
        {authMode === "login"
          ? "Log in to your feed, saved stories, alerts, and newsletter settings."
          : "Create an account to sync saved stories, alerts, and newsletter preferences."}
      </p>

      <div className="mt-3.5 space-y-2.5">
        <label className="sr-only" htmlFor="auth-email">
          Email address
        </label>
        <input
          id="auth-email"
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
          type="email"
          placeholder="Email address"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />

        <label className="sr-only" htmlFor="auth-password">
          Password
        </label>
        <input
          id="auth-password"
          className="min-h-11 w-full rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-700 outline-none transition-colors focus:border-sky-400 focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
          type="password"
          placeholder="Password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
        />
      </div>

      <button
        className="mt-3.5 inline-flex min-h-11 w-full items-center justify-center rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-70"
        type="button"
        onClick={authMode === "login" ? handleSignIn : handleSignUp}
        disabled={isSubmitting}
      >
        {isSubmitting
          ? "Working..."
          : authMode === "login"
            ? "Log in"
            : "Sign up"}
      </button>

      {message ? (
        <p
          className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm text-slate-600"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

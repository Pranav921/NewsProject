import { AccountSettings } from "@/components/AccountSettings";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeUserPreferences } from "@/lib/user-preferences";
import Link from "next/link";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AccountPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/");
  }

  const { data: userPreferencesRow } = await supabase
    .from("user_preferences")
    .select("default_source_filter, default_time_filter, default_view_mode")
    .maybeSingle();
  const { data: alertKeywordRows } = await supabase
    .from("user_alert_keywords")
    .select("keyword")
    .order("created_at", { ascending: true });
  const { data: newsletterRow } = await supabase
    .from("newsletter_subscriptions")
    .select("frequency, custom_frequency, is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  const initialPreferences = normalizeUserPreferences(
    userPreferencesRow
      ? {
          defaultSourceFilter: userPreferencesRow.default_source_filter,
          defaultTimeFilter: userPreferencesRow.default_time_filter,
          defaultViewMode: userPreferencesRow.default_view_mode,
        }
      : null,
  );
  const initialAlertKeywords = (alertKeywordRows ?? []).map((row) => row.keyword);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-6">
        <Link
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          href="/"
        >
          Back to dashboard
        </Link>
      </div>

      <AccountSettings
        email={user.email ?? ""}
        initialAlertKeywords={initialAlertKeywords}
        initialNewsletterCustomFrequency={
          newsletterRow?.is_active ? newsletterRow.custom_frequency : null
        }
        initialNewsletterFrequency={
          newsletterRow?.is_active ? newsletterRow.frequency : null
        }
        initialPreferences={initialPreferences}
        userId={user.id}
      />
    </main>
  );
}

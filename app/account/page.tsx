import { AccountSettings } from "@/components/AccountSettings";
import { PERSONALIZATION_MIN_UNIQUE_CLICKS } from "@/lib/personalization";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { EmailSendLog } from "@/lib/types";
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

  const adminSupabase = createSupabaseAdminClient();

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
    .select("id, frequency, custom_frequency, email_format, article_mode, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  const { data: emailSendLogRows } = await supabase
    .from("email_send_logs")
    .select("status, error, article_count, sent_at")
    .eq("user_id", user.id)
    .order("sent_at", { ascending: false });
  const [
    clickEventsBySubscriptionResult,
    clickEventsByEmailResult,
    clickEventsByUserIdResult,
  ] =
    await Promise.all([
      newsletterRow?.id
        ? adminSupabase
            .from("email_click_events")
            .select("article_link")
            .eq("subscription_id", newsletterRow.id)
        : Promise.resolve({ data: [], error: null }),
      user.email
        ? adminSupabase
            .from("email_click_events")
            .select("article_link")
            .eq("email", user.email.toLowerCase())
        : Promise.resolve({ data: [], error: null }),
      adminSupabase
        .from("email_click_events")
        .select("article_link")
        .eq("user_id", user.id),
    ]);

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
  const initialEmailSendLogs: EmailSendLog[] = (emailSendLogRows ?? []).map(
    (row) => ({
      articleCount: row.article_count,
      error: row.error,
      sentAt: row.sent_at,
      status: row.status,
    }),
  );
  const newsletterClickedArticleCount = countUniqueArticleLinks([
    ...((clickEventsBySubscriptionResult.data ?? []).map((row) => row.article_link)),
    ...((clickEventsByUserIdResult.data ?? []).map((row) => row.article_link)),
    ...((clickEventsByEmailResult.data ?? []).map((row) => row.article_link)),
  ]);
  const newsletterPersonalizationReady =
    newsletterClickedArticleCount >= PERSONALIZATION_MIN_UNIQUE_CLICKS;

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

      <section className="mb-8 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900">
          Email analytics
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          Review send performance, skip reasons, and top content trends.
        </p>
        <div className="mt-4">
          <Link
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            href="/email-analytics"
          >
            View email analytics
          </Link>
        </div>
      </section>

      <AccountSettings
        email={user.email ?? ""}
        initialAlertKeywords={initialAlertKeywords}
        initialEmailSendLogs={initialEmailSendLogs}
        initialNewsletterArticleMode={
          newsletterRow?.is_active ? newsletterRow.article_mode : null
        }
        initialNewsletterCustomFrequency={
          newsletterRow?.is_active ? newsletterRow.custom_frequency : null
        }
        initialNewsletterClickedArticleCount={newsletterClickedArticleCount}
        initialNewsletterEmailFormat={
          newsletterRow?.is_active ? newsletterRow.email_format : null
        }
        initialNewsletterFrequency={
          newsletterRow?.is_active ? newsletterRow.frequency : null
        }
        initialNewsletterPersonalizationReady={newsletterPersonalizationReady}
        initialPreferences={initialPreferences}
        userId={user.id}
      />
    </main>
  );
}

function countUniqueArticleLinks(links: Array<string | null>) {
  return new Set(links.map((link) => link?.trim() ?? "").filter(Boolean)).size;
}

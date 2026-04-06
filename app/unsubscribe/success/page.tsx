import Link from "next/link";

type UnsubscribeSuccessPageProps = {
  searchParams: Promise<{
    status?: string;
  }>;
};

export default async function UnsubscribeSuccessPage({
  searchParams,
}: UnsubscribeSuccessPageProps) {
  const { status } = await searchParams;
  const message =
    status === "success"
      ? "You have been unsubscribed from Kicker News emails."
      : status === "error"
        ? "We could not update your subscription right now. Please try again later."
        : "This unsubscribe link is invalid or has already been used.";

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-1 items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
      <section className="w-full rounded-3xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">
          Kicker News
        </p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">
          Newsletter preferences updated
        </h1>
        <p className="mt-4 text-sm leading-7 text-slate-600">{message}</p>
        <Link
          className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
          href="/"
        >
          Back to dashboard
        </Link>
      </section>
    </main>
  );
}

export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8 lg:py-5">
      <div className="animate-pulse rounded-[1.6rem] border border-slate-200 bg-white p-4 shadow-[0_16px_40px_rgba(15,23,42,0.07)] sm:p-5">
        <div className="h-8 w-40 rounded-full bg-slate-100" />
        <div className="mt-4 h-10 max-w-2xl rounded-xl bg-slate-100" />
        <div className="mt-3 h-5 max-w-xl rounded-lg bg-slate-100" />
        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="h-24 rounded-xl bg-slate-100" />
          <div className="h-24 rounded-xl bg-slate-100" />
          <div className="h-24 rounded-xl bg-slate-100" />
        </div>
      </div>

      <div className="animate-pulse rounded-[1.4rem] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="h-10 rounded-xl bg-slate-100" />
          <div className="h-10 rounded-xl bg-slate-100" />
          <div className="h-10 rounded-xl bg-slate-100" />
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            key={index}
            className="animate-pulse rounded-[1.25rem] border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.05)]"
          >
            <div className="h-5 w-24 rounded-full bg-slate-100" />
            <div className="mt-4 h-7 rounded-xl bg-slate-100" />
            <div className="mt-2 h-7 w-4/5 rounded-xl bg-slate-100" />
            <div className="mt-4 h-28 rounded-[1rem] bg-slate-100" />
            <div className="mt-4 flex gap-3">
              <div className="h-10 w-28 rounded-xl bg-slate-100" />
              <div className="h-10 w-36 rounded-xl bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}

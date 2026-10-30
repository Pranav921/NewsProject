type SubscriptionRequiredBadgeProps = {
  tone?: "dark" | "light";
};

export function SubscriptionRequiredBadge({
  tone = "light",
}: SubscriptionRequiredBadgeProps) {
  const toneClasses =
    tone === "dark"
      ? "border-white/20 bg-white/10 text-white/75"
      : "border-slate-300 bg-slate-50 text-slate-600";

  return (
    <span
      aria-label="Subscription required to read this article"
      className={`mono-meta inline-flex items-center rounded-full border px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-[0.08em] ${toneClasses}`}
      title="A New York Times subscription may be required to read the full article."
    >
      Subscription required
    </span>
  );
}

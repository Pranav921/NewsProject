import Image from "next/image";

type BrandLogoProps = {
  className?: string;
  desktopHeightClassName?: string;
  mobileHeightClassName?: string;
  priority?: boolean;
};

type BrandBadgeProps = {
  className?: string;
  textClassName?: string;
};

export function BrandLogo({
  className = "",
  desktopHeightClassName = "sm:h-16",
  mobileHeightClassName = "h-8",
  priority = false,
}: BrandLogoProps) {
  return (
    <Image
      alt="Kicker News"
      className={`${mobileHeightClassName} w-auto object-contain ${desktopHeightClassName} ${className}`.trim()}
      height={1024}
      priority={priority}
      src="/logo-horizontal.png"
      width={1536}
    />
  );
}

export function BrandBadge({
  className = "",
  textClassName = "",
}: BrandBadgeProps) {
  return (
    <span
      className={`inline-flex min-h-9 items-center rounded-full border border-sky-200 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-800 ${className}`.trim()}
    >
      <span className={textClassName}>Kicker News</span>
    </span>
  );
}

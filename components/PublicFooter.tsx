import Link from "next/link";

const PUBLIC_LINKS = [
  { href: "/about", label: "About" },
  { href: "/newsletter", label: "Newsletter" },
  { href: "/advertise", label: "Advertise" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

export function PublicFooter() {
  return (
    <footer className="w-full rounded-[1.2rem] border border-slate-200 bg-white px-4 py-3 shadow-[0_12px_24px_rgba(15,23,42,0.04)] sm:px-5 sm:py-4">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Kicker News</p>
          <p className="mt-1 text-xs leading-5 text-slate-500 sm:text-sm">
            Clean RSS-based news tracking, saved stories, alerts, and newsletters.
          </p>
        </div>
        <nav className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-slate-600 sm:flex sm:flex-wrap sm:gap-x-4 sm:gap-y-2">
          {PUBLIC_LINKS.map((link) => (
            <Link
              key={link.href}
              className="inline-flex w-fit items-center border-b border-transparent pb-0.5 transition-colors hover:border-current hover:text-slate-900"
              href={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </footer>
  );
}

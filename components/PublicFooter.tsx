import Image from "next/image";
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
    <footer className="w-full rounded-[1.2rem] border border-slate-200 bg-white px-4 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.04)] sm:px-5 sm:py-4.5">
      <div className="flex flex-col gap-3.5 md:flex-row md:items-start md:justify-between">
        <div className="max-w-sm">
          <div className="inline-flex w-fit items-center gap-3">
            <Image
              alt="Kicker News"
              className="h-7 w-7 rounded-[0.7rem] object-contain sm:h-8 sm:w-8"
              height={1024}
              src="/logo-icon.png"
              width={1024}
            />
            <div>
              <p className="text-base font-semibold tracking-tight text-slate-950 sm:text-lg">
                Kicker News
              </p>
            </div>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Clean RSS-based news tracking, saved stories, alerts, and newsletters.
          </p>
        </div>
        <nav
          className="grid w-full grid-cols-2 gap-x-5 gap-y-2 text-sm text-slate-600 sm:grid-cols-3 md:w-auto md:flex md:flex-wrap md:justify-end md:gap-x-4 md:gap-y-2"
          aria-label="Public site links"
        >
          {PUBLIC_LINKS.map((link) => (
            <Link
              key={link.href}
              className="inline-flex w-fit items-center border-b border-transparent pb-0.5 transition-colors hover:border-current hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2"
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

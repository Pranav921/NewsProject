import type { Metadata } from "next";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { Suspense } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Kicker News",
    template: "%s | Kicker News",
  },
  description:
    "Kicker News is a clean RSS-powered news dashboard with saved stories, smart alerts, and newsletter digests.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full text-slate-900">
        <Suspense fallback={null}>
          <AnalyticsProvider />
        </Suspense>
        <div className="flex min-h-full flex-col">{children}</div>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { DM_Mono, DM_Sans } from "next/font/google";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import {
  getDefaultOpenGraphImageUrl,
  getSiteUrl,
  SITE_DESCRIPTION,
  SITE_NAME,
} from "@/lib/seo";
import { Suspense } from "react";
import "./globals.css";

const dmSans = DM_Sans({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-dm-sans",
});

const dmMono = DM_Mono({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-dm-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  icons: {
    icon: "/favicon.ico",
    shortcut: "/favicon.ico",
    apple: "/logo-icon.png",
  },
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  metadataBase: new URL(getSiteUrl()),
  openGraph: {
    description: SITE_DESCRIPTION,
    images: [
      {
        alt: `${SITE_NAME} preview`,
        url: getDefaultOpenGraphImageUrl(),
      },
    ],
    siteName: SITE_NAME,
    title: SITE_NAME,
    type: "website",
    url: getSiteUrl(),
  },
  twitter: {
    card: "summary_large_image",
    description: SITE_DESCRIPTION,
    images: [getDefaultOpenGraphImageUrl()],
    title: SITE_NAME,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${dmSans.variable} ${dmMono.variable} h-full antialiased`}
    >
      <body className="min-h-full text-slate-900">
        <Suspense fallback={null}>
          <AnalyticsProvider />
        </Suspense>
        <div className="flex min-h-full flex-col">{children}</div>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { DM_Mono, DM_Sans } from "next/font/google";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { SITE_NAME } from "@/lib/seo";
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

const SITE_URL = "https://kicker.news";
const SITE_DESCRIPTION =
  "A clean, real-time feed for the day’s most important headlines.";
const OPEN_GRAPH_IMAGE_URL = `${SITE_URL}/og-image.png`;
const TWITTER_IMAGE_URL = `${SITE_URL}/twitter-image.png`;

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  metadataBase: new URL(SITE_URL),
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
  openGraph: {
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    images: [
      {
        alt: `${SITE_NAME} preview`,
        height: 630,
        url: OPEN_GRAPH_IMAGE_URL,
        width: 1200,
      },
    ],
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    images: [
      {
        alt: `${SITE_NAME} preview`,
        height: 630,
        url: TWITTER_IMAGE_URL,
        width: 1200,
      },
    ],
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

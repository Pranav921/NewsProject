import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Breaking News RSS",
  description: "A simple Next.js news dashboard powered by official RSS feeds.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full text-slate-900">
        <div className="flex min-h-full flex-col">{children}</div>
      </body>
    </html>
  );
}

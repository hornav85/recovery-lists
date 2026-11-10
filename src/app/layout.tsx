import type { Metadata } from "next";
import "./globals.css";

/** Never prerender routes that talk to Postgres — publish build has DATABASE_URL before migrate. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recovery Lists",
  description: "Local recovery list ops console — Sheets read-only",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;650&display=swap"
          rel="stylesheet"
        />
      </head>
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject body attrs */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}

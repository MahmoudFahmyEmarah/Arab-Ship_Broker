import type { Metadata } from "next";
import { Suspense } from "react";
import { Toaster } from "sonner";

import { Geist, Inter, Noto_Sans_Arabic } from "next/font/google";
// Design-system tokens first (single source of truth for every surface);
// globals.css may refine them for the portal, admin.css consumes them as-is.
import "./design-tokens.css";
import "./globals.css";
import { PropellerLoader } from "@/components/portal/PropellerLoader";
import { CookieConsent } from "@/components/CookieConsent";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// ASB design system font — Inter (weights 400/500/600 per tokens.css)
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

// Arabic-capable webfont for bilingual brand/UI text (pairs with Inter).
// Exposed as --font-arabic; applied only to Arabic (dir="rtl") elements.
const notoArabic = Noto_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
});

const SITE_TITLE = "Arab ShipBroker Maritime Brokerage for MENA";
const SITE_DESCRIPTION = "Connecting shippers with shipowners";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.arabshipbroker.com"),
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  // Link previews (WhatsApp, LinkedIn, Slack…) read the Open Graph tags first
  // and only fall back to <meta name="description"> when they are missing.
  openGraph: {
    type: "website",
    siteName: "Arab ShipBroker",
    url: "https://www.arabshipbroker.com",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${inter.variable} ${notoArabic.variable} antialiased flex flex-col min-h-screen`}
      >
        <Suspense fallback={null}>
          <PropellerLoader />
        </Suspense>
        <main className="flex-1">{children}</main>
        <CookieConsent />
        <Toaster position="top-right" />
      </body>
    </html>
  );
}

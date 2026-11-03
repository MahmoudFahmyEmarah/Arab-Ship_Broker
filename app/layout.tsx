import type { Metadata } from "next";
import { Suspense } from "react";
import { Toaster } from "sonner";

// Self-hosted variable fonts (app/fonts, SIL OFL): the build never fetches Google Fonts — the production build of
// 1 Nov 2026 failed when that fetch did not resolve (owner, 3 Nov 2026).
import localFont from "next/font/local";
// Design-system tokens first (single source of truth for every surface);
// globals.css may refine them for the portal, admin.css consumes them as-is.
import "./design-tokens.css";
import "./globals.css";
import { PropellerLoader } from "@/components/portal/PropellerLoader";
import { CookieConsent } from "@/components/CookieConsent";

const geistSans = localFont({
  variable: "--font-geist-sans",
  src: "./fonts/geist-sans-variable.woff2",
  weight: "100 900",
  display: "swap",
});

// ASB design system font — Inter (weights 400/500/600 per tokens.css: the file is Google's wght 400..600 range, so
// heavier text keeps the synthesised bold it had before)
const inter = localFont({
  variable: "--font-inter",
  src: "./fonts/inter-latin-wght.woff2",
  weight: "400 600",
  display: "swap",
});

// Arabic-capable webfont for bilingual brand/UI text (pairs with Inter).
// Exposed as --font-arabic; applied only to Arabic (dir="rtl") elements.
const notoArabic = localFont({
  variable: "--font-arabic",
  src: "./fonts/noto-sans-arabic-wght.woff2",
  weight: "400 600",
  display: "swap",
});

const SITE_TITLE = "Arab ShipBroker Maritime Brokerage for MENA";
const SOCIAL_TITLE = "Arab ShipBroker | MENA Brokerage";
const SITE_DESCRIPTION =
  "Connecting shippers with shipowners across MENA through trusted maritime brokerage and intelligent cargo-vessel matching.";
const SITE_IMAGE = "/logo.png";

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
    title: SOCIAL_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: SITE_IMAGE,
        width: 1024,
        height: 1024,
        alt: "Arab ShipBroker logo",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SOCIAL_TITLE,
    description: SITE_DESCRIPTION,
    images: [SITE_IMAGE],
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

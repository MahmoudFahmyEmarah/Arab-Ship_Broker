import type { Metadata } from "next";
import { Suspense } from "react";
import { Toaster } from "sonner";
import { Analytics } from "@vercel/analytics/next";

import { Geist, Inter, Noto_Sans_Arabic } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Arab ShipBroker - Maritime Brokerage for MENA",
  description: "Connecting Buyers and Sellers in the MENA Maritime Market",
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
        <Analytics />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import { Suspense } from "react";
import { Toaster } from "sonner";

import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { PropellerLoader } from "@/components/portal/PropellerLoader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// ASB design system font — Inter (weights 400/500/600 per tokens.css)
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
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
        className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} antialiased flex flex-col min-h-screen`}
      >
        <Suspense fallback={null}>
          <PropellerLoader />
        </Suspense>
        <main className="flex-1">{children}</main>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}

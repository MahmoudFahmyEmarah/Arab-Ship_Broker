import type { Metadata } from "next";
import { Toaster } from "sonner";
import NextTopLoader from "nextjs-toploader";

import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
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
        className={`${geistSans.variable} ${geistMono.variable} antialiased flex flex-col min-h-screen`}
      >
        <NextTopLoader
          color="#3370a9"
          initialPosition={0.15}
          crawlSpeed={120}
          height={3}
          crawl
          easing="ease"
          speed={200}
          showSpinner={false}
          shadow="0 0 10px rgba(51, 112, 169, 0.35), 0 0 5px rgba(51, 112, 169, 0.3)"
        />
        <main className="flex-1">{children}</main>
        <Toaster position="top-right" />
      </body>
    </html>
  );
}

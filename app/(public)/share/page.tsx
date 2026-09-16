import type { Metadata } from "next";

import HomePage from "../page";

const TITLE = "Arab ShipBroker Maritime Brokerage for MENA";
const DESCRIPTION =
  "Connecting shippers with shipowners across MENA through trusted maritime brokerage and intelligent cargo-vessel matching.";
const IMAGE = "/opengraph-image";

export const revalidate = 300;

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  robots: { index: false, follow: true },
  openGraph: {
    type: "website",
    siteName: "Arab ShipBroker",
    url: "https://www.arabshipbroker.com/share",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: IMAGE,
        width: 1200,
        height: 630,
        alt: "Arab ShipBroker — Connecting shippers with shipowners",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [IMAGE],
  },
};

export default function SharePage() {
  return <HomePage />;
}

import type { Metadata } from "next";

import HomePage from "../page";

const TITLE = "Arab ShipBroker | MENA Brokerage";
const DESCRIPTION =
  "Connecting shippers with shipowners across MENA through trusted maritime brokerage and intelligent cargo-vessel matching.";
const IMAGE = "/logo.png";

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
        width: 1024,
        height: 1024,
        alt: "Arab ShipBroker logo",
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

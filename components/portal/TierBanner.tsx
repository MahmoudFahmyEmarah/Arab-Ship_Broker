"use client";

// Dashboard tier banner, ported from the design (asb/market-partner.jsx).
// Shows only for real T1/T2 accounts. (The demo tier pill was removed per the
// spec — tier is account-derived, never toggled in the UI.)
import * as React from "react";
import Link from "next/link";
import { useViewerTier, Tier } from "@/lib/portal/tier";

const TIER_MSGS: Partial<Record<Tier, { label: string; body: string }>> = {
  T1: {
    label: "Free tier (T1)",
    body: "Upgrade to Subscriber to access full match intelligence, vessel names and IMO numbers.",
  },
  T2: {
    label: "Standard tier (T2)",
    body: "Upgrade to Subscriber to unlock Market Partner identity and the voyage cost calculator.",
  },
};

export function DashboardTierBanner() {
  const tier = useViewerTier();
  const msg = TIER_MSGS[tier];
  if (!msg) return null;
  return (
    <div className="asb-tier-banner" role="status">
      <span className="asb-tier-banner__icon" aria-hidden>!</span>
      <span className="asb-tier-banner__msg">
        You are on the <strong>{msg.label}</strong>. {msg.body}
      </span>
      <Link className="asb-tier-banner__cta" href="/dashboard/account?tab=billing">Upgrade →</Link>
    </div>
  );
}

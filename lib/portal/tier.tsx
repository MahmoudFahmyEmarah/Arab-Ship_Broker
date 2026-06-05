"use client";

// Viewer tier (T1–T4). REAL — derived from the signed-in account, never a UI
// toggle (the design's demo tier switches were removed per the spec). Drives
// the dashboard tier banner, market-partner visibility + discovery gating
// (limited cargo / masked vessel), and calculator locking.
import * as React from "react";

export type Tier = "T1" | "T2" | "T3" | "T4";

const TierCtx = React.createContext<Tier>("T3");

/**
 * Provide the viewer's real tier. `tier` is controlled by the account; there is
 * intentionally no setter exposed to the UI.
 */
export function TierProvider({ children, tier = "T3" }: { children: React.ReactNode; tier?: Tier }) {
  return <TierCtx.Provider value={tier}>{children}</TierCtx.Provider>;
}

export function useViewerTier(): Tier {
  return React.useContext(TierCtx);
}

// Single seam mapping the account → subscription tier. Today the schema only
// has trust_tier (account standing, not a plan), so paid brokers default to
// Subscriber (T3). When a real `subscription_tier` column exists, map it here.
export function accountTier(_account: { trustTier?: string } | null | undefined): Tier {
  // TODO: return account?.subscription_tier mapped to T1–T4 once the column exists.
  return "T3";
}

// Calculators (Voyage Estimator, Ports DA, Suez Toll) are locked for T1/T2.
export function isCalculatorLocked(tier: Tier): boolean {
  return tier === "T1" || tier === "T2";
}

// Discovery firewall: T1/T2 see redacted cargo + masked vessel identity.
export function isLimitedTier(tier: Tier): boolean {
  return tier === "T1" || tier === "T2";
}

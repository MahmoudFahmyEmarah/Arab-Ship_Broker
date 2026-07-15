"use client";

// Viewer tier (T1–T4). REAL — derived from the signed-in account, never a UI
// toggle (the design's demo tier switches were removed per the spec). Drives
// the dashboard tier banner, market-partner visibility + discovery gating
// (limited cargo / masked vessel), and calculator locking.
import * as React from "react";
import type { Tier } from "./tier-gate";

// Re-export the type + the server-safe gate helpers so existing client-side
// imports from "@/lib/portal/tier" keep working. The pure gates themselves live
// in ./tier-gate so server components can call them (this file is "use client").
export type { Tier } from "./tier-gate";
export { isCalculatorLocked, isLimitedTier } from "./tier-gate";

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

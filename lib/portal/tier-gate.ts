// Server-safe tier gates. These are PURE functions (no React) so they can be
// called from BOTH server components (the calculator page guards) and client
// components. They must NOT live in a "use client" module — Next.js would then
// treat them as client references and calling them on the server throws
// ("Attempted to call isCalculatorLocked() from the server …").
// The React context Provider/hook stay in ./tier (client-only).

export type Tier = "T1" | "T2" | "T3" | "T4";

// Calculators (Voyage Estimator, Ports DA, Suez Toll) are locked for T1/T2.
export function isCalculatorLocked(tier: Tier): boolean {
  return tier === "T1" || tier === "T2";
}

// Discovery firewall: T1/T2 see redacted cargo + masked vessel identity.
export function isLimitedTier(tier: Tier): boolean {
  return tier === "T1" || tier === "T2";
}

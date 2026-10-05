// Calculator entitlement — the one rule for the Suez calculator and the Voyage
// estimator, used by both pages and every server action (audit C2O-039 P0-4).
// Pure: no I/O, so scripts/voyage-check.ts tests it directly.
//
//   · signed out, no portal profile or an inactive profile → refused;
//   · admin = the users row says admin AND the Auth app_metadata claim says admin
//     (the same double proof as requireAdmin and fn_is_admin);
//   · members need T3/T4 (or a market partner) AND the member rollout switch,
//     which stays off until a published SCA toll table and a live fuel index
//     exist in production (PLAN-voyage-economics §5).
import { normalizeRole } from "@/lib/role";
import { viewerTierFrom, type SubscriptionTier } from "@/lib/tiers";

export const CALCULATOR_MEMBER_ROLLOUT = false;

export interface CalculatorProfileRow {
  id: string;
  role?: string | null;
  is_active?: boolean | null;
  subscription_tier?: string | null;
  is_market_partner?: boolean | null;
}

export type CalculatorDenial = "signed_out" | "no_profile" | "inactive" | "tier_locked" | "rollout";

export type CalculatorAccess =
  | { allowed: true; actorId: string; kind: "admin" | "member"; tier: SubscriptionTier }
  | { allowed: false; reason: CalculatorDenial; tier: SubscriptionTier | null };

export function decideCalculatorAccess(f: {
  authenticated: boolean;
  row: CalculatorProfileRow | null;
  claimRole: string | null | undefined;
  memberRollout?: boolean;
}): CalculatorAccess {
  if (!f.authenticated) return { allowed: false, reason: "signed_out", tier: null };
  if (!f.row?.id) return { allowed: false, reason: "no_profile", tier: null };
  if (f.row.is_active !== true) return { allowed: false, reason: "inactive", tier: null };
  const vt = viewerTierFrom(f.row);
  const tier: SubscriptionTier = vt.isMarketPartner ? "T3" : vt.tier;
  if (normalizeRole(f.row.role) === "admin" && f.claimRole === "admin") return { allowed: true, actorId: f.row.id, kind: "admin", tier };
  if (tier === "T1" || tier === "T2") return { allowed: false, reason: "tier_locked", tier };
  if (!(f.memberRollout ?? CALCULATOR_MEMBER_ROLLOUT)) return { allowed: false, reason: "rollout", tier };
  return { allowed: true, actorId: f.row.id, kind: "member", tier };
}

export function calculatorDenialMessage(reason: CalculatorDenial): string {
  switch (reason) {
    case "signed_out": return "Please sign in.";
    case "no_profile": return "Your account has no portal profile.";
    case "inactive": return "Your account is not active.";
    case "tier_locked": return "The calculators are part of the Tier 3 and Tier 4 plans.";
    case "rollout": return "The calculators are not open to members yet.";
  }
}

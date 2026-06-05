// Subscription tier (T1–T4) helpers.
//
// FIREWALL NOTE: tier does NOT grant counterparty contact. Identity/contact
// stays admin/owner-only (enforced in the DB via v_vessel_detail). Tier only
// decides which non-owner view is shown: the upgrade teaser (non-subscribers)
// or the "brokered by Arab ShipBroker" locked card (subscribers).

export type SubscriptionTier = "T1" | "T2" | "T3" | "T4";

export interface ViewerTier {
  tier: SubscriptionTier;
  isMarketPartner: boolean;
}

/** Subscriber = Tier 3+ or a market partner. */
export function isSubscriber(v: ViewerTier): boolean {
  return v.isMarketPartner || v.tier === "T3" || v.tier === "T4";
}

/** Normalise possibly-missing user columns into a ViewerTier. */
export function viewerTierFrom(
  row: { subscription_tier?: string | null; is_market_partner?: boolean | null } | null,
): ViewerTier {
  const tier = (row?.subscription_tier as SubscriptionTier) ?? "T1";
  return {
    tier: ["T1", "T2", "T3", "T4"].includes(tier) ? tier : "T1",
    isMarketPartner: !!row?.is_market_partner,
  };
}

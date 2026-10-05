// Fuel Bar contracts (Voyage Economics plan r2 §4.1). Pure types, no runtime.
// FuelPriceIndex is the frozen cross-stream contract: the Voyage estimator
// consumes `averageUsdMt`; min/median/max/count are for review only. The index
// never carries supplier identity, and a product with no live quote is listed
// in `noOffer` instead of appearing with a zero price.

/** Catalogue key (`fuel_products.key`). The market label is display only. */
export type FuelProductKey = "HSFO380" | "VLSFO" | "ULSFO" | "LSMGO" | "MGO05" | "MDO";

export type FuelFamily = "residual" | "distillate";
export type SulphurClass = "HS" | "VLS" | "ULS";

/** How far the index had to fall back from the requested port. */
export type FuelIndexScope = "port" | "region" | "global";

/**
 * Quote age tiers: ≤ 7 d current, 8–14 d stale, 15–21 d expired, > 21 d hidden.
 * Only current and stale quotes count in the index; the ticker also shows
 * expired ones as "Outdated" and drops hidden ones.
 */
export type QuoteFreshness = "current" | "stale" | "expired" | "hidden";

export interface FuelIndexProduct {
  key: FuelProductKey;
  label: string;
  family: FuelFamily;
  sulphurClass: SulphurClass;
  /** Mean of live normalised quotes, one per supplier. What the estimator uses. */
  averageUsdMt: number;
  /** Null for members when fewer than 3 suppliers quote (cohortSuppressed). */
  minUsdMt: number | null;
  medianUsdMt: number | null;
  maxUsdMt: number | null;
  quoteCount: number;
  /** True when min/median/max are withheld to protect a small cohort (< 3). */
  cohortSuppressed: boolean;
  /** Freshness of the newest counted quote (expired quotes never count). */
  freshness: Extract<QuoteFreshness, "current" | "stale">;
  /** Newest counted quote, floored to the hour. */
  latestQuoteAt: string;
  /** True when barge fee + mandatory charges are folded into the per-MT price. */
  normalised: boolean;
}

export interface FuelPriceIndex {
  asOf: string;
  /** The port actually used (C2O-033): set only when scope is 'port'. */
  port: string | null;
  /** The port the caller asked for, normalised; null when none was given. */
  requestedPort: string | null;
  scope: FuelIndexScope;
  /** The trading zone aggregated, for scope 'region' only. */
  region: string | null;
  /** Sorted ports whose quotes were counted (never a supplier identity). */
  contributingPorts: string[];
  /** Stem (MT) the fixed delivery charges were spread over. */
  stemMt: number;
  products: FuelIndexProduct[];
  /** Indicators; null when either side has no live quote. */
  spreads: { hsfoVlsfo: number | null; vlsfoLsmgo: number | null };
  /** Requested (or core) products with no live quote anywhere in scope. */
  noOffer: FuelProductKey[];
}

export interface FuelPriceIndexParams {
  /** null or absent = no port (global); the Voyage seam passes null (PR-02). */
  portLocode?: string | null;
  productKeys?: FuelProductKey[];
  asOf?: string;
  /** Stem in MT for normalising fixed charges; the database defaults to 500. */
  stemMt?: number;
}

// ── Ticker strip (B-owned, not a cross-stream contract) ─────────────────────

export type PriceDirection = "up" | "down" | "flat";

export interface BunkerTickerPrice {
  productKey: FuelProductKey;
  label: string;
  usdMt: number;
  /** Versus this sponsor's previous quote for the same port and product. */
  direction: PriceDirection;
}

/** A sponsoring supplier's own published prices. Its name is their exposure. */
export interface BunkerTickerSponsor {
  name: string;
  url: string | null;
  /** One row per sponsor and port: prices differ by port. */
  port: string;
  portLocode: string;
  freshness: Exclude<QuoteFreshness, "hidden">;
  ageDays: number;
  latestQuoteAt: string;
  prices: BunkerTickerPrice[];
}

export interface BunkerTicker {
  asOf: string;
  sponsors: BunkerTickerSponsor[];
}

// ── B→S snapshot (frozen by the architect, C2O-033 item 3) ─────────────────

export interface FuelIndexSnapshotProduct {
  key: FuelProductKey;
  /** Exact ISO grade / CO2 variant when governed; out of v1 scope. */
  variant?: string;
  averageUsdMt: number;
  freshness: Extract<QuoteFreshness, "current" | "stale">;
  validUntil?: string;
  latestQuoteAt: string;
}

/**
 * Immutable, hashed view of the index for the Voyage estimator (C2O-033 item 3,
 * ruling O2B-007). `status` describes provenance: `trusted` whenever the
 * governed index answered for at least one requested product, `unavailable`
 * when it answered for none or is not deployed. Completeness is per product:
 * live products are in `products`, every requested key without a live cohort
 * is in `noOffer`, and no price is ever invented for it. `manual` is produced
 * by Stream S only, never by this module.
 */
export interface FuelIndexSnapshot {
  kind: "fuel_index";
  status: "trusted" | "unavailable" | "manual";
  algorithmVersion: string;
  asOf: string;
  requestedPort: string | null;
  scope: FuelIndexScope | null;
  actualPort: string | null;
  region: string | null;
  contributingPorts: string[];
  stemMt: number | null;
  products: FuelIndexSnapshotProduct[];
  noOffer: FuelProductKey[];
  warnings: string[];
  /** Manual snapshots only (Stream S). */
  manual?: { actorUserId: string; reason: string; at: string };
  /** SHA-256 (hex) of the sorted-key JSON of every other field. */
  canonicalSha256: string;
}

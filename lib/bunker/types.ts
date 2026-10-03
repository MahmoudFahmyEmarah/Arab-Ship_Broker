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
  minUsdMt: number;
  medianUsdMt: number;
  maxUsdMt: number;
  quoteCount: number;
  /** Freshness of the newest counted quote (expired quotes never count). */
  freshness: Extract<QuoteFreshness, "current" | "stale">;
  latestQuoteAt: string;
  /** True when barge fee + mandatory charges are folded into the per-MT price. */
  normalised: boolean;
}

export interface FuelPriceIndex {
  asOf: string;
  /** The port actually used: the requested one, else the fallback's reference. */
  port: string | null;
  scope: FuelIndexScope;
  products: FuelIndexProduct[];
  /** Indicators; null when either side has no live quote. */
  spreads: { hsfoVlsfo: number | null; vlsfoLsmgo: number | null };
  /** Requested (or core) products with no live quote anywhere in scope. */
  noOffer: FuelProductKey[];
}

export interface FuelPriceIndexParams {
  portLocode?: string;
  productKeys?: FuelProductKey[];
  asOf?: string;
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
  /** Display names of the ports quoted on this row. */
  ports: string[];
  freshness: Exclude<QuoteFreshness, "hidden">;
  ageDays: number;
  latestQuoteAt: string;
  prices: BunkerTickerPrice[];
}

export interface BunkerTicker {
  asOf: string;
  sponsors: BunkerTickerSponsor[];
}

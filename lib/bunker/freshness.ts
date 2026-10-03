// Pure Fuel Bar arithmetic shared by the UI and scripts/bunker-check.ts.
// Mirrors fn_bunker_freshness / fn_bunker_normalised_price in
// supabase/migrations/20261003102000_bunker_reads.sql.
import type { QuoteFreshness } from "./types";

export const DAY_MS = 86_400_000;

/** Quotes older than this never count in the index. */
export const INDEX_MAX_AGE_DAYS = 14;

/** ≤ 7 d current, ≤ 14 d stale, ≤ 21 d expired, beyond that hidden. */
export function freshnessFromAgeMs(ageMs: number): QuoteFreshness {
  if (ageMs <= 7 * DAY_MS) return "current";
  if (ageMs <= 14 * DAY_MS) return "stale";
  if (ageMs <= 21 * DAY_MS) return "expired";
  return "hidden";
}

/** Stem the index normalises fixed charges over unless the caller asks otherwise. */
export const DEFAULT_STEM_MT = 500;

export interface QuoteCharges {
  price: number;
  /** Fixed per delivery. */
  bargeFeeUsd: number;
  /** Fixed per delivery. */
  mandatoryChargesUsd: number;
  /** Smallest stem the price applies to; null = any. */
  minQtyMt: number | null;
}

/** Price per MT with the fixed delivery charges spread over the stem. */
export function normalisedPrice(q: QuoteCharges, stemMt: number = DEFAULT_STEM_MT): number {
  if (!(stemMt > 0)) throw new Error("stem must be positive");
  return q.price + ((q.bargeFeeUsd || 0) + (q.mandatoryChargesUsd || 0)) / stemMt;
}

/** A quote only applies to stems at or above its minimum quantity. */
export function appliesToStem(q: QuoteCharges, stemMt: number = DEFAULT_STEM_MT): boolean {
  return (q.minQtyMt ?? 0) <= stemMt;
}

/** ISO timestamp floored to the hour (latestQuoteAt disclosure, plan r2.1 §2). */
export function hourBucketIso(ms: number): string {
  return new Date(Math.floor(ms / 3_600_000) * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Postgres round(numeric, 2): half away from zero. */
export function round2(n: number): number {
  const s = Math.sign(n);
  return (s * Math.round(Math.abs(n) * 100 + 1e-9)) / 100;
}

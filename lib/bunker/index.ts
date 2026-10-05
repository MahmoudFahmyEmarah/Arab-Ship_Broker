// Pure mirror of public.get_fuel_price_index (plan r2 §4.1). The database is
// the source of truth for members; this exists so scripts/bunker-check.ts can
// prove the rules without a database and so the SQL suite can be checked
// against the same expectations.
import {
  appliesToStem, DAY_MS, DEFAULT_STEM_MT, hourBucketIso, INDEX_MAX_AGE_DAYS, normalisedPrice, round2,
  type QuoteCharges,
} from "./freshness";
import type {
  FuelIndexProduct,
  FuelIndexScope,
  FuelPriceIndex,
  FuelProductKey,
  FuelFamily,
  SulphurClass,
} from "./types";

export interface IndexProductDef {
  key: FuelProductKey;
  label: string;
  family: FuelFamily;
  sulphurClass: SulphurClass;
  coreSlot: boolean;
  ecaSlot: boolean;
  sortOrder: number;
}

export interface IndexPortDef {
  locode: string;
  zone: string;
  eca: boolean;
}

export interface IndexQuote extends QuoteCharges {
  supplierId: string;
  supplierEnabled: boolean;
  /** The supplier still serves this port (bunker_supplier_ports, 109000). */
  supplierServesPort: boolean;
  portLocode: string;
  productKey: FuelProductKey;
  status: "submitted" | "approved" | "rejected" | "withdrawn";
  validFrom: string;
  validUntil: string;
  submittedAt: string;
  supersededAt: string | null;
}

export class FuelIndexInputError extends Error {}

/** Below this many suppliers, members see the average but no spread of prices. */
export const MIN_COHORT = 3;

interface LiveQuote {
  supplierId: string;
  portLocode: string;
  zone: string;
  productKey: FuelProductKey;
  normalised: number;
  submittedMs: number;
  /** When the price took effect: max(submitted, validFrom) (109000). */
  effectiveMs: number;
}

const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

function liveQuotes(
  quotes: IndexQuote[], ports: Map<string, IndexPortDef>, asOfMs: number, stemMt: number,
): LiveQuote[] {
  const latest = new Map<string, LiveQuote>();
  for (const q of quotes) {
    const submitted = Date.parse(q.submittedAt);
    const effective = Math.max(submitted, Date.parse(q.validFrom));
    const port = ports.get(q.portLocode);
    if (!q.supplierEnabled || !q.supplierServesPort || !port || q.status !== "approved" || !appliesToStem(q, stemMt)) continue;
    if (submitted > asOfMs || effective < asOfMs - INDEX_MAX_AGE_DAYS * DAY_MS) continue;
    if (Date.parse(q.validFrom) > asOfMs || Date.parse(q.validUntil) < asOfMs) continue;
    if (q.supersededAt && Date.parse(q.supersededAt) <= asOfMs) continue;
    const k = `${q.supplierId}|${q.portLocode}|${q.productKey}`;
    const prev = latest.get(k);
    if (prev && prev.submittedMs >= submitted) continue;
    latest.set(k, {
      supplierId: q.supplierId, portLocode: q.portLocode, zone: port.zone,
      productKey: q.productKey, normalised: normalisedPrice(q, stemMt), submittedMs: submitted,
      effectiveMs: effective,
    });
  }
  return [...latest.values()];
}

function median(sorted: number[]): number {
  const n = sorted.length;
  return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

export function computeFuelPriceIndex(
  input: {
    products: IndexProductDef[];
    ports: IndexPortDef[];
    quotes: IndexQuote[];
  },
  params: {
    portLocode?: string | null;
    productKeys?: string[] | null;
    asOf: string;
    stemMt?: number;
    /** Members get small-cohort suppression (O2B-003); admins see everything. */
    viewer?: "member" | "admin";
  },
): FuelPriceIndex {
  const fullStats = params.viewer === "admin";
  const stemMt = params.stemMt ?? DEFAULT_STEM_MT;
  if (!(stemMt > 0 && stemMt <= 100_000)) {
    throw new FuelIndexInputError("BUNKER_STEM: stem must be between 0 and 100000 MT");
  }
  const asOfMs = Date.parse(params.asOf);
  const products = [...input.products].sort((a, b) => a.sortOrder - b.sortOrder);
  const byKey = new Map(products.map((p) => [p.key as string, p]));
  const ports = new Map(input.ports.map((p) => [p.locode, p]));

  if (params.productKeys && params.productKeys.length === 0) {
    throw new FuelIndexInputError("BUNKER_PRODUCT: the product list is empty; pass null for the default products");
  }
  for (const k of params.productKeys ?? []) {
    if (!byKey.has(k)) throw new FuelIndexInputError(`BUNKER_PRODUCT: unknown fuel product ${k}`);
  }
  const portCode = params.portLocode?.trim().toUpperCase() || null;
  const port = portCode ? ports.get(portCode) : undefined;
  if (portCode && !port) throw new FuelIndexInputError(`BUNKER_PORT: unknown port ${portCode}`);

  const requested = params.productKeys ?? products.map((p) => p.key);
  const expected = params.productKeys
    ?? products.filter((p) => p.coreSlot || (p.ecaSlot && !!port?.eca)).map((p) => p.key);

  const live = liveQuotes(input.quotes, ports, asOfMs, stemMt).filter((l) => requested.includes(l.productKey));

  let scope: FuelIndexScope = "global";
  if (port && live.some((l) => l.portLocode === port.locode)) scope = "port";
  else if (port && port.zone !== "Unknown" && live.some((l) => l.zone === port.zone)) scope = "region";

  const inScope = live.filter((l) =>
    scope === "port" ? l.portLocode === port!.locode : scope === "region" ? l.zone === port!.zone : true);

  // One quote per supplier and product: the latest submitted wins
  // (ties broken by port code, as in the SQL).
  const perSupplier = new Map<string, LiveQuote>();
  for (const l of inScope) {
    const k = `${l.supplierId}|${l.productKey}`;
    const prev = perSupplier.get(k);
    if (!prev || l.submittedMs > prev.submittedMs
        || (l.submittedMs === prev.submittedMs && l.portLocode < prev.portLocode)) {
      perSupplier.set(k, l);
    }
  }

  const out: FuelIndexProduct[] = [];
  const avg = new Map<string, number>();
  for (const p of products) {
    const rows = [...perSupplier.values()].filter((l) => l.productKey === p.key);
    if (!rows.length) continue;
    const prices = rows.map((r) => r.normalised).sort((a, b) => a - b);
    const mean = round2(prices.reduce((s, x) => s + x, 0) / prices.length);
    if (!(mean > 0)) continue; // never zero
    const latest = Math.max(...rows.map((r) => r.effectiveMs));
    avg.set(p.key, mean);
    const show = fullStats || rows.length >= MIN_COHORT;
    out.push({
      key: p.key, label: p.label, family: p.family, sulphurClass: p.sulphurClass,
      averageUsdMt: mean,
      minUsdMt: show ? round2(prices[0]) : null,
      medianUsdMt: show ? round2(median(prices)) : null,
      maxUsdMt: show ? round2(prices[prices.length - 1]) : null,
      quoteCount: rows.length,
      cohortSuppressed: !show,
      freshness: asOfMs - latest <= 7 * DAY_MS ? "current" : "stale",
      latestQuoteAt: hourBucketIso(latest),
      normalised: true,
    });
  }

  const spread = (a: string, b: string) =>
    avg.has(a) && avg.has(b) ? round2(avg.get(a)! - avg.get(b)!) : null;

  const contributingPorts = [...new Set([...perSupplier.values()].map((l) => l.portLocode))].sort();

  return {
    asOf: iso(asOfMs),
    port: scope === "port" ? portCode : null,
    requestedPort: portCode,
    scope,
    region: scope === "region" ? port!.zone : null,
    contributingPorts,
    stemMt,
    products: out,
    spreads: { hsfoVlsfo: spread("HSFO380", "VLSFO"), vlsfoLsmgo: spread("LSMGO", "VLSFO") },
    noOffer: products
      .filter((p) => expected.includes(p.key) && !avg.has(p.key))
      .map((p) => p.key),
  };
}

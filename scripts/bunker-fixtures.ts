// Shared Fuel Bar fixtures. scripts/bunker-check.ts runs them through the pure
// mirror (lib/bunker/index.ts); scripts/bunker-sql-suite.ts loads the same
// rows into a database and asserts get_fuel_price_index returns the same JSON.
import type { IndexPortDef, IndexProductDef, IndexQuote } from "../lib/bunker/index";
import type { FuelPriceIndex } from "../lib/bunker/types";

export const AS_OF = "2026-10-03T12:00:00Z";
const H = 3_600_000;
export const at = (hours: number) =>
  new Date(Date.parse(AS_OF) + Math.round(hours * H)).toISOString().replace(/\.\d{3}Z$/, "Z");

// Mirrors the 20261003100000 seed.
export const PRODUCTS: IndexProductDef[] = [
  { key: "HSFO380", label: "HSFO 380", family: "residual",   sulphurClass: "HS",  coreSlot: true,  ecaSlot: false, sortOrder: 10 },
  { key: "VLSFO",   label: "VLSFO",    family: "residual",   sulphurClass: "VLS", coreSlot: true,  ecaSlot: false, sortOrder: 20 },
  { key: "ULSFO",   label: "ULSFO",    family: "residual",   sulphurClass: "ULS", coreSlot: false, ecaSlot: true,  sortOrder: 30 },
  { key: "LSMGO",   label: "LSMGO",    family: "distillate", sulphurClass: "ULS", coreSlot: true,  ecaSlot: false, sortOrder: 40 },
  { key: "MGO05",   label: "MGO 0.5%", family: "distillate", sulphurClass: "VLS", coreSlot: false, ecaSlot: false, sortOrder: 50 },
  { key: "MDO",     label: "MDO",      family: "distillate", sulphurClass: "VLS", coreSlot: false, ecaSlot: false, sortOrder: 60 },
];

// Real reference ports present in every rebuilt database (baseline 20).
export const PORTS: IndexPortDef[] = [
  { locode: "GRPIR", zone: "E.MED", eca: false },
  { locode: "CYLCA", zone: "E.MED", eca: false },
  { locode: "TRMER", zone: "E.MED", eca: true },   // flagged ECA in the fixture only
  { locode: "NLRTM", zone: "NCONT", eca: false },
  { locode: "SAJED", zone: "R.SEA", eca: false },
  { locode: "ARROS", zone: "Unknown", eca: false },
];

export const SUPPLIERS = [
  { id: "00000000-0000-4000-b000-00000000000a", name: "src:bunker-e2e A", enabled: true,  platform: false },
  { id: "00000000-0000-4000-b000-00000000000b", name: "src:bunker-e2e B", enabled: true,  platform: false },
  { id: "00000000-0000-4000-b000-00000000000c", name: "src:bunker-e2e C", enabled: true,  platform: false },
  { id: "00000000-0000-4000-b000-00000000000d", name: "src:bunker-e2e D", enabled: false, platform: false },
  { id: "00000000-0000-4000-b000-0000000000ff", name: "src:bunker-e2e Platform", enabled: true, platform: true },
] as const;
const [A, B, C, D, P] = SUPPLIERS.map((s) => s.id);

type Q = Omit<IndexQuote, "supplierEnabled" | "supplierServesPort"> & { id: string; note: string };
const q = (
  id: string, note: string, supplierId: string, portLocode: string, productKey: IndexQuote["productKey"],
  price: number, submittedH: number, validFromH: number, validUntilH: number,
  extra: Partial<Pick<IndexQuote, "bargeFeeUsd" | "mandatoryChargesUsd" | "minQtyMt" | "supersededAt" | "status">> = {},
): Q => ({
  id, note, supplierId, portLocode, productKey, price, status: "approved",
  bargeFeeUsd: 0, mandatoryChargesUsd: 0, minQtyMt: null, supersededAt: null,
  submittedAt: at(submittedH), validFrom: at(validFromH), validUntil: at(validUntilH), ...extra,
});

export const QUOTES: Q[] = [
  q("00000000-0000-4000-c000-000000000000", "superseded before as_of", A, "GRPIR", "VLSFO", 580, -72, -72, 240, { supersededAt: at(-24) }),
  q("00000000-0000-4000-c000-000000000001", "fees over a 500 MT stem: 600 + 2500/500 = 605", A, "GRPIR", "VLSFO", 600, -24, -24, 312,
    { bargeFeeUsd: 2000, mandatoryChargesUsd: 500, minQtyMt: 300 }),
  q("00000000-0000-4000-c000-000000000002", "barge fee only: 612 + 1500/500 = 615", B, "GRPIR", "VLSFO", 612, -48, -48, 240,
    { bargeFeeUsd: 1500 }),
  q("00000000-0000-4000-c000-000000000003", "10 days old: counts, stale age", C, "GRPIR", "VLSFO", 640, -240, -240, 96),
  q("00000000-0000-4000-c000-000000000004", "disabled supplier: never counts", D, "GRPIR", "VLSFO", 500, -12, -12, 240),
  q("00000000-0000-4000-c000-000000000005", "15 days old: never counts", A, "GRPIR", "LSMGO", 820, -360, -360, 240),
  q("00000000-0000-4000-c000-000000000006", "validity lapsed an hour ago", B, "GRPIR", "LSMGO", 815, -48, -48, -1),
  q("00000000-0000-4000-c000-000000000007", "single HSFO quote", B, "GRPIR", "HSFO380", 520, -48, -48, 240),
  q("00000000-0000-4000-c000-000000000008", "region LSMGO", C, "CYLCA", "LSMGO", 800, -72, -72, 240),
  q("00000000-0000-4000-c000-000000000009", "A's newest VLSFO, other zone; 00:25 buckets to 00:00", A, "NLRTM", "VLSFO", 700, -12 + 25 / 60, -12, 240),
  q("00000000-0000-4000-c000-00000000000a", "valid only from tomorrow", C, "TRMER", "VLSFO", 590, -1, 24, 240),
  q("00000000-0000-4000-c000-00000000000b", "platform (manual) input counts", P, "NLRTM", "LSMGO", 900, -24, -24, 240),
  q("00000000-0000-4000-c000-00000000000c", "min stem 1000 MT: only in a 1000 MT index", P, "GRPIR", "VLSFO", 630, -6, -6, 240,
    { minQtyMt: 1000 }),
  q("00000000-0000-4000-c000-00000000000d", "awaiting approval: never counts", B, "GRPIR", "HSFO380", 400, -1, -1, 240,
    { status: "submitted" }),
  q("00000000-0000-4000-c000-00000000000e", "rejected: never counts", C, "GRPIR", "HSFO380", 300, -2, -2, 240,
    { status: "rejected" }),
];

export const indexQuotes = (): IndexQuote[] =>
  QUOTES.map((x) => ({ ...x, supplierEnabled: SUPPLIERS.find((s) => s.id === x.supplierId)!.enabled, supplierServesPort: true }));

// Every (supplier, port) pair quoted above is a registered supplier port (109000).
export const SUPPLIER_PORTS: { supplierId: string; portLocode: string }[] = [
  ...new Map(QUOTES.map((x) => [`${x.supplierId}|${x.portLocode}`, { supplierId: x.supplierId, portLocode: x.portLocode }])).values(),
];

export interface IndexCase {
  id: string;
  title: string;
  params: { portLocode?: string; productKeys?: string[]; asOf: string; stemMt?: number; viewer: "member" | "admin" };
  expected: FuelPriceIndex | { error: string };
}

const vlsfoGrpir = {
  key: "VLSFO", label: "VLSFO", family: "residual", sulphurClass: "VLS",
  averageUsdMt: 620, minUsdMt: 605, medianUsdMt: 615, maxUsdMt: 640,
  quoteCount: 3, cohortSuppressed: false, freshness: "current", latestQuoteAt: at(-24), normalised: true,
} as const;
const hsfo = (suppressed: boolean) => ({
  key: "HSFO380", label: "HSFO 380", family: "residual", sulphurClass: "HS",
  averageUsdMt: 520, minUsdMt: suppressed ? null : 520, medianUsdMt: suppressed ? null : 520,
  maxUsdMt: suppressed ? null : 520, quoteCount: 1, cohortSuppressed: suppressed,
  freshness: "current", latestQuoteAt: at(-48), normalised: true,
} as const);
const globalProducts = [
  hsfo(true),
  { key: "VLSFO", label: "VLSFO", family: "residual", sulphurClass: "VLS",
    averageUsdMt: 651.67, minUsdMt: 615, medianUsdMt: 640, maxUsdMt: 700,
    quoteCount: 3, cohortSuppressed: false, freshness: "current", latestQuoteAt: at(-12), normalised: true },
  { key: "LSMGO", label: "LSMGO", family: "distillate", sulphurClass: "ULS",
    averageUsdMt: 850, minUsdMt: null, medianUsdMt: null, maxUsdMt: null,
    quoteCount: 2, cohortSuppressed: true, freshness: "current", latestQuoteAt: at(-24), normalised: true },
] as const;

export const INDEX_CASES: IndexCase[] = [
  {
    id: "I1", title: "port scope: best of three normalised, stale quote counts, expired/old/disabled/superseded do not",
    params: { portLocode: "GRPIR", asOf: AS_OF, viewer: "member" },
    expected: {
      asOf: AS_OF, port: "GRPIR", scope: "port", stemMt: 500, requestedPort: "GRPIR", region: null, contributingPorts: ["GRPIR"],
      products: [hsfo(true), vlsfoGrpir],
      spreads: { hsfoVlsfo: -100, vlsfoLsmgo: null },
      noOffer: ["LSMGO"],
    },
  },
  {
    id: "I2", title: "admins see full stats below the cohort threshold",
    params: { portLocode: "grpir ", asOf: AS_OF, viewer: "admin" },
    expected: {
      asOf: AS_OF, port: "GRPIR", scope: "port", stemMt: 500, requestedPort: "GRPIR", region: null, contributingPorts: ["GRPIR"],
      products: [hsfo(false), vlsfoGrpir],
      spreads: { hsfoVlsfo: -100, vlsfoLsmgo: null },
      noOffer: ["LSMGO"],
    },
  },
  {
    id: "I3", title: "region fallback (future-dated port quote ignored); ECA port expects ULSFO",
    params: { portLocode: "TRMER", asOf: AS_OF, viewer: "member" },
    expected: {
      asOf: AS_OF, port: null, scope: "region", stemMt: 500, requestedPort: "TRMER", region: "E.MED", contributingPorts: ["CYLCA", "GRPIR"],
      products: [
        hsfo(true), vlsfoGrpir,
        { key: "LSMGO", label: "LSMGO", family: "distillate", sulphurClass: "ULS",
          averageUsdMt: 800, minUsdMt: null, medianUsdMt: null, maxUsdMt: null,
          quoteCount: 1, cohortSuppressed: true, freshness: "current", latestQuoteAt: at(-72), normalised: true },
      ],
      spreads: { hsfoVlsfo: -100, vlsfoLsmgo: 180 },
      noOffer: ["ULSFO"],
    },
  },
  {
    id: "I4", title: "global fallback: one quote per supplier, the latest wins across ports",
    params: { portLocode: "SAJED", asOf: AS_OF, viewer: "member" },
    expected: {
      asOf: AS_OF, port: null, scope: "global", stemMt: 500, requestedPort: "SAJED", region: null, contributingPorts: ["CYLCA", "GRPIR", "NLRTM"], products: [...globalProducts],
      spreads: { hsfoVlsfo: -131.67, vlsfoLsmgo: 198.33 }, noOffer: [],
    },
  },
  {
    id: "I5", title: "zone Unknown skips the region step",
    params: { portLocode: "ARROS", asOf: AS_OF, viewer: "member" },
    expected: {
      asOf: AS_OF, port: null, scope: "global", stemMt: 500, requestedPort: "ARROS", region: null, contributingPorts: ["CYLCA", "GRPIR", "NLRTM"], products: [...globalProducts],
      spreads: { hsfoVlsfo: -131.67, vlsfoLsmgo: 198.33 }, noOffer: [],
    },
  },
  {
    id: "I6", title: "no live quote anywhere: noOffer, never zero",
    params: { portLocode: "GRPIR", productKeys: ["ULSFO"], asOf: AS_OF, viewer: "member" },
    expected: {
      asOf: AS_OF, port: null, scope: "global", stemMt: 500, requestedPort: "GRPIR", region: null, contributingPorts: [], products: [],
      spreads: { hsfoVlsfo: null, vlsfoLsmgo: null }, noOffer: ["ULSFO"],
    },
  },
  {
    id: "I7", title: "5 days later: the 10-day quote is now 15 days old and drops out",
    params: { portLocode: "GRPIR", productKeys: ["VLSFO"], asOf: at(120), viewer: "member" },
    expected: {
      asOf: at(120), port: "GRPIR", scope: "port", stemMt: 500, requestedPort: "GRPIR", region: null, contributingPorts: ["GRPIR"],
      products: [{ key: "VLSFO", label: "VLSFO", family: "residual", sulphurClass: "VLS",
        averageUsdMt: 610, minUsdMt: null, medianUsdMt: null, maxUsdMt: null,
        quoteCount: 2, cohortSuppressed: true, freshness: "current", latestQuoteAt: at(-24), normalised: true }],
      spreads: { hsfoVlsfo: null, vlsfoLsmgo: null }, noOffer: [],
    },
  },
  {
    id: "I8", title: "9 days later: newest counted quote is 10 days old, so the product is stale",
    params: { portLocode: "GRPIR", productKeys: ["VLSFO"], asOf: at(216), viewer: "member" },
    expected: {
      asOf: at(216), port: "GRPIR", scope: "port", stemMt: 500, requestedPort: "GRPIR", region: null, contributingPorts: ["GRPIR"],
      products: [{ key: "VLSFO", label: "VLSFO", family: "residual", sulphurClass: "VLS",
        averageUsdMt: 610, minUsdMt: null, medianUsdMt: null, maxUsdMt: null,
        quoteCount: 2, cohortSuppressed: true, freshness: "stale", latestQuoteAt: at(-24), normalised: true }],
      spreads: { hsfoVlsfo: null, vlsfoLsmgo: null }, noOffer: [],
    },
  },
  {
    id: "I11", title: "a 1000 MT stem spreads fees thinner and admits the 1000 MT minimum quote",
    params: { portLocode: "GRPIR", productKeys: ["VLSFO"], asOf: AS_OF, stemMt: 1000, viewer: "member" },
    expected: {
      asOf: AS_OF, port: "GRPIR", scope: "port", stemMt: 1000, requestedPort: "GRPIR", region: null, contributingPorts: ["GRPIR"],
      products: [{ key: "VLSFO", label: "VLSFO", family: "residual", sulphurClass: "VLS",
        averageUsdMt: 621.5, minUsdMt: 602.5, medianUsdMt: 621.75, maxUsdMt: 640,
        quoteCount: 4, cohortSuppressed: false, freshness: "current", latestQuoteAt: at(-6), normalised: true }],
      spreads: { hsfoVlsfo: null, vlsfoLsmgo: null }, noOffer: [],
    },
  },
  { id: "I12", title: "a non-positive stem is refused", params: { portLocode: "GRPIR", asOf: AS_OF, stemMt: 0, viewer: "member" },
    expected: { error: "BUNKER_STEM" } },
  { id: "I13", title: "an empty product list is refused", params: { portLocode: "GRPIR", productKeys: [], asOf: AS_OF, viewer: "member" },
    expected: { error: "BUNKER_PRODUCT" } },
  { id: "I9", title: "unknown port is refused", params: { portLocode: "XXXXX", asOf: AS_OF, viewer: "member" },
    expected: { error: "BUNKER_PORT" } },
  { id: "I10", title: "unknown product is refused", params: { productKeys: ["FOO"], asOf: AS_OF, viewer: "member" },
    expected: { error: "BUNKER_PRODUCT" } },
];

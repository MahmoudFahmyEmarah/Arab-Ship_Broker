import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type {
  BunkerTicker,
  FuelIndexSnapshot,
  FuelPriceIndex,
  FuelPriceIndexParams,
  FuelProductKey,
} from "@/lib/bunker/types";

export type {
  BunkerTicker,
  BunkerTickerPrice,
  BunkerTickerSponsor,
  FuelFamily,
  FuelIndexProduct,
  FuelIndexScope,
  FuelIndexSnapshot,
  FuelIndexSnapshotProduct,
  FuelPriceIndex,
  FuelPriceIndexParams,
  FuelProductKey,
  PriceDirection,
  QuoteFreshness,
  SulphurClass,
} from "@/lib/bunker/types";

// Fuel Bar reads. This is the only bunker module other streams import.
// Every RPC answer is parsed at runtime: a payload that does not match the
// contract throws BunkerContractError instead of reaching a calculation.

/** The RPC is not on this database yet (migration not applied). */
export class BunkerNotDeployedError extends Error {
  constructor(rpc: string) {
    super(`${rpc} is not deployed on this database`);
    this.name = "BunkerNotDeployedError";
  }
}

/** The RPC answered something that is not the published contract. */
export class BunkerContractError extends Error {
  constructor(rpc: string, detail: string) {
    super(`${rpc} returned an unexpected shape: ${detail}`);
    this.name = "BunkerContractError";
  }
}

const productKey = z.enum(["HSFO380", "VLSFO", "ULSFO", "LSMGO", "MGO05", "MDO"]);
const price = z.number().positive().finite();
const isoUtc = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);

const indexSchema = z.object({
  asOf: isoUtc,
  port: z.string().nullable(),
  requestedPort: z.string().nullable(),
  scope: z.enum(["port", "region", "global"]),
  region: z.string().nullable(),
  contributingPorts: z.array(z.string()),
  stemMt: price,
  products: z.array(z.object({
    key: productKey,
    label: z.string(),
    family: z.enum(["residual", "distillate"]),
    sulphurClass: z.enum(["HS", "VLS", "ULS"]),
    averageUsdMt: price,
    minUsdMt: price.nullable(),
    medianUsdMt: price.nullable(),
    maxUsdMt: price.nullable(),
    quoteCount: z.number().int().positive(),
    cohortSuppressed: z.boolean(),
    freshness: z.enum(["current", "stale"]),
    latestQuoteAt: isoUtc,
    normalised: z.boolean(),
  })),
  spreads: z.object({ hsfoVlsfo: z.number().nullable(), vlsfoLsmgo: z.number().nullable() }),
  noOffer: z.array(productKey),
});

const tickerSchema = z.object({
  asOf: isoUtc,
  sponsors: z.array(z.object({
    name: z.string(),
    url: z.string().nullable(),
    port: z.string(),
    portLocode: z.string(),
    freshness: z.enum(["current", "stale", "expired"]),
    ageDays: z.number().int().nonnegative(),
    latestQuoteAt: isoUtc,
    prices: z.array(z.object({
      productKey,
      label: z.string(),
      usdMt: price,
      direction: z.enum(["up", "down", "flat"]),
    })).min(1),
  })),
});

const portFlagsSchema = z.array(z.object({
  locode: z.string(),
  ecaZone: z.string().nullable(),
  euBerthRule: z.boolean(),
  openLoopBan: z.boolean(),
}));
export type BunkerPortFlags = z.infer<typeof portFlagsSchema>[number];

// PostgREST answers PGRST202 for an unknown function; Postgres 42883 if it
// is called directly with a signature that does not exist.
function isMissingRpc(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

function parse<T>(rpc: string, schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    throw new BunkerContractError(rpc, issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid");
  }
  return r.data;
}

/**
 * The platform fuel index (§4.1). `productKeys` omitted = the default slots;
 * an empty list is a caller error. `stemMt` must be a positive number when given.
 */
export async function getFuelPriceIndex(
  supabase: SupabaseClient,
  params: FuelPriceIndexParams = {},
): Promise<FuelPriceIndex> {
  if (params.productKeys && params.productKeys.length === 0) {
    throw new RangeError("productKeys is empty; omit it for the default products");
  }
  if (params.stemMt !== undefined && !(Number.isFinite(params.stemMt) && params.stemMt > 0)) {
    throw new RangeError("stemMt must be a positive number of tonnes");
  }
  const { data, error } = await supabase.rpc("get_fuel_price_index", {
    p_port_locode: params.portLocode ?? null,
    p_product_keys: params.productKeys ?? null,
    ...(params.asOf ? { p_as_of: params.asOf } : {}),
    ...(params.stemMt !== undefined ? { p_stem_mt: params.stemMt } : {}),
  });
  if (isMissingRpc(error)) throw new BunkerNotDeployedError("get_fuel_price_index");
  if (error) throw new Error(`get_fuel_price_index failed: ${error.message}`);
  return parse("get_fuel_price_index", indexSchema, data);
}

export async function getBunkerTicker(supabase: SupabaseClient): Promise<BunkerTicker> {
  const { data, error } = await supabase.rpc("get_bunker_ticker");
  if (isMissingRpc(error)) throw new BunkerNotDeployedError("get_bunker_ticker");
  if (error) throw new Error(`get_bunker_ticker failed: ${error.message}`);
  return parse("get_bunker_ticker", tickerSchema, data);
}

/** ECA / EU-berth / open-loop facts for the given ports (all flagged ports when omitted). */
export async function getBunkerPortFlags(supabase: SupabaseClient, locodes?: string[]): Promise<BunkerPortFlags[]> {
  const { data, error } = await supabase.rpc("get_bunker_port_flags", { p_locodes: locodes ?? null });
  if (isMissingRpc(error)) throw new BunkerNotDeployedError("get_bunker_port_flags");
  if (error) throw new Error(`get_bunker_port_flags failed: ${error.message}`);
  return parse("get_bunker_port_flags", portFlagsSchema, data);
}

// ── B→S snapshot (C2O-033 item 3, frozen) ───────────────────────────────────

export const FUEL_INDEX_ALGORITHM = "bunker-index/1";

/**
 * Sorted-key JSON, byte-compatible with Stream S `lib/voyage/snapshots.ts#canonicalJson`
 * (O2B-007): object keys sorted at every level, undefined members skipped
 * (undefined elsewhere becomes null), -0 written as 0, non-finite numbers refused.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normaliseForHash(value));
}

function normaliseForHash(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new RangeError("canonical JSON: non-finite number");
    return Object.is(v, -0) ? 0 : v;
  }
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => normaliseForHash(x));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined) continue;
      out[k] = normaliseForHash(x);
    }
    return out;
  }
  throw new RangeError(`canonical JSON: unsupported ${typeof v}`);
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Hash every field except canonicalSha256 itself. */
export async function sealFuelIndexSnapshot(body: Omit<FuelIndexSnapshot, "canonicalSha256">): Promise<FuelIndexSnapshot> {
  return { ...body, canonicalSha256: await sha256Hex(canonicalJson(body)) };
}

/**
 * The index as an immutable, hashed snapshot for the Voyage estimator. It never
 * invents a price. `trusted` when the index answered for at least one requested
 * product: the live ones are listed and the rest are named in `noOffer` with a
 * warning. `unavailable` (no products) when nothing could be answered or the
 * index is not deployed, malformed or failing. The engine prices `noOffer`
 * keys from its admin fallback and labels them so (ruling D2), never "live".
 */
export async function getFuelIndexSnapshot(
  supabase: SupabaseClient,
  params: FuelPriceIndexParams & { productKeys: FuelProductKey[] },
): Promise<FuelIndexSnapshot> {
  const requestedPort = params.portLocode?.trim().toUpperCase() || null;
  const unavailable = (warning: string, noOffer: FuelProductKey[] = params.productKeys) =>
    sealFuelIndexSnapshot({
      kind: "fuel_index", status: "unavailable", algorithmVersion: FUEL_INDEX_ALGORITHM, asOf: params.asOf ?? new Date().toISOString(),
      requestedPort, scope: null, actualPort: null, region: null, contributingPorts: [],
      stemMt: params.stemMt ?? null, products: [], noOffer, warnings: [warning],
    });

  let index: FuelPriceIndex;
  try {
    index = await getFuelPriceIndex(supabase, params);
  } catch (e) {
    return unavailable(e instanceof BunkerNotDeployedError ? "fuel index not deployed"
      : e instanceof BunkerContractError ? "fuel index returned an unexpected shape"
      : e instanceof RangeError ? `invalid request: ${e.message}` : "fuel index unavailable");
  }

  const live = index.products.filter((p) => params.productKeys.includes(p.key));
  const missing = params.productKeys.filter((k) => !live.some((p) => p.key === k));
  if (live.length === 0) return unavailable(`no current offer for ${missing.join(", ")}`, missing);

  const warnings: string[] = missing.map((k) => `no current offer for ${k}`);
  if (index.scope === "region") warnings.push(`no live quote at ${requestedPort}; averaged over ${index.region}`);
  if (index.scope === "global" && requestedPort) warnings.push(`no live quote at ${requestedPort} or its zone; global average`);
  for (const p of index.products) if (p.freshness === "stale") warnings.push(`${p.key} price is stale (8-14 days)`);

  return sealFuelIndexSnapshot({
    kind: "fuel_index",
    status: "trusted",
    algorithmVersion: FUEL_INDEX_ALGORITHM,
    asOf: index.asOf,
    requestedPort: index.requestedPort,
    scope: index.scope,
    actualPort: index.port,
    region: index.region,
    contributingPorts: index.contributingPorts,
    stemMt: index.stemMt,
    products: live.map((p) => ({
      key: p.key, averageUsdMt: p.averageUsdMt, freshness: p.freshness, latestQuoteAt: p.latestQuoteAt,
    })),
    noOffer: missing,
    warnings,
  });
}

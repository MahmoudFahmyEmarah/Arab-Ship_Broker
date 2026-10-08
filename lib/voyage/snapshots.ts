// Cross-module snapshots stored with an immutable voyage estimate run
// (PLAN-voyage-economics r2 item 3, r2.1 §4; FuelIndexSnapshot frozen by
// C2O-033 item 3 / O2C-025). Each snapshot says where its figures came from
// (trusted | unavailable | manual), carries the versions and as-of that
// produced them, and a SHA-256 of its canonical serialisation so a saved
// estimate can be reproduced and audited after settings change.
// The hashing helpers are server-side (node:crypto); the types are shared.
import { createHash } from "node:crypto";

export type SnapshotStatus = "trusted" | "unavailable" | "manual";

export interface ManualProvenance { actorUserId: string; reason: string; at: string }

/** Frozen B→S contract (C2O-033 item 3). No supplier identity, ever. */
export interface FuelIndexSnapshot {
  kind: "fuel_index";
  status: SnapshotStatus;
  algorithmVersion: string; // e.g. "bunker-index/1"
  asOf: string | null;
  requestedPort: string | null;
  scope: "port" | "region" | "global" | null;
  actualPort: string | null; // null unless scope = port
  region: string | null;
  contributingPorts: string[];
  stemMt: number | null;
  products: { key: string; variant?: string | null; averageUsdMt: number; freshness: "current" | "stale"; validUntil?: string | null; latestQuoteAt: string | null }[];
  noOffer: string[];
  warnings: string[];
  manual?: ManualProvenance;
  canonicalSha256?: string;
}

export interface RouteEcaClassification {
  kind: "route_eca";
  /** fallback = a leg rests on an unverified track */
  status: SnapshotStatus | "fallback";
  asOf: string | null;
  legs: { key: string; pol: string | null; pod: string | null; totalNm: number | null; ecaNm: number | null; method: "waypoints" | "distance_only" | "manual" | "none"; chokepoints?: string[]; reversed?: boolean | null; source?: string | null; verified?: boolean | null; ecaConfidence?: "official" | "coarse" | null; manual?: ManualProvenance }[];
  geometryVersions: { code: string; geometryVersion: string }[];
  algorithmVersion: string; // fn_route_eca_split revision
  warnings: string[];
  canonicalSha256?: string;
}

export interface SuezCostSnapshot {
  kind: "suez_cost";
  /** the canal status the voyage used (fallback = a partial Suez estimate, labelled) */
  status: SnapshotStatus | "fallback";
  /** the Suez estimate's own status (trusted | partial | unavailable | invalid) */
  suezStatus: string | null;
  required: boolean;
  algorithmVersion: string | null;
  tariffVersionNo: number | null;
  tariffSourceRef: string | null;
  sdrRateUsd: number | null;
  sdrAsOf: string | null;
  sdrStatus: string | null;
  appliedUsd: number | null;
  potentialUsd: number | null;
  complete: boolean;
  transitDays: number;
  anchorageDays: number;
  warnings: string[];
  manual?: ManualProvenance;
  /** the transit date the tariff and SDR rate were taken on, and how it was derived */
  transitDate?: string | null;
  transitDateBasis?: string | null;
  /** governed = every Suez fact came from its governed source and the voyage conditions were declared (C2O-050 #1) */
  factsSource?: "governed" | "manual";
  manualFacts?: string[];
  conditionsDeclared?: boolean;
  /** a second transit on the ballast leg, same fields */
  ballastTransit?: Omit<SuezCostSnapshot, "kind" | "canonicalSha256" | "ballastTransit"> | null;
  canonicalSha256?: string;
}

export interface PortCostSnapshot {
  kind: "port_cost";
  /** fallback = a DA taken from a partial PDA estimate */
  status: SnapshotStatus | "fallback";
  load: { port: string | null; usd: number | null; source: "tariff" | "manual" | "none"; estimateId?: string | null; coverage?: string | null; manual?: ManualProvenance };
  disch: { port: string | null; usd: number | null; source: "tariff" | "manual" | "none"; estimateId?: string | null; coverage?: string | null; manual?: ManualProvenance };
  warnings: string[];
  canonicalSha256?: string;
}

export type VoyageSnapshot = FuelIndexSnapshot | RouteEcaClassification | SuezCostSnapshot | PortCostSnapshot;

export { VOYAGE_ALGORITHM_VERSION, ECA_SPLIT_ALGORITHM_VERSION } from "./types";

// Canonical JSON: sorted object keys at every level, no undefined, finite
// numbers only, arrays kept in order. Two equal snapshots hash the same
// regardless of key order or where they were built.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value));
}

function normalise(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("canonicalJson: non-finite number");
    return Object.is(v, -0) ? 0 : v;
  }
  if (typeof v === "string" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => normalise(x));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x === undefined) continue;
      out[k] = normalise(x);
    }
    return out;
  }
  throw new Error(`canonicalJson: unsupported value ${typeof v}`);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

// Returns the snapshot with its hash filled (computed over everything but the hash field).
export function sealSnapshot<T extends { canonicalSha256?: string }>(snapshot: T): T & { canonicalSha256: string } {
  const { canonicalSha256: _ignored, ...rest } = snapshot;
  void _ignored;
  return { ...snapshot, canonicalSha256: sha256Hex(canonicalJson(rest)) } as T & { canonicalSha256: string };
}

export function hashSettings(settings: unknown): string {
  return sha256Hex(canonicalJson(settings));
}

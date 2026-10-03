// Cross-module snapshots stored with an immutable voyage estimate run
// (PLAN-voyage-economics r2 item 3, r2.1 §4). Each snapshot says where its
// figures came from (trusted | unavailable | manual), carries the versions and
// as-of that produced them, and a SHA-256 of its canonical serialisation so a
// saved estimate can be reproduced and audited after settings change.
// Server-side only (node:crypto).
import { createHash } from "node:crypto";

export type SnapshotStatus = "trusted" | "unavailable" | "manual";

export interface ManualProvenance { actorUserId: string; reason: string; at: string }

export interface FuelIndexSnapshot {
  kind: "fuel_index";
  status: SnapshotStatus;
  asOf: string | null;
  port: string | null;
  scope: "port" | "region" | "global" | null;
  products: { key: string; usdMt: number; source: "index" | "fallback" | "manual"; quoteCount?: number | null }[];
  warnings: string[];
  manual?: ManualProvenance;
  hash?: string;
}

export interface RouteEcaClassification {
  kind: "route_eca";
  status: SnapshotStatus;
  legs: { key: string; pol: string | null; pod: string | null; totalNm: number | null; ecaNm: number | null; method: "waypoints" | "distance_only" | "manual" | "none"; chokepoints?: string[] }[];
  geometryVersion: string; // eca_zones snapshot, e.g. "MED@2025-05-01"
  algorithmVersion: string; // fn_route_eca_split revision
  warnings: string[];
  manual?: ManualProvenance;
  hash?: string;
}

export interface SuezCostSnapshot {
  kind: "suez_cost";
  status: SnapshotStatus;
  required: boolean;
  tariffVersionNo: number | null;
  tariffSourceRef: string | null;
  sdrRateUsd: number | null;
  sdrAsOf: string | null;
  appliedUsd: number;
  potentialUsd: number;
  transitDays: number;
  anchorageDays: number;
  warnings: string[];
  manual?: ManualProvenance;
  hash?: string;
}

export interface PortCostSnapshot {
  kind: "port_cost";
  status: SnapshotStatus;
  load: { port: string | null; usd: number | null; source: "tariff" | "manual" | "none"; estimateId?: string | null };
  disch: { port: string | null; usd: number | null; source: "tariff" | "manual" | "none"; estimateId?: string | null };
  warnings: string[];
  manual?: ManualProvenance;
  hash?: string;
}

export type VoyageSnapshot = FuelIndexSnapshot | RouteEcaClassification | SuezCostSnapshot | PortCostSnapshot;

export const VOYAGE_ALGORITHM_VERSION = "voyage-engine/1";
export const SUEZ_ALGORITHM_VERSION = "suez-engine/1";
export const ECA_SPLIT_ALGORITHM_VERSION = "fn_route_eca_split/1";

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

// Returns the snapshot with its hash filled (computed over everything but `hash`).
export function sealSnapshot<T extends { hash?: string }>(snapshot: T): T & { hash: string } {
  const { hash: _ignored, ...rest } = snapshot;
  void _ignored;
  return { ...snapshot, hash: sha256Hex(canonicalJson(rest)) } as T & { hash: string };
}

export function hashSettings(settings: unknown): string {
  return sha256Hex(canonicalJson(settings));
}

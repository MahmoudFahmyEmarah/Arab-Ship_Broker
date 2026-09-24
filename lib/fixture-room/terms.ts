// Fixture Room · the v1 term catalogue (decision D5, 23 Sep 2026).
//
// TypeScript owns the catalogue. create_fixture_room copies these definitions
// into fixture_terms at room creation, so a later change here never alters a
// room that already exists. Hints are built from the listing the room is
// opened on and are display text only: the opening positions are proposals
// the parties make, never something the platform pre-agrees.
//
// The value vocabulary mirrors fn_fixture_validate_value / fn_fixture_display_value
// in supabase/migrations/20260923201000_fixture_room_helpers.sql.
import type { FixtureValue, FixtureValueKind } from "./types";

export const FIXTURE_TERM_CATALOGUE_VERSION = "2026-09-23.v1";

export interface FixtureTermDefinition {
  code: string;
  label: string;
  category: "cargo" | "route" | "timing" | "operations" | "money";
  sortOrder: number;
  valueKind: FixtureValueKind;
  unit?: string;
  required: boolean;
  hint?: string;
}

export const FIXTURE_TERM_CATALOGUE: readonly FixtureTermDefinition[] = [
  { code: "cargo_grade", label: "Cargo & grade", category: "cargo", sortOrder: 1, valueKind: "text", required: true },
  { code: "quantity", label: "Quantity", category: "cargo", sortOrder: 2, valueKind: "number", unit: "MT", required: true },
  { code: "ports", label: "Load / discharge ports", category: "route", sortOrder: 3, valueKind: "port_pair", required: true },
  { code: "laycan", label: "Laycan", category: "timing", sortOrder: 4, valueKind: "date_range", required: true },
  { code: "ld_rates", label: "Load / discharge rates", category: "operations", sortOrder: 5, valueKind: "rate_pair", unit: "MT/day", required: true },
  { code: "freight", label: "Freight & terms", category: "money", sortOrder: 6, valueKind: "money_per_mt", unit: "USD/MT", required: true },
];

/** The listing facts a hint or an opening figure can be built from. */
export interface ListingFigures {
  commodity?: string | null;
  cargoType?: string | null;
  qtyMin?: number | null;
  qtyMax?: number | null;
  stowageFactor?: number | null;
  loadPortCode?: string | null;
  loadPortName?: string | null;
  dischPortCode?: string | null;
  dischPortName?: string | null;
  laycanFrom?: string | null;
  laycanTo?: string | null;
  isSpot?: boolean | null;
  loadRate?: number | null;
  dischRate?: number | null;
  loadTerms?: string | null;
  freightIdea?: number | null;
  vesselFreightIdea?: number | null;
  commission?: number | null;
  demurrage?: number | null;
}

const num = (n: number | null | undefined) => (n == null ? null : Number(n));
const fmt = (n: number | null | undefined) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

/** Human hints per term code, shown under the term name (never a commitment). */
export function termHintsFromListing(f: ListingFigures): Record<string, string> {
  const hints: Record<string, string> = {};
  if (f.commodity) hints.cargo_grade = `Listing: ${f.commodity}${f.cargoType ? ` · ${f.cargoType}` : ""}`;
  if (f.qtyMin != null || f.qtyMax != null) {
    hints.quantity = `Listing: ${fmt(f.qtyMin)}–${fmt(f.qtyMax)} MT${f.stowageFactor != null ? ` · SF ${f.stowageFactor}` : ""}`;
  }
  if (f.loadPortName || f.dischPortName) hints.ports = `Listing: ${f.loadPortName ?? f.loadPortCode ?? "—"} → ${f.dischPortName ?? f.dischPortCode ?? "—"}`;
  if (f.isSpot) hints.laycan = "Listing: SPOT";
  else if (f.laycanFrom || f.laycanTo) hints.laycan = `Listing: ${f.laycanFrom ?? "—"} – ${f.laycanTo ?? "—"}`;
  if (f.loadRate != null || f.dischRate != null) {
    hints.ld_rates = `Listing: ${fmt(f.loadRate)} / ${fmt(f.dischRate)} MT/day${f.loadTerms ? ` · ${f.loadTerms}` : ""}`;
  }
  const money: string[] = [];
  if (f.freightIdea != null) money.push(`cargo idea $${Number(f.freightIdea).toFixed(2)}/MT`);
  if (f.vesselFreightIdea != null) money.push(`owner idea $${Number(f.vesselFreightIdea).toFixed(2)}/MT`);
  if (f.commission != null) money.push(`${f.commission}% comm`);
  if (f.demurrage != null) money.push(`DEM $${fmt(f.demurrage)}/day`);
  if (money.length) hints.freight = `Listing: ${money.join(" · ")}`;
  for (const k of Object.keys(hints)) hints[k] = hints[k].slice(0, 300);
  return hints;
}

/** The catalogue as create_fixture_room expects it, with hints attached. */
export function buildTermCatalogue(figures?: ListingFigures | null): FixtureTermDefinition[] {
  const hints = figures ? termHintsFromListing(figures) : {};
  return FIXTURE_TERM_CATALOGUE.map((t) => ({ ...t, ...(hints[t.code] ? { hint: hints[t.code] } : {}) }));
}

/** A suggested opening value from the listing for the composer's "use listing figure" button. */
export function openingValueFromListing(code: string, f: ListingFigures, side: "cargo" | "vessel"): FixtureValue | null {
  switch (code) {
    case "cargo_grade":
      return f.commodity ? { text: f.commodity } : null;
    case "quantity": {
      const n = num(f.qtyMax) ?? num(f.qtyMin);
      return n != null ? { num: n } : null;
    }
    case "ports":
      return f.loadPortCode && f.dischPortCode
        ? { load: f.loadPortCode, disch: f.dischPortCode, load_name: f.loadPortName ?? null, disch_name: f.dischPortName ?? null }
        : null;
    case "laycan":
      if (f.isSpot) return { spot: true };
      return f.laycanFrom && f.laycanTo ? { from: f.laycanFrom, to: f.laycanTo } : null;
    case "ld_rates": {
      const l = num(f.loadRate), d = num(f.dischRate);
      return l != null && d != null && l > 0 && d > 0 ? { load: l, disch: d } : null;
    }
    case "freight": {
      const n = side === "vessel" ? (num(f.vesselFreightIdea) ?? num(f.freightIdea)) : (num(f.freightIdea) ?? num(f.vesselFreightIdea));
      return n != null ? { num: n, currency: "USD" } : null;
    }
    default:
      return null;
  }
}

const VALUE_KINDS: FixtureValueKind[] = ["text", "number", "money_per_mt", "rate_pair", "date_range", "port_pair"];

/** The same checks create_fixture_room applies; returns the problems, empty when valid. */
export function validateTermCatalogue(terms: readonly FixtureTermDefinition[]): string[] {
  const problems: string[] = [];
  if (!Array.isArray(terms) || terms.length === 0 || terms.length > 40) problems.push("the catalogue must hold 1–40 terms");
  const codes = new Set<string>();
  const orders = new Set<number>();
  for (const t of terms) {
    if (!/^[a-z][a-z0-9_]{1,39}$/.test(t.code)) problems.push(`term code "${t.code}" is invalid`);
    if (codes.has(t.code)) problems.push(`term code "${t.code}" is repeated`);
    codes.add(t.code);
    if (!t.label || t.label.trim().length < 1 || t.label.length > 80) problems.push(`term "${t.code}" needs a label of 1–80 characters`);
    if (!VALUE_KINDS.includes(t.valueKind)) problems.push(`term "${t.code}" has an unknown value kind`);
    if (!Number.isInteger(t.sortOrder) || t.sortOrder < 1 || t.sortOrder > 999) problems.push(`term "${t.code}" needs a sortOrder between 1 and 999`);
    if (orders.has(t.sortOrder)) problems.push(`sortOrder ${t.sortOrder} is repeated`);
    orders.add(t.sortOrder);
    if ((t.unit?.length ?? 0) > 20 || (t.category?.length ?? 0) > 40 || (t.hint?.length ?? 0) > 300) problems.push(`term "${t.code}" has an over-long unit, category or hint`);
  }
  return problems;
}

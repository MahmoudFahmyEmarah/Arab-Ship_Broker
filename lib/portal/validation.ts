// Validation engine — encodes the ArabShipBroker Validation Matrix v2
// (May 2026) as typed rules + validators. Single source of truth for the
// design forms (Post Cargo / Post Position), mirroring the spreadsheet.
//
// Enum option lists are re-exported from lib/schemas/* so the forms and the DB
// model never drift. Numeric ranges below fold in the ASB editorial CORRECTIONS
// (peach rows): load/disch rate max 8,000 (not 20,000), commission TTL 0–5%,
// stowage factor in ft³/LT (min 10, not 0.3), open date capped at +90 days, etc.
import {
  LOAD_TERMS,
  NOR_CLAUSES,
  LAYTIME_BASIS_OPTIONS,
  FREIGHT_BASIS_OPTIONS,
  DESPATCH_BASIS_OPTIONS,
  TOLERANCE_HOLDERS,
  DISPORT_STATUS_OPTIONS,
  PACKAGING_TYPES,
  CARGO_TYPES,
  FT3LT_TO_M3T,
} from "@/lib/schemas/cargo";
import { VESSEL_TYPES, FUEL_TYPES, GRAB_TYPES } from "@/lib/schemas/vessel";

export {
  LOAD_TERMS,
  NOR_CLAUSES,
  LAYTIME_BASIS_OPTIONS,
  FREIGHT_BASIS_OPTIONS,
  DESPATCH_BASIS_OPTIONS,
  TOLERANCE_HOLDERS,
  DISPORT_STATUS_OPTIONS,
  PACKAGING_TYPES,
  CARGO_TYPES,
  VESSEL_TYPES,
  FUEL_TYPES,
  GRAB_TYPES,
};

export const CARGO_NATURES = ["Firm", "Indication", "Subsale"] as const;
export const MOL_HOLDERS = TOLERANCE_HOLDERS; // MOLOO / MOLCHOPT

const CURRENT_YEAR = new Date().getFullYear();

// ── Numeric ranges (matrix Rule column, with ASB corrections applied) ────────
export interface Range { min: number; max: number; msg: string }
export const RANGES: Record<string, Range> = {
  // cargo_listings
  qtyMt: { min: 100, max: 250_000, msg: "Quantity must be 100–250,000 MT" }, // R13
  volumeCbm: { min: 100, max: 150_000, msg: "Volume must be 100–150,000 CbM or CbFT" }, // R12
  loadRate: { min: 200, max: 8_000, msg: "Load rate must be 200–8,000 MT/day" }, // R81 (ASB correction)
  dischRate: { min: 200, max: 8_000, msg: "Discharge rate must be 200–8,000 MT/day" }, // R82 (ASB correction)
  freightIdea: { min: 1, max: 500, msg: "Must be between 1 and 500 USD/MT" }, // R24
  commissionTtl: { min: 0, max: 5, msg: "Total commission must be 0–5%" }, // R93 (ASB)
  despatchRate: { min: 0, max: 10_000, msg: "Despatch rate must be 0–10,000 USD/day" }, // R91 (ASB)
  molPct: { min: 0, max: 10, msg: "Tolerance must be 0–10%" }, // R61
  bagWeightKg: { min: 10, max: 1_500, msg: "Bag weight must be 10–1,500 kg" }, // R65
  demurrage: { min: 0, max: 100_000, msg: "Demurrage must be 0–100,000 USD/day" },
  // vessels
  dwt: { min: 500, max: 15_000, msg: "DWT must be 500–15,000 for this platform" }, // R27
  grt: { min: 200, max: 15_000, msg: "Please enter a valid GRT" }, // R29
  loa: { min: 40, max: 200, msg: "LOA must be 40–200 m" }, // R30
  beam: { min: 6, max: 40, msg: "Beam must be 6–40 m" }, // R35
  buildYear: { min: 1970, max: CURRENT_YEAR, msg: `Build year must be 1970–${CURRENT_YEAR}` }, // R34
  maxDraft: { min: 2, max: 14, msg: "Draft must be 2–14 m" }, // R73
  cargoIntakeCbm: { min: 500, max: 20_000, msg: "Cargo intake capacity must be 500–20,000 CBM" }, // R84 (ASB)
  // vessel_availability
  openDateFlex: { min: 0, max: 30, msg: "Flexibility window must be 0–30 days" }, // R39
  serviceSpeed: { min: 6, max: 18, msg: "Speed must be 6–18 knots" }, // R41
  meConsumption: { min: 1, max: 40, msg: "Must be 1–40 MT/day" }, // R42
  auxConsumption: { min: 0.5, max: 8, msg: "Aux consumption must be 0.5–8 MT/day" }, // R74 (ASB)
  craneSwl: { min: 5, max: 50, msg: "Crane SWL must be 5–50 t" }, // R75
  craneCount: { min: 1, max: 6, msg: "Number of cranes must be 1–6" }, // R76
  grabCapacity: { min: 3, max: 20, msg: "Grab capacity must be 3–20 t" }, // R96 (ASB)
  grabCount: { min: 1, max: 4, msg: "Number of grabs must be 1–4" }, // R97 (ASB)
  brob: { min: 0, max: 2_000, msg: "BROB must be 0–2,000 MT" }, // R77
  // ports
  portMaxDraft: { min: 2, max: 20, msg: "Max draft must be 2–20 m" }, // R47
  waterDensity: { min: 1.0, max: 1.03, msg: "Water density must be 1.000–1.030" }, // R48
};

// ── Stowage factor — unit toggle (R83). Stored internally in ft³/LT. ─────────
export type SfUnit = "ft3lt" | "m3t";
export const SF_RANGE: Record<SfUnit, Range> = {
  ft3lt: { min: 10, max: 90, msg: "Stowage factor must be 10–90 ft³/LT  or  0.28–2.55 m³/t" },
  m3t: { min: 0.28, max: 2.55, msg: "Stowage factor must be 10–90 ft³/LT  or  0.28–2.55 m³/t" },
};
export function sfToFt3lt(value: number, unit: SfUnit): number {
  return unit === "ft3lt" ? value : value / FT3LT_TO_M3T; // m³/t → ft³/LT
}
/** SF > 50 ft³/LT (≈ >1.42 m³/t) triggers the "Volume Check Required" banner (R83). */
export function sfBannerNeeded(ft3lt: number): boolean {
  return Number.isFinite(ft3lt) && ft3lt > 50;
}

// ── Primitive validators (return an error string, or null when valid) ────────
const isBlank = (v: unknown) => v == null || (typeof v === "string" && v.trim() === "");
const toNum = (v: unknown) => (typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[, ]/g, "")));

export function required(v: unknown, msg: string): string | null {
  return isBlank(v) ? msg : null;
}

/** Range check that ignores blanks (pair with `required` for mandatory fields). */
export function inRange(v: unknown, r: Range): string | null {
  if (isBlank(v)) return null;
  const n = toNum(v);
  if (!Number.isFinite(n)) return r.msg;
  return n < r.min || n > r.max ? r.msg : null;
}

export function oneOf<T extends string>(v: unknown, options: readonly T[], msg: string): string | null {
  if (isBlank(v)) return null;
  return options.includes(v as T) ? null : msg;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export function email(v: unknown, msg = "Please enter a valid email address"): string | null {
  if (isBlank(v)) return null;
  return EMAIL_RE.test(String(v)) ? null : msg;
}

export const LOCODE_RE = /^[A-Z]{2}[A-Z0-9]{3}$/;
export function locode(v: unknown, msg = "LOCODE must be 5 uppercase characters"): string | null {
  if (isBlank(v)) return null;
  return LOCODE_RE.test(String(v)) ? null : msg;
}

// Phone (R6). Pragmatic shape check (optional `+`, ≥7 digits). The matrix's
// preferred libphonenumber-js validation is a drop-in upgrade for this function.
export function phone(v: unknown, msg = "Invalid phone number format"): string | null {
  if (isBlank(v)) return null;
  const s = String(v).trim();
  if (!/^\+?[0-9\s().-]{7,}$/.test(s)) return msg;
  return (s.match(/\d/g)?.length ?? 0) >= 7 ? null : msg;
}

/** IMO: 7 digits with a valid check digit (R69). digits 1–6 × 7,6,5,4,3,2, sum %10 = digit 7. */
export function imo(v: unknown, msg = "IMO number is invalid"): string | null {
  if (isBlank(v)) return null;
  const s = String(v).trim();
  if (!/^\d{7}$/.test(s)) return "IMO must be exactly 7 digits";
  const sum = [7, 6, 5, 4, 3, 2].reduce((acc, w, i) => acc + w * Number(s[i]), 0);
  return sum % 10 === Number(s[6]) ? null : msg;
}

/** Boolean check-digit test for zod refines (R69). Blank / non-7-digit → true
 *  so the separate length rule owns that message; only flags a wrong check digit. */
export function isValidImoCheckDigit(v: string | null | undefined): boolean {
  if (!v) return true;
  if (!/^\d{7}$/.test(v)) return true;
  const sum = [7, 6, 5, 4, 3, 2].reduce((acc, w, i) => acc + w * Number(v[i]), 0);
  return sum % 10 === Number(v[6]);
}

// ── Date validators ──────────────────────────────────────────────────────────
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const parseDate = (v: unknown) => { const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d; };
const dayDiff = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / 86_400_000);

export function notPast(v: unknown, msg = "Date cannot be in the past"): string | null {
  if (isBlank(v)) return null;
  const d = parseDate(v);
  if (!d) return msg;
  return dayDiff(d, startOfToday()) < 0 ? msg : null;
}

/** Date must be within the next `days` days (and not in the past). R87/R88 → 90. */
export function within(v: unknown, days: number, msg: string): string | null {
  if (isBlank(v)) return null;
  const d = parseDate(v);
  if (!d) return msg;
  const diff = dayDiff(d, startOfToday());
  return diff < 0 || diff > days ? msg : null;
}

/** Cross-field order: `to` must be on/after `from` (R18). */
export function order(from: unknown, to: unknown, msg = "End date must be after start date"): string | null {
  if (isBlank(from) || isBlank(to)) return null;
  const a = parseDate(from), b = parseDate(to);
  if (!a || !b) return null;
  return dayDiff(b, a) < 0 ? msg : null;
}

/** Cross-field window cap: `to` must be ≤ `from` + `days` (R63 → 45). */
export function windowMax(from: unknown, to: unknown, days: number, msg: string): string | null {
  if (isBlank(from) || isBlank(to)) return null;
  const a = parseDate(from), b = parseDate(to);
  if (!a || !b) return null;
  return dayDiff(b, a) > days ? msg : null;
}

/** Cross-field difference: two values must differ (R16 — POD ≠ POL). */
export function mustDiffer(a: unknown, b: unknown, msg: string): string | null {
  if (isBlank(a) || isBlank(b)) return null;
  return String(a).toUpperCase() === String(b).toUpperCase() ? msg : null;
}

// ── Issue helpers ────────────────────────────────────────────────────────────
export type Issues<K extends string> = Partial<Record<K, string>>;
/** Collapse a list of [field, error|null] into an issues map (drops nulls). */
export function collect<K extends string>(pairs: [K, string | null][]): Issues<K> {
  const out: Issues<K> = {};
  for (const [k, v] of pairs) if (v) out[k] = v;
  return out;
}
export function hasIssues<K extends string>(issues: Issues<K>): boolean {
  return Object.keys(issues).length > 0;
}

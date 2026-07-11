// The sheet registry — the single source of truth mapping each CargoMap
// workbook tab onto a live table: business key, header→column map, and the
// derive/validate rules from the CargoMap reference (Step 4 field extraction).
//
// keyColumn here MUST match fn_sync_key_column() in the Phase 1 migration.

import { LOAD_TERMS } from "@/lib/schemas/cargo";
import type { Cell, ColumnSpec, Flag, SheetSpec } from "./types";
import { intStrip, locode, num, parseLaycan, str, upper } from "./normalize";

// ── closed vocabularies (mirror the DB enums) ──────────────────────────────
export const ZONES = new Set([
  "B.SEA", "E.MED", "W.MED", "C.MED", "ADRIATIC", "R.SEA", "AG", "A.SEA",
  "WCAF", "ECAF", "NCONT", "CARIB", "F.EAST", "ECI", "Unknown", "ECSA", "WCI", "GLAKES",
]);
export const CARGO_TYPES = new Set(["Dry Bulk", "Break Bulk"]);
export const CARGO_STATUSES = new Set(["IN", "PARTIAL", "OUT", "MONITOR", "CLOSED"]);
export const CARGO_PRIORITIES = new Set(["CRITICAL", "HIGH", "MED", "LOW", "MONITOR", "CLOSED"]);
export const PORT_TYPES = new Set(["Sea Port", "River Port", "Sea/River"]);
export const VESSEL_TYPES = new Set(["Bulk Carrier", "Cargo Ship", "General Cargo", "Other"]);
export const LOAD_TERM_SET = new Set<string>(LOAD_TERMS as readonly string[]);
export const REF_RE = /^(CM|P|OUT)-\d{3,}$/;
// Provisional refs minted for channel cargo that arrived without a broker ref
// (EM- = email, WA- = whatsapp; see lib/sync/email/to-rows.ts). Recognised so
// they don't trip the ref-format warning.
export const PROVISIONAL_REF_RE = /^(EM|WA)-[0-9A-F]{6,}$/;

// cargo_type sometimes arrives lower/space-variant; normalize to the enum label.
function cargoType(v: Cell): Cell {
  const s = str(v);
  if (!s) return null;
  const t = s.toLowerCase();
  if (t.startsWith("dry")) return "Dry Bulk";
  if (t.startsWith("break")) return "Break Bulk";
  return s;
}

// cargo priority: the workbook uses "--" for "no priority"; drop it to null.
function priority(v: Cell): Cell {
  const s = upper(v);
  return !s || s === "--" || /^-+$/.test(s) ? null : s;
}

// load terms: the enum is mixed-case ("Liner Terms", "FIOS LSD") — normalise to
// the canonical enum spelling case-insensitively rather than upper-casing.
function loadTerms(v: Cell): Cell {
  const s = str(v);
  if (!s) return null;
  const match = [...LOAD_TERM_SET].find((t) => t.toLowerCase() === s.toLowerCase());
  return match ?? s; // unknown → keep as-is (validate will flag it)
}

// port type: normalize casing/spacing variants ("seaport" → "Sea Port").
function portType(v: Cell): Cell {
  const s = str(v);
  if (!s) return null;
  const t = s.toLowerCase().replace(/\s+/g, "");
  if (t === "seaport") return "Sea Port";
  if (t === "riverport") return "River Port";
  if (t === "sea/river" || t === "seariver") return "Sea/River";
  return s;
}

// vessel type: the workbook's two-value model (Cargo Ship / Bulk Carrier);
// legacy General Cargo / MPP normalise to Cargo Ship (per 09_VESSEL_FIELD_SPEC).
function vesselType(v: Cell): Cell {
  const s = str(v);
  if (!s) return null;
  const t = s.toLowerCase();
  if (t.includes("bulk")) return "Bulk Carrier";
  if (t.includes("cargo ship") || t.includes("general") || t.includes("mpp") || t.includes("multi")) return "Cargo Ship";
  return s;
}

export const SHEET_SPECS: SheetSpec[] = [
  // ── 01_CARGO → cargo_listings (key: ref) ──────────────────────────────────
  {
    id: "cargo",
    sheetNames: ["01_CARGO", "CARGO", "cargo"],
    label: "Cargo listings",
    targetTable: "cargo_listings",
    keyColumn: "ref",
    columns: [
      { header: "REF", column: "ref", transform: str },
      { header: "BATCH", aliases: ["BATCH_ID"], column: "batch_id", transform: str },
      { header: "CARGO_TYPE", aliases: ["TYPE"], column: "cargo_type", transform: cargoType, required: true },
      { header: "COMMODITY", aliases: ["COMMODITY_NAME"], column: "commodity_name", transform: str, required: true },
      { header: "QTY_MIN_MT", aliases: ["QTY_MIN"], column: "qty_min_mt", transform: intStrip, required: true },
      { header: "QTY_MAX_MT", aliases: ["QTY_MAX"], column: "qty_max_mt", transform: intStrip, required: true },
      { header: "STOWAGE_FACTOR", aliases: ["SF"], column: "stowage_factor", transform: num },
      { header: "LOAD_LOCODE", aliases: ["LOAD_PORT_LOCODE"], column: "load_port_locode", transform: locode },
      { header: "LOAD_PORT", aliases: ["LOAD_PORT_NAME"], column: "load_port_name", transform: str },
      { header: "LOAD_ZONE", column: "load_zone", transform: upper },
      { header: "LOAD_COUNTRY", column: "load_country", transform: str },
      { header: "DISCH_LOCODE", aliases: ["DISCH_PORT_LOCODE"], column: "disch_port_locode", transform: locode },
      { header: "DISCH_PORT", aliases: ["DISCH_PORT_NAME"], column: "disch_port_name", transform: str },
      { header: "DISCH_ZONE", column: "disch_zone", transform: upper },
      { header: "DISCH_COUNTRY", column: "disch_country", transform: str },
      { header: "LAYCAN_TO", column: "laycan_to", transform: (v) => parseLaycan(v).date },
      { header: "LOAD_RATE", column: "load_rate", transform: str },
      { header: "DISCH_RATE", column: "disch_rate", transform: str },
      { header: "LOAD_TERMS", column: "load_terms", transform: loadTerms },
      { header: "LAYTIME_STRUCTURE", column: "laytime_structure", transform: str },
      { header: "FREIGHT_IDEA", aliases: ["FREIGHT", "FREIGHT_USD_MT"], column: "freight_idea_usd_mt", transform: num },
      { header: "COMMISSION_PCT", aliases: ["COMMISSION"], column: "commission_pct", transform: num },
      { header: "DEMURRAGE_RATE", column: "demurrage_rate", transform: num },
      { header: "DESPATCH", aliases: ["DESPATCH_RATE"], column: "despatch_rate", transform: num },
      { header: "BROKER", column: "broker", transform: str },
      { header: "STATUS", column: "status", transform: upper },
      { header: "PRIORITY", column: "priority", transform: priority },
      { header: "COMMODITY_CATEGORY", column: "commodity_category", transform: str },
      { header: "BATCH_DATE", column: "batch_date", transform: (v) => parseLaycan(v).date },
      { header: "NOTES", column: "notes", transform: str },
      // Secondary load / discharge ports (rotation cargoes).
      { header: "LOAD_PORT_2", column: "load_port_2_name", transform: str },
      { header: "LOAD_LOCODE_2", column: "load_port_2_locode", transform: locode },
      { header: "LOAD_PORT_3", column: "load_port_3_name", transform: str },
      { header: "LOAD_LOCODE_3", column: "load_port_3_locode", transform: locode },
      { header: "LOAD_PORT_4", column: "load_port_4_name", transform: str },
      { header: "LOAD_LOCODE_4", column: "load_port_4_locode", transform: locode },
      { header: "DISCH_PORT_2", column: "disch_port_2_name", transform: str },
      { header: "DISCH_LOCODE_2", column: "disch_port_2_locode", transform: locode },
      { header: "DISCH_PORT_3", column: "disch_port_3_name", transform: str },
      { header: "DISCH_LOCODE_3", column: "disch_port_3_locode", transform: locode },
      { header: "DISCH_PORT_4", column: "disch_port_4_name", transform: str },
      { header: "DISCH_LOCODE_4", column: "disch_port_4_locode", transform: locode },
    ],
    // Laycan (SPOT/PPT → null + is_spot) and grain flag can't be a 1:1 column map.
    derive(payload, raw) {
      const lc = parseLaycan(raw["LAYCAN_FROM"] ?? null);
      payload["laycan_from"] = lc.date;
      payload["is_spot"] = lc.isSpot;
      const regime = upper(raw["ASB_REGIME"] ?? null);
      if (regime === "GRAIN") payload["is_grain_cargo"] = true;
    },
    validate(payload, raw) {
      const f: Flag[] = [];
      const ref = payload["ref"];
      const refStr = ref ? String(ref) : "";
      if (refStr && PROVISIONAL_REF_RE.test(refStr))
        f.push({ level: "info", field: "ref", msg: "provisional REF minted from email content — confirm or replace before/after commit" });
      else if (refStr && !REF_RE.test(refStr))
        f.push({ level: "warn", field: "ref", msg: `REF "${ref}" isn't CM-/P-/OUT-nnn` });
      const ct = payload["cargo_type"];
      if (ct && !CARGO_TYPES.has(String(ct)))
        f.push({ level: "error", field: "cargo_type", msg: `unknown cargo type "${ct}"` });
      const st = payload["status"];
      if (st && !CARGO_STATUSES.has(String(st)))
        f.push({ level: "error", field: "status", msg: `unknown status "${st}"` });
      const pr = payload["priority"];
      if (pr && !CARGO_PRIORITIES.has(String(pr)))
        f.push({ level: "error", field: "priority", msg: `unknown priority "${pr}"` });
      const lt = payload["load_terms"];
      if (lt && !LOAD_TERM_SET.has(String(lt)))
        f.push({ level: "error", field: "load_terms", msg: `unknown load terms "${lt}"` });
      for (const zf of ["load_zone", "disch_zone"]) {
        const z = payload[zf];
        if (z && !ZONES.has(String(z)))
          f.push({ level: "error", field: zf, msg: `unknown zone "${z}"` });
      }
      const c = payload["commission_pct"];
      if (typeof c === "number" && (c < 0 || c > 10))
        f.push({ level: "error", field: "commission_pct", msg: `commission ${c} out of 0–10` });
      for (const nCol of ["qty_min_mt", "qty_max_mt", "commission_pct", "freight_idea_usd_mt", "stowage_factor"]) {
        if (typeof payload[nCol] === "string")
          f.push({ level: "error", field: nCol, msg: `"${payload[nCol]}" is not a number` });
      }
      const regime = upper(raw["ASB_REGIME"] ?? null);
      if (regime === "UNMAPPED")
        f.push({ level: "info", field: "asb_regime", msg: "UNMAPPED — assign a regime in Manual Review" });
      return f;
    },
  },

  // ── 04_PORTS → ports (key: locode) ────────────────────────────────────────
  {
    id: "ports",
    sheetNames: ["04_PORTS", "PORTS", "ports"],
    label: "Ports",
    targetTable: "ports",
    keyColumn: "locode",
    columns: [
      { header: "LOCODE", column: "locode", transform: locode, required: true },
      { header: "PORT", aliases: ["TRADE_NAME", "PORT_NAME", "NAME"], column: "trade_name", transform: str, required: true },
      { header: "COUNTRY", column: "country", transform: str, required: true },
      { header: "ZONE", column: "zone", transform: upper, required: true },
      { header: "PORT_TYPE", aliases: ["TYPE"], column: "port_type", transform: portType },
      { header: "NOTES", column: "notes", transform: str },
      { header: "LAT", aliases: ["LATITUDE"], column: "latitude", transform: num },
      { header: "LON", aliases: ["LONGITUDE", "LNG"], column: "longitude", transform: num },
    ],
    validate(payload) {
      const f: Flag[] = [];
      const z = payload["zone"];
      if (z && !ZONES.has(String(z)))
        f.push({ level: "error", field: "zone", msg: `unknown zone "${z}"` });
      const pt = payload["port_type"];
      if (pt && !PORT_TYPES.has(String(pt)))
        f.push({ level: "error", field: "port_type", msg: `unknown port type "${pt}"` });
      const lc = payload["locode"];
      if (lc && !/^[A-Z0-9]{5}$/.test(String(lc)))
        f.push({ level: "warn", field: "locode", msg: `LOCODE "${lc}" isn't 5 chars` });
      return f;
    },
  },

  // ── 02_VESSELS → vessels (key: imo_number) ───────────────────────────────
  {
    id: "vessels",
    sheetNames: ["02_VESSELS", "VESSELS", "vessels"],
    label: "Vessels",
    targetTable: "vessels",
    keyColumn: "imo_number",
    columns: [
      { header: "IMO", aliases: ["IMO_NUMBER"], column: "imo_number", transform: str, required: true },
      { header: "VESSEL_NAME", aliases: ["NAME"], column: "vessel_name", transform: str, required: true },
      { header: "VESSEL_TYPE", aliases: ["TYPE"], column: "vessel_type", transform: vesselType, required: true },
      { header: "DWT", aliases: ["DWT_GRAIN"], column: "dwt_grain", transform: intStrip },
      { header: "DWCC", column: "dwcc", transform: intStrip },
      { header: "DWT_BALE", column: "dwt_bale", transform: intStrip },
      { header: "GRAIN_CBM", column: "grain_cbm", transform: num },
      { header: "FLAG", column: "flag", transform: str },
      { header: "BUILT", aliases: ["BUILD_YEAR", "YEAR"], column: "build_year", transform: intStrip },
    ],
    validate(payload) {
      const f: Flag[] = [];
      const imo = payload["imo_number"];
      if (imo && !/^\d{7}$/.test(String(imo)))
        f.push({ level: "warn", field: "imo_number", msg: `IMO "${imo}" isn't 7 digits` });
      const vt = payload["vessel_type"];
      if (vt && !VESSEL_TYPES.has(String(vt)))
        f.push({ level: "error", field: "vessel_type", msg: `unknown vessel type "${vt}"` });
      return f;
    },
  },

  // ── 03_COMPANIES → organizations (key: name) ─────────────────────────────
  {
    id: "companies",
    sheetNames: ["03_COMPANIES", "COMPANIES", "organizations"],
    label: "Companies",
    targetTable: "organizations",
    keyColumn: "name",
    columns: [
      { header: "NAME", aliases: ["COMPANY", "COMPANY_NAME"], column: "name", transform: str, required: true },
      { header: "IMO", aliases: ["COMPANY_IMO"], column: "imo", transform: str },
      { header: "COUNTRY", column: "country", transform: str },
      { header: "FLEET_TOTAL", column: "fleet_total", transform: intStrip },
      { header: "ADDRESS", column: "address", transform: str },
    ],
  },

  // ── 05_CLASS_MARKET_NAME → commodities (key: canonical_name) ─────────────
  // A market-name → regime resolver dictionary: columns are
  // market_name | regime | code | group/cat | note.
  {
    id: "commodities",
    sheetNames: ["05_CLASS_MARKET_NAME", "05_CLASS", "COMMODITIES", "commodities"],
    label: "Commodities",
    targetTable: "commodities",
    keyColumn: "canonical_name",
    columns: [
      { header: "MARKET_NAME", aliases: ["COMMODITY", "CANONICAL_NAME", "NAME"], column: "canonical_name", transform: str, required: true },
      { header: "GROUP/CAT", aliases: ["CATEGORY", "CATEGORY_LABEL", "GROUP_CAT"], column: "category_label", transform: str },
    ],
    // Regime → the boolean/enum fields the commodities table actually carries.
    derive(payload, raw) {
      const regime = upper(raw["regime"] ?? raw["REGIME"] ?? null);
      if (regime === "GRAIN") payload["is_grain"] = true;
    },
  },
];

const norm = (s: string) => s.trim().toUpperCase();

/** Resolve a workbook tab name to its SheetSpec (case-insensitive). */
export function specForSheetName(name: string): SheetSpec | undefined {
  const n = norm(name);
  return SHEET_SPECS.find((s) => s.sheetNames.some((sn) => norm(sn) === n));
}

export function specById(id: string): SheetSpec | undefined {
  return SHEET_SPECS.find((s) => s.id === id);
}

/** Build a header → ColumnSpec index for one sheet (header + aliases, upper-cased). */
export function headerIndex(spec: SheetSpec): Map<string, ColumnSpec> {
  const m = new Map<string, ColumnSpec>();
  for (const col of spec.columns) {
    m.set(norm(col.header), col);
    for (const a of col.aliases ?? []) m.set(norm(a), col);
  }
  return m;
}

// The Database Preview registry — a client-safe description of what the live
// tables look like in the Preview grid: which columns to show, their editor
// type, and the closed vocabularies (mirrors the DB enums). No server imports,
// so both the server actions and the "use client" grid can share it.
//
// keyCol here MUST match fn_sync_key_column() in the Phase 1 migration.

export type PreviewType = "text" | "int" | "num" | "bool" | "enum" | "date";

export interface PreviewCol {
  col: string;
  label: string;
  type: PreviewType;
  editable?: boolean;   // false → read-only (the business key, derived fields)
  options?: string[];   // for type: "enum"
  nullable?: boolean;   // enum/text that may be cleared to NULL
  w?: number;           // preferred column width (px)
}

export interface PreviewTable {
  id: string;
  label: string;
  table: string;
  keyCol: string;
  searchCols: string[];
  columns: PreviewCol[];
}

// ── enum vocabularies (from the live pg_enum types) ─────────────────────────
export const ENUMS = {
  cargoType: ["Dry Bulk", "Break Bulk"],
  cargoStatus: ["IN", "PARTIAL", "OUT", "MONITOR", "CLOSED"],
  cargoPriority: ["CRITICAL", "HIGH", "MED", "LOW", "MONITOR", "CLOSED"],
  reviewStatus: ["PENDING", "APPROVED", "REJECTED", "FLAGGED"],
  zone: [
    "B.SEA", "E.MED", "W.MED", "C.MED", "ADRIATIC", "R.SEA", "AG", "A.SEA",
    "WCAF", "ECAF", "NCONT", "CARIB", "F.EAST", "ECI", "Unknown", "ECSA", "WCI", "GLAKES",
  ],
  portType: ["Sea Port", "River Port", "Sea/River"],
  vesselType: ["Bulk Carrier", "Cargo Ship", "General Cargo", "Other"],
  scope: ["In Scope", "Marginal", "Out of Scope"],
  riskLevel: ["CLEAR", "LOW", "MEDIUM", "HIGH"],
  imsbc: ["Cat_A", "Cat_B", "Cat_C", "DG", "Non_DG"],
  loadTerms: ["FIO", "FIOT", "FIOST", "FIOS", "FIOS LSD", "Liner Terms", "FO", "FILO", "LIFO", "FLT"],
} as const;

export const PREVIEW_TABLES: PreviewTable[] = [
  {
    id: "cargo",
    label: "Cargo listings",
    table: "cargo_listings",
    keyCol: "ref",
    searchCols: ["ref", "commodity_name", "load_port_name", "disch_port_name", "broker"],
    columns: [
      { col: "ref", label: "REF", type: "text", editable: false, w: 96 },
      { col: "commodity_name", label: "Commodity", type: "text", w: 150 },
      { col: "cargo_type", label: "Type", type: "enum", options: [...ENUMS.cargoType], w: 110 },
      { col: "status", label: "Status", type: "enum", options: [...ENUMS.cargoStatus], w: 96 },
      { col: "qty_min_mt", label: "Qty min", type: "int", w: 90 },
      { col: "qty_max_mt", label: "Qty max", type: "int", w: 90 },
      { col: "load_port_name", label: "Load port", type: "text", nullable: true, w: 130 },
      { col: "load_zone", label: "Load zone", type: "enum", options: [...ENUMS.zone], nullable: true, w: 100 },
      { col: "disch_port_name", label: "Disch port", type: "text", nullable: true, w: 130 },
      { col: "disch_zone", label: "Disch zone", type: "enum", options: [...ENUMS.zone], nullable: true, w: 100 },
      { col: "freight_idea_usd_mt", label: "Freight", type: "num", nullable: true, w: 90 },
      { col: "commission_pct", label: "Comm %", type: "num", nullable: true, w: 84 },
      { col: "load_terms", label: "Load terms", type: "enum", options: [...ENUMS.loadTerms], nullable: true, w: 110 },
      { col: "laytime_structure", label: "Laytime", type: "text", nullable: true, w: 130 },
      { col: "priority", label: "Priority", type: "enum", options: [...ENUMS.cargoPriority], nullable: true, w: 100 },
      { col: "is_spot", label: "Spot", type: "bool", w: 70 },
      { col: "review_status", label: "Review", type: "enum", options: [...ENUMS.reviewStatus], w: 100 },
      { col: "broker", label: "Broker", type: "text", nullable: true, w: 120 },
    ],
  },
  {
    id: "ports",
    label: "Ports",
    table: "ports",
    keyCol: "locode",
    searchCols: ["locode", "trade_name", "country"],
    columns: [
      { col: "locode", label: "LOCODE", type: "text", editable: false, w: 90 },
      { col: "trade_name", label: "Name", type: "text", w: 170 },
      { col: "country", label: "Country", type: "text", w: 140 },
      { col: "zone", label: "Zone", type: "enum", options: [...ENUMS.zone], w: 100 },
      { col: "port_type", label: "Type", type: "enum", options: [...ENUMS.portType], w: 110 },
      { col: "latitude", label: "Lat", type: "num", nullable: true, w: 90 },
      { col: "longitude", label: "Lon", type: "num", nullable: true, w: 90 },
      { col: "is_active", label: "Active", type: "bool", w: 74 },
      { col: "is_verified", label: "Verified", type: "bool", w: 82 },
    ],
  },
  {
    id: "vessels",
    label: "Vessels",
    table: "vessels",
    keyCol: "imo_number",
    searchCols: ["imo_number", "vessel_name", "flag", "owner_company"],
    columns: [
      { col: "imo_number", label: "IMO", type: "text", editable: false, w: 90 },
      { col: "vessel_name", label: "Name", type: "text", w: 170 },
      { col: "vessel_type", label: "Type", type: "enum", options: [...ENUMS.vesselType], w: 130 },
      { col: "dwt_grain", label: "DWT", type: "int", nullable: true, w: 90 },
      { col: "build_year", label: "Built", type: "int", nullable: true, w: 72 },
      { col: "flag", label: "Flag", type: "text", nullable: true, w: 120 },
      { col: "scope", label: "Scope", type: "enum", options: [...ENUMS.scope], w: 110 },
      { col: "risk_level", label: "Risk", type: "enum", options: [...ENUMS.riskLevel], w: 96 },
      { col: "is_sanctioned", label: "Sanctioned", type: "bool", w: 100 },
    ],
  },
  {
    id: "companies",
    label: "Companies",
    table: "organizations",
    keyCol: "name",
    searchCols: ["name", "country", "desk_email"],
    columns: [
      { col: "name", label: "Name", type: "text", editable: false, w: 190 },
      { col: "org_type", label: "Type", type: "text", w: 120 },
      { col: "country", label: "Country", type: "text", nullable: true, w: 140 },
      { col: "imo", label: "IMO", type: "text", nullable: true, w: 100 },
      { col: "fleet_total", label: "Fleet", type: "int", nullable: true, w: 80 },
      { col: "desk_email", label: "Desk email", type: "text", nullable: true, w: 190 },
    ],
  },
  {
    id: "commodities",
    label: "Commodities",
    table: "commodities",
    keyCol: "canonical_name",
    searchCols: ["canonical_name", "category_label"],
    columns: [
      { col: "canonical_name", label: "Canonical name", type: "text", editable: false, w: 180 },
      { col: "category_label", label: "Category", type: "text", nullable: true, w: 140 },
      { col: "cargo_type", label: "Type", type: "enum", options: [...ENUMS.cargoType], w: 120 },
      { col: "imsbc_category", label: "IMSBC", type: "enum", options: [...ENUMS.imsbc], w: 100 },
      { col: "is_grain", label: "Grain", type: "bool", w: 74 },
      { col: "is_dg", label: "DG", type: "bool", w: 66 },
      { col: "is_active", label: "Active", type: "bool", w: 74 },
      { col: "default_sf_m3t", label: "Def. SF", type: "num", nullable: true, w: 90 },
    ],
  },
];

export function previewTable(id: string): PreviewTable | undefined {
  return PREVIEW_TABLES.find((t) => t.id === id);
}

/** Coerce a form input value to the JS value that belongs in an edit patch. */
export function coerce(type: PreviewType, raw: unknown): unknown {
  if (type === "bool") return raw === true || raw === "true";
  if (raw === "" || raw === null || raw === undefined) return null;
  if (type === "int") {
    const n = Number.parseInt(String(raw), 10);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "num") {
    const n = Number.parseFloat(String(raw));
    return Number.isFinite(n) ? n : null;
  }
  return String(raw);
}

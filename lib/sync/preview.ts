// The Database Preview registry — a client-safe description of what the live
// tables look like in the Preview grid: which columns to show, their editor
// type, and the closed vocabularies (mirrors the DB enums). No server imports,
// so both the server actions and the "use client" grid can share it.
//
// keyCol here MUST match fn_sync_key_column() in the Phase 1 migration.

export type PreviewType = "text" | "int" | "num" | "bool" | "enum" | "date" | "list";

export interface PreviewCol {
  col: string;
  label: string;
  type: PreviewType;
  editable?: boolean;   // false → read-only (the business key, derived fields)
  options?: string[];   // for type: "enum"
  nullable?: boolean;   // enum/text that may be cleared to NULL
  required?: boolean;   // NOT NULL without default — must be filled when adding
  def?: unknown;        // initial value in the Add drawer
  w?: number;           // preferred column width (px)
}

export interface PreviewTable {
  id: string;
  label: string;
  table: string;
  keyCol: string;
  searchCols: string[];
  columns: PreviewCol[];
  insertable?: boolean; // false → no Add button (rows come from posting flows / sync)
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
  regime: ["GRAIN", "IMSBC", "CSS", "UNMAPPED"],
} as const;

export const PREVIEW_TABLES: PreviewTable[] = [
  {
    id: "cargo",
    label: "Cargo listings",
    table: "cargo_listings",
    keyCol: "ref",
    insertable: false, // listings are created by the posting flows / sync, never by hand here
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
      { col: "trade_name", label: "Name", type: "text", required: true, w: 170 },
      { col: "country", label: "Country", type: "text", required: true, w: 140 },
      { col: "zone", label: "Zone", type: "enum", options: [...ENUMS.zone], required: true, w: 100 },
      { col: "port_type", label: "Type", type: "enum", options: [...ENUMS.portType], def: "Sea Port", w: 110 },
      { col: "latitude", label: "Lat", type: "num", nullable: true, w: 90 },
      { col: "longitude", label: "Lon", type: "num", nullable: true, w: 90 },
      { col: "is_active", label: "Active", type: "bool", def: true, w: 74 },
      { col: "is_verified", label: "Verified", type: "bool", def: true, w: 82 },
      { col: "notes", label: "Notes", type: "text", nullable: true, w: 180 },
      { col: "unlocode_status", label: "UN/LOCODE", type: "text", editable: false, w: 96 },
      { col: "unlocode_function", label: "Function", type: "text", editable: false, w: 96 },
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
      { col: "vessel_name", label: "Name", type: "text", required: true, w: 170 },
      { col: "vessel_type", label: "Type", type: "enum", options: [...ENUMS.vesselType], required: true, def: "Bulk Carrier", w: 130 },
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
      { col: "cargo_type", label: "Type", type: "enum", options: [...ENUMS.cargoType], required: true, def: "Dry Bulk", w: 120 },
      { col: "imsbc_category", label: "IMSBC", type: "enum", options: [...ENUMS.imsbc], required: true, def: "Non_DG", w: 100 },
      { col: "is_grain", label: "Grain", type: "bool", w: 74 },
      { col: "is_dg", label: "DG", type: "bool", w: 66 },
      { col: "is_active", label: "Active", type: "bool", def: true, w: 74 },
      { col: "default_sf_m3t", label: "Def. SF", type: "num", nullable: true, w: 90 },
      { col: "display_aliases", label: "Aliases", type: "list", nullable: true, w: 200 },
    ],
  },
  // ── classification lookup tables (Broker Ledger reference layer) ──────────
  {
    id: "market_names",
    label: "Market names",
    table: "market_names",
    keyCol: "market_name",
    searchCols: ["market_name", "code", "group_or_cat"],
    columns: [
      { col: "market_name", label: "Market name", type: "text", editable: false, w: 180 },
      { col: "regime", label: "Regime", type: "enum", options: [...ENUMS.regime], required: true, def: "IMSBC", w: 100 },
      { col: "code", label: "Official name / code", type: "text", nullable: true, w: 190 },
      { col: "group_or_cat", label: "Group / cat", type: "text", nullable: true, w: 110 },
      { col: "note", label: "Note", type: "text", nullable: true, w: 180 },
    ],
  },
  {
    id: "grain_list",
    label: "Grain list",
    table: "grain_list",
    keyCol: "market_name",
    searchCols: ["market_name", "family"],
    columns: [
      { col: "market_name", label: "Grain name", type: "text", editable: false, w: 180 },
      { col: "family", label: "Family", type: "text", nullable: true, w: 120 },
      { col: "requirement", label: "Grain Code requirement", type: "text", nullable: true, w: 220 },
      { col: "notes", label: "Notes", type: "text", nullable: true, w: 180 },
      { col: "is_active", label: "Active", type: "bool", def: true, w: 74 },
    ],
  },
  {
    id: "imsbc_codes",
    label: "IMSBC codes",
    table: "imsbc_codes",
    keyCol: "bcsn",
    searchCols: ["bcsn", "imsbc_group", "un_number"],
    columns: [
      { col: "bcsn", label: "BCSN", type: "text", editable: false, w: 220 },
      { col: "imsbc_group", label: "Group", type: "text", required: true, w: 90 },
      { col: "un_number", label: "UN no.", type: "text", nullable: true, w: 84 },
      { col: "notes", label: "Notes", type: "text", nullable: true, w: 200 },
      { col: "is_active", label: "Active", type: "bool", def: true, w: 74 },
    ],
  },
  {
    id: "css_categories",
    label: "CSS categories",
    table: "css_categories",
    keyCol: "code",
    searchCols: ["code", "name"],
    columns: [
      { col: "code", label: "Code", type: "text", editable: false, w: 84 },
      { col: "name", label: "Name", type: "text", required: true, w: 170 },
      { col: "annex", label: "Annex", type: "text", nullable: true, w: 110 },
      { col: "definition", label: "Definition", type: "text", nullable: true, w: 240 },
      { col: "securing_trigger", label: "Securing trigger", type: "text", nullable: true, w: 200 },
      { col: "market_aliases", label: "Market aliases", type: "list", nullable: true, w: 220 },
      { col: "sort_order", label: "Sort", type: "int", def: 100, w: 70 },
      { col: "is_active", label: "Active", type: "bool", def: true, w: 74 },
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
  if (type === "list") {
    if (Array.isArray(raw)) return raw.length ? raw : null;
    const items = String(raw).split(/[;,]/).map((s) => s.trim()).filter(Boolean);
    return items.length ? items : null;
  }
  return String(raw);
}

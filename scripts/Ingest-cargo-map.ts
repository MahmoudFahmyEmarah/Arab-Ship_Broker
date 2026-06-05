import * as path from "path";
import * as fs from "fs";
import * as xlsx from "xlsx";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ── env ──────────────────────────────────────────────────────
try {
  process.loadEnvFile(path.resolve(process.cwd(), ".env"));
} catch {
  /* ok — .env is optional if vars are already in environment */
}

const SUPABASE_URL =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_KEY ??
  "";

const DEFAULT_FILENAMES = ["ArabShipBroker CargoMap v3 05May2026.xlsx"];

function resolveExcelPath(): string {
  if (process.argv[2]) return path.resolve(process.cwd(), process.argv[2]);
  if (process.env.CARGO_MAP_XLSX_PATH)
    return path.resolve(process.cwd(), process.env.CARGO_MAP_XLSX_PATH);
  for (const name of DEFAULT_FILENAMES) {
    const p = path.resolve(__dirname, name);
    if (fs.existsSync(p)) return p;
  }
  return path.resolve(__dirname, DEFAULT_FILENAMES[0]);
}

const EXCEL_PATH = resolveExcelPath();
const APPROVED_AT = new Date().toISOString();

// ── types ─────────────────────────────────────────────────────
type Row = Record<string, unknown>;

// ── zone / status constants ───────────────────────────────────
const ZONE_ALIASES: Record<string, string> = {
  "B.SEA": "B.SEA",
  "BLACK SEA": "B.SEA",
  "E.MED": "E.MED",
  "EAST MED": "E.MED",
  "EAST MEDITERRANEAN": "E.MED",
  "W.MED": "W.MED",
  "WEST MED": "W.MED",
  "C.MED": "C.MED",
  "CENTRAL MED": "C.MED",
  ADRIATIC: "ADRIATIC",
  "R.SEA": "R.SEA",
  "RED SEA": "R.SEA",
  AG: "AG",
  "ARABIAN GULF": "AG",
  "PERSIAN GULF": "AG",
  "A.SEA": "A.SEA",
  "ARABIAN SEA": "A.SEA",
  WCAF: "WCAF",
  "WEST COAST AFRICA": "WCAF",
  ECAF: "ECAF",
  "EAST COAST AFRICA": "ECAF",
  NCONT: "NCONT",
  "NORTH CONTINENT": "NCONT",
  CARIB: "CARIB",
  CARIBBEAN: "CARIB",
  "F.EAST": "F.EAST",
  "FAR EAST": "F.EAST",
  ECI: "ECI",
  "EAST COAST INDIA": "ECI",
  WCI: "Unknown",
  "WEST COAST INDIA": "Unknown",
  UNKNOWN: "Unknown",
  "--": "Unknown",
  "-": "Unknown",
  "N/A": "Unknown",
  NA: "Unknown",
};

const VALID_ZONES = new Set([
  "B.SEA",
  "E.MED",
  "W.MED",
  "C.MED",
  "ADRIATIC",
  "R.SEA",
  "AG",
  "A.SEA",
  "WCAF",
  "ECAF",
  "NCONT",
  "CARIB",
  "F.EAST",
  "ECI",
  "Unknown",
]);

const CARGO_STATUS_MAP: Record<string, string> = {
  IN: "IN",
  PARTIAL: "PARTIAL",
  OUT: "OUT",
  CLOSED: "CLOSED",
};

// Commodity categories that map to is_grain_cargo = true
const GRAIN_CATEGORIES = new Set(["GRAINS & OILSEEDS", "GRAINS AND OILSEEDS"]);

// ── primitive helpers ─────────────────────────────────────────

function toStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s.length ? s : null;
}

function toInt(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = parseInt(String(val).replace(/,/g, "").trim(), 10);
  return isNaN(n) ? null : n;
}

function toNumeric(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = parseFloat(String(val).replace(/,/g, "").trim());
  return isNaN(n) ? null : n;
}

function toMidnightUtc(dateStr: string | null): string | null {
  return dateStr ? `${dateStr}T00:00:00.000Z` : null;
}

function isSpot(val: unknown): boolean {
  if (val === null || val === undefined) return true;
  return String(val).trim().toUpperCase() === "SPOT";
}

function stripNulls<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== null && v !== undefined),
  ) as Partial<T>;
}

// ── date helpers ──────────────────────────────────────────────

function toDateStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const s = String(val).trim();
  if (!s || s.toUpperCase() === "SPOT") return null;
  if (/^\d{4,6}$/.test(s)) return null; // raw Excel serial, handled below

  const patterns: Array<{
    re: RegExp;
    parse: (m: RegExpMatchArray) => string;
  }> = [
    {
      re: /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/,
      parse: (m) => {
        const M: Record<string, string> = {
          jan: "01",
          feb: "02",
          mar: "03",
          apr: "04",
          may: "05",
          jun: "06",
          jul: "07",
          aug: "08",
          sep: "09",
          oct: "10",
          nov: "11",
          dec: "12",
        };
        const mon = M[m[2].toLowerCase()];
        return mon ? `${m[3]}-${mon}-${m[1].padStart(2, "0")}` : "";
      },
    },
    {
      re: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      parse: (m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
    },
    {
      re: /^(\d{4})-(\d{2})-(\d{2})$/,
      parse: (m) => `${m[1]}-${m[2]}-${m[3]}`,
    },
    {
      re: /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
      parse: (m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
    },
    {
      re: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
      parse: (m) => `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`,
    },
  ];

  for (const { re, parse } of patterns) {
    const m = s.match(re);
    if (m) {
      const r = parse(m);
      if (r) return r;
    }
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function excelSerialToDateStr(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  const n = Number(String(val).replace(/,/g, "").trim());
  if (!isNaN(n) && Number.isFinite(n) && n > 1000) {
    const ms = new Date(Date.UTC(1899, 11, 30)).getTime() + n * 86400000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return toDateStr(val);
}

// ── domain normalisers ────────────────────────────────────────

function normaliseZone(raw: unknown): string {
  const key = (toStr(raw) ?? "").toUpperCase();
  if (!key) return "Unknown";
  const mapped = ZONE_ALIASES[key] ?? key;
  return VALID_ZONES.has(mapped) ? mapped : "Unknown";
}

function normaliseLocode(raw: unknown): string | null {
  const v = toStr(raw);
  if (!v) return null;
  const lc = v.toUpperCase().replace(/\s+/g, "");
  if (["--", "-", "N/A", "NA", "UNKNOWN", "TBN", "SPOT"].includes(lc))
    return null;
  return /^[A-Z0-9]{5}$/.test(lc) ? lc : null;
}

function normaliseCargoType(raw: unknown): string {
  return (toStr(raw) ?? "").toUpperCase().includes("BREAK")
    ? "Break Bulk"
    : "Dry Bulk";
}

function normaliseVesselType(raw: unknown): string {
  const k = (toStr(raw) ?? "").toUpperCase();
  if (!k) return "General Cargo";
  if (k.includes("BULK") || k.includes("SINGLE DECK")) return "Bulk Carrier";
  if (
    k.includes("GENERAL") ||
    k.includes("GC") ||
    k.includes("MPP") ||
    k.includes("DECKER") ||
    k.includes("BOX") ||
    k.includes("MULTI") ||
    k.includes("TWEEN")
  )
    return "General Cargo";
  return "Other";
}

function normalisePortType(
  raw: unknown,
): "Sea Port" | "River Port" | "Sea/River" {
  const s = (toStr(raw) ?? "").toLowerCase();
  if (s.includes("sea/river") || s.includes("river/sea")) return "Sea/River";
  if (s.includes("river")) return "River Port";
  return "Sea Port";
}

function normaliseImsbcCategory(
  raw: unknown,
): "Cat_A" | "Cat_B" | "Cat_C" | "DG" | "Non_DG" {
  const map: Record<string, "Cat_A" | "Cat_B" | "Cat_C" | "DG" | "Non_DG"> = {
    CAT_A: "Cat_A",
    CAT_B: "Cat_B",
    CAT_C: "Cat_C",
    DG: "DG",
    NON_DG: "Non_DG",
    A: "Cat_A",
    B: "Cat_B",
    C: "Cat_C",
  };
  const k = (toStr(raw) ?? "").toUpperCase().replace(/[\s-]/g, "_");
  return map[k] ?? "Non_DG";
}

function normaliseLoadTerms(raw: unknown): string | null {
  const k = (toStr(raw) ?? "").toUpperCase().replace(/\//g, " ").trim();
  if (!k || ["--", "-", "N/A", "NA"].includes(k)) return null;
  const map: Record<string, string> = {
    FIO: "FIO",
    FIOT: "FIOT",
    FIOS: "FIOS",
    FIOST: "FIOST",
    "FIOS LSD": "FIOS LSD",
    LINER: "Liner Terms",
    "LINER TERMS": "Liner Terms",
  };
  return map[k] ?? null;
}

function normaliseCargoPriority(raw: unknown): string | null {
  const k = (toStr(raw) ?? "").toUpperCase();
  if (!k || ["--", "-", "N/A", "NA"].includes(k)) return null;
  if (["HIGH", "H", "URGENT"].includes(k)) return "HIGH";
  if (["MED", "MEDIUM", "M"].includes(k)) return "MED";
  if (["LOW", "L"].includes(k)) return "LOW";
  if (k === "CLOSED") return "CLOSED";
  return null;
}

/**
 * Derive is_grain_cargo from the COMMODITY_CATEGORY column.
 * Falls back to false if category is absent.
 */
function deriveIsGrain(commodityCategoryRaw: unknown): boolean {
  const cat = (toStr(commodityCategoryRaw) ?? "").toUpperCase();
  return GRAIN_CATEGORIES.has(cat);
}

// ── sheet loader ──────────────────────────────────────────────
/**
 * Loads a worksheet into an array of row objects.
 * Headers are normalised: trim → uppercase → spaces→underscores.
 *
 * When the same header appears more than once (e.g. two DESPATCH columns),
 * the second and subsequent occurrences are suffixed _2, _3, etc.
 * so no data is silently discarded.
 */
function loadSheet(workbook: xlsx.WorkBook, sheetName: string): Row[] {
  const ws = workbook.Sheets[sheetName];
  if (!ws) {
    console.warn(`  WARN: sheet "${sheetName}" not found — skipping.`);
    return [];
  }

  // First pass (raw: false) to find header row index
  const rawFalse: unknown[][] = xlsx.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: false,
  }) as unknown[][];

  let headerIdx = 1;
  for (let i = 1; i < rawFalse.length; i++) {
    if ((rawFalse[i] as unknown[]).slice(0, 5).some((v) => v != null)) {
      headerIdx = i;
      break;
    }
  }

  // Second pass (raw: true) — preserves numeric Excel serials for date columns
  const rawTrue: unknown[][] = xlsx.utils.sheet_to_json(ws, {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];

  // Build normalised, de-duplicated header list
  const seenHeaders: Record<string, number> = {};
  const headers: string[] = (rawTrue[headerIdx] as unknown[]).map((h, i) => {
    const base =
      h != null
        ? String(h).trim().toUpperCase().replace(/\s+/g, "_")
        : `COL_${i}`;
    if (seenHeaders[base] === undefined) {
      seenHeaders[base] = 1;
      return base;
    } else {
      seenHeaders[base]++;
      return `${base}_${seenHeaders[base]}`;
    }
  });

  // Build row objects
  const rows: Row[] = [];
  for (let i = headerIdx + 1; i < rawTrue.length; i++) {
    const arr = rawTrue[i] as unknown[];
    if (!arr || arr.every((v) => v == null)) continue;
    const obj: Row = {};
    headers.forEach((h, idx) => {
      obj[h] = arr[idx] ?? null;
    });
    rows.push(obj);
  }

  return rows;
}

// get() with fallback aliases — tries each key in order, returns first hit
function get(row: Row, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = row[k];
    if (v !== null && v !== undefined) return v;
  }
  return null;
}

// ── port cache ────────────────────────────────────────────────
const seenLocodes = new Set<string>();

async function ensurePort(
  supabase: SupabaseClient,
  locode: string | null,
  tradeName: string | null,
  country: string | null,
  zone: string,
): Promise<string | null> {
  if (!locode) return null;
  if (seenLocodes.has(locode)) return locode;

  const { error } = await supabase.from("ports").upsert(
    {
      locode,
      trade_name: tradeName ?? locode,
      country: country ?? "Unknown",
      zone: normaliseZone(zone),
      is_verified: false,
      notes: "Seeded by Excel ingest",
    },
    { onConflict: "locode", ignoreDuplicates: true },
  );

  if (error) {
    console.warn(`  WARN port ${locode}: ${error.message}`);
    return null;
  }
  seenLocodes.add(locode);
  return locode;
}

// ─────────────────────────────────────────────────────────────
// SHEET 1: PORT_CODES
// Columns: LOCODE, TRADE_NAME, COUNTRY, ZONE, PORT_TYPE, NOTES
// ─────────────────────────────────────────────────────────────

async function ingestPortCodes(
  supabase: SupabaseClient,
  workbook: xlsx.WorkBook,
): Promise<{ upserted: number; skipped: number }> {
  const rows = loadSheet(workbook, "PORT_CODES");
  if (!rows.length) return { upserted: 0, skipped: 0 };

  let upserted = 0,
    skipped = 0;

  for (const row of rows) {
    const locode = normaliseLocode(get(row, "LOCODE", "LOCODE_CODE"));
    if (!locode) {
      skipped++;
      continue;
    }

    const tradeName =
      toStr(get(row, "TRADE_NAME", "PORT_NAME", "NAME")) ?? locode;
    const country = toStr(get(row, "COUNTRY")) ?? "Unknown";
    const zone = normaliseZone(get(row, "ZONE"));
    const portType = normalisePortType(get(row, "PORT_TYPE", "TYPE"));
    const lat = toNumeric(get(row, "LATITUDE", "LAT"));
    const lng = toNumeric(get(row, "LONGITUDE", "LON", "LNG"));

    // Default is_verified=true for the PORT_CODES reference sheet
    const verRaw = toStr(get(row, "IS_VERIFIED", "VERIFIED")) ?? "YES";
    const isVerified = /^(yes|true|1)$/i.test(verRaw);

    const { error } = await supabase.from("ports").upsert(
      {
        locode,
        trade_name: tradeName,
        country,
        zone,
        port_type: portType,
        latitude: lat,
        longitude: lng,
        is_verified: isVerified,
        is_active: true,
        notes: toStr(get(row, "NOTES")),
      },
      { onConflict: "locode" },
    );

    if (error) {
      console.error(`  ERROR port ${locode}: ${error.message}`);
      skipped++;
    } else {
      seenLocodes.add(locode);
      upserted++;
    }
  }

  return { upserted, skipped };
}

// ─────────────────────────────────────────────────────────────
// SHEET 2: CARGO_LOG
//
// Key fixes vs old script:
//   - CONGESTION is not a DB column → its text is appended to notes
//   - DEMURRAGE_TBAR is not a DB column → dropped
//   - Duplicate DESPATCH header → use DESPATCH (col 31) for despatch_rate
//     (the second occurrence is now keyed DESPATCH_2 by loadSheet)
//   - COMMODITY_CATEGORY → derives is_grain_cargo
//   - Multi-port LOCODEs are ensured in public.ports even though
//     cargo_listings has no multi-port columns
// ─────────────────────────────────────────────────────────────

async function ingestCargoLog(
  supabase: SupabaseClient,
  workbook: xlsx.WorkBook,
): Promise<{ upserted: number; skipped: number }> {
  const rows = loadSheet(workbook, "CARGO_LOG");
  let upserted = 0,
    skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // REF — required
    const rawRef = toStr(get(row, "REF", "REFERENCE", "CARGO_REF", "CARGO_ID"));
    const batchRef = toStr(get(row, "BATCH", "BATCH_REF", "BATCH_CODE"));
    const ref =
      rawRef ??
      (batchRef ? `${batchRef}-${String(i + 1).padStart(4, "0")}` : null);
    if (!ref) {
      skipped++;
      continue;
    }

    // Status
    const rawStatus = (toStr(get(row, "STATUS")) ?? "OUT").toUpperCase();
    const status = CARGO_STATUS_MAP[rawStatus] ?? "OUT";

    // Laycan
    const laycanFromRaw = get(
      row,
      "LAYCAN_FROM",
      "LAYCAN_FROM_DATE",
      "L/C_FROM",
      "FROM",
    );
    const spot = isSpot(laycanFromRaw);
    const laycanFrom = spot ? null : excelSerialToDateStr(laycanFromRaw);
    const laycanTo = excelSerialToDateStr(
      get(row, "LAYCAN_TO", "LAYCAN_TO_DATE", "L/C_TO", "TO"),
    );

    // Quantity
    let qtyMin = toInt(
      get(row, "QTY_MIN_MT", "QTY_MIN_(MT)", "MIN_QTY", "QTY_MIN", "MIN"),
    );
    let qtyMax = toInt(
      get(row, "QTY_MAX_MT", "QTY_MAX_(MT)", "MAX_QTY", "QTY_MAX", "MAX"),
    );
    if (qtyMin === null && qtyMax !== null) qtyMin = qtyMax;
    if (qtyMax === null && qtyMin !== null) qtyMax = qtyMin;
    if (qtyMin === null || qtyMax === null) {
      console.warn(`  WARN cargo ${ref}: missing quantity — skipping`);
      skipped++;
      continue;
    }
    if (qtyMin > qtyMax) [qtyMin, qtyMax] = [qtyMax, qtyMin];

    // goes_live_at
    const goesLive =
      toMidnightUtc(
        excelSerialToDateStr(
          get(row, "BATCH_DATE", "BATCH_DATE_DATE", "GOES_LIVE", "DATE"),
        ),
      ) ?? APPROVED_AT;

    // Zones + primary ports
    const loadZone = normaliseZone(
      get(row, "LOAD_ZONE", "L_ZONE", "LOAD_AREA"),
    );
    const dischZone = normaliseZone(
      get(row, "DISCH_ZONE", "D_ZONE", "DISCH_AREA", "DISCHARGE_ZONE"),
    );

    const loadLocode = await ensurePort(
      supabase,
      normaliseLocode(
        get(row, "LOAD_LOCODE", "L_LOCODE", "LOAD_LOC", "LOCODE_LOAD"),
      ),
      toStr(get(row, "LOAD_PORT", "LOAD_PORT_NAME", "L_PORT")),
      toStr(get(row, "LOAD_COUNTRY", "L_COUNTRY")),
      loadZone,
    );

    const dischLocode = await ensurePort(
      supabase,
      normaliseLocode(
        get(row, "DISCH_LOCODE", "D_LOCODE", "DISCH_LOC", "LOCODE_DISCH"),
      ),
      toStr(
        get(row, "DISCH_PORT", "DISCH_PORT_NAME", "DISCHARGE_PORT", "D_PORT"),
      ),
      toStr(get(row, "DISCH_COUNTRY", "D_COUNTRY", "DISCHARGE_COUNTRY")),
      dischZone,
    );

    // Multi-port LOCODEs — ensure they exist in public.ports even though
    // cargo_listings has no columns for them (DB doesn't support multi-port yet)
    for (const n of [2, 3, 4]) {
      const lp = normaliseLocode(get(row, `LOAD_LOCODE_${n}`));
      const lpName = toStr(get(row, `LOAD_PORT_${n}`));
      if (lp)
        await ensurePort(
          supabase,
          lp,
          lpName,
          toStr(get(row, "LOAD_COUNTRY", "L_COUNTRY")),
          loadZone,
        );

      const dp = normaliseLocode(get(row, `DISCH_LOCODE_${n}`));
      const dpName = toStr(get(row, `DISCH_PORT_${n}`));
      if (dp)
        await ensurePort(
          supabase,
          dp,
          dpName,
          toStr(get(row, "DISCH_COUNTRY", "D_COUNTRY")),
          dischZone,
        );
    }

    // Laytime — use dedicated column first, then combine rates
    let laytimeStructure = toStr(
      get(row, "LAYTIME_STRUCTURE", "LAYTIME", "LAYTO"),
    );
    if (!laytimeStructure) {
      const lr = toStr(get(row, "LOAD_RATE", "L_RATE"));
      const dr = toStr(get(row, "DISCH_RATE", "D_RATE", "DISCHARGE_RATE"));
      if (lr && dr) laytimeStructure = `${lr} / ${dr}`;
    }

    // CONGESTION — not a DB column.
    // Append its value to notes so the intel is not lost.
    const congestionNote = toStr(get(row, "CONGESTION"));
    const rawNotes = toStr(get(row, "NOTES", "REMARKS"));
    const combinedNotes =
      [rawNotes, congestionNote].filter(Boolean).join(" | ") || null;

    // COMMODITY_CATEGORY → is_grain_cargo
    const commodityCategory = get(row, "COMMODITY_CATEGORY", "CATEGORY");
    const isGrain = deriveIsGrain(commodityCategory);

    // DESPATCH — col 31 in this workbook is despatch_rate (numeric).
    // The duplicate header at col 32 is now keyed DESPATCH_2 by loadSheet,
    // so get(row, "DESPATCH") safely refers only to col 31.
    const despatchRate = toNumeric(
      get(row, "DESPATCH", "DESPATCH_RATE", "DESP_RATE"),
    );

    const record = stripNulls({
      ref,
      status,
      review_status: "APPROVED",
      goes_live_at: goesLive,
      cargo_type: normaliseCargoType(
        get(row, "CARGO_TYPE", "TYPE", "CARGO_TYPE_NAME"),
      ),
      commodity_name: toStr(
        get(row, "COMMODITY", "COMMODITY_NAME", "CARGO_NAME"),
      ),
      is_grain_cargo: isGrain || undefined, // only set when true to avoid false negatives
      qty_min_mt: qtyMin,
      qty_max_mt: qtyMax,
      stowage_factor: toNumeric(
        get(row, "STOWAGE_FACTOR", "SF_M3T", "SF_(M3/T)", "SF_(M³/T)", "SF"),
      ),
      load_port_locode: loadLocode,
      load_port_name: toStr(get(row, "LOAD_PORT", "LOAD_PORT_NAME", "L_PORT")),
      load_zone: loadZone,
      load_country: toStr(get(row, "LOAD_COUNTRY", "L_COUNTRY")),
      disch_port_locode: dischLocode,
      disch_port_name: toStr(
        get(row, "DISCH_PORT", "DISCH_PORT_NAME", "DISCHARGE_PORT", "D_PORT"),
      ),
      disch_zone: dischZone,
      disch_country: toStr(
        get(row, "DISCH_COUNTRY", "D_COUNTRY", "DISCHARGE_COUNTRY"),
      ),
      laycan_from: laycanFrom,
      laycan_to: laycanTo,
      is_spot: spot,
      load_rate: toStr(get(row, "LOAD_RATE", "L_RATE")),
      disch_rate: toStr(get(row, "DISCH_RATE", "D_RATE", "DISCHARGE_RATE")),
      load_terms: normaliseLoadTerms(
        get(row, "LOAD_TERMS", "L_TERMS", "TERMS"),
      ),
      laytime_structure: laytimeStructure,
      nor_clause: toStr(get(row, "NOR_CLAUSE", "NOR")),
      freight_idea_usd_mt: toNumeric(
        get(
          row,
          "FREIGHT_IDEA_USD_MT",
          "FREIGHT_USD_MT",
          "FREIGHT_($/MT)",
          "FREIGHT",
          "FRT",
        ),
      ),
      commission_pct: toNumeric(
        get(row, "COMMISSION_PCT", "COMM_PCT", "COMM_%", "COMMISSION"),
      ),
      demurrage_rate: toNumeric(
        get(
          row,
          "DEMURRAGE_RATE",
          "DEM_RATE",
          "DEMURRAGE_($/DAY)",
          "DEMURRAGE",
        ),
      ),
      despatch_rate: despatchRate,
      // NOTE: CONGESTION and DEMURRAGE_TBAR are NOT columns in cargo_listings
      // CONGESTION content has been merged into notes above
      // DEMURRAGE_TBAR is empty in this workbook and has no DB column
      broker: toStr(
        get(row, "BROKER", "BROKER_SOURCE", "BROKER_/_SOURCE", "SOURCE"),
      ),
      priority: normaliseCargoPriority(get(row, "PRIORITY", "PRIO")),
      notes: combinedNotes,
    });

    const { error } = await supabase
      .from("cargo_listings")
      .upsert(record, { onConflict: "ref" });

    if (error) {
      console.error(`  ERROR cargo ${ref}: ${error.message}`);
      skipped++;
    } else {
      upserted++;
    }
  }

  return { upserted, skipped };
}

// ─────────────────────────────────────────────────────────────
// SHEET 3: VESSEL_LOG
//
// Upserts vessels by name, then upserts vessel_availability by ref.
// BUILT column sometimes contains shipyard name (e.g. "Sidmar") instead
// of a year — toInt() returns null for those, which is correct.
// ─────────────────────────────────────────────────────────────

async function ingestVesselLog(
  supabase: SupabaseClient,
  workbook: xlsx.WorkBook,
): Promise<{ vessels: number; availabilities: number; skipped: number }> {
  const rows = loadSheet(workbook, "VESSEL_LOG");
  let vessels = 0,
    availabilities = 0,
    skipped = 0;

  for (const row of rows) {
    const vesselRef = toStr(get(row, "REF", "VESSEL_REF"));
    const vesselName = toStr(get(row, "VESSEL_NAME", "VESSEL", "NAME"));
    if (!vesselName) {
      skipped++;
      continue;
    }

    // Gear
    const gearRaw = (
      toStr(get(row, "GEAR", "GEAR_GRABS", "GEAR/GRABS")) ?? ""
    ).toLowerCase();
    const isGeared = gearRaw
      ? !gearRaw.includes("gearless") && !gearRaw.includes("no gear")
      : null;

    // Grain CBM — strip commas before parsing
    const grainCbmRaw = toStr(
      get(row, "GRAIN_CBM", "GRAIN_HOLD_CBM", "GRAIN CBM"),
    );
    const grainCbm = grainCbmRaw ? toInt(grainCbmRaw.replace(/,/g, "")) : null;

    // Sanctions check
    const restrictionsRaw =
      toStr(get(row, "RESTRICTIONS", "TRADING_RESTRICTIONS", "RESTRICT")) ?? "";
    const isSanctioned = /SANCTION|IRAN/i.test(restrictionsRaw);

    const vesselRecord = stripNulls({
      vessel_name: vesselName,
      vessel_type: normaliseVesselType(get(row, "TYPE", "VESSEL_TYPE")),
      dwt_grain: toInt(get(row, "DWT", "DWT_MT", "DWT_GRAIN")),
      dwt_bale: toInt(get(row, "DWCC", "DWT_BALE", "DWCC_MT")),
      // BUILT can be a shipyard name like "Sidmar" — toInt returns null safely
      build_year: toInt(get(row, "BUILT", "BUILD_YEAR", "YEAR_BUILT")),
      flag: toStr(get(row, "FLAG", "FLAG_STATE")),
      max_loa_m: toNumeric(get(row, "LOA_M", "LOA", "LOA_(M)")),
      max_draft_m: toNumeric(get(row, "DRAFT_M", "SUMMER_DRAFT", "DRAFT_(M)")),
      beam_m: toNumeric(get(row, "BEAM_M", "BEAM", "BEAM_(M)")),
      is_geared: isGeared,
      grain_cbm: grainCbm,
      vessel_class: toStr(
        get(row, "CLASS", "VESSEL_CLASS", "CLASS_SOCIETY", "CLASS/SOCIETY"),
      ),
      direction_pref: toStr(
        get(row, "DIRECTION", "DIRECTION_PREF", "DIR_PREF"),
      ),
      charter_type: toStr(get(row, "CHARTER_TYPE", "CHARTER")),
      source_channel: toStr(
        get(row, "SOURCE", "SOURCE_CHANNEL", "BROKER_SOURCE", "BROKER/SOURCE"),
      ),
      notes: toStr(get(row, "NOTES", "REMARKS")),
      scope: "In Scope",
      risk_level: isSanctioned ? "HIGH" : "CLEAR",
      is_sanctioned: isSanctioned,
    });

    // Upsert vessel by name
    const { data: existing, error: lookupErr } = await supabase
      .from("vessels")
      .select("id")
      .eq("vessel_name", vesselName)
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error(`  ERROR lookup "${vesselName}": ${lookupErr.message}`);
      skipped++;
      continue;
    }

    let vesselId: string;

    if (existing) {
      vesselId = existing.id as string;
      const { error: upErr } = await supabase
        .from("vessels")
        .update(vesselRecord)
        .eq("id", vesselId);
      if (upErr)
        console.warn(`  WARN update "${vesselName}": ${upErr.message}`);
    } else {
      const { data: created, error: createErr } = await supabase
        .from("vessels")
        .insert(vesselRecord)
        .select("id")
        .single();
      if (createErr || !created) {
        console.error(`  ERROR create "${vesselName}": ${createErr?.message}`);
        skipped++;
        continue;
      }
      vesselId = created.id as string;
    }

    vessels++;

    // vessel_availability
    const openZone = normaliseZone(
      get(row, "OPEN_ZONE", "ZONE", "OPEN_AREA", "AREA"),
    );
    const openLocode = await ensurePort(
      supabase,
      normaliseLocode(
        get(row, "OPEN_LOCODE", "LOCODE", "OPEN_PORT_LOCODE", "OPEN_LOC"),
      ),
      toStr(get(row, "OPEN_PORT", "OPEN_PORT_NAME", "PORT")),
      toStr(get(row, "OPEN_COUNTRY", "COUNTRY")),
      openZone,
    );

    // OPEN_FROM / OPEN_TO are Excel serials in this file (e.g. 46128)
    const openDate = excelSerialToDateStr(
      get(row, "OPEN_FROM", "OPEN_DATE", "OPEN"),
    );
    const batchDate = excelSerialToDateStr(
      get(row, "BATCH_DATE", "BATCH", "DATE"),
    );
    const goesLive = toMidnightUtc(batchDate) ?? APPROVED_AT;

    const rawVaStatus = (toStr(get(row, "STATUS")) ?? "OPEN").toUpperCase();
    const vaStatus = ["OPEN", "SPOT"].includes(rawVaStatus)
      ? "OPEN"
      : "INACTIVE";

    const vaRecord = stripNulls({
      ...(vesselRef ? { ref: vesselRef } : {}),
      vessel_id: vesselId,
      open_port_locode: openLocode,
      open_zone: openZone !== "Unknown" ? openZone : null,
      open_date: openDate,
      status: vaStatus,
      review_status: "APPROVED",
      goes_live_at: goesLive,
      accepts_part_cargo: false,
      notes: toStr(get(row, "NOTES", "REMARKS")),
    });

    const { error: vaErr } = vesselRef
      ? await supabase
          .from("vessel_availability")
          .upsert(vaRecord, { onConflict: "ref" })
      : await supabase.from("vessel_availability").insert(vaRecord);

    if (vaErr) {
      console.error(`  ERROR availability "${vesselName}": ${vaErr.message}`);
    } else {
      availabilities++;
    }
  }

  return { vessels, availabilities, skipped };
}

// ── main ──────────────────────────────────────────────────────
async function main() {
  if (!SUPABASE_URL) {
    throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL.");
  }
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY. The anon key cannot bypass RLS for upserts.",
    );
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });

  if (!fs.existsSync(EXCEL_PATH)) {
    console.error(`\nFile not found: ${EXCEL_PATH}`);
    console.error(
      "Pass the path as the first argument:\n  npx tsx scripts/Ingest-cargo-map.ts ./path/to/file.xlsx\n",
    );
    process.exit(1);
  }

  console.log(`\nReading: ${path.basename(EXCEL_PATH)}`);
  const workbook = xlsx.readFile(EXCEL_PATH, { cellDates: false, raw: true });
  const sheets = workbook.SheetNames;
  console.log(`Sheets  : ${sheets.join(", ")}\n`);

  // 1 — Ports first (referenced by cargo and vessel rows)
  if (sheets.includes("PORT_CODES")) {
    console.log("── PORT_CODES ──────────────────────");
    const r = await ingestPortCodes(supabase, workbook);
    console.log(`   Upserted: ${r.upserted}   Skipped: ${r.skipped}\n`);
  } else {
    console.log("── PORT_CODES: sheet not found, skipping ──\n");
  }

  // 2 — Cargo listings
  if (sheets.includes("CARGO_LOG")) {
    console.log("── CARGO_LOG ───────────────────────");
    const r = await ingestCargoLog(supabase, workbook);
    console.log(`   Upserted: ${r.upserted}   Skipped: ${r.skipped}\n`);
  } else {
    console.log("── CARGO_LOG: sheet not found, skipping ──\n");
  }

  // 3 — Vessels + availability
  if (sheets.includes("VESSEL_LOG")) {
    console.log("── VESSEL_LOG ──────────────────────");
    const r = await ingestVesselLog(supabase, workbook);
    console.log(
      `   Vessels: ${r.vessels}   Availabilities: ${r.availabilities}   Skipped: ${r.skipped}\n`,
    );
  } else {
    console.log("── VESSEL_LOG: sheet not found, skipping ──\n");
  }

  console.log("── Done ────────────────────────────\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

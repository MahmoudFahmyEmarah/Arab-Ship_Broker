// Seeds the Broker Ledger reference data from the UNIFIED CargoMap workbook
// into the remote database via the service-role REST API (no DB password
// needed; RLS bypassed by the service key).
//
// Usage:
//   node scripts/seed-reference-data.mjs --dry-run     # report only
//   node scripts/seed-reference-data.mjs               # apply
//   node scripts/seed-reference-data.mjs --workbook "ArabShipBroker_UNIFIED_CargoMap_24Jul2026.xlsx"
//
// Behaviour:
//   • classification tables (market_names, grain_list, imsbc_codes,
//     css_categories) — straight upsert; the workbook is the source of truth.
//   • ports — insert workbook ports whose LOCODE (space-insensitive) is not
//     already present; existing rows are never modified.
//   • organizations (03_COMPANIES) — match by company IMO then name; new
//     registry columns (counts/links) always set from the workbook; other
//     fields fill-missing-only. Unmatched firms inserted.
//   • vessels (02_VESSELS) — match by IMO; fill-missing-only, never overwrite;
//     rows without an IMO are skipped (DQ-V02: never guess). New rows are
//     inserted unverified with source_tag "workbook_24jul:<SOURCE>".
//
// Rollback:
//   • classification tables: DELETE FROM public.market_names; (etc.) — they
//     hold only workbook rows.
//   • inserted vessels/organizations/ports: delete WHERE source_tag LIKE
//     'workbook_24jul%' (vessels/orgs) — only if no claims/availability
//     reference them; ports carry notes from the workbook and no source_tag,
//     so remove by the locode list this script prints on insert.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const ROOT = path.resolve(import.meta.dirname, "..");
const DRY = process.argv.includes("--dry-run");
const wbArg = process.argv.indexOf("--workbook");
const WORKBOOK = wbArg > -1 ? process.argv[wbArg + 1] : "ArabShipBroker_UNIFIED_CargoMap_24Jul2026.xlsx";
const SOURCE_TAG = "workbook_24jul";

// ── env / REST helpers ───────────────────────────────────────────────────────
const env = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
const URL_BASE = (process.env.SUPABASE_URL ?? env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)?.[1] ?? "").trim();
const KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)?.[1] ?? "").trim();
if (!URL_BASE || !KEY) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(pathname, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${pathname}`, { ...init, headers: { ...HEADERS, ...init.headers } });
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${pathname} → ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchAll(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = await rest(`${table}?select=${select}&limit=1000&offset=${from}`);
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function upsert(table, conflict, rows, label) {
  if (!rows.length) return console.log(`  ${label}: nothing to write`);
  if (DRY) return console.log(`  ${label}: WOULD upsert ${rows.length} rows`);
  for (let i = 0; i < rows.length; i += 200) {
    await rest(`${table}?on_conflict=${conflict}`, {
      method: "POST",
      headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
  }
  console.log(`  ${label}: upserted ${rows.length} rows`);
}

async function insert(table, rows, label) {
  if (!rows.length) return console.log(`  ${label}: nothing to insert`);
  if (DRY) return console.log(`  ${label}: WOULD insert ${rows.length} rows`);
  for (let i = 0; i < rows.length; i += 200) {
    await rest(table, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(rows.slice(i, i + 200)),
    });
  }
  console.log(`  ${label}: inserted ${rows.length} rows`);
}

async function patch(table, filter, body, label) {
  if (DRY) return console.log(`  ${label}: WOULD patch ${filter}`);
  await rest(`${table}?${filter}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
}

// ── workbook helpers ─────────────────────────────────────────────────────────
const wb = XLSX.readFile(path.join(ROOT, WORKBOOK));
const sheetRows = (name) =>
  XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null })
    .filter((r) => r.some((c) => c != null && c !== ""));

const s = (v) => (v == null ? null : String(v).trim() || null);
const num = (v) => { const n = Number(String(v ?? "").replace(/[, ]/g, "")); return Number.isFinite(n) ? n : null; };
const int = (v) => { const n = num(v); return n == null ? null : Math.round(n); };
const yn = (v) => { const t = s(v)?.toUpperCase(); return t === "Y" || t === "YES" || t === "TRUE" ? true : t === "N" || t === "NO" || t === "FALSE" ? false : null; };
const yearOf = (v) => { const n = int(v); return n != null && n >= 1900 && n <= 2035 ? n : null; };

const summary = [];

// ── 1. classification: market_names (05) ────────────────────────────────────
{
  const rows = sheetRows("05_CLASS_MARKET_NAME").slice(2); // title + header
  const REGIMES = new Set(["GRAIN", "IMSBC", "CSS"]);
  const out = [];
  for (const r of rows) {
    const name = s(r[0]);
    let regime = s(r[1])?.toUpperCase();
    let note = s(r[4]);
    if (!name || !regime) continue;
    if (regime === "MULTI-PARCEL") {
      // advisory entries — resolve to UNMAPPED with the multi-parcel note so
      // the UI can raise the "post each parcel separately" alert
      regime = "UNMAPPED";
      note = `MULTI-PARCEL: ${note ?? "post each parcel as a separate cargo"}`;
    }
    if (!REGIMES.has(regime) && regime !== "UNMAPPED") { console.warn(`  ! market_names: unknown regime "${regime}" for ${name} — skipped`); continue; }
    out.push({ market_name: name, regime, code: s(r[2]), group_or_cat: s(r[3]), note });
  }
  await upsert("market_names", "market_name", out, "market_names (05)");
  summary.push(["market_names", out.length]);
}

// ── 2. classification: grain_list (06) ──────────────────────────────────────
{
  const rows = sheetRows("06_CLASS_GRAIN").slice(2);
  const out = rows
    .filter((r) => s(r[0]) && !/^NOTE/i.test(s(r[0])) && s(r[2])?.toUpperCase() === "GRAIN")
    .map((r) => ({ market_name: s(r[0]), family: s(r[1]), requirement: s(r[3]) }));
  await upsert("grain_list", "market_name", out, "grain_list (06)");
  summary.push(["grain_list", out.length]);
}

// ── 3. classification: imsbc_codes (07) ─────────────────────────────────────
{
  const rows = sheetRows("07_CLASS_IMSBC").slice(2);
  const out = rows
    .filter((r) => s(r[0]) && s(r[1]))
    .map((r) => ({ bcsn: s(r[0]), imsbc_group: s(r[1]), un_number: s(r[2]), notes: s(r[3]) }));
  await upsert("imsbc_codes", "bcsn", out, "imsbc_codes (07)");
  summary.push(["imsbc_codes", out.length]);
}

// ── 4. classification: css_categories (08) ──────────────────────────────────
{
  const rows = sheetRows("08_CLASS_CSS").slice(2);
  const out = rows
    .filter((r) => /^CSS-\d\d$/.test(s(r[0]) ?? ""))
    .map((r, i) => ({
      code: s(r[0]),
      name: s(r[1]),
      annex: s(r[2]),
      definition: s(r[3]),
      securing_trigger: s(r[4]),
      market_aliases: s(r[5]) ? s(r[5]).split(/;/).map((x) => x.trim()).filter(Boolean) : null,
      sort_order: i + 1,
    }));
  await upsert("css_categories", "code", out, "css_categories (08)");
  summary.push(["css_categories", out.length]);
}

// ── 5. ports (04) — insert missing only ─────────────────────────────────────
{
  const PORT_TYPES = new Set(["Sea Port", "River Port", "Sea/River"]);
  const existing = await fetchAll("ports", "locode");
  const seen = new Set(existing.map((p) => p.locode.replace(/\s+/g, "").toUpperCase()));
  const rows = sheetRows("04_PORTS").slice(1);
  const out = [];
  for (const r of rows) {
    const locode = s(r[0])?.replace(/\s+/g, "").toUpperCase();
    if (!locode || !/^[A-Z]{2}[A-Z0-9]{3}$/.test(locode)) { console.warn(`  ! ports: bad LOCODE "${r[0]}" — skipped`); continue; }
    if (seen.has(locode)) continue;
    seen.add(locode);
    out.push({
      locode,
      trade_name: s(r[1]) ?? locode,
      country: s(r[2]) ?? "Unknown",
      zone: s(r[3]) ?? "Unknown",
      port_type: PORT_TYPES.has(s(r[4])) ? s(r[4]) : "Sea Port",
      notes: s(r[5]),
      is_verified: true,
      is_active: true,
    });
  }
  if (out.length) console.log(`  ports to insert: ${out.map((p) => p.locode).join(", ")}`);
  await insert("ports", out, "ports (04)");
  summary.push(["ports inserted", out.length]);
}

// ── 6. organizations (03_COMPANIES) ──────────────────────────────────────────
{
  const existing = await fetchAll("organizations", "id,name,imo,country,fleet_total,address,desk_contact_name,desk_phone,desk_email");
  const byImo = new Map(existing.filter((o) => s(o.imo)).map((o) => [s(o.imo), o]));
  const byName = new Map(existing.map((o) => [o.name.trim().toLowerCase(), o]));
  const rows = sheetRows("03_COMPANIES").slice(1);
  const inserts = [];
  let patched = 0;
  for (const r of rows) {
    const name = s(r[0]);
    if (!name) continue;
    const imo = s(r[1]);
    const fields = {
      country: s(r[2]),
      owns_count: int(r[3]),
      manages_comm_count: int(r[4]),
      ism_manages_count: int(r[5]),
      fleet_total: int(r[6]),
      address: s(r[7]),
      desk_contact_name: s(r[8]),
      desk_phone: s(r[9]),
      desk_email: s(r[10]),
      linked_to_imo: s(r[11]),
      link_note: s(r[12]),
      link_type: s(r[13]),
      source_tag: SOURCE_TAG,
    };
    const match = (imo && byImo.get(imo)) || byName.get(name.toLowerCase());
    if (match) {
      // registry columns always follow the workbook; identity fields fill-missing-only
      const body = {
        owns_count: fields.owns_count,
        manages_comm_count: fields.manages_comm_count,
        ism_manages_count: fields.ism_manages_count,
        linked_to_imo: fields.linked_to_imo,
        link_note: fields.link_note,
        link_type: fields.link_type,
        source_tag: SOURCE_TAG,
      };
      if (!s(match.imo) && imo) body.imo = imo;
      for (const k of ["country", "fleet_total", "address", "desk_contact_name", "desk_phone", "desk_email"]) {
        if (match[k] == null && fields[k] != null) body[k] = fields[k];
      }
      await patch("organizations", `id=eq.${match.id}`, body, `organizations: ${name}`);
      patched++;
    } else {
      inserts.push({ name, imo, org_type: "other", ...fields });
    }
  }
  await insert("organizations", inserts, "organizations (03) new firms");
  console.log(`  organizations: patched ${patched} existing`);
  summary.push(["organizations inserted", inserts.length], ["organizations patched", patched]);
}

// ── 7. vessels (02_VESSELS) — keyed by IMO, fill-missing-only ────────────────
{
  const rows = sheetRows("02_VESSELS");
  const header = rows[0].map((h) => s(h));
  const col = (name) => header.indexOf(name);
  const existing = await fetchAll(
    "vessels",
    "id,imo_number,vessel_name,dwt_grain,dwt_bale,grain_cbm,dwcc,build_year,flag,gross_tonnage,max_loa_m,max_draft_m,beam_m,class_society,charter_status,trading_zone_raw," +
    "num_holds,num_hatches,box_shaped,hatch_type,strengthened_heavy,holds_may_be_empty,log_fitted,is_geared,crane_count,crane_swl_mt," +
    "registered_owner,parent_group,technical_operator,disponent_owner,owner_company,manager_company,owner_address,phone,email_general,email_chartering,website,risk_notes,is_verified,source_tag",
  );
  const byImo = new Map(existing.filter((v) => s(v.imo_number)).map((v) => [s(v.imo_number), v]));

  const mapRow = (r) => {
    const g = (name) => r[col(name)];
    const vtypeRaw = s(g("VESSEL_TYPE"));
    const vessel_type = vtypeRaw === "Bulk Carrier" ? "Bulk Carrier" : vtypeRaw ? "General Cargo" : null;
    const src = s(g("SOURCE"));
    return {
      vessel_name: s(g("VESSEL_NAME"))?.toUpperCase(),
      imo_number: s(g("IMO")),
      vessel_type,
      dwt_grain: int(g("DWT")),
      build_year: yearOf(g("BUILT")),
      flag: s(g("FLAG")),
      gross_tonnage: (() => { const n = int(g("GRT")); return n != null && n >= 200 && n <= 80000 ? n : null; })(),
      max_loa_m: num(g("LOA_M")),
      beam_m: num(g("BEAM_M")),
      max_draft_m: num(g("DRAFT_M")),
      class_society: s(g("CLASS_SOCIETY")),
      charter_status: s(g("CHARTER_TYPE")),
      trading_zone_raw: s(g("TRADING_ZONE")),
      num_holds: (() => { const n = int(g("NUM_HOLDS")); return n != null && n >= 1 && n <= 9 ? n : null; })(),
      num_hatches: int(g("NUM_HATCHES")),
      box_shaped: yn(g("BOX_SHAPED")),
      hatch_type: ["side-rolling", "folding", "pontoon", "lift-away"].includes(s(g("HATCH_TYPE"))?.toLowerCase()) ? s(g("HATCH_TYPE")).toLowerCase() : null,
      strengthened_heavy: yn(g("STRENGTHENED_HEAVY")),
      holds_may_be_empty: s(g("HOLDS_MAY_BE_EMPTY")),
      log_fitted: yn(g("LOG_FITTED")),
      is_geared: yn(g("IS_GEARED")),
      crane_count: int(g("CRANE_COUNT")),
      crane_swl_mt: num(g("CRANE_SWL_MT")),
      dwt_bale: int(g("DWT_BALE")),
      grain_cbm: num(g("GRAIN_CBM")),
      dwcc: int(g("DWCC")),
      registered_owner: s(g("REG_OWNER_COMPANY")),
      owner_company: s(g("REG_OWNER_COMPANY")),
      manager_company: s(g("SHIP_COMM_MANAGER")),
      technical_operator: s(g("ISM_MANAGER")),
      owner_address: s(g("CONTACT_ADDRESS")),
      phone: s(g("PHONE")),
      email_general: s(g("EMAIL")),
      email_chartering: s(g("CHARTERING_EMAIL")),
      website: s(g("WEBSITE")),
      risk_notes: s(g("RISK_NOTES")),
      is_verified: yn(g("IS_VERIFIED")) ?? false,
      source_tag: src ? `${SOURCE_TAG}:${src}` : SOURCE_TAG,
    };
  };

  const inserts = [];
  let patched = 0, skippedNoImo = 0;
  for (const r of rows.slice(1)) {
    const mapped = mapRow(r);
    if (!mapped.vessel_name) continue;
    if (!mapped.imo_number || !/^\d{7}$/.test(mapped.imo_number)) { skippedNoImo++; continue; }
    const match = byImo.get(mapped.imo_number);
    if (match) {
      const body = {};
      for (const [k, v] of Object.entries(mapped)) {
        if (k === "imo_number" || k === "vessel_name" || k === "is_verified" || k === "source_tag") continue;
        if (v != null && match[k] == null) body[k] = v;
      }
      if (Object.keys(body).length) {
        await patch("vessels", `id=eq.${match.id}`, body, `vessels: ${mapped.vessel_name}`);
        patched++;
      }
    } else {
      if (!mapped.vessel_type) mapped.vessel_type = "General Cargo";
      inserts.push(mapped);
    }
  }
  await insert("vessels", inserts, "vessels (02) new registry records");
  console.log(`  vessels: patched ${patched} existing, skipped ${skippedNoImo} rows without a valid IMO`);
  summary.push(["vessels inserted", inserts.length], ["vessels patched", patched], ["vessels skipped (no IMO)", skippedNoImo]);
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`\n${DRY ? "DRY RUN — no changes written." : "Seed complete."}`);
for (const [k, v] of summary) console.log(`  ${String(k).padEnd(28)} ${v}`);

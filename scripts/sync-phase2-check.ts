/**
 * Phase 2 check — exercises the pure sync pipeline (map → diff → validate) with
 * fixtures, no database. Run:  npx tsx scripts/sync-phase2-check.ts
 * Prints a line per assertion; exits non-zero on the first failure.
 */
import { buildStagedRow, mapRow, cellEqual } from "@/lib/sync/diff";
import { specById } from "@/lib/sync/sheets";
import { parseLaycan, intStrip } from "@/lib/sync/normalize";
import type { Cell, RawRow } from "@/lib/sync/types";

let failed = 0;
function ok(name: string, cond: boolean) {
  console.log(`${cond ? "  ok  " : " FAIL "} ${name}`);
  if (!cond) failed++;
}
const noExisting = new Map<string, Record<string, Cell>>();

const cargo = specById("cargo")!;
const ports = specById("ports")!;

// ── normalizers ────────────────────────────────────────────────────────────
ok("intStrip strips commas", intStrip("12,500") === 12500);
ok("intStrip keeps raw on garbage", intStrip("12k") === "12k");
ok("parseLaycan SPOT → spot", parseLaycan("SPOT").isSpot === true && parseLaycan("SPOT").date === null);
ok("parseLaycan ISO date", parseLaycan("2026-06-10").date === "2026-06-10");
ok("parseLaycan garbage → bad", parseLaycan("whenever").bad === true);
ok("cellEqual numeric 5 vs '5'", cellEqual(5, "5") === true);
ok("cellEqual null vs ''", cellEqual(null, "") === true);

// ── cargo: new row, laycan SPOT, grain, comma qty ──────────────────────────
{
  const raw: RawRow = {
    REF: "CM-101", CARGO_TYPE: "Dry Bulk", COMMODITY: "Wheat",
    QTY_MIN_MT: "22,500", QTY_MAX_MT: "27,500", LAYCAN_FROM: "SPOT",
    LOAD_ZONE: "B.SEA", ASB_REGIME: "GRAIN", COMMISSION_PCT: "2.5",
  };
  const { payload } = mapRow(cargo, raw);
  ok("cargo qty comma→int", payload.qty_min_mt === 22500 && payload.qty_max_mt === 27500);
  ok("cargo SPOT → laycan_from null + is_spot", payload.laycan_from === null && payload.is_spot === true);
  ok("cargo GRAIN → is_grain_cargo", payload.is_grain_cargo === true);

  const row = buildStagedRow(cargo, raw, 1, noExisting);
  ok("cargo valid new → 'new'", row.classification === "new");
  ok("cargo valid new → no errors", row.flags.filter((f) => f.level === "error").length === 0);
}

// ── cargo: bad commission + missing commodity → invalid ────────────────────
{
  const raw: RawRow = { REF: "CM-102", CARGO_TYPE: "Dry Bulk", QTY_MIN_MT: "1000", QTY_MAX_MT: "2000", COMMISSION_PCT: "42" };
  const row = buildStagedRow(cargo, raw, 2, noExisting);
  ok("cargo commission 42 → error", row.flags.some((f) => f.field === "commission_pct" && f.level === "error"));
  ok("cargo missing commodity → error", row.flags.some((f) => f.field === "commodity_name" && f.level === "error"));
  ok("cargo with errors → 'invalid'", row.classification === "invalid");
}

// ── cargo: UNMAPPED regime → info flag (manual queue) ──────────────────────
{
  const raw: RawRow = { REF: "CM-103", CARGO_TYPE: "Break Bulk", COMMODITY: "Widgets", QTY_MIN_MT: "500", QTY_MAX_MT: "600", ASB_REGIME: "UNMAPPED" };
  const row = buildStagedRow(cargo, raw, 3, noExisting);
  ok("cargo UNMAPPED → info flag", row.flags.some((f) => f.field === "asb_regime" && f.level === "info"));
  ok("cargo UNMAPPED still commits (not invalid)", row.classification === "new");
}

// ── cargo: missing REF → invalid (no business key) ─────────────────────────
{
  const raw: RawRow = { CARGO_TYPE: "Dry Bulk", COMMODITY: "Corn", QTY_MIN_MT: "100", QTY_MAX_MT: "200" };
  const row = buildStagedRow(cargo, raw, 4, noExisting);
  ok("cargo no REF → invalid + null key", row.classification === "invalid" && row.businessKey === null);
}

// ── ports: update diff is partial + unchanged detection ────────────────────
{
  const existing = new Map<string, Record<string, Cell>>([
    ["EGALY", { locode: "EGALY", trade_name: "Alexandria", country: "Egypt", zone: "E.MED", latitude: 31.2 }],
  ]);
  const updated = buildStagedRow(ports, { LOCODE: "EGALY", PORT: "Alexandria Port", COUNTRY: "Egypt", ZONE: "E.MED" }, 1, existing);
  ok("ports changed name → 'updated'", updated.classification === "updated");
  ok("ports diff shows old→new name", updated.diff?.trade_name?.old === "Alexandria" && updated.diff?.trade_name?.new === "Alexandria Port");
  ok("ports diff excludes untouched country", updated.diff?.country === undefined);

  const same = buildStagedRow(ports, { LOCODE: "EGALY", PORT: "Alexandria", COUNTRY: "Egypt", ZONE: "E.MED" }, 2, existing);
  ok("ports identical → 'unchanged'", same.classification === "unchanged");

  const badZone = buildStagedRow(ports, { LOCODE: "ZZNEW", PORT: "X", COUNTRY: "Y", ZONE: "MIDDLE_EARTH" }, 3, noExisting);
  ok("ports bad zone → invalid", badZone.classification === "invalid" && badZone.flags.some((f) => f.field === "zone"));
}

// ── 05-Jul workbook alignment: priority, multi-port, load_terms case ───────
{
  const raw: RawRow = {
    REF: "CM-201", CARGO_TYPE: "Dry Bulk", COMMODITY: "Barley", QTY_MIN_MT: "5000", QTY_MAX_MT: "5000",
    PRIORITY: "CRITICAL", LOAD_TERMS: "Liner Terms",
    LOAD_PORT_2: "Constanta", LOAD_LOCODE_2: "ROCND", DISCH_PORT_3: "Izmir", DISCH_LOCODE_3: "TRIZM",
  };
  const { payload } = mapRow(cargo, raw);
  ok("cargo PRIORITY maps", payload.priority === "CRITICAL");
  ok("cargo load_terms mixed-case preserved", payload.load_terms === "Liner Terms");
  ok("cargo multi-port 2 locode maps", payload.load_port_2_locode === "ROCND" && payload.load_port_2_name === "Constanta");
  ok("cargo multi-port 3 disch maps", payload.disch_port_3_locode === "TRIZM");
  ok("cargo load_terms 'fios' → 'FIOS'", mapRow(cargo, { REF: "x", LOAD_TERMS: "fios" }).payload.load_terms === "FIOS");
  ok("cargo PRIORITY '--' → omitted", mapRow(cargo, { REF: "x", PRIORITY: "--" }).payload.priority === undefined);

  const badPr = buildStagedRow(cargo, { REF: "CM-202", CARGO_TYPE: "Dry Bulk", COMMODITY: "X", QTY_MIN_MT: "1", QTY_MAX_MT: "1", PRIORITY: "URGENT" }, 1, noExisting);
  ok("cargo bad priority → error", badPr.flags.some((f) => f.field === "priority" && f.level === "error"));
}

// ── ports: PORT_TYPE mapping + normalization + GLAKES zone ─────────────────
{
  const { payload } = mapRow(ports, { LOCODE: "USDUL", PORT: "Duluth", COUNTRY: "USA", ZONE: "GLAKES", PORT_TYPE: "seaport", NOTES: "Great Lakes" });
  ok("ports PORT_TYPE 'seaport' → 'Sea Port'", payload.port_type === "Sea Port");
  ok("ports NOTES maps", payload.notes === "Great Lakes");
  const glakes = buildStagedRow(ports, { LOCODE: "USDUL", PORT: "Duluth", COUNTRY: "USA", ZONE: "GLAKES" }, 1, noExisting);
  ok("ports GLAKES zone valid (not invalid)", glakes.classification === "new" && !glakes.flags.some((f) => f.field === "zone"));
  const badPt = buildStagedRow(ports, { LOCODE: "ZZBPT", PORT: "X", COUNTRY: "Y", ZONE: "AG", PORT_TYPE: "harbour" }, 2, noExisting);
  ok("ports bad port_type → error", badPt.flags.some((f) => f.field === "port_type" && f.level === "error"));
}

// ── vessels: VESSEL_TYPE normalize + validate; required name/type ──────────
{
  const vessels = specById("vessels")!;
  ok("vessel 'Cargo Ship' valid", mapRow(vessels, { IMO: "9312345", VESSEL_NAME: "X", VESSEL_TYPE: "Cargo Ship" }).payload.vessel_type === "Cargo Ship");
  ok("vessel 'General Cargo' → 'Cargo Ship'", mapRow(vessels, { IMO: "9312345", VESSEL_NAME: "X", VESSEL_TYPE: "General Cargo" }).payload.vessel_type === "Cargo Ship");
  ok("vessel 'bulk carrier' → 'Bulk Carrier'", mapRow(vessels, { IMO: "9312345", VESSEL_NAME: "X", VESSEL_TYPE: "bulk carrier" }).payload.vessel_type === "Bulk Carrier");
  const v1 = buildStagedRow(vessels, { IMO: "9312345", VESSEL_NAME: "MV Test", VESSEL_TYPE: "Bulk Carrier", DWT: "55000", DWCC: "52000" }, 1, noExisting);
  ok("vessel dwt+dwcc map", v1.payload.dwt_grain === 55000 && v1.payload.dwcc === 52000 && v1.classification === "new");
  const noType = buildStagedRow(vessels, { IMO: "9312345", VESSEL_NAME: "MV Test", DWT: "1" }, 2, noExisting);
  ok("vessel missing type → error (not a NULL crash)", noType.flags.some((f) => f.field === "vessel_type" && f.level === "error"));
}

// ── companies: COMPANY_IMO alias + FLEET_TOTAL + ADDRESS ────────────────────
{
  const companies = specById("companies")!;
  const { payload } = mapRow(companies, { COMPANY_NAME: "Acme Shipping", COMPANY_IMO: "1234567", COUNTRY: "GR", FLEET_TOTAL: "12", ADDRESS: "Piraeus" });
  ok("company name maps", payload.name === "Acme Shipping");
  ok("company COMPANY_IMO alias maps", payload.imo === "1234567");
  ok("company FLEET_TOTAL maps", payload.fleet_total === 12);
  ok("company ADDRESS maps", payload.address === "Piraeus");
}

console.log(failed === 0 ? "\nPHASE 2 CHECK: ALL PASSED" : `\nPHASE 2 CHECK: ${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);

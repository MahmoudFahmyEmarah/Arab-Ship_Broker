// Phase 6 graph test — drives the REAL LangGraph triple-gate with a MOCK
// classifier (no network, no DB), then feeds the output through the same
// recordsToSheets → buildStagedRow path the upload uses. Run:
//   npx tsx scripts/sync-phase6-graph.ts

import { buildClassifierGraph, assignRegime, normalizeCargo } from "@/lib/sync/email/graph";
import { recordsToSheets } from "@/lib/sync/email/to-rows";
import type { Classifier, EmailMsg } from "@/lib/sync/email/types";
import { specById } from "@/lib/sync/sheets";
import { buildStagedRow } from "@/lib/sync/diff";
import type { Cell, RawRow } from "@/lib/sync/types";

let pass = 0, fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.error(`  ✗ ${label}`); }
}

const email = (text: string): EmailMsg => ({ id: "1", from: "broker@x.com", subject: "test", date: null, text });

// A deterministic stand-in for the LLM — one combined classifyBatch() call that
// returns one result per input email.
function mock(category: "cargo" | "vessel" | "mixed" | "irrelevant"): Classifier {
  const cargo = category === "cargo" || category === "mixed"
    ? [
        { ref: "CM-900", cargo_type: "Dry Bulk" as const, commodity: "Wheat", qty_min_mt: 25000, qty_max_mt: 30000,
          load_port: "Rouen", load_zone: "NCONT", disch_port: "Alexandria", disch_zone: "E.MED",
          laycan_from: "2026-07-10", laycan_to: "2026-07-15", freight_idea: 22, commission_pct: 2.5, load_terms: "FIO" },
        { ref: "CM-901", cargo_type: "Dry Bulk" as const, commodity: "Clinker", qty_min_mt: 10000, qty_max_mt: 10000 },
      ]
    : [];
  const vessels = category === "vessel" || category === "mixed"
    ? [{ imo: "9312345", vessel_name: "MV Test", vessel_type: "Bulk Carrier", dwt: 55000, flag: "Panama", built: 2012 }]
    : [];
  return {
    async classifyBatch(emails) {
      return emails.map(() => ({ category, reason: "mock", cargo, vessels }));
    },
  };
}

async function main() {
  console.log("assignRegime:");
  ok(assignRegime({ commodity: "Milling Wheat" }).asb_regime === "GRAIN", "wheat → GRAIN");
  ok(assignRegime({ commodity: "Soybean Meal" }).asb_regime === "GRAIN", "soybean meal → GRAIN");
  ok(assignRegime({ commodity: "Iron Ore" }).asb_regime === "UNMAPPED", "iron ore → UNMAPPED");
  ok(assignRegime({ commodity: null }).asb_regime === "UNMAPPED", "null → UNMAPPED");

  console.log("normalizeCargo — laycan year guard + qty mirror:");
  ok(normalizeCargo({ commodity: "wheat", qty_min_mt: 1, qty_max_mt: 1, laycan_from: "2024-06-10" }, 2026).laycan_from === "2026-06-10", "past-year laycan → current year");
  ok(normalizeCargo({ commodity: "wheat", qty_min_mt: 1, qty_max_mt: 1, laycan_to: "2027-01-05" }, 2026).laycan_to === "2027-01-05", "future-year laycan kept");
  ok(normalizeCargo({ commodity: "wheat", qty_min_mt: 1, qty_max_mt: 1, laycan_from: "SPOT" }, 2026).laycan_from === "SPOT", "SPOT laycan untouched");
  ok(normalizeCargo({ commodity: "coal", qty_min_mt: 5000, qty_max_mt: null }, 2026).qty_max_mt === 5000, "lone qty bound mirrored");
  ok(normalizeCargo({ commodity: "barite in bags", asb_regime: "IMSBC", qty_min_mt: 1, qty_max_mt: 1 }, 2026).asb_regime === "IMSBC", "valid LLM regime kept (IMSBC)");
  ok(normalizeCargo({ commodity: "bulk mins", asb_regime: "NONSENSE", qty_min_mt: 1, qty_max_mt: 1 }, 2026).asb_regime === "UNMAPPED", "invalid LLM regime → heuristic (UNMAPPED)");

  console.log("graph — irrelevant email → no records:");
  const gIrr = buildClassifierGraph(mock("irrelevant"));
  const rIrr = await gIrr.invoke({ emails: [email("out to lunch")] });
  ok(rIrr.cargo.length === 0 && rIrr.vessels.length === 0, "no records extracted");

  console.log("graph — cargo extraction + regime:");
  const gCargo = buildClassifierGraph(mock("cargo"));
  const rCargo = await gCargo.invoke({ emails: [email("25/30,000 wheat rouen/alex")] });
  ok(rCargo.cargo.length === 2, "2 cargo records");
  ok(rCargo.cargo[0].asb_regime === "GRAIN", "wheat record → GRAIN");
  ok(rCargo.cargo[1].asb_regime === "UNMAPPED", "clinker record → UNMAPPED");
  ok(rCargo.log.some((l) => l.startsWith("gate1")) && rCargo.log.some((l) => l.startsWith("gate2")), "log records both gates");

  console.log("graph — batch of 2 emails aggregates:");
  const rBatch = await gCargo.invoke({ emails: [email("a"), email("b")] });
  ok(rBatch.cargo.length === 4, "batch of 2 → 4 cargo aggregated");

  console.log("mixed — cargo + vessels:");
  const gMix = buildClassifierGraph(mock("mixed"));
  const rMix = await gMix.invoke({ emails: [email("cargo + open vessel")] });
  ok(rMix.cargo.length === 2 && rMix.vessels.length === 1, "cargo and vessel both extracted");

  console.log("recordsToSheets — header mapping:");
  const sheets = recordsToSheets(rCargo.cargo, rMix.vessels ?? []);
  const cargoSheet = sheets.find((s) => s.sheet === "cargo");
  const vesselSheet = sheets.find((s) => s.sheet === "vessels");
  ok(!!cargoSheet && !!vesselSheet, "both sheets present");
  const row0 = cargoSheet!.rows[0];
  ok(row0.COMMODITY === "Wheat" && row0.QTY_MIN_MT === 25000 && row0.ASB_REGIME === "GRAIN", "cargo RawRow keys mapped");
  ok(vesselSheet!.rows[0].IMO === "9312345" && vesselSheet!.rows[0].DWT_GRAIN === 55000, "vessel RawRow keys mapped");

  console.log("integration — buildStagedRow on email rows:");
  const cargoSpec = specById("cargo")!;
  const empty = new Map<string, Record<string, Cell>>();
  const staged0 = buildStagedRow(cargoSpec, row0, 1, empty);
  ok(staged0.classification === "new" && staged0.businessKey === "CM-900", "wheat row → new, keyed by REF");
  ok(staged0.payload.is_grain_cargo === true, "derive set is_grain_cargo from GRAIN regime");
  const clinker = buildStagedRow(cargoSpec, cargoSheet!.rows[1] as RawRow, 2, empty);
  ok(clinker.flags.some((f) => f.field === "asb_regime" && f.level === "info"), "clinker row flagged UNMAPPED for Manual Review");

  console.log("REF-less email cargo — provisional key (committable + idempotent):");
  const ironOre = { cargo_type: "Dry Bulk" as const, commodity: "Iron Ore", qty_min_mt: 50000, qty_max_mt: 55000, load_port: "Tubarao", disch_port: "Qingdao", laycan_from: "2026-08-01" };
  const noRef = recordsToSheets([{ ...ironOre }], [])[0];
  const provRef = String(noRef.rows[0].REF);
  ok(/^EM-[0-9A-F]{6,}$/.test(provRef), `minted a provisional REF (${provRef})`);
  // same content again → same ref (idempotent, no duplicate on re-sync)
  const noRef2 = recordsToSheets([{ ...ironOre }], [])[0];
  ok(noRef2.rows[0].REF === provRef, "same cargo → same provisional REF (idempotent)");
  const provStaged = buildStagedRow(cargoSpec, noRef.rows[0] as RawRow, 1, empty);
  ok(provStaged.classification === "new" && provStaged.businessKey === provRef, "provisional row is committable (not invalid)");
  ok(provStaged.flags.some((f) => f.field === "ref" && f.level === "info"), "provisional row carries an info flag, no ref warn");
  ok(!provStaged.flags.some((f) => f.field === "ref" && f.level === "warn"), "no spurious ref-format warning");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

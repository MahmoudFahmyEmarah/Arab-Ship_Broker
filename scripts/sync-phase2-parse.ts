/**
 * Phase 2 parse check — runs XlsxSource against the REAL CargoMap workbook to
 * confirm header detection + column mapping on live data. No database writes.
 *   npx tsx scripts/sync-phase2-parse.ts [path-to.xlsx]
 */
import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
import { XlsxSource } from "@/lib/sync/xlsx-source";
import { mapRow, buildStagedRow } from "@/lib/sync/diff";
import { specById, specForSheetName } from "@/lib/sync/sheets";
import type { Cell } from "@/lib/sync/types";

const path = process.argv[2] ?? "ArabShipBroker_UNIFIED_CargoMap_29Jun2026.xlsx";
const buf = readFileSync(path);

const wb = XLSX.read(buf, { type: "buffer" });
console.log("workbook tabs:", wb.SheetNames.join(", "));
console.log("matched to specs:",
  wb.SheetNames.map((n) => `${n}${specForSheetName(n) ? "→" + specForSheetName(n)!.id : "  (ignored)"}`).join("  |  "));

(async () => {
  const parsed = await new XlsxSource(buf).parse();
  console.log("\nparsed sheets:");
  for (const p of parsed) {
    const spec = specById(p.sheet)!;
    console.log(`  ${p.sheet.padEnd(12)} ${String(p.rows.length).padStart(4)} rows`);
    if (p.rows.length) {
      const { payload } = mapRow(spec, p.rows[0]);
      const mapped = Object.entries(payload).filter(([, v]) => v !== null && v !== undefined);
      console.log(`     sample mapped cols: ${mapped.map(([k]) => k).join(", ")}`);
      const empty = new Map<string, Record<string, Cell>>();
      const staged = p.rows.slice(0, 200).map((r, i) => buildStagedRow(spec, r, i + 1, empty));
      const errs = staged.filter((s) => s.flags.some((f) => f.level === "error")).length;
      const warns = staged.reduce((a, s) => a + s.flags.filter((f) => f.level === "warn").length, 0);
      console.log(`     first ${staged.length}: ${errs} rows with errors, ${warns} warnings (all 'new' vs empty DB)`);
    }
  }
  console.log("\nPHASE 2 PARSE: completed — inspect the mapped columns above.");
})();

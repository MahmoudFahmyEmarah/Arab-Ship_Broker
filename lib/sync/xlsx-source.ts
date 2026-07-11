// XlsxSource — parses the unified CargoMap workbook into ParsedSheet[].
//
// Per the CargoMap reference (Step 8): row 1 is the report header, row 2 the
// column headers, data from row 3. We map columns BY HEADER NAME (not position)
// so future re-ordering of the workbook can't silently mis-map a column. If a
// workbook instead puts headers on row 1, we detect that and adjust.

import * as XLSX from "xlsx";
import type { ParsedSheet, RawRow, SheetSpec } from "./types";
import { headerIndex, specForSheetName, SHEET_SPECS } from "./sheets";
import type { SyncSource } from "./types";

const norm = (s: unknown) => String(s ?? "").trim().toUpperCase();

/** Count how many cells in a candidate header row match the spec's known headers. */
function headerScore(spec: SheetSpec, row: unknown[]): number {
  const index = headerIndex(spec);
  let n = 0;
  for (const cell of row) if (cell != null && index.has(norm(cell))) n++;
  return n;
}

export class XlsxSource implements SyncSource {
  readonly kind = "upload" as const;
  constructor(private readonly data: ArrayBuffer | Buffer) {}

  async parse(): Promise<ParsedSheet[]> {
    let wb: XLSX.WorkBook;
    try {
      wb = XLSX.read(this.data, { type: "buffer", dense: true });
    } catch {
      // Corrupt / not-really-xlsx / password-protected → a clear, non-crashing error.
      throw new Error("Could not read the workbook — it may be corrupt, empty, or not a valid .xlsx file.");
    }
    if (!wb.SheetNames?.length) throw new Error("The workbook has no sheets.");
    const out: ParsedSheet[] = [];

    for (const sheetName of wb.SheetNames) {
      const spec = specForSheetName(sheetName);
      if (!spec) continue; // ignore tabs we don't sync (field-spec/enums/validation)

      const ws = wb.Sheets[sheetName];
      const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
        header: 1,
        raw: true,
        blankrows: false,
        defval: null,
      });
      if (grid.length < 2) continue;

      // Choose the header row: prefer row 2 (index 1) per the reference, but fall
      // back to row 1 if that scores more header matches.
      const score0 = headerScore(spec, grid[0] ?? []);
      const score1 = headerScore(spec, grid[1] ?? []);
      const headerIdx = score1 >= score0 ? 1 : 0;
      const headers = (grid[headerIdx] ?? []).map((h) => String(h ?? "").trim());
      const dataRows = grid.slice(headerIdx + 1);

      const rows: RawRow[] = [];
      for (const cells of dataRows) {
        if (!cells || cells.every((c) => c == null || String(c).trim() === "")) continue;
        const row: RawRow = {};
        headers.forEach((h, i) => {
          if (h) row[h] = (cells[i] ?? null) as RawRow[string];
        });
        rows.push(row);
      }

      out.push({ sheet: spec.id, rows });
    }

    // Deterministic order: cargo, vessels, companies, ports, commodities.
    const order = SHEET_SPECS.map((s) => s.id);
    out.sort((a, b) => order.indexOf(a.sheet) - order.indexOf(b.sheet));
    return out;
  }
}

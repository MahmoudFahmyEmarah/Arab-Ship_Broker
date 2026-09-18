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

// Phase 5 (18 Sep 2026): a 10 MB upload cap alone said nothing about what it
// unpacks to. These bound the parse: rows are capped at read time
// (sheetRows), the rest is checked per sheet before any row is mapped.
export const WORKBOOK_LIMITS = { sheets: 40, rows: 50_000, cols: 200, cellChars: 2_000 } as const;

/** Why a parsed sheet grid is refused, or null when it is within limits. */
export function checkGrid(sheetName: string, grid: unknown[][]): string | null {
  if (grid.length > WORKBOOK_LIMITS.rows + 2) return `Sheet ${sheetName} has more than ${WORKBOOK_LIMITS.rows.toLocaleString()} rows — split the workbook and upload it in parts.`;
  for (let i = 0; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    if (row.length > WORKBOOK_LIMITS.cols) return `Sheet ${sheetName} has more than ${WORKBOOK_LIMITS.cols} columns (row ${i + 1}) — remove the extra columns.`;
    for (let j = 0; j < row.length; j += 1) {
      const c = row[j];
      if (typeof c === "string" && c.length > WORKBOOK_LIMITS.cellChars) return `Sheet ${sheetName}, row ${i + 1}, column ${j + 1} holds more than ${WORKBOOK_LIMITS.cellChars.toLocaleString()} characters — shorten it.`;
    }
  }
  return null;
}

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
      wb = XLSX.read(this.data, { type: "buffer", dense: true, sheetRows: WORKBOOK_LIMITS.rows + 3 });
    } catch {
      // Corrupt / not-really-xlsx / password-protected → a clear, non-crashing error.
      throw new Error("Could not read the workbook — it may be corrupt, empty, or not a valid .xlsx file.");
    }
    if (!wb.SheetNames?.length) throw new Error("The workbook has no sheets.");
    if (wb.SheetNames.length > WORKBOOK_LIMITS.sheets) throw new Error(`The workbook has ${wb.SheetNames.length} sheets — more than the ${WORKBOOK_LIMITS.sheets} we accept.`);
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
      const why = checkGrid(sheetName, grid);
      if (why) throw new Error(why);

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

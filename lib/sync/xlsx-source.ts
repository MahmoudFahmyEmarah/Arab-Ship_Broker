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
import { assertWorkbookArchiveWithinLimits } from "./xlsx-guard";

const norm = (s: unknown) => String(s ?? "").trim().toUpperCase();

// Phase 5 (18 Sep 2026): a 10 MB upload cap alone said nothing about what it
// unpacks to. These bound the parse: rows are capped at read time
// (sheetRows), the rest is checked per sheet before any row is mapped.
// P1-3 (20 Sep 2026): the archive is inspected BEFORE SheetJS reads it
// (lib/sync/xlsx-guard.ts), and the workbook as a whole is bounded too —
// 40 sheets × 50,000 rows was never a real budget. totalRows / totalCells
// are the synchronous parse limits; staging that much is a background job
// (lib/sync/upload-jobs.ts) above SYNC_STAGE_ROWS.
/**
 * MEASURED, not hoped for (21 Sep 2026). scripts/sync-staging-benchmark.ts
 * builds a real CargoMap workbook and runs the whole worker path — archive
 * guard, SheetJS parse, classify, diff, insert, gate — against a disposable
 * database:
 *
 *      rows     file     worker path (280 s budget)
 *     5,000   0.86 MB     16.1 s
 *    20,000   3.40 MB     30.8 s
 *    40,000   6.80 MB     55.3 s
 *    60,000  10.2 MB      REFUSED — over the 10 MB upload cap
 *
 * Time is not the constraint: 40,000 rows uses a fifth of the worker's
 * budget. SIZE is. A thirteen-column workbook reaches the 10 MB cap at
 * roughly 58,000 rows, so the 60,000 this used to publish could never be
 * uploaded at all — the guard refused the file before the row limit was ever
 * consulted. totalRows is therefore the largest figure actually demonstrated
 * end to end, and the two limits no longer contradict each other.
 */
export const WORKBOOK_LIMITS = { sheets: 40, rows: 50_000, cols: 200, cellChars: 2_000, totalRows: 40_000, totalCells: 3_000_000 } as const;
/**
 * Workbooks with more parsed rows than this are staged by the background job,
 * not inside the upload request. The QUEUE decision itself is made on file
 * size before anything is parsed (SYNC_INLINE_MAX_BYTES); this threshold is
 * what the worker reports and what the console explains.
 */
export const SYNC_STAGE_ROWS = 15_000;
/**
 * A workbook at or below this size is parsed and staged inside the upload
 * request; anything larger is queued WITHOUT being parsed, so the expensive
 * SheetJS read never happens on the interactive path (P1-3, 21 Sep 2026).
 */
export const SYNC_INLINE_MAX_BYTES = 1024 * 1024;

/** The actual shape of a parsed sheet grid — not the width of its first mapped row. */
export interface GridDimensions {
  /** rows the parser actually produced, header rows included */
  rows: number;
  /** the widest row in the grid */
  cols: number;
  /** rows x widest row: the grid area the parser had to walk */
  cells: number;
  /** cells that actually held a value */
  filled: number;
}

/**
 * Measure a parsed grid. Before 21 Sep 2026 the workbook-wide cell total was
 * computed from `Object.keys(rows[0]).length`, the number of NAMED HEADERS.
 * Columns without a header are dropped at mapping time, so a sheet with a
 * two-column header and two-hundred-column data rows reported two columns and
 * the cell limit never fired, however much the parser had actually walked.
 * The measure is now the grid the parser produced.
 */
export function gridDimensions(grid: unknown[][]): GridDimensions {
  let cols = 0, filled = 0;
  for (const row of grid) {
    const r = row ?? [];
    if (r.length > cols) cols = r.length;
    for (let j = 0; j < r.length; j += 1) {
      const c = r[j];
      if (c != null && String(c) !== "") filled += 1;
    }
  }
  return { rows: grid.length, cols, cells: grid.length * cols, filled };
}

/** Why the workbook as a whole is refused at these running totals, or null. */
export function checkWorkbookTotals(rows: number, cells: number, limits: { totalRows: number; totalCells: number } = WORKBOOK_LIMITS): string | null {
  if (rows > limits.totalRows) return `The workbook has ${rows.toLocaleString()} rows in total — more than the ${limits.totalRows.toLocaleString()} we accept in one upload. Split it and upload it in parts.`;
  if (cells > limits.totalCells) return `The workbook has ${cells.toLocaleString()} cells in total — more than the ${limits.totalCells.toLocaleString()} we accept in one upload. Split it and upload it in parts.`;
  return null;
}

/**
 * Why the workbook as a whole is refused, or null. `cells` is the measured
 * grid area when the caller has it; `cols` is accepted for callers that only
 * know a rectangular width.
 */
export function checkTotals(sheets: { sheet: string; rows: number; cols?: number; cells?: number }[], limits: { totalRows: number; totalCells: number } = WORKBOOK_LIMITS): string | null {
  const rows = sheets.reduce((a, s) => a + s.rows, 0);
  const cells = sheets.reduce((a, s) => a + (s.cells ?? s.rows * (s.cols ?? 0)), 0);
  return checkWorkbookTotals(rows, cells, limits);
}

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
  /** What the last parse actually walked — reported by the worker, never used for control flow. */
  lastMeasured: { sheets: { sheet: string; rows: number; cols: number; cells: number; filled: number }[]; rows: number; cells: number } | null = null;
  constructor(private readonly data: ArrayBuffer | Buffer) {}

  async parse(): Promise<ParsedSheet[]> {
    // the archive's own table of contents first: parts, expansion, macros, links
    assertWorkbookArchiveWithinLimits(Buffer.isBuffer(this.data) ? this.data : Buffer.from(this.data));
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
    // running totals over the grids the parser actually produces, checked
    // after every sheet so the limit STOPS the work instead of reporting it
    // once every sheet has already been walked and mapped
    let totalGridRows = 0, totalGridCells = 0;
    const measured: { sheet: string; rows: number; cols: number; cells: number; filled: number }[] = [];

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

      const dim = gridDimensions(grid);
      totalGridRows += dim.rows;
      totalGridCells += dim.cells;
      measured.push({ sheet: spec.id, ...dim });
      const whyTotals = checkWorkbookTotals(totalGridRows, totalGridCells);
      if (whyTotals) throw new Error(whyTotals);

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

    // the workbook as a whole, from the measured grids. The per-sheet check
    // above has already refused anything over the limit; this is the closing
    // assertion and the number the worker records.
    const whyTotal = checkWorkbookTotals(totalGridRows, totalGridCells);
    if (whyTotal) throw new Error(whyTotal);
    this.lastMeasured = { sheets: measured, rows: totalGridRows, cells: totalGridCells };

    // Deterministic order: cargo, vessels, companies, ports, commodities.
    const order = SHEET_SPECS.map((s) => s.id);
    out.sort((a, b) => order.indexOf(a.sheet) - order.indexOf(b.sheet));
    return out;
  }
}

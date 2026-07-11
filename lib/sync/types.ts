// Data Synchronization — domain types.
//
// One shape flows through the whole pipeline regardless of source (XLSX upload
// or email+LLM): a source emits ParsedSheet[]; the diff+validate step turns each
// row into a StagedRow; stageBatch() persists those to sync_staged_row. The
// Review UI and commit RPC only ever see StagedRow, never the source.

export type Cell = string | number | boolean | null;

/** A parsed spreadsheet row keyed by its (normalized) header name. */
export type RawRow = Record<string, Cell>;

/** The five live tables this module writes, addressed by a stable id. */
export type SheetId = "cargo" | "vessels" | "companies" | "ports" | "commodities";

export type Classification = "new" | "updated" | "unchanged" | "invalid";

export type FlagLevel = "error" | "warn" | "info";
export interface Flag {
  level: FlagLevel;
  field?: string;
  msg: string;
}

/** How one spreadsheet column maps onto one database column. */
export interface ColumnSpec {
  /** Header as it appears in the workbook (matched case-insensitively, trimmed). */
  header: string;
  /** Accepted header aliases (also case-insensitive). */
  aliases?: string[];
  /** Destination column on the live table. */
  column: string;
  /** Raw cell → typed value written to the payload. Defaults to trimmed string. */
  transform?: (raw: Cell) => Cell;
  /** Required for a NEW row (a NOT NULL column). Missing ⇒ error ⇒ invalid. */
  required?: boolean;
}

/** Everything the pipeline needs to know about one sheet ↔ table pairing. */
export interface SheetSpec {
  id: SheetId;
  /** Workbook tab names this sheet may appear as, e.g. "01_CARGO". */
  sheetNames: string[];
  label: string;
  targetTable: string;
  /** Conflict/business-key column — must equal fn_sync_key_column() in SQL. */
  keyColumn: string;
  columns: ColumnSpec[];
  /** Post-mapping hook: derive extra payload fields from several cells at once
   *  (e.g. cargo laycan → laycan_from + is_spot). Mutates payload in place. */
  derive?: (payload: RawRow, raw: RawRow) => void;
  /** Extra cross-field validation beyond per-column required/type checks. */
  validate?: (payload: RawRow, raw: RawRow) => Flag[];
}

/** A single row after parse → map → diff → validate, ready to stage. */
export interface StagedRow {
  sheet: SheetId;
  targetTable: string;
  keyColumn: string;
  businessKey: string | null;
  classification: Classification;
  payload: RawRow; // only the columns we set (typed)
  raw: RawRow; // original parsed cells
  diff: Record<string, { old: Cell; new: Cell }> | null;
  flags: Flag[];
  sourceEmailId: string | null;
  rowIndex: number;
}

export interface ParsedSheet {
  sheet: SheetId;
  rows: RawRow[];
}

/** A source is anything that can produce parsed sheets. */
export interface SyncSource {
  readonly kind: "upload" | "email" | "whatsapp";
  parse(): Promise<ParsedSheet[]>;
}

/** Per-sheet tally shown in the batch summary. */
export interface SheetCounts {
  new: number;
  updated: number;
  unchanged: number;
  invalid: number;
  errors: number;
}

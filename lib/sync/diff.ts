// Map a raw row → typed payload, diff it against the live row, and classify.
// Pure functions — no I/O — so they're trivially unit-testable (see
// scripts/sync-phase2-check.ts).

import type { Cell, Flag, RawRow, SheetSpec, StagedRow } from "./types";
import { headerIndex } from "./sheets";

/** Apply a sheet's column map (+ derive) to one raw row → typed payload. */
export function mapRow(spec: SheetSpec, raw: RawRow): { payload: RawRow; missingRequired: string[] } {
  const index = headerIndex(spec);
  const payload: RawRow = {};

  for (const [header, cell] of Object.entries(raw)) {
    const col = index.get(header.trim().toUpperCase());
    if (!col) continue; // unmapped columns are ignored, not an error
    const value = col.transform ? col.transform(cell) : (cell == null ? null : String(cell).trim());
    // An empty cell means "no value provided" — omit it so an update never nulls
    // out an existing column and a new row still fails the required-field check.
    if (value !== null && value !== "") payload[col.column] = value;
  }

  spec.derive?.(payload, raw);

  const missingRequired = spec.columns
    .filter((c) => c.required && (payload[c.column] == null || payload[c.column] === ""))
    .map((c) => c.column);

  return { payload, missingRequired };
}

const empty = (v: Cell) => v === null || v === undefined || v === "";

/** Are two cell values equal for diff purposes (null/'' equal; numbers numeric). */
export function cellEqual(a: Cell, b: Cell): boolean {
  if (empty(a) && empty(b)) return true;
  if (empty(a) !== empty(b)) return false;
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na === nb;
  }
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  return String(a).trim() === String(b).trim();
}

/** Compare payload against an existing DB row (or undefined) → class + diff. */
export function classify(
  payload: RawRow,
  existing: Record<string, Cell> | undefined,
): { classification: "new" | "updated" | "unchanged"; diff: StagedRow["diff"] } {
  if (!existing) return { classification: "new", diff: null };

  const diff: NonNullable<StagedRow["diff"]> = {};
  for (const [col, next] of Object.entries(payload)) {
    const prev = existing[col] ?? null;
    if (!cellEqual(prev, next)) diff[col] = { old: prev, new: next };
  }
  const changed = Object.keys(diff).length > 0;
  return { classification: changed ? "updated" : "unchanged", diff: changed ? diff : null };
}

/** Full pipeline for one row: map → diff → validate → StagedRow. */
export function buildStagedRow(
  spec: SheetSpec,
  raw: RawRow,
  rowIndex: number,
  existingByKey: Map<string, Record<string, Cell>>,
  sourceEmailId: string | null = null,
): StagedRow {
  const { payload, missingRequired } = mapRow(spec, raw);
  const flags: Flag[] = [];

  const keyVal = payload[spec.keyColumn];
  const businessKey = keyVal == null || keyVal === "" ? null : String(keyVal);

  let classification: StagedRow["classification"];
  let diff: StagedRow["diff"] = null;

  if (!businessKey) {
    flags.push({ level: "error", field: spec.keyColumn, msg: `missing ${spec.keyColumn} — cannot sync without a business key` });
    classification = "invalid";
  } else {
    const res = classify(payload, existingByKey.get(businessKey));
    classification = res.classification;
    diff = res.diff;

    // Required (NOT NULL) columns only matter for a brand-new insert.
    if (classification === "new") {
      for (const col of missingRequired)
        flags.push({ level: "error", field: col, msg: `${col} is required for a new row` });
    }
    flags.push(...(spec.validate?.(payload, raw) ?? []));

    if (flags.some((f) => f.level === "error")) classification = "invalid";
  }

  return {
    sheet: spec.id,
    targetTable: spec.targetTable,
    keyColumn: spec.keyColumn,
    businessKey,
    classification,
    payload,
    raw,
    diff,
    flags,
    sourceEmailId,
    rowIndex,
  };
}

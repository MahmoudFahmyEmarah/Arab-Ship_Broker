// Cell normalizers used by the sheet registry's column transforms.
//
// Each turns a raw spreadsheet cell into the typed value we store on the payload.
// The rules come straight from the CargoMap reference (Step 4 / Step 8): strip
// commas from quantities, treat SPOT/PPT laycans as null, keep dates as
// yyyy-mm-dd strings (jsonb has no date type, and the commit casts them back).

import type { Cell } from "./types";

const isBlank = (v: Cell): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

/** Trimmed string, or null when blank. */
export function str(v: Cell): string | null {
  if (isBlank(v)) return null;
  return String(v).trim();
}

/** Upper-cased trimmed string, or null. */
export function upper(v: Cell): string | null {
  const s = str(v);
  return s === null ? null : s.toUpperCase();
}

/** Integer with thousands separators stripped. Returns null when blank, or the
 *  string back untouched when it isn't numeric so the validator can flag it. */
export function intStrip(v: Cell): Cell {
  if (isBlank(v)) return null;
  if (typeof v === "number") return Math.round(v);
  const cleaned = String(v).replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return String(v).trim(); // keep raw ⇒ validator errors
  return Math.round(Number(cleaned));
}

/** Decimal number (commas stripped). null when blank; raw string when non-numeric. */
export function num(v: Cell): Cell {
  if (isBlank(v)) return null;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return String(v).trim();
  return Number(cleaned);
}

/** Boolean from Y/N, true/false, 1/0, yes/no. */
export function bool(v: Cell): boolean | null {
  if (isBlank(v)) return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["y", "yes", "true", "1", "t"].includes(s)) return true;
  if (["n", "no", "false", "0", "f"].includes(s)) return false;
  return null;
}

const SPOT_TOKENS = new Set(["SPOT", "PPT", "PROMPT"]);

export interface LaycanParse {
  date: string | null; // yyyy-mm-dd
  isSpot: boolean;
  bad: boolean; // present but neither a spot token nor a parseable date
}

/** Parse a laycan-from cell. SPOT/PPT ⇒ {date:null, isSpot:true}; an ISO or
 *  d Mon yyyy date ⇒ that date; anything else ⇒ bad (so the row is flagged). */
export function parseLaycan(v: Cell): LaycanParse {
  if (isBlank(v)) return { date: null, isSpot: false, bad: false };
  const s = String(v).trim();
  if (SPOT_TOKENS.has(s.toUpperCase())) return { date: null, isSpot: true, bad: false };

  // yyyy-mm-dd — only a day that exists: "2026-02-30" used to pass here, and one such row failed the whole batch
  // commit (jsonb_populate_record casts the payload to the table's date column)
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const day = calendarDay(s);
    return day ? { date: day, isSpot: false, bad: false } : { date: null, isSpot: false, bad: true };
  }

  // Excel serial date number (days since 1899-12-30)
  if (typeof v === "number" && v > 20000 && v < 80000) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    if (!isNaN(d.getTime())) return { date: d.toISOString().slice(0, 10), isSpot: false, bad: false };
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) return { date: d.toISOString().slice(0, 10), isSpot: false, bad: false };

  return { date: null, isSpot: false, bad: true };
}

/** A day that exists, as "yyyy-mm-dd"; otherwise null. A date column refuses "SPOT", "end Nov" and 2026-02-30
 *  alike, so this is the only shape that may be written to one straight from extracted text. */
export function calendarDay(v: Cell): string | null {
  const s = str(v);
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d ? s : null;
}

/** LOCODE hygiene per the reference: 5 chars, no spaces, upper-case. */
export function locode(v: Cell): string | null {
  const s = upper(v);
  return s === null ? null : s.replace(/\s+/g, "");
}

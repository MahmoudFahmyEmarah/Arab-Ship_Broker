// Equasis "paste" parser — turns the text an admin copies from a ship's
// Equasis page (Ship info + Management detail) into review-drawer fields.
//
// Why paste, not fetch: Equasis' conditions of use prohibit web-robots and any
// automated or bulk retrieval, and misuse locks the account. A person opening
// one ship page and pasting it is the single-lookup use the site is built for,
// so this stays inside the rules while still saving the retyping.
//
// The page is a label/value table; copied text comes out as either
//   "Gross tonnage : 2 999"   or   "Gross tonnage\t2 999"   or two lines.
// Management rows read "ISM Manager  SOME CO LTD  Care of ...  since 01/02/2020".
// Everything here is tolerant: unknown lines are ignored, nothing throws.

import { normalizeFlag } from "@/lib/geo/flag-states";

export interface EquasisParticulars {
  imo?: string;
  name?: string;
  flag?: string;            // canonical flag-state name when recognised, else raw
  flagRaw?: string;
  grt?: number;
  dwt?: number;
  built?: number;
  shipType?: string;        // Equasis wording, e.g. "General Cargo Ship"
  vesselType?: string;      // mapped onto the platform's vessel_type enum
  status?: string;          // "In Service/Commission", "Broken Up", …
  registeredOwner?: string;
  commercialManager?: string;  // "Ship manager/Commercial manager"
  ismManager?: string;
}

const NUM = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const n = Number.parseInt(s.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const clean = (s: string): string => s.replace(/\s+/g, " ").replace(/^[\s:|\-–]+|[\s:|\-–]+$/g, "").trim();

// A value cell ends where the next column starts: a tab, a pipe, "Care of",
// a date ("since 01/02/2020" / "during 2020"), or two-plus spaces.
const CELL_END = /\t|\||\s{2,}|\bcare of\b|\bsince\b|\bduring\b|\bbefore\b/i;
const cellAfter = (line: string, label: RegExp): string | undefined => {
  const m = line.match(label);
  if (!m) return undefined;
  const rest = line.slice(m.index! + m[0].length);
  const v = clean(rest.split(CELL_END)[0] ?? "");
  return v || undefined;
};

// label → value on the same line ("Label : value", "Label\tvalue") OR on the
// next line when the label stands alone.
function keyValue(lines: string[], label: RegExp): string | undefined {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const m = l.match(label);
    if (!m) continue;
    const rest = clean(l.slice(m.index! + m[0].length));
    if (rest) return rest;
    const next = clean(lines[i + 1] ?? "");
    if (next && !/^[A-Za-z ]+:$/.test(next)) return next;
  }
  return undefined;
}

export function mapEquasisShipType(t: string | undefined): string | undefined {
  if (!t) return undefined;
  const s = t.toLowerCase();
  if (/bulk/.test(s)) return "Bulk Carrier";
  if (/general cargo|cargo ship|multi[- ]?purpose|open hatch|ro-ro cargo/.test(s)) return "General Cargo";
  return "Other";
}

export function parseEquasisPaste(text: string): EquasisParticulars {
  const out: EquasisParticulars = {};
  if (!text || !text.trim()) return out;
  const lines = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean);

  const imo = keyValue(lines, /^IMO(?: number| no\.?| n°)?\s*[:\t]?/i);
  const imoDigits = imo?.match(/\d{7}/)?.[0];
  if (imoDigits) out.imo = imoDigits;

  const name = keyValue(lines, /^(?:Name of ship|Ship name|Vessel name|Name)(?:\s*[:\t]|\s*$)/i);
  if (name) out.name = name.toUpperCase();

  const flag = keyValue(lines, /^Flag\s*[:\t]?/i);
  if (flag) {
    out.flagRaw = flag;
    out.flag = normalizeFlag(flag) ?? flag;
  }

  out.grt = NUM(keyValue(lines, /^(?:Gross tonnage|GT|GRT)\s*[:\t]?/i));
  out.dwt = NUM(keyValue(lines, /^(?:DWT|Deadweight)\s*[:\t]?/i));
  const built = keyValue(lines, /^(?:Year of build|Built|Year built)\s*[:\t]?/i);
  const year = built?.match(/(19|20)\d{2}/)?.[0];
  if (year) out.built = Number.parseInt(year, 10);

  const type = keyValue(lines, /^(?:Type of ship|Ship type|Type)(?:\s*[:\t]|\s*$)/i);
  if (type) { out.shipType = type; out.vesselType = mapEquasisShipType(type); }

  const status = keyValue(lines, /^(?:Status of ship|Status)(?:\s*[:\t]|\s*$)/i);
  if (status) out.status = status;

  // Management detail — roles can be on one line with the company, or the
  // company can be on the following line.
  const roleValue = (label: RegExp): string | undefined => {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (!label.test(l)) continue;
      const same = cellAfter(l, label);
      if (same && !/^(?:company|address|date of effect)$/i.test(same)) return same.toUpperCase();
      const next = lines[i + 1];
      if (next && !label.test(next)) {
        const v = clean(next.split(CELL_END)[0] ?? "");
        if (v) return v.toUpperCase();
      }
    }
    return undefined;
  };
  out.registeredOwner = roleValue(/registered owner\s*[:\t]?/i);
  out.commercialManager = roleValue(/ship manager\s*\/\s*commercial manager\s*[:\t]?|commercial manager\s*[:\t]?|ship manager\s*[:\t]?/i);
  out.ismManager = roleValue(/ISM manager\s*[:\t]?|DOC company\s*[:\t]?/i);

  return out;
}

/** True when the paste yielded at least one usable field. */
export function equasisPasteHasData(p: EquasisParticulars): boolean {
  return Object.values(p).some((v) => v !== undefined && v !== "");
}

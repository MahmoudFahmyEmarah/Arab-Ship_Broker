// Port codes on a staged cargo row that the registry does not know (Data Sync
// hardening phase 4, 18 Sep 2026). Until today commit_sync_batch silently
// dropped such a code from the payload, so the committed record differed
// from what the reviewer approved. Now staging flags the row invalid and
// names the field, and commit refuses the row outright if one slips through.

export const CARGO_PORT_COLUMNS = [
  "load_port_locode", "disch_port_locode",
  "load_port_2_locode", "load_port_3_locode", "load_port_4_locode",
  "disch_port_2_locode", "disch_port_3_locode", "disch_port_4_locode",
] as const;

export interface UnknownPort { field: string; code: string }

/** Codes a payload names that are neither in the registry nor in this batch's own ports sheet. */
export function unknownPortCodes(
  payload: Record<string, unknown>,
  knownCodes: ReadonlySet<string>,
  batchCodes: ReadonlySet<string> = new Set(),
): UnknownPort[] {
  const out: UnknownPort[] = [];
  for (const field of CARGO_PORT_COLUMNS) {
    const v = payload[field];
    if (v == null || v === "") continue;
    const code = String(v).trim().toUpperCase();
    if (!code) continue;
    if (knownCodes.has(code) || batchCodes.has(code)) continue;
    out.push({ field, code });
  }
  return out;
}

/** Every port code a set of payloads references, upper-cased, for one registry lookup. */
export function referencedPortCodes(payloads: Record<string, unknown>[]): string[] {
  const s = new Set<string>();
  for (const p of payloads) for (const field of CARGO_PORT_COLUMNS) {
    const v = p[field];
    if (v != null && v !== "") { const c = String(v).trim().toUpperCase(); if (c) s.add(c); }
  }
  return [...s];
}

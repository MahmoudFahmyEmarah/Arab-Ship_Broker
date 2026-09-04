// Port-name → LOCODE resolution for ingested rows.
//
// Circulars name ports the way brokers talk ("Novo", "Constantza", "Jeddah
// Port", "Aliaga, Turkey"); the platform keys everything on the UN/LOCODE in
// the ports registry. Resolve at STAGING time so a cargo lands with its code,
// its canonical name and its zone (the port autofill trigger fills the rest),
// and the dashboard shows port → port instead of falling back to zone → zone.
//
// Ranges and countries ("Egypt Med", "Reni or Izmail", "Algeria") are NOT
// ports — they stay as text and the cards show the text, then the zone.
// Mirrors public.fn_resolve_port_locode() in the database (migration
// 20260903_listing_posters_port_resolution).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PortIndex {
  byName: Map<string, string>;   // normalised trade name → locode
  byCode: Set<string>;           // locodes (no spaces, upper)
}

// Broker shorthand that is unambiguous in this trade.
const SHORTHAND: Record<string, string> = {
  novo: "novorossiysk",
  novoross: "novorossiysk",
  constantza: "constanta",
  burgas: "bourgas",
  apapa: "lagos",
  alarish: "el arish",
  alex: "alexandria",
  "jeddah port": "jeddah",
  "jeddah islamic port": "jeddah",
  "port said": "port said",
};

export function portKey(raw: string): string {
  let k = raw
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^\s*port\s+of\s+/i, "")
    .replace(/\s+(port|anchorage|anch\.?)\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  k = SHORTHAND[k] ?? k;
  return k;
}

export async function fetchPortIndex(supabase: SupabaseClient): Promise<PortIndex | null> {
  try {
    const { data, error } = await supabase
      .from("ports")
      .select("locode, trade_name, is_verified")
      .eq("is_active", true)
      .limit(2000);
    if (error || !data) return null;
    const byName = new Map<string, string>();
    const byCode = new Set<string>();
    // verified ports win a name clash
    const rows = [...(data as { locode: string; trade_name: string; is_verified: boolean | null }[])]
      .sort((a, b) => Number(!!b.is_verified) - Number(!!a.is_verified));
    for (const p of rows) {
      const code = p.locode.replace(/\s+/g, "").toUpperCase();
      byCode.add(code);
      const k = portKey(p.trade_name);
      if (k && !byName.has(k)) byName.set(k, p.locode);
    }
    return { byName, byCode };
  } catch {
    return null;
  }
}

/** LOCODE for a free-text port, or null when it is not a single known port. */
export function resolvePortLocode(raw: string | null | undefined, idx: PortIndex): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Already a code?
  const asCode = s.replace(/\s+/g, "").toUpperCase();
  if (/^[A-Z]{5}$/.test(asCode) && idx.byCode.has(asCode)) return asCode;
  // Ranges / alternatives ("Izmail or Reni", "Tarragona or Castellon",
  // "Lebanon and Syria", "Isk-Mersin rge") are not a single port.
  if (/\b(or|and|either|range|rge)\b/i.test(s) || /\//.test(s)) return null;
  const k = portKey(s);
  if (!k) return null;
  const hit = idx.byName.get(k);
  if (hit) return hit;
  // "Aliaga, Turkey" → first segment
  if (k.includes(",")) {
    const first = k.split(",")[0].trim();
    const h2 = idx.byName.get(SHORTHAND[first] ?? first);
    if (h2) return h2;
  }
  return null;
}

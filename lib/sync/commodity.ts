// Commodity normalization for the ingestion pipeline.
//
// Circulars write commodities as free text with the packaging baked in
// ("Brucite Ore in big bags", "bagged urea", "wheat in bulk"). The live board
// must show the commodity itself, linked to the commodities catalog, with the
// packaging in its own column. This module is the single place that:
//   1. splits packaging out of a raw commodity phrase, and
//   2. resolves the cleaned name against the commodities catalog
//      (canonical_name + display_aliases).
// Anything that cannot be resolved is surfaced to the Manual Review commodity
// queue by the caller — never invented, never silently dropped.

import type { SupabaseClient } from "@supabase/supabase-js";

// Packaging phrases seen in circulars → canonical packaging label.
// Order matters: longer/more specific phrases first.
const PACKAGING_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\bin\s+(?:big|jumbo)\s*-?\s*bags?\b/i, label: "big bags" },
  { re: /\b(?:big|jumbo)\s*-?\s*bags?\b/i, label: "big bags" },
  { re: /\bin\s+bb\.?s?\b/i, label: "big bags" },   // "(in BB)" shorthand
  { re: /\bin\s+bags?\b/i, label: "bags" },
  { re: /\bbagged\b/i, label: "bags" },
  { re: /\bin\s+bulk\b/i, label: "bulk" },
  { re: /\(\s*bulk\s*\)/i, label: "bulk" },          // "(bulk)" suffix
  { re: /\bin\s+bundles?\b/i, label: "bundles" },
  { re: /\bbundled\b/i, label: "bundles" },
  { re: /\bin\s+drums?\b/i, label: "drums" },
  { re: /\bpalleti[sz]ed\b/i, label: "pallets" },
  { re: /\bin\s+pallets?\b/i, label: "pallets" },
  { re: /\bin\s+sacks?\b/i, label: "sacks" },
  { re: /\bin\s+rolls?\b/i, label: "rolls" },
  { re: /\bin\s+barrels?\b/i, label: "barrels" },
  { re: /\bin\s+cartons?\b/i, label: "cartons" },
  { re: /\bin\s+crates?\b/i, label: "crates" },
];

// Names that are too generic to survive on their own once the packaging is
// stripped ("Bagged Cargo" → "Cargo") — keep the original wording for those.
const DEGENERATE = new Set(["", "cargo", "general cargo", "unspecified", "harmless"]);
const isDegenerate = (s: string) => {
  // Judge the normalized key so "(unspecified)" and "unspecified" are the same.
  const k = commodityKey(s);
  return k.length < 3 || DEGENERATE.has(k) || k.startsWith("cargo");
};

export interface SplitCommodity {
  /** the commodity with packaging words removed (original casing kept) */
  name: string;
  /** canonical packaging label, or null when none was found */
  packaging: string | null;
}

/** Split "Brucite Ore in big bags" → { name: "Brucite Ore", packaging: "big bags" }. */
export function splitPackaging(raw: string): SplitCommodity {
  let name = raw;
  let packaging: string | null = null;
  for (const { re, label } of PACKAGING_PATTERNS) {
    if (re.test(name)) {
      packaging ??= label;
      name = name.replace(re, " ");
    }
  }
  name = name
    .replace(/\(\s*\)/g, " ")            // emptied parentheses
    .replace(/\s+/g, " ")
    // NOTE: parens are NOT in the edge-trim set — trimming a trailing ")"
    // off a balanced "(…)" leaves the name broken ("Agriproduct (bulk").
    .replace(/^[\s\-–—,/&]+|[\s\-–—,/&]+$/g, "")
    .trim();
  if (name.length < 3 || isDegenerate(name)) return { name: raw.trim(), packaging };
  return { name, packaging };
}

/** normalize for catalog matching: lowercase, alphanumerics only, single spaces */
export function commodityKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export interface CommodityIndex {
  /** normalized name/alias → commodity */
  byKey: Map<string, { id: string; canonical: string }>;
}

export function buildCommodityIndex(
  rows: { id: string; canonical_name: string; display_aliases: string[] | null }[],
): CommodityIndex {
  const byKey = new Map<string, { id: string; canonical: string }>();
  for (const r of rows) {
    const entry = { id: r.id, canonical: r.canonical_name };
    const names = [r.canonical_name, ...(r.display_aliases ?? [])];
    for (const n of names) {
      const k = commodityKey(String(n ?? ""));
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, entry);
      // singular/plural tolerance: index the trailing-s variant too
      const alt = k.endsWith("s") ? k.slice(0, -1) : `${k}s`;
      if (!byKey.has(alt)) byKey.set(alt, entry);
    }
  }
  return { byKey };
}

export interface ResolvedCommodity extends SplitCommodity {
  /** catalog id when the cleaned name matches; null → send to the review queue */
  commodityId: string | null;
}

export function resolveCommodity(raw: string | null | undefined, index: CommodityIndex): ResolvedCommodity | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const split = splitPackaging(raw);
  const hit = index.byKey.get(commodityKey(split.name));
  return {
    // A catalog hit wins the display name (canonical spelling everywhere).
    name: hit ? hit.canonical : split.name,
    packaging: split.packaging,
    commodityId: hit ? hit.id : null,
  };
}

/** Load the active catalog once per batch. Failure → null (resolution skipped, never fatal). */
export async function fetchCommodityIndex(supabase: SupabaseClient): Promise<CommodityIndex | null> {
  try {
    const { data, error } = await supabase
      .from("commodities")
      .select("id, canonical_name, display_aliases")
      .eq("is_active", true);
    if (error || !data) return null;
    return buildCommodityIndex(data as { id: string; canonical_name: string; display_aliases: string[] | null }[]);
  } catch {
    return null;
  }
}

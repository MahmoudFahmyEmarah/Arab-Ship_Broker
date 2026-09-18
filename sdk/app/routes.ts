import { SupabaseClient } from "@supabase/supabase-js";

// Measured port-to-port routes (ECDIS voyage plans imported into port_routes).
// get_port_route is symmetric and alias-aware; it returns {found:false} for
// any pair without data. This wrapper NEVER throws — a missing route or a
// network failure returns null and every caller keeps its existing estimator.

export interface MeasuredRoute {
  totalNm: number;
  verified: boolean;
  source: string;
  /** Straits/canals the stored route transits (SUEZ, BOSPHORUS, HORMUZ, …). */
  chokepoints: string[];
  /** [lat, lon, cumulative_nm|null] ordered in the requested direction. */
  waypoints: [number, number, number | null][];
  /**
   * True when this answer came from the pair's track surveyed the OTHER way
   * and was reversed (same water, distances re-based). Verified 10 Sep 2026:
   * the ECDIS master holds no reciprocal pairs, so a reversal never
   * contradicts a surveyed track — but the flag lets a caller say so.
   */
  reversed: boolean;
  /** True when the stored track applies to this direction only (one-way TSS, canal convoy). */
  directionSpecific: boolean;
  /** The direction the track was actually surveyed in, e.g. "EGPSD → TNSFA". */
  surveyedAs: string | null;
}

export async function getPortRoute(
  supabase: SupabaseClient,
  polLocode?: string | null,
  podLocode?: string | null,
): Promise<MeasuredRoute | null> {
  if (!polLocode || !podLocode) return null;
  try {
    const { data, error } = await supabase.rpc("get_port_route", {
      p_pol: polLocode,
      p_pod: podLocode,
    });
    const d = data as {
      found?: boolean; total_nm?: number; verified?: boolean; source?: string;
      chokepoints?: string[]; waypoints?: [number, number, number | null][];
      reversed?: boolean; direction_specific?: boolean; surveyed_as?: string;
    } | null;
    if (error || !d?.found || !Number.isFinite(Number(d.total_nm))) return null;
    return {
      totalNm: Number(d.total_nm),
      verified: !!d.verified,
      source: d.source ?? "ECDIS voyage plan",
      chokepoints: Array.isArray(d.chokepoints) ? d.chokepoints.map(String) : [],
      waypoints: Array.isArray(d.waypoints) ? d.waypoints : [],
      reversed: !!d.reversed,
      directionSpecific: !!d.direction_specific,
      surveyedAs: d.surveyed_as ?? null,
    };
  } catch {
    return null; // never let a route lookup break a page
  }
}

/** Distance + pedigree, for the voyage estimator's leg notes. */
export async function getRouteNm(
  supabase: SupabaseClient,
  a?: string | null,
  b?: string | null,
): Promise<{ nm: number; ecdis: boolean } | null> {
  const r = await getPortRoute(supabase, a, b);
  if (!r) return null;
  return { nm: r.totalNm, ecdis: r.source.toUpperCase().startsWith("ECDIS") };
}

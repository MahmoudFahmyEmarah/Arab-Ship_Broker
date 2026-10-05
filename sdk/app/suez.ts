import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuezTariffContextResult } from "@/lib/suez/types";

// Suez Canal domain reads/writes (migrations 20261003200000–205100).
// Follows the sdk/app/pda.ts convention: rpc → throw on error → typed cast.

export async function getSuezTariffContext(supabase: SupabaseClient, date?: string): Promise<SuezTariffContextResult> {
  const { data, error } = await supabase.rpc("get_suez_tariff_context", { p_date: date ?? null });
  if (error) throw new Error(error.message);
  return (data ?? { found: false, date: date ?? "" }) as SuezTariffContextResult;
}

export interface VesselEconomicsProfile {
  found: boolean;
  allowed: boolean;
  vesselId?: string;
  scgt?: number | null;
  scnt?: number | null;
  gt?: number | null;
  suezCategory?: string | null;
  lastSuezTransit?: string | null;
  /** true / false when the transit history is known; null = unknown */
  firstTransit?: boolean | null;
  searchlightCompliant?: boolean | null;
  mooringCranesOk?: boolean | null;
  speedLadenKn?: number | null;
  speedBallastKn?: number | null;
  consumption?: Record<string, { residual?: number | null; distillate?: number | null }>;
  /** true / false when declared; null = unknown (the estimator prices as no scrubber and says so) */
  hasScrubber?: boolean | null;
  vesselClass?: "A" | "B" | "C" | null;
  source?: "member" | "admin" | "sync";
  updatedAt?: string;
}

export async function getVesselEconomicsProfile(supabase: SupabaseClient, vesselId: string): Promise<VesselEconomicsProfile> {
  const { data, error } = await supabase.rpc("get_vessel_economics_profile", { p_vessel_id: vesselId });
  if (error) throw new Error(error.message);
  return (data ?? { found: false, allowed: false }) as VesselEconomicsProfile;
}

// The RPC takes the actor from fn_market_actor(), validates every figure and
// writes a vessel_economics_profile_events row (migration 20261003205000).
export async function upsertVesselEconomicsProfile(
  supabase: SupabaseClient,
  vesselId: string,
  profile: Omit<VesselEconomicsProfile, "found" | "allowed" | "vesselId" | "source" | "updatedAt">,
): Promise<VesselEconomicsProfile> {
  const { data, error } = await supabase.rpc("upsert_vessel_economics_profile", { p_vessel_id: vesselId, p_profile: profile });
  if (error) throw new Error(error.message);
  return data as VesselEconomicsProfile;
}

// fn_route_eca_split(p_pol, p_pod, p_as_of): the measured route's miles inside
// each ECA zone in force on the date, with the geometry versions that produced
// the split (so a saved estimate can be reproduced after a zone changes).
export interface RouteEcaSplit {
  found: boolean;
  asOf?: string;
  totalNm?: number;
  ecaNm?: number | null; // null = distance-only route (no waypoints): share unknown
  byZone?: Record<string, number>;
  geometryVersions?: { code: string; geometryVersion: string }[];
  chokepoints?: string[];
  reversed?: boolean | null;
  directionSpecific?: boolean | null;
  source?: string | null;
  method?: "waypoints" | "distance_only";
  algorithmVersion?: string;
  waypointCount?: number;
  /** fn_route_eca_split/3: ECA zones containing the first / last waypoint (the ports), and the track's verified flag */
  startZones?: string[] | null;
  endZones?: string[] | null;
  verified?: boolean;
  /** coarse when any ECA ring in force is a coarse digitisation (never a trusted ECA fact) */
  geometryConfidence?: "official" | "coarse";
}

// fn_point_eca_zones: ECA zones in force on the date that contain the point (empty = outside every zone; null = lookup failed).
export async function getPointEcaZones(supabase: SupabaseClient, lat: number, lon: number, asOf?: string): Promise<string[] | null> {
  try {
    const { data, error } = await supabase.rpc("fn_point_eca_zones", { p_lat: lat, p_lon: lon, p_as_of: asOf ?? null });
    if (error || !Array.isArray(data)) return null;
    return data.map(String);
  } catch {
    return null;
  }
}

// Never throws: an ECA split failure must not stop an estimate — the leg is
// then reported with an unknown ECA share (status fallback), never priced as ECA-free silently.
export async function getRouteEcaSplit(supabase: SupabaseClient, pol: string, pod: string, asOf?: string): Promise<RouteEcaSplit> {
  try {
    const { data, error } = await supabase.rpc("fn_route_eca_split", { p_pol: pol, p_pod: pod, p_as_of: asOf ?? null });
    if (error || !data) return { found: false };
    return data as RouteEcaSplit;
  } catch {
    return { found: false };
  }
}

export interface EcaZoneSummary {
  code: string; name: string; geometryVersion: string; confidence: "official" | "coarse"; sulphurLimitPct: number;
  effectiveFrom: string; effectiveTo: string | null; points: number; sourceRef: string | null; sourceUrl: string | null;
}

export async function listEcaZones(supabase: SupabaseClient, asOf?: string): Promise<EcaZoneSummary[]> {
  const { data, error } = await supabase.rpc("list_eca_zones", { p_as_of: asOf ?? null });
  if (error) throw new Error(error.message);
  return (data ?? []) as EcaZoneSummary[];
}

import type { SupabaseClient } from "@supabase/supabase-js";
import type { SuezTariffContextResult } from "@/lib/suez/types";

// Suez Canal domain reads/writes (migrations 20261003200000–203000).
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
  firstTransit?: boolean;
  searchlightCompliant?: boolean | null;
  mooringCranesOk?: boolean | null;
  speedLadenKn?: number | null;
  speedBallastKn?: number | null;
  consumption?: Record<string, { residual?: number | null; distillate?: number | null }>;
  hasScrubber?: boolean;
  vesselClass?: "A" | "B" | "C" | null;
  source?: "member" | "admin" | "sync";
  updatedAt?: string;
}

export async function getVesselEconomicsProfile(supabase: SupabaseClient, vesselId: string): Promise<VesselEconomicsProfile> {
  const { data, error } = await supabase.rpc("get_vessel_economics_profile", { p_vessel_id: vesselId });
  if (error) throw new Error(error.message);
  return (data ?? { found: false, allowed: false }) as VesselEconomicsProfile;
}

export async function upsertVesselEconomicsProfile(
  supabase: SupabaseClient,
  vesselId: string,
  profile: Omit<VesselEconomicsProfile, "found" | "allowed" | "vesselId" | "source" | "updatedAt">,
): Promise<VesselEconomicsProfile> {
  const { data, error } = await supabase.rpc("upsert_vessel_economics_profile", { p_vessel_id: vesselId, p_profile: profile });
  if (error) throw new Error(error.message);
  return data as VesselEconomicsProfile;
}

export interface RouteEcaSplit {
  found: boolean;
  totalNm?: number;
  ecaNm?: number | null; // null = distance-only route, use the zone rule
  byZone?: Record<string, number>;
  chokepoints?: string[];
  method?: "waypoints" | "distance_only";
}

// Never throws: an ECA split failure must not stop an estimate.
export async function getRouteEcaSplit(supabase: SupabaseClient, pol: string, pod: string): Promise<RouteEcaSplit> {
  try {
    const { data, error } = await supabase.rpc("fn_route_eca_split", { p_pol: pol, p_pod: pod });
    if (error || !data) return { found: false };
    return data as RouteEcaSplit;
  } catch {
    return { found: false };
  }
}

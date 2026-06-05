import { SupabaseClient } from "@supabase/supabase-js";
import { PortOption, CargoListingRow } from "@/lib/schemas/cargo";
import { VesselAvailabilityWithVessel } from "@/lib/schemas/vessel";

export async function searchPorts(
  supabase: SupabaseClient,
  query: string,
): Promise<PortOption[]> {
  if (!query || query.trim().length < 2) return [];
  const { data, error } = await supabase
    .from("ports")
    .select("locode, trade_name, country, zone, port_type")
    .or(
      `trade_name.ilike.%${query.trim()}%,locode.ilike.%${query.trim()}%,country.ilike.%${query.trim()}%`,
    )
    .eq("is_verified", true)
    .eq("is_active", true)
    .order("trade_name")
    .limit(10);
  if (error) throw error;
  return (data ?? []) as PortOption[];
}

export async function getPortByLocode(
  supabase: SupabaseClient,
  locode: string,
): Promise<PortOption | null> {
  const { data, error } = await supabase
    .from("ports")
    .select("locode, trade_name, country, zone, port_type")
    .eq("locode", locode)
    .single();
  if (error) return null;
  return data as PortOption;
}

export type PortActivity = {
  port: PortOption;
  cargos: CargoListingRow[];
  vessels: VesselAvailabilityWithVessel[];
};

export async function getPortActivity(
  supabase: SupabaseClient,
  locode: string,
): Promise<PortActivity | null> {
  const port = await getPortByLocode(supabase, locode);
  if (!port) return null;

  const { data: cargoData, error: cargoError } = await supabase
    .from("cargo_listings")
    .select("*")
    .or(`load_port_locode.eq.${locode},disch_port_locode.eq.${locode}`)
    .in("status", ["IN", "PARTIAL"])
    .eq("review_status", "APPROVED")
    .order("created_at", { ascending: false })
    .limit(50);

  if (cargoError) throw cargoError;

  const { data: vesselData, error: vesselError } = await supabase
    .from("vessel_availability")
    .select(
      `*,
       vessel:vessels (
         vessel_name, imo_number, vessel_type, dwt_grain, dwt_bale,
         grain_cbm, bale_cbm,
         build_year, flag, scope, risk_level,
         is_sanctioned, is_geared, grain_certified, dg_certified,
         max_draft_m, preferred_zones
       )`,
    )
    .eq("open_port_locode", locode)
    .eq("status", "OPEN")
    .eq("review_status", "APPROVED")
    .order("open_date", { ascending: true, nullsFirst: false })
    .limit(50);

  if (vesselError) throw vesselError;

  return {
    port,
    cargos: (cargoData ?? []) as CargoListingRow[],
    vessels: (vesselData ?? []) as VesselAvailabilityWithVessel[],
  };
}

export async function getPortsByZone(
  supabase: SupabaseClient,
  zone: string,
): Promise<PortOption[]> {
  const { data, error } = await supabase
    .from("ports")
    .select("locode, trade_name, country, zone, port_type")
    .eq("zone", zone)
    .eq("is_active", true)
    .order("trade_name");

  if (error) throw error;
  return (data ?? []) as PortOption[];
}

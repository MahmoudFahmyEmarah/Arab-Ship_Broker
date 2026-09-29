import { SupabaseClient } from "@supabase/supabase-js";
import { PortOption } from "@/lib/schemas/cargo";
import {
  listMarketCargo,
  listMarketVessels,
  type MarketCargoRow,
  type MarketVesselRow,
} from "@/sdk/app/market";

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
  cargos: MarketCargoRow[];
  vessels: MarketVesselRow[];
};

export async function getPortActivity(
  supabase: SupabaseClient,
  locode: string,
): Promise<PortActivity | null> {
  const port = await getPortByLocode(supabase, locode);
  if (!port) return null;

  const [cargoData, vesselData] = await Promise.all([
    listMarketCargo(supabase),
    listMarketVessels(supabase),
  ]);

  return {
    port,
    cargos: cargoData
      .filter((cargo) =>
        cargo.load_port_locode === locode || cargo.disch_port_locode === locode,
      )
      .slice(0, 50),
    vessels: vesselData
      .filter((position) => position.open_port_locode === locode)
      .slice(0, 50),
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

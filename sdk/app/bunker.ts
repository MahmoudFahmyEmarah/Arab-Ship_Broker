import { SupabaseClient } from "@supabase/supabase-js";
import type {
  BunkerTicker,
  FuelPriceIndex,
  FuelPriceIndexParams,
} from "@/lib/bunker/types";

export type {
  BunkerTicker,
  BunkerTickerPrice,
  BunkerTickerSponsor,
  FuelFamily,
  FuelIndexProduct,
  FuelIndexScope,
  FuelPriceIndex,
  FuelPriceIndexParams,
  FuelProductKey,
  PriceDirection,
  QuoteFreshness,
  SulphurClass,
} from "@/lib/bunker/types";

// Fuel Bar reads. This is the only bunker module other streams import.
// Both RPCs are security definer and granted to authenticated; they return
// the camelCase JSON shapes in lib/bunker/types.ts, so no remapping happens here.

/** The RPC is not on this database yet (migration not applied). */
export class BunkerNotDeployedError extends Error {
  constructor(rpc: string) {
    super(`${rpc} is not deployed on this database`);
    this.name = "BunkerNotDeployedError";
  }
}

// PostgREST answers PGRST202 for an unknown function; Postgres 42883 if it
// is called directly with a signature that does not exist.
function isMissingRpc(error: { code?: string } | null): boolean {
  return error?.code === "PGRST202" || error?.code === "42883";
}

export async function getFuelPriceIndex(
  supabase: SupabaseClient,
  params: FuelPriceIndexParams = {},
): Promise<FuelPriceIndex> {
  const { data, error } = await supabase.rpc("get_fuel_price_index", {
    p_port_locode: params.portLocode ?? null,
    p_product_keys: params.productKeys?.length ? params.productKeys : null,
    ...(params.asOf ? { p_as_of: params.asOf } : {}),
  });
  if (isMissingRpc(error)) throw new BunkerNotDeployedError("get_fuel_price_index");
  if (error) throw new Error(`get_fuel_price_index failed: ${error.message}`);
  return data as FuelPriceIndex;
}

export async function getBunkerTicker(supabase: SupabaseClient): Promise<BunkerTicker> {
  const { data, error } = await supabase.rpc("get_bunker_ticker");
  if (isMissingRpc(error)) throw new BunkerNotDeployedError("get_bunker_ticker");
  if (error) throw new Error(`get_bunker_ticker failed: ${error.message}`);
  return data as BunkerTicker;
}

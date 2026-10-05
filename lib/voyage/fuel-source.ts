// Fuel prices for the Voyage estimator: the frozen B→S FuelIndexSnapshot
// (C2O-033 item 3 / O2C-025). The engine reads `averageUsdMt` only; products
// without a live average are priced from the ONE admin fallback
// (`voyage_settings.fuelFallback`) and labelled `fallback` (ruling D2), or
// `unavailable` when there is none.
//
// PR-02 seam (O2B-009/O2C-034): the server asks for the voyage's bunkering port
// (the load port), the products this voyage burns, the as-of date and the stem.
// INTEGRATION (composer, one line): set FUEL_INDEX_PROVIDER to Stream B's
//   import { getFuelIndexSnapshot } from "@/sdk/app/bunker";
//   const FUEL_INDEX_PROVIDER: FuelIndexProvider | null = getFuelIndexSnapshot;
// It returns this exact shape — `unavailable` when the RPC is missing or no
// product has an offer, never a fallback of its own.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { FuelIndexSnapshot } from "./snapshots";
import { getFuelIndexSnapshot } from "@/sdk/app/bunker";

export interface FuelIndexRequest {
  portLocode: string | null;
  productKeys: string[];
  asOf?: string | null;
  stemMt?: number | null;
}

export type FuelIndexProvider = (supabase: SupabaseClient, params: { portLocode: string | null; productKeys: never[]; asOf?: string; stemMt?: number }) => Promise<FuelIndexSnapshot>;

// Stream B, wired at composition (compose/voyage-economics-rc1).
const FUEL_INDEX_PROVIDER: FuelIndexProvider | null = getFuelIndexSnapshot;

export const NO_INDEX_SNAPSHOT = (requestedPort: string | null): FuelIndexSnapshot => ({
  kind: "fuel_index",
  status: "unavailable",
  algorithmVersion: "bunker-index/0",
  asOf: null,
  requestedPort,
  scope: null,
  actualPort: null,
  region: null,
  contributingPorts: [],
  stemMt: null,
  products: [],
  noOffer: [],
  warnings: ["The Fuel Bar index is not deployed in this build; prices come from the admin fallback and are labelled as such."],
});

// The products a voyage burns, from the settings and the scrubber status (residual, ECA product, distillate).
export function voyageFuelProducts(ecaProductKey: string, distillateProductKey: string | undefined, hasScrubber: boolean | null): string[] {
  return [...new Set([hasScrubber ? "HSFO380" : "VLSFO", ecaProductKey, distillateProductKey ?? "LSMGO"])];
}

export async function loadFuelIndex(supabase: SupabaseClient, req: FuelIndexRequest): Promise<FuelIndexSnapshot> {
  const port = req.portLocode && /^[A-Z]{2}[A-Z0-9]{3}$/.test(req.portLocode) ? req.portLocode : null;
  if (!FUEL_INDEX_PROVIDER) return NO_INDEX_SNAPSHOT(port);
  try {
    return await FUEL_INDEX_PROVIDER(supabase, {
      portLocode: port,
      productKeys: req.productKeys as never[],
      ...(req.asOf ? { asOf: req.asOf } : {}),
      ...(req.stemMt != null && req.stemMt > 0 ? { stemMt: Math.round(req.stemMt) } : {}),
    });
  } catch {
    return NO_INDEX_SNAPSHOT(port);
  }
}

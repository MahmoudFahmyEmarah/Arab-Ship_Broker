// Fuel prices for the Voyage estimator (contract §4.1: the Fuel Bar index
// average per product at the bunkering port; fallback = the admin's
// voyage_settings.fuelFallback, always labelled as such).
//
// INTEGRATION NOTE (composer): when Stream B's `@/sdk/app/bunker` lands,
// replace the body of loadFuelPrices with
//   const idx = await getFuelPriceIndex(supabase, { portLocode });
//   products → { usdMt: p.averageUsdMt, source: "index", asOf: idx.asOf, port: idx.port, scope: idx.scope, quoteCount: p.quoteCount }
// and keep the fallback path for `noOffer` products and BunkerNotDeployedError.
import type { FuelPriceMap, VoyageSettings } from "./types";
import type { FuelIndexSnapshot } from "./snapshots";

export interface FuelPriceLoad {
  prices: FuelPriceMap;
  snapshot: Omit<FuelIndexSnapshot, "hash">;
  live: boolean;
}

export function fallbackFuelPrices(settings: VoyageSettings, portLocode: string | null): FuelPriceLoad {
  const prices: FuelPriceMap = {};
  for (const [key, usdMt] of Object.entries(settings.fuelFallback)) {
    if (Number.isFinite(usdMt) && usdMt > 0) prices[key] = { usdMt, source: "fallback", asOf: null, port: portLocode, scope: null, quoteCount: null };
  }
  return {
    prices,
    live: false,
    snapshot: {
      kind: "fuel_index",
      status: "unavailable",
      asOf: null,
      port: portLocode,
      scope: null,
      products: Object.entries(prices).map(([key, p]) => ({ key, usdMt: p.usdMt, source: "fallback" })),
      warnings: ["No live Fuel Bar index: admin fallback prices used (voyage_settings.fuelFallback)."],
    },
  };
}

export async function loadFuelPrices(settings: VoyageSettings, portLocode: string | null): Promise<FuelPriceLoad> {
  // Stream B's index is wired here at integration (see the note above).
  return fallbackFuelPrices(settings, portLocode);
}

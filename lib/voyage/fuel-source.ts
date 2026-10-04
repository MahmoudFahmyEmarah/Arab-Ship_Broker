// Fuel prices for the Voyage estimator: the frozen B→S FuelIndexSnapshot
// (C2O-033 item 3 / O2C-025). The engine reads `averageUsdMt` only; products
// without a live average are priced from the admin fallback and labelled
// `fallback` (architect ruling D2), or `unavailable` when there is none.
//
// INTEGRATION NOTE (composer): when Stream B's `@/sdk/app/bunker` lands,
// replace `loadFuelIndex` with
//   return getFuelIndexSnapshot(supabase, { portLocode, productKeys, asOf, stemMt });
// (it returns this exact shape, status `unavailable` when the RPC is missing or
// no product has an offer — never a fallback of its own).
import type { FuelIndexSnapshot } from "./snapshots";

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

export async function loadFuelIndex(requestedPort: string | null): Promise<FuelIndexSnapshot> {
  // Stream B's index is wired here at integration (see the note above).
  return NO_INDEX_SNAPSHOT(requestedPort);
}

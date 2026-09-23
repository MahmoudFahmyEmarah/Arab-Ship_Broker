import assert from "node:assert/strict";
import { CARGO_FACETS, VESSEL_FACETS, passesFacets } from "../lib/portal/map-filters";
import type { CargoView, VesselView } from "../lib/portal/types";
import {
  OPERATING_ZONE_CODES,
  operatingZoneCode,
  zoneMatchesSelection,
} from "../lib/zones";

assert.deepEqual(OPERATING_ZONE_CODES, [
  "B.SEA", "E.MED", "W.MED", "C.MED", "ADRIATIC",
  "R.SEA", "AG", "A.SEA", "WCAF", "ECAF",
]);

assert.equal(operatingZoneCode("R.SEA.N"), "R.SEA");
assert.equal(operatingZoneCode("R.SEA.S"), "R.SEA");
assert.equal(operatingZoneCode("BALTIC"), null);
assert.equal(zoneMatchesSelection("R.SEA.S", ["R.SEA"]), true);

const westAfricaToWestMed = {
  route: { polZone: "WCAF", podZone: "W.MED" },
} as CargoView;
assert.equal(
  passesFacets(westAfricaToWestMed, CARGO_FACETS, { zone: new Set(["W.MED"]) }),
  true,
  "cargo must remain visible when either route endpoint matches",
);

const redSeaNorthVessel = { openPortZone: "R.SEA.N" } as VesselView;
assert.equal(
  passesFacets(redSeaNorthVessel, VESSEL_FACETS, { openZone: new Set(["R.SEA"]) }),
  true,
  "the single Red Sea choice must include internal north/south codes",
);

console.log("zone filter checks passed");

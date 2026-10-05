import assert from "node:assert/strict";

import { MATCHING_RULES_V1_DEFAULT_PAYLOAD } from "../lib/matching-rules/defaults";
import {
  compareViewPairRank,
  fitLabel,
  matchingRuntimeFromSnapshot,
} from "../lib/portal/matching";
import type { CargoView, VesselView } from "../lib/portal/types";

const cargo = {
  id: "cargo-public-key",
  matchingFacts: {
    cargoId: "cargo-public-key",
    reviewStatus: "APPROVED",
    status: "IN",
    qtyMinMt: 80,
    qtyMaxMt: 100,
    cargoType: "Dry Bulk",
    isSpot: true,
    laycanFromDay: null,
    requiresGeared: false,
    isGrainCargo: false,
    isDgCargo: false,
    maxVesselAgeYr: null,
    maxDraftM: null,
    maxLoaM: null,
    loadZone: "LOAD",
    dischZone: "DISCH",
    freightIdeaUsdMt: 50,
  },
} as CargoView;

function vessel(
  id: string,
  dwtGrainMt: number,
  openZone: string,
  freightIdeaUsdMt: number,
  acceptsPartCargo: boolean,
): VesselView {
  return {
    id,
    matchingFacts: {
      availabilityId: id,
      availabilityStatus: "OPEN",
      availabilityReviewStatus: "APPROVED",
      isSanctioned: false,
      dwtGrainMt,
      vesselType: "Bulk Carrier",
      openZone,
      openDateDay: null,
      acceptsPartCargo,
      isGeared: true,
      grainCertified: true,
      dgCertified: true,
      buildYear: null,
      maxDraftM: null,
      maxLoaM: null,
      freightIdeaUsdMt,
    },
  } as VesselView;
}

const strongButRateUnaligned = vessel("availability-z", 100, "LOAD", 100, false);
const goodAndRateAligned = vessel("availability-a", 120, "DISCH", 52, true);
const tiedPublicRank = vessel("availability-b", 120, "DISCH", 52, true);

const snapshot = {
  source: "sample" as const,
  asOfYear: 2026,
  activeVersionId: "00000000-0000-4000-8000-000000000001",
  paramsSha256: "0".repeat(64),
  rules: MATCHING_RULES_V1_DEFAULT_PAYLOAD,
};
const runtime = matchingRuntimeFromSnapshot(snapshot);
assert.ok(runtime, "valid portal matching runtime");

assert.equal(fitLabel(cargo, strongButRateUnaligned, runtime), "Strong");
assert.equal(fitLabel(cargo, goodAndRateAligned, runtime), "Good");
assert.ok(
  compareViewPairRank(cargo, goodAndRateAligned, cargo, strongButRateUnaligned, runtime) < 0,
  "rate-aligned Good must rank before unaligned Strong; display band is not a rank weight",
);
assert.equal(
  compareViewPairRank(cargo, goodAndRateAligned, cargo, tiedPublicRank, runtime) < 0,
  true,
  "sample exact public-rank ties may use sample ids as the deterministic tie-break",
);

console.log("matching portal checks: 4 passed, 0 failed");

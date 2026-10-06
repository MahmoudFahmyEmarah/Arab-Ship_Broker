// Route geography shared by the cargo form and the Voyage Estimator: does a
// zone pair cross the Suez Canal, and in which direction.
//
// The legacy prototype economics that used to live here (hard-coded Singapore
// fuel prices, the King Abdullah Port proforma applied to every port, a flat
// Suez toll and calcVoyage) were retired at composition (architect ruling on
// C2O-041, B2O-011 R4). Prices now come from the governed sources: the fuel index
// (Stream B), the Suez tariff (Stream S) and the PDA tariffs. The prebuild guard
// scripts/legacy-econ-guard.mjs keeps them from coming back.

const MED = new Set(["E.MED", "W.MED", "C.MED", "ADRIATIC", "B.SEA", "NCONT"]);
const RED_AG = new Set(["R.SEA", "AG", "A.SEA", "ECAF", "ECI", "F.EAST"]);

// Suez direction from the zone pair (Med ↔ Red-Sea/Gulf/Asia/E.Africa).
export function detectSuezDirection(polZone: string, podZone: string): "Southbound" | "Northbound" {
  if (MED.has(polZone) && RED_AG.has(podZone)) return "Southbound";
  if (RED_AG.has(polZone) && MED.has(podZone)) return "Northbound";
  return "Southbound";
}

export function needsSuez(polZone: string, podZone: string): boolean {
  return (MED.has(polZone) && RED_AG.has(podZone)) || (RED_AG.has(polZone) && MED.has(podZone));
}

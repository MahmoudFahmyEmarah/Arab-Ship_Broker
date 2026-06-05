// ============================================================
// Voyage estimator — pure calculation engine.
//
// Per-fuel granularity is intentional: VLSFO and LSMGO are priced and burned
// separately, at sea and in port. This is the estimator's whole value, so the
// inputs never collapse fuels into a single consumption figure.
// ============================================================

export interface VoyageInputs {
  // Distance + speed
  ballastNm: number;
  ladenNm: number;
  speedKn: number;

  // Per-fuel consumption (MT/day)
  vlsfoSeaMtDay: number;
  vlsfoPortMtDay: number;
  lsmgoSeaMtDay: number;
  lsmgoPortMtDay: number;

  // Bunker prices ($/MT)
  vlsfoPrice: number;
  lsmgoPrice: number;

  // Cargo economics
  quantityMt: number;
  freightUsdMt: number;
  commissionPct: number;
  loadRateMtDay: number;
  dischRateMtDay: number;

  // Port disbursements + canal ($)
  polDaUsd: number;
  podDaUsd: number;
  suezUsd: number;
}

export interface VoyageBreakdown {
  seaDays: number;
  loadDays: number;
  dischDays: number;
  portDays: number;
  totalDays: number;

  vlsfoMt: number;
  lsmgoMt: number;
  vlsfoCost: number;
  lsmgoCost: number;
  bunkerCost: number;

  grossFreight: number;
  commission: number;
  netFreight: number;

  portCosts: number;
  voyageResult: number;
  tcePerDay: number;
}

const safe = (n: number) => (Number.isFinite(n) && !Number.isNaN(n) ? n : 0);
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

export function computeVoyage(i: VoyageInputs): VoyageBreakdown {
  const seaDays = div(safe(i.ballastNm) + safe(i.ladenNm), safe(i.speedKn) * 24);
  const loadDays = div(safe(i.quantityMt), safe(i.loadRateMtDay));
  const dischDays = div(safe(i.quantityMt), safe(i.dischRateMtDay));
  const portDays = loadDays + dischDays;
  const totalDays = seaDays + portDays;

  const vlsfoMt =
    seaDays * safe(i.vlsfoSeaMtDay) + portDays * safe(i.vlsfoPortMtDay);
  const lsmgoMt =
    seaDays * safe(i.lsmgoSeaMtDay) + portDays * safe(i.lsmgoPortMtDay);

  const vlsfoCost = vlsfoMt * safe(i.vlsfoPrice);
  const lsmgoCost = lsmgoMt * safe(i.lsmgoPrice);
  const bunkerCost = vlsfoCost + lsmgoCost;

  const grossFreight = safe(i.quantityMt) * safe(i.freightUsdMt);
  const commission = grossFreight * (safe(i.commissionPct) / 100);
  const netFreight = grossFreight - commission;

  const portCosts = safe(i.polDaUsd) + safe(i.podDaUsd) + safe(i.suezUsd);
  const voyageResult = netFreight - bunkerCost - portCosts;
  const tcePerDay = div(voyageResult, totalDays);

  return {
    seaDays,
    loadDays,
    dischDays,
    portDays,
    totalDays,
    vlsfoMt,
    lsmgoMt,
    vlsfoCost,
    lsmgoCost,
    bunkerCost,
    grossFreight,
    commission,
    netFreight,
    portCosts,
    voyageResult,
    tcePerDay,
  };
}

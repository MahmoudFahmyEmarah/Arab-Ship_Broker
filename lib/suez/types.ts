// Suez Canal transit cost domain — types shared by the engine, the SDK, the
// check script and the pages. Mirrors the jsonb returned by
// public.get_suez_tariff_context(date) (migration 20261003200000).

export type SuezDirection = "SB" | "NB";
export type SuezCargoStatus = "laden" | "ballast";
export type SuezLayer = "toll" | "fixed" | "conditional" | "waste";
export type SuezBasis =
  | "toll_tiered_scnt"
  | "flat"
  | "pct_of_toll"
  | "tier_by_scnt"
  | "per_unit"
  | "gt_threshold"
  | "flag_only";
export type SuezCurrency = "USD" | "SDR";
export type SuezPayer = "owner" | "charterer" | "either";
export type SuezLateBand = "none" | "b1" | "b2" | "b3";

export interface SuezTariffItem {
  code: string;
  labelEn: string;
  labelAr?: string | null;
  layer: SuezLayer;
  basis: SuezBasis;
  currency: SuezCurrency;
  params: Record<string, unknown>;
  directionScope: "any" | SuezDirection;
  cargoStatusScope: "any" | SuezCargoStatus;
  conditionKey: string | null;
  payerParty: SuezPayer;
  sortOrder: number;
  notes?: string | null;
}

export interface SuezTollTier {
  vesselCategory: string;
  cargoStatus: SuezCargoStatus;
  tierOrder: number;
  scntFrom: number;
  scntTo: number | null;
  sdrPerScnt: number;
  confidence: "official" | "placeholder";
}

export interface SuezSdrRate {
  rateUsd: number;
  asOf: string;
  source: string;
  notes?: string | null;
}

export interface SuezTariffVersion {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceRef: string;
  sourceUrl?: string | null;
  notes?: string | null;
}

export interface SuezTariffContext {
  found: true;
  date: string;
  version: SuezTariffVersion;
  items: SuezTariffItem[];
  tiers: SuezTollTier[];
  sdr: SuezSdrRate | null;
  suezDays: { transitDays?: number; anchorageDays?: number; nm?: number };
}

export type SuezTariffContextResult = SuezTariffContext | { found: false; date: string };

// What the calculator knows about the ship. Null = not sourced (the engine says
// so instead of guessing). mooringCranesOk may be derived from the cranes.
export interface SuezVesselFacts {
  scnt: number | null;
  scgt?: number | null;
  gt: number | null;
  category: string;
  buildYear?: number | null;
  craneCount?: number | null;
  craneSwlMt?: number | null;
  mooringCranesOk?: boolean | null;
  searchlightCompliant?: boolean | null;
  firstTransit?: boolean;
}

export interface SuezVoyageFacts {
  direction: SuezDirection;
  cargoStatus: SuezCargoStatus;
  transitDate: string; // ISO date
  heavyLiftOver250t?: boolean;
  floatingUnitScgt300?: boolean;
  militaryCargo?: boolean;
  lateArrivalBand?: SuezLateBand;
  notReady?: boolean;
  deckProtrusionFt?: number;
  ladderNoncompliant?: boolean;
  relievingPilots?: number;
  wasteNormalM3?: number;
  wasteHazardousM3?: number;
  bagsM3?: number;
  bargeHours?: number;
}

export interface SuezInput {
  vessel: SuezVesselFacts;
  voyage: SuezVoyageFacts;
  overrides?: { sdrRateUsd?: number; transitDays?: number; anchorageDays?: number };
}

export interface SuezLine {
  code: string;
  label: string;
  labelAr?: string | null;
  layer: SuezLayer;
  basis: SuezBasis;
  currency: SuezCurrency;
  amountNative: number; // in `currency`
  amountUsd: number;
  quantity?: number | null;
  unit?: string | null;
  explanation: string;
  payerParty: SuezPayer;
}

export interface SuezFlag extends SuezLine {
  conditionKey: string;
  triggered: boolean;
  potentialUsd: number | null; // what it would cost if it applied (null = undetermined)
  appliedUsd: number; // 0 unless triggered
  reason: string;
}

export interface SuezTollTierLine {
  tierOrder: number;
  scntFrom: number;
  scntTo: number | null;
  tons: number;
  sdrPerScnt: number;
  sdr: number;
}

export interface SuezEstimate {
  ok: boolean; // false when the toll could not be computed (no SCNT, no rate, no tiers)
  tariffVersion: SuezTariffVersion;
  sdrRate: SuezSdrRate | null;
  vesselCategory: string;
  categoryUsed: string; // the tier category actually used (fallback when the vessel's has none)
  scnt: number | null;
  cargoStatus: SuezCargoStatus;
  direction: SuezDirection;
  transitDate: string;
  layers: {
    toll: { sdr: number; usd: number; tiers: SuezTollTierLine[]; placeholder: boolean };
    fixed: SuezLine[];
    conditional: SuezFlag[];
    waste: SuezLine[];
  };
  wasteIncludedM3: number | null;
  totals: {
    tollUsd: number;
    fixedUsd: number;
    conditionalAppliedUsd: number;
    wasteUsd: number;
    appliedUsd: number; // what the broker should budget today
    potentialUsd: number; // applied + every untriggered flag with a known amount
  };
  transitDays: number;
  anchorageDays: number;
  warnings: string[];
}

export const SUEZ_VESSEL_CATEGORIES: { key: string; label: string }[] = [
  { key: "dry_bulk", label: "Dry bulk carrier" },
  { key: "general_cargo", label: "General cargo / multipurpose" },
  { key: "container", label: "Container ship" },
  { key: "tanker_crude", label: "Crude oil tanker" },
  { key: "tanker_product", label: "Product tanker" },
  { key: "chemical_tanker", label: "Chemical tanker" },
  { key: "lpg", label: "LPG carrier" },
  { key: "lng", label: "LNG carrier" },
  { key: "roro", label: "Ro-Ro" },
  { key: "car_carrier", label: "Car carrier" },
  { key: "passenger", label: "Passenger / cruise" },
  { key: "other", label: "Other / floating unit" },
];

// Best-effort mapping from the platform's vessel_type vocabulary.
export function suezCategoryFromVesselType(vesselType: string | null | undefined): string {
  const t = (vesselType ?? "").toLowerCase();
  if (!t) return "general_cargo";
  if (t.includes("container")) return "container";
  // "Break Bulk" and "General Cargo" before the bulk/car tests ("cargo" contains "car").
  if (t.includes("general") || t.includes("break") || t.includes("multi") || t.includes("mpp")) return "general_cargo";
  if (t.includes("bulk")) return "dry_bulk";
  if (t.includes("crude")) return "tanker_crude";
  if (t.includes("chemical")) return "chemical_tanker";
  if (t.includes("lng")) return "lng";
  if (t.includes("lpg") || t.includes("gas")) return "lpg";
  if (t.includes("tanker") || t.includes("product")) return "tanker_product";
  if (t.includes("ro-ro") || t.includes("roro")) return "roro";
  if (t.includes("car carrier") || t.includes("pctc") || t.includes("vehicle")) return "car_carrier";
  if (t.includes("passenger") || t.includes("cruise")) return "passenger";
  return "other";
}

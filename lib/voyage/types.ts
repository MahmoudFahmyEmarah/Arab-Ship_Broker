// Voyage cost estimator — types (Voyage Economics, Stream S).
// Contracts: PLAN-voyage-economics.md §4.1 (fuel index, consumed field
// averageUsdMt), §4.2 (Suez estimate), §4.3 (voyage_settings), §4.5 (profile).

export type OperatingState = "sea_laden" | "sea_ballast" | "port_working" | "port_idle" | "anchorage" | "eca_sea";
export const OPERATING_STATES: OperatingState[] = ["sea_laden", "sea_ballast", "port_working", "port_idle", "anchorage", "eca_sea"];

export interface StateConsumption { residual?: number | null; distillate?: number | null }
export type ConsumptionMap = Partial<Record<OperatingState, StateConsumption>>;
export type VesselClass = "A" | "B" | "C";

// What the engine needs to know about the ship (from vessel_economics_profiles,
// vessel_availability or manual entry — the page decides; the engine only cares
// about the numbers and says what it had to assume).
export interface VoyageVesselProfile {
  name?: string;
  speedLadenKn: number | null;
  speedBallastKn: number | null;
  consumption: ConsumptionMap;
  hasScrubber: boolean;
  vesselClass: VesselClass | null;
}

export interface VoyageSettings {
  speeds: { ladenKn: number; ballastKn: number };
  seaMargin: { defaultPct: number; byLane?: Record<string, number>; bySeason?: Record<string, number> };
  portTimeDays: { loadDefault: number; dischDefault: number; idleSharePct: number };
  anchorageDaysDefault: number;
  suez: { transitDays: number; anchorageDays: number; nm: number };
  opex: { crewUsdDay: number; maintenanceUsdDay: number };
  classMultipliers: Record<VesselClass, number>;
  eca: { fuelProductKey: string };
  fuelFallback: Record<string, number>;
}

export const DEFAULT_VOYAGE_SETTINGS: VoyageSettings = {
  speeds: { ladenKn: 12.5, ballastKn: 13.0 },
  seaMargin: { defaultPct: 5, byLane: {}, bySeason: {} },
  portTimeDays: { loadDefault: 1.5, dischDefault: 1.5, idleSharePct: 20 },
  anchorageDaysDefault: 0,
  suez: { transitDays: 1, anchorageDays: 0.5, nm: 100 },
  opex: { crewUsdDay: 1450, maintenanceUsdDay: 800 },
  classMultipliers: { A: 2.2, B: 1.5, C: 1.0 },
  eca: { fuelProductKey: "LSMGO" },
  fuelFallback: { VLSFO: 585, LSMGO: 725, HSFO380: 450, MGO05: 700 },
};

// A price the engine will use for one product: from the fuel index (average)
// or from the settings fallback — the source is carried into the output.
export interface FuelPriceInput {
  usdMt: number;
  source: "index" | "fallback" | "manual";
  asOf?: string | null;
  port?: string | null;
  scope?: "port" | "region" | "global" | null;
  quoteCount?: number | null;
}
export type FuelPriceMap = Record<string, FuelPriceInput>;

export interface SeaLegInput {
  key: "ballast" | "laden";
  from: string | null;
  to: string | null;
  nm: number | null; // null = unknown
  ecaNm: number | null; // null = unknown share → zone rule or 0 with a warning
  nmSource?: "measured" | "manual" | "estimate" | null;
}

export interface CanalInput {
  required: boolean;
  name?: string; // "Suez"
  transitDays: number;
  anchorageDays: number;
  anchorageInEca: boolean; // Port Said side is inside the Med ECA
  costUsd: number; // Suez estimate totals.appliedUsd
  nm?: number;
  tariffVersionNo?: number | null;
  ok?: boolean; // Suez estimate ok flag
}

export interface PortCallInput {
  key: "load" | "disch";
  port: string | null;
  qtyMt: number;
  rateMtDay: number | null; // null → settings default days
  allowanceDays?: number; // turn time, notices, shifting
  inEca?: boolean;
  pdaUsd?: number | null; // from the PDA module or manual
  pdaSource?: "tariff" | "manual" | "none";
}

export interface VoyageInput {
  vessel: VoyageVesselProfile;
  legs: { ballast?: SeaLegInput | null; laden: SeaLegInput };
  canal?: CanalInput | null;
  ports: { load: PortCallInput; disch: PortCallInput };
  anchorageDays?: number | null;
  anchorageInEca?: boolean;
  seaMarginPct?: number | null; // null → settings default
  prices: FuelPriceMap;
  settings: VoyageSettings;
  revenue?: { qtyMt: number; freightUsdMt: number | null; commissionPct: number } | null;
  extras?: { insuranceUsd?: number; stevedoringUsd?: number; otherUsd?: number } | null;
}

export interface FuelBurn { productKey: string; mt: number }

export interface VoyageLegResult {
  key: string;
  label: string;
  kind: "sea" | "canal" | "port" | "anchorage";
  from: string | null;
  to: string | null;
  nm: number | null;
  ecaNm: number | null;
  days: number;
  ecaDays: number;
  burns: FuelBurn[];
  note: string;
}

export interface VoyageFuelLine {
  productKey: string;
  mt: number;
  usdMt: number;
  usd: number;
  priceSource: FuelPriceInput["source"];
  priceAsOf?: string | null;
  pricePort?: string | null;
}

export interface VoyageEstimate {
  ok: boolean; // false when a core figure is missing (distance, speed, consumption)
  days: {
    seaBallast: number;
    seaLaden: number;
    canalTransit: number;
    canalAnchorage: number;
    portLoad: number;
    portDisch: number;
    anchorage: number;
    total: number;
  };
  seaMarginPct: number;
  legs: VoyageLegResult[];
  fuel: { lines: VoyageFuelLine[]; totalMt: number; totalUsd: number; ecaMt: number; residualProduct: string; ecaProduct: string };
  opex: { baseUsdDay: number; multiplier: number; vesselClass: VesselClass; usdDay: number; usd: number };
  costs: { fuelUsd: number; canalUsd: number; pdaLoadUsd: number; pdaDischUsd: number; extrasUsd: number; voyageCostsUsd: number; opexUsd: number; totalUsd: number };
  revenue: { grossFreightUsd: number; commissionUsd: number; netFreightUsd: number; tceUsdDay: number; resultAfterOpexUsd: number } | null;
  assumptions: string[]; // what was defaulted
  warnings: string[]; // what is missing or doubtful
}

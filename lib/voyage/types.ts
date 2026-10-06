// Voyage cost estimator — types (voyage-engine/2).
// Contracts: PLAN-voyage-economics.md §4.1 (fuel index average), §4.2 (Suez
// estimate), §4.3 (voyage_settings), §4.5 (profile); audit O2C-024.
// Every component the engine prices carries a status; nothing is substituted
// for a missing governed input.
import type { FuelIndexSnapshot, ManualProvenance } from "./snapshots";

export type OperatingState = "sea_laden" | "sea_ballast" | "port_working" | "port_idle" | "anchorage" | "eca_sea";
export const OPERATING_STATES: OperatingState[] = ["sea_laden", "sea_ballast", "port_working", "port_idle", "anchorage", "eca_sea"];

export interface StateConsumption { residual?: number | null; distillate?: number | null }
export type ConsumptionMap = Partial<Record<OperatingState, StateConsumption>>;
export type VesselClass = "A" | "B" | "C";
export type Season = "winter" | "spring" | "summer" | "autumn";

/** trusted = governed data · fallback = admin fallback price (labelled) · manual = broker-supplied with provenance · unavailable = missing governed input · invalid = malformed */
export type ComponentStatus = "trusted" | "fallback" | "manual" | "unavailable" | "invalid";
export type VoyageStatus = "trusted" | "partial" | "unavailable" | "invalid";

export interface VoyageVesselProfile {
  name?: string;
  speedLadenKn: number | null;
  speedBallastKn: number | null;
  consumption: ConsumptionMap;
  /** true / false when known; null = unknown (priced as no scrubber, stated as an assumption) */
  hasScrubber: boolean | null;
  vesselClass: VesselClass | null;
}

export interface VoyageSettings {
  speeds: { ladenKn: number; ballastKn: number };
  seaMargin: { defaultPct: number; byLane?: Record<string, number>; bySeason?: Partial<Record<Season, number>> };
  portTimeDays: { loadDefault: number; dischDefault: number; idleSharePct: number };
  anchorageDaysDefault: number;
  /** anchorages: [lat, lon] of the convoy anchorage per direction (governed points the ECA test uses) */
  suez: { transitDays: number; anchorageDays: number; nm: number; anchorages?: { SB?: [number, number]; NB?: [number, number] } };
  opex: { crewUsdDay: number; maintenanceUsdDay: number };
  classMultipliers: Record<VesselClass, number>;
  eca: { fuelProductKey: string; distillateProductKey?: string };
  fuelFallback: Record<string, number>;
  seedMarker?: string;
  /** keys of PLATFORM_CONSTANTS the owner has confirmed with a source; every other one is shown as "platform assumption" */
  confirmed?: string[];
}

/** The settings constants that are platform assumptions until the owner confirms them (owner ruling B2O-010 §1). */
export const PLATFORM_CONSTANTS: { key: string; label: (s: VoyageSettings) => string }[] = [
  { key: "opex.crewUsdDay", label: (s) => `crew USD ${s.opex.crewUsdDay.toLocaleString("en-US")}/day` },
  { key: "opex.maintenanceUsdDay", label: (s) => `maintenance USD ${s.opex.maintenanceUsdDay.toLocaleString("en-US")}/day` },
  { key: "classMultipliers", label: (s) => `class multipliers A ${s.classMultipliers.A} / B ${s.classMultipliers.B} / C ${s.classMultipliers.C}` },
  { key: "seaMargin.defaultPct", label: (s) => `sea margin ${s.seaMargin.defaultPct} %` },
  { key: "speeds", label: (s) => `default speeds ${s.speeds.ladenKn} kn laden / ${s.speeds.ballastKn} kn ballast` },
  { key: "portTimeDays", label: (s) => `default port time ${s.portTimeDays.loadDefault} / ${s.portTimeDays.dischDefault} days, idle share ${s.portTimeDays.idleSharePct} %` },
  { key: "suez.days", label: (s) => `Suez transit ${s.suez.transitDays} day + anchorage ${s.suez.anchorageDays} day, ${s.suez.nm} NM` },
];

export const DEFAULT_VOYAGE_SETTINGS: VoyageSettings = {
  speeds: { ladenKn: 12.5, ballastKn: 13.0 },
  seaMargin: { defaultPct: 5, byLane: {}, bySeason: {} },
  portTimeDays: { loadDefault: 1.5, dischDefault: 1.5, idleSharePct: 20 },
  anchorageDaysDefault: 0,
  suez: { transitDays: 1, anchorageDays: 0.5, nm: 100 },
  opex: { crewUsdDay: 1450, maintenanceUsdDay: 800 },
  classMultipliers: { A: 2.2, B: 1.5, C: 1.0 },
  eca: { fuelProductKey: "LSMGO", distillateProductKey: "LSMGO" },
  fuelFallback: { VLSFO: 585, LSMGO: 725, HSFO380: 450, MGO05: 700 },
};

export type SettingsSource = "governed" | "defaults";

// Engine revisions stamped on every estimate and snapshot (also re-exported by ./snapshots).
export const VOYAGE_ALGORITHM_VERSION = "voyage-engine/2";
export const ECA_SPLIT_ALGORITHM_VERSION = "fn_route_eca_split/3";

export interface SeaLegInput {
  key: "ballast" | "laden";
  from: string | null;
  to: string | null;
  nm: number | null; // null = unknown → the leg is unavailable
  ecaNm: number | null; // null = share unknown → priced as non-ECA, leg partial
  method: "waypoints" | "distance_only" | "manual" | "none";
  routeSource?: string | null;
  /** false = the measured track is an unverified import: the leg is fallback, never trusted */
  routeVerified?: boolean | null;
  /** canal miles contained in the measured track; deducted when this leg's canal transit is priced as its own leg */
  canalNm?: number | null;
  /** coarse = the ECA share comes from a coarse ring (a fallback, never trusted) */
  ecaConfidence?: "official" | "coarse" | null;
  manual?: ManualProvenance; // required when method = manual
}

export interface CanalInput {
  required: boolean;
  name: string; // "Suez"
  /** which sea leg transits the canal (default laden) */
  leg?: "laden" | "ballast";
  status: ComponentStatus; // trusted | manual | fallback | unavailable (from the Suez estimate)
  costUsd: number | null; // null when unavailable
  transitDays: number;
  anchorageDays: number;
  anchorageInEca: boolean;
  /** governed = point-in-zone of the settings anchorage; manual = asserted by the broker (estimate partial) */
  anchorageInEcaSource?: "governed" | "coarse" | "manual";
  nm: number;
  tariffVersionNo: number | null;
  complete: boolean;
  /** broker-supplied canal cost used only when the Suez estimate is incomplete */
  manual?: ManualProvenance;
}

export interface PortCallInput {
  key: "load" | "disch";
  port: string | null;
  qtyMt: number;
  rateMtDay: number | null; // null → settings default days (assumption)
  allowanceDays: number;
  inEca: boolean;
  openLoopBan: boolean; // scrubber washwater banned in port → compliant fuel in port
  euBerthOver2h: boolean; // EU berth beyond 2 h → 0.10 % in port
  /** governed = from the route's start/end zones; manual = asserted by the broker (estimate partial) */
  inEcaSource?: "governed" | "coarse" | "manual";
  /** listing = the handling rate of the linked cargo listing; manual = typed for this estimate (a broker input) */
  rateSource?: "listing" | "manual";
  pda: { usd: number | null; source: "tariff" | "manual" | "none"; manual?: ManualProvenance };
}

export interface VoyageInput {
  vessel: VoyageVesselProfile;
  legs: { ballast: SeaLegInput | null; laden: SeaLegInput };
  canal: CanalInput | null;
  /** a second transit on the ballast leg (e.g. open in the Red Sea, loading in the Med) */
  ballastCanal?: CanalInput | null;
  /** profile = the vessel's governed economics profile; manual = facts typed for this estimate (estimate partial) */
  vesselSource?: "profile" | "manual";
  /** listing = the start date is the linked cargo's laycan; manual = typed by the broker (a broker input) */
  scheduleSource?: "listing" | "manual";
  ports: { load: PortCallInput; disch: PortCallInput };
  anchorageDays: number;
  anchorageInEca: boolean;
  /** governed = the discharge port's governed ECA status; anything else is the broker's (C2O-050 #4) */
  waitingAnchorageEcaSource?: "governed" | "manual";
  seaMarginPct: number | null; // null → settings (default + lane + season)
  lane: string | null; // "E.MED>AG" style key for settings.seaMargin.byLane
  season: Season | null;
  fuel: FuelIndexSnapshot;
  settings: VoyageSettings;
  settingsSource: SettingsSource;
  revenue: { qtyMt: number; freightUsdMt: number; commissionPct: number } | null;
  extras: { insuranceUsd: number; stevedoringUsd: number; otherUsd: number };
}

export interface FuelBurn { productKey: string; mt: number }

export interface VoyageLegResult {
  key: string;
  label: string;
  kind: "sea" | "canal" | "port" | "anchorage";
  status: ComponentStatus;
  from: string | null;
  to: string | null;
  nm: number | null;
  ecaNm: number | null;
  ecaShareKnown: boolean;
  days: number;
  ecaDays: number;
  burns: FuelBurn[];
  note: string;
}

export interface VoyageFuelLine {
  productKey: string;
  mt: number;
  status: ComponentStatus; // trusted (index average) | fallback | unavailable
  usdMt: number | null;
  usd: number | null;
  priceAsOf: string | null;
  pricePort: string | null;
  priceScope: string | null;
}

export interface VoyageEstimate {
  status: VoyageStatus;
  /** convenience: status === "trusted" */
  ok: boolean;
  algorithmVersion: string;
  settingsSource: SettingsSource;
  days: { seaBallast: number; seaLaden: number; canalTransit: number; canalAnchorage: number; portLoad: number; portDisch: number; anchorage: number; total: number };
  seaMarginPct: number;
  seaMarginBasis: string;
  legs: VoyageLegResult[];
  fuel: { status: ComponentStatus; lines: VoyageFuelLine[]; totalMt: number; pricedMt: number; totalUsd: number; ecaMt: number; residualProduct: string; ecaProduct: string; distillateProduct: string; indexAsOf: string | null; indexScope: string | null };
  opex: { baseUsdDay: number; multiplier: number; vesselClass: VesselClass; classAssumed: boolean; usdDay: number; usd: number };
  costs: {
    fuel: { usd: number; status: ComponentStatus };
    canal: { usd: number | null; status: ComponentStatus; required: boolean };
    pdaLoad: { usd: number | null; status: ComponentStatus };
    pdaDisch: { usd: number | null; status: ComponentStatus };
    extrasUsd: number;
    /** sum of the computable voyage-cost parts (fuel + canal + DAs + extras) */
    voyageCostsUsd: number;
    opexUsd: number;
    /** voyage costs + running cost; meaningful only with complete = true */
    totalUsd: number;
    complete: boolean;
  };
  revenue: { grossFreightUsd: number; commissionUsd: number; netFreightUsd: number; tceUsdDay: number; resultAfterOpexUsd: number } | null;
  unavailable: { code: string; reason: string }[];
  assumptions: string[];
  /** settings constants used by this estimate that the owner has not confirmed (shown "platform assumption") */
  platformAssumptions: { key: string; label: string }[];
  warnings: string[];
  errors?: string[];
}

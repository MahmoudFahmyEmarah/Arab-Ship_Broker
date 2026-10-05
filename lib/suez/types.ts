// Suez Canal transit cost domain — types shared by the engine, the SDK, the
// check script and the pages. Mirrors the jsonb returned by
// public.get_suez_tariff_context(date) (migrations 20261003200000 + 205000).
//
// Every figure the engine emits carries a status. Nothing is ever substituted
// for a missing governed input: it is `unavailable` (or `manual` when the
// broker supplied it with a reason), and the estimate says so.

export type SuezDirection = "SB" | "NB";
export type SuezCargoStatus = "laden" | "ballast";
export type SuezLayer = "toll" | "fixed" | "conditional" | "waste" | "surcharge";
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

/** trusted = published data and known facts · placeholder = flagged bands · manual = broker-supplied with provenance · unavailable = a governed input is missing · invalid = the tariff data itself is malformed */
export type LineStatus = "trusted" | "placeholder" | "manual" | "unavailable" | "invalid";
export type EstimateStatus = "trusted" | "partial" | "unavailable" | "invalid";

export const SUEZ_ALGORITHM_VERSION = "suez-engine/3";

/** unknown = the version has not modelled the category surcharges (toll never trusted) · none = no surcharge in force for the window · modelled = surcharge items carry them */
export type SuezSurchargeRegime = "unknown" | "none" | "modelled";

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
  /** SCA vessel categories the item applies to; null/absent = every category */
  categoryScope?: string[] | null;
  /** official = instrument on file · reported = relayed/press report (never trusted) */
  confidence?: "official" | "reported";
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
  id?: string;
  rateUsd: number;
  asOf: string;
  source: string;
  notes?: string | null;
}

export interface SuezTariffSource {
  id: string;
  title: string;
  issuer: string;
  documentNo: string | null;
  issueDate: string | null;
  authority: "official" | "agent" | "reference" | "owner";
  evidenceStatus: "on_file" | "pending_document";
  sha256: string | null;
}

export interface SuezTariffVersion {
  id: string;
  versionNo: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceRef: string;
  sourceUrl?: string | null;
  notes?: string | null;
  publishedAt?: string | null;
  /** absent on contexts older than suez-engine/3 = unknown */
  surchargeRegime?: SuezSurchargeRegime;
}

export interface SuezTariffContext {
  found: true;
  date: string;
  version: SuezTariffVersion;
  sources?: SuezTariffSource[];
  items: SuezTariffItem[];
  tiers: SuezTollTier[];
  sdr: SuezSdrRate | null;
  suezDays: { transitDays?: number; anchorageDays?: number; nm?: number };
  algorithmVersion?: string;
}

export type SuezTariffContextResult = SuezTariffContext | { found: false; date: string };

// What the calculator knows about the ship. Null = not sourced: the engine
// reports it, never guesses. mooringCranesOk may be derived from the cranes
// against the tariff's own SWL / boat-count parameters.
export interface SuezVesselFacts {
  /** SCNT may carry decimals (SCA charges fractional tons) */
  scnt: number | null;
  scgt?: number | null;
  gt: number | null;
  category: string;
  buildYear?: number | null;
  craneCount?: number | null;
  craneSwlMt?: number | null;
  mooringCranesOk?: boolean | null;
  searchlightCompliant?: boolean | null;
  /** true / false when the transit history is known; null = unknown (manual review, never a charge) */
  firstTransit?: boolean | null;
  /** arrival draft and beam in feet, double-bottom tanks — the escort-tug triggers; null = unknown (undecided) */
  draftFt?: number | null;
  beamFt?: number | null;
  doubleBottom?: boolean | null;
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

/** A broker-supplied figure replacing a governed one: always with who, why and when. */
export interface ManualValue<T> {
  value: T;
  reason: string;
  actorUserId: string;
  at: string; // ISO timestamp
}

export interface SuezOverrides {
  sdrRate?: ManualValue<number>;
  /** a broker figure replacing the governed Suez days: always with who, why and when; the estimate is partial */
  transitDays?: ManualValue<number>;
  anchorageDays?: ManualValue<number>;
}

export interface SuezInput {
  vessel: SuezVesselFacts;
  voyage: SuezVoyageFacts;
  overrides?: SuezOverrides;
}

export interface SuezLine {
  code: string;
  label: string;
  labelAr?: string | null;
  layer: SuezLayer;
  basis: SuezBasis;
  currency: SuezCurrency;
  status: LineStatus;
  amountNative: number | null; // in `currency`; null when not computable
  amountUsd: number | null;
  quantity?: number | null;
  unit?: string | null;
  explanation: string;
  payerParty: SuezPayer;
}

export interface SuezFlag extends SuezLine {
  conditionKey: string;
  /** true = applies · false = does not apply · null = cannot be decided from the facts (manual review) */
  triggered: boolean | null;
  potentialUsd: number | null; // what it would cost if it applied (null = undetermined)
  appliedUsd: number; // 0 unless triggered === true
  reason: string;
  /** a charge that applies only if something happens later (cancellation, wrong declaration): listed, never summed */
  contingent?: boolean;
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
  status: EstimateStatus;
  /** convenience: status === "trusted" */
  ok: boolean;
  algorithmVersion: string;
  tariffVersion: SuezTariffVersion;
  sources: SuezTariffSource[];
  sdrRate: { status: LineStatus; rateUsd: number | null; asOf: string | null; source: string | null; manual?: ManualValue<number> };
  vesselCategory: string;
  scnt: number | null;
  cargoStatus: SuezCargoStatus;
  direction: SuezDirection;
  transitDate: string;
  layers: {
    toll: { status: LineStatus; sdr: number | null; usd: number | null; tiers: SuezTollTierLine[]; reason: string | null };
    /** category surcharges on the toll (temporary SCA surcharges); status says whether the version covers the category */
    surcharge: { status: LineStatus; regime: SuezSurchargeRegime; lines: SuezLine[]; reason: string | null };
    fixed: SuezLine[];
    conditional: SuezFlag[];
    waste: SuezLine[];
  };
  wasteIncludedM3: number | null;
  totals: {
    tollUsd: number | null;
    surchargeUsd: number;
    fixedUsd: number; // sum of the computable fixed lines
    conditionalAppliedUsd: number;
    wasteUsd: number;
    /** sum of every computable part; meaningful only with complete = true */
    appliedUsd: number;
    /** applied + every undecided/untriggered flag with a known amount */
    potentialUsd: number;
    complete: boolean;
  };
  /** codes of the lines that could not be computed, with the reason */
  unavailable: { code: string; reason: string }[];
  /** lines whose tariff data is malformed (a published version should never have these) */
  invalid: { code: string; reason: string }[];
  transitDays: number;
  anchorageDays: number;
  warnings: string[];
  errors?: string[]; // input validation failures (status = invalid)
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
  { key: "floating_unit", label: "Floating unit (dock, rig, crane barge)" },
  { key: "other", label: "Other" },
];

// Best-effort mapping from the platform's vessel_type vocabulary. Unknown →
// null: the calculator asks, it does not assume.
export function suezCategoryFromVesselType(vesselType: string | null | undefined): string | null {
  const t = (vesselType ?? "").toLowerCase();
  if (!t) return null;
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
  return null;
}

import type { PdaAllocation } from "./estimator-contract";
import type { PdaCalculationResult, PdaManualLineInput, PdaRequest, PdaWarning } from "./types";

export const PDA_ROUTE_SERVICE_CODES = [
  "port_dues",
  "pilotage",
  "towage",
  "mooring",
  "cargo_handling",
  "agency",
  "waste",
  "security",
  "launch",
] as const;

export type PdaRouteServiceCode = (typeof PDA_ROUTE_SERVICE_CODES)[number];

export type PdaRouteManualLineInput = Omit<PdaManualLineInput, "enteredBy">;

export const PDA_ROUTE_SERVICE_OPTIONS: ReadonlyArray<{ code: PdaRouteServiceCode; label: string }> = [
  { code: "port_dues", label: "Port dues" },
  { code: "pilotage", label: "Pilotage" },
  { code: "towage", label: "Towage" },
  { code: "mooring", label: "Mooring" },
  { code: "cargo_handling", label: "Cargo handling" },
  { code: "agency", label: "Agency" },
  { code: "waste", label: "Waste" },
  { code: "security", label: "Security" },
  { code: "launch", label: "Launch" },
];

export interface PdaRouteLegInput {
  portLocode: string;
  terminalId?: string | null;
  /** Calendar date at the port. This, rather than a UTC voyage instant, selects the tariff version. */
  callDate: string;
  call: {
    cargoStatus: "laden" | "ballast";
    voyageScope: "domestic" | "international";
    location: "alongside" | "anchorage";
    requestedServices: PdaRouteServiceCode[];
    hours?: number | null;
    units?: number | null;
  };
  manualLines?: PdaRouteManualLineInput[];
}

export interface PdaRouteTimelineInput {
  etaLoad: string;
  loadTurnDays: number;
  loadProductivityMtPerDay: number;
  passageDistanceNm: number;
  passageSpeedKnots: number;
  dischargeTurnDays: number;
  dischargeProductivityMtPerDay: number;
  dailyOpex: number | null;
}

export interface PdaRoutePreviewInput {
  selection: {
    vesselAvailabilityId: string;
    cargoId: string;
    quantityMt: number;
  };
  displayCurrency: string;
  allocation: PdaAllocation;
  load: PdaRouteLegInput;
  discharge: PdaRouteLegInput;
  timeline: PdaRouteTimelineInput;
}

export interface PdaRouteTimelineResult {
  etaLoad: string;
  etdLoad: string;
  etaDischarge: string;
  etdDischarge: string;
  loadTurnDays: number;
  loadWorkingDays: number;
  loadPortDays: number;
  passageDays: number;
  dischargeTurnDays: number;
  dischargeWorkingDays: number;
  dischargePortDays: number;
  totalKnownDays: number;
  voyageOpex: number | null;
}

export type PdaRouteNotSourcedReason =
  | "NO_GOVERNED_SOURCE"
  | "NO_PUBLISHED_TARIFF"
  | "NO_APPLICABLE_RULES"
  | "MISSING_TARIFF_INPUT"
  | "MANUAL_QUOTE_REQUIRED"
  | "MANUAL_QUOTE_DUPLICATE"
  | "MANUAL_QUOTE_UNMATCHED"
  | "MANUAL_QUOTE_NOT_APPLIED"
  | "REQUESTED_SERVICE_NOT_SOURCED"
  | "FX_RATE_REQUIRED"
  | "PASSAGE_INPUT_REQUIRED";

export interface PdaRouteNotSourcedItem {
  code: string;
  label: string;
  amount: null;
  reasonCode: PdaRouteNotSourcedReason;
  message: string;
  provenance: {
    leg: "load" | "discharge" | null;
    tariffVersionId: string | null;
    warningCode?: PdaWarning["code"];
    ruleCode?: string | null;
    requestedService?: string;
  };
}

export interface PdaRoutePreviewResult {
  displayCurrency: string;
  allocation: PdaAllocation;
  canonical: {
    vesselAvailabilityId: string;
    vesselId: string | null;
    cargoId: string;
    quantityMt: number;
    loadRequest: PdaRequest;
    dischargeRequest: PdaRequest;
  };
  legs: {
    load: PdaCalculationResult;
    discharge: PdaCalculationResult;
  };
  timeline: PdaRouteTimelineResult;
  totals: {
    loadPort: number | null;
    dischargePort: number | null;
    loadPortKnown: number | null;
    dischargePortKnown: number | null;
    bothPortsKnown: number | null;
    handlingAndAgencyComplete: number | null;
    transit: null;
    allInKnown: number | null;
    allInComplete: null;
    voyageOpex: number | null;
  };
  notSourced: PdaRouteNotSourcedItem[];
  generatedAt: string;
}

import type { PdaAllocation } from "./estimator-contract";
import type { PdaCalculationResult, PdaRequest } from "./types";

export interface PdaRouteTimelineInput {
  etaLoad: string | null;
  loadTurnDays: number;
  loadProductivityMtPerDay: number;
  passageDistanceNm: number | null;
  passageSpeedKnots: number | null;
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
  load: PdaRequest;
  discharge: PdaRequest;
  timeline: PdaRouteTimelineInput;
}

export interface PdaRouteTimelineResult {
  etaLoad: string | null;
  etdLoad: string | null;
  etaDischarge: string | null;
  etdDischarge: string | null;
  loadTurnDays: number;
  loadWorkingDays: number;
  loadPortDays: number;
  passageDays: number | null;
  dischargeTurnDays: number;
  dischargeWorkingDays: number;
  dischargePortDays: number;
  totalKnownDays: number;
  voyageOpex: number | null;
}

export type PdaRouteNotSourcedReason =
  | "NO_GOVERNED_SOURCE"
  | "NO_PUBLISHED_TARIFF"
  | "FX_RATE_REQUIRED"
  | "PASSAGE_INPUT_REQUIRED";

export interface PdaRouteNotSourcedItem {
  code: string;
  label: string;
  amount: null;
  reasonCode: PdaRouteNotSourcedReason;
  message: string;
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
    bothPortsKnown: number | null;
    transit: null;
    allInKnown: number | null;
    allInComplete: null;
    voyageOpex: number | null;
  };
  notSourced: PdaRouteNotSourcedItem[];
  generatedAt: string;
}

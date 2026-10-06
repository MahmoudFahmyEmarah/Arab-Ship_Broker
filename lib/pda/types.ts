export const PDA_BASES = [
  "flat",
  "per_call",
  "per_day",
  "per_hour",
  "per_gt",
  "per_nt",
  "per_scnrt",
  "per_dwt",
  "per_loa",
  "per_cargo_mt",
  "per_gt_day",
  "per_loa_day",
  "per_loa_hour",
  "per_unit",
  "percentage",
  "tiered_flat",
  "tiered_rate",
  "progressive",
  "manual_quote",
] as const;

export type PdaBasis = (typeof PDA_BASES)[number];
export type PdaCoverage = "published" | "partial" | "manual_required";
export type RoundingMode = "half_up" | "up" | "down";
/** How a rule counts a duration (PR-10): exact, or every started unit counts as a whole one. */
export type DurationRounding = "exact" | "started";
export type SettlementMode = "cash" | "agent_account";

export interface PdaVesselFacts {
  vesselId?: string | null;
  vesselName?: string | null;
  imo?: string | null;
  gt?: number | null;
  nt?: number | null;
  scnrt?: number | null;
  dwt?: number | null;
  loaM?: number | null;
  draftM?: number | null;
  vesselType?: string | null;
}

export interface PdaCallFacts {
  days: number;
  hours?: number | null;
  cargoQuantityMt?: number | null;
  units?: number | null;
  cargoType?: string | null;
  cargoStatus?: "laden" | "ballast" | null;
  voyageScope?: "domestic" | "international" | null;
  location?: "alongside" | "anchorage" | null;
  /** Typed settlement mode (PR-10); used by applicability, never inferred. */
  settlementMode?: SettlementMode | null;
  requestedServices: string[];
}

export interface PdaRequest {
  portLocode: string;
  terminalId?: string | null;
  callDate: string;
  vessel: PdaVesselFacts;
  call: PdaCallFacts;
  convertedCurrency?: string | null;
  fxRate?: number | null;
  manualLines?: PdaManualLineInput[];
}

export interface PdaManualLineInput {
  ruleCode?: string | null;
  label: string;
  amount: number;
  reason: string;
  enteredBy: string;
}

export interface PdaApplicability {
  requestedServices?: string[];
  vesselTypes?: string[];
  cargoTypes?: string[];
  cargoStatuses?: Array<"laden" | "ballast">;
  voyageScopes?: Array<"domestic" | "international">;
  locations?: Array<"alongside" | "anchorage">;
  settlementModes?: SettlementMode[];
  minGt?: number;
  maxGt?: number;
  minNt?: number;
  maxNt?: number;
  minScnrt?: number;
  maxScnrt?: number;
  minDwt?: number;
  maxDwt?: number;
  minLoaM?: number;
  maxLoaM?: number;
  minDraftM?: number;
  maxDraftM?: number;
  minCargoQuantityMt?: number;
  maxCargoQuantityMt?: number;
  percentageBaseCodes?: string[];
}

export interface PdaTariffBand {
  order: number;
  lowerBound: number;
  upperBound?: number | null;
  flatAmount?: number | null;
  rate?: number | null;
}

export interface PdaTariffRule {
  id: string;
  code: string;
  label: string;
  basis: PdaBasis;
  amount?: number | null;
  rate?: number | null;
  priority: number;
  unit?: string | null;
  includedUnits?: number | null;
  /** Duration rounding for per_day/per_hour and the compound bases (default exact). */
  rounding?: DurationRounding | null;
  /** Duration unit size in days or hours (default 1). */
  unitSize?: number | null;
  minimumAmount?: number | null;
  maximumAmount?: number | null;
  taxPercent?: number | null;
  applicability?: PdaApplicability;
  bands?: PdaTariffBand[];
  manualInstructions?: string | null;
  source: {
    sourceId: string;
    title: string;
    page?: string | null;
    sheet?: string | null;
    excerpt?: string | null;
  };
}

export interface PdaTariffVersion {
  id: string;
  tariffSetId: string;
  portLocode: string;
  terminalId?: string | null;
  versionNo: number;
  currency: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
  roundingMode: RoundingMode;
  decimalPlaces: number;
  rules: PdaTariffRule[];
}

export interface PdaExplainedLine {
  ruleId: string | null;
  ruleCode: string | null;
  label: string;
  basis: PdaBasis | "manual";
  quantity: number | null;
  rate: number | null;
  amount: number;
  convertedAmount?: number;
  explanation: string;
  inputs: Record<string, unknown>;
  /** Governed service identifiers derived from the rule code and unambiguous applicability. */
  serviceCodes: string[];
  manual: boolean;
  manualReason?: string;
  enteredBy?: string;
  evidence: {
    sourceId?: string;
    title?: string;
    page?: string | null;
    sheet?: string | null;
    excerpt?: string | null;
  };
}

export interface PdaWarning {
  code:
    | "NO_PUBLISHED_TARIFF"
    | "PORT_MISMATCH"
    | "TERMINAL_MISMATCH"
    | "VERSION_NOT_EFFECTIVE"
    | "MISSING_INPUT"
    | "TARIFF_GAP"
    | "MANUAL_QUOTE_REQUIRED"
    | "MANUAL_QUOTE_DUPLICATE"
    | "MANUAL_QUOTE_UNMATCHED"
    | "MANUAL_QUOTE_NOT_APPLIED"
    | "MANUAL_LINE"
    | "NO_APPLICABLE_RULES";
  message: string;
  ruleCode?: string;
}

export interface PdaCalculationResult {
  coverage: PdaCoverage;
  tariffVersionId: string | null;
  nativeCurrency: string;
  convertedCurrency?: string;
  lines: PdaExplainedLine[];
  totals: { native: number; converted?: number };
  warnings: PdaWarning[];
  generatedAt: string;
}

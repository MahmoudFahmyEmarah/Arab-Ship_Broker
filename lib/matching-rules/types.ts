export const MATCHING_RULE_SCHEMA_VERSION = 1 as const;

export type MatchScoreLabel = "Possible" | "Good" | "Strong";
export type MatchDisplayLabel = MatchScoreLabel | "Weak";

export interface MatchingScoreWeightsV1 {
  readonly dwtTight: number;
  readonly dwtLoose: number;
  readonly zoneLoad: number;
  readonly zoneDisch: number;
  readonly gear: number;
}

/**
 * The complete effective v1 document persisted by SQL and consumed by every
 * matcher. Metadata and future advisory controls deliberately do not belong in
 * this payload, so changing them cannot change its publication identity.
 */
export interface MatchingRulesV1Payload {
  readonly schemaVersion: typeof MATCHING_RULE_SCHEMA_VERSION;
  readonly dwtTolerancePct: number;
  readonly partCargoTolerancePct: number;
  readonly laycanBeforeDays: number;
  readonly laycanAfterDays: number;
  readonly rateAlignmentUsd: number;
  readonly minScoreLabel: MatchScoreLabel;
  readonly score: Readonly<MatchingScoreWeightsV1>;
}

declare const validatedMatchingRulesBrand: unique symbol;

/**
 * An effective rules document that has passed the strict runtime parser.
 *
 * Consumers must not construct this type. Runtime evaluators also verify the
 * parser-issued identity, so a TypeScript cast does not bypass validation.
 */
export type ValidatedMatchingRulesV1 = Readonly<MatchingRulesV1Payload> & {
  readonly [validatedMatchingRulesBrand]: true;
};

export interface CargoMatchFacts {
  readonly cargoId: string;
  readonly reviewStatus: string;
  readonly status: string;
  readonly qtyMinMt: number | null;
  readonly qtyMaxMt: number | null;
  readonly cargoType: string;
  readonly isSpot: boolean;
  /** Integer civil-day ordinal; both sides must use the same epoch. */
  readonly laycanFromDay: number | null;
  readonly requiresGeared: boolean | null;
  readonly isGrainCargo: boolean;
  readonly isDgCargo: boolean;
  readonly maxVesselAgeYr: number | null;
  readonly maxDraftM: number | null;
  readonly maxLoaM: number | null;
  readonly loadZone: string | null;
  readonly dischZone: string | null;
  readonly freightIdeaUsdMt: number | null;
}

export interface VesselMatchFacts {
  readonly availabilityId: string;
  readonly availabilityStatus: string;
  readonly availabilityReviewStatus: string;
  readonly isSanctioned: boolean;
  readonly dwtGrainMt: number | null;
  readonly vesselType: string;
  readonly openZone: string | null;
  /** Integer civil-day ordinal; both sides must use the same epoch. */
  readonly openDateDay: number | null;
  readonly acceptsPartCargo: boolean;
  readonly isGeared: boolean | null;
  readonly grainCertified: boolean | null;
  readonly dgCertified: boolean | null;
  readonly buildYear: number | null;
  readonly maxDraftM: number | null;
  readonly maxLoaM: number | null;
  readonly freightIdeaUsdMt: number | null;
}

export interface MatchEvaluationContext {
  /** Explicit rather than Date.now(), keeping replay and SQL parity deterministic. */
  readonly asOfYear: number;
}

export type EligibilityCheckCode =
  | "cargo_review_status"
  | "cargo_market_status"
  | "availability_status"
  | "availability_review_status"
  | "sanctions"
  | "zone"
  | "capacity_data"
  | "capacity"
  | "vessel_type"
  | "laycan"
  | "gear"
  | "grain_certificate"
  | "dangerous_goods_certificate"
  | "vessel_age"
  | "draft"
  | "loa"
  | "minimum_score";

export interface EligibilityCheck {
  readonly code: EligibilityCheckCode;
  readonly passed: boolean;
  readonly explanation: string;
}

export type MatchScoreContributionCode = "dwt" | "zone" | "gear";

export interface MatchScoreContribution {
  readonly code: MatchScoreContributionCode;
  readonly points: number;
  readonly explanation: string;
}

export interface PairScore {
  readonly points: number;
  readonly label: MatchScoreLabel;
  readonly utilization: number | null;
  readonly contributions: readonly MatchScoreContribution[];
}

export interface PairRankFacts {
  readonly rateAligned: boolean;
  readonly dwtDeltaMt: number | null;
}

export interface PairMatchEvaluation {
  readonly cargoId: string;
  readonly availabilityId: string;
  readonly eligible: boolean;
  readonly displayLabel: MatchDisplayLabel;
  readonly score: PairScore;
  readonly rank: PairRankFacts;
  readonly checks: readonly EligibilityCheck[];
  readonly failedChecks: readonly EligibilityCheck[];
  readonly schemaVersion: typeof MATCHING_RULE_SCHEMA_VERSION;
}

export interface MatchingRulesValidationIssue {
  readonly path: string;
  readonly code: "type" | "missing" | "unknown" | "range" | "relation";
  readonly message: string;
}

export type MatchingRulesParseResult =
  | { readonly success: true; readonly data: ValidatedMatchingRulesV1 }
  | { readonly success: false; readonly issues: readonly MatchingRulesValidationIssue[] };

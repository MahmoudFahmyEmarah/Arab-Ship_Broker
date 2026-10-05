export const INTELLIGENCE_SCHEMA_VERSION = 1 as const;
export const INTELLIGENCE_EVALUATOR_VERSION = "intelligence-v1" as const;

export type IntelligenceEntity = "cargo" | "vessel";
export type IntelligenceGroupScope = IntelligenceEntity | "both" | "framework";
export type IntelligenceOperator = "lt" | "gt" | "eq" | "ne" | "between" | "missing";
export type IntelligenceSeverity = "good" | "info" | "warning" | "danger";

export type CargoIntelligenceField =
  | "stowage_sf"
  | "load_rate_mt_day"
  | "laycan_days_remaining"
  | "freight_idea_usd_mt"
  | "commission_pct";

export type VesselIntelligenceField =
  | "age_years"
  | "vlsfo_sea_mt_day"
  | "lsmgo_sea_mt_day"
  | "open_days_delta";

export type IntelligenceField = CargoIntelligenceField | VesselIntelligenceField;
export type IntelligenceThreshold = number | readonly [number, number] | null;

export interface IntelligenceFieldDefinition {
  readonly entity: IntelligenceEntity;
  readonly field: IntelligenceField;
  readonly label: string;
  readonly unit: string | null;
  readonly allowedOperators: readonly IntelligenceOperator[];
  readonly minimumThreshold: number;
  readonly maximumThreshold: number;
  /** Cross-runtime canonical-hash guard; SQL enforces the same scale. */
  readonly maximumDecimalPlaces: number;
}

export interface IntelligenceRuleGroupV1 {
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly scope: IntelligenceGroupScope;
  readonly active: boolean;
  /** Lower values take precedence. */
  readonly priority: number;
}

export interface IntelligenceRuleV1 {
  readonly code: string;
  readonly group: string;
  readonly entity: IntelligenceEntity;
  readonly field: IntelligenceField;
  readonly operator: IntelligenceOperator;
  readonly threshold: IntelligenceThreshold;
  readonly severity: IntelligenceSeverity;
  readonly tag: string;
  readonly message: string;
  /** Rules with the same signalKey are an explicit conflict set. */
  readonly signalKey: string;
  readonly active: boolean;
  /** Lower values take precedence inside the group. */
  readonly priority: number;
}

export interface IntelligenceRuleSetDocumentV1 {
  readonly schemaVersion: typeof INTELLIGENCE_SCHEMA_VERSION;
  readonly evaluatorVersion: typeof INTELLIGENCE_EVALUATOR_VERSION;
  readonly groups: readonly IntelligenceRuleGroupV1[];
  readonly rules: readonly IntelligenceRuleV1[];
}

declare const validatedRuleSetBrand: unique symbol;

/** Construct only through parseIntelligenceRuleSet(). */
export type ValidatedIntelligenceRuleSet = Readonly<IntelligenceRuleSetDocumentV1> & {
  readonly [validatedRuleSetBrand]: true;
};

export interface IntelligenceRuleSetEnvelope {
  readonly version: number;
  readonly ruleSetContentHash: string;
  readonly effectiveContentHash: string;
  readonly document: unknown;
}

declare const validatedRuleSetEnvelopeBrand: unique symbol;

export interface ValidatedIntelligenceRuleSetEnvelope {
  readonly version: number;
  readonly ruleSetContentHash: string;
  readonly effectiveContentHash: string;
  readonly document: ValidatedIntelligenceRuleSet;
  readonly [validatedRuleSetEnvelopeBrand]: true;
}

export interface IntelligenceProvenanceEntryV1 {
  readonly ruleCode: string;
  readonly sourceRef: string;
  readonly originalMessage: string;
  readonly note: string | null;
}

export interface IntelligenceFactsInput {
  readonly entity: IntelligenceEntity;
  readonly values: Readonly<Record<string, unknown>>;
}

declare const validatedFactsBrand: unique symbol;

/** Construct only through parseIntelligenceFacts(). */
export type ValidatedIntelligenceFacts = Readonly<{
  entity: IntelligenceEntity;
  values: Readonly<Partial<Record<IntelligenceField, number | null>>>;
}> & { readonly [validatedFactsBrand]: true };

export type IntelligenceEvaluationStatus =
  | "matched"
  | "not_matched"
  | "missing"
  | "inactive"
  | "inapplicable";

export interface IntelligenceRuleEvaluation {
  readonly ruleCode: string;
  readonly status: IntelligenceEvaluationStatus;
  readonly value: number | null | undefined;
  readonly reason: string;
}

export interface IntelligenceSignal {
  readonly ruleCode: string;
  readonly group: string;
  readonly signalKey: string;
  readonly entity: IntelligenceEntity;
  readonly field: IntelligenceField;
  readonly severity: IntelligenceSeverity;
  readonly tag: string;
  readonly message: string;
  readonly value: number | null | undefined;
  readonly groupPriority: number;
  readonly rulePriority: number;
}

export interface IntelligenceEvaluationResult {
  readonly signals: readonly IntelligenceSignal[];
  readonly suppressedRuleCodes: readonly string[];
  readonly evaluations: readonly IntelligenceRuleEvaluation[];
}

export interface IntelligenceValidationIssue {
  readonly path: string;
  readonly code:
    | "type"
    | "value"
    | "unknown_key"
    | "missing_key"
    | "duplicate"
    | "reference"
    | "scope";
  readonly message: string;
}

export interface IntelligenceValidationResult<T> {
  readonly ok: boolean;
  readonly value?: T;
  readonly issues: readonly IntelligenceValidationIssue[];
}

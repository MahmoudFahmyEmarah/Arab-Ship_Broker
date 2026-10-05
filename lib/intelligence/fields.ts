import type {
  IntelligenceEntity,
  IntelligenceField,
  IntelligenceFieldDefinition,
  IntelligenceOperator,
} from "./types";

const NUMERIC_OPERATORS = Object.freeze([
  "lt",
  "gt",
  "eq",
  "ne",
  "between",
  "missing",
] as const satisfies readonly IntelligenceOperator[]);

function field(
  entity: IntelligenceEntity,
  key: IntelligenceField,
  label: string,
  unit: string | null,
  minimumThreshold: number,
  maximumThreshold: number,
  maximumDecimalPlaces = 6,
): Readonly<IntelligenceFieldDefinition> {
  return Object.freeze({
    entity,
    field: key,
    label,
    unit,
    allowedOperators: NUMERIC_OPERATORS,
    minimumThreshold,
    maximumThreshold,
    maximumDecimalPlaces,
  });
}

/**
 * Closed evaluator vocabulary. These are fact names, never object paths or
 * executable expressions. Bounds are deliberately broad input-safety limits;
 * they do not make a maritime recommendation.
 */
export const INTELLIGENCE_FIELDS: Readonly<Record<IntelligenceField, Readonly<IntelligenceFieldDefinition>>> =
  Object.freeze({
    stowage_sf: field("cargo", "stowage_sf", "Stowage factor", "m3/mt", 0, 20),
    load_rate_mt_day: field("cargo", "load_rate_mt_day", "Load rate", "mt/day", 0, 100_000),
    laycan_days_remaining: field("cargo", "laycan_days_remaining", "Laycan days remaining", "days", -365, 365),
    freight_idea_usd_mt: field("cargo", "freight_idea_usd_mt", "Freight idea", "USD/mt", 0, 10_000),
    commission_pct: field("cargo", "commission_pct", "Commission", "%", 0, 100),
    age_years: field("vessel", "age_years", "Vessel age", "years", 0, 100),
    vlsfo_sea_mt_day: field("vessel", "vlsfo_sea_mt_day", "VLSFO sea consumption", "mt/day", 0, 500),
    lsmgo_sea_mt_day: field("vessel", "lsmgo_sea_mt_day", "LSMGO sea consumption", "mt/day", 0, 500),
    open_days_delta: field("vessel", "open_days_delta", "Open-date days", "days", -365, 365),
  });

export const INTELLIGENCE_FIELD_NAMES = Object.freeze(
  Object.keys(INTELLIGENCE_FIELDS) as IntelligenceField[],
);

export function isIntelligenceField(value: unknown): value is IntelligenceField {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(INTELLIGENCE_FIELDS, value);
}

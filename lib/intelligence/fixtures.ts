import type { IntelligenceFactsInput, IntelligenceRuleSetDocumentV1 } from "./types";
import { INTELLIGENCE_V1_SEED_DOCUMENT } from "./seeds";

/** Pure fixtures consumed by scripts/intelligence-rules-check.ts. */
export const INTELLIGENCE_FIXTURES = Object.freeze({
  validRuleSet: INTELLIGENCE_V1_SEED_DOCUMENT,
  vesselMissingFuel: {
    entity: "vessel",
    values: { age_years: 12, vlsfo_sea_mt_day: 24, lsmgo_sea_mt_day: null, open_days_delta: 2 },
  } satisfies IntelligenceFactsInput,
  vesselOverdue: {
    entity: "vessel",
    values: { age_years: 22, vlsfo_sea_mt_day: 31, lsmgo_sea_mt_day: 0, open_days_delta: -1 },
  } satisfies IntelligenceFactsInput,
  cargoBoundary: {
    entity: "cargo",
    values: { stowage_sf: 0.4, load_rate_mt_day: 5000, laycan_days_remaining: 3, freight_idea_usd_mt: 25, commission_pct: 4 },
  } satisfies IntelligenceFactsInput,
  invalidUnknownField: {
    ...INTELLIGENCE_V1_SEED_DOCUMENT,
    rules: [{ ...INTELLIGENCE_V1_SEED_DOCUMENT.rules[0], field: "cargo.__proto__" }],
  },
  invalidExecutableKey: {
    ...INTELLIGENCE_V1_SEED_DOCUMENT,
    rules: [{ ...INTELLIGENCE_V1_SEED_DOCUMENT.rules[0], expression: "return true" }],
  },
  invalidThresholdPrecision: {
    ...INTELLIGENCE_V1_SEED_DOCUMENT,
    rules: [{ ...INTELLIGENCE_V1_SEED_DOCUMENT.rules[0], threshold: 0.4000001 }],
  },
  duplicateRuleCode: {
    ...INTELLIGENCE_V1_SEED_DOCUMENT,
    rules: [INTELLIGENCE_V1_SEED_DOCUMENT.rules[0], INTELLIGENCE_V1_SEED_DOCUMENT.rules[0]],
  } as unknown as IntelligenceRuleSetDocumentV1,
});

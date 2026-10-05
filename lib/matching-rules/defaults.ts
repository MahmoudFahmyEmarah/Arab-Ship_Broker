import { parseMatchingRulesV1 } from "./validate";

/** Exact literals currently deployed in the SQL matching funnel. */
export const MATCHING_RULES_V1_DEFAULT_PAYLOAD = Object.freeze({
  schemaVersion: 1,
  dwtTolerancePct: 10,
  partCargoTolerancePct: 20,
  laycanBeforeDays: 21,
  laycanAfterDays: 14,
  rateAlignmentUsd: 5,
  minScoreLabel: "Possible",
  score: Object.freeze({
    dwtTight: 2,
    dwtLoose: 1,
    zoneLoad: 2,
    zoneDisch: 1,
    gear: 1,
  }),
} as const);

/** Parser-issued, deeply immutable default document for evaluator use. */
export const MATCHING_RULES_V1_DEFAULTS = parseMatchingRulesV1(MATCHING_RULES_V1_DEFAULT_PAYLOAD);

export const MATCH_SCORE_THRESHOLDS = Object.freeze({ Possible: 0, Good: 3, Strong: 4 } as const);

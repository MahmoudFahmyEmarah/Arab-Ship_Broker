import { MATCHING_RULES_V1_DEFAULT_PAYLOAD } from "./defaults";
import type {
  CargoMatchFacts,
  MatchDisplayLabel,
  MatchEvaluationContext,
  MatchScoreLabel,
  MatchingRulesV1Payload,
  VesselMatchFacts,
} from "./types";

export interface SqlGoldenExpectedV1 {
  readonly eligible: boolean;
  readonly scorePoints: number;
  readonly scoreLabel: MatchScoreLabel;
  readonly displayLabel: MatchDisplayLabel;
  readonly rateAligned: boolean;
  readonly dwtDeltaMt: number | null;
}

export interface SqlGoldenPairFixtureV1 {
  readonly name: string;
  readonly cargo: CargoMatchFacts;
  readonly vessel: VesselMatchFacts;
  readonly context: MatchEvaluationContext;
  readonly expected: SqlGoldenExpectedV1;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

const BASE_CARGO: CargoMatchFacts = {
  cargoId: "cargo-golden",
  reviewStatus: "APPROVED",
  status: "IN",
  qtyMinMt: 9_000,
  qtyMaxMt: 10_000,
  cargoType: "Dry Bulk",
  isSpot: false,
  laycanFromDay: 100,
  requiresGeared: false,
  isGrainCargo: false,
  isDgCargo: false,
  maxVesselAgeYr: null,
  maxDraftM: null,
  maxLoaM: null,
  loadZone: "E.MED",
  dischZone: "R.SEA",
  freightIdeaUsdMt: 50,
};

const BASE_VESSEL: VesselMatchFacts = {
  availabilityId: "availability-golden",
  availabilityStatus: "OPEN",
  availabilityReviewStatus: "APPROVED",
  isSanctioned: false,
  dwtGrainMt: 10_000,
  vesselType: "Bulk Carrier",
  openZone: "E.MED",
  openDateDay: 100,
  acceptsPartCargo: false,
  isGeared: true,
  grainCertified: true,
  dgCertified: true,
  buildYear: 2010,
  maxDraftM: 8,
  maxLoaM: 150,
  freightIdeaUsdMt: 55,
};

const CONTEXT: MatchEvaluationContext = { asOfYear: 2026 };

function pair(
  name: string,
  cargo: Partial<CargoMatchFacts>,
  vessel: Partial<VesselMatchFacts>,
  expected: SqlGoldenExpectedV1,
): SqlGoldenPairFixtureV1 {
  return {
    name,
    cargo: { ...BASE_CARGO, ...cargo },
    vessel: { ...BASE_VESSEL, availabilityId: `availability-${name}`, ...vessel },
    context: CONTEXT,
    expected,
  };
}

const PAIRS: readonly SqlGoldenPairFixtureV1[] = [
  pair("tight-load-rate-boundary", {}, {}, {
    eligible: true, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("normal-lower-inclusive", {}, { dwtGrainMt: 9_000, freightIdeaUsdMt: 55.01 }, {
    eligible: true, scorePoints: 3, scoreLabel: "Good", displayLabel: "Good",
    rateAligned: false, dwtDeltaMt: 1_000,
  }),
  pair("normal-below-lower", {}, { dwtGrainMt: 8_999 }, {
    eligible: false, scorePoints: 3, scoreLabel: "Good", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 1_001,
  }),
  pair("normal-upper-inclusive", {}, { dwtGrainMt: 11_000 }, {
    eligible: true, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 1_000,
  }),
  pair("normal-above-upper", {}, { dwtGrainMt: 11_001 }, {
    eligible: false, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 1_001,
  }),
  pair("part-cargo-lower-inclusive", { qtyMinMt: 8_000 }, { dwtGrainMt: 8_000, acceptsPartCargo: true }, {
    eligible: true, scorePoints: 3, scoreLabel: "Good", displayLabel: "Good",
    rateAligned: true, dwtDeltaMt: 2_000,
  }),
  pair("part-cargo-upper-inclusive", { qtyMinMt: 8_000 }, { dwtGrainMt: 12_000, acceptsPartCargo: true }, {
    eligible: true, scorePoints: 4, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 2_000,
  }),
  pair("quantity-minimum-floor", { qtyMinMt: 9_500 }, { dwtGrainMt: 9_000 }, {
    eligible: false, scorePoints: 3, scoreLabel: "Good", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 1_000,
  }),
  pair("laycan-before-inclusive", {}, { openDateDay: 79 }, {
    eligible: true, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("laycan-after-inclusive", {}, { openDateDay: 114 }, {
    eligible: true, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("laycan-after-exclusive", {}, { openDateDay: 115 }, {
    eligible: false, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("spot-without-dates", { isSpot: true, laycanFromDay: null }, { openDateDay: null }, {
    eligible: true, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("break-bulk-any-vessel-type", { cargoType: "Break Bulk" }, { vesselType: "Tanker" }, {
    eligible: true, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("grain-certificate-block", { isGrainCargo: true }, { grainCertified: null }, {
    eligible: false, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("dangerous-goods-block", { isDgCargo: true }, { dgCertified: false }, {
    eligible: false, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("unknown-vessel-limits-pass", { maxVesselAgeYr: 20, maxDraftM: 8, maxLoaM: 150 }, {
    buildYear: null, maxDraftM: null, maxLoaM: null,
  }, {
    eligible: true, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("vessel-age-boundary", { maxVesselAgeYr: 20 }, { buildYear: 2006 }, {
    eligible: true, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Strong",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("vessel-age-over-limit", { maxVesselAgeYr: 20 }, { buildYear: 2005 }, {
    eligible: false, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("draft-over-limit", { maxDraftM: 7.99 }, { maxDraftM: 8 }, {
    eligible: false, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 0,
  }),
  pair("loa-over-limit", { maxLoaM: 149.99 }, { maxLoaM: 150 }, {
    eligible: false, scorePoints: 5, scoreLabel: "Strong", displayLabel: "Weak",
    rateAligned: true, dwtDeltaMt: 0,
  }),
];

const RANKING_VESSELS: readonly VesselMatchFacts[] = [
  { ...BASE_VESSEL, availabilityId: "rank-04", dwtGrainMt: 10_000, freightIdeaUsdMt: 60 },
  { ...BASE_VESSEL, availabilityId: "rank-03", dwtGrainMt: 11_000, freightIdeaUsdMt: 54 },
  { ...BASE_VESSEL, availabilityId: "rank-02", dwtGrainMt: 9_500, freightIdeaUsdMt: 54 },
  { ...BASE_VESSEL, availabilityId: "rank-01", dwtGrainMt: 9_500, freightIdeaUsdMt: 54 },
];

/**
 * Serializable vectors transcribed from the deployed SQL bodies in
 * `supabase/baseline/30_matching_layer.sql` and
 * `supabase/migrations/20260616120000_remote_baseline.sql`.
 *
 * The pure suite consumes these vectors directly. The named local SQL parity
 * driver loads the same facts into an isolated database transaction, calls the
 * real SQL evaluator and compares its output and rank order with TypeScript.
 */
export const MATCHING_SQL_GOLDEN_V1 = deepFreeze({
  fixtureVersion: 1,
  asOfYear: CONTEXT.asOfYear,
  evidence: {
    kind: "repository-snapshot-of-deployed-sql-bodies",
    eligibilityAndScore: "supabase/baseline/30_matching_layer.sql:20-55",
    ranking: "supabase/migrations/20260616120000_remote_baseline.sql:1763-1833",
    sqlParityDriver: "scripts/matching-sql-parity-check.ts",
    databasePolicy: "local-isolated-transaction-only",
  },
  rules: MATCHING_RULES_V1_DEFAULT_PAYLOAD as MatchingRulesV1Payload,
  pairs: PAIRS,
  ranking: {
    cargo: BASE_CARGO,
    vessels: RANKING_VESSELS,
    context: CONTEXT,
    expectedAvailabilityIds: ["rank-01", "rank-02", "rank-03", "rank-04"],
  },
});

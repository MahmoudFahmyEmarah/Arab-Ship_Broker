import assert from "node:assert/strict";

import {
  MATCHING_RULES_V1_DEFAULT_PAYLOAD,
  MATCHING_RULES_V1_DEFAULTS,
  MATCHING_SQL_GOLDEN_V1,
  canonicalJson,
  canonicalMatchingRulesV1,
  compareAscii,
  evaluatePairMatch,
  explainPairMatch,
  parseMatchingRulesV1,
  rankEligibleMatches,
  safeParseMatchingRulesV1,
  type CargoMatchFacts,
  type MatchingRulesV1Payload,
  type ValidatedMatchingRulesV1,
  type VesselMatchFacts,
} from "../lib/matching-rules";
import { matchingRulesSha256, sha256CanonicalJson } from "../lib/matching-rules/hash.server";

let passed = 0;
let failed = 0;

function check(name: string, run: () => void): void {
  try {
    run();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

function mutableDefaultPayload(): {
  schemaVersion: number;
  dwtTolerancePct: number;
  partCargoTolerancePct: number;
  laycanBeforeDays: number;
  laycanAfterDays: number;
  rateAlignmentUsd: number;
  minScoreLabel: string;
  score: Record<string, number>;
  [key: string]: unknown;
} {
  return JSON.parse(JSON.stringify(MATCHING_RULES_V1_DEFAULT_PAYLOAD));
}

function rulesWith(overrides: Record<string, unknown>): ValidatedMatchingRulesV1 {
  const raw = mutableDefaultPayload();
  return parseMatchingRulesV1({ ...raw, ...overrides });
}

function assertDeepFrozen(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const child of Object.values(value as Record<string, unknown>)) assertDeepFrozen(child, seen);
}

const goldenBase = MATCHING_SQL_GOLDEN_V1.pairs[0];
const baseCargo: CargoMatchFacts = goldenBase.cargo;
const baseVessel: VesselMatchFacts = goldenBase.vessel;
const context = goldenBase.context;

check("effective v1 payload has exactly the architect-approved flat shape", () => {
  assert.deepEqual(
    Object.keys(MATCHING_RULES_V1_DEFAULTS).sort(),
    [
      "dwtTolerancePct", "laycanAfterDays", "laycanBeforeDays", "minScoreLabel",
      "partCargoTolerancePct", "rateAlignmentUsd", "schemaVersion", "score",
    ],
  );
  assert.deepEqual(
    Object.keys(MATCHING_RULES_V1_DEFAULTS.score).sort(),
    ["dwtLoose", "dwtTight", "gear", "zoneDisch", "zoneLoad"],
  );
  for (const forbidden of ["zoneWeightPct", "vesselAgeSoftLimitYr", "stowageVolumeCheckFt3", "advisories"]) {
    assert.equal(forbidden in MATCHING_RULES_V1_DEFAULTS, false);
    assert.equal(forbidden in MATCHING_RULES_V1_DEFAULTS.score, false);
  }
});

check("strict parser clones, normalizes and deeply freezes a valid document", () => {
  const raw = mutableDefaultPayload();
  raw.dwtTolerancePct = -0;
  const parsed = parseMatchingRulesV1(raw);
  raw.dwtTolerancePct = 49;
  raw.score.dwtTight = 19;
  assert.equal(Object.is(parsed.dwtTolerancePct, -0), false);
  assert.equal(parsed.dwtTolerancePct, 0);
  assert.equal(parsed.score.dwtTight, 2);
  assertDeepFrozen(parsed);
});

check("strict parser rejects missing, extra and accessor-backed fields", () => {
  const missing = mutableDefaultPayload();
  delete (missing as Record<string, unknown>).rateAlignmentUsd;
  assert.equal(safeParseMatchingRulesV1(missing).success, false);

  const extraTop = mutableDefaultPayload();
  extraTop.zoneWeightPct = 30;
  assert.equal(safeParseMatchingRulesV1(extraTop).success, false);

  const extraScore = mutableDefaultPayload();
  extraScore.score.softAge = 20;
  assert.equal(safeParseMatchingRulesV1(extraScore).success, false);

  const accessor = mutableDefaultPayload();
  Object.defineProperty(accessor, "rateAlignmentUsd", { enumerable: true, get: () => 5 });
  assert.equal(safeParseMatchingRulesV1(accessor).success, false);
});

check("numeric ranges, precision and cross-field relations fail closed", () => {
  assert.equal(rulesWith({ rateAlignmentUsd: 5.55 }).rateAlignmentUsd, 5.55);
  const invalid: unknown[] = [];
  const tolerance = mutableDefaultPayload(); tolerance.dwtTolerancePct = -1; invalid.push(tolerance);
  const part = mutableDefaultPayload(); part.dwtTolerancePct = 20; part.partCargoTolerancePct = 10; invalid.push(part);
  const laycan = mutableDefaultPayload(); laycan.laycanAfterDays = 1.5; invalid.push(laycan);
  const laycanRange = mutableDefaultPayload(); laycanRange.laycanBeforeDays = 91; invalid.push(laycanRange);
  const rate = mutableDefaultPayload(); rate.rateAlignmentUsd = 5.555; invalid.push(rate);
  const infinite = mutableDefaultPayload(); infinite.rateAlignmentUsd = Number.POSITIVE_INFINITY; invalid.push(infinite);
  const dwtOrder = mutableDefaultPayload(); dwtOrder.score.dwtTight = 0; dwtOrder.score.dwtLoose = 1; invalid.push(dwtOrder);
  const zoneOrder = mutableDefaultPayload(); zoneOrder.score.zoneLoad = 0; zoneOrder.score.zoneDisch = 1; invalid.push(zoneOrder);
  const unreachableByWindow = mutableDefaultPayload(); unreachableByWindow.dwtTolerancePct = 0; unreachableByWindow.partCargoTolerancePct = 0; invalid.push(unreachableByWindow);
  const noBands = mutableDefaultPayload(); noBands.score = { dwtTight: 0, dwtLoose: 0, zoneLoad: 0, zoneDisch: 0, gear: 0 }; invalid.push(noBands);
  for (const candidate of invalid) assert.equal(safeParseMatchingRulesV1(candidate).success, false);
});

check("all score labels remain reachable under an accepted custom weight set", () => {
  const rules = rulesWith({ score: { dwtTight: 3, dwtLoose: 2, zoneLoad: 1, zoneDisch: 0, gear: 0 } });
  assert.equal(rules.score.dwtTight, 3);
});

check("evaluator rejects a forged compile-time cast at runtime", () => {
  const forged = { ...MATCHING_RULES_V1_DEFAULT_PAYLOAD } as unknown as ValidatedMatchingRulesV1;
  assert.throws(() => evaluatePairMatch(baseCargo, baseVessel, forged, context), /must be created by parseMatchingRulesV1/);
});

check("canonical JSON is key-order stable and treats negative zero as zero", () => {
  assert.equal(canonicalJson({ z: -0, a: 1 }), canonicalJson({ a: 1, z: 0 }));
  assert.equal(canonicalJson({ b: { y: 2, x: 1 }, a: true }), '{"a":true,"b":{"x":1,"y":2}}');
  assert.equal(
    canonicalMatchingRulesV1(parseMatchingRulesV1(mutableDefaultPayload())),
    canonicalMatchingRulesV1(MATCHING_RULES_V1_DEFAULTS),
  );
});

check("canonical JSON rejects silent-loss, sparse, cyclic and non-finite values", () => {
  assert.throws(() => canonicalJson({ value: undefined }), /does not support undefined/);
  assert.throws(() => canonicalJson({ value: Number.NaN }), /finite/);
  const sparse: unknown[] = []; sparse.length = 1;
  assert.throws(() => canonicalJson(sparse), /sparse/);
  const named = [] as unknown[] & { extra?: boolean }; named.extra = true;
  assert.throws(() => canonicalJson(named), /named or symbol/);
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
  assert.throws(() => canonicalJson(cyclic), /cycles/);
});

check("server-only publication identity is deterministic SHA-256", () => {
  const first = matchingRulesSha256(MATCHING_RULES_V1_DEFAULTS);
  const second = matchingRulesSha256(parseMatchingRulesV1(mutableDefaultPayload()));
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.notEqual(sha256CanonicalJson({ a: 1 }), sha256CanonicalJson({ a: 2 }));
});

check("repository SQL golden boundaries evaluate to their frozen expectations", () => {
  assert.equal(MATCHING_SQL_GOLDEN_V1.evidence.sqlParityDriver, "scripts/matching-sql-parity-check.ts");
  assert.equal(MATCHING_SQL_GOLDEN_V1.evidence.databasePolicy, "local-isolated-transaction-only");
  const rules = parseMatchingRulesV1(MATCHING_SQL_GOLDEN_V1.rules);
  for (const fixture of MATCHING_SQL_GOLDEN_V1.pairs) {
    assert.equal(fixture.context.asOfYear, MATCHING_SQL_GOLDEN_V1.asOfYear, `${fixture.name}: as-of year drift`);
    const actual = evaluatePairMatch(fixture.cargo, fixture.vessel, rules, fixture.context);
    const defaultActual = evaluatePairMatch(
      fixture.cargo,
      fixture.vessel,
      MATCHING_RULES_V1_DEFAULTS,
      fixture.context,
    );
    assert.deepEqual(defaultActual, actual, `${fixture.name}: governed default behavior drift`);
    assert.deepEqual({
      eligible: actual.eligible,
      scorePoints: actual.score.points,
      scoreLabel: actual.score.label,
      displayLabel: actual.displayLabel,
      rateAligned: actual.rank.rateAligned,
      dwtDeltaMt: actual.rank.dwtDeltaMt,
    }, fixture.expected, fixture.name);
  }
});

check("ranking is rate-aligned first, then DWT delta, then ASCII id", () => {
  const fixture = MATCHING_SQL_GOLDEN_V1.ranking;
  assert.equal(fixture.context.asOfYear, MATCHING_SQL_GOLDEN_V1.asOfYear);
  const ranked = rankEligibleMatches(fixture.cargo, fixture.vessels, MATCHING_RULES_V1_DEFAULTS, fixture.context);
  assert.deepEqual(ranked.map((item) => item.availabilityId), fixture.expectedAvailabilityIds);
  assert.equal(compareAscii("rank-01", "rank-02"), -1);
  assert.equal(compareAscii("A", "a"), -1);
  assert.throws(() => compareAscii("é", "z"), /ASCII/);
});

check("rate alignment is inclusive and missing rates are not aligned", () => {
  const boundary = evaluatePairMatch(baseCargo, { ...baseVessel, freightIdeaUsdMt: 45 }, MATCHING_RULES_V1_DEFAULTS, context);
  const outside = evaluatePairMatch(baseCargo, { ...baseVessel, freightIdeaUsdMt: 44.99 }, MATCHING_RULES_V1_DEFAULTS, context);
  const missing = evaluatePairMatch(baseCargo, { ...baseVessel, freightIdeaUsdMt: null }, MATCHING_RULES_V1_DEFAULTS, context);
  assert.equal(boundary.rank.rateAligned, true);
  assert.equal(outside.rank.rateAligned, false);
  assert.equal(missing.rank.rateAligned, false);
});

check("rate alignment uses decimal arithmetic at a fractional boundary", () => {
  const rules = rulesWith({ rateAlignmentUsd: 0.1 });
  const decimalBoundary = evaluatePairMatch(
    { ...baseCargo, freightIdeaUsdMt: 20.8 },
    { ...baseVessel, freightIdeaUsdMt: 20.7 },
    rules,
    context,
  );
  const decimalOutside = evaluatePairMatch(
    { ...baseCargo, freightIdeaUsdMt: 20.81 },
    { ...baseVessel, freightIdeaUsdMt: 20.7 },
    rules,
    context,
  );
  assert.equal(decimalBoundary.rank.rateAligned, true);
  assert.equal(decimalOutside.rank.rateAligned, false);
});

check("quantity-minimum floor remains independent of tolerance lower bound", () => {
  const cargo = { ...baseCargo, qtyMinMt: 9_500 };
  const result = evaluatePairMatch(cargo, { ...baseVessel, dwtGrainMt: 9_000 }, MATCHING_RULES_V1_DEFAULTS, context);
  assert.equal(result.eligible, false);
  assert.equal(result.failedChecks.some((item) => item.code === "capacity"), true);
});

check("spot cargo bypasses only the laycan date requirement", () => {
  const cargo = { ...baseCargo, isSpot: true, laycanFromDay: null };
  const noDate = { ...baseVessel, openDateDay: null };
  assert.equal(evaluatePairMatch(cargo, noDate, MATCHING_RULES_V1_DEFAULTS, context).eligible, true);
  assert.equal(evaluatePairMatch({ ...cargo, isGrainCargo: true }, { ...noDate, grainCertified: false }, MATCHING_RULES_V1_DEFAULTS, context).eligible, false);
});

check("status, sanctions, type, gear, grain and DG gates fail independently", () => {
  const cases: ReadonlyArray<readonly [Partial<CargoMatchFacts>, Partial<VesselMatchFacts>, string]> = [
    [{ reviewStatus: "PENDING" }, {}, "cargo_review_status"],
    [{ status: "OUT" }, {}, "cargo_market_status"],
    [{}, { availabilityStatus: "FIXED" }, "availability_status"],
    [{}, { availabilityReviewStatus: "PENDING" }, "availability_review_status"],
    [{}, { isSanctioned: true }, "sanctions"],
    [{}, { vesselType: "Tanker" }, "vessel_type"],
    [{ requiresGeared: true }, { isGeared: false }, "gear"],
    [{ isGrainCargo: true }, { grainCertified: null }, "grain_certificate"],
    [{ isDgCargo: true }, { dgCertified: false }, "dangerous_goods_certificate"],
  ];
  for (const [cargoChanges, vesselChanges, failedCode] of cases) {
    const result = evaluatePairMatch(
      { ...baseCargo, ...cargoChanges },
      { ...baseVessel, ...vesselChanges },
      MATCHING_RULES_V1_DEFAULTS,
      context,
    );
    assert.equal(result.eligible, false, failedCode);
    assert.equal(result.failedChecks.some((item) => item.code === failedCode), true, failedCode);
  }
});

check("Break Bulk retains the deployed vessel-type exception", () => {
  const result = evaluatePairMatch(
    { ...baseCargo, cargoType: "Break Bulk" },
    { ...baseVessel, vesselType: "Tanker" },
    MATCHING_RULES_V1_DEFAULTS,
    context,
  );
  assert.equal(result.eligible, true);
});

check("unknown vessel age, draft and LOA preserve deployed nullable semantics", () => {
  const constrained = { ...baseCargo, maxVesselAgeYr: 20, maxDraftM: 8, maxLoaM: 150 };
  const unknown = { ...baseVessel, buildYear: null, maxDraftM: null, maxLoaM: null };
  assert.equal(evaluatePairMatch(constrained, unknown, MATCHING_RULES_V1_DEFAULTS, context).eligible, true);
});

check("configured minimum score is an effective final eligibility gate", () => {
  const possible = { ...baseVessel, openZone: "R.SEA", dwtGrainMt: 9_000 };
  const baseline = evaluatePairMatch(baseCargo, possible, MATCHING_RULES_V1_DEFAULTS, context);
  const minimumGood = evaluatePairMatch(baseCargo, possible, rulesWith({ minScoreLabel: "Good" }), context);
  assert.equal(baseline.score.label, "Possible");
  assert.equal(baseline.eligible, true);
  assert.equal(minimumGood.eligible, false);
  assert.equal(minimumGood.failedChecks.some((item) => item.code === "minimum_score"), true);
});

check("evaluation is deterministic, deeply frozen and does not mutate inputs", () => {
  const cargo = { ...baseCargo };
  const vessel = { ...baseVessel };
  const before = canonicalJson({ cargo, vessel });
  const first = evaluatePairMatch(cargo, vessel, MATCHING_RULES_V1_DEFAULTS, context);
  const second = evaluatePairMatch(cargo, vessel, MATCHING_RULES_V1_DEFAULTS, context);
  assert.deepEqual(first, second);
  assert.equal(canonicalJson({ cargo, vessel }), before);
  assertDeepFrozen(first);
});

check("explanations expose gates, score contributions and governed rank facts", () => {
  const result = evaluatePairMatch(baseCargo, baseVessel, MATCHING_RULES_V1_DEFAULTS, context);
  const explanation = explainPairMatch(result);
  assert.equal(explanation.some((line) => line.startsWith("score.dwt:")), true);
  assert.equal(explanation.some((line) => line === "rank.rate_aligned: true"), true);
  assertDeepFrozen(explanation);
});

check("fixture export is JSON-safe and points to the real local SQL parity gate", () => {
  const roundTrip = JSON.parse(JSON.stringify(MATCHING_SQL_GOLDEN_V1)) as {
    rules: MatchingRulesV1Payload;
    pairs: unknown[];
    evidence: { sqlParityDriver: string; databasePolicy: string };
  };
  assert.deepEqual(roundTrip.rules, MATCHING_RULES_V1_DEFAULT_PAYLOAD);
  assert.equal(roundTrip.pairs.length >= 20, true);
  assert.equal(roundTrip.evidence.sqlParityDriver, "scripts/matching-sql-parity-check.ts");
  assert.equal(roundTrip.evidence.databasePolicy, "local-isolated-transaction-only");
});

check("invalid evaluation context is rejected instead of consulting wall-clock time", () => {
  assert.throws(
    () => evaluatePairMatch(baseCargo, baseVessel, MATCHING_RULES_V1_DEFAULTS, { asOfYear: 2026.5 }),
    /asOfYear/,
  );
});

console.log(`rules-check (matching pure contract only): ${passed} passed, ${failed} failed`);
console.log("NOTE: run scripts/matching-sql-parity-check.ts for the mandatory real-SQL parity gate.");
if (failed > 0) process.exitCode = 1;

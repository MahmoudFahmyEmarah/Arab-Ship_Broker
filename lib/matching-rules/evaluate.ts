import { MATCH_SCORE_THRESHOLDS } from "./defaults";
import type {
  CargoMatchFacts,
  EligibilityCheck,
  MatchEvaluationContext,
  MatchScoreContribution,
  MatchScoreLabel,
  PairMatchEvaluation,
  PairRankFacts,
  PairScore,
  ValidatedMatchingRulesV1,
  VesselMatchFacts,
} from "./types";
import { assertValidatedMatchingRulesV1 } from "./validate";

function finite(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

interface DecimalParts {
  readonly coefficient: bigint;
  readonly scale: number;
}

function decimalParts(value: number): DecimalParts {
  if (!Number.isFinite(value)) throw new TypeError("Decimal matching values must be finite");
  const text = (Object.is(value, -0) ? 0 : value).toString().toLowerCase();
  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [mantissa, exponentText = "0"] = unsigned.split("e");
  const exponent = Number.parseInt(exponentText, 10);
  const [whole, fraction = ""] = mantissa.split(".");
  let digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, "");
  let scale = fraction.length - exponent;
  if (scale < 0) {
    digits += "0".repeat(-scale);
    scale = 0;
  }
  const coefficient = BigInt(digits || "0") * (negative ? BigInt(-1) : BigInt(1));
  return { coefficient, scale };
}

function pow10(exponent: number): bigint {
  let result = BigInt(1);
  for (let index = 0; index < exponent; index += 1) result *= BigInt(10);
  return result;
}

/** Compare decimal facts as their base-10 values, never as binary-float deltas. */
function decimalDifferenceWithin(left: number, right: number, tolerance: number): boolean {
  const values = [decimalParts(left), decimalParts(right), decimalParts(tolerance)];
  const scale = Math.max(...values.map((item) => item.scale));
  const scaled = values.map(
    (item) => item.coefficient * pow10(scale - item.scale),
  );
  const difference = scaled[0] >= scaled[1] ? scaled[0] - scaled[1] : scaled[1] - scaled[0];
  return difference <= scaled[2];
}

function freezeRecord<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

function scoreLabel(points: number): MatchScoreLabel {
  if (points >= MATCH_SCORE_THRESHOLDS.Strong) return "Strong";
  if (points >= MATCH_SCORE_THRESHOLDS.Good) return "Good";
  return "Possible";
}

function labelRank(label: MatchScoreLabel): number {
  return label === "Strong" ? 2 : label === "Good" ? 1 : 0;
}

function assertContext(context: MatchEvaluationContext): void {
  if (!Number.isSafeInteger(context.asOfYear) || context.asOfYear < 1900 || context.asOfYear > 3000) {
    throw new RangeError("asOfYear must be a safe integer between 1900 and 3000");
  }
}

/** Locale-independent byte-order comparison for ASCII identifiers. */
export function compareAscii(left: string, right: string): number {
  if (!/^[\x00-\x7f]*$/.test(left) || !/^[\x00-\x7f]*$/.test(right)) {
    throw new TypeError("Ranking tie-break identifiers must be ASCII");
  }
  const common = Math.min(left.length, right.length);
  for (let index = 0; index < common; index += 1) {
    const delta = left.charCodeAt(index) - right.charCodeAt(index);
    if (delta !== 0) return delta < 0 ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

export function scorePair(
  cargo: CargoMatchFacts,
  vessel: VesselMatchFacts,
  rules: ValidatedMatchingRulesV1,
): PairScore {
  assertValidatedMatchingRulesV1(rules);
  const dwt = finite(vessel.dwtGrainMt) ? vessel.dwtGrainMt : null;
  const quantity = finite(cargo.qtyMaxMt) ? cargo.qtyMaxMt : null;
  const utilization = dwt !== null && dwt !== 0 && quantity !== null ? quantity / dwt : null;
  const contributions: MatchScoreContribution[] = [];

  let dwtPoints = 0;
  let dwtExplanation = "DWT utilization is unavailable";
  if (dwt !== null && dwt > 0 && quantity !== null && quantity * 10 >= dwt * 9 && quantity <= dwt) {
    dwtPoints = rules.score.dwtTight;
    dwtExplanation = "DWT utilization is within the inclusive 90%-100% tight-fit band";
  } else if (dwt !== null && dwt > 0 && quantity !== null && quantity * 10 >= dwt * 8 && quantity * 10 <= dwt * 11) {
    dwtPoints = rules.score.dwtLoose;
    dwtExplanation = "DWT utilization is within the inclusive 80%-110% loose-fit band";
  } else if (utilization !== null) {
    dwtExplanation = "DWT utilization is outside the deployed score bands";
  }
  contributions.push(freezeRecord<MatchScoreContribution>({
    code: "dwt",
    points: dwtPoints,
    explanation: dwtExplanation,
  }));

  let zonePoints = 0;
  let zoneExplanation = "Open zone matches neither cargo zone";
  if (vessel.openZone !== null && vessel.openZone === cargo.loadZone) {
    zonePoints = rules.score.zoneLoad;
    zoneExplanation = "Open zone matches the load zone";
  } else if (vessel.openZone !== null && vessel.openZone === cargo.dischZone) {
    zonePoints = rules.score.zoneDisch;
    zoneExplanation = "Open zone matches the discharge zone";
  }
  contributions.push(freezeRecord<MatchScoreContribution>({
    code: "zone",
    points: zonePoints,
    explanation: zoneExplanation,
  }));

  const gearSatisfied = cargo.requiresGeared !== true || vessel.isGeared === true;
  contributions.push(freezeRecord<MatchScoreContribution>({
    code: "gear",
    points: gearSatisfied ? rules.score.gear : 0,
    explanation: gearSatisfied ? "Gear requirement is satisfied" : "Required vessel gear is absent",
  }));

  const points = contributions.reduce((total, item) => total + item.points, 0);
  const result: PairScore = {
    points,
    label: scoreLabel(points),
    utilization,
    contributions: Object.freeze(contributions),
  };
  return freezeRecord(result);
}

export function pairRankFacts(
  cargo: CargoMatchFacts,
  vessel: VesselMatchFacts,
  rules: ValidatedMatchingRulesV1,
): PairRankFacts {
  assertValidatedMatchingRulesV1(rules);
  const cargoRate = cargo.freightIdeaUsdMt;
  const vesselRate = vessel.freightIdeaUsdMt;
  const rateAligned = finite(cargoRate) && finite(vesselRate)
    ? decimalDifferenceWithin(cargoRate, vesselRate, rules.rateAlignmentUsd)
    : false;
  const dwtDeltaMt = finite(vessel.dwtGrainMt) && finite(cargo.qtyMaxMt)
    ? Math.abs(vessel.dwtGrainMt - cargo.qtyMaxMt)
    : null;
  const result: PairRankFacts = { rateAligned, dwtDeltaMt };
  return freezeRecord(result);
}

export function evaluatePairMatch(
  cargo: CargoMatchFacts,
  vessel: VesselMatchFacts,
  rules: ValidatedMatchingRulesV1,
  context: MatchEvaluationContext,
): PairMatchEvaluation {
  assertValidatedMatchingRulesV1(rules);
  assertContext(context);

  const checks: EligibilityCheck[] = [];
  const add = (code: EligibilityCheck["code"], passed: boolean, explanation: string): void => {
    checks.push(freezeRecord<EligibilityCheck>({ code, passed, explanation }));
  };

  const cargoApproved = cargo.reviewStatus === "APPROVED";
  add("cargo_review_status", cargoApproved, cargoApproved ? "Cargo is approved" : "Cargo is not approved");
  const cargoLive = cargo.status === "IN" || cargo.status === "PARTIAL";
  add("cargo_market_status", cargoLive, cargoLive ? "Cargo is live" : "Cargo is not live");
  const availabilityOpen = vessel.availabilityStatus === "OPEN";
  add("availability_status", availabilityOpen, availabilityOpen ? "Availability is open" : "Availability is not open");
  const availabilityApproved = vessel.availabilityReviewStatus === "APPROVED";
  add(
    "availability_review_status",
    availabilityApproved,
    availabilityApproved ? "Availability is approved" : "Availability is not approved",
  );
  add("sanctions", !vessel.isSanctioned, vessel.isSanctioned ? "Vessel is sanctioned" : "Vessel is not sanctioned");

  const zonePassed = vessel.openZone !== null &&
    (vessel.openZone === cargo.loadZone || vessel.openZone === cargo.dischZone);
  add("zone", zonePassed, zonePassed ? "Open zone matches the cargo route" : "Open zone does not match the cargo route");

  const dwt = vessel.dwtGrainMt;
  const quantityMinimum = cargo.qtyMinMt;
  const quantityMaximum = cargo.qtyMaxMt;
  const capacityDataPassed = finite(dwt) && finite(quantityMinimum) && finite(quantityMaximum);
  add(
    "capacity_data",
    capacityDataPassed,
    capacityDataPassed ? "DWT and quantity inputs are finite" : "DWT and both quantity bounds are required",
  );
  let capacityPassed = false;
  if (capacityDataPassed) {
    const tolerancePct = vessel.acceptsPartCargo ? rules.partCargoTolerancePct : rules.dwtTolerancePct;
    const scaledDwt = dwt * 100;
    const lower = quantityMaximum * (100 - tolerancePct);
    const upper = quantityMaximum * (100 + tolerancePct);
    capacityPassed = dwt >= quantityMinimum && scaledDwt >= lower && scaledDwt <= upper;
    add(
      "capacity",
      capacityPassed,
      capacityPassed
        ? `DWT meets the quantity-minimum floor and inclusive +/-${tolerancePct}% window`
        : `DWT misses the quantity-minimum floor or inclusive +/-${tolerancePct}% window`,
    );
  } else {
    add("capacity", false, "Capacity cannot be evaluated without finite DWT and quantity inputs");
  }

  const vesselTypePassed = cargo.cargoType === "Break Bulk" ||
    vessel.vesselType === "Bulk Carrier" || vessel.vesselType === "General Cargo";
  add(
    "vessel_type",
    vesselTypePassed,
    vesselTypePassed ? "Vessel type is compatible" : "Non-break-bulk cargo requires Bulk Carrier or General Cargo",
  );

  const laycanPassed = cargo.isSpot === true || (
    Number.isSafeInteger(cargo.laycanFromDay) && Number.isSafeInteger(vessel.openDateDay) &&
    vessel.openDateDay! >= cargo.laycanFromDay! - rules.laycanBeforeDays &&
    vessel.openDateDay! <= cargo.laycanFromDay! + rules.laycanAfterDays
  );
  add(
    "laycan",
    laycanPassed,
    laycanPassed ? "Spot cargo or open date is inside the inclusive laycan window" : "Open date is outside or missing from the laycan window",
  );

  const gearPassed = cargo.requiresGeared !== true || vessel.isGeared === true;
  add("gear", gearPassed, gearPassed ? "Gear requirement is satisfied" : "Cargo requires a geared vessel");
  const grainPassed = cargo.isGrainCargo === false || vessel.grainCertified === true;
  add(
    "grain_certificate",
    grainPassed,
    grainPassed ? "Grain certificate requirement is satisfied" : "Grain certificate is required",
  );
  const dangerousGoodsPassed = cargo.isDgCargo === false || vessel.dgCertified === true;
  add(
    "dangerous_goods_certificate",
    dangerousGoodsPassed,
    dangerousGoodsPassed ? "Dangerous-goods certificate requirement is satisfied" : "Dangerous-goods certificate is required",
  );

  const agePassed = cargo.maxVesselAgeYr === null || vessel.buildYear === null || (
    finite(cargo.maxVesselAgeYr) && finite(vessel.buildYear) && context.asOfYear - vessel.buildYear <= cargo.maxVesselAgeYr
  );
  add("vessel_age", agePassed, agePassed ? "Vessel age limit is satisfied or vessel age is unknown" : "Vessel exceeds the cargo age limit");
  const draftPassed = cargo.maxDraftM === null || vessel.maxDraftM === null || (
    finite(cargo.maxDraftM) && finite(vessel.maxDraftM) && vessel.maxDraftM <= cargo.maxDraftM
  );
  add("draft", draftPassed, draftPassed ? "Draft limit is satisfied or vessel draft is unknown" : "Vessel draft exceeds the cargo limit");
  const loaPassed = cargo.maxLoaM === null || vessel.maxLoaM === null || (
    finite(cargo.maxLoaM) && finite(vessel.maxLoaM) && vessel.maxLoaM <= cargo.maxLoaM
  );
  add("loa", loaPassed, loaPassed ? "LOA limit is satisfied or vessel LOA is unknown" : "Vessel LOA exceeds the cargo limit");

  const score = scorePair(cargo, vessel, rules);
  const minimumScorePassed = labelRank(score.label) >= labelRank(rules.minScoreLabel);
  add(
    "minimum_score",
    minimumScorePassed,
    minimumScorePassed ? "Score meets the configured minimum label" : "Score is below the configured minimum label",
  );

  const frozenChecks = Object.freeze(checks);
  const failedChecks = Object.freeze(frozenChecks.filter((check) => !check.passed));
  const eligible = failedChecks.length === 0;
  const result: PairMatchEvaluation = {
    cargoId: cargo.cargoId,
    availabilityId: vessel.availabilityId,
    eligible,
    displayLabel: eligible ? score.label : "Weak",
    score,
    rank: pairRankFacts(cargo, vessel, rules),
    checks: frozenChecks,
    failedChecks,
    schemaVersion: rules.schemaVersion,
  };
  return freezeRecord(result);
}

export function pairEligible(
  cargo: CargoMatchFacts,
  vessel: VesselMatchFacts,
  rules: ValidatedMatchingRulesV1,
  context: MatchEvaluationContext,
): boolean {
  return evaluatePairMatch(cargo, vessel, rules, context).eligible;
}

/** Deployed ordering: rate-aligned first, DWT delta second, ASCII id last. */
export function comparePairMatchRank(left: PairMatchEvaluation, right: PairMatchEvaluation): number {
  if (left.rank.rateAligned !== right.rank.rateAligned) return left.rank.rateAligned ? -1 : 1;
  const leftDelta = left.rank.dwtDeltaMt ?? Number.POSITIVE_INFINITY;
  const rightDelta = right.rank.dwtDeltaMt ?? Number.POSITIVE_INFINITY;
  if (leftDelta !== rightDelta) return leftDelta < rightDelta ? -1 : 1;
  return compareAscii(left.availabilityId, right.availabilityId);
}

export function rankEligibleMatches(
  cargo: CargoMatchFacts,
  vessels: readonly VesselMatchFacts[],
  rules: ValidatedMatchingRulesV1,
  context: MatchEvaluationContext,
): readonly PairMatchEvaluation[] {
  assertValidatedMatchingRulesV1(rules);
  const evaluations = vessels
    .map((vessel) => evaluatePairMatch(cargo, vessel, rules, context))
    .filter((evaluation) => evaluation.eligible)
    .sort(comparePairMatchRank);
  return Object.freeze(evaluations);
}

export function explainPairMatch(evaluation: PairMatchEvaluation): readonly string[] {
  const checks = evaluation.eligible ? evaluation.checks : evaluation.failedChecks;
  return Object.freeze([
    ...checks.map((check) => `${check.code}: ${check.explanation}`),
    ...evaluation.score.contributions.map(
      (contribution) => `score.${contribution.code}: ${contribution.points} - ${contribution.explanation}`,
    ),
    `rank.rate_aligned: ${evaluation.rank.rateAligned}`,
    `rank.dwt_delta_mt: ${evaluation.rank.dwtDeltaMt ?? "unavailable"}`,
  ]);
}

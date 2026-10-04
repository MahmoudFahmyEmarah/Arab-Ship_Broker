import {
  MATCHING_RULE_SCHEMA_VERSION,
  type MatchScoreLabel,
  type MatchingRulesParseResult,
  type MatchingRulesV1Payload,
  type MatchingRulesValidationIssue,
  type ValidatedMatchingRulesV1,
} from "./types";

const TOP_LEVEL_KEYS = Object.freeze([
  "schemaVersion",
  "dwtTolerancePct",
  "partCargoTolerancePct",
  "laycanBeforeDays",
  "laycanAfterDays",
  "rateAlignmentUsd",
  "minScoreLabel",
  "score",
] as const);

const SCORE_KEYS = Object.freeze([
  "dwtTight",
  "dwtLoose",
  "zoneLoad",
  "zoneDisch",
  "gear",
] as const);

const SCORE_LABELS = new Set<MatchScoreLabel>(["Possible", "Good", "Strong"]);
const parserIssuedRules = new WeakSet<object>();

export class MatchingRulesValidationError extends TypeError {
  readonly issues: readonly MatchingRulesValidationIssue[];

  constructor(issues: readonly MatchingRulesValidationIssue[]) {
    super(`Invalid matching rules: ${issues.map((issue) => `${issue.path} ${issue.message}`).join("; ")}`);
    this.name = "MatchingRulesValidationError";
    this.issues = issues;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function inspectRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  issues: MatchingRulesValidationIssue[],
): Record<string, unknown> | null {
  if (!isPlainRecord(value)) {
    issues.push({ path, code: "type", message: "must be a plain object" });
    return null;
  }

  const descriptors = Object.getOwnPropertyDescriptors(value);
  let unsafeStructure = false;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allowedKeys.includes(key)) {
      issues.push({ path: `${path}.${String(key)}`, code: "unknown", message: "is not allowed" });
      unsafeStructure = true;
      continue;
    }
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) {
      issues.push({ path: `${path}.${key}`, code: "type", message: "must be an enumerable data property" });
      unsafeStructure = true;
    }
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issues.push({ path: `${path}.${key}`, code: "missing", message: "is required" });
      unsafeStructure = true;
    }
  }
  return unsafeStructure ? null : value;
}

function integerInRange(
  record: Record<string, unknown>,
  key: string,
  path: string,
  minimum: number,
  maximum: number,
  issues: MatchingRulesValidationIssue[],
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    issues.push({ path: `${path}.${key}`, code: "type", message: "must be a finite safe integer" });
    return null;
  }
  if (value < minimum || value > maximum) {
    issues.push({ path: `${path}.${key}`, code: "range", message: `must be between ${minimum} and ${maximum}` });
    return null;
  }
  return Object.is(value, -0) ? 0 : value;
}

function currencyTolerance(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: MatchingRulesValidationIssue[],
): number | null {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    issues.push({ path: `${path}.${key}`, code: "type", message: "must be finite" });
    return null;
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  if (normalized < 0 || normalized > 1_000) {
    issues.push({ path: `${path}.${key}`, code: "range", message: "must be between 0 and 1000 USD/MT" });
    return null;
  }
  if (!Number.isSafeInteger(Math.round(normalized * 100))) {
    issues.push({ path: `${path}.${key}`, code: "range", message: "must have at most two decimal places" });
    return null;
  }
  const rounded = Math.round(normalized * 100) / 100;
  if (Math.abs(rounded - normalized) > Number.EPSILON * Math.max(1, Math.abs(normalized))) {
    issues.push({ path: `${path}.${key}`, code: "range", message: "must have at most two decimal places" });
    return null;
  }
  return rounded;
}

function reachableScores(score: {
  dwtTight: number;
  dwtLoose: number;
  zoneLoad: number;
  zoneDisch: number;
  gear: number;
}, maximumTolerancePct: number): ReadonlySet<number> {
  const values = new Set<number>();
  // A 100% utilization tight fit is always inside the eligibility window.
  // Any non-zero window can reach a loose fit. With integer percentage
  // controls, 10% is the first window wide enough to reach a zero-point
  // utilization outside 80%-110% while the capacity gate still passes.
  const dwtBranches = [score.dwtTight];
  if (maximumTolerancePct > 0) dwtBranches.push(score.dwtLoose);
  if (maximumTolerancePct >= 10) dwtBranches.push(0);
  for (const dwt of dwtBranches) {
    for (const zone of [score.zoneDisch, score.zoneLoad]) values.add(dwt + zone + score.gear);
  }
  return values;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function invalidResult(issues: MatchingRulesValidationIssue[]): MatchingRulesParseResult {
  return Object.freeze({
    success: false,
    issues: Object.freeze(issues.map((issue) => Object.freeze(issue))),
  });
}

export function safeParseMatchingRulesV1(input: unknown): MatchingRulesParseResult {
  const issues: MatchingRulesValidationIssue[] = [];
  const root = inspectRecord(input, "$", TOP_LEVEL_KEYS, issues);
  if (!root) return invalidResult(issues);

  const schemaVersion = integerInRange(root, "schemaVersion", "$", 1, 1, issues);
  const dwtTolerancePct = integerInRange(root, "dwtTolerancePct", "$", 0, 50, issues);
  const partCargoTolerancePct = integerInRange(root, "partCargoTolerancePct", "$", 0, 50, issues);
  const laycanBeforeDays = integerInRange(root, "laycanBeforeDays", "$", 0, 90, issues);
  const laycanAfterDays = integerInRange(root, "laycanAfterDays", "$", 0, 90, issues);
  const rateAlignmentUsd = currencyTolerance(root, "rateAlignmentUsd", "$", issues);

  const rawLabel = root.minScoreLabel;
  const minScoreLabel = typeof rawLabel === "string" && SCORE_LABELS.has(rawLabel as MatchScoreLabel)
    ? rawLabel as MatchScoreLabel
    : null;
  if (minScoreLabel === null) {
    issues.push({ path: "$.minScoreLabel", code: "type", message: "must be Possible, Good, or Strong" });
  }

  const rawScore = inspectRecord(root.score, "$.score", SCORE_KEYS, issues);
  const dwtTight = rawScore ? integerInRange(rawScore, "dwtTight", "$.score", 0, 20, issues) : null;
  const dwtLoose = rawScore ? integerInRange(rawScore, "dwtLoose", "$.score", 0, 20, issues) : null;
  const zoneLoad = rawScore ? integerInRange(rawScore, "zoneLoad", "$.score", 0, 20, issues) : null;
  const zoneDisch = rawScore ? integerInRange(rawScore, "zoneDisch", "$.score", 0, 20, issues) : null;
  const gear = rawScore ? integerInRange(rawScore, "gear", "$.score", 0, 20, issues) : null;

  if (dwtTolerancePct !== null && partCargoTolerancePct !== null && partCargoTolerancePct < dwtTolerancePct) {
    issues.push({
      path: "$.partCargoTolerancePct",
      code: "relation",
      message: "must be greater than or equal to dwtTolerancePct",
    });
  }
  if (dwtTight !== null && dwtLoose !== null && dwtTight < dwtLoose) {
    issues.push({ path: "$.score.dwtTight", code: "relation", message: "must be greater than or equal to dwtLoose" });
  }
  if (zoneLoad !== null && zoneDisch !== null && zoneLoad < zoneDisch) {
    issues.push({ path: "$.score.zoneLoad", code: "relation", message: "must be greater than or equal to zoneDisch" });
  }

  if (partCargoTolerancePct !== null &&
      [dwtTight, dwtLoose, zoneLoad, zoneDisch, gear].every((value) => value !== null)) {
    const scores = reachableScores({
      dwtTight: dwtTight!,
      dwtLoose: dwtLoose!,
      zoneLoad: zoneLoad!,
      zoneDisch: zoneDisch!,
      gear: gear!,
    }, partCargoTolerancePct);
    if (![...scores].some((value) => value < 3)) {
      issues.push({ path: "$.score", code: "relation", message: "must leave the Possible label reachable" });
    }
    if (![...scores].some((value) => value >= 3 && value < 4)) {
      issues.push({ path: "$.score", code: "relation", message: "must make the Good label reachable" });
    }
    if (![...scores].some((value) => value >= 4)) {
      issues.push({ path: "$.score", code: "relation", message: "must make the Strong label reachable" });
    }
  }

  if (issues.length > 0 || schemaVersion !== MATCHING_RULE_SCHEMA_VERSION || dwtTolerancePct === null ||
      partCargoTolerancePct === null || laycanBeforeDays === null || laycanAfterDays === null ||
      rateAlignmentUsd === null || minScoreLabel === null || dwtTight === null || dwtLoose === null ||
      zoneLoad === null || zoneDisch === null || gear === null) {
    return invalidResult(issues);
  }

  const parsed: MatchingRulesV1Payload = {
    schemaVersion: MATCHING_RULE_SCHEMA_VERSION,
    dwtTolerancePct,
    partCargoTolerancePct,
    laycanBeforeDays,
    laycanAfterDays,
    rateAlignmentUsd,
    minScoreLabel,
    score: { dwtTight, dwtLoose, zoneLoad, zoneDisch, gear },
  };
  const frozen = deepFreeze(parsed) as ValidatedMatchingRulesV1;
  parserIssuedRules.add(frozen);
  return Object.freeze({ success: true, data: frozen });
}

export function parseMatchingRulesV1(input: unknown): ValidatedMatchingRulesV1 {
  const result = safeParseMatchingRulesV1(input);
  if (!result.success) throw new MatchingRulesValidationError(result.issues);
  return result.data;
}

export function isValidatedMatchingRulesV1(value: unknown): value is ValidatedMatchingRulesV1 {
  return value !== null && typeof value === "object" && parserIssuedRules.has(value);
}

export function assertValidatedMatchingRulesV1(value: unknown): asserts value is ValidatedMatchingRulesV1 {
  if (!isValidatedMatchingRulesV1(value)) {
    throw new TypeError("Matching rules must be created by parseMatchingRulesV1");
  }
}

import { compareAscii, hashIntelligenceRuleSet } from "./canonical";
import { INTELLIGENCE_FIELDS, isIntelligenceField } from "./fields";
import {
  markValidatedIntelligenceFacts,
  markValidatedIntelligenceRuleSet,
  markValidatedIntelligenceRuleSetEnvelope,
  assertValidatedIntelligenceRuleSetEnvelope,
} from "./trust";
import {
  INTELLIGENCE_EVALUATOR_VERSION,
  INTELLIGENCE_SCHEMA_VERSION,
  type IntelligenceEntity,
  type IntelligenceFactsInput,
  type IntelligenceGroupScope,
  type IntelligenceOperator,
  type IntelligenceProvenanceEntryV1,
  type IntelligenceRuleGroupV1,
  type IntelligenceRuleSetEnvelope,
  type IntelligenceRuleSetDocumentV1,
  type IntelligenceSeverity,
  type IntelligenceValidationIssue,
  type IntelligenceValidationResult,
  type ValidatedIntelligenceFacts,
  type ValidatedIntelligenceRuleSet,
  type ValidatedIntelligenceRuleSetEnvelope,
} from "./types";

const ROOT_KEYS = ["schemaVersion", "evaluatorVersion", "groups", "rules"] as const;
const GROUP_KEYS = ["code", "name", "description", "scope", "active", "priority"] as const;
const RULE_KEYS = [
  "code", "group", "entity", "field", "operator", "threshold", "severity",
  "tag", "message", "signalKey", "active", "priority",
] as const;
const PROVENANCE_KEYS = ["ruleCode", "sourceRef", "originalMessage", "note"] as const;
const FACT_KEYS = ["entity", "values"] as const;
const ENVELOPE_KEYS = ["version", "ruleSetContentHash", "effectiveContentHash", "document"] as const;

const ENTITIES: readonly IntelligenceEntity[] = ["cargo", "vessel"];
const SCOPES: readonly IntelligenceGroupScope[] = ["cargo", "vessel", "both", "framework"];
const OPERATORS: readonly IntelligenceOperator[] = ["lt", "gt", "eq", "ne", "between", "missing"];
const SEVERITIES: readonly IntelligenceSeverity[] = ["good", "info", "warning", "danger"];
const BOUNDARY_WHITESPACE = /^[\u0009-\u000d\u0020]|[\u0009-\u000d\u0020]$/;

function unicodeScalarLength(value: string): number | null {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index);
    if (unit === 0) return null;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return null;
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return null;
    }
    count += 1;
  }
  return count;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== "string") return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return Boolean(descriptor?.enumerable && !descriptor.get && !descriptor.set);
  });
}

function own(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isDenseArray(value: unknown[]): boolean {
  const keys = Object.keys(value);
  return keys.length === value.length && keys.every((key, index) => key === String(index));
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: IntelligenceValidationIssue[],
): void {
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) issues.push({ path: `${path}.${key}`, code: "unknown_key", message: "Unknown key" });
  }
  for (const key of keys) {
    if (!own(value, key)) issues.push({ path: `${path}.${key}`, code: "missing_key", message: "Required key is missing" });
  }
}

function boundedString(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
  issues: IntelligenceValidationIssue[],
  pattern?: RegExp,
): value is string {
  const scalarLength = typeof value === "string" ? unicodeScalarLength(value) : null;
  if (typeof value !== "string" || scalarLength === null || scalarLength < minimum ||
      scalarLength > maximum || BOUNDARY_WHITESPACE.test(value)) {
    issues.push({ path, code: "value", message: `Expected ${minimum}-${maximum} trimmed characters` });
    return false;
  }
  if (pattern && !pattern.test(value)) {
    issues.push({ path, code: "value", message: "Value has an unsupported format" });
    return false;
  }
  return true;
}

function safePriority(value: unknown, path: string, issues: IntelligenceValidationIssue[]): value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    issues.push({ path, code: "value", message: "Priority must be an integer from 0 to 10000" });
    return false;
  }
  return true;
}

function normalNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function validateThreshold(rule: Record<string, unknown>, path: string, issues: IntelligenceValidationIssue[]): void {
  if (!isIntelligenceField(rule.field) || !OPERATORS.includes(rule.operator as IntelligenceOperator)) return;
  const definition = INTELLIGENCE_FIELDS[rule.field];
  const operator = rule.operator as IntelligenceOperator;
  const threshold = rule.threshold;

  if (!definition.allowedOperators.includes(operator)) {
    issues.push({ path: `${path}.operator`, code: "value", message: "Operator is not allowed for this field" });
    return;
  }
  if (operator === "missing") {
    if (threshold !== null) issues.push({ path: `${path}.threshold`, code: "value", message: "missing requires a null threshold" });
    return;
  }
  const inRange = (number: unknown): number is number => {
    if (typeof number !== "number" || !Number.isFinite(number) ||
        number < definition.minimumThreshold || number > definition.maximumThreshold) return false;
    const scale = 10 ** definition.maximumDecimalPlaces;
    return number === Math.round(number * scale) / scale;
  };
  if (operator === "between") {
    if (!Array.isArray(threshold) || !isDenseArray(threshold) || threshold.length !== 2 || !inRange(threshold[0]) || !inRange(threshold[1])) {
      issues.push({
        path: `${path}.threshold`,
        code: "value",
        message: `between requires two in-range finite numbers with at most ${definition.maximumDecimalPlaces} decimal places`,
      });
    } else if (threshold[0] > threshold[1]) {
      issues.push({ path: `${path}.threshold`, code: "value", message: "between lower bound exceeds upper bound" });
    }
    return;
  }
  if (!inRange(threshold)) {
    issues.push({
      path: `${path}.threshold`,
      code: "value",
      message: `Threshold must be a finite number from ${definition.minimumThreshold} to ${definition.maximumThreshold} with at most ${definition.maximumDecimalPlaces} decimal places`,
    });
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function validateIntelligenceRuleSet(value: unknown): IntelligenceValidationResult<ValidatedIntelligenceRuleSet> {
  const issues: IntelligenceValidationIssue[] = [];
  if (!isRecord(value)) {
    return { ok: false, issues: [{ path: "$", code: "type", message: "Expected a rule-set object" }] };
  }
  exactKeys(value, ROOT_KEYS, "$", issues);
  if (value.schemaVersion !== INTELLIGENCE_SCHEMA_VERSION) {
    issues.push({ path: "$.schemaVersion", code: "value", message: "Unsupported schema version" });
  }
  if (value.evaluatorVersion !== INTELLIGENCE_EVALUATOR_VERSION) {
    issues.push({ path: "$.evaluatorVersion", code: "value", message: "Unsupported evaluator version" });
  }
  if (!Array.isArray(value.groups) || !isDenseArray(value.groups)) issues.push({ path: "$.groups", code: "type", message: "Expected a dense undecorated array" });
  if (!Array.isArray(value.rules) || !isDenseArray(value.rules)) issues.push({ path: "$.rules", code: "type", message: "Expected a dense undecorated array" });

  const groupCodes = new Set<string>();
  const groups = new Map<string, IntelligenceRuleGroupV1>();
  if (Array.isArray(value.groups)) value.groups.forEach((candidate, index) => {
    const path = `$.groups[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path, code: "type", message: "Expected a group object" });
      return;
    }
    exactKeys(candidate, GROUP_KEYS, path, issues);
    const codeOk = boundedString(candidate.code, `${path}.code`, 2, 32, issues, /^[a-z][a-z0-9_]*$/);
    boundedString(candidate.name, `${path}.name`, 1, 120, issues);
    if (candidate.description !== null) boundedString(candidate.description, `${path}.description`, 1, 500, issues);
    if (!SCOPES.includes(candidate.scope as IntelligenceGroupScope)) {
      issues.push({ path: `${path}.scope`, code: "value", message: "Unsupported group scope" });
    }
    if (typeof candidate.active !== "boolean") issues.push({ path: `${path}.active`, code: "type", message: "Expected a boolean" });
    safePriority(candidate.priority, `${path}.priority`, issues);
    if (candidate.scope === "framework" && candidate.active !== false) {
      issues.push({ path: `${path}.active`, code: "scope", message: "Framework placeholders must be inactive" });
    }
    if (codeOk) {
      if (groupCodes.has(candidate.code as string)) {
        issues.push({ path: `${path}.code`, code: "duplicate", message: "Group code is duplicated" });
      } else {
        groupCodes.add(candidate.code as string);
        if (SCOPES.includes(candidate.scope as IntelligenceGroupScope) && typeof candidate.active === "boolean" &&
            Number.isSafeInteger(candidate.priority)) {
          groups.set(candidate.code as string, candidate as unknown as IntelligenceRuleGroupV1);
        }
      }
    }
  });

  const ruleCodes = new Set<string>();
  if (Array.isArray(value.rules)) value.rules.forEach((candidate, index) => {
    const path = `$.rules[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path, code: "type", message: "Expected a rule object" });
      return;
    }
    exactKeys(candidate, RULE_KEYS, path, issues);
    const codeOk = boundedString(candidate.code, `${path}.code`, 3, 32, issues, /^[A-Z][A-Z0-9_-]*$/);
    const groupOk = boundedString(candidate.group, `${path}.group`, 2, 32, issues, /^[a-z][a-z0-9_]*$/);
    if (!ENTITIES.includes(candidate.entity as IntelligenceEntity)) {
      issues.push({ path: `${path}.entity`, code: "value", message: "Unsupported entity" });
    }
    if (!isIntelligenceField(candidate.field)) {
      issues.push({ path: `${path}.field`, code: "value", message: "Field is not whitelisted" });
    } else if (INTELLIGENCE_FIELDS[candidate.field].entity !== candidate.entity) {
      issues.push({ path: `${path}.field`, code: "scope", message: "Field does not belong to the rule entity" });
    }
    if (!OPERATORS.includes(candidate.operator as IntelligenceOperator)) {
      issues.push({ path: `${path}.operator`, code: "value", message: "Unsupported operator" });
    }
    if (!SEVERITIES.includes(candidate.severity as IntelligenceSeverity)) {
      issues.push({ path: `${path}.severity`, code: "value", message: "Unsupported severity" });
    }
    boundedString(candidate.tag, `${path}.tag`, 1, 80, issues);
    boundedString(candidate.message, `${path}.message`, 1, 500, issues);
    boundedString(candidate.signalKey, `${path}.signalKey`, 3, 80, issues, /^[a-z][a-z0-9._-]*$/);
    if (typeof candidate.active !== "boolean") issues.push({ path: `${path}.active`, code: "type", message: "Expected a boolean" });
    safePriority(candidate.priority, `${path}.priority`, issues);
    validateThreshold(candidate, path, issues);

    if (codeOk) {
      if (ruleCodes.has(candidate.code as string)) {
        issues.push({ path: `${path}.code`, code: "duplicate", message: "Rule code is duplicated" });
      }
      ruleCodes.add(candidate.code as string);
    }
    if (groupOk) {
      const group = groups.get(candidate.group as string);
      if (!group) issues.push({ path: `${path}.group`, code: "reference", message: "Rule group does not exist" });
      else if (group.scope === "framework") {
        issues.push({ path: `${path}.group`, code: "scope", message: "Framework placeholder groups cannot contain rules" });
      } else if (group.scope !== "both" && group.scope !== candidate.entity) {
        issues.push({ path: `${path}.entity`, code: "scope", message: "Rule entity is outside its group scope" });
      }
    }
  });

  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };

  const typed = value as unknown as IntelligenceRuleSetDocumentV1;
  const groupPriority = new Map(typed.groups.map((group) => [group.code, group.priority]));
  const normalized: IntelligenceRuleSetDocumentV1 = {
    schemaVersion: INTELLIGENCE_SCHEMA_VERSION,
    evaluatorVersion: INTELLIGENCE_EVALUATOR_VERSION,
    groups: typed.groups.map((group) => ({ ...group })).sort((left, right) =>
      left.priority - right.priority || compareAscii(left.code, right.code)),
    rules: typed.rules.map((rule) => ({
      ...rule,
      threshold: Array.isArray(rule.threshold)
        ? [normalNumber(rule.threshold[0]), normalNumber(rule.threshold[1])] as const
        : typeof rule.threshold === "number" ? normalNumber(rule.threshold) : null,
    })).sort((left, right) =>
      (groupPriority.get(left.group) ?? 10_001) - (groupPriority.get(right.group) ?? 10_001) ||
      left.priority - right.priority || compareAscii(left.code, right.code)),
  };
  const frozen = freezeDeep(normalized);
  return {
    ok: true,
    value: markValidatedIntelligenceRuleSet(frozen),
    issues: Object.freeze([]),
  };
}

export function parseIntelligenceRuleSet(value: unknown): ValidatedIntelligenceRuleSet {
  const result = validateIntelligenceRuleSet(value);
  if (!result.ok || !result.value) {
    throw new TypeError(result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  return result.value;
}

async function parseIntelligenceRuleSetEnvelopeShape(value: unknown): Promise<{
  version: number;
  ruleSetContentHash: string;
  effectiveContentHash: string;
  document: ValidatedIntelligenceRuleSet;
}> {
  const issues: IntelligenceValidationIssue[] = [];
  if (!isRecord(value)) throw new TypeError("$: Expected an active rule-set envelope");
  exactKeys(value, ENVELOPE_KEYS, "$", issues);
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1) {
    issues.push({ path: "$.version", code: "value", message: "Version must be a positive safe integer" });
  }
  for (const key of ["ruleSetContentHash", "effectiveContentHash"] as const) {
    if (typeof value[key] !== "string" || !/^[a-f0-9]{64}$/.test(value[key] as string)) {
      issues.push({ path: `$.${key}`, code: "value", message: "Expected a lowercase SHA-256 digest" });
    }
  }
  let document: ValidatedIntelligenceRuleSet | undefined;
  try {
    document = parseIntelligenceRuleSet(value.document);
  } catch (error) {
    issues.push({ path: "$.document", code: "value", message: error instanceof Error ? error.message : "Invalid document" });
  }
  if (document) {
    const referencedGroups = new Set(document.rules.map((rule) => rule.group));
    if (document.rules.length === 0 || document.groups.length === 0) {
      issues.push({ path: "$.document", code: "value", message: "Active envelope must contain effective groups and rules" });
    }
    if (document.rules.some((rule) => !rule.active) ||
        document.groups.some((group) => !group.active || group.scope === "framework" || !referencedGroups.has(group.code))) {
      issues.push({ path: "$.document", code: "scope", message: "Active envelope contains an inactive or ineffective entry" });
    }
  }
  if (issues.length > 0 || !document) {
    throw new TypeError(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
  const input = value as unknown as IntelligenceRuleSetEnvelope;
  const parsed = freezeDeep({
    version: input.version,
    ruleSetContentHash: input.ruleSetContentHash,
    effectiveContentHash: input.effectiveContentHash,
    document,
  });
  if ((await hashIntelligenceRuleSet(document)) !== parsed.effectiveContentHash) {
    throw new TypeError("$.effectiveContentHash: Effective document SHA-256 mismatch");
  }
  return parsed;
}

export async function parseIntelligenceRuleSetEnvelope(
  value: unknown,
): Promise<ValidatedIntelligenceRuleSetEnvelope> {
  return markValidatedIntelligenceRuleSetEnvelope(
    await parseIntelligenceRuleSetEnvelopeShape(value),
  );
}

export async function verifyIntelligenceRuleSetEnvelope(
  envelope: ValidatedIntelligenceRuleSetEnvelope,
): Promise<boolean> {
  assertValidatedIntelligenceRuleSetEnvelope(envelope);
  return (await hashIntelligenceRuleSet(envelope.document)) === envelope.effectiveContentHash;
}

export function validateIntelligenceProvenance(
  value: unknown,
  ruleSet?: ValidatedIntelligenceRuleSet,
): IntelligenceValidationResult<readonly IntelligenceProvenanceEntryV1[]> {
  const issues: IntelligenceValidationIssue[] = [];
  if (!Array.isArray(value) || !isDenseArray(value)) return { ok: false, issues: [{ path: "$", code: "type", message: "Expected a dense undecorated array" }] };
  const known = ruleSet ? new Set(ruleSet.rules.map((rule) => rule.code)) : null;
  const seen = new Set<string>();
  value.forEach((candidate, index) => {
    const path = `$[${index}]`;
    if (!isRecord(candidate)) {
      issues.push({ path, code: "type", message: "Expected a provenance object" });
      return;
    }
    exactKeys(candidate, PROVENANCE_KEYS, path, issues);
    const codeOk = boundedString(candidate.ruleCode, `${path}.ruleCode`, 3, 32, issues, /^[A-Z][A-Z0-9_-]*$/);
    boundedString(candidate.sourceRef, `${path}.sourceRef`, 1, 500, issues);
    boundedString(candidate.originalMessage, `${path}.originalMessage`, 1, 1000, issues);
    if (candidate.note !== null) boundedString(candidate.note, `${path}.note`, 1, 1000, issues);
    if (codeOk) {
      const code = candidate.ruleCode as string;
      if (seen.has(code)) issues.push({ path: `${path}.ruleCode`, code: "duplicate", message: "Rule provenance is duplicated" });
      if (known && !known.has(code)) issues.push({ path: `${path}.ruleCode`, code: "reference", message: "Rule does not exist in the set" });
      seen.add(code);
    }
  });
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  const normalized = (value as IntelligenceProvenanceEntryV1[])
    .map((entry) => ({ ...entry }))
    .sort((left, right) => compareAscii(left.ruleCode, right.ruleCode));
  return { ok: true, value: freezeDeep(normalized), issues: Object.freeze([]) };
}

export function parseIntelligenceFacts(value: unknown): ValidatedIntelligenceFacts {
  const issues: IntelligenceValidationIssue[] = [];
  if (!isRecord(value)) throw new TypeError("$: Expected a fact-set object");
  exactKeys(value, FACT_KEYS, "$", issues);
  if (!ENTITIES.includes(value.entity as IntelligenceEntity)) {
    issues.push({ path: "$.entity", code: "value", message: "Unsupported entity" });
  }
  if (!isRecord(value.values)) {
    issues.push({ path: "$.values", code: "type", message: "Expected an object" });
  } else {
    for (const [key, fact] of Object.entries(value.values)) {
      if (!isIntelligenceField(key) || INTELLIGENCE_FIELDS[key].entity !== value.entity) {
        issues.push({ path: `$.values.${key}`, code: "unknown_key", message: "Field is not whitelisted for this entity" });
      } else if (fact !== null && (typeof fact !== "number" || !Number.isFinite(fact))) {
        issues.push({ path: `$.values.${key}`, code: "type", message: "Fact must be a finite number or null" });
      }
    }
  }
  if (issues.length > 0) throw new TypeError(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  const input = value as unknown as IntelligenceFactsInput;
  const values = Object.fromEntries(Object.entries(input.values).map(([key, fact]) => [
    key,
    typeof fact === "number" ? normalNumber(fact) : null,
  ]));
  return markValidatedIntelligenceFacts(freezeDeep({ entity: input.entity, values }));
}

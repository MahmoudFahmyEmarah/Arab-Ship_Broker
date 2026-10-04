import { compareAscii } from "./canonical";
import {
  assertValidatedIntelligenceFacts,
  assertValidatedIntelligenceRuleSet,
} from "./trust";
import type {
  IntelligenceEvaluationResult,
  IntelligenceRuleEvaluation,
  IntelligenceRuleGroupV1,
  IntelligenceRuleV1,
  IntelligenceSeverity,
  IntelligenceSignal,
  ValidatedIntelligenceFacts,
  ValidatedIntelligenceRuleSet,
} from "./types";

const SEVERITY_RANK: Readonly<Record<IntelligenceSeverity, number>> = Object.freeze({
  good: 0,
  info: 1,
  warning: 2,
  danger: 3,
});

function ruleOrder(
  groups: ReadonlyMap<string, IntelligenceRuleGroupV1>,
  left: IntelligenceRuleV1,
  right: IntelligenceRuleV1,
): number {
  return (groups.get(left.group)?.priority ?? 10_001) - (groups.get(right.group)?.priority ?? 10_001) ||
    left.priority - right.priority || compareAscii(left.code, right.code);
}

function signalOrder(left: IntelligenceSignal, right: IntelligenceSignal): number {
  return left.groupPriority - right.groupPriority ||
    left.rulePriority - right.rulePriority ||
    SEVERITY_RANK[right.severity] - SEVERITY_RANK[left.severity] ||
    compareAscii(left.ruleCode, right.ruleCode);
}

function conflictWinner(left: IntelligenceSignal, right: IntelligenceSignal): IntelligenceSignal {
  const ordered = signalOrder(left, right);
  return ordered <= 0 ? left : right;
}

function compare(rule: IntelligenceRuleV1, value: number): boolean {
  if (rule.operator === "lt") return value < (rule.threshold as number);
  if (rule.operator === "gt") return value > (rule.threshold as number);
  // JavaScript === deliberately treats -0 and 0 as equal. The parser also
  // normalises -0, matching PostgreSQL numeric/jsonb behaviour.
  if (rule.operator === "eq") return value === (rule.threshold as number);
  if (rule.operator === "ne") return value !== (rule.threshold as number);
  if (rule.operator === "between") {
    const [minimum, maximum] = rule.threshold as readonly [number, number];
    return value >= minimum && value <= maximum;
  }
  return false;
}

/**
 * Evaluate an already-validated set against already-validated facts.
 *
 * The engine is read-only: it emits signals and never fills, normalises or
 * mutates a vessel/cargo fact. Missing and explicit null have identical
 * semantics for the typed `missing` operator; all other operators report a
 * missing evaluation and do not match.
 */
export function evaluateIntelligence(
  ruleSet: ValidatedIntelligenceRuleSet,
  facts: ValidatedIntelligenceFacts,
): IntelligenceEvaluationResult {
  assertValidatedIntelligenceRuleSet(ruleSet);
  assertValidatedIntelligenceFacts(facts);
  const groups = new Map(ruleSet.groups.map((group) => [group.code, group]));
  const rules = [...ruleSet.rules].sort((left, right) => ruleOrder(groups, left, right));
  const evaluations: IntelligenceRuleEvaluation[] = [];
  const candidates: IntelligenceSignal[] = [];

  for (const rule of rules) {
    const group = groups.get(rule.group)!;
    const hasValue = Object.prototype.hasOwnProperty.call(facts.values, rule.field);
    const value = hasValue ? facts.values[rule.field] : undefined;

    if (!group.active || !rule.active) {
      evaluations.push(Object.freeze({ ruleCode: rule.code, status: "inactive", value, reason: "Rule or group is inactive" }));
      continue;
    }
    if (rule.entity !== facts.entity) {
      evaluations.push(Object.freeze({ ruleCode: rule.code, status: "inapplicable", value, reason: "Rule targets another entity" }));
      continue;
    }

    const missing = !hasValue || value === null;
    let matched: boolean;
    if (rule.operator === "missing") {
      matched = missing;
    } else if (missing) {
      evaluations.push(Object.freeze({ ruleCode: rule.code, status: "missing", value, reason: "Fact is absent or null" }));
      continue;
    } else {
      matched = compare(rule, value as number);
    }

    evaluations.push(Object.freeze({
      ruleCode: rule.code,
      status: matched ? "matched" : "not_matched",
      value,
      reason: matched ? "Condition matched" : "Condition did not match",
    }));
    if (matched) {
      candidates.push(Object.freeze({
        ruleCode: rule.code,
        group: rule.group,
        signalKey: rule.signalKey,
        entity: rule.entity,
        field: rule.field,
        severity: rule.severity,
        tag: rule.tag,
        message: rule.message,
        value,
        groupPriority: group.priority,
        rulePriority: rule.priority,
      }));
    }
  }

  const winners = new Map<string, IntelligenceSignal>();
  const suppressed = new Set<string>();
  for (const candidate of candidates) {
    const existing = winners.get(candidate.signalKey);
    if (!existing) {
      winners.set(candidate.signalKey, candidate);
      continue;
    }
    const winner = conflictWinner(existing, candidate);
    suppressed.add(winner === existing ? candidate.ruleCode : existing.ruleCode);
    winners.set(candidate.signalKey, winner);
  }

  return Object.freeze({
    signals: Object.freeze([...winners.values()].sort(signalOrder)),
    suppressedRuleCodes: Object.freeze([...suppressed].sort(compareAscii)),
    evaluations: Object.freeze(evaluations),
  });
}

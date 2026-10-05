import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import { canonicalIntelligenceRuleSet, hashIntelligenceRuleSet } from "../lib/intelligence/canonical";
import { evaluateIntelligence } from "../lib/intelligence/evaluate";
import { INTELLIGENCE_FIXTURES } from "../lib/intelligence/fixtures";
import {
  INTELLIGENCE_FIELD_CATALOGUE_GOLDEN,
  INTELLIGENCE_FIELD_CATALOGUE_SHA256,
  INTELLIGENCE_V1_EFFECTIVE_SEED,
  INTELLIGENCE_V1_EFFECTIVE_SHA256,
  INTELLIGENCE_V1_SEED_SHA256,
} from "../lib/intelligence/golden";
import {
  INTELLIGENCE_V1_SEED,
  INTELLIGENCE_V1_SEED_PROVENANCE,
} from "../lib/intelligence/seeds";
import {
  isValidatedIntelligenceFacts,
  isValidatedIntelligenceRuleSet,
  isValidatedIntelligenceRuleSetEnvelope,
} from "../lib/intelligence/trust";
import type {
  IntelligenceOperator,
  IntelligenceRuleGroupV1,
  IntelligenceRuleSetDocumentV1,
  IntelligenceRuleV1,
  ValidatedIntelligenceFacts,
  ValidatedIntelligenceRuleSet,
} from "../lib/intelligence/types";
import {
  parseIntelligenceFacts,
  parseIntelligenceRuleSet,
  parseIntelligenceRuleSetEnvelope,
  validateIntelligenceProvenance,
  verifyIntelligenceRuleSetEnvelope,
} from "../lib/intelligence/validate";

let passed = 0;
let failed = 0;

async function check(name: string, run: () => void | Promise<void>): Promise<void> {
  try {
    await run();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}`);
    console.error(error);
  }
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("non-finite number");
    if (Object.is(value, -0) || value === 0) return "0";
    const rendered = String(value);
    if (!/[eE]/.test(rendered)) return rendered;
    const [coefficient, rawExponent] = rendered.toLowerCase().split("e");
    const exponent = Number(rawExponent);
    const negative = coefficient.startsWith("-");
    const unsigned = negative ? coefficient.slice(1) : coefficient;
    const [integer, fraction = ""] = unsigned.split(".");
    const digits = integer + fraction;
    const point = integer.length + exponent;
    let expanded = point <= 0
      ? `0.${"0".repeat(-point)}${digits}`
      : point >= digits.length
        ? `${digits}${"0".repeat(point - digits.length)}`
        : `${digits.slice(0, point)}.${digits.slice(point)}`;
    expanded = expanded.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
    return negative ? `-${expanded}` : expanded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort((left, right) => left === right ? 0 : left < right ? -1 : 1);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
  }
  throw new TypeError(`unsupported ${typeof value}`);
}

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

const baseGroup: IntelligenceRuleGroupV1 = {
  code: "operators",
  name: "Operator semantics",
  description: null,
  scope: "cargo",
  active: true,
  priority: 10,
};

function operatorRule(
  code: string,
  operator: IntelligenceOperator,
  threshold: number | readonly [number, number] | null,
  priority: number,
): IntelligenceRuleV1 {
  return {
    code,
    group: baseGroup.code,
    entity: "cargo",
    field: "stowage_sf",
    operator,
    threshold,
    severity: "info",
    tag: code,
    message: `${code} governed operator fixture`,
    signalKey: `fixture.${code.toLowerCase()}`,
    active: true,
    priority,
  };
}

function ruleSet(
  rules: readonly IntelligenceRuleV1[],
  groups: readonly IntelligenceRuleGroupV1[] = [baseGroup],
): ValidatedIntelligenceRuleSet {
  return parseIntelligenceRuleSet({
    schemaVersion: 1,
    evaluatorVersion: "intelligence-v1",
    groups,
    rules,
  });
}

function evaluationStatuses(
  rules: ValidatedIntelligenceRuleSet,
  facts: ValidatedIntelligenceFacts,
): Record<string, string> {
  return Object.fromEntries(
    evaluateIntelligence(rules, facts).evaluations.map((evaluation) => [evaluation.ruleCode, evaluation.status]),
  );
}

async function main(): Promise<void> {
  await check("v1 full, effective and field-catalogue identities are pinned", async () => {
    assert.equal(await hashIntelligenceRuleSet(INTELLIGENCE_V1_SEED), INTELLIGENCE_V1_SEED_SHA256);
    assert.equal(await hashIntelligenceRuleSet(INTELLIGENCE_V1_EFFECTIVE_SEED), INTELLIGENCE_V1_EFFECTIVE_SHA256);
    assert.equal(sha256(INTELLIGENCE_FIELD_CATALOGUE_GOLDEN), INTELLIGENCE_FIELD_CATALOGUE_SHA256);
    assert.match(INTELLIGENCE_V1_SEED_SHA256, /^[a-f0-9]{64}$/);
    assert.match(INTELLIGENCE_V1_EFFECTIVE_SHA256, /^[a-f0-9]{64}$/);
    assert.match(INTELLIGENCE_FIELD_CATALOGUE_SHA256, /^[a-f0-9]{64}$/);
  });

  await check("SQL parity driver is pinned to the same three identities", () => {
    const sql = readFileSync("supabase/tests/rules/intelligence_cross_runtime_parity.sql", "utf8");
    for (const digest of [
      INTELLIGENCE_V1_SEED_SHA256,
      INTELLIGENCE_V1_EFFECTIVE_SHA256,
      INTELLIGENCE_FIELD_CATALOGUE_SHA256,
    ]) {
      assert.equal(sql.includes(digest), true, `SQL parity driver is missing ${digest}`);
    }
    assert.match(sql, /fn_intelligence_rule_set_document/);
    assert.match(sql, /fn_intelligence_effective_document/);
    assert.match(sql, /intelligence_rule_field_catalogue/);
  });

  await check("canonical identity is independent of caller array order", async () => {
    const reordered = parseIntelligenceRuleSet({
      ...INTELLIGENCE_FIXTURES.validRuleSet,
      groups: [...INTELLIGENCE_FIXTURES.validRuleSet.groups].reverse(),
      rules: [...INTELLIGENCE_FIXTURES.validRuleSet.rules].reverse(),
    });
    assert.equal(canonicalIntelligenceRuleSet(reordered), canonicalIntelligenceRuleSet(INTELLIGENCE_V1_SEED));
    assert.equal(await hashIntelligenceRuleSet(reordered), INTELLIGENCE_V1_SEED_SHA256);
  });

  await check("R-001 through R-010 retain identifiers, thresholds and inactive R-010", () => {
    const prototype = INTELLIGENCE_V1_SEED.rules.filter((rule) => rule.code.startsWith("R-"));
    assert.deepEqual(prototype.map((rule) => rule.code), [
      "R-001", "R-002", "R-003", "R-004", "R-005",
      "R-006", "R-007", "R-008", "R-009", "R-010",
    ]);
    assert.deepEqual(prototype.map((rule) => rule.threshold), [0.4, 1.4, 5000, 3, 25, 20, 28, null, 0, 4]);
    assert.equal(prototype.find((rule) => rule.code === "R-008")?.operator, "missing");
    assert.equal(prototype.find((rule) => rule.code === "R-010")?.active, false);
  });

  await check("public copy is evidence-neutral and original wording stays private", () => {
    const publicCopy = JSON.stringify(INTELLIGENCE_V1_SEED);
    assert.doesNotMatch(publicCopy, /below-market|above-average|auto-fill/i);
    assert.deepEqual(INTELLIGENCE_V1_SEED_PROVENANCE.map((entry) => entry.ruleCode), ["R-005", "R-007", "R-008"]);
    assert.match(INTELLIGENCE_V1_SEED_PROVENANCE[0].originalMessage, /Below-market/);
    assert.match(INTELLIGENCE_V1_SEED_PROVENANCE[1].originalMessage, /Above-average/);
    assert.match(INTELLIGENCE_V1_SEED_PROVENANCE[2].originalMessage, /auto-fill 0\.5 MT\/day/);
    assert.equal(validateIntelligenceProvenance(INTELLIGENCE_V1_SEED_PROVENANCE, INTELLIGENCE_V1_SEED).ok, true);
  });

  const operators = ruleSet([
    operatorRule("OP-LT", "lt", 10, 10),
    operatorRule("OP-GT", "gt", 10, 20),
    operatorRule("OP-EQ", "eq", 10, 30),
    operatorRule("OP-NE", "ne", 10, 40),
    operatorRule("OP-BETWEEN", "between", [10, 20], 50),
    operatorRule("OP-MISSING", "missing", null, 60),
  ]);

  await check("all six operators have explicit boundary semantics", () => {
    const atBoundary = evaluationStatuses(operators, parseIntelligenceFacts({ entity: "cargo", values: { stowage_sf: 10 } }));
    assert.deepEqual(atBoundary, {
      "OP-LT": "not_matched", "OP-GT": "not_matched", "OP-EQ": "matched",
      "OP-NE": "not_matched", "OP-BETWEEN": "matched", "OP-MISSING": "not_matched",
    });
    const inside = evaluationStatuses(operators, parseIntelligenceFacts({ entity: "cargo", values: { stowage_sf: 15 } }));
    assert.deepEqual(inside, {
      "OP-LT": "not_matched", "OP-GT": "matched", "OP-EQ": "not_matched",
      "OP-NE": "matched", "OP-BETWEEN": "matched", "OP-MISSING": "not_matched",
    });
    const below = evaluationStatuses(operators, parseIntelligenceFacts({ entity: "cargo", values: { stowage_sf: 9 } }));
    assert.deepEqual(below, {
      "OP-LT": "matched", "OP-GT": "not_matched", "OP-EQ": "not_matched",
      "OP-NE": "matched", "OP-BETWEEN": "not_matched", "OP-MISSING": "not_matched",
    });
  });

  await check("missing and explicit null are equivalent and never invent a value", () => {
    for (const values of [{}, { stowage_sf: null }]) {
      const statuses = evaluationStatuses(operators, parseIntelligenceFacts({ entity: "cargo", values }));
      assert.equal(statuses["OP-MISSING"], "matched");
      for (const code of ["OP-LT", "OP-GT", "OP-EQ", "OP-NE", "OP-BETWEEN"]) {
        assert.equal(statuses[code], "missing");
      }
    }
    const source = structuredClone(INTELLIGENCE_FIXTURES.vesselMissingFuel);
    const before = structuredClone(source);
    const result = evaluateIntelligence(INTELLIGENCE_V1_SEED, parseIntelligenceFacts(source));
    assert.equal(result.signals.some((signal) => signal.ruleCode === "R-008"), true);
    assert.deepEqual(source, before);
  });

  await check("conflicts use group, rule, severity and code ordering deterministically", () => {
    const groups: IntelligenceRuleGroupV1[] = [
      { code: "first", name: "First", description: null, scope: "cargo", active: true, priority: 10 },
      { code: "second", name: "Second", description: null, scope: "cargo", active: true, priority: 20 },
    ];
    const make = (code: string, group: string, priority: number, severity: "good" | "danger"): IntelligenceRuleV1 => ({
      code, group, entity: "cargo", field: "stowage_sf", operator: "gt", threshold: 1,
      severity, tag: code, message: `${code} conflict fixture`, signalKey: "fixture.conflict",
      active: true, priority,
    });
    const conflicts = ruleSet([
      make("CF-A", "first", 50, "good"),
      make("CF-B", "second", 1, "danger"),
      make("CF-C", "first", 60, "danger"),
      make("CF-D", "first", 50, "danger"),
    ], groups);
    const result = evaluateIntelligence(conflicts, parseIntelligenceFacts({ entity: "cargo", values: { stowage_sf: 2 } }));
    assert.deepEqual(result.signals.map((signal) => signal.ruleCode), ["CF-D"]);
    assert.deepEqual(result.suppressedRuleCodes, ["CF-A", "CF-B", "CF-C"]);
  });

  await check("inactive rules/groups are reported and framework groups stay empty", () => {
    const groups: IntelligenceRuleGroupV1[] = [
      { ...baseGroup, code: "active" },
      { ...baseGroup, code: "inactive", active: false, priority: 20 },
    ];
    const inactive = ruleSet([
      { ...operatorRule("IN-RULE", "gt", 1, 10), group: "active", active: false },
      { ...operatorRule("IN-GROUP", "gt", 1, 20), group: "inactive" },
    ], groups);
    const statuses = evaluationStatuses(inactive, parseIntelligenceFacts({ entity: "cargo", values: { stowage_sf: 2 } }));
    assert.deepEqual(statuses, { "IN-RULE": "inactive", "IN-GROUP": "inactive" });
    assert.throws(() => parseIntelligenceRuleSet({
      schemaVersion: 1,
      evaluatorVersion: "intelligence-v1",
      groups: [{ code: "future", name: "Future", description: null, scope: "framework", active: true, priority: 1 }],
      rules: [],
    }), /Framework placeholders must be inactive/);
    for (const code of ["compat", "portres", "agecrg", "freight", "comm"]) {
      const group = INTELLIGENCE_V1_SEED.groups.find((candidate) => candidate.code === code);
      assert.equal(group?.scope, "framework");
      assert.equal(group?.active, false);
      assert.equal(INTELLIGENCE_V1_SEED.rules.some((rule) => rule.group === code), false);
    }
  });

  await check("malformed schemas, executable keys and unsafe thresholds fail closed", () => {
    for (const fixture of [
      INTELLIGENCE_FIXTURES.invalidUnknownField,
      INTELLIGENCE_FIXTURES.invalidExecutableKey,
      INTELLIGENCE_FIXTURES.invalidThresholdPrecision,
      INTELLIGENCE_FIXTURES.duplicateRuleCode,
    ]) assert.throws(() => parseIntelligenceRuleSet(fixture));

    const accessor = structuredClone(INTELLIGENCE_FIXTURES.validRuleSet) as unknown as Record<string, unknown>;
    Object.defineProperty(accessor, "schemaVersion", { enumerable: true, get: () => 1 });
    assert.throws(() => parseIntelligenceRuleSet(accessor));
  });

  await check("Unicode length policy matches PostgreSQL character semantics", () => {
    const withFirstGroupName = (name: string): IntelligenceRuleSetDocumentV1 => ({
      ...INTELLIGENCE_FIXTURES.validRuleSet,
      groups: INTELLIGENCE_FIXTURES.validRuleSet.groups.map((group, index) =>
        index === 0 ? { ...group, name } : group),
    });
    assert.doesNotThrow(() => parseIntelligenceRuleSet(withFirstGroupName("🚀".repeat(120))));
    assert.throws(() => parseIntelligenceRuleSet(withFirstGroupName("🚀".repeat(121))));
    for (const invalid of ["contains\u0000nul", "lone\ud800surrogate"]) {
      assert.throws(() => parseIntelligenceRuleSet(withFirstGroupName(invalid)));
    }
  });

  await check("parser-issued runtime trust rejects forged brands", () => {
    const facts = parseIntelligenceFacts(INTELLIGENCE_FIXTURES.cargoBoundary);
    assert.equal(isValidatedIntelligenceRuleSet(INTELLIGENCE_V1_SEED), true);
    assert.equal(isValidatedIntelligenceFacts(facts), true);
    const forgedRules = structuredClone(INTELLIGENCE_V1_SEED) as unknown as ValidatedIntelligenceRuleSet;
    const forgedFacts = structuredClone(facts) as unknown as ValidatedIntelligenceFacts;
    assert.throws(() => evaluateIntelligence(forgedRules, facts), /parseIntelligenceRuleSet/);
    assert.throws(() => evaluateIntelligence(INTELLIGENCE_V1_SEED, forgedFacts), /parseIntelligenceFacts/);
    assert.throws(() => canonicalIntelligenceRuleSet(forgedRules), /parseIntelligenceRuleSet/);
  });

  await check("active envelope is trusted only after effective SHA verification", async () => {
    const valid = await parseIntelligenceRuleSetEnvelope({
      version: 1,
      ruleSetContentHash: INTELLIGENCE_V1_SEED_SHA256,
      effectiveContentHash: INTELLIGENCE_V1_EFFECTIVE_SHA256,
      document: INTELLIGENCE_V1_EFFECTIVE_SEED,
    });
    assert.equal(isValidatedIntelligenceRuleSetEnvelope(valid), true);
    assert.equal(await verifyIntelligenceRuleSetEnvelope(valid), true);
    await assert.rejects(() => parseIntelligenceRuleSetEnvelope({
      version: 1,
      ruleSetContentHash: INTELLIGENCE_V1_SEED_SHA256,
      effectiveContentHash: "0".repeat(64),
      document: INTELLIGENCE_V1_EFFECTIVE_SEED,
    }), /SHA-256 mismatch/);
  });

  await check("validated inputs and nested evaluator outputs are immutable", () => {
    const facts = parseIntelligenceFacts(INTELLIGENCE_FIXTURES.vesselOverdue);
    const result = evaluateIntelligence(INTELLIGENCE_V1_SEED, facts);
    assert.equal(Object.isFrozen(INTELLIGENCE_V1_SEED), true);
    assert.equal(Object.isFrozen(INTELLIGENCE_V1_SEED.groups[0]), true);
    assert.equal(Object.isFrozen(INTELLIGENCE_V1_SEED.rules[0]), true);
    assert.equal(Object.isFrozen(INTELLIGENCE_V1_SEED_PROVENANCE), true);
    assert.equal(Object.isFrozen(facts.values), true);
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.signals), true);
    assert.equal(Object.isFrozen(result.evaluations), true);
    assert.equal(Object.isFrozen(result.signals[0]), true);
    assert.equal(Object.isFrozen(result.evaluations[0]), true);
    assert.throws(() => {
      (result.signals[0] as unknown as { tag: string }).tag = "tampered";
    }, TypeError);
  });

  console.log(`intelligence-rules-check: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

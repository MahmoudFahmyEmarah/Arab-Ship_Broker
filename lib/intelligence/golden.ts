import { compareAscii } from "./canonical";
import { INTELLIGENCE_FIELDS } from "./fields";
import { INTELLIGENCE_V1_SEED } from "./seeds";
import type { IntelligenceRuleSetDocumentV1 } from "./types";
import { parseIntelligenceRuleSet } from "./validate";

/**
 * Frozen cross-runtime identities. SQL parity tests assert these same values;
 * changing one requires an explicit governed rule-version review.
 */
export const INTELLIGENCE_V1_SEED_SHA256 = "9822f365aac993cc1102106b73c90e76373178c14c448365bd685d54ffd28e9d";
export const INTELLIGENCE_V1_EFFECTIVE_SHA256 = "e22b26d9bdf086e1975431ee4110f206b15ac4f1c496deec47be46dc6bc8011d";
export const INTELLIGENCE_FIELD_CATALOGUE_SHA256 = "728835d8551c1ada72190191e0e0791ea0dd47dfc957c779d68eb0103b746b9c";

export const INTELLIGENCE_FIELD_CATALOGUE_GOLDEN = Object.freeze(
  Object.values(INTELLIGENCE_FIELDS)
    .map((definition) => Object.freeze({
      entity: definition.entity,
      field: definition.field,
      valueKind: "number" as const,
      allowedOperators: definition.allowedOperators,
      unit: definition.unit,
      label: definition.label,
      minimumThreshold: definition.minimumThreshold,
      maximumThreshold: definition.maximumThreshold,
      maximumDecimalPlaces: definition.maximumDecimalPlaces,
    }))
    .sort((left, right) =>
      compareAscii(left.entity, right.entity) || compareAscii(left.field, right.field)),
);

const effectiveRules = INTELLIGENCE_V1_SEED.rules.filter((rule) => {
  if (!rule.active) return false;
  const group = INTELLIGENCE_V1_SEED.groups.find((candidate) => candidate.code === rule.group);
  return Boolean(group?.active && group.scope !== "framework");
});
const referencedGroups = new Set(effectiveRules.map((rule) => rule.group));

const effectiveInput: IntelligenceRuleSetDocumentV1 = {
  schemaVersion: INTELLIGENCE_V1_SEED.schemaVersion,
  evaluatorVersion: INTELLIGENCE_V1_SEED.evaluatorVersion,
  groups: INTELLIGENCE_V1_SEED.groups.filter((group) =>
    group.active && group.scope !== "framework" && referencedGroups.has(group.code)),
  rules: effectiveRules,
};

/** Exact document returned to members by get_intelligence_rules(). */
export const INTELLIGENCE_V1_EFFECTIVE_SEED = parseIntelligenceRuleSet(effectiveInput);

import { parseIntelligenceRuleSet, validateIntelligenceProvenance } from "./validate";
import type { IntelligenceProvenanceEntryV1, IntelligenceRuleSetDocumentV1 } from "./types";

const INTELLIGENCE_V1_SEED_INPUT: IntelligenceRuleSetDocumentV1 = {
  schemaVersion: 1,
  evaluatorVersion: "intelligence-v1",
  groups: [
    { code: "core", name: "Core card intelligence", description: "Prototype R-001 through R-010, translated into typed read-only rules.", scope: "both", active: true, priority: 10 },
    { code: "compat", name: "Compatibility framework", description: "Reserved; no rules are published in v1.", scope: "framework", active: false, priority: 100 },
    { code: "portres", name: "Port restrictions framework", description: "Reserved; no rules are published in v1.", scope: "framework", active: false, priority: 110 },
    { code: "agecrg", name: "Age and cargo framework", description: "Reserved; no rules are published in v1.", scope: "framework", active: false, priority: 120 },
    { code: "freight", name: "Freight framework", description: "Reserved for a governed market reference; no rules are published in v1.", scope: "framework", active: false, priority: 130 },
    { code: "comm", name: "Commission framework", description: "Reserved; no rules are published in v1.", scope: "framework", active: false, priority: 140 },
  ],
  rules: [
    { code: "R-001", group: "core", entity: "cargo", field: "stowage_sf", operator: "lt", threshold: 0.4, severity: "warning", tag: "Heavy", message: "Heavy cargo, weight limits before volume.", signalKey: "cargo.core.stowage", active: true, priority: 10 },
    { code: "R-002", group: "core", entity: "cargo", field: "stowage_sf", operator: "gt", threshold: 1.4, severity: "info", tag: "Light", message: "Light cargo, volume check vs vessel hold cap.", signalKey: "cargo.core.stowage", active: true, priority: 20 },
    { code: "R-003", group: "core", entity: "cargo", field: "load_rate_mt_day", operator: "gt", threshold: 5000, severity: "good", tag: "Fast load", message: "High load rate, short port time, helps TCE.", signalKey: "cargo.core.load_rate", active: true, priority: 30 },
    { code: "R-004", group: "core", entity: "cargo", field: "laycan_days_remaining", operator: "lt", threshold: 3, severity: "danger", tag: "Urgent", message: "Laycan window closing, confirm vessel ASAP.", signalKey: "cargo.core.laycan", active: true, priority: 40 },
    { code: "R-005", group: "core", entity: "cargo", field: "freight_idea_usd_mt", operator: "lt", threshold: 25, severity: "warning", tag: "Rate review", message: "Freight idea is below the configured review threshold; verify it against an approved current market reference.", signalKey: "cargo.core.freight", active: true, priority: 50 },
    { code: "R-006", group: "core", entity: "vessel", field: "age_years", operator: "gt", threshold: 20, severity: "info", tag: "Older tonnage", message: "Charterer vetting may require attention.", signalKey: "vessel.core.age", active: true, priority: 60 },
    { code: "R-007", group: "core", entity: "vessel", field: "vlsfo_sea_mt_day", operator: "gt", threshold: 28, severity: "warning", tag: "Consumption review", message: "Declared VLSFO sea consumption exceeds the configured review threshold; confirm the figure and operating basis.", signalKey: "vessel.core.vlsfo", active: true, priority: 70 },
    { code: "R-008", group: "core", entity: "vessel", field: "lsmgo_sea_mt_day", operator: "missing", threshold: null, severity: "warning", tag: "Not declared", message: "LSMGO sea consumption is not declared; request and confirm the value before estimating.", signalKey: "vessel.core.lsmgo", active: true, priority: 80 },
    { code: "R-009", group: "core", entity: "vessel", field: "open_days_delta", operator: "lt", threshold: 0, severity: "danger", tag: "Overdue", message: "Open date passed, verify vessel still available.", signalKey: "vessel.core.open_date", active: true, priority: 90 },
    { code: "R-010", group: "core", entity: "cargo", field: "commission_pct", operator: "gt", threshold: 4, severity: "info", tag: "High comm", message: "Higher than typical, confirm if IAC or separate.", signalKey: "cargo.core.commission", active: false, priority: 100 },
  ],
};

const INTELLIGENCE_V1_SEED_PROVENANCE_INPUT: readonly IntelligenceProvenanceEntryV1[] = [
  {
    ruleCode: "R-005",
    sourceRef: "prototype:R-005",
    originalMessage: "Below-market rate, confirm vs current TC index.",
    note: "Published copy is evidence-neutral until a governed current market reference is available.",
  },
  {
    ruleCode: "R-007",
    sourceRef: "prototype:R-007",
    originalMessage: "Above-average burn, check ECO speed option.",
    note: "Published copy describes only the configured threshold and makes no unsupported market-average claim.",
  },
  {
    ruleCode: "R-008",
    sourceRef: "prototype:R-008",
    originalMessage: "Owner did not declare, auto-fill 0.5 MT/day.",
    note: "Published copy requests confirmation. The evaluator never invents or mutates a vessel fact.",
  },
];

export const INTELLIGENCE_V1_SEED = parseIntelligenceRuleSet(INTELLIGENCE_V1_SEED_INPUT);
/** Frozen, normalized document form for fixtures and publication clients. */
export const INTELLIGENCE_V1_SEED_DOCUMENT: IntelligenceRuleSetDocumentV1 = INTELLIGENCE_V1_SEED;

const provenanceValidation = validateIntelligenceProvenance(INTELLIGENCE_V1_SEED_PROVENANCE_INPUT, INTELLIGENCE_V1_SEED);
if (!provenanceValidation.ok) {
  throw new TypeError(provenanceValidation.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
}
export const INTELLIGENCE_V1_SEED_PROVENANCE = provenanceValidation.value!;

import type {
  ValidatedIntelligenceFacts,
  ValidatedIntelligenceRuleSet,
  ValidatedIntelligenceRuleSetEnvelope,
} from "./types";

// TypeScript brands disappear at runtime. Parser-issued identities keep casts
// from bypassing the governed validation boundary.
const parserIssuedRuleSets = new WeakSet<object>();
const parserIssuedFacts = new WeakSet<object>();
const parserIssuedEnvelopes = new WeakSet<object>();

export function markValidatedIntelligenceRuleSet<T extends object>(
  value: T,
): T & ValidatedIntelligenceRuleSet {
  parserIssuedRuleSets.add(value);
  return value as T & ValidatedIntelligenceRuleSet;
}

export function markValidatedIntelligenceFacts<T extends object>(
  value: T,
): T & ValidatedIntelligenceFacts {
  parserIssuedFacts.add(value);
  return value as T & ValidatedIntelligenceFacts;
}

export function markValidatedIntelligenceRuleSetEnvelope<T extends object>(
  value: T,
): T & ValidatedIntelligenceRuleSetEnvelope {
  parserIssuedEnvelopes.add(value);
  return value as T & ValidatedIntelligenceRuleSetEnvelope;
}

export function isValidatedIntelligenceRuleSet(
  value: unknown,
): value is ValidatedIntelligenceRuleSet {
  return value !== null && typeof value === "object" && parserIssuedRuleSets.has(value);
}

export function isValidatedIntelligenceFacts(
  value: unknown,
): value is ValidatedIntelligenceFacts {
  return value !== null && typeof value === "object" && parserIssuedFacts.has(value);
}

export function isValidatedIntelligenceRuleSetEnvelope(
  value: unknown,
): value is ValidatedIntelligenceRuleSetEnvelope {
  return value !== null && typeof value === "object" && parserIssuedEnvelopes.has(value);
}

export function assertValidatedIntelligenceRuleSet(
  value: unknown,
): asserts value is ValidatedIntelligenceRuleSet {
  if (!isValidatedIntelligenceRuleSet(value)) {
    throw new TypeError("Intelligence rules must be created by parseIntelligenceRuleSet");
  }
}

export function assertValidatedIntelligenceFacts(
  value: unknown,
): asserts value is ValidatedIntelligenceFacts {
  if (!isValidatedIntelligenceFacts(value)) {
    throw new TypeError("Intelligence facts must be created by parseIntelligenceFacts");
  }
}

export function assertValidatedIntelligenceRuleSetEnvelope(
  value: unknown,
): asserts value is ValidatedIntelligenceRuleSetEnvelope {
  if (!isValidatedIntelligenceRuleSetEnvelope(value)) {
    throw new TypeError("Intelligence rule envelope must be created by parseIntelligenceRuleSetEnvelope");
  }
}

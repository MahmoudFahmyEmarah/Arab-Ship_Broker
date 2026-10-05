import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { throwAppRpcError } from "./rpc-error";

import {
  hashIntelligenceRuleSet,
  parseIntelligenceRuleSet,
  validateIntelligenceProvenance,
  type IntelligenceProvenanceEntryV1,
  type ValidatedIntelligenceRuleSet,
} from "@/lib/intelligence";

export interface IntelligenceVersionSummary {
  ruleSetId: string;
  version: number;
  label: string;
  contentHash: string;
  schemaVersion: number;
  evaluatorVersion: string;
  basedOnId: string | null;
  changeNote: string;
  createdBy: string | null;
  createdAt: string;
  groupCount: number;
  ruleCount: number;
  isActive: boolean;
}

export interface IntelligenceRuleSetsOverview {
  activeRuleSetId: string | null;
  revision: number;
  versions: IntelligenceVersionSummary[];
}

export interface IntelligenceRuleSetDetail {
  ruleSetId: string;
  version: number;
  label: string;
  contentHash: string;
  changeNote: string;
  basedOnId: string | null;
  createdBy: string | null;
  createdAt: string;
  document: ValidatedIntelligenceRuleSet;
  provenance: readonly IntelligenceProvenanceEntryV1[];
}

export interface IntelligenceCloneInput {
  basedOnId: string;
  suggestedLabel: string;
  document: ValidatedIntelligenceRuleSet;
  provenance: readonly IntelligenceProvenanceEntryV1[];
}

export interface IntelligenceChangeSet {
  added: string[];
  removed: string[];
  changed: string[];
}

export interface IntelligenceRuleSetDiff {
  leftRuleSetId: string;
  rightRuleSetId: string;
  groups: IntelligenceChangeSet;
  rules: IntelligenceChangeSet;
  provenance: IntelligenceChangeSet;
}

export interface IntelligenceEvent {
  id: number;
  action: string;
  rule_set_id: string | null;
  version_no: number | null;
  actor_user_id: string | null;
  request_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface IntelligenceCreateResult {
  ruleSetId: string;
  version: number;
  contentHash: string;
  schemaVersion: number;
  evaluatorVersion: string;
}

export interface IntelligenceActivationResult {
  ruleSetId: string;
  version: number;
  contentHash: string;
  revision: number;
  status: "active" | "already_active";
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} returned an invalid object.`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} returned an invalid string.`);
  return value;
}

function uuid(value: unknown, name: string): string {
  const candidate = string(value, name);
  if (!UUID_RE.test(candidate)) throw new TypeError(`${name} returned an invalid UUID.`);
  return candidate;
}

function nullableUuid(value: unknown, name: string): string | null {
  return value === null ? null : uuid(value, name);
}

function sameUuid(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function assertSameUuid(actual: string, expected: string, name: string): void {
  if (!sameUuid(actual, expected)) {
    throw new TypeError(`${name} returned an ID that does not match the request.`);
  }
}

function sha256(value: unknown, name: string): string {
  const digest = string(value, name);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${name} returned an invalid SHA-256 digest.`);
  }
  return digest;
}

function isoDateTime(value: unknown, name: string): string {
  const text = string(value, name);
  if (!Number.isFinite(Date.parse(text))) {
    throw new TypeError(`${name} returned an invalid timestamp.`);
  }
  return text;
}

function integer(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${name} returned an invalid integer.`);
  }
  return value as number;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${name} returned an invalid boolean.`);
  return value;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new TypeError(`${name} returned an invalid string array.`);
  }
  return [...value];
}

function parseProvenance(
  value: unknown,
  document: ValidatedIntelligenceRuleSet,
): readonly IntelligenceProvenanceEntryV1[] {
  const result = validateIntelligenceProvenance(value, document);
  if (!result.ok || !result.value) {
    throw new TypeError(
      result.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ") ||
        "Invalid intelligence provenance.",
    );
  }
  return result.value;
}

function parseVersion(value: unknown): IntelligenceVersionSummary {
  const item = record(value, "Rule-set list");
  const parsed: IntelligenceVersionSummary = {
    ruleSetId: uuid(item.ruleSetId, "Rule-set list"),
    version: integer(item.version, "Rule-set list", 1),
    label: string(item.label, "Rule-set list"),
    contentHash: sha256(item.contentHash, "Rule-set list"),
    schemaVersion: integer(item.schemaVersion, "Rule-set list", 1),
    evaluatorVersion: string(item.evaluatorVersion, "Rule-set list"),
    basedOnId: nullableUuid(item.basedOnId, "Rule-set list"),
    changeNote: string(item.changeNote, "Rule-set list"),
    createdBy: nullableUuid(item.createdBy, "Rule-set list"),
    createdAt: isoDateTime(item.createdAt, "Rule-set list"),
    groupCount: integer(item.groupCount, "Rule-set list", 0),
    ruleCount: integer(item.ruleCount, "Rule-set list", 0),
    isActive: boolean(item.isActive, "Rule-set list"),
  };
  if (parsed.schemaVersion !== 1 || parsed.evaluatorVersion !== "intelligence-v1") {
    throw new TypeError("Rule-set list returned an unsupported schema or evaluator version.");
  }
  if (parsed.basedOnId && sameUuid(parsed.ruleSetId, parsed.basedOnId)) {
    throw new TypeError("Rule-set list returned a self-referencing based-on ID.");
  }
  return parsed;
}

async function parseDetail(
  value: unknown,
  expectedRuleSetId?: string,
): Promise<IntelligenceRuleSetDetail> {
  const item = record(value, "Rule-set detail");
  const document = parseIntelligenceRuleSet(item.document);
  const detail: IntelligenceRuleSetDetail = {
    ruleSetId: uuid(item.ruleSetId, "Rule-set detail"),
    version: integer(item.version, "Rule-set detail", 1),
    label: string(item.label, "Rule-set detail"),
    contentHash: sha256(item.contentHash, "Rule-set detail"),
    changeNote: string(item.changeNote, "Rule-set detail"),
    basedOnId: nullableUuid(item.basedOnId, "Rule-set detail"),
    createdBy: nullableUuid(item.createdBy, "Rule-set detail"),
    createdAt: isoDateTime(item.createdAt, "Rule-set detail"),
    document,
    provenance: parseProvenance(item.provenance, document),
  };
  if (expectedRuleSetId) assertSameUuid(detail.ruleSetId, expectedRuleSetId, "Rule-set detail");
  if (detail.basedOnId && sameUuid(detail.ruleSetId, detail.basedOnId)) {
    throw new TypeError("Rule-set detail returned a self-referencing based-on ID.");
  }
  const computedHash = await hashIntelligenceRuleSet(document);
  if (computedHash !== detail.contentHash) {
    throw new TypeError("Rule-set detail returned a content hash that does not match its document.");
  }
  return detail;
}

function parseChangeSet(value: unknown, name: string): IntelligenceChangeSet {
  const item = record(value, name);
  return {
    added: stringArray(item.added, name),
    removed: stringArray(item.removed, name),
    changed: stringArray(item.changed, name),
  };
}

async function rpc<T>(
  supabase: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  parse: (value: unknown) => T | Promise<T>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throwAppRpcError(name, error);
  return await parse(data);
}

export async function listIntelligenceRuleSets(
  supabase: SupabaseClient,
  actorId: string,
): Promise<IntelligenceRuleSetsOverview> {
  uuid(actorId, "Rule-set overview actor");
  return rpc(supabase, "admin_intelligence_list_rule_sets", { p_actor: actorId }, (value) => {
    const item = record(value, "Rule-set overview");
    if (!Array.isArray(item.versions)) throw new TypeError("Rule-set overview returned an invalid version list.");
    const overview: IntelligenceRuleSetsOverview = {
      activeRuleSetId: nullableUuid(item.activeRuleSetId, "Rule-set overview"),
      revision: integer(item.revision, "Rule-set overview", 0),
      versions: item.versions.map(parseVersion),
    };
    const ids = new Set<string>();
    const versions = new Set<number>();
    for (const version of overview.versions) {
      const normalizedId = version.ruleSetId.toLowerCase();
      if (ids.has(normalizedId) || versions.has(version.version)) {
        throw new TypeError("Rule-set overview returned duplicate rule-set or version identities.");
      }
      ids.add(normalizedId);
      versions.add(version.version);
    }
    const activeVersions = overview.versions.filter((version) => version.isActive);
    if (overview.activeRuleSetId === null) {
      if (activeVersions.length !== 0) {
        throw new TypeError("Rule-set overview marked an active version without an active rule-set ID.");
      }
    } else if (
      activeVersions.length !== 1 ||
      !sameUuid(activeVersions[0].ruleSetId, overview.activeRuleSetId)
    ) {
      throw new TypeError("Rule-set overview returned inconsistent active rule-set state.");
    }
    for (const version of overview.versions) {
      if (version.basedOnId && !ids.has(version.basedOnId.toLowerCase())) {
        throw new TypeError("Rule-set overview returned an unknown based-on rule-set ID.");
      }
    }
    return overview;
  });
}

export async function getIntelligenceRuleSet(
  supabase: SupabaseClient,
  actorId: string,
  ruleSetId: string,
): Promise<IntelligenceRuleSetDetail> {
  uuid(actorId, "Rule-set detail actor");
  uuid(ruleSetId, "Rule-set detail request");
  return rpc(
    supabase,
    "admin_intelligence_get_rule_set",
    { p_actor: actorId, p_rule_set_id: ruleSetId },
    (value) => parseDetail(value, ruleSetId),
  );
}

export async function getIntelligenceCloneInput(
  supabase: SupabaseClient,
  actorId: string,
  ruleSetId: string,
): Promise<IntelligenceCloneInput> {
  uuid(actorId, "Clone input actor");
  uuid(ruleSetId, "Clone input request");
  const clone = await rpc(
    supabase,
    "admin_intelligence_get_clone_input",
    { p_actor: actorId, p_rule_set_id: ruleSetId },
    (value) => {
      const item = record(value, "Clone input");
      const document = parseIntelligenceRuleSet(item.document);
      const parsedClone = {
        basedOnId: uuid(item.basedOnId, "Clone input"),
        suggestedLabel: string(item.suggestedLabel, "Clone input"),
        document,
        provenance: parseProvenance(item.provenance, document),
      };
      assertSameUuid(parsedClone.basedOnId, ruleSetId, "Clone input");
      return parsedClone;
    },
  );
  const source = await getIntelligenceRuleSet(supabase, actorId, ruleSetId);
  const cloneHash = await hashIntelligenceRuleSet(clone.document);
  if (
    cloneHash !== source.contentHash ||
    JSON.stringify(clone.provenance) !== JSON.stringify(source.provenance)
  ) {
    throw new TypeError("Clone input does not match the immutable source rule set.");
  }
  return clone;
}

export async function diffIntelligenceRuleSets(
  supabase: SupabaseClient,
  actorId: string,
  leftRuleSetId: string,
  rightRuleSetId: string,
): Promise<IntelligenceRuleSetDiff> {
  uuid(actorId, "Rule-set diff actor");
  uuid(leftRuleSetId, "Left rule-set diff request");
  uuid(rightRuleSetId, "Right rule-set diff request");
  return rpc(
    supabase,
    "admin_intelligence_diff_rule_sets",
    {
      p_actor: actorId,
      p_left_rule_set_id: leftRuleSetId,
      p_right_rule_set_id: rightRuleSetId,
    },
    (value) => {
      const item = record(value, "Rule-set diff");
      const diff = {
        leftRuleSetId: string(item.leftRuleSetId, "Rule-set diff"),
        rightRuleSetId: string(item.rightRuleSetId, "Rule-set diff"),
        groups: parseChangeSet(item.groups, "Group diff"),
        rules: parseChangeSet(item.rules, "Rule diff"),
        provenance: parseChangeSet(item.provenance, "Provenance diff"),
      };
      assertSameUuid(uuid(diff.leftRuleSetId, "Rule-set diff"), leftRuleSetId, "Rule-set diff");
      assertSameUuid(uuid(diff.rightRuleSetId, "Rule-set diff"), rightRuleSetId, "Rule-set diff");
      return diff;
    },
  );
}

export async function listIntelligenceEvents(
  supabase: SupabaseClient,
  actorId: string,
  limit = 100,
): Promise<IntelligenceEvent[]> {
  uuid(actorId, "Event history actor");
  return rpc(
    supabase,
    "admin_intelligence_list_events",
    { p_actor: actorId, p_limit: limit },
    (value) => {
      if (!Array.isArray(value)) throw new TypeError("Event history returned an invalid list.");
      return value.map((candidate) => {
        const item = record(candidate, "Event history");
        const state = (entry: unknown): Record<string, unknown> | null =>
          entry === null ? null : record(entry, "Event history");
        return {
          id: integer(item.id, "Event history", 1),
          action: string(item.action, "Event history"),
          rule_set_id: nullableUuid(item.rule_set_id, "Event history"),
          version_no: item.version_no === null ? null : integer(item.version_no, "Event history", 1),
          actor_user_id: nullableUuid(item.actor_user_id, "Event history"),
          request_id: nullableUuid(item.request_id, "Event history"),
          before_state: state(item.before_state),
          after_state: state(item.after_state),
          metadata: state(item.metadata),
          created_at: isoDateTime(item.created_at, "Event history"),
        };
      });
    },
  );
}

export async function createIntelligenceRuleSet(
  supabase: SupabaseClient,
  input: {
    actorId: string;
    document: ValidatedIntelligenceRuleSet;
    provenance: readonly IntelligenceProvenanceEntryV1[];
    label: string;
    changeNote: string;
    basedOnId: string | null;
    requestId: string;
  },
): Promise<IntelligenceCreateResult> {
  uuid(input.actorId, "Create rule-set actor");
  uuid(input.requestId, "Create rule-set request");
  if (input.basedOnId !== null) uuid(input.basedOnId, "Create rule-set based-on ID");
  parseProvenance(input.provenance, input.document);
  const expectedHash = await hashIntelligenceRuleSet(input.document);
  const result = await rpc(
    supabase,
    "admin_intelligence_create_rule_set",
    {
      p_actor: input.actorId,
      p_document: input.document,
      p_provenance: input.provenance,
      p_label: input.label,
      p_change_note: input.changeNote,
      p_based_on_id: input.basedOnId,
      p_request_id: input.requestId,
    },
    (value) => {
      const item = record(value, "Create rule set");
      const result: IntelligenceCreateResult = {
        ruleSetId: uuid(item.ruleSetId, "Create rule set"),
        version: integer(item.version, "Create rule set", 1),
        contentHash: sha256(item.contentHash, "Create rule set"),
        schemaVersion: integer(item.schemaVersion, "Create rule set", 1),
        evaluatorVersion: string(item.evaluatorVersion, "Create rule set"),
      };
      if (
        result.contentHash !== expectedHash ||
        result.schemaVersion !== input.document.schemaVersion ||
        result.evaluatorVersion !== input.document.evaluatorVersion
      ) {
        throw new TypeError("Create rule set returned metadata that does not match the submitted document.");
      }
      return result;
    },
  );
  const detail = await getIntelligenceRuleSet(supabase, input.actorId, result.ruleSetId);
  if (detail.version !== result.version || detail.contentHash !== result.contentHash) {
    throw new TypeError("Create rule set returned an ID or version that does not match the immutable rule set.");
  }
  return result;
}

export async function activateIntelligenceRuleSet(
  supabase: SupabaseClient,
  input: {
    actorId: string;
    ruleSetId: string;
    expectedRevision: number;
    requestId: string;
  },
): Promise<IntelligenceActivationResult> {
  uuid(input.actorId, "Activate rule-set actor");
  uuid(input.ruleSetId, "Activate rule-set ID");
  uuid(input.requestId, "Activate rule-set request");
  integer(input.expectedRevision, "Activate rule-set revision", 0);
  const result = await rpc(
    supabase,
    "admin_intelligence_activate_rule_set",
    {
      p_actor: input.actorId,
      p_rule_set_id: input.ruleSetId,
      p_expected_revision: input.expectedRevision,
      p_request_id: input.requestId,
    },
    (value) => {
      const item = record(value, "Activate rule set");
      const status = string(item.status, "Activate rule set");
      if (status !== "active" && status !== "already_active") {
        throw new TypeError("Activate rule set returned an invalid status.");
      }
      const activation: IntelligenceActivationResult = {
        ruleSetId: uuid(item.ruleSetId, "Activate rule set"),
        version: integer(item.version, "Activate rule set", 1),
        contentHash: sha256(item.contentHash, "Activate rule set"),
        revision: integer(item.revision, "Activate rule set", 0),
        status,
      };
      assertSameUuid(activation.ruleSetId, input.ruleSetId, "Activate rule set");
      if (activation.status === "already_active" && activation.revision !== input.expectedRevision) {
        throw new TypeError("Activate rule set returned an inconsistent no-op revision.");
      }
      if (activation.status === "active" && activation.revision !== input.expectedRevision + 1) {
        throw new TypeError("Activate rule set returned an inconsistent activation revision.");
      }
      return activation;
    },
  );
  const detail = await getIntelligenceRuleSet(supabase, input.actorId, input.ruleSetId);
  if (detail.version !== result.version || detail.contentHash !== result.contentHash) {
    throw new TypeError("Activate rule set returned a version or content hash that does not match the immutable rule set.");
  }
  return result;
}

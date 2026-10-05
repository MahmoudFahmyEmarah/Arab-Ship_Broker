import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { throwAppRpcError } from "./rpc-error";

import {
  parseMatchingRulesV1,
  type ValidatedMatchingRulesV1,
} from "@/lib/matching-rules";
import { matchingRulesSha256 } from "@/lib/matching-rules/hash.server";

export interface MatchingRuleVersion {
  id: string;
  versionNo: number;
  schemaVersion: number;
  evaluatorVersion: string;
  params: ValidatedMatchingRulesV1;
  paramsSha256: string;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface MatchingRuleState {
  activeVersionId: string;
  previousVersionId: string | null;
  activationSequence: number;
  activatedBy: string | null;
  activatedAt: string;
  asOfYear: number;
}

export interface MatchingRuleEvent {
  id: number;
  eventType: string;
  versionId: string | null;
  priorVersionId: string | null;
  requestId: string | null;
  actorId: string | null;
  paramsSha256: string | null;
  candidateCount: number | null;
  candidateSha256: string | null;
  sourceSha256: string | null;
  asOfYear: number | null;
  detail: Record<string, unknown>;
  occurredAt: string;
}

export interface MatchingRulesDashboard {
  state: MatchingRuleState;
  activeVersion: MatchingRuleVersion;
  previousVersion: MatchingRuleVersion | null;
  versionHistory: MatchingRuleVersion[];
  recentEvents: MatchingRuleEvent[];
}

export interface MatchingRulesPreview {
  activeVersionId: string;
  asOfYear: number;
  activeParamsSha256: string;
  proposedParams: ValidatedMatchingRulesV1;
  proposedParamsSha256: string;
  currentCandidateCount: number;
  proposedCandidateCount: number;
  addedCount: number;
  removedCount: number;
}

export interface MatchingRuleCreateResult {
  requestId: string;
  versionId: string;
  versionNo: number;
  schemaVersion: number;
  evaluatorVersion: string;
  paramsSha256: string;
}

export interface MatchingRuleActivationResult {
  requestId: string;
  versionId: string;
  previousVersionId: string;
  versionNo: number;
  candidateCount: number;
  candidateSha256: string;
  sourceSha256: string;
  asOfYear: number;
  paramsSha256: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_RE = /^[0-9a-f]{64}$/;

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} returned an invalid object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} returned an invalid string.`);
  return value;
}

function nullableText(value: unknown, name: string): string | null {
  return value === null ? null : text(value, name);
}

function uuid(value: unknown, name: string): string {
  const candidate = text(value, name);
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
  const candidate = text(value, name);
  if (!SHA256_RE.test(candidate)) throw new TypeError(`${name} returned an invalid SHA-256 digest.`);
  return candidate;
}

function nullableSha256(value: unknown, name: string): string | null {
  return value === null ? null : sha256(value, name);
}

function integer(value: unknown, name: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new TypeError(`${name} returned an invalid integer.`);
  }
  return value as number;
}

function nullableInteger(value: unknown, name: string, minimum = 0): number | null {
  return value === null ? null : integer(value, name, minimum);
}

function timestamp(value: unknown, name: string): string {
  const candidate = text(value, name);
  if (!Number.isFinite(Date.parse(candidate))) {
    throw new TypeError(`${name} returned an invalid timestamp.`);
  }
  return candidate;
}

function parseVersion(value: unknown, name = "Matching rule version"): MatchingRuleVersion {
  const item = record(value, name);
  const version: MatchingRuleVersion = {
    id: uuid(item.id, name),
    versionNo: integer(item.versionNo, name, 1),
    schemaVersion: integer(item.schemaVersion, name, 1),
    evaluatorVersion: text(item.evaluatorVersion, name),
    params: parseMatchingRulesV1(item.params),
    paramsSha256: sha256(item.paramsSha256, name),
    note: nullableText(item.note, name),
    createdBy: nullableUuid(item.createdBy, name),
    createdAt: timestamp(item.createdAt, name),
  };
  if (version.schemaVersion !== version.params.schemaVersion || version.evaluatorVersion !== "matching-v1") {
    throw new TypeError(`${name} returned unsupported schema or evaluator metadata.`);
  }
  const computedHash = matchingRulesSha256(version.params);
  if (computedHash !== version.paramsSha256) {
    throw new TypeError(`${name} returned a parameter hash that does not match its document.`);
  }
  return version;
}

function parseEvent(value: unknown): MatchingRuleEvent {
  const item = record(value, "Matching rule event");
  return {
    id: integer(item.id, "Matching rule event", 1),
    eventType: text(item.eventType, "Matching rule event"),
    versionId: nullableUuid(item.versionId, "Matching rule event"),
    priorVersionId: nullableUuid(item.priorVersionId, "Matching rule event"),
    requestId: nullableUuid(item.requestId, "Matching rule event"),
    actorId: nullableUuid(item.actorId, "Matching rule event"),
    paramsSha256: nullableSha256(item.paramsSha256, "Matching rule event"),
    candidateCount: nullableInteger(item.candidateCount, "Matching rule event"),
    candidateSha256: nullableSha256(item.candidateSha256, "Matching rule event"),
    sourceSha256: nullableSha256(item.sourceSha256, "Matching rule event"),
    asOfYear: nullableInteger(item.asOfYear, "Matching rule event", 1900),
    detail: record(item.detail, "Matching rule event detail"),
    occurredAt: timestamp(item.occurredAt, "Matching rule event"),
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

function sameVersion(left: MatchingRuleVersion, right: MatchingRuleVersion): boolean {
  return sameUuid(left.id, right.id) &&
    left.versionNo === right.versionNo &&
    left.schemaVersion === right.schemaVersion &&
    left.evaluatorVersion === right.evaluatorVersion &&
    left.paramsSha256 === right.paramsSha256 &&
    left.note === right.note &&
    left.createdBy?.toLowerCase() === right.createdBy?.toLowerCase() &&
    left.createdAt === right.createdAt;
}

export async function getMatchingRulesDashboard(
  supabase: SupabaseClient,
  actorId: string,
): Promise<MatchingRulesDashboard> {
  uuid(actorId, "Matching rules dashboard actor");
  return rpc(supabase, "admin_matching_rules_dashboard", { p_actor: actorId }, (value) => {
    const item = record(value, "Matching rules dashboard");
    const state = record(item.state, "Matching rule state");
    if (!Array.isArray(item.versionHistory) || !Array.isArray(item.recentEvents)) {
      throw new TypeError("Matching rules dashboard returned invalid history data.");
    }
    const dashboard: MatchingRulesDashboard = {
      state: {
        activeVersionId: uuid(state.activeVersionId, "Matching rule state"),
        previousVersionId: nullableUuid(state.previousVersionId, "Matching rule state"),
        activationSequence: integer(state.activationSequence, "Matching rule state"),
        activatedBy: nullableUuid(state.activatedBy, "Matching rule state"),
        activatedAt: timestamp(state.activatedAt, "Matching rule state"),
        asOfYear: integer(state.asOfYear, "Matching rule state", 1900),
      },
      activeVersion: parseVersion(item.activeVersion, "Active matching rule version"),
      previousVersion: item.previousVersion === null
        ? null
        : parseVersion(item.previousVersion, "Previous matching rule version"),
      versionHistory: item.versionHistory.map((entry) => parseVersion(entry)),
      recentEvents: item.recentEvents.map(parseEvent),
    };
    if (!sameUuid(dashboard.activeVersion.id, dashboard.state.activeVersionId)) {
      throw new TypeError("Matching rules dashboard returned an active version that does not match its state pointer.");
    }
    if (dashboard.state.previousVersionId === null) {
      if (dashboard.previousVersion !== null) {
        throw new TypeError("Matching rules dashboard returned a previous version without a state pointer.");
      }
    } else if (
      dashboard.previousVersion === null ||
      !sameUuid(dashboard.previousVersion.id, dashboard.state.previousVersionId)
    ) {
      throw new TypeError("Matching rules dashboard returned an inconsistent previous version pointer.");
    }
    if (
      dashboard.state.previousVersionId !== null &&
      sameUuid(dashboard.state.activeVersionId, dashboard.state.previousVersionId)
    ) {
      throw new TypeError("Matching rules dashboard returned the same active and previous version IDs.");
    }

    const historyIds = new Set<string>();
    const historyNumbers = new Set<number>();
    for (const version of dashboard.versionHistory) {
      const normalizedId = version.id.toLowerCase();
      if (historyIds.has(normalizedId) || historyNumbers.has(version.versionNo)) {
        throw new TypeError("Matching rules dashboard returned duplicate version identities.");
      }
      historyIds.add(normalizedId);
      historyNumbers.add(version.versionNo);
      if (sameUuid(version.id, dashboard.activeVersion.id) && !sameVersion(version, dashboard.activeVersion)) {
        throw new TypeError("Matching rules dashboard returned conflicting active-version history metadata.");
      }
      if (
        dashboard.previousVersion &&
        sameUuid(version.id, dashboard.previousVersion.id) &&
        !sameVersion(version, dashboard.previousVersion)
      ) {
        throw new TypeError("Matching rules dashboard returned conflicting previous-version history metadata.");
      }
    }
    return dashboard;
  });
}

export async function previewMatchingRules(
  supabase: SupabaseClient,
  actorId: string,
  params: ValidatedMatchingRulesV1,
): Promise<MatchingRulesPreview> {
  uuid(actorId, "Matching rules preview actor");
  const expectedParamsSha256 = matchingRulesSha256(params);
  return rpc(
    supabase,
    "admin_matching_preview",
    { p_actor: actorId, p_params: params },
    (value) => {
      const item = record(value, "Matching rules preview");
      const preview: MatchingRulesPreview = {
        activeVersionId: uuid(item.activeVersionId, "Matching rules preview"),
        asOfYear: integer(item.asOfYear, "Matching rules preview", 1900),
        activeParamsSha256: sha256(item.activeParamsSha256, "Matching rules preview"),
        proposedParams: parseMatchingRulesV1(item.proposedParams),
        proposedParamsSha256: sha256(item.proposedParamsSha256, "Matching rules preview"),
        currentCandidateCount: integer(item.currentCandidateCount, "Matching rules preview"),
        proposedCandidateCount: integer(item.proposedCandidateCount, "Matching rules preview"),
        addedCount: integer(item.addedCount, "Matching rules preview"),
        removedCount: integer(item.removedCount, "Matching rules preview"),
      };
      const computedProposedHash = matchingRulesSha256(preview.proposedParams);
      if (
        preview.proposedParamsSha256 !== computedProposedHash ||
        preview.proposedParamsSha256 !== expectedParamsSha256
      ) {
        throw new TypeError("Matching rules preview returned parameters or a hash that do not match the request.");
      }
      if (
        preview.proposedCandidateCount !==
        preview.currentCandidateCount + preview.addedCount - preview.removedCount
      ) {
        throw new TypeError("Matching rules preview returned inconsistent candidate deltas.");
      }
      return preview;
    },
  );
}

export async function createMatchingRuleVersion(
  supabase: SupabaseClient,
  input: {
    actorId: string;
    requestId: string;
    params: ValidatedMatchingRulesV1;
    note: string;
  },
): Promise<MatchingRuleCreateResult> {
  uuid(input.actorId, "Create matching rule version actor");
  uuid(input.requestId, "Create matching rule version request");
  const expectedParamsSha256 = matchingRulesSha256(input.params);
  return rpc(
    supabase,
    "matching_create_rule_version",
    {
      p_actor: input.actorId,
      p_request_id: input.requestId,
      p_params: input.params,
      p_note: input.note,
    },
    (value) => {
      const item = record(value, "Create matching rule version");
      const result: MatchingRuleCreateResult = {
        requestId: uuid(item.requestId, "Create matching rule version"),
        versionId: uuid(item.versionId, "Create matching rule version"),
        versionNo: integer(item.versionNo, "Create matching rule version", 1),
        schemaVersion: integer(item.schemaVersion, "Create matching rule version", 1),
        evaluatorVersion: text(item.evaluatorVersion, "Create matching rule version"),
        paramsSha256: sha256(item.paramsSha256, "Create matching rule version"),
      };
      assertSameUuid(result.requestId, input.requestId, "Create matching rule version");
      if (
        result.paramsSha256 !== expectedParamsSha256 ||
        result.schemaVersion !== input.params.schemaVersion ||
        result.evaluatorVersion !== "matching-v1"
      ) {
        throw new TypeError("Create matching rule version returned metadata that does not match the submitted parameters.");
      }
      return result;
    },
  );
}

export async function activateMatchingRuleVersion(
  supabase: SupabaseClient,
  input: {
    actorId: string;
    requestId: string;
    versionId: string;
    expectedActiveVersionId: string;
  },
): Promise<MatchingRuleActivationResult> {
  uuid(input.actorId, "Activate matching rule version actor");
  uuid(input.requestId, "Activate matching rule version request");
  uuid(input.versionId, "Activate matching rule version ID");
  uuid(input.expectedActiveVersionId, "Activate matching rule expected active version ID");
  if (sameUuid(input.versionId, input.expectedActiveVersionId)) {
    throw new TypeError("Activate matching rule version requires a target distinct from the active version.");
  }
  return rpc(
    supabase,
    "matching_activate_rule_version",
    {
      p_actor: input.actorId,
      p_request_id: input.requestId,
      p_version_id: input.versionId,
      p_expected_active_version_id: input.expectedActiveVersionId,
    },
    (value) => {
      const item = record(value, "Activate matching rule version");
      const result: MatchingRuleActivationResult = {
        requestId: uuid(item.requestId, "Activate matching rule version"),
        versionId: uuid(item.versionId, "Activate matching rule version"),
        previousVersionId: uuid(item.previousVersionId, "Activate matching rule version"),
        versionNo: integer(item.versionNo, "Activate matching rule version", 1),
        candidateCount: integer(item.candidateCount, "Activate matching rule version", 1),
        candidateSha256: sha256(item.candidateSha256, "Activate matching rule version"),
        sourceSha256: sha256(item.sourceSha256, "Activate matching rule version"),
        asOfYear: integer(item.asOfYear, "Activate matching rule version", 1900),
        paramsSha256: sha256(item.paramsSha256, "Activate matching rule version"),
      };
      assertSameUuid(result.requestId, input.requestId, "Activate matching rule version");
      assertSameUuid(result.versionId, input.versionId, "Activate matching rule version");
      assertSameUuid(
        result.previousVersionId,
        input.expectedActiveVersionId,
        "Activate matching rule previous version",
      );
      return result;
    },
  );
}

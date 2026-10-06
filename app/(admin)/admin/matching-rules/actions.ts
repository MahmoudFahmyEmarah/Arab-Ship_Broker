"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requireAdmin } from "@/lib/admin/require-admin";
import { parseMatchingRulesV1 } from "@/lib/matching-rules";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  activateMatchingRuleVersion,
  createMatchingRuleVersion,
  getMatchingRulesDashboard,
  previewMatchingRules,
  rollbackMatchingRuleVersion,
  type MatchingRuleActivationResult,
  type MatchingRuleCreateResult,
  type MatchingRulesDashboard,
  type MatchingRulesPreview,
} from "@/sdk/app/matching-rules";

export type MatchingActionResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

export interface CreateMatchingRuleVersionInput {
  params: unknown;
  changeNote: string;
  requestId: string;
}

export interface ActivateMatchingRuleVersionInput {
  versionId: string;
  versionNo: number;
  expectedActiveVersionId: string;
  confirmation: string;
  requestId: string;
}

export interface RollbackMatchingRuleVersionInput {
  targetVersionNo: number;
  expectedActiveVersionId: string;
  confirmation: string;
  requestId: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: unknown, fallback: string): { success: false; error: string } {
  unstable_rethrow(error);
  return {
    success: false,
    error: error instanceof Error && error.message.trim() ? error.message : fallback,
  };
}

function validUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function changeNote(value: string): string {
  const normalized = value.trim();
  const validUnicode = !/[\u0000]/.test(normalized)
    && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(normalized);
  if (!normalized || !validUnicode || Array.from(normalized).length > 1_000) {
    throw new TypeError("A change note is required and must be at most 1,000 characters.");
  }
  return normalized;
}

function releaseConfirmation(value: string, operation: "activate" | "rollback", versionNo: number): string {
  if (!Number.isSafeInteger(versionNo) || versionNo < 1) {
    throw new TypeError("The matching-rule version number is invalid.");
  }
  const expected = `${operation.toUpperCase()} v${versionNo}`;
  if (value !== expected) throw new TypeError(`Type ${expected} exactly to confirm this release.`);
  return value;
}

export async function getMatchingRulesBootstrap(): Promise<MatchingActionResult<MatchingRulesDashboard>> {
  try {
    const actor = await requireAdmin({ section: "matching" });
    const data = await getMatchingRulesDashboard(getSupabaseAdminClient(), actor.rowId);
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not load matching rules.");
  }
}

export async function previewMatchingRulesAction(
  input: unknown,
): Promise<MatchingActionResult<MatchingRulesPreview>> {
  try {
    const actor = await requireAdmin({ section: "matching", edit: true });
    const params = parseMatchingRulesV1(input);
    const data = await previewMatchingRules(getSupabaseAdminClient(), actor.rowId, params);
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not preview the proposed matching rules.");
  }
}

export async function createMatchingRuleVersionAction(
  input: CreateMatchingRuleVersionInput,
): Promise<MatchingActionResult<MatchingRuleCreateResult>> {
  try {
    const actor = await requireAdmin({ section: "matching", edit: true });
    const params = parseMatchingRulesV1(input.params);
    const data = await createMatchingRuleVersion(getSupabaseAdminClient(), {
      actorId: actor.rowId,
      requestId: validUuid(input.requestId, "Request id"),
      params,
      note: changeNote(input.changeNote),
    });
    revalidatePath("/admin/matching-rules");
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not create the immutable matching-rule version.");
  }
}

export async function activateMatchingRuleVersionAction(
  input: ActivateMatchingRuleVersionInput,
): Promise<MatchingActionResult<MatchingRuleActivationResult>> {
  try {
    const actor = await requireAdmin({ section: "matching", edit: true });
    const data = await activateMatchingRuleVersion(getSupabaseAdminClient(), {
      actorId: actor.rowId,
      requestId: validUuid(input.requestId, "Request id"),
      versionId: validUuid(input.versionId, "Rule version"),
      versionNo: input.versionNo,
      expectedActiveVersionId: validUuid(input.expectedActiveVersionId, "Expected active version"),
      confirmation: releaseConfirmation(input.confirmation, "activate", input.versionNo),
    });
    revalidatePath("/admin/matching-rules");
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not activate the matching-rule version.");
  }
}

export async function rollbackMatchingRuleVersionAction(
  input: RollbackMatchingRuleVersionInput,
): Promise<MatchingActionResult<MatchingRuleActivationResult>> {
  try {
    const actor = await requireAdmin({ section: "matching", edit: true });
    const data = await rollbackMatchingRuleVersion(getSupabaseAdminClient(), {
      actorId: actor.rowId,
      requestId: validUuid(input.requestId, "Request id"),
      expectedActiveVersionId: validUuid(input.expectedActiveVersionId, "Expected active version"),
      targetVersionNo: input.targetVersionNo,
      confirmation: releaseConfirmation(input.confirmation, "rollback", input.targetVersionNo),
    });
    revalidatePath("/admin/matching-rules");
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not roll back the matching-rule version.");
  }
}

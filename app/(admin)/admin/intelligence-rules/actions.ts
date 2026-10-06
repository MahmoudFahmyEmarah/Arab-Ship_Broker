"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  parseIntelligenceRuleSet,
  validateIntelligenceProvenance,
  type IntelligenceProvenanceEntryV1,
} from "@/lib/intelligence";
import {
  activateIntelligenceRuleSet,
  createIntelligenceRuleSet,
  diffIntelligenceRuleSets,
  getIntelligenceCloneInput,
  getIntelligenceRuleSet,
  listIntelligenceEvents,
  listIntelligenceRuleSets,
  type IntelligenceActivationResult,
  type IntelligenceCloneInput,
  type IntelligenceCreateResult,
  type IntelligenceEvent,
  type IntelligenceRuleSetDetail,
  type IntelligenceRuleSetDiff,
  type IntelligenceRuleSetsOverview,
  type IntelligenceReleaseOperation,
} from "@/sdk/app/intelligence";

type Result<T> = { success: true; data: T } | { success: false; error: string };

export interface IntelligenceBootstrap {
  overview: IntelligenceRuleSetsOverview;
  selected: IntelligenceRuleSetDetail | null;
  events: IntelligenceEvent[];
}

export interface CreateIntelligenceVersionInput {
  label: string;
  changeNote: string;
  basedOnId: string | null;
  documentJson: string;
  provenanceJson: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(error: unknown, fallback: string): { success: false; error: string } {
  unstable_rethrow(error);
  return { success: false, error: error instanceof Error ? error.message : fallback };
}

function validUuid(value: string, label: string): string {
  if (!UUID_RE.test(value)) throw new TypeError(`${label} is invalid.`);
  return value;
}

function boundedText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  const validUnicode = !/[\u0000]/.test(normalized) && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(normalized);
  if (!normalized || !validUnicode || Array.from(normalized).length > maximum) {
    throw new TypeError(`${label} is required and must be at most ${maximum} characters.`);
  }
  return normalized;
}

function releaseConfirmation(value: string, operation: IntelligenceReleaseOperation, version: number): string {
  if (operation !== "activate" && operation !== "rollback") {
    throw new TypeError("The intelligence release operation is invalid.");
  }
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new TypeError("The intelligence rule-set version is invalid.");
  }
  const expected = `${operation.toUpperCase()} v${version}`;
  if (value !== expected) throw new TypeError(`Type ${expected} exactly to confirm this release.`);
  return value;
}

function parseJson(value: string, label: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new TypeError(`${label} must be valid JSON.`);
  }
}

function validatedVersionInput(input: CreateIntelligenceVersionInput) {
  const document = parseIntelligenceRuleSet(parseJson(input.documentJson, "Rule document"));
  const provenanceResult = validateIntelligenceProvenance(
    parseJson(input.provenanceJson, "Provenance"),
    document,
  );
  if (!provenanceResult.ok || !provenanceResult.value) {
    throw new TypeError(
      provenanceResult.issues
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ") || "Provenance is invalid.",
    );
  }
  return {
    label: boundedText(input.label, "Version label", 120),
    changeNote: boundedText(input.changeNote, "Change note", 1000),
    basedOnId: input.basedOnId ? validUuid(input.basedOnId, "Base version") : null,
    document,
    provenance: provenanceResult.value as readonly IntelligenceProvenanceEntryV1[],
  };
}

export async function getIntelligenceBootstrap(): Promise<Result<IntelligenceBootstrap>> {
  try {
    const actor = await requireAdmin({ section: "intelligence" });
    const supabase = getSupabaseAdminClient();
    const overview = await listIntelligenceRuleSets(supabase, actor.rowId);
    const selectedId = overview.activeRuleSetId ?? overview.versions[0]?.ruleSetId ?? null;
    const [selected, events] = await Promise.all([
      selectedId ? getIntelligenceRuleSet(supabase, actor.rowId, selectedId) : Promise.resolve(null),
      listIntelligenceEvents(supabase, actor.rowId, 100),
    ]);
    return { success: true, data: { overview, selected, events } };
  } catch (error) {
    return fail(error, "Could not load intelligence rules.");
  }
}

export async function getIntelligenceRuleSetAction(
  ruleSetId: string,
): Promise<Result<IntelligenceRuleSetDetail>> {
  try {
    const actor = await requireAdmin({ section: "intelligence" });
    const data = await getIntelligenceRuleSet(
      getSupabaseAdminClient(),
      actor.rowId,
      validUuid(ruleSetId, "Rule-set version"),
    );
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not load the selected version.");
  }
}

export async function getIntelligenceCloneInputAction(
  ruleSetId: string,
): Promise<Result<IntelligenceCloneInput>> {
  try {
    const actor = await requireAdmin({ section: "intelligence", edit: true });
    const data = await getIntelligenceCloneInput(
      getSupabaseAdminClient(),
      actor.rowId,
      validUuid(ruleSetId, "Rule-set version"),
    );
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not prepare a new version.");
  }
}

export async function diffIntelligenceRuleSetsAction(
  leftRuleSetId: string,
  rightRuleSetId: string,
): Promise<Result<IntelligenceRuleSetDiff>> {
  try {
    const actor = await requireAdmin({ section: "intelligence" });
    const data = await diffIntelligenceRuleSets(
      getSupabaseAdminClient(),
      actor.rowId,
      validUuid(leftRuleSetId, "Left version"),
      validUuid(rightRuleSetId, "Right version"),
    );
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not compare the selected versions.");
  }
}

export async function createIntelligenceVersionAction(
  input: CreateIntelligenceVersionInput & { requestId: string },
): Promise<Result<IntelligenceCreateResult>> {
  try {
    const actor = await requireAdmin({ section: "intelligence", edit: true });
    const validated = validatedVersionInput(input);
    const data = await createIntelligenceRuleSet(getSupabaseAdminClient(), {
      actorId: actor.rowId,
      document: validated.document,
      provenance: validated.provenance,
      label: validated.label,
      changeNote: validated.changeNote,
      basedOnId: validated.basedOnId,
      requestId: validUuid(input.requestId, "Request id"),
    });
    revalidatePath("/admin/intelligence-rules");
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not create the new rule-set version.");
  }
}

export async function activateIntelligenceVersionAction(
  input: {
    ruleSetId: string;
    expectedRevision: number;
    requestId: string;
    operation: IntelligenceReleaseOperation;
    version: number;
    confirmation: string;
  },
): Promise<Result<IntelligenceActivationResult>> {
  try {
    const actor = await requireAdmin({ section: "intelligence", edit: true });
    if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      throw new TypeError("The expected rule-state revision is invalid.");
    }
    const data = await activateIntelligenceRuleSet(getSupabaseAdminClient(), {
      actorId: actor.rowId,
      ruleSetId: validUuid(input.ruleSetId, "Rule-set version"),
      expectedRevision: input.expectedRevision,
      requestId: validUuid(input.requestId, "Request id"),
      operation: input.operation,
      version: input.version,
      confirmation: releaseConfirmation(input.confirmation, input.operation, input.version),
    });
    revalidatePath("/admin/intelligence-rules");
    return { success: true, data };
  } catch (error) {
    return fail(error, "Could not activate the selected version.");
  }
}

"use server";

import { getAppUserRow } from "@/lib/app-user";
import { calculatePda } from "@/lib/pda/calculate";
import { pdaRequestSchema } from "@/lib/pda/schemas";
import type { PdaCalculationResult, PdaRequest } from "@/lib/pda/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getPdaCalculationContext, savePdaEstimate } from "@/sdk/app/pda";

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

async function viewer() {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in required");
  const appUser = await getAppUserRow<{
    id: string;
    full_name: string | null;
    role: string | null;
    subscription_tier: string | null;
    is_market_partner: boolean | null;
    is_active: boolean;
  }>(supabase, user.id, "id, full_name, role, subscription_tier, is_market_partner, is_active");
  if (!appUser?.is_active) throw new Error("Active account required");
  const entitled = appUser.role?.toLowerCase() === "admin"
    || appUser.is_market_partner === true
    || ["T3", "T4"].includes(appUser.subscription_tier ?? "T1");
  if (!entitled) throw new Error("PDA Estimator requires Subscriber tier (T3+)");
  const { data: membership } = await supabase.rpc("fn_my_membership");
  const member = (Array.isArray(membership) ? membership[0] : membership) as { org_id?: string; status?: string } | null;
  return {
    supabase,
    appUser,
    manualActorLabel: appUser.full_name?.trim() || "Authenticated member",
    ownerOrgId: member?.status === "active" ? member.org_id ?? null : null,
  };
}

function attributeManualLines(request: PdaRequest, enteredBy: string): PdaRequest {
  return {
    ...request,
    manualLines: request.manualLines?.map((line) => ({ ...line, enteredBy })),
  };
}

export async function previewPda(raw: PdaRequest): Promise<ActionResult<PdaCalculationResult>> {
  try {
    const parsed = pdaRequestSchema.parse(raw) as PdaRequest;
    const { supabase, manualActorLabel } = await viewer();
    const request = attributeManualLines(parsed, manualActorLabel);
    const context = await getPdaCalculationContext(supabase, request);
    return { ok: true, data: calculatePda(request, context.tariffVersion ?? null) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to calculate PDA" };
  }
}

export async function persistPda(raw: PdaRequest): Promise<ActionResult<{ estimateId: string; result: PdaCalculationResult }>> {
  try {
    const parsed = pdaRequestSchema.parse(raw) as PdaRequest;
    const { supabase, appUser, manualActorLabel, ownerOrgId } = await viewer();
    const request = attributeManualLines(parsed, manualActorLabel);
    const context = await getPdaCalculationContext(supabase, request);
    const result = calculatePda(request, context.tariffVersion ?? null);
    const estimateId = await savePdaEstimate(getSupabaseAdminClient(), {
      actorId: appUser.id,
      ownerOrgId,
      request,
      result,
    });
    return { ok: true, data: { estimateId, result } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Unable to save PDA" };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { gateAdminEdit, gateSummary } from "@/lib/dq/admin-gate";
import type {
  RiskLevel,
  VesselScope,
  VesselRecordReviewStatus,
} from "@/lib/admin/types";

// Every write here goes through the data-quality gate on the admin channel
// (21 Sep 2026). These are service-role writes, and fn_dq_forms_gate returns
// early for a service-role write that names no channel — so until now nothing
// judged them, while the very same fields edited through Database Preview were
// judged strictly (admin.edit). Two strictnesses, for two kinds of edit:
//
//   the vessel's own particulars (name, IMO, deadweight, flag, certificates)
//   are what listings are built from and what Database Preview gates strictly,
//   so they are judged strictly here too — fail closed.
//
//   risk level, scope, sanctions flag, notes and record-review status are
//   internal annotations that never reach a member's screen as vessel data.
//   They are evaluated and logged, never refused: an administrator must always
//   be able to mark a vessel sanctioned or put it in review, whatever the
//   rules currently say about the row.

/** Judge a patch to one vessel; `strict` decides whether a block refuses it. */
async function judge(
  vesselId: string,
  patch: Record<string, unknown>,
  what: string,
  strict: boolean,
) {
  const admin = await requireAdmin({ section: "vessels", edit: true });
  const client = getSupabaseAdminClient();
  const judged = await gateAdminEdit(
    client, "vessels", vesselId, patch,
    { id: admin.supabaseUserId, name: `Admin vessels · ${what}` },
    { strict, what: "vessel" },
  );
  return { client, judged };
}

export async function setVesselRisk(
  vesselId: string,
  riskLevel: RiskLevel,
  riskNotes: string,
) {
  const patch = { risk_level: riskLevel, risk_notes: riskNotes.trim() || null };
  const { client, judged } = await judge(vesselId, patch, "risk level", false);
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("vessels").update(patch).eq("id", vesselId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/vessels");
  revalidatePath(`/admin/vessels/${vesselId}`);
  return { success: true, gate: gateSummary(judged.gate) };
}

export async function setVesselScope(vesselId: string, scope: VesselScope) {
  const { client, judged } = await judge(vesselId, { scope }, "scope", false);
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("vessels").update({ scope }).eq("id", vesselId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/vessels");
  revalidatePath(`/admin/vessels/${vesselId}`);
  return { success: true, gate: gateSummary(judged.gate) };
}

export async function setVesselSanctioned(
  vesselId: string,
  isSanctioned: boolean,
) {
  const { client, judged } = await judge(vesselId, { is_sanctioned: isSanctioned }, "sanctions flag", false);
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("vessels").update({ is_sanctioned: isSanctioned }).eq("id", vesselId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/vessels");
  revalidatePath(`/admin/vessels/${vesselId}`);
  revalidatePath("/admin/dashboard");
  return { success: true, gate: gateSummary(judged.gate) };
}

export async function updateVesselNotes(vesselId: string, notes: string) {
  const patch = { notes: notes.trim() || null };
  const { client, judged } = await judge(vesselId, patch, "notes", false);
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("vessels").update(patch).eq("id", vesselId);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/admin/vessels/${vesselId}`);
  return { success: true, gate: gateSummary(judged.gate) };
}

export async function setVesselReviewStatus(
  vesselId: string,
  status: VesselRecordReviewStatus,
  reason: string,
) {
  if (status === "IN_REVIEW" && !reason.trim()) {
    return {
      success: false,
      error: "A review reason is required when placing a vessel In Review.",
    };
  }

  const patch = {
    vessel_review_status: status,
    vessel_review_reason: status === "CLEAR" ? null : reason.trim(),
  };
  const { client, judged } = await judge(vesselId, patch, "record review status", false);
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("vessels").update(patch).eq("id", vesselId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/vessels");
  revalidatePath(`/admin/vessels/${vesselId}`);
  revalidatePath("/dashboard/vessels");
  return { success: true, gate: gateSummary(judged.gate) };
}

export async function updateVesselIntelligence(
  vesselId: string,
  fields: {
    vessel_name?: string;
    imo_number?: string | null;
    vessel_type?: string;
    dwt_grain?: number | null;
    dwt_bale?: number | null;
    build_year?: number | null;
    flag?: string | null;
    flag_category?: string | null;
    is_geared?: boolean | null;
    grain_certified?: boolean | null;
    dg_certified?: boolean | null;
    max_loa_m?: number | null;
    max_draft_m?: number | null;
    pi_club?: string | null;
    owner_company?: string | null;
    owner_country?: string | null;
    manager_company?: string | null;
    manager_country?: string | null;
  },
) {
  // A key present with the value undefined would otherwise erase a real value
  // in the row the gate judges, and the verdict would be about a row nobody
  // asked for.
  const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return { success: false, error: "nothing to change" };
  // the vessel's particulars: judged strictly, as Database Preview judges them
  const { client, judged } = await judge(vesselId, patch, "particulars", true);
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("vessels").update(patch).eq("id", vesselId);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/admin/vessels/${vesselId}`);
  return { success: true, gate: gateSummary(judged.gate) };
}

"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import type {
  RiskLevel,
  VesselScope,
  VesselRecordReviewStatus,
} from "@/lib/admin/types";

async function adminClient() {
  await requireAdmin({ section: "vessels", edit: true });
  return getSupabaseAdminClient();
}

export async function setVesselRisk(
  vesselId: string,
  riskLevel: RiskLevel,
  riskNotes: string,
) {
  const client = await adminClient();
  const { error } = await client
    .from("vessels")
    .update({ risk_level: riskLevel, risk_notes: riskNotes.trim() || null })
    .eq("id", vesselId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/vessels");
  revalidatePath(`/admin/vessels/${vesselId}`);
  return { success: true };
}

export async function setVesselScope(vesselId: string, scope: VesselScope) {
  const client = await adminClient();
  const { error } = await client
    .from("vessels")
    .update({ scope })
    .eq("id", vesselId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/vessels");
  revalidatePath(`/admin/vessels/${vesselId}`);
  return { success: true };
}

export async function setVesselSanctioned(
  vesselId: string,
  isSanctioned: boolean,
) {
  const client = await adminClient();
  const { error } = await client
    .from("vessels")
    .update({ is_sanctioned: isSanctioned })
    .eq("id", vesselId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/vessels");
  revalidatePath(`/admin/vessels/${vesselId}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function updateVesselNotes(vesselId: string, notes: string) {
  const client = await adminClient();
  const { error } = await client
    .from("vessels")
    .update({ notes: notes.trim() || null })
    .eq("id", vesselId);

  if (error) return { success: false, error: error.message };
  revalidatePath(`/admin/vessels/${vesselId}`);
  return { success: true };
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

  const client = await adminClient();
  const { error } = await client
    .from("vessels")
    .update({
      vessel_review_status: status,
      vessel_review_reason: status === "CLEAR" ? null : reason.trim(),
    })
    .eq("id", vesselId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/vessels");
  revalidatePath(`/admin/vessels/${vesselId}`);
  revalidatePath("/dashboard/vessels");
  return { success: true };
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
  const client = await adminClient();
  const { error } = await client
    .from("vessels")
    .update(fields)
    .eq("id", vesselId);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/admin/vessels/${vesselId}`);
  return { success: true };
}

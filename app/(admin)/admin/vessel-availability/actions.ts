"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { gateAdminEdit, gateSummary } from "@/lib/dq/admin-gate";

/** The status that puts a position back on the market (the portal reads OPEN + APPROVED). */
const PUBLISHES: readonly string[] = ["OPEN"];

/**
 * Change a position's status, through the data-quality gate (21 Sep 2026).
 *
 * Same hole as Admin → Cargo, same repair: a bare `.update({ status })` on the
 * service role is not judged by fn_dq_forms_gate, which returns early for a
 * service-role write that names no channel. Setting a position back to OPEN is
 * a publication, so it is judged strictly on the admin channel and fails
 * closed; moving it to FIXED, ON SUBS or INACTIVE takes it off the market and
 * is evaluated for the record but never refused.
 *
 * The write carries the status it was judged against as a precondition, so a
 * concurrent change is reported instead of being overwritten on a stale
 * verdict.
 */
export async function setAvailabilityStatus(
  id: string,
  status: "OPEN" | "FIXED" | "ON SUBS" | "INACTIVE",
) {
  const admin = await requireAdmin({ section: "vesselavail", edit: true });
  const c = getSupabaseAdminClient();
  const publishing = PUBLISHES.includes(status);

  const judged = await gateAdminEdit(
    c, "vessel_availability", id, { status },
    { id: admin.supabaseUserId, name: `Admin position status → ${status}` },
    { strict: publishing, what: "position" },
  );
  if (!judged.ok) return { success: false, error: judged.error };

  const priorStatus = (judged.before.status ?? null) as string | null;
  const q = c.from("vessel_availability").update({ status }).eq("id", id);
  const { data: updated, error } = await (priorStatus === null ? q.is("status", null) : q.eq("status", priorStatus)).select("id");
  if (error) return { success: false, error: error.message };
  if (!updated?.length) {
    return { success: false, error: `this position is no longer "${priorStatus ?? "unset"}" — somebody changed it while the gate was running. Reload and try again.` };
  }
  revalidatePath("/admin/vessel-availability");
  revalidatePath(`/admin/vessel-availability/${id}`);
  revalidatePath("/admin/dashboard");
  return { success: true, gate: gateSummary(judged.gate) };
}

"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { gateAdminEdit, gateSummary } from "@/lib/dq/admin-gate";

/**
 * The statuses that put a cargo back on the market. trg_cl_zy_live_route_gate
 * uses the same pair, so this list and the database's agree by construction.
 */
const PUBLISHES: readonly string[] = ["IN", "PARTIAL"];

/**
 * Change a cargo's status, through the data-quality gate (21 Sep 2026).
 *
 * This used to be a bare `.update({ status })` on the service role. The gate
 * trigger (fn_dq_forms_gate) returns early for a service-role write that does
 * not name its channel, so nothing judged it: an administrator could put a
 * listing back on the market without meeting the rules the review queue
 * enforces on exactly the same transition (review.approve). That was the
 * widest hole in the publication policy.
 *
 * Now the row that WOULD result is judged on the admin channel first:
 *
 *   publishing (IN, PARTIAL)   strict, fails closed. A block-mode rule
 *                              refuses, and so does a rule that cannot
 *                              evaluate: an unjudged row is never published.
 *   withdrawing (OUT, CLOSED)  evaluated and logged, never refused. Taking a
 *                              listing off the market introduces no new
 *                              value, and a broken rule must not be able to
 *                              trap a bad listing in front of members.
 *
 * The write then carries the status it was judged against as a precondition,
 * so a row somebody else changed in between is reported rather than
 * overwritten on the strength of a stale verdict.
 */
export async function setCargoStatus(
  cargoId: string,
  status: "IN" | "PARTIAL" | "OUT" | "CLOSED",
) {
  const admin = await requireAdmin({ section: "cargo", edit: true });
  const client = getSupabaseAdminClient();
  const publishing = PUBLISHES.includes(status);

  const judged = await gateAdminEdit(
    client, "cargo_listings", cargoId, { status },
    { id: admin.supabaseUserId, name: `Admin cargo status → ${status}` },
    { strict: publishing, what: "listing" },
  );
  if (!judged.ok) return { success: false, error: judged.error };

  const priorStatus = (judged.before.status ?? null) as string | null;
  const q = client.from("cargo_listings").update({ status }).eq("id", cargoId);
  const { data: updated, error } = await (priorStatus === null ? q.is("status", null) : q.eq("status", priorStatus)).select("id");
  if (error) return { success: false, error: error.message };
  if (!updated?.length) {
    return { success: false, error: `this listing is no longer "${priorStatus ?? "unset"}" — somebody changed it while the gate was running. Reload and try again.` };
  }
  revalidatePath("/admin/cargo");
  revalidatePath(`/admin/cargo/${cargoId}`);
  revalidatePath("/admin/dashboard");
  return { success: true, gate: gateSummary(judged.gate) };
}

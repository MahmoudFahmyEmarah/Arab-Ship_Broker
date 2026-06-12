"use server";

// Admin: confirm or reject company-membership requests. Approving flips the
// row to is_current = true, which is what opens the firewall (fn_my_org_ids
// gates on is_current) — the deliberate human gate between a self-claim and
// access to a company's confidential vessel records.
//
// Calls the SECURITY DEFINER RPCs with the admin's COOKIE session (so
// fn_is_admin() sees the real uid). The same RPCs also serve a company's own
// admin from the dashboard, keeping one authorisation path.
import { revalidatePath } from "next/cache";
import { requireAdmin, getAdminSupabaseClient } from "@/lib/admin/require-admin";

export type PendingRequest = {
  org_id: string;
  org_name: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  requested_company_name: string | null;
  requested_email_domain: string | null;
  domain_match: boolean;
  requested_at: string;
};

export async function listPendingRequests(): Promise<PendingRequest[]> {
  await requireAdmin({ section: "orgmembers", edit: true });
  const c = await getAdminSupabaseClient();
  const { data, error } = await c.rpc("fn_pending_membership_requests");
  if (error) {
    console.error("[admin] pending requests failed:", error.message);
    return [];
  }
  return (data ?? []) as PendingRequest[];
}

export async function decideRequest(
  orgId: string,
  userId: string,
  approve: boolean,
  makeAdmin = false,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin({ section: "orgmembers", edit: true });
  const c = await getAdminSupabaseClient();
  const { error } = await c.rpc("fn_decide_org_membership", {
    p_org_id: orgId,
    p_user_id: userId,
    p_approve: approve,
    p_make_admin: makeAdmin,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/org-members");
  return { ok: true };
}

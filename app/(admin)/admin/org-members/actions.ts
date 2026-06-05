"use server";

// Admin: confirm or reject company-membership requests. Approving flips the
// row to is_current = true, which is what opens the firewall (fn_my_org_ids
// gates on is_current) — so this is the deliberate human gate between a
// self-claim and access to a company's confidential vessel records.
import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

export type PendingRequest = {
  org_id: string;
  org_name: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  requested_company_name: string | null;
  added_at: string;
};

export async function listPendingRequests(): Promise<PendingRequest[]> {
  await requireAdmin();
  const c = getSupabaseAdminClient();
  const { data, error } = await c
    .from("organization_members")
    .select(
      "org_id, user_id, requested_company_name, added_at, organizations(name), users(full_name, email)",
    )
    .eq("status", "pending")
    .order("added_at", { ascending: true });
  if (error) {
    console.error("[admin] pending requests failed:", error.message);
    return [];
  }
  type Row = {
    org_id: string;
    user_id: string;
    requested_company_name: string | null;
    added_at: string;
    organizations: { name: string } | null;
    users: { full_name: string | null; email: string | null } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    org_id: r.org_id,
    org_name: r.organizations?.name ?? r.requested_company_name ?? "—",
    user_id: r.user_id,
    full_name: r.users?.full_name ?? null,
    email: r.users?.email ?? null,
    requested_company_name: r.requested_company_name,
    added_at: r.added_at,
  }));
}

export async function decideRequest(
  orgId: string,
  userId: string,
  approve: boolean,
  makeAdmin = false,
): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  const c = getSupabaseAdminClient();
  const update: Record<string, unknown> = {
    status: approve ? "active" : "rejected",
    is_current: approve,
    decided_at: new Date().toISOString(),
    decided_by: admin.supabaseUserId,
  };
  if (approve && makeAdmin) update.member_role = "admin";

  const { error } = await c
    .from("organization_members")
    .update(update)
    .eq("org_id", orgId)
    .eq("user_id", userId);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/org-members");
  return { ok: true };
}

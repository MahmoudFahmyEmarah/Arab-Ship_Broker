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

// ── Contacts registry (GDPR) ───────────────────────────────────────────────
export type ContactRow = {
  id: string; kind: "person" | "desk"; display_name: string; email: string | null; phone: string | null; org_id: string | null; org_name: string | null;
  role: string | null; source: string; first_seen: string; last_seen: string; erased_at: string | null; erase_reason: string | null;
  cargo_count: number; position_count: number; queue_count: number;
};

export async function listContacts(q?: string): Promise<{ ok: true; rows: ContactRow[] } | { ok: false; error: string }> {
  try {
    await requireAdmin({ section: "orgmembers" });
    const c = await getAdminSupabaseClient();
    const { data, error } = await c.rpc("fn_contacts_overview", { p_q: q ?? null, p_limit: 300 });
    if (error) return { ok: false, error: error.message };
    return { ok: true, rows: (data ?? []) as ContactRow[] };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Could not load contacts" }; }
}

// Erase on request. Owner or an edit seat on Companies; runs on the service
// role because it scrubs copies across tables the cookie session cannot write.
export async function eraseContact(id: string, reason: string): Promise<{ ok: true; affected: Record<string, number> } | { ok: false; error: string }> {
  try {
    const u = await requireAdmin({ section: "orgmembers", edit: true });
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Invalid contact id" };
    if (!reason || reason.trim().length < 4) return { ok: false, error: "A reason is required" };
    const { getSupabaseAdminClient } = await import("@/lib/supabase/admin");
    const sb = getSupabaseAdminClient();
    const { data, error } = await sb.rpc("gdpr_erase_contact", { p_contact_id: id, p_actor: u.rowId, p_actor_name: u.fullName, p_reason: reason.trim() });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/admin/org-members"); revalidatePath("/admin/data-sync"); revalidatePath("/dashboard", "layout");
    return { ok: true, affected: (data ?? {}) as Record<string, number> };
  } catch (e) { return { ok: false, error: e instanceof Error ? e.message : "Erasure failed" }; }
}

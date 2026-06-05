"use server";

// Server actions for the account "Company" panel — search the seeded company
// registry and request to join. The request lands as PENDING (no firewall
// access) until a platform admin approves it; see migration …000880.
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

async function client() {
  const store = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: () => {},
      },
    },
  );
}

export type OrgSearchResult = {
  id: string;
  name: string;
  org_type: string;
  country: string | null;
  fleet_total: number | null;
};

export type MyMembership = {
  org_id: string;
  org_name: string;
  org_type: string;
  member_role: string;
  status: "pending" | "active" | "rejected";
  requested_company_name: string | null;
  added_at: string;
};

export async function searchOrganizations(q: string): Promise<OrgSearchResult[]> {
  if (!q || q.trim().length < 2) return [];
  const supabase = await client();
  const { data, error } = await supabase.rpc("fn_search_organizations", { q });
  if (error) {
    console.error("[account] org search failed:", error.message);
    return [];
  }
  return (data ?? []) as OrgSearchResult[];
}

export async function getMyMembership(): Promise<MyMembership | null> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("fn_my_membership");
  if (error) {
    console.error("[account] my-membership lookup failed:", error.message);
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  return (row as MyMembership) ?? null;
}

export async function requestOrgMembership(
  orgId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await client();
  const { error } = await supabase.rpc("fn_request_org_membership", {
    p_org_id: orgId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Company-admin surface: a member with member_role 'admin' can review requests
// for their OWN org (the RPC returns rows only when fn_is_org_admin is true).
export type OrgPendingRequest = {
  org_id: string;
  org_name: string;
  user_id: string;
  full_name: string | null;
  email: string | null;
  requested_email_domain: string | null;
  domain_match: boolean;
  requested_at: string;
};

export async function getMyOrgPendingRequests(): Promise<OrgPendingRequest[]> {
  const supabase = await client();
  const { data, error } = await supabase.rpc("fn_pending_membership_requests");
  if (error) {
    console.error("[account] org pending requests failed:", error.message);
    return [];
  }
  return (data ?? []) as OrgPendingRequest[];
}

export async function decideMyOrgRequest(
  orgId: string,
  userId: string,
  approve: boolean,
  makeAdmin = false,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await client();
  const { error } = await supabase.rpc("fn_decide_org_membership", {
    p_org_id: orgId,
    p_user_id: userId,
    p_approve: approve,
    p_make_admin: makeAdmin,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

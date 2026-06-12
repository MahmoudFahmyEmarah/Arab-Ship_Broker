import { SupabaseClient } from "@supabase/supabase-js";

export type Membership = {
  org_id: string;
  org_name: string;
  org_type: string;
  member_role: string;
  status: string;
  requested_company_name: string | null;
  added_at: string;
};

export type TeamMember = {
  user_id: string;
  full_name: string;
  email: string;
  member_role: string;
  status: string;
  added_at: string;
  requested_email_domain: string | null;
};

export type MemberAction = "approve" | "reject" | "remove" | "make_admin" | "make_broker";

export async function getMyMembership(supabase: SupabaseClient): Promise<Membership | null> {
  const { data, error } = await supabase.rpc("fn_my_membership");
  if (error) return null;
  return (data as Membership[] | null)?.[0] ?? null;
}

export async function getMyAdminOrgId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("fn_my_admin_org_id");
  if (error) return null;
  return (data as string | null) ?? null;
}

export async function getOrgTeam(supabase: SupabaseClient, orgId: string): Promise<TeamMember[]> {
  const { data, error } = await supabase.rpc("fn_org_team", { p_org_id: orgId });
  if (error) throw error;
  return (data ?? []) as TeamMember[];
}

export async function manageMember(
  supabase: SupabaseClient,
  orgId: string,
  userId: string,
  action: MemberAction,
): Promise<void> {
  const { error } = await supabase.rpc("fn_org_manage_member", {
    p_org_id: orgId,
    p_user_id: userId,
    p_action: action,
  });
  if (error) throw error;
}

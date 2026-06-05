import { SupabaseClient } from "@supabase/supabase-js";
import type { Profile, ProfileType } from "@/lib/schemas/account";

export async function getMyProfiles(
  supabase: SupabaseClient,
): Promise<Profile[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: account, error: accountError } = await supabase
    .from("users")
    .select("id")
    .eq("id", user.id)
    .single();

  if (accountError || !account) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("account_id", account.id)
    .eq("is_active", true)
    .order("profile_type");

  if (error) throw error;
  return (data ?? []) as Profile[];
}

export async function addProfileToAccount(
  supabase: SupabaseClient,
  profileType: ProfileType,
  displayName?: string,
  company?: string,
): Promise<Profile> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("You must be logged in.");

  const { data: account, error: accountError } = await supabase
    .from("users")
    .select("id, full_name")
    .eq("id", user.id)
    .single();

  if (accountError || !account) throw new Error("Account not found.");

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      account_id: account.id,
      profile_type: profileType,
      display_name: displayName ?? account.full_name,
      company: company ?? null,
      is_active: true,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      const { data: reactivated, error: reactivateError } = await supabase
        .from("profiles")
        .update({ is_active: true })
        .eq("account_id", account.id)
        .eq("profile_type", profileType)
        .select()
        .single();
      if (reactivateError) throw reactivateError;
      return reactivated as Profile;
    }
    throw error;
  }

  return data as Profile;
}

/**
 * Deactivates a profile (soft delete).
 * The profile row is kept for audit — is_active is set to FALSE.
 */
export async function deactivateProfile(
  supabase: SupabaseClient,
  profileId: string,
): Promise<void> {
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: false })
    .eq("id", profileId);

  if (error) throw error;
}

export async function updateProfile(
  supabase: SupabaseClient,
  profileId: string,
  updates: Partial<
    Pick<Profile, "display_name" | "company" | "phone" | "notes">
  >,
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", profileId)
    .select()
    .single();

  if (error) throw error;
  return data as Profile;
}

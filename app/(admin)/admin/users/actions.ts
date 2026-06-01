"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

async function getAdminCtx() {
  const admin = await requireAdmin();
  const client = getSupabaseAdminClient();
  return { admin, client };
}

export async function setUserTrustTier(
  userId: string,
  tier: "NEW" | "VERIFIED" | "FLAGGED",
) {
  await getAdminCtx();

  const { error } = await getSupabaseAdminClient()
    .from("users")
    .update({ trust_tier: tier })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function setUserActive(userId: string, isActive: boolean) {
  await getAdminCtx();

  const { error } = await getSupabaseAdminClient()
    .from("users")
    .update({ is_active: isActive })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

export async function resetUserStrikes(userId: string) {
  await getAdminCtx();

  const { error } = await getSupabaseAdminClient()
    .from("users")
    .update({ strike_count: 0 })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

export async function resetUserCleanPosts(userId: string) {
  await getAdminCtx();

  const { error } = await getSupabaseAdminClient()
    .from("users")
    .update({ clean_posts: 0 })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

export async function setUserRole(
  userId: string,
  role: "cargo_owner" | "vessel_owner" | "broker",
) {
  await getAdminCtx();

  const { error } = await getSupabaseAdminClient()
    .from("users")
    .update({ role })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

export async function updateUserNotes(userId: string, notes: string) {
  await getAdminCtx();

  const { error } = await getSupabaseAdminClient()
    .from("users")
    .update({ notes: notes.trim() || null })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  revalidatePath(`/admin/users/${userId}`);
  return { success: true };
}

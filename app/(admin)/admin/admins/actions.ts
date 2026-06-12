"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { ADMIN_PRESETS } from "@/lib/admin/sections";

type Result = { success: true } | { success: false; error: string };

// Promote an EXISTING platform user to a sub-admin preset (design decision:
// promote-existing-only — no invite-by-email flow). Owner-only.
export async function promoteToSubAdmin(userId: string, preset: string): Promise<Result> {
  const me = await requireAdmin({ section: "admins", edit: true });
  const p = ADMIN_PRESETS[preset];
  if (!p) return { success: false, error: "Unknown preset" };
  if (userId === me.supabaseUserId) return { success: false, error: "You are already the Superior Admin." };

  const { error } = await getSupabaseAdminClient()
    .from("users")
    .update({ role: "admin", admin_tier: "sub", admin_perms: p.perms })
    .eq("id", userId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/admins");
  return { success: true };
}

// Demote a sub-admin back to a regular member (role broker keeps both personas).
export async function demoteSubAdmin(userId: string): Promise<Result> {
  const me = await requireAdmin({ section: "admins", edit: true });
  if (userId === me.supabaseUserId) return { success: false, error: "You cannot demote yourself." };

  const client = getSupabaseAdminClient();
  const { data } = await client.from("users").select("admin_tier").eq("id", userId).single();
  if ((data as { admin_tier?: string } | null)?.admin_tier === "super") {
    return { success: false, error: "Superior Admins cannot be demoted from here." };
  }
  const { error } = await client
    .from("users")
    .update({ role: "broker", admin_tier: null, admin_perms: null })
    .eq("id", userId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/admins");
  return { success: true };
}

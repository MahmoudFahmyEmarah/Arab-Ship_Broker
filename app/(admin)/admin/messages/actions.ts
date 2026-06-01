"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

async function client() {
  await requireAdmin();
  return getSupabaseAdminClient();
}

export async function markMessageRead(id: string, isRead: boolean) {
  const c = await client();
  const { error } = await c
    .from("contact_messages")
    .update({ is_read: isRead })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/messages");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function markAllRead() {
  const c = await client();
  const { error } = await c
    .from("contact_messages")
    .update({ is_read: true })
    .eq("is_read", false);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/messages");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function deleteMessage(id: string) {
  const c = await client();
  const { error } = await c.from("contact_messages").delete().eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/messages");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

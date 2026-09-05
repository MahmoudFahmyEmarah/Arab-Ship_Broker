"use server";

// Alert thresholds for the console dashboard — one jsonb row in
// app_settings (key admin_alert_thresholds). Owner-only, like every other
// platform setting; the write bypasses RLS through the service-role key.
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeThresholds } from "@/lib/admin/dashboard/model";
import type { Thresholds } from "@/lib/admin/dashboard/types";

export async function saveAlertThresholds(input: Thresholds): Promise<{ success: boolean; error?: string }> {
  await requireAdmin({ section: "settings", edit: true });
  const value = normalizeThresholds(input);
  const { error } = await getSupabaseAdminClient()
    .from("app_settings")
    .upsert({ key: "admin_alert_thresholds", value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/dashboard");
  return { success: true };
}

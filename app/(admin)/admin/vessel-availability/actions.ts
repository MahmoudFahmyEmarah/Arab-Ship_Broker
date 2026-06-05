"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

async function client() {
  await requireAdmin();
  return getSupabaseAdminClient();
}

export async function setAvailabilityStatus(
  id: string,
  status: "OPEN" | "FIXED" | "ON SUBS" | "INACTIVE",
) {
  const c = await client();
  const { error } = await c
    .from("vessel_availability")
    .update({ status })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/vessel-availability");
  revalidatePath(`/admin/vessel-availability/${id}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

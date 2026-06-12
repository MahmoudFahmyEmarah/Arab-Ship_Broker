"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

async function adminClient() {
  await requireAdmin({ section: "cargo", edit: true });
  return getSupabaseAdminClient();
}

export async function setCargoStatus(
  cargoId: string,
  status: "IN" | "PARTIAL" | "OUT" | "CLOSED",
) {
  const client = await adminClient();
  const { error } = await client
    .from("cargo_listings")
    .update({ status })
    .eq("id", cargoId);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/cargo");
  revalidatePath(`/admin/cargo/${cargoId}`);
  revalidatePath("/admin/dashboard");
  return { success: true };
}

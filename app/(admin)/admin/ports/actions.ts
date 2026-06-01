"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

async function client() {
  await requireAdmin();
  return getSupabaseAdminClient();
}

export async function verifyPort(locode: string) {
  const c = await client();
  const { error } = await c
    .from("ports")
    .update({ is_verified: true })
    .eq("locode", locode);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/ports");
  revalidatePath("/admin/dashboard");
  return { success: true };
}

export async function setPortActive(locode: string, isActive: boolean) {
  const c = await client();
  const { error } = await c
    .from("ports")
    .update({ is_active: isActive })
    .eq("locode", locode);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/ports");
  return { success: true };
}

export async function updatePort(
  locode: string,
  fields: {
    trade_name?: string;
    country?: string;
    zone?: string;
    port_type?: string;
    notes?: string;
  },
) {
  const c = await client();
  const { error } = await c.from("ports").update(fields).eq("locode", locode);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/ports");
  return { success: true };
}

export async function createPort(fields: {
  locode: string;
  trade_name: string;
  country: string;
  zone: string;
  port_type: string;
  notes?: string;
}) {
  const c = await client();
  const { error } = await c.from("ports").insert({
    ...fields,
    is_active: true,
    is_verified: true,
  });
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/ports");
  return { success: true };
}

"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";

async function client() {
  await requireAdmin();
  return getSupabaseAdminClient();
}

export async function setCommodityActive(id: string, isActive: boolean) {
  const c = await client();
  const { error } = await c
    .from("commodities")
    .update({ is_active: isActive })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/commodities");
  return { success: true };
}

export async function updateCommoditySortOrder(id: string, sortOrder: number) {
  const c = await client();
  const { error } = await c
    .from("commodities")
    .update({ sort_order: sortOrder })
    .eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/commodities");
  return { success: true };
}

export async function createCommodity(fields: {
  canonical_name: string;
  cargo_type: string;
  imsbc_category: string;
  is_dg: boolean;
  is_grain: boolean;
  default_sf_m3t?: number | null;
  un_number?: string;
  imo_class?: string;
  display_aliases?: string[];
  sort_order: number;
  notes?: string;
}) {
  const c = await client();
  const { error } = await c.from("commodities").insert({
    ...fields,
    is_active: true,
  });
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/commodities");
  return { success: true };
}

export async function updateCommodity(
  id: string,
  fields: Partial<{
    canonical_name: string;
    display_aliases: string[];
    cargo_type: string;
    imsbc_category: string;
    is_dg: boolean;
    is_grain: boolean;
    default_sf_m3t: number | null;
    un_number: string | null;
    imo_class: string | null;
    sort_order: number;
    notes: string | null;
  }>,
) {
  const c = await client();
  const { error } = await c.from("commodities").update(fields).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/commodities");
  return { success: true };
}

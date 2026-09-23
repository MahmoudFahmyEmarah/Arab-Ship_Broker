"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { gateAdminEdit, gateAdminInsert, gateSummary } from "@/lib/dq/admin-gate";

// Reference data, gated on the admin channel (21 Sep 2026).
//
// A commodity is PUBLISHED when is_active is true: the read policy is
// `is_active = true`, so that boolean decides whether members can pick it and
// whether cargo can be posted against it. Commodities carry the naming and
// classification rules (DQ-C06, DQ-C09, DQ-D01..D05, DQ-K01/K02), several at
// error severity — which blocks on this channel. Nothing judged these writes
// before.
//
// Publishing or editing a published commodity is strict and fails closed.
// Deactivating, reordering, and editing an inactive commodity are evaluated
// for the record and never refused.

async function actor() {
  const admin = await requireAdmin({ section: "commodities", edit: true });
  return { client: getSupabaseAdminClient(), who: { id: admin.supabaseUserId, name: "Admin commodities" } };
}

/** Activating publishes the commodity; deactivating withdraws it. */
export async function setCommodityActive(id: string, isActive: boolean) {
  const { client, who } = await actor();
  const judged = await gateAdminEdit(client, "commodities", id, { is_active: isActive }, { ...who, name: `Admin commodities · ${isActive ? "activate" : "deactivate"}` }, { strict: isActive, what: "commodity" });
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("commodities").update({ is_active: isActive }).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/commodities");
  return { success: true, gate: gateSummary(judged.gate) };
}

/** Presentation only — where it sits in the picker. Evaluated, never refused. */
export async function updateCommoditySortOrder(id: string, sortOrder: number) {
  const { client, who } = await actor();
  const judged = await gateAdminEdit(client, "commodities", id, { sort_order: sortOrder }, { ...who, name: "Admin commodities · sort order" }, { strict: false, what: "commodity" });
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("commodities").update({ sort_order: sortOrder }).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/commodities");
  return { success: true, gate: gateSummary(judged.gate) };
}

/** Created active, so this publishes: strict. */
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
  const { client, who } = await actor();
  const row = { ...fields, is_active: true };
  const judged = await gateAdminInsert(client, "commodities", row, { ...who, name: "Admin commodities · create" }, { strict: true, what: "commodity" });
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("commodities").insert(row);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/commodities");
  return { success: true, gate: gateSummary(judged.gate) };
}

/** Strict while the commodity is published; evaluated only when it is not. */
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
  const { client, who } = await actor();
  const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return { success: false, error: "nothing to change" };
  const { data: row } = await client.from("commodities").select("is_active").eq("id", id).maybeSingle();
  const published = !!(row as { is_active?: boolean } | null)?.is_active;
  const judged = await gateAdminEdit(client, "commodities", id, patch, { ...who, name: "Admin commodities · edit" }, { strict: published, what: "commodity" });
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("commodities").update(patch).eq("id", id);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/commodities");
  return { success: true, gate: gateSummary(judged.gate) };
}

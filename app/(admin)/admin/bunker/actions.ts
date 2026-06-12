"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

// All actions run as the authenticated admin (cookie session), so the
// fn_is_admin()-gated RLS on the bunker tables + the credential RPC apply.
function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function addSupplier(formData: FormData) {
  await requireAdmin({ section: "bunker", edit: true });
  const supabase = await getSupabaseServerClient();
  const name = String(formData.get("name") || "").trim();
  if (!name) return;
  await supabase.from("bunker_suppliers").insert({
    name,
    slug: slugify(name) || crypto.randomUUID().slice(0, 8),
    port: String(formData.get("port") || "").trim() || null,
    website: String(formData.get("website") || "").trim() || null,
  });
  revalidatePath("/admin/bunker");
}

export async function toggleSupplier(formData: FormData) {
  await requireAdmin({ section: "bunker", edit: true });
  const supabase = await getSupabaseServerClient();
  const id = String(formData.get("id"));
  const active = String(formData.get("active")) === "true";
  await supabase.from("bunker_suppliers").update({ is_active: !active }).eq("id", id);
  revalidatePath("/admin/bunker");
}

export async function addPrice(formData: FormData) {
  await requireAdmin({ section: "bunker", edit: true });
  const supabase = await getSupabaseServerClient();
  const supplier_id = String(formData.get("supplier_id"));
  const fuel = String(formData.get("fuel") || "").trim();
  const value = Number(formData.get("value"));
  const dir = String(formData.get("dir") || "") || null;
  if (!supplier_id || !fuel || !Number.isFinite(value)) return;
  await supabase.from("bunker_prices").insert({
    supplier_id,
    fuel,
    value,
    dir: dir === "" ? null : dir,
    source: "admin",
  });
  revalidatePath("/admin/bunker");
}

export async function setCredential(formData: FormData) {
  await requireAdmin({ section: "bunker", edit: true });
  const supabase = await getSupabaseServerClient();
  const supplier_id = String(formData.get("supplier_id"));
  const username = String(formData.get("username") || "").trim();
  const secret = String(formData.get("secret") || "");
  if (!supplier_id || !username || !secret) return;
  // Hashing happens in the DB (pgcrypto) via the SECURITY DEFINER RPC.
  await supabase.rpc("admin_set_bunker_credential", {
    p_supplier_id: supplier_id,
    p_username: username,
    p_secret: secret,
  });
  revalidatePath("/admin/bunker");
}

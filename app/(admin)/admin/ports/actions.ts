"use server";

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { gateAdminEdit, gateAdminInsert, gateSummary } from "@/lib/dq/admin-gate";

// Reference data, gated on the admin channel (21 Sep 2026).
//
// A port is PUBLISHED the moment is_verified becomes true: the table's read
// policy is `is_verified = true`, so that one boolean is what puts a port in
// front of every member, in every port picker, and into the route estimates
// built from it. verifyPort and createPort set it, and nothing judged either
// of them — ports carry four enabled rules (DQ-R01..R04) plus the identity
// rules DQ-K01/K02, and an error-severity rule blocks on this channel.
//
// So: anything that publishes or edits a published port is judged strictly and
// fails closed. Un-publishing, and editing a port that is not published yet,
// is evaluated for the record and never refused.

async function actor() {
  const admin = await requireAdmin({ section: "ports", edit: true });
  return { client: getSupabaseAdminClient(), who: { id: admin.supabaseUserId, name: "Admin ports" } };
}

/** Publish a port: it becomes visible to every member. Strict. */
export async function verifyPort(locode: string) {
  const { client, who } = await actor();
  const judged = await gateAdminEdit(client, "ports", locode, { is_verified: true }, { ...who, name: "Admin ports · verify" }, { strict: true, idColumn: "locode", what: "port" });
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("ports").update({ is_verified: true }).eq("locode", locode);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/ports");
  revalidatePath("/admin/dashboard");
  return { success: true, gate: gateSummary(judged.gate) };
}

/** Activating a port offers it in the pickers; deactivating withdraws it. */
export async function setPortActive(locode: string, isActive: boolean) {
  const { client, who } = await actor();
  const judged = await gateAdminEdit(client, "ports", locode, { is_active: isActive }, { ...who, name: `Admin ports · ${isActive ? "activate" : "deactivate"}` }, { strict: isActive, idColumn: "locode", what: "port" });
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("ports").update({ is_active: isActive }).eq("locode", locode);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/ports");
  return { success: true, gate: gateSummary(judged.gate) };
}

/** Edit a port. Strict while the port is published; otherwise evaluated only. */
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
  const { client, who } = await actor();
  const patch = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (!Object.keys(patch).length) return { success: false, error: "nothing to change" };
  // Read first, so strictness follows the row: editing a port members can
  // already see is a publication; editing an unverified one is not.
  const { data: row } = await client.from("ports").select("is_verified").eq("locode", locode).maybeSingle();
  const published = !!(row as { is_verified?: boolean } | null)?.is_verified;
  const judged = await gateAdminEdit(client, "ports", locode, patch, { ...who, name: "Admin ports · edit" }, { strict: published, idColumn: "locode", what: "port" });
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("ports").update(patch).eq("locode", locode);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/ports");
  return { success: true, gate: gateSummary(judged.gate) };
}

/** Create a port. It is created verified, so this publishes: strict. */
export async function createPort(fields: {
  locode: string;
  trade_name: string;
  country: string;
  zone: string;
  port_type: string;
  notes?: string;
}) {
  const { client, who } = await actor();
  const row = { ...fields, is_active: true, is_verified: true };
  const judged = await gateAdminInsert(client, "ports", row, { ...who, name: "Admin ports · create" }, { strict: true, what: "port" });
  if (!judged.ok) return { success: false, error: judged.error };
  const { error } = await client.from("ports").insert(row);
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/ports");
  return { success: true, gate: gateSummary(judged.gate) };
}

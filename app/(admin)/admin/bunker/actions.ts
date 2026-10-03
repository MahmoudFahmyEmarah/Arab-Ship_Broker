"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

// Fuel Bar admin commands. Each runs after requireAdmin({section: "bunker",
// edit: true}) and calls a service-role RPC that re-checks p_actor (the
// admin's public.users id) in the database, as the PDA console does.

async function actor() {
  const admin = await requireAdmin({ section: "bunker", edit: true });
  return { actorId: admin.rowId, db: getSupabaseAdminClient() };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => text(form, key) || null;
const num = (form: FormData, key: string) => {
  const v = text(form, key);
  return v === "" ? null : Number(v);
};

function done(tab: string, result: { error: { message: string } | null }, ok: string): never {
  revalidatePath("/admin/bunker");
  const q = result.error
    ? `error=${encodeURIComponent(result.error.message.replace(/^BUNKER_[A-Z]+: /, ""))}`
    : `message=${encodeURIComponent(ok)}`;
  redirect(`/admin/bunker?tab=${tab}&${q}`);
}

/** Create or update a supplier; ports arrive as "GRPIR*, CYLCA" (* = primary). */
export async function saveSupplier(form: FormData) {
  const { actorId, db } = await actor();
  const ports = text(form, "ports")
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((p) => ({ locode: p.replace("*", "").toUpperCase(), isPrimary: p.endsWith("*") }));
  const result = await db.rpc("admin_bunker_upsert_supplier", {
    p_actor: actorId,
    p_supplier: {
      id: optional(form, "id"),
      name: text(form, "name"),
      url: optional(form, "url"),
      country: optional(form, "country"),
      verified: form.get("verified") === "on",
      status: form.get("enabled") === "on" ? "enabled" : "disabled",
      trustScore: num(form, "trustScore") ?? 50,
      notes: optional(form, "notes"),
      contactName: optional(form, "contactName"),
      contactEmail: optional(form, "contactEmail"),
      contactPhone: optional(form, "contactPhone"),
      ports,
    },
  });
  done("suppliers", result, `Supplier "${text(form, "name")}" saved`);
}

/** Link a member account (by email) to a supplier, change its role, or unlink it. */
export async function setSupplierMember(form: FormData) {
  const { actorId, db } = await actor();
  const email = text(form, "email").toLowerCase();
  const role = text(form, "role");
  // Case-insensitive exact match: escape ilike wildcards (an email may contain "_").
  const { data: user } = await db.from("users").select("id")
    .ilike("email", email.replace(/[\\%_]/g, "\\$&")).maybeSingle();
  if (!user) done("suppliers", { error: { message: `No account with the email ${email}` } }, "");
  const result = await db.rpc("admin_bunker_set_member", {
    p_actor: actorId,
    p_supplier_id: text(form, "supplierId"),
    p_user_id: (user as { id: string }).id,
    p_role: role === "remove" ? null : role,
  });
  done("suppliers", result, role === "remove" ? `${email} unlinked` : `${email} linked as ${role}`);
}

/** Admin price entry: override for a supplier, or manual input under the platform supplier. */
export async function overridePrice(form: FormData) {
  const { actorId, db } = await actor();
  const validDays = num(form, "validDays") ?? 14;
  const result = await db.rpc("admin_bunker_override_quote", {
    p_actor: actorId,
    p_supplier_id: text(form, "supplierId"),
    p_quote: {
      portLocode: text(form, "portLocode"),
      productKey: text(form, "productKey"),
      priceUsdMt: num(form, "priceUsdMt"),
      deliveryMode: text(form, "deliveryMode") || "barge",
      minQtyMt: num(form, "minQtyMt"),
      bargeFeeUsd: num(form, "bargeFeeUsd") ?? 0,
      mandatoryChargesUsd: num(form, "mandatoryChargesUsd") ?? 0,
      validUntil: new Date(Date.now() + validDays * 86_400_000).toISOString(),
    },
    p_reason: text(form, "reason"),
  });
  done("prices", result, "Price recorded and live");
}

export async function decideQuote(form: FormData) {
  const { actorId, db } = await actor();
  const decision = text(form, "decision");
  const result = await db.rpc("admin_bunker_decide_quote", {
    p_actor: actorId,
    p_quote_id: text(form, "quoteId"),
    p_decision: decision,
    p_reason: optional(form, "reason"),
  });
  const verb = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "withdrawn";
  done("prices", result, `Quote ${verb}`);
}

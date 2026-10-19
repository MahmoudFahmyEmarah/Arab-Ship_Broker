"use server";

// Port agents console (owner ruling O2ALL-009, Agents phase 1). Owner-only: the registry decides which agencies members
// see at each port. Every command goes through a service-only RPC that re-checks the owner-tier admin actor and logs
// the change in pda_agency_events.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin/require-admin";
import { PDA_ROUTE_SERVICE_CODES } from "@/lib/pda/route-types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();

async function context() {
  const actor = await requireAdmin({ section: "portagents", edit: true });
  return { actorId: actor.rowId, db: getSupabaseAdminClient() };
}

/** The database's PDA_* refusals are written for people; anything else (constraint names, internals) stays generic. */
function dbMessage(error: { message: string }, fallback: string): string {
  if (/^PDA_[A-Z]+: /.test(error.message)) return error.message.replace(/^PDA_[A-Z]+: /, "");
  console.error(`[port-agents] ${fallback}`, error);
  return fallback;
}

function finish(message: string, error = false): never {
  revalidatePath("/admin/port-agents");
  redirect(`/admin/port-agents?${error ? "error" : "message"}=${encodeURIComponent(message)}`);
}

/** Invite (or update) an agency: an existing organisation becomes a listed agency. */
export async function upsertAgency(form: FormData) {
  const { actorId, db } = await context();
  const orgId = value(form, "orgId");
  if (!UUID.test(orgId)) finish("Choose the agency's organisation", true);
  const { error } = await db.rpc("pda_admin_upsert_agency", {
    p_actor: actorId,
    p_org_id: orgId,
    p_payload: { displayName: value(form, "displayName"), website: value(form, "website") || null, status: value(form, "status") || "active" },
  });
  if (error) finish(dbMessage(error, "The agency could not be saved"), true);
  finish("Agency saved");
}

/** List an agency at a verified port with the services it quotes, or withdraw it from that port. */
export async function setPortAgent(form: FormData) {
  const { actorId, db } = await context();
  const orgId = value(form, "orgId");
  if (!UUID.test(orgId)) finish("Unknown agency", true);
  const services = form.getAll("services").map(String).filter((s) => (PDA_ROUTE_SERVICE_CODES as readonly string[]).includes(s));
  const { error } = await db.rpc("pda_admin_set_port_agent", {
    p_actor: actorId,
    p_org_id: orgId,
    p_port_locode: value(form, "portLocode").toUpperCase(),
    p_services: services,
    p_active: value(form, "active") !== "false",
  });
  if (error) finish(dbMessage(error, "The port listing could not be saved"), true);
  finish(value(form, "active") === "false" ? "Agency withdrawn from the port" : "Port listing saved");
}

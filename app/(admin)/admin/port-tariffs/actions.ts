"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => value(form, key) || null;

async function context() {
  // Financial source authority stays owner-only, under its own admin section.
  const actor = await requireAdmin({ section: "porttariffs", edit: true });
  return { actorId: actor.rowId, db: getSupabaseAdminClient() };
}

function finish(message: string, error = false): never {
  revalidatePath("/admin/port-tariffs");
  redirect(`/admin/port-tariffs?${error ? "error" : "message"}=${encodeURIComponent(message)}`);
}

function rpcError(error: { message: string } | null, success: string): never {
  if (error) finish(error.message, true);
  finish(success);
}

export async function createPublisher(form: FormData) {
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_upsert_tariff_publisher", { p_actor: actorId, p_payload: {
    name: value(form, "name"), publisherType: value(form, "publisherType"), country: optional(form, "country"), website: optional(form, "website"),
  }});
  rpcError(error, "Publisher saved");
}

export async function upsertTerminal(form: FormData) {
  const { actorId, db } = await context();
  const aliases = value(form, "aliases").split(",").map((item) => item.trim()).filter(Boolean);
  const { error } = await db.rpc("pda_upsert_port_terminal", { p_actor: actorId, p_payload: {
    id: optional(form, "terminalId"), portLocode: value(form, "portLocode").toUpperCase(),
    name: value(form, "name"), aliases,
  }});
  rpcError(error, "Terminal saved for independent verification");
}

export async function verifyTerminal(form: FormData) {
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_verify_port_terminal", { p_actor: actorId, p_terminal_id: value(form, "terminalId") });
  rpcError(error, "Terminal verified");
}

export async function registerSource(form: FormData) {
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_register_tariff_source", { p_actor: actorId, p_source: {
    publisherId: optional(form, "publisherId"), title: value(form, "title"), sourceFilename: value(form, "sourceFilename"),
    mimeType: value(form, "mimeType"), sha256: value(form, "sha256").toLowerCase(), storagePath: optional(form, "storagePath"),
    sourceUri: optional(form, "sourceUri"), language: optional(form, "language"), authority: value(form, "authority"),
    issueDate: optional(form, "issueDate"), effectiveFrom: optional(form, "effectiveFrom"), effectiveTo: optional(form, "effectiveTo"),
    currentnessNote: optional(form, "currentnessNote"),
  }});
  rpcError(error, "Evidence source registered");
}

export async function stageImport(form: FormData) {
  let rows: unknown;
  try {
    rows = JSON.parse(value(form, "rowsJson"));
  } catch (error) { finish(error instanceof Error ? error.message : "Invalid staging JSON", true); }
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_stage_tariff_import", {
    p_actor: actorId, p_source_id: value(form, "sourceId"), p_extractor: value(form, "extractor") || "admin-json",
    p_rows: rows, p_meta: { submittedFrom: "admin-port-tariffs" },
  });
  rpcError(error, "Extracted rows staged for review");
}

export async function decideStagedRule(form: FormData) {
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_decide_staged_rule", {
    p_actor: actorId, p_rule_id: value(form, "ruleId"), p_decision: value(form, "decision"), p_note: optional(form, "note"),
  });
  rpcError(error, "Staged rule reviewed");
}

export async function createDraft(form: FormData) {
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_create_tariff_draft", { p_actor: actorId, p_payload: {
    tariffSetId: optional(form, "tariffSetId"), portLocode: value(form, "portLocode").toUpperCase(), terminalId: optional(form, "terminalId"),
    publisherId: value(form, "publisherId"), name: value(form, "name"), scope: value(form, "scope"),
    versionNo: Number(value(form, "versionNo")), currency: value(form, "currency").toUpperCase(),
    effectiveFrom: value(form, "effectiveFrom"), effectiveTo: optional(form, "effectiveTo"), roundingMode: value(form, "roundingMode"),
    decimalPlaces: Number(value(form, "decimalPlaces") || 2), primarySourceId: value(form, "primarySourceId"),
    supersedesId: optional(form, "supersedesId"), notes: optional(form, "notes"),
  }});
  rpcError(error, "Tariff draft created");
}

export async function replaceRules(form: FormData) {
  let rules: unknown;
  try {
    rules = JSON.parse(value(form, "rulesJson"));
  } catch (error) { finish(error instanceof Error ? error.message : "Invalid rules JSON", true); }
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_replace_tariff_rules", { p_actor: actorId, p_version_id: value(form, "versionId"), p_rules: rules });
  rpcError(error, "Typed tariff rules replaced");
}

export async function submitVersion(form: FormData) {
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_submit_tariff_version", { p_actor: actorId, p_version_id: value(form, "versionId") });
  rpcError(error, "Tariff submitted for independent review");
}

export async function publishVersion(form: FormData) {
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_publish_tariff_version", { p_actor: actorId, p_version_id: value(form, "versionId") });
  rpcError(error, "Tariff published");
}

export async function returnVersion(form: FormData) {
  const { actorId, db } = await context();
  const { error } = await db.rpc("pda_return_tariff_version", {
    p_actor: actorId, p_version_id: value(form, "versionId"), p_note: value(form, "note"),
  });
  rpcError(error, "Tariff returned to its maker");
}

export async function recordFxRate(form: FormData) {
  const { actorId, db } = await context();
  const rate = Number(value(form, "rate"));
  const { error } = await db.rpc("pda_record_fx_rate", { p_actor: actorId, p_payload: {
    baseCurrency: value(form, "baseCurrency").toUpperCase(), quoteCurrency: value(form, "quoteCurrency").toUpperCase(),
    rate: Number.isFinite(rate) ? rate : null, effectiveOn: value(form, "effectiveOn"),
    sourceKind: value(form, "sourceKind"), sourceRef: value(form, "sourceRef"),
  }});
  rpcError(error, "FX rate recorded");
}

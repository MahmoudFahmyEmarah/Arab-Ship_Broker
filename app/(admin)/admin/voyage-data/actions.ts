"use server";

// Voyage estimator data — admin writes (Voyage Economics, Stream S).
// Suez tariff versions/items/tiers, governed source records, SDR rates,
// voyage_settings and ECA zones. Every write: owner/IT admin with edit on
// "voyagedata" → zod validation → service-role write (tables are closed to
// members) → an event row (suez_tariff_events; the version/SDR triggers write
// theirs) → redirect with a message. Published Suez versions are immutable by
// trigger; only drafts are edited. SDR rates are never deleted, only voided.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseTierCsv, sdrRateInputSchema, suezItemInputSchema, suezSourceInputSchema, suezVersionInputSchema } from "@/lib/suez/schemas";
import { parseVoyageSettings } from "@/lib/voyage/schemas";
import { DEFAULT_VOYAGE_SETTINGS } from "@/lib/voyage/types";

const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => value(form, key) || null;
const number = (form: FormData, key: string) => { const v = value(form, key); return v === "" ? NaN : Number(v); };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

type Db = ReturnType<typeof getSupabaseAdminClient>;

async function context() {
  const actor = await requireAdmin({ section: "voyagedata", edit: true });
  return { actorId: actor.rowId, db: getSupabaseAdminClient() };
}

function finish(message: string, opts: { error?: boolean; tab?: string; version?: string | null } = {}): never {
  revalidatePath("/admin/voyage-data");
  const q = new URLSearchParams();
  if (opts.tab) q.set("tab", opts.tab);
  if (opts.version) q.set("version", opts.version);
  q.set(opts.error ? "error" : "message", message);
  redirect(`/admin/voyage-data?${q.toString()}`);
}

function parseJson(text: string, what: string, tab: string): unknown {
  try { return text ? JSON.parse(text) : {}; } catch (e) { finish(`${what}: ${e instanceof Error ? e.message : "invalid JSON"}`, { error: true, tab }); }
}

// Event rows for the writes the database triggers do not cover themselves.
async function event(db: Db, actorId: string, entity: string, action: string, details: Record<string, unknown>, ids: { entityId?: string | null; versionId?: string | null } = {}) {
  await db.from("suez_tariff_events").insert({ entity, entity_id: ids.entityId ?? null, version_id: ids.versionId ?? null, action, actor_user_id: actorId, details });
}

// ── Suez tariff versions ───────────────────────────────────────────────────

export async function createVersion(form: FormData) {
  const { actorId, db } = await context();
  const parsed = suezVersionInputSchema.safeParse({
    effectiveFrom: value(form, "effectiveFrom"), effectiveTo: optional(form, "effectiveTo"),
    sourceRef: value(form, "sourceRef"), sourceUrl: optional(form, "sourceUrl") ?? "", notes: optional(form, "notes"),
  });
  if (!parsed.success) finish(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), { error: true, tab: "suez" });
  const { data: maxRow } = await db.from("suez_tariff_versions").select("version_no").order("version_no", { ascending: false }).limit(1).maybeSingle();
  const versionNo = (maxRow?.version_no ?? 0) + 1;
  const { data: created, error } = await db.from("suez_tariff_versions").insert({
    version_no: versionNo, status: "draft", effective_from: parsed.data.effectiveFrom, effective_to: parsed.data.effectiveTo,
    source_ref: parsed.data.sourceRef, source_url: parsed.data.sourceUrl || null, notes: parsed.data.notes, created_by: actorId,
  }).select("id").single();
  if (error || !created) finish(error?.message ?? "Version not created", { error: true, tab: "suez" });

  const copyFrom = optional(form, "copyFromVersionId");
  let copied = "";
  if (copyFrom) {
    const [{ data: items }, { data: tiers }, { data: cites }] = await Promise.all([
      db.from("suez_tariff_items").select("code,label_en,label_ar,layer,basis,currency,params,direction_scope,cargo_status_scope,condition_key,payer_party,sort_order,is_active,notes").eq("version_id", copyFrom),
      db.from("suez_toll_tiers").select("vessel_category,cargo_status,tier_order,scnt_from,scnt_to,sdr_per_scnt,confidence").eq("version_id", copyFrom),
      db.from("suez_tariff_version_sources").select("source_id").eq("version_id", copyFrom),
    ]);
    if (items?.length) {
      const { error: e1 } = await db.from("suez_tariff_items").insert(items.map((i) => ({ ...i, version_id: created.id })));
      if (e1) finish(`Version ${versionNo} created but items not copied: ${e1.message}`, { error: true, tab: "suez", version: created.id });
    }
    if (tiers?.length) {
      const { error: e2 } = await db.from("suez_toll_tiers").insert(tiers.map((t) => ({ ...t, version_id: created.id })));
      if (e2) finish(`Version ${versionNo} created but tiers not copied: ${e2.message}`, { error: true, tab: "suez", version: created.id });
    }
    if (cites?.length) {
      const { error: e3 } = await db.from("suez_tariff_version_sources").insert(cites.map((c) => ({ version_id: created.id, source_id: c.source_id })));
      if (e3) finish(`Version ${versionNo} created but source citations not copied: ${e3.message}`, { error: true, tab: "suez", version: created.id });
    }
    copied = ` with copied items and tiers (${items?.length ?? 0} items, ${tiers?.length ?? 0} bands, ${cites?.length ?? 0} sources)`;
    await event(db, actorId, "version", "copied_from", { fromVersionId: copyFrom, items: items?.length ?? 0, tiers: tiers?.length ?? 0, sources: cites?.length ?? 0 }, { entityId: created.id, versionId: created.id });
  }
  finish(`Draft version ${versionNo} created${copied}`, { tab: "suez", version: created.id });
}

export async function updateVersionWindow(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  const effectiveTo = optional(form, "effectiveTo");
  if (effectiveTo && !ISO_DATE.test(effectiveTo)) finish("effective_to must be YYYY-MM-DD", { error: true, tab: "suez", version: id });
  // The RPC hands the acting admin to the version trigger, which records the window change (20261003205200).
  const { error } = await db.rpc("admin_suez_set_window", { p_version_id: id, p_actor: actorId, p_effective_to: effectiveTo, p_notes: optional(form, "notes") });
  if (error) finish(error.message, { error: true, tab: "suez", version: id });
  finish("Version window saved", { tab: "suez", version: id });
}

export async function publishVersion(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  if (value(form, "confirm") !== "PUBLISH") finish("Type PUBLISH to confirm (second confirmation step)", { error: true, tab: "suez", version: id });
  const { data: v } = await db.from("suez_tariff_versions").select("id,version_no,status,effective_from,effective_to,created_by").eq("id", id).maybeSingle();
  if (!v) finish("Version not found", { error: true, tab: "suez" });
  if (v.status !== "draft") finish(`Version ${v.version_no} is ${v.status}; only drafts publish`, { error: true, tab: "suez", version: id });
  const [{ count: itemCount }, { count: tierCount }, { count: sourceCount }] = await Promise.all([
    db.from("suez_tariff_items").select("id", { count: "exact", head: true }).eq("version_id", id).eq("is_active", true),
    db.from("suez_toll_tiers").select("id", { count: "exact", head: true }).eq("version_id", id),
    db.from("suez_tariff_version_sources").select("source_id", { count: "exact", head: true }).eq("version_id", id),
  ]);
  if (!itemCount) finish("A version without active items cannot be published", { error: true, tab: "suez", version: id });
  if (!sourceCount) finish("A version cites no source record: register the circular / guide it is built from and cite it before publishing", { error: true, tab: "suez", version: id });
  // Close the open published version that precedes this one, so the windows do not overlap.
  const { data: open } = await db.from("suez_tariff_versions").select("id,version_no,effective_from").eq("status", "published").is("effective_to", null).lt("effective_from", v.effective_from).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (open) {
    const dayBefore = new Date(`${v.effective_from}T00:00:00Z`); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const { error: eClose } = await db.rpc("admin_suez_set_window", { p_version_id: open.id, p_actor: actorId, p_effective_to: dayBefore.toISOString().slice(0, 10), p_notes: null });
    if (eClose) finish(`Could not close version ${open.version_no}: ${eClose.message}`, { error: true, tab: "suez", version: id });
  }
  // The version trigger validates every item's params and the bands' contiguity (fn_suez_validate_version) and writes the event with the actor the RPC carries.
  const { error } = await db.rpc("admin_suez_set_status", { p_version_id: id, p_actor: actorId, p_status: "published" });
  if (error) {
    if (open) await db.rpc("admin_suez_set_window", { p_version_id: open.id, p_actor: actorId, p_effective_to: null, p_notes: null });
    finish(error.message.replace(/^.*SUEZ_INVALID:\s*/, "Not published — "), { error: true, tab: "suez", version: id });
  }
  const checker = v.created_by && v.created_by !== actorId ? "" : " · maker = checker: the typed confirmation stands in for a second admin";
  finish(`Version ${v.version_no} published (${itemCount} items, ${tierCount ?? 0} toll bands, ${sourceCount} sources)${open ? `; version ${open.version_no} closed the day before` : ""}${tierCount ? "" : ". No toll bands: the toll layer stays unavailable until bands are loaded in a new version"}${checker}`, { tab: "suez", version: id });
}

export async function withdrawVersion(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  const { error } = await db.rpc("admin_suez_set_status", { p_version_id: id, p_actor: actorId, p_status: "withdrawn" });
  if (error) finish(error.message, { error: true, tab: "suez", version: id });
  finish("Version withdrawn", { tab: "suez", version: id });
}

export async function deleteDraftVersion(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  const { error } = await db.rpc("admin_suez_delete_draft", { p_version_id: id, p_actor: actorId });
  if (error) finish(error.message, { error: true, tab: "suez", version: id });
  finish("Draft deleted", { tab: "suez" });
}

// ── Governed source records ────────────────────────────────────────────────

export async function registerSource(form: FormData) {
  const { actorId, db } = await context();
  const versionId = optional(form, "citeVersionId");
  const parsed = suezSourceInputSchema.safeParse({
    title: value(form, "title"), issuer: value(form, "issuer"), documentNo: optional(form, "documentNo"),
    issueDate: optional(form, "issueDate"), effectiveFrom: optional(form, "effectiveFrom"),
    authority: value(form, "authority") || "official", evidenceStatus: value(form, "evidenceStatus") || "pending_document",
    sha256: optional(form, "sha256")?.toLowerCase() ?? null, sourceFilename: optional(form, "sourceFilename"),
    sourceUri: optional(form, "sourceUri"), notes: optional(form, "notes"),
  });
  if (!parsed.success) finish(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), { error: true, tab: "suez", version: versionId });
  const d = parsed.data;
  const { data: created, error } = await db.from("suez_tariff_sources").insert({
    title: d.title, issuer: d.issuer, document_no: d.documentNo ?? null, issue_date: d.issueDate ?? null, effective_from: d.effectiveFrom ?? null,
    authority: d.authority, evidence_status: d.evidenceStatus, sha256: d.sha256 ?? null, source_filename: d.sourceFilename ?? null,
    source_uri: d.sourceUri ?? null, notes: d.notes ?? null, registered_by: actorId,
  }).select("id").single();
  if (error || !created) finish(error?.message ?? "Source not registered", { error: true, tab: "suez", version: versionId });
  await event(db, actorId, "source", "registered", { title: d.title, issuer: d.issuer, documentNo: d.documentNo ?? null, evidenceStatus: d.evidenceStatus, sha256: d.sha256 ?? null }, { entityId: created.id });
  if (versionId) {
    const { error: eCite } = await db.from("suez_tariff_version_sources").insert({ version_id: versionId, source_id: created.id });
    if (eCite) finish(`Source registered but not cited on the version: ${eCite.message}`, { error: true, tab: "suez", version: versionId });
    await event(db, actorId, "version", "source_cited", { sourceId: created.id, title: d.title }, { entityId: versionId, versionId });
  }
  finish(`Source "${d.title}" registered${versionId ? " and cited" : ""}${d.evidenceStatus === "pending_document" ? " (document pending: no SHA-256 on file yet)" : ""}`, { tab: "suez", version: versionId });
}

export async function citeSource(form: FormData) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const sourceId = value(form, "sourceId");
  if (!UUID.test(versionId) || !UUID.test(sourceId)) finish("Pick a version and a source", { error: true, tab: "suez", version: versionId });
  const { data: v } = await db.from("suez_tariff_versions").select("status").eq("id", versionId).maybeSingle();
  if (v?.status !== "draft") finish("Only a draft version takes new citations; published versions are immutable", { error: true, tab: "suez", version: versionId });
  const { error } = await db.from("suez_tariff_version_sources").upsert({ version_id: versionId, source_id: sourceId }, { onConflict: "version_id,source_id" });
  if (error) finish(error.message, { error: true, tab: "suez", version: versionId });
  await event(db, actorId, "version", "source_cited", { sourceId }, { entityId: versionId, versionId });
  finish("Source cited on the draft", { tab: "suez", version: versionId });
}

export async function unciteSource(form: FormData) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const sourceId = value(form, "sourceId");
  const { data: v } = await db.from("suez_tariff_versions").select("status").eq("id", versionId).maybeSingle();
  if (v?.status !== "draft") finish("Only a draft version loses citations; published versions are immutable", { error: true, tab: "suez", version: versionId });
  const { error } = await db.from("suez_tariff_version_sources").delete().eq("version_id", versionId).eq("source_id", sourceId);
  if (error) finish(error.message, { error: true, tab: "suez", version: versionId });
  await event(db, actorId, "version", "source_uncited", { sourceId }, { entityId: versionId, versionId });
  finish("Citation removed from the draft", { tab: "suez", version: versionId });
}

// ── Items and toll tiers (draft versions only; the trigger refuses otherwise) ──

export async function saveItem(form: FormData) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const itemId = optional(form, "itemId");
  const params = parseJson(value(form, "params"), "params", "suez");
  const parsed = suezItemInputSchema.safeParse({
    code: value(form, "code"), labelEn: value(form, "labelEn"), labelAr: optional(form, "labelAr"),
    layer: value(form, "layer"), basis: value(form, "basis"), currency: value(form, "currency"), params,
    directionScope: value(form, "directionScope") || "any", cargoStatusScope: value(form, "cargoStatusScope") || "any",
    conditionKey: optional(form, "conditionKey"), payerParty: value(form, "payerParty") || "owner",
    sortOrder: Number.isFinite(number(form, "sortOrder")) ? number(form, "sortOrder") : 100,
    isActive: value(form, "isActive") !== "0", notes: optional(form, "notes"),
  });
  if (!parsed.success) finish(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), { error: true, tab: "suez", version: versionId });
  const d = parsed.data;
  const row = {
    version_id: versionId, code: d.code, label_en: d.labelEn, label_ar: d.labelAr ?? null, layer: d.layer, basis: d.basis, currency: d.currency,
    params: d.params, direction_scope: d.directionScope, cargo_status_scope: d.cargoStatusScope, condition_key: d.conditionKey ?? null,
    payer_party: d.payerParty, sort_order: d.sortOrder, is_active: d.isActive, notes: d.notes ?? null,
  };
  const { data: saved, error } = itemId
    ? await db.from("suez_tariff_items").update(row).eq("id", itemId).eq("version_id", versionId).select("id").single()
    : await db.from("suez_tariff_items").insert(row).select("id").single();
  if (error) finish(error.message, { error: true, tab: "suez", version: versionId });
  await event(db, actorId, "item", itemId ? "updated" : "added", { code: d.code, layer: d.layer, basis: d.basis, params: d.params }, { entityId: saved?.id ?? itemId, versionId });
  finish(`Item ${d.code} saved`, { tab: "suez", version: versionId });
}

export async function deleteItem(form: FormData) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const itemId = value(form, "itemId");
  const { data: it } = await db.from("suez_tariff_items").select("code").eq("id", itemId).maybeSingle();
  const { error } = await db.from("suez_tariff_items").delete().eq("id", itemId).eq("version_id", versionId);
  if (error) finish(error.message, { error: true, tab: "suez", version: versionId });
  await event(db, actorId, "item", "deleted", { code: it?.code ?? null }, { entityId: itemId, versionId });
  finish("Item deleted", { tab: "suez", version: versionId });
}

export async function replaceTiers(form: FormData) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const confidence = value(form, "confidence") === "placeholder" ? "placeholder" : "official";
  const { rows, errors } = parseTierCsv(value(form, "csv"));
  if (errors.length) finish(`Toll bands not saved: ${errors.slice(0, 6).join("; ")}${errors.length > 6 ? ` … (${errors.length} problems)` : ""}`, { error: true, tab: "tiers", version: versionId });
  if (!rows.length) finish("No bands found in the pasted text", { error: true, tab: "tiers", version: versionId });
  const { error: eDel } = await db.from("suez_toll_tiers").delete().eq("version_id", versionId);
  if (eDel) finish(eDel.message, { error: true, tab: "tiers", version: versionId });
  const { error } = await db.from("suez_toll_tiers").insert(rows.map((r) => ({
    version_id: versionId, vessel_category: r.vesselCategory, cargo_status: r.cargoStatus, tier_order: r.tierOrder,
    scnt_from: r.scntFrom, scnt_to: r.scntTo, sdr_per_scnt: r.sdrPerScnt, confidence,
  })));
  if (error) finish(error.message, { error: true, tab: "tiers", version: versionId });
  const cats = new Set(rows.map((r) => r.vesselCategory)).size;
  await event(db, actorId, "tier", "replaced", { bands: rows.length, categories: cats, confidence }, { versionId });
  finish(`${rows.length} toll bands saved for ${cats} categories (${confidence})`, { tab: "tiers", version: versionId });
}

// ── SDR rates (append-only; corrections are a new row, mistakes are voided) ──

export async function addSdrRate(form: FormData) {
  const { actorId, db } = await context();
  const parsed = sdrRateInputSchema.safeParse({ rateUsd: number(form, "rateUsd"), asOf: value(form, "asOf"), source: value(form, "source") || "IMF", notes: optional(form, "notes") });
  if (!parsed.success) finish(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), { error: true, tab: "sdr" });
  if (parsed.data.asOf > new Date().toISOString().slice(0, 10)) finish("An SDR rate cannot be dated in the future", { error: true, tab: "sdr" });
  // The insert trigger writes the 'recorded' event with the acting admin.
  const { error } = await db.from("sdr_rates").insert({ rate_usd: parsed.data.rateUsd, as_of: parsed.data.asOf, source: parsed.data.source, notes: parsed.data.notes, created_by: actorId });
  if (error) finish(error.message, { error: true, tab: "sdr" });
  finish(`SDR rate ${parsed.data.rateUsd} USD recorded for ${parsed.data.asOf}`, { tab: "sdr" });
}

export async function voidSdrRate(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "rateId");
  const reason = value(form, "reason");
  if (reason.length < 3) finish("Voiding an SDR rate needs a reason (at least 3 characters)", { error: true, tab: "sdr" });
  // The guard trigger refuses any other change and writes the 'voided' event.
  const { error } = await db.from("sdr_rates").update({ voided_at: new Date().toISOString(), void_reason: reason, voided_by: actorId }).eq("id", id).is("voided_at", null);
  if (error) finish(error.message, { error: true, tab: "sdr" });
  finish("SDR rate voided; it no longer feeds any estimate", { tab: "sdr" });
}

// ── Constants & assumptions (app_settings.voyage_settings) ─────────────────

export async function saveVoyageSettings(form: FormData) {
  const { actorId, db } = await context();
  const byLane = parseJson(value(form, "byLane") || "{}", "Sea margin by lane", "constants");
  const bySeason = parseJson(value(form, "bySeason") || "{}", "Sea margin by season", "constants");
  const fuelFallback = parseJson(value(form, "fuelFallback") || "{}", "Fuel fallback prices", "constants");
  const candidate = {
    speeds: { ladenKn: number(form, "ladenKn"), ballastKn: number(form, "ballastKn") },
    seaMargin: { defaultPct: number(form, "seaMarginPct"), byLane, bySeason },
    portTimeDays: { loadDefault: number(form, "loadDefault"), dischDefault: number(form, "dischDefault"), idleSharePct: number(form, "idleSharePct") },
    anchorageDaysDefault: number(form, "anchorageDaysDefault"),
    suez: { transitDays: number(form, "suezTransitDays"), anchorageDays: number(form, "suezAnchorageDays"), nm: number(form, "suezNm") },
    opex: { crewUsdDay: number(form, "crewUsdDay"), maintenanceUsdDay: number(form, "maintenanceUsdDay") },
    classMultipliers: { A: number(form, "classA"), B: number(form, "classB"), C: number(form, "classC") },
    eca: { fuelProductKey: value(form, "ecaFuelProductKey") || DEFAULT_VOYAGE_SETTINGS.eca.fuelProductKey, distillateProductKey: value(form, "ecaDistillateProductKey") || DEFAULT_VOYAGE_SETTINGS.eca.distillateProductKey },
    fuelFallback,
  };
  const parsed = parseVoyageSettings(candidate);
  if (!parsed.ok) finish(parsed.error, { error: true, tab: "constants" });
  // An admin-edited row drops the seed marker on purpose: the DOWN script removes only the untouched seed.
  const { data: before } = await db.from("app_settings").select("value").eq("key", "voyage_settings").maybeSingle();
  const { error } = await db.from("app_settings").upsert({ key: "voyage_settings", value: parsed.value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) finish(error.message, { error: true, tab: "constants" });
  await event(db, actorId, "settings", before ? "updated" : "created", { before: before?.value ?? null, after: parsed.value });
  revalidatePath("/dashboard", "layout");
  finish("Voyage constants saved", { tab: "constants" });
}

// ── ECA zones (versioned geometry with its source) ─────────────────────────

export async function upsertEcaZone(form: FormData) {
  const { actorId, db } = await context();
  const code = value(form, "code").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,20}$/.test(code)) finish("Zone code: upper-case letters, digits, underscore", { error: true, tab: "eca" });
  const polygon = parseJson(value(form, "polygon"), "Polygon", "eca");
  if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) {
    finish("Polygon must be a JSON array of at least three [lat, lon] pairs", { error: true, tab: "eca" });
  }
  const sulphur = number(form, "sulphurLimitPct");
  const effectiveFrom = value(form, "effectiveFrom");
  const effectiveTo = optional(form, "effectiveTo");
  if (!ISO_DATE.test(effectiveFrom)) finish("effective_from must be YYYY-MM-DD", { error: true, tab: "eca" });
  if (effectiveTo && !ISO_DATE.test(effectiveTo)) finish("effective_to must be YYYY-MM-DD", { error: true, tab: "eca" });
  const geometryVersion = value(form, "geometryVersion");
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(geometryVersion)) finish("Geometry version is required (e.g. MED@2026-10-04)", { error: true, tab: "eca" });
  const sourceRef = value(form, "sourceRef");
  if (sourceRef.length < 3) finish("A geometry needs its source reference (regulation, chart or dataset)", { error: true, tab: "eca" });
  const sha256 = optional(form, "sha256")?.toLowerCase() ?? null;
  if (sha256 && !/^[a-f0-9]{64}$/.test(sha256)) finish("SHA-256 must be 64 hex characters", { error: true, tab: "eca" });
  const confidence = value(form, "confidence") === "official" ? "official" : "coarse";
  if (confidence === "official" && !sha256) finish("An official geometry needs the SHA-256 of its source file", { error: true, tab: "eca" });
  const { data: before } = await db.from("eca_zones").select("geometry_version").eq("code", code).maybeSingle();
  const { error } = await db.from("eca_zones").upsert({
    code, name: value(form, "name"), polygon, sulphur_limit_pct: Number.isFinite(sulphur) ? sulphur : 0.1,
    effective_from: effectiveFrom, effective_to: effectiveTo, is_active: value(form, "isActive") !== "0", notes: optional(form, "notes"),
    geometry_version: geometryVersion, source_ref: sourceRef, source_url: optional(form, "sourceUrl"), sha256, confidence,
    updated_by: actorId, updated_at: new Date().toISOString(),
  }, { onConflict: "code" });
  if (error) finish(error.message, { error: true, tab: "eca" });
  await event(db, actorId, "eca_zone", before ? "replaced" : "added", { code, fromGeometryVersion: before?.geometry_version ?? null, geometryVersion, points: (polygon as unknown[]).length, confidence, sourceRef, sha256 });
  finish(`ECA zone ${code} saved as geometry ${geometryVersion} (${(polygon as unknown[]).length} points, ${confidence})`, { tab: "eca" });
}

export async function setEcaZoneActive(form: FormData) {
  const { actorId, db } = await context();
  const code = value(form, "code");
  const active = value(form, "isActive") === "1";
  const { error } = await db.from("eca_zones").update({ is_active: active, updated_by: actorId, updated_at: new Date().toISOString() }).eq("code", code);
  if (error) finish(error.message, { error: true, tab: "eca" });
  await event(db, actorId, "eca_zone", active ? "activated" : "deactivated", { code });
  finish(`ECA zone ${code} ${active ? "activated" : "deactivated"}`, { tab: "eca" });
}

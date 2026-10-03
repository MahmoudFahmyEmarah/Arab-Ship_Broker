"use server";

// Voyage estimator data — admin writes (Voyage Economics, Stream S).
// Suez tariff versions/items/tiers, SDR rates, voyage_settings and ECA zones.
// Every write: owner/IT admin with edit on "voyagedata" → zod validation →
// service-role write (tables are closed to members) → redirect with a message.
// Published Suez versions are immutable by trigger; only drafts are edited.

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseTierCsv, sdrRateInputSchema, suezItemInputSchema, suezVersionInputSchema } from "@/lib/suez/schemas";
import { parseVoyageSettings } from "@/lib/voyage/schemas";
import { DEFAULT_VOYAGE_SETTINGS } from "@/lib/voyage/types";

const value = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const optional = (form: FormData, key: string) => value(form, key) || null;
const number = (form: FormData, key: string) => { const v = value(form, key); return v === "" ? NaN : Number(v); };

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
  if (copyFrom) {
    const [{ data: items }, { data: tiers }] = await Promise.all([
      db.from("suez_tariff_items").select("code,label_en,label_ar,layer,basis,currency,params,direction_scope,cargo_status_scope,condition_key,payer_party,sort_order,is_active,notes").eq("version_id", copyFrom),
      db.from("suez_toll_tiers").select("vessel_category,cargo_status,tier_order,scnt_from,scnt_to,sdr_per_scnt,confidence").eq("version_id", copyFrom),
    ]);
    if (items?.length) {
      const { error: e1 } = await db.from("suez_tariff_items").insert(items.map((i) => ({ ...i, version_id: created.id })));
      if (e1) finish(`Version ${versionNo} created but items not copied: ${e1.message}`, { error: true, tab: "suez", version: created.id });
    }
    if (tiers?.length) {
      const { error: e2 } = await db.from("suez_toll_tiers").insert(tiers.map((t) => ({ ...t, version_id: created.id })));
      if (e2) finish(`Version ${versionNo} created but tiers not copied: ${e2.message}`, { error: true, tab: "suez", version: created.id });
    }
  }
  finish(`Draft version ${versionNo} created${copyFrom ? " with copied items and tiers" : ""}`, { tab: "suez", version: created.id });
}

export async function updateVersionWindow(form: FormData) {
  const { db } = await context();
  const id = value(form, "versionId");
  const effectiveTo = optional(form, "effectiveTo");
  if (effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) finish("effective_to must be YYYY-MM-DD", { error: true, tab: "suez", version: id });
  const { error } = await db.from("suez_tariff_versions").update({ effective_to: effectiveTo, notes: optional(form, "notes") ?? undefined }).eq("id", id);
  if (error) finish(error.message, { error: true, tab: "suez", version: id });
  finish("Version window saved", { tab: "suez", version: id });
}

export async function publishVersion(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  if (value(form, "confirm") !== "PUBLISH") finish('Type PUBLISH to confirm (second confirmation step)', { error: true, tab: "suez", version: id });
  const { data: v } = await db.from("suez_tariff_versions").select("id,version_no,status,effective_from,effective_to").eq("id", id).maybeSingle();
  if (!v) finish("Version not found", { error: true, tab: "suez" });
  if (v.status !== "draft") finish(`Version ${v.version_no} is ${v.status}; only drafts publish`, { error: true, tab: "suez", version: id });
  const [{ count: itemCount }, { count: tierCount }] = await Promise.all([
    db.from("suez_tariff_items").select("id", { count: "exact", head: true }).eq("version_id", id).eq("is_active", true),
    db.from("suez_toll_tiers").select("id", { count: "exact", head: true }).eq("version_id", id),
  ]);
  if (!itemCount) finish("A version without active items cannot be published", { error: true, tab: "suez", version: id });
  // Close the open published version that precedes this one, so the windows do not overlap.
  const { data: open } = await db.from("suez_tariff_versions").select("id,version_no,effective_from").eq("status", "published").is("effective_to", null).lt("effective_from", v.effective_from).order("effective_from", { ascending: false }).limit(1).maybeSingle();
  if (open) {
    const dayBefore = new Date(`${v.effective_from}T00:00:00Z`); dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const { error: eClose } = await db.from("suez_tariff_versions").update({ effective_to: dayBefore.toISOString().slice(0, 10) }).eq("id", open.id);
    if (eClose) finish(`Could not close version ${open.version_no}: ${eClose.message}`, { error: true, tab: "suez", version: id });
  }
  const { error } = await db.from("suez_tariff_versions").update({ status: "published", published_at: new Date().toISOString(), published_by: actorId }).eq("id", id);
  if (error) finish(error.message, { error: true, tab: "suez", version: id });
  finish(`Version ${v.version_no} published (${itemCount} items, ${tierCount ?? 0} toll bands)${open ? `; version ${open.version_no} closed the day before` : ""}${tierCount ? "" : ". No toll bands: the toll layer stays unavailable until bands are loaded in a new version"}`, { tab: "suez", version: id });
}

export async function withdrawVersion(form: FormData) {
  const { db } = await context();
  const id = value(form, "versionId");
  const { error } = await db.from("suez_tariff_versions").update({ status: "withdrawn" }).eq("id", id);
  if (error) finish(error.message, { error: true, tab: "suez", version: id });
  finish("Version withdrawn", { tab: "suez", version: id });
}

export async function deleteDraftVersion(form: FormData) {
  const { db } = await context();
  const id = value(form, "versionId");
  const { error } = await db.from("suez_tariff_versions").delete().eq("id", id).eq("status", "draft");
  if (error) finish(error.message, { error: true, tab: "suez", version: id });
  finish("Draft deleted", { tab: "suez" });
}

// ── Items and toll tiers (draft versions only; the trigger refuses otherwise) ──

export async function saveItem(form: FormData) {
  const { db } = await context();
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
  const { error } = itemId
    ? await db.from("suez_tariff_items").update(row).eq("id", itemId).eq("version_id", versionId)
    : await db.from("suez_tariff_items").insert(row);
  if (error) finish(error.message, { error: true, tab: "suez", version: versionId });
  finish(`Item ${d.code} saved`, { tab: "suez", version: versionId });
}

export async function deleteItem(form: FormData) {
  const { db } = await context();
  const versionId = value(form, "versionId");
  const { error } = await db.from("suez_tariff_items").delete().eq("id", value(form, "itemId")).eq("version_id", versionId);
  if (error) finish(error.message, { error: true, tab: "suez", version: versionId });
  finish("Item deleted", { tab: "suez", version: versionId });
}

export async function replaceTiers(form: FormData) {
  const { db } = await context();
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
  finish(`${rows.length} toll bands saved for ${cats} categories (${confidence})`, { tab: "tiers", version: versionId });
}

// ── SDR rates ──────────────────────────────────────────────────────────────

export async function addSdrRate(form: FormData) {
  const { actorId, db } = await context();
  const parsed = sdrRateInputSchema.safeParse({ rateUsd: number(form, "rateUsd"), asOf: value(form, "asOf"), source: value(form, "source") || "IMF", notes: optional(form, "notes") });
  if (!parsed.success) finish(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), { error: true, tab: "sdr" });
  const { error } = await db.from("sdr_rates").upsert({ rate_usd: parsed.data.rateUsd, as_of: parsed.data.asOf, source: parsed.data.source, notes: parsed.data.notes, created_by: actorId }, { onConflict: "as_of" });
  if (error) finish(error.message, { error: true, tab: "sdr" });
  finish(`SDR rate ${parsed.data.rateUsd} USD recorded for ${parsed.data.asOf}`, { tab: "sdr" });
}

export async function deleteSdrRate(form: FormData) {
  const { db } = await context();
  const { error } = await db.from("sdr_rates").delete().eq("id", value(form, "rateId"));
  if (error) finish(error.message, { error: true, tab: "sdr" });
  finish("SDR rate removed", { tab: "sdr" });
}

// ── Constants & assumptions (app_settings.voyage_settings) ─────────────────

export async function saveVoyageSettings(form: FormData) {
  const { db } = await context();
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
    eca: { fuelProductKey: value(form, "ecaFuelProductKey") || DEFAULT_VOYAGE_SETTINGS.eca.fuelProductKey },
    fuelFallback,
  };
  const parsed = parseVoyageSettings(candidate);
  if (!parsed.ok) finish(parsed.error, { error: true, tab: "constants" });
  const { error } = await db.from("app_settings").upsert({ key: "voyage_settings", value: parsed.value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) finish(error.message, { error: true, tab: "constants" });
  revalidatePath("/dashboard", "layout");
  finish("Voyage constants saved", { tab: "constants" });
}

// ── ECA zones ──────────────────────────────────────────────────────────────

export async function upsertEcaZone(form: FormData) {
  const { db } = await context();
  const code = value(form, "code").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,20}$/.test(code)) finish("Zone code: upper-case letters, digits, underscore", { error: true, tab: "eca" });
  const polygon = parseJson(value(form, "polygon"), "Polygon", "eca");
  if (!Array.isArray(polygon) || polygon.length < 3 || !polygon.every((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= 90 && Math.abs(p[1]) <= 180)) {
    finish("Polygon must be a JSON array of at least three [lat, lon] pairs", { error: true, tab: "eca" });
  }
  const sulphur = number(form, "sulphurLimitPct");
  const effectiveFrom = value(form, "effectiveFrom");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) finish("effective_from must be YYYY-MM-DD", { error: true, tab: "eca" });
  const { error } = await db.from("eca_zones").upsert({
    code, name: value(form, "name"), polygon, sulphur_limit_pct: Number.isFinite(sulphur) ? sulphur : 0.1,
    effective_from: effectiveFrom, is_active: value(form, "isActive") !== "0", notes: optional(form, "notes"),
  }, { onConflict: "code" });
  if (error) finish(error.message, { error: true, tab: "eca" });
  finish(`ECA zone ${code} saved (${(polygon as unknown[]).length} points)`, { tab: "eca" });
}

export async function setEcaZoneActive(form: FormData) {
  const { db } = await context();
  const code = value(form, "code");
  const { error } = await db.from("eca_zones").update({ is_active: value(form, "isActive") === "1" }).eq("code", code);
  if (error) finish(error.message, { error: true, tab: "eca" });
  finish(`ECA zone ${code} ${value(form, "isActive") === "1" ? "activated" : "deactivated"}`, { tab: "eca" });
}

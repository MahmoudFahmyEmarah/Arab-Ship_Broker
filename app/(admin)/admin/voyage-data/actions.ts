"use server";

// Voyage estimator data — admin writes (Voyage Economics, Stream S).
// Suez tariff versions/items/tiers, governed source records, SDR rates,
// voyage_settings and ECA zones. Every write: owner/IT admin with edit on
// "voyagedata" → zod validation → ONE transactional RPC (20261003205400) that
// locks what it changes and writes its event row in the same transaction
// (audit C2O-039 P0-5 / P1-10). The service role has no direct write on the
// governed tariff tables any more; SDR rates are inserted/voided directly and
// their triggers write the event in the same statement. Published Suez
// versions are immutable by trigger; only drafts are edited.

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
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Database codes → the admin's language; the governing rule is in the message after the code.
const dbMessage = (m: string) => m.replace(/^.*?(SUEZ|ECA|VOYAGE)_[A-Z]+:\s*/, "");

function parseJson(text: string, what: string, tab: string): unknown {
  try { return text ? JSON.parse(text) : {}; } catch (e) { finish(`${what}: ${e instanceof Error ? e.message : "invalid JSON"}`, { error: true, tab }); }
}

const categoryList = (form: FormData, key: string): string[] | null => {
  const list = form.getAll(key).flatMap((v) => String(v).split(/[\s,;]+/)).map((v) => v.trim()).filter(Boolean);
  return list.length ? [...new Set(list)] : null;
};

// ── Suez tariff versions ───────────────────────────────────────────────────

export async function createVersion(form: FormData) {
  const { actorId, db } = await context();
  const parsed = suezVersionInputSchema.safeParse({
    effectiveFrom: value(form, "effectiveFrom"), effectiveTo: optional(form, "effectiveTo"),
    sourceRef: value(form, "sourceRef"), sourceUrl: optional(form, "sourceUrl") ?? "", notes: optional(form, "notes"),
    surchargeRegime: value(form, "surchargeRegime") || "unknown",
  });
  if (!parsed.success) finish(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), { error: true, tab: "suez" });
  const copyFrom = optional(form, "copyFromVersionId");
  if (copyFrom && !UUID.test(copyFrom)) finish("Pick a version to copy from", { error: true, tab: "suez" });
  const { data, error } = await db.rpc("admin_suez_create_version", { p_actor: actorId, p_version: parsed.data, p_copy_from: copyFrom });
  if (error || !data) finish(dbMessage(error?.message ?? "Version not created"), { error: true, tab: "suez" });
  const r = data as { id: string; versionNo: number; items: number; tiers: number; sources: number };
  const copied = copyFrom ? ` with copied items and tiers (${r.items} items, ${r.tiers} bands, ${r.sources} sources)` : "";
  finish(`Draft version ${r.versionNo} created${copied}`, { tab: "suez", version: r.id });
}

export async function updateVersionWindow(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  const effectiveTo = optional(form, "effectiveTo");
  if (effectiveTo && !ISO_DATE.test(effectiveTo)) finish("effective_to must be YYYY-MM-DD", { error: true, tab: "suez", version: id });
  const { error } = await db.rpc("admin_suez_set_window", { p_version_id: id, p_actor: actorId, p_effective_to: effectiveTo, p_notes: optional(form, "notes") });
  if (error) finish(dbMessage(error.message), { error: true, tab: "suez", version: id });
  finish("Version window saved", { tab: "suez", version: id });
}

// Publication: the typed PUBLISH is checked here and again in the database; the RPC closes the
// preceding open version and publishes in one serialized transaction, or does nothing.
export async function publishVersion(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  const confirm = value(form, "confirm");
  if (confirm !== "PUBLISH") finish("Type PUBLISH to confirm (second confirmation step)", { error: true, tab: "suez", version: id });
  const { data, error } = await db.rpc("admin_suez_publish", { p_version_id: id, p_actor: actorId, p_confirm: confirm });
  if (error || !data) finish(`Not published — ${dbMessage(error?.message ?? "unknown error")}`, { error: true, tab: "suez", version: id });
  const r = data as { versionNo: number; closedVersionNo: number | null; makerIsChecker: boolean; items: number; surcharges: number; tiers: number; sources: number; surchargeRegime: string };
  const checker = r.makerIsChecker ? " · maker = checker: the typed confirmation stands in for a second admin" : "";
  const regime = r.surchargeRegime === "unknown" ? " Category surcharges are not modelled in this version: every toll it prices is partial." : r.surchargeRegime === "modelled" ? ` ${r.surcharges} category surcharge item(s).` : "";
  finish(`Version ${r.versionNo} published (${r.items} items, ${r.tiers} toll bands, ${r.sources} sources)${r.closedVersionNo ? `; version ${r.closedVersionNo} closed the day before` : ""}${r.tiers ? "" : ". No toll bands: the toll layer stays unavailable"}.${regime}${checker}`, { tab: "suez", version: id });
}

export async function withdrawVersion(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  const { error } = await db.rpc("admin_suez_set_status", { p_version_id: id, p_actor: actorId, p_status: "withdrawn" });
  if (error) finish(dbMessage(error.message), { error: true, tab: "suez", version: id });
  finish("Version withdrawn", { tab: "suez", version: id });
}

export async function deleteDraftVersion(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "versionId");
  const { error } = await db.rpc("admin_suez_delete_draft", { p_version_id: id, p_actor: actorId });
  if (error) finish(dbMessage(error.message), { error: true, tab: "suez", version: id });
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
  if (versionId && !UUID.test(versionId)) finish("Invalid version", { error: true, tab: "suez" });
  const { error } = await db.rpc("admin_suez_register_source", { p_actor: actorId, p_source: parsed.data, p_cite_version: versionId });
  if (error) finish(dbMessage(error.message), { error: true, tab: "suez", version: versionId });
  finish(`Source "${parsed.data.title}" registered${versionId ? " and cited" : ""}${parsed.data.evidenceStatus === "pending_document" ? " (document pending: no SHA-256 on file yet)" : ""}`, { tab: "suez", version: versionId });
}

async function setCitation(form: FormData, cite: boolean) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const sourceId = value(form, "sourceId");
  if (!UUID.test(versionId) || !UUID.test(sourceId)) finish("Pick a version and a source", { error: true, tab: "suez", version: versionId });
  const { error } = await db.rpc("admin_suez_cite_source", { p_version_id: versionId, p_actor: actorId, p_source_id: sourceId, p_cite: cite });
  if (error) finish(dbMessage(error.message), { error: true, tab: "suez", version: versionId });
  finish(cite ? "Source cited on the draft" : "Citation removed from the draft", { tab: "suez", version: versionId });
}

export async function citeSource(form: FormData) { return setCitation(form, true); }
export async function unciteSource(form: FormData) { return setCitation(form, false); }

// ── Items and toll tiers (draft versions only) ──────────────────────────────

export async function saveItem(form: FormData) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const itemId = optional(form, "itemId");
  if (!UUID.test(versionId) || (itemId && !UUID.test(itemId))) finish("Invalid version or item", { error: true, tab: "suez", version: versionId });
  const params = parseJson(value(form, "params"), "params", "suez");
  const parsed = suezItemInputSchema.safeParse({
    code: value(form, "code"), labelEn: value(form, "labelEn"), labelAr: optional(form, "labelAr"),
    layer: value(form, "layer"), basis: value(form, "basis"), currency: value(form, "currency"), params,
    directionScope: value(form, "directionScope") || "any", cargoStatusScope: value(form, "cargoStatusScope") || "any",
    categoryScope: categoryList(form, "categoryScope"), confidence: value(form, "confidence") || "official",
    conditionKey: optional(form, "conditionKey"), payerParty: value(form, "payerParty") || "owner",
    sortOrder: Number.isFinite(number(form, "sortOrder")) ? number(form, "sortOrder") : 100,
    isActive: value(form, "isActive") !== "0", notes: optional(form, "notes"),
  });
  if (!parsed.success) finish(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), { error: true, tab: "suez", version: versionId });
  const { error } = await db.rpc("admin_suez_save_item", { p_version_id: versionId, p_actor: actorId, p_item_id: itemId, p_item: parsed.data });
  if (error) finish(dbMessage(error.message), { error: true, tab: "suez", version: versionId });
  finish(`Item ${parsed.data.code} saved`, { tab: "suez", version: versionId });
}

export async function deleteItem(form: FormData) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const itemId = value(form, "itemId");
  if (!UUID.test(versionId) || !UUID.test(itemId)) finish("Invalid version or item", { error: true, tab: "suez", version: versionId });
  const { error } = await db.rpc("admin_suez_delete_item", { p_version_id: versionId, p_actor: actorId, p_item_id: itemId });
  if (error) finish(dbMessage(error.message), { error: true, tab: "suez", version: versionId });
  finish("Item deleted", { tab: "suez", version: versionId });
}

export async function replaceTiers(form: FormData) {
  const { actorId, db } = await context();
  const versionId = value(form, "versionId");
  const confidence = value(form, "confidence") === "placeholder" ? "placeholder" : "official";
  const { rows, errors } = parseTierCsv(value(form, "csv"));
  if (errors.length) finish(`Toll bands not saved: ${errors.slice(0, 6).join("; ")}${errors.length > 6 ? ` … (${errors.length} problems)` : ""}`, { error: true, tab: "tiers", version: versionId });
  if (!rows.length) finish("No bands found in the pasted text", { error: true, tab: "tiers", version: versionId });
  const { data, error } = await db.rpc("admin_suez_replace_tiers", {
    p_version_id: versionId, p_actor: actorId, p_confidence: confidence,
    p_rows: rows.map((r) => ({ vessel_category: r.vesselCategory, cargo_status: r.cargoStatus, tier_order: r.tierOrder, scnt_from: r.scntFrom, scnt_to: r.scntTo, sdr_per_scnt: r.sdrPerScnt })),
  });
  if (error || !data) finish(`Toll bands not saved: ${dbMessage(error?.message ?? "unknown error")}`, { error: true, tab: "tiers", version: versionId });
  const r = data as { bands: number; categories: number };
  finish(`${r.bands} toll bands saved for ${r.categories} categories (${confidence})`, { tab: "tiers", version: versionId });
}

// ── SDR rates (append-only; corrections are a new row, mistakes are voided) ──

export async function addSdrRate(form: FormData) {
  const { actorId, db } = await context();
  const parsed = sdrRateInputSchema.safeParse({ rateUsd: number(form, "rateUsd"), asOf: value(form, "asOf"), source: value(form, "source") || "IMF", notes: optional(form, "notes") });
  if (!parsed.success) finish(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), { error: true, tab: "sdr" });
  if (parsed.data.asOf > new Date().toISOString().slice(0, 10)) finish("An SDR rate cannot be dated in the future", { error: true, tab: "sdr" });
  // The insert trigger writes the 'recorded' event with the acting admin, in the same statement.
  const { error } = await db.from("sdr_rates").insert({ rate_usd: parsed.data.rateUsd, as_of: parsed.data.asOf, source: parsed.data.source, notes: parsed.data.notes, created_by: actorId });
  if (error) finish(dbMessage(error.message), { error: true, tab: "sdr" });
  finish(`SDR rate ${parsed.data.rateUsd} USD recorded for ${parsed.data.asOf}`, { tab: "sdr" });
}

export async function voidSdrRate(form: FormData) {
  const { actorId, db } = await context();
  const id = value(form, "rateId");
  const reason = value(form, "reason");
  if (reason.length < 3) finish("Voiding an SDR rate needs a reason (at least 3 characters)", { error: true, tab: "sdr" });
  // The guard trigger refuses any other change and writes the 'voided' event in the same statement.
  const { error } = await db.from("sdr_rates").update({ voided_at: new Date().toISOString(), void_reason: reason, voided_by: actorId }).eq("id", id).is("voided_at", null);
  if (error) finish(dbMessage(error.message), { error: true, tab: "sdr" });
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
  // The RPC writes the row (without the seed marker: it is owner data now) and its before/after event together.
  const { error } = await db.rpc("admin_voyage_save_settings", { p_actor: actorId, p_value: parsed.value });
  if (error) finish(dbMessage(error.message), { error: true, tab: "constants" });
  revalidatePath("/dashboard", "layout");
  finish("Voyage constants saved", { tab: "constants" });
}

// ── ECA zones (append-only geometry versions with their source) ─────────────

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
  // A geometry version is immutable once recorded: saving other geometry under an existing version id is refused.
  const { error } = await db.rpc("admin_eca_save_zone", {
    p_actor: actorId,
    p_zone: {
      code, name: value(form, "name"), polygon, sulphurLimitPct: Number.isFinite(sulphur) ? sulphur : 0.1, effectiveFrom, effectiveTo,
      isActive: value(form, "isActive") !== "0", notes: optional(form, "notes"), geometryVersion, sourceRef, sourceUrl: optional(form, "sourceUrl"), sha256, confidence,
    },
  });
  if (error) finish(dbMessage(error.message), { error: true, tab: "eca" });
  finish(`ECA zone ${code} saved as geometry ${geometryVersion} (${(polygon as unknown[]).length} points, ${confidence})`, { tab: "eca" });
}

export async function setEcaZoneActive(form: FormData) {
  const { actorId, db } = await context();
  const code = value(form, "code");
  const active = value(form, "isActive") === "1";
  const { error } = await db.rpc("admin_eca_set_active", { p_actor: actorId, p_code: code, p_active: active });
  if (error) finish(dbMessage(error.message), { error: true, tab: "eca" });
  finish(`ECA zone ${code} ${active ? "activated" : "deactivated"}`, { tab: "eca" });
}

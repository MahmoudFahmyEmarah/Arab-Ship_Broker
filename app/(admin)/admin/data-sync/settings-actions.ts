"use server";

// Data Sync settings — the encrypted multi-key LLM manager + circulation email
// connection. Secrets go through the Vault RPCs (save_llm_credential /
// save_email_config); plaintext keys are NEVER stored in app tables and NEVER
// returned to the browser. Only metadata + a 4-char hint is ever read back.

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { PLATFORM_SETTINGS_KEY, type PlatformSettingsData } from "@/lib/app-settings";
import { getWatermark, setWatermark } from "@/lib/sync/state";
import { aiBudgetToday, type AiBudget } from "@/lib/sync/email/usage";
import { isSafeBaseUrl } from "@/lib/sync/guards";
import { llmModelsEndpoint, llmProviderFamily } from "@/lib/sync/llm-provider";
import { logAudit } from "@/lib/admin/data-sync-audit";
import { describeSchedule, nextRunAt, specFromRow, type ScheduleSpec } from "@/lib/sync/email/schedule";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string };

// requireAdmin denies by redirect(), which throws. Re-throw it so the bounce
// happens instead of a toast reading "NEXT_REDIRECT".
const fail = (e: unknown, fallback: string): { success: false; error: string } => {
  unstable_rethrow(e);
  return { success: false, error: e instanceof Error ? e.message : fallback };
};

async function admin() {
  await requireAdmin({ section: "datasync", edit: true });
  return getSupabaseAdminClient();
}
// Mutations also need the actor's name for the audit trail.
async function adminCtx() {
  const u = await requireAdmin({ section: "datasync", edit: true });
  return { c: getSupabaseAdminClient(), who: { id: u.rowId, name: u.fullName } };
}

// ── LLM credential manager ──────────────────────────────────────────────────
export interface LlmCredentialMeta {
  id: string;
  label: string;
  vendor: string;
  model: string;
  base_url: string | null;
  key_hint: string | null;
  is_active: boolean;
  updated_at: string;
}

export async function listLlmCredentials(): Promise<Result<LlmCredentialMeta[]>> {
  try {
    const c = await admin();
    const { data, error } = await c
      .from("llm_credential")
      .select("id, label, vendor, model, base_url, key_hint, is_active, updated_at")
      .order("is_active", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as LlmCredentialMeta[] };
  } catch (e) {
    return fail(e, "Could not read keys.");
  }
}

export interface SaveLlmInput {
  id?: string;
  label: string;
  vendor: string;
  model: string;
  baseUrl?: string | null;
  secret?: string | null;   // omit/blank to keep the existing key
  makeActive?: boolean;
}

export async function saveLlmCredential(input: SaveLlmInput): Promise<Result<{ id: string }>> {
  if (!input.label?.trim()) return { success: false, error: "Give the key a label." };
  if (!input.vendor?.trim() || !input.model?.trim()) return { success: false, error: "Vendor and model are required." };
  if (input.id && !UUID_RE.test(input.id)) return { success: false, error: "Invalid key id." };
  if (!input.id && !input.secret?.trim()) return { success: false, error: "Paste the API key." };
  const safe = isSafeBaseUrl(input.baseUrl?.trim() || null);
  if (!safe.ok) return { success: false, error: `Base URL rejected — ${safe.reason}.` };
  try {
    const { c, who } = await adminCtx();
    const { data, error } = await c.rpc("save_llm_credential", {
      p_id: input.id ?? null,
      p_label: input.label.trim(),
      p_vendor: input.vendor.trim(),
      p_model: input.model.trim(),
      p_base_url: input.baseUrl?.trim() || null,
      p_secret: input.secret?.trim() || null,
      p_make_active: input.makeActive ?? false,
    });
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "settings.llm.save", targetKind: "settings", targetId: String(data), summary: `${input.id ? "Updated" : "Added"} LLM key “${input.label.trim()}” (${input.vendor.trim()} · ${input.model.trim()})${input.secret?.trim() ? " — secret rotated" : ""}${input.makeActive ? " — made active" : ""}`, detail: { vendor: input.vendor.trim(), model: input.model.trim(), baseUrl: input.baseUrl?.trim() || null, secretChanged: !!input.secret?.trim(), makeActive: !!input.makeActive } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { id: data as string } };
  } catch (e) {
    return fail(e, "Could not save the key.");
  }
}

export async function activateLlmCredential(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid key id." };
  try {
    const { c, who } = await adminCtx();
    const { error } = await c.rpc("set_active_llm_credential", { p_id: id });
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "settings.llm.activate", targetKind: "settings", targetId: id, summary: "Switched the active LLM key" });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not activate the key.");
  }
}

export async function deleteLlmCredential(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid key id." };
  try {
    const { c, who } = await adminCtx();
    const { error } = await c.rpc("delete_llm_credential", { p_id: id });
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "settings.llm.delete", targetKind: "settings", targetId: id, summary: "Deleted an LLM key (Vault secret destroyed)" });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not delete the key.");
  }
}

// Read-only provider ping to confirm a stored key actually authenticates.
// The plaintext is decrypted server-side (get_llm_secret) and never leaves here.
export async function testLlmCredential(id: string): Promise<Result<{ status: number }>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid key id." };
  try {
    const { c, who } = await adminCtx();
    const { data: meta, error: mErr } = await c
      .from("llm_credential").select("vendor, base_url").eq("id", id).maybeSingle();
    if (mErr) return { success: false, error: mErr.message };
    if (!meta) return { success: false, error: "Key not found." };
    const { data: secret, error: sErr } = await c.rpc("get_llm_secret", { p_id: id });
    if (sErr) return { success: false, error: sErr.message };
    if (!secret) return { success: false, error: "No key stored for this credential." };

    const vendor = (meta.vendor as string).toLowerCase();
    const override = (meta.base_url as string | null)?.replace(/\/$/, "") || null;
    // The decrypted key goes in the request headers — never to a private host
    // or over plain http, even if a stored override says so.
    const safe = isSafeBaseUrl(override);
    if (!safe.ok) return { success: false, error: `Stored base URL rejected — ${safe.reason}. Edit the key and fix it.` };
    const family = llmProviderFamily(vendor);

    // Each provider gets a cheap, read-only models-list call to prove the key auths.
    let url: string;
    let headers: Record<string, string>;
    if (family === "anthropic") {
      url = llmModelsEndpoint(vendor, override);
      headers = { "x-api-key": secret as string, "anthropic-version": "2023-06-01" };
    } else if (family === "google") {
      url = llmModelsEndpoint(vendor, override);
      headers = { "x-goog-api-key": secret as string };
    } else {
      url = llmModelsEndpoint(vendor, override);
      headers = { Authorization: `Bearer ${secret as string}` };
    }

    const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(12000) });
    await logAudit(c, { actor: who, action: "settings.llm.test", targetKind: "settings", targetId: id, summary: res.ok ? `Tested an LLM key — provider accepted it (HTTP ${res.status})` : `Tested an LLM key — provider rejected it (HTTP ${res.status})`, ok: res.ok, detail: { status: res.status, vendor } });
    if (!res.ok) {
      return { success: false, error: `Provider rejected the key (HTTP ${res.status}).` };
    }
    return { success: true, data: { status: res.status } };
  } catch (e) {
    unstable_rethrow(e);
    const msg = e instanceof Error ? e.message : "Test failed.";
    return { success: false, error: `Could not reach the provider: ${msg}` };
  }
}

// ── legacy key migration (plaintext platform_settings.ai.apiKey → Vault) ─────
export async function hasLegacyAiKey(): Promise<boolean> {
  try {
    const c = await admin();
    const { data } = await c.from("app_settings").select("value").eq("key", PLATFORM_SETTINGS_KEY).maybeSingle();
    const ai = (data?.value as PlatformSettingsData | undefined)?.ai;
    return typeof ai?.apiKey === "string" && ai.apiKey.trim().length > 0;
  } catch {
    return false;
  }
}

export async function importLegacyAiKey(): Promise<Result<{ imported: boolean }>> {
  try {
    const { c, who } = await adminCtx();
    const { data, error } = await c
      .from("app_settings").select("value").eq("key", PLATFORM_SETTINGS_KEY).maybeSingle();
    if (error) return { success: false, error: error.message };
    const settings = (data?.value as PlatformSettingsData | undefined);
    const ai = settings?.ai;
    if (!ai?.apiKey?.trim()) return { success: true, data: { imported: false } };

    const { error: saveErr } = await c.rpc("save_llm_credential", {
      p_id: null,
      p_label: "Imported from platform settings",
      p_vendor: ai.vendor || "anthropic",
      p_model: ai.model || "claude-sonnet-4",
      p_base_url: ai.baseUrl?.trim() || null,
      p_secret: ai.apiKey.trim(),
      p_make_active: true,
    });
    if (saveErr) return { success: false, error: saveErr.message };

    // Blank the plaintext key now that it lives (encrypted) in Vault.
    const scrubbed = { ...settings, ai: { ...ai, apiKey: "" } };
    const { error: upErr } = await c
      .from("app_settings")
      .update({ value: scrubbed, updated_at: new Date().toISOString() })
      .eq("key", PLATFORM_SETTINGS_KEY);
    if (upErr) return { success: false, error: upErr.message };

    await logAudit(c, { actor: who, action: "settings.llm.import", targetKind: "settings", summary: "Imported the legacy plaintext AI key into Vault and blanked it" });
    revalidatePath("/admin/data-sync");
    revalidatePath("/admin/settings");
    return { success: true, data: { imported: true } };
  } catch (e) {
    return fail(e, "Import failed.");
  }
}

// ── circulation email connection ────────────────────────────────────────────
export interface EmailConfigMeta {
  provider: string;
  imap_host: string | null;
  imap_port: number;
  username: string | null;
  folder: string;
  search_query: string | null;
  password_hint: string | null;
  is_enabled: boolean;
  updated_at: string | null;
  /** /api/cron/email-sync cadence (Connections → Schedule) */
  schedule_enabled: boolean;
  schedule_label: string;
  schedule: ScheduleSpec;
  next_run_at: string | null;
}

export async function getEmailConfig(): Promise<Result<EmailConfigMeta | null>> {
  try {
    const c = await admin();
    const { data, error } = await c
      .from("email_ingest_config")
      .select("provider, imap_host, imap_port, username, folder, search_query, password_hint, is_enabled, updated_at, schedule_enabled, schedule_label, schedule_kind, schedule_hour_utc, schedule_interval_days, schedule_weekday, schedule_tz, next_run_at")
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!data) return { success: true, data: null };
    const row = data as Record<string, unknown>;
    return { success: true, data: { ...(row as unknown as EmailConfigMeta), schedule: specFromRow(row as Parameters<typeof specFromRow>[0]), next_run_at: (row.next_run_at as string | null) ?? null } };
  } catch (e) {
    return fail(e, "Could not read email config.");
  }
}

export interface SaveEmailInput {
  provider: string;
  host: string;
  port: number;
  username: string;
  folder: string;
  query?: string | null;
  password?: string | null;   // blank to keep existing
  enabled: boolean;
}

// ── incremental sync watermark ──────────────────────────────────────────────
export async function getSyncWatermarks(): Promise<Result<{ email: string | null; upload: string | null }>> {
  try {
    const c = await admin();
    const [e, u] = await Promise.all([getWatermark(c, "email"), getWatermark(c, "upload")]);
    return { success: true, data: { email: e?.toISOString() ?? null, upload: u?.toISOString() ?? null } };
  } catch (e) {
    return fail(e, "Could not read sync state.");
  }
}

// Override the email watermark. Pass an ISO string to set a specific start point,
// or null to reset it to "now" (next sync fetches only future mail).
export async function setEmailWatermark(iso: string | null): Promise<Result> {
  try {
    const { c, who } = await adminCtx();
    const at = iso === null ? new Date() : new Date(iso);
    if (Number.isNaN(at.getTime())) return { success: false, error: "Invalid date/time." };
    await setWatermark(c, "email", at);
    await logAudit(c, { actor: who, action: "settings.email.watermark", targetKind: "settings", summary: iso === null ? "Reset the inbox start point to now" : `Moved the inbox start point to ${at.toISOString().slice(0, 16).replace("T", " ")} UTC`, detail: { at: at.toISOString() } });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not update the watermark.");
  }
}

// ── WhatsApp connection ─────────────────────────────────────────────────────
export interface WhatsappConfigMeta {
  provider: "meta" | "unofficial";
  phone_number_id: string | null;
  business_id: string | null;
  has_token: boolean;
  has_app_secret: boolean;
  has_verify: boolean;
  is_enabled: boolean;
  auto_reply: boolean;
  reply_template: string;
  platform_url: string;
}

export async function getWhatsappConfig(): Promise<Result<WhatsappConfigMeta | null>> {
  try {
    const c = await admin();
    const { data, error } = await c
      .from("whatsapp_config")
      .select("provider, phone_number_id, business_id, token_secret_id, app_secret_id, verify_secret_id, is_enabled, auto_reply, reply_template, platform_url")
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!data) return { success: true, data: null };
    return {
      success: true,
      data: {
        provider: data.provider, phone_number_id: data.phone_number_id, business_id: data.business_id,
        has_token: !!data.token_secret_id, has_app_secret: !!data.app_secret_id, has_verify: !!data.verify_secret_id,
        is_enabled: data.is_enabled, auto_reply: data.auto_reply,
        reply_template: data.reply_template, platform_url: data.platform_url,
      },
    };
  } catch (e) {
    return fail(e, "Could not read WhatsApp config.");
  }
}

export interface SaveWhatsappInput {
  provider: "meta" | "unofficial";
  phoneNumberId?: string | null;
  businessId?: string | null;
  token?: string | null;        // blank keeps the stored one
  appSecret?: string | null;
  verifyToken?: string | null;
  enabled: boolean;
  autoReply: boolean;
  replyTemplate?: string | null;
  platformUrl?: string | null;
}

export async function saveWhatsappConfig(input: SaveWhatsappInput): Promise<Result> {
  if (input.provider !== "meta" && input.provider !== "unofficial")
    return { success: false, error: "Choose a provider." };
  if (input.provider === "meta" && input.enabled && !input.phoneNumberId?.trim()) {
    return { success: false, error: "Meta provider needs the phone-number ID." };
  }
  try {
    const { c, who } = await adminCtx();
    const { error } = await c.rpc("save_whatsapp_config", {
      p_provider: input.provider,
      p_phone_number_id: input.phoneNumberId?.trim() || null,
      p_business_id: input.businessId?.trim() || null,
      p_token: input.token?.trim() || null,
      p_app_secret: input.appSecret?.trim() || null,
      p_verify_token: input.verifyToken?.trim() || null,
      p_enabled: input.enabled,
      p_auto_reply: input.autoReply,
      p_reply_template: input.replyTemplate ?? null,
      p_platform_url: input.platformUrl ?? null,
    });
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "settings.whatsapp.save", targetKind: "settings", summary: `Saved WhatsApp connection — ${input.provider} · ${input.enabled ? "enabled" : "disabled"} · auto-reply ${input.autoReply ? "on" : "off"}`, detail: { provider: input.provider, enabled: input.enabled, autoReply: input.autoReply, tokenChanged: !!input.token?.trim(), appSecretChanged: !!input.appSecret?.trim(), verifyChanged: !!input.verifyToken?.trim() } });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save WhatsApp config.");
  }
}

export interface WhatsappRuntimeView {
  state: "offline" | "pairing" | "connected";
  qr: string | null;
  linked_as: string | null;
  worker_seen: string | null;
  worker_alive: boolean;
}

export async function getWhatsappRuntime(): Promise<Result<WhatsappRuntimeView>> {
  try {
    const c = await admin();
    const { data, error } = await c
      .from("whatsapp_runtime")
      .select("state, qr, linked_as, worker_seen")
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    const seen = data?.worker_seen ? new Date(data.worker_seen).getTime() : 0;
    const alive = Date.now() - seen < 90_000;
    return {
      success: true,
      data: {
        state: alive ? ((data?.state as WhatsappRuntimeView["state"]) ?? "offline") : "offline",
        qr: alive ? (data?.qr ?? null) : null,
        linked_as: data?.linked_as ?? null,
        worker_seen: data?.worker_seen ?? null,
        worker_alive: alive,
      },
    };
  } catch (e) {
    return fail(e, "Could not read WhatsApp runtime.");
  }
}

// ── worker lifecycle: the admin runs the companion worker from the app ──────
// The Next server spawns the worker as a detached child process (it must run on
// a persistent host — which the unofficial provider requires anyway). Output
// goes to .wa-worker.log; the Stop button flips a cooperative kill switch the
// worker polls, plus a best-effort SIGTERM on the recorded pid.

export async function startWhatsappWorker(): Promise<Result<{ pid: number }>> {
  try {
    const { c, who } = await adminCtx();
    // Phase 6: the QR-linked worker is a long-running local process; a
    // serverless function cannot host it.
    if (process.env.VERCEL) {
      return { success: false, error: "The QR-linked worker is a local process and cannot run on Vercel. Start it on a machine that stays on: `npx tsx scripts/whatsapp-worker.ts`. The Meta Cloud API path needs no worker." };
    }
    const { data: rt } = await c.from("whatsapp_runtime").select("worker_seen").maybeSingle();
    const seen = rt?.worker_seen ? new Date(rt.worker_seen).getTime() : 0;
    if (Date.now() - seen < 90_000) return { success: false, error: "The worker is already running." };

    const { spawn } = await import("node:child_process");
    const { openSync } = await import("node:fs");
    const { join } = await import("node:path");

    // clear a stale stop request so the fresh worker doesn't instantly exit
    await c.from("whatsapp_runtime").update({ stop_requested: false }).eq("only_one", true);

    const cwd = process.cwd();
    const log = openSync(join(cwd, ".wa-worker.log"), "a");
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/whatsapp-worker.ts"], {
      cwd, env: process.env, detached: true, windowsHide: true, stdio: ["ignore", log, log],
    });

    // catch startup failures (missing tsx, import crashes, …) — module loading
    // can take a few seconds, so watch long enough to catch an import-time crash
    const outcome = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const t = setTimeout(() => resolve({ ok: true }), 6000);
      child.once("error", (e) => { clearTimeout(t); resolve({ ok: false, error: e.message }); });
      child.once("exit", (code) => { clearTimeout(t); resolve({ ok: false, error: `worker exited on startup (code ${code}) — see .wa-worker.log on the server` }); });
    });
    if (!outcome.ok || !child.pid) return { success: false, error: outcome.error ?? "Could not start the worker." };

    child.unref(); // let it outlive this request
    await logAudit(c, { actor: who, action: "whatsapp.worker.start", targetKind: "settings", summary: `Started the WhatsApp companion worker (pid ${child.pid})`, detail: { pid: child.pid } });
    return { success: true, data: { pid: child.pid } };
  } catch (e) {
    return fail(e, "Could not start the worker.");
  }
}

export async function stopWhatsappWorker(): Promise<Result> {
  try {
    const { c, who } = await adminCtx();
    const { data: rt } = await c.from("whatsapp_runtime").select("worker_pid").maybeSingle();
    // cooperative switch — the worker polls this every few seconds
    const { error } = await c.from("whatsapp_runtime")
      .update({ stop_requested: true }).eq("only_one", true);
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "whatsapp.worker.stop", targetKind: "settings", summary: "Requested the WhatsApp companion worker to stop", detail: { pid: rt?.worker_pid ?? null } });
    // best-effort direct signal too (same host)
    if (rt?.worker_pid) {
      try { process.kill(rt.worker_pid, "SIGTERM"); } catch { /* already gone / other host */ }
    }
    return { success: true };
  } catch (e) {
    return fail(e, "Could not stop the worker.");
  }
}

export async function saveEmailConfig(input: SaveEmailInput): Promise<Result> {
  if (!input.host?.trim() || !input.username?.trim()) return { success: false, error: "Host and username are required." };
  const port = Number.parseInt(String(input.port), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return { success: false, error: "Enter a valid IMAP port." };
  try {
    const { c, who } = await adminCtx();
    const { error } = await c.rpc("save_email_config", {
      p_provider: input.provider?.trim() || "gmail",
      p_host: input.host.trim(),
      p_port: port,
      p_username: input.username.trim(),
      p_folder: input.folder?.trim() || "INBOX",
      p_query: input.query?.trim() || null,
      p_password: input.password?.trim() || null,
      p_enabled: input.enabled,
    });
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "settings.email.save", targetKind: "settings", summary: `Saved inbox connection — ${input.username.trim()} @ ${input.host.trim()}:${port} · ${input.enabled ? "enabled" : "disabled"}${input.password?.trim() ? " — password rotated" : ""}`, detail: { provider: input.provider, host: input.host.trim(), port, username: input.username.trim(), folder: input.folder, enabled: input.enabled, passwordChanged: !!input.password?.trim() } });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save email config.");
  }
}

// ── inbox schedule — daily / every N days / weekly, at an hour of the owner's
// choosing. /api/cron/email-sync wakes hourly and runs when next_run_at has
// passed (lib/sync/email/schedule.ts is the one computation, shared with the
// editor's preview).
export async function setEmailSchedule(spec: ScheduleSpec): Promise<Result<{ nextRunAt: string | null; label: string }>> {
  const kinds = ["daily", "every_n_days", "weekly"];
  if (!kinds.includes(spec?.kind)) return { success: false, error: "Choose a cadence." };
  const hour = Math.trunc(Number(spec.hourUtc));
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return { success: false, error: "Pick an hour between 00:00 and 23:00." };
  const every = Math.trunc(Number(spec.intervalDays));
  if (spec.kind === "every_n_days" && (every < 2 || every > 30)) return { success: false, error: "Every N days must be between 2 and 30." };
  const wd = Math.trunc(Number(spec.weekday));
  if (spec.kind === "weekly" && (wd < 0 || wd > 6)) return { success: false, error: "Pick a weekday." };
  const tz = typeof spec.tz === "string" && /^[A-Za-z_\/+\-0-9]{1,64}$/.test(spec.tz) ? spec.tz : null;
  try {
    const { c, who } = await adminCtx();
    const { data: cur } = await c.from("email_ingest_config").select("last_scheduled_run_at").eq("only_one", true).maybeSingle();
    const clean: ScheduleSpec = { enabled: !!spec.enabled, kind: spec.kind, hourUtc: hour, intervalDays: every || 2, weekday: wd || 0, tz };
    const anchor = (cur as { last_scheduled_run_at?: string | null } | null)?.last_scheduled_run_at;
    const next = nextRunAt(clean, new Date(), anchor ? new Date(anchor) : null);
    const label = describeSchedule(clean);
    const { error } = await c
      .from("email_ingest_config")
      .update({
        schedule_enabled: clean.enabled, schedule_kind: clean.kind, schedule_hour_utc: clean.hourUtc,
        schedule_interval_days: clean.intervalDays, schedule_weekday: clean.weekday, schedule_tz: clean.tz,
        schedule_label: label, next_run_at: next ? next.toISOString() : null, updated_at: new Date().toISOString(),
      })
      .eq("only_one", true);
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "settings.email.schedule", targetKind: "settings", summary: clean.enabled ? `Set the inbox schedule — ${label}; next run ${next?.toISOString().slice(0, 16).replace("T", " ")} UTC` : "Switched the inbox schedule off", detail: { ...clean, nextRunAt: next?.toISOString() ?? null } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { nextRunAt: next ? next.toISOString() : null, label } };
  } catch (e) {
    return fail(e, "Could not update the schedule.");
  }
}

// ── Intake health — one gated round trip for the whole tile row ─────────────
// (Four separate actions each ran requireAdmin(); the tiles now cost one.)
export interface JobRunView {
  id: number; job: string; status: string; started_at: string; finished_at: string | null;
  rows: number | null; error: string | null; trigger: string | null;
}
export interface IntakeHealth {
  inbox: { enabled: boolean; scheduleEnabled: boolean; scheduleLabel: string; nextRunAt: string | null; lastSuccess: string | null } | null;
  llm: LlmCredentialMeta | null;
  budget: AiBudget;
  whatsapp: WhatsappRuntimeView;
  jobs: { failed7d: number; lastFailed: JobRunView | null; recent: JobRunView[] };
}

export async function getIntakeHealth(): Promise<Result<IntakeHealth>> {
  try {
    const c = await admin();
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [cfg, mark, keys, rt, budget, failed, recent] = await Promise.all([
      c.from("email_ingest_config").select("is_enabled, schedule_enabled, schedule_kind, schedule_hour_utc, schedule_interval_days, schedule_weekday, schedule_tz, next_run_at").maybeSingle(),
      getWatermark(c, "email"),
      c.from("llm_credential").select("id, label, vendor, model, base_url, key_hint, is_active, updated_at").eq("is_active", true).maybeSingle(),
      c.from("whatsapp_runtime").select("state, qr, linked_as, worker_seen").maybeSingle(),
      aiBudgetToday(c),
      c.from("job_runs").select("id, job, status, started_at, finished_at, rows, error, trigger")
        .in("job", ["email-sync", "whatsapp-webhook", "whatsapp-sweep"]).eq("status", "failed").gte("started_at", since)
        .order("started_at", { ascending: false }).limit(50),
      c.from("job_runs").select("id, job, status, started_at, finished_at, rows, error, trigger")
        .in("job", ["email-sync", "whatsapp-webhook", "whatsapp-sweep"]).order("started_at", { ascending: false }).limit(8),
    ]);
    const seen = rt.data?.worker_seen ? new Date(rt.data.worker_seen).getTime() : 0;
    const alive = Date.now() - seen < 90_000;
    const e = cfg.data as ({ is_enabled?: boolean; next_run_at?: string | null } & Parameters<typeof specFromRow>[0]) | null;
    const spec = specFromRow(e);
    const failedRows = (failed.data ?? []) as JobRunView[];
    return {
      success: true,
      data: {
        inbox: e ? { enabled: !!e.is_enabled, scheduleEnabled: spec.enabled, scheduleLabel: describeSchedule(spec), nextRunAt: e.next_run_at ?? null, lastSuccess: mark?.toISOString() ?? null } : null,
        llm: (keys.data as LlmCredentialMeta | null) ?? null,
        budget,
        whatsapp: {
          state: alive ? ((rt.data?.state as WhatsappRuntimeView["state"]) ?? "offline") : "offline",
          qr: null, linked_as: rt.data?.linked_as ?? null, worker_seen: rt.data?.worker_seen ?? null, worker_alive: alive,
        },
        jobs: { failed7d: failedRows.length, lastFailed: failedRows[0] ?? null, recent: (recent.data ?? []) as JobRunView[] },
      },
    };
  } catch (e) {
    return fail(e, "Could not read intake health.");
  }
}

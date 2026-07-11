"use server";

// Data Sync settings — the encrypted multi-key LLM manager + circulation email
// connection. Secrets go through the Vault RPCs (save_llm_credential /
// save_email_config); plaintext keys are NEVER stored in app tables and NEVER
// returned to the browser. Only metadata + a 4-char hint is ever read back.

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { PLATFORM_SETTINGS_KEY, type PlatformSettingsData } from "@/lib/app-settings";
import { getWatermark, setWatermark } from "@/lib/sync/state";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Result<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string };

async function admin() {
  await requireAdmin({ section: "datasync", edit: true });
  return getSupabaseAdminClient();
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read keys." };
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
  try {
    const c = await admin();
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
    revalidatePath("/admin/data-sync");
    return { success: true, data: { id: data as string } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not save the key." };
  }
}

export async function activateLlmCredential(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid key id." };
  try {
    const c = await admin();
    const { error } = await c.rpc("set_active_llm_credential", { p_id: id });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not activate the key." };
  }
}

export async function deleteLlmCredential(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid key id." };
  try {
    const c = await admin();
    const { error } = await c.rpc("delete_llm_credential", { p_id: id });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not delete the key." };
  }
}

// Read-only provider ping to confirm a stored key actually authenticates.
// The plaintext is decrypted server-side (get_llm_secret) and never leaves here.
export async function testLlmCredential(id: string): Promise<Result<{ status: number }>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid key id." };
  try {
    const c = await admin();
    const { data: meta, error: mErr } = await c
      .from("llm_credential").select("vendor, base_url").eq("id", id).maybeSingle();
    if (mErr) return { success: false, error: mErr.message };
    if (!meta) return { success: false, error: "Key not found." };
    const { data: secret, error: sErr } = await c.rpc("get_llm_secret", { p_id: id });
    if (sErr) return { success: false, error: sErr.message };
    if (!secret) return { success: false, error: "No key stored for this credential." };

    const vendor = (meta.vendor as string).toLowerCase();
    const override = (meta.base_url as string | null)?.replace(/\/$/, "") || null;
    const isAnthropic = vendor.includes("anthropic") || vendor.includes("claude");
    const isGoogle = vendor.includes("google") || vendor.includes("gemini");

    // Each provider gets a cheap, read-only models-list call to prove the key auths.
    let url: string;
    let headers: Record<string, string>;
    if (isAnthropic) {
      url = `${override ?? "https://api.anthropic.com"}/v1/models`;
      headers = { "x-api-key": secret as string, "anthropic-version": "2023-06-01" };
    } else if (isGoogle) {
      url = `${override ?? "https://generativelanguage.googleapis.com"}/v1beta/models`;
      headers = { "x-goog-api-key": secret as string };
    } else {
      url = `${override ?? "https://api.openai.com"}/v1/models`;
      headers = { Authorization: `Bearer ${secret as string}` };
    }

    const res = await fetch(url, { method: "GET", headers, signal: AbortSignal.timeout(12000) });
    if (!res.ok) {
      return { success: false, error: `Provider rejected the key (HTTP ${res.status}).` };
    }
    return { success: true, data: { status: res.status } };
  } catch (e) {
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
    const c = await admin();
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

    revalidatePath("/admin/data-sync");
    revalidatePath("/admin/settings");
    return { success: true, data: { imported: true } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Import failed." };
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
}

export async function getEmailConfig(): Promise<Result<EmailConfigMeta | null>> {
  try {
    const c = await admin();
    const { data, error } = await c
      .from("email_ingest_config")
      .select("provider, imap_host, imap_port, username, folder, search_query, password_hint, is_enabled, updated_at")
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data as EmailConfigMeta) ?? null };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not read email config." };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read sync state." };
  }
}

// Override the email watermark. Pass an ISO string to set a specific start point,
// or null to reset it to "now" (next sync fetches only future mail).
export async function setEmailWatermark(iso: string | null): Promise<Result> {
  try {
    const c = await admin();
    const at = iso === null ? new Date() : new Date(iso);
    if (Number.isNaN(at.getTime())) return { success: false, error: "Invalid date/time." };
    await setWatermark(c, "email", at);
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not update the watermark." };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read WhatsApp config." };
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
    const c = await admin();
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
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not save WhatsApp config." };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read WhatsApp runtime." };
  }
}

// ── worker lifecycle: the admin runs the companion worker from the app ──────
// The Next server spawns the worker as a detached child process (it must run on
// a persistent host — which the unofficial provider requires anyway). Output
// goes to .wa-worker.log; the Stop button flips a cooperative kill switch the
// worker polls, plus a best-effort SIGTERM on the recorded pid.

export async function startWhatsappWorker(): Promise<Result<{ pid: number }>> {
  try {
    const c = await admin();
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
    return { success: true, data: { pid: child.pid } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not start the worker." };
  }
}

export async function stopWhatsappWorker(): Promise<Result> {
  try {
    const c = await admin();
    const { data: rt } = await c.from("whatsapp_runtime").select("worker_pid").maybeSingle();
    // cooperative switch — the worker polls this every few seconds
    const { error } = await c.from("whatsapp_runtime")
      .update({ stop_requested: true }).eq("only_one", true);
    if (error) return { success: false, error: error.message };
    // best-effort direct signal too (same host)
    if (rt?.worker_pid) {
      try { process.kill(rt.worker_pid, "SIGTERM"); } catch { /* already gone / other host */ }
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not stop the worker." };
  }
}

export async function saveEmailConfig(input: SaveEmailInput): Promise<Result> {
  if (!input.host?.trim() || !input.username?.trim()) return { success: false, error: "Host and username are required." };
  const port = Number.parseInt(String(input.port), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) return { success: false, error: "Enter a valid IMAP port." };
  try {
    const c = await admin();
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
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not save email config." };
  }
}

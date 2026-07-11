// Outbound dispatch — provider-agnostic.
//   meta       → direct Graph API call (token from Vault), recorded in the outbox
//   unofficial → queued in whatsapp_outbox; the companion worker sends it
// A send failure NEVER throws to the caller: it's recorded and retryable.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WaProvider } from "./types";

export interface SendArgs {
  to: string;               // meta: E.164 phone · unofficial: jid
  body: string;
  kind: "ack" | "teaser";
  messageId?: string | null; // whatsapp_message.id linkage
}

export interface SendOutcome {
  ok: boolean;
  status: "sent" | "queued" | "failed";
  error?: string;
}

export async function sendWhatsApp(supabase: SupabaseClient, args: SendArgs): Promise<SendOutcome> {
  try {
    const { data: cfg } = await supabase
      .from("whatsapp_config")
      .select("provider, phone_number_id, is_enabled")
      .maybeSingle();
    if (!cfg?.is_enabled) return { ok: false, status: "failed", error: "WhatsApp is disabled in Settings." };
    const provider = cfg.provider as WaProvider;

    if (provider === "unofficial") {
      // queue for the worker
      const { error } = await supabase.from("whatsapp_outbox").insert({
        provider, to_addr: args.to, body: args.body, kind: args.kind, message_id: args.messageId ?? null,
      });
      if (error) return { ok: false, status: "failed", error: error.message };
      return { ok: true, status: "queued" };
    }

    // meta: direct Graph API send
    if (!cfg.phone_number_id) return { ok: false, status: "failed", error: "Meta phone-number ID missing in Settings." };
    const { data: token, error: tErr } = await supabase.rpc("get_whatsapp_secret", { p_kind: "token" });
    if (tErr || !token) return { ok: false, status: "failed", error: tErr?.message ?? "No Meta access token stored." };

    let res: Response;
    try {
      res = await fetch(`https://graph.facebook.com/v21.0/${cfg.phone_number_id}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token as string}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to: args.to, type: "text", text: { body: args.body } }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "network error";
      await recordOutbox(supabase, provider, args, "failed", msg);
      return { ok: false, status: "failed", error: `Meta send: ${msg}` };
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const msg = `Meta send HTTP ${res.status}: ${body.slice(0, 180)}`;
      await recordOutbox(supabase, provider, args, "failed", msg);
      return { ok: false, status: "failed", error: msg };
    }
    await recordOutbox(supabase, provider, args, "sent", null);
    return { ok: true, status: "sent" };
  } catch (e) {
    return { ok: false, status: "failed", error: e instanceof Error ? e.message : "send failed" };
  }
}

async function recordOutbox(
  supabase: SupabaseClient, provider: WaProvider, args: SendArgs,
  status: "sent" | "failed", error: string | null,
): Promise<void> {
  try {
    await supabase.from("whatsapp_outbox").insert({
      provider, to_addr: args.to, body: args.body, kind: args.kind, message_id: args.messageId ?? null,
      status, error, attempts: 1, sent_at: status === "sent" ? new Date().toISOString() : null,
    });
  } catch { /* the outbox record is an audit convenience — never fail the send path over it */ }
}

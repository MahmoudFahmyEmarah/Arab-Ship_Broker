/**
 * WhatsApp companion worker — the "unofficial" provider transport.
 *
 * Links a NORMAL WhatsApp number via QR (Baileys) and bridges it to the Data
 * Sync pipeline: inbound texts → whatsapp_message (dedup) → classify/stage/ack;
 * outbound acks/teasers ← whatsapp_outbox queue. The QR + connection state are
 * written to whatsapp_runtime so the admin pairs from Data Sync → Settings.
 *
 * Run (keep it running while testing):
 *   node --env-file=.env.local --import tsx scripts/whatsapp-worker.ts
 *
 * ⚠ ToS note: QR-linking automates a personal WhatsApp account, which WhatsApp's
 * terms disallow — numbers can be banned. Use for testing; switch the provider
 * to Meta Cloud API in Settings for production.
 */
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { rmSync } from "node:fs";
import { processPendingWhatsapp } from "@/lib/sync/whatsapp/process";

const AUTH_DIR = ".wa-auth";
const OUTBOX_POLL_MS = 3_000;
const HEARTBEAT_MS = 25_000;

// Baileys wants a pino-style logger; keep it silent.
type L = { level: string; child: () => L; trace: () => void; debug: () => void; info: () => void; warn: (...a: unknown[]) => void; error: (...a: unknown[]) => void };
const silent: L = { level: "silent", child: () => silent, trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

function db(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY — run with: node --env-file=.env.local --import tsx scripts/whatsapp-worker.ts");
    process.exit(1);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

async function setRuntime(sb: SupabaseClient, patch: Record<string, unknown>) {
  try {
    await sb.from("whatsapp_runtime").update({ ...patch, worker_seen: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("only_one", true);
  } catch { /* runtime is advisory */ }
}

async function main() {
  const sb = db();
  console.log("WhatsApp worker starting…", `pid ${process.pid}`);
  let sock: ReturnType<typeof makeWASocket> | null = null;
  let processing = false;
  let stopping = false;

  // Register this process so the app's Start/Stop buttons can manage it.
  await setRuntime(sb, { worker_pid: process.pid, stop_requested: false });

  async function shutdown(reason: string) {
    if (stopping) return;
    stopping = true;
    console.log("worker stopping:", reason);
    try { await setRuntime(sb, { state: "offline", qr: null, worker_pid: null, stop_requested: false }); } catch { /* best effort */ }
    try { sock?.end(undefined); } catch { /* ok */ }
    process.exit(0);
  }
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });

  async function triggerProcess() {
    if (processing) return;
    processing = true;
    try {
      const res = await processPendingWhatsapp(sb);
      for (const l of res.log) console.log("  ", l);
    } catch (e) {
      console.error("process error:", e instanceof Error ? e.message : e);
    } finally {
      processing = false;
    }
  }

  async function connect() {
    // Baileys' auth-state loader is NOT a React hook despite the name.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    // WhatsApp rejects outdated client versions with a 405 — always advertise
    // the current WA-Web version and a plausible browser identity.
    let version: [number, number, number] | undefined;
    try { ({ version } = await fetchLatestBaileysVersion()); } catch { version = undefined; }
    console.log("connecting", version ? `(WA-Web v${version.join(".")})` : "(bundled version)");
    sock = makeWASocket({
      version, auth: state, browser: Browsers.ubuntu("Chrome"),
      logger: silent as never, syncFullHistory: false, markOnlineOnConnect: false,
    });
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (u) => {
      if (u.qr) {
        console.log("QR ready — scan it from Data Sync → Settings → WhatsApp.");
        await setRuntime(sb, { state: "pairing", qr: u.qr, linked_as: null });
      }
      if (u.connection === "open") {
        const me = sock?.user?.id ?? null;
        console.log("connected as", me);
        await setRuntime(sb, { state: "connected", qr: null, linked_as: me });
      }
      if (u.connection === "close") {
        const code = (u.lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
        const loggedOut = code === DisconnectReason.loggedOut;
        console.log("connection closed", code, loggedOut ? "(logged out — clearing auth)" : "(reconnecting)");
        await setRuntime(sb, { state: loggedOut ? "offline" : "pairing", qr: null });
        if (loggedOut) { try { rmSync(AUTH_DIR, { recursive: true, force: true }); } catch { /* ok */ } }
        setTimeout(() => { connect().catch((e) => console.error("reconnect failed:", e)); }, 2_000);
      }
    });

    sock.ev.on("messages.upsert", async ({ messages, type }) => {
      // 'notify' = live messages; 'append' = offline-queued ones delivered on
      // reconnect. Dedupe by wa_message_id makes accepting both safe.
      if (type !== "notify" && type !== "append") return;
      for (const m of messages) {
        try {
          const jid = m.key.remoteJid ?? "";
          const text = m.message?.conversation ?? m.message?.extendedTextMessage?.text ?? null;
          // Log EVERY event so a filtered message is never an invisible mystery.
          console.log(`event · type=${type} from=${jid} fromMe=${!!m.key.fromMe} text=${text ? "yes" : "no"}`);
          // Direct chats arrive as @s.whatsapp.net OR — for privacy-enabled
          // accounts — as @lid. Groups (@g.us) and broadcasts are skipped.
          const isDirect = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
          if (m.key.fromMe || !isDirect) continue;
          if (!text?.trim()) continue;
          // For @lid chats Baileys exposes the real phone JID as senderPn —
          // prefer it as the reply address; the lid jid also works as fallback.
          const replyTo = (m.key as { senderPn?: string }).senderPn ?? jid;
          // Dedupe key = WhatsApp's own stanza id: it is IDENTICAL across every
          // delivery path of the same message (@lid vs phone jid, notify vs
          // append replay), and unique per message — so the same message can
          // never insert twice, while identical TEXT from a different message
          // (a colleague forwarding the same circular) is always processed.
          const waId = m.key.id && m.key.id.length >= 8
            ? m.key.id
            : `${replyTo}:${Number(m.messageTimestamp) || Date.now()}`;
          const { error } = await sb.from("whatsapp_message").upsert(
            [{
              wa_message_id: waId, provider: "unofficial", wa_from: replyTo,
              contact_name: m.pushName ?? null, body: text,
              received_at: new Date((Number(m.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
              raw: { unofficial: true, remoteJid: jid },
            }],
            { onConflict: "wa_message_id", ignoreDuplicates: true },
          );
          if (error) console.error("inbox insert failed:", error.message);
          else console.log(`inbound · ${m.pushName ?? replyTo}: ${text.slice(0, 60)}`);
        } catch (e) {
          console.error("inbound handling error:", e instanceof Error ? e.message : e);
        }
      }
      void triggerProcess();
    });
  }

  // outbox sender loop (only rows queued for this provider) + stop-switch poll
  setInterval(async () => {
    try {
      const { data: rt } = await sb.from("whatsapp_runtime").select("stop_requested").maybeSingle();
      if (rt?.stop_requested) { void shutdown("stop requested from the app"); return; }
    } catch { /* next tick */ }
    if (!sock?.user) return;
    try {
      const { data: queued } = await sb
        .from("whatsapp_outbox")
        .select("id, to_addr, body, attempts, kind, message_id")
        .eq("provider", "unofficial").eq("status", "queued")
        .order("created_at", { ascending: true }).limit(5);
      for (const q of queued ?? []) {
        try {
          await sock.sendMessage(q.to_addr, { text: q.body });
          await sb.from("whatsapp_outbox").update({ status: "sent", sent_at: new Date().toISOString(), attempts: q.attempts + 1 }).eq("id", q.id);
          if (q.kind === "ack" && q.message_id) {
            await sb.from("whatsapp_message").update({ ack_status: "sent" }).eq("id", q.message_id);
          }
          console.log("sent →", q.to_addr);
        } catch (e) {
          const msg = e instanceof Error ? e.message : "send failed";
          const attempts = q.attempts + 1;
          await sb.from("whatsapp_outbox").update({
            status: attempts >= 3 ? "failed" : "queued", error: msg, attempts,
          }).eq("id", q.id);
          console.error("send failed:", msg);
        }
      }
    } catch { /* next tick */ }
  }, OUTBOX_POLL_MS);

  // heartbeat + safety-net sweep for anything the upsert trigger missed
  setInterval(async () => {
    await setRuntime(sb, {});
    void triggerProcess();
  }, HEARTBEAT_MS);

  await connect();
}

main().catch((e) => { console.error(e); process.exit(1); });

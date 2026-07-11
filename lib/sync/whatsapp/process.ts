// The WhatsApp processor: pending inbox messages → classify (same LangGraph
// triple-gate) → stage (source 'whatsapp', WA- provisional refs, one batch per
// message) → auto-ack with the redacted extract summary.
//
// Failure containment (per message): classify/stage errors mark THAT message
// 'failed' (retryable) and never abort the sweep; an ack failure never undoes
// a successful staging; nothing here throws to the caller.

import type { SupabaseClient } from "@supabase/supabase-js";
import { stageBatch } from "../stage";
import { EmailLlmSource } from "../email-source";
import { recordsToSheets } from "../email/to-rows";
import { buildClassifierGraph } from "../email/graph";
import { LangChainClassifier } from "../email/classifier";
import { getActiveModel } from "../email/llm";
import type { CargoRecord, EmailMsg, VesselRecord } from "../email/types";
import { composeExtractSummary, renderTemplate } from "./ack";
import { sendWhatsApp } from "./send";
import type { WaInboundMessage } from "./types";

export interface ProcessSummary {
  processed: number;
  staged: number;
  irrelevant: number;
  failed: number;
  log: string[];
}

const BATCH = 8;               // messages per LLM call (they're short)
const TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`classification timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

export async function processPendingWhatsapp(
  supabase: SupabaseClient,
  opts: { includeFailed?: boolean; limit?: number } = {},
): Promise<ProcessSummary> {
  const out: ProcessSummary = { processed: 0, staged: 0, irrelevant: 0, failed: 0, log: [] };
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  let cfg: { auto_reply: boolean; reply_template: string; platform_url: string; is_enabled: boolean } | null = null;
  try {
    const { data } = await supabase
      .from("whatsapp_config")
      .select("auto_reply, reply_template, platform_url, is_enabled")
      .maybeSingle();
    cfg = data;
  } catch { /* config unreadable → still classify+stage, just skip acks */ }

  const statuses = opts.includeFailed ? ["pending", "failed"] : ["pending"];
  const { data: msgs, error } = await supabase
    .from("whatsapp_message")
    .select("id, wa_message_id, provider, wa_from, contact_name, body, received_at")
    .in("status", statuses)
    .order("received_at", { ascending: true })
    .limit(limit);
  if (error) { out.log.push(`inbox read failed: ${error.message}`); return out; }
  let pending = (msgs ?? []) as WaInboundMessage[];
  if (pending.length === 0) { out.log.push("no pending messages"); return out; }

  // Transport-duplicate guard (narrow BY DESIGN): only the SAME SENDER sending
  // the identical text within 3 minutes is a delivery glitch. The same text
  // from a DIFFERENT contact (colleagues forward the same circular) — or a
  // deliberate re-send later — is a real enquiry and always gets processed
  // and acknowledged. Exact re-deliveries are already blocked by the stanza-id
  // key at insert time.
  const survivors: WaInboundMessage[] = [];
  const seen = new Set<string>();
  for (const m of pending) {
    const key = `${m.wa_from}|${m.body.trim()}`;
    let dup = seen.has(key);
    if (!dup) {
      const { data: prior } = await supabase
        .from("whatsapp_message")
        .select("id")
        .neq("id", m.id)
        .eq("wa_from", m.wa_from)
        .eq("body", m.body)
        .eq("status", "staged")
        .gte("received_at", new Date(new Date(m.received_at).getTime() - 3 * 60_000).toISOString())
        .limit(1);
      dup = !!prior?.length;
    }
    if (dup) {
      out.irrelevant += 1;
      await supabase.from("whatsapp_message").delete().eq("id", m.id);
      out.log.push(`— transport duplicate discarded · ${m.body.slice(0, 40)}`);
      continue;
    }
    seen.add(key);
    survivors.push(m);
  }
  pending = survivors;
  if (pending.length === 0) { out.log.push("no new messages after dedupe"); return out; }

  let graph: ReturnType<typeof buildClassifierGraph>;
  try {
    const { model } = await getActiveModel(supabase);
    graph = buildClassifierGraph(new LangChainClassifier(model));
  } catch (e) {
    out.log.push(`LLM unavailable: ${e instanceof Error ? e.message : "error"}`);
    return out; // messages stay pending — retried on the next sweep
  }

  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    const emails: EmailMsg[] = slice.map((m) => ({
      id: m.id,
      from: m.contact_name ? `${m.contact_name} <${m.wa_from}>` : m.wa_from,
      subject: m.body.slice(0, 80),
      date: m.received_at,
      text: m.body,
    }));

    let results: { cargo: CargoRecord[]; vessels: VesselRecord[] }[];
    try {
      const res = await withTimeout(graph.invoke({ emails }), TIMEOUT_MS);
      // The graph tags every record's __src.msgId with the source message id —
      // partition the aggregate back to per-message groups, then decorate the
      // source snapshot with the WhatsApp contact for the Review drawer/teaser.
      results = slice.map((m) => {
        const decorate = <T extends CargoRecord | VesselRecord>(r: T): T => ({
          ...r,
          __src: {
            from: m.wa_from, subject: m.contact_name ?? m.wa_from,
            date: m.received_at, text: m.body.slice(0, 4000),
            channel: "whatsapp" as const, name: m.contact_name, msgId: m.id,
          },
        });
        return {
          cargo: res.cargo.filter((c) => c.__src?.msgId === m.id).map(decorate),
          vessels: res.vessels.filter((v) => v.__src?.msgId === m.id).map(decorate),
        };
      });
      // defensive: if partitioning lost records and this is a single-message
      // slice, everything belongs to it anyway.
      const seen = results.reduce((a, r) => a + r.cargo.length + r.vessels.length, 0);
      const total = res.cargo.length + res.vessels.length;
      if (seen < total && slice.length === 1) {
        const m = slice[0];
        const dec = <T extends CargoRecord | VesselRecord>(r: T): T => ({
          ...r,
          __src: { from: m.wa_from, subject: m.contact_name ?? m.wa_from, date: m.received_at, text: m.body.slice(0, 4000), channel: "whatsapp" as const, name: m.contact_name, msgId: m.id },
        });
        results = [{ cargo: res.cargo.map(dec), vessels: res.vessels.map(dec) }];
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "classification failed";
      for (const m of slice) {
        out.failed += 1;
        await supabase.from("whatsapp_message").update({ status: "failed", error: msg }).eq("id", m.id);
      }
      out.log.push(`✗ batch of ${slice.length} failed — ${msg}`);
      continue;
    }

    for (let j = 0; j < slice.length; j += 1) {
      const m = slice[j];
      const { cargo, vessels } = results[j];
      out.processed += 1;

      if (cargo.length === 0 && vessels.length === 0) {
        out.irrelevant += 1;
        // Irrelevant = personal/chit-chat. PRIVACY: never retain such content —
        // delete the row entirely. (Exact re-deliveries are still blocked by the
        // address-independent wa_message_id key while any copy exists, and a
        // re-classified replay simply lands here again.)
        await supabase.from("whatsapp_message").delete().eq("id", m.id);
        out.log.push(`— irrelevant, discarded · ${m.body.slice(0, 30)}`);
        continue;
      }

      try {
        const sheets = recordsToSheets(cargo, vessels, { refPrefix: "WA" });
        const label = `WA · ${m.contact_name ?? m.wa_from} · ${m.received_at.slice(0, 16).replace("T", " ")}`;
        const result = await stageBatch({
          supabase, source: new EmailLlmSource(sheets, "whatsapp"),
          fileName: `whatsapp:${m.wa_from}`, label,
        });
        // Everything may have been diverted to Manual Review (e.g. a no-IMO
        // vessel) — don't leave a confusing empty draft batch behind.
        const stagedRows = result.totals.new + result.totals.updated + result.totals.unchanged + result.totals.invalid;
        let batchId: string | null = result.batchId;
        if (stagedRows === 0) {
          await supabase.from("sync_batch").delete().eq("id", result.batchId);
          batchId = null;
          out.log.push(`→ all records routed to Manual Review · ${m.contact_name ?? m.wa_from}`);
        }
        out.staged += 1;
        await supabase.from("whatsapp_message").update({
          status: "staged", batch_id: batchId,
          staged_cargo: cargo.length, staged_vessels: vessels.length, error: null,
        }).eq("id", m.id);
        out.log.push(`✓ staged ${cargo.length} cargo + ${vessels.length} vessel · ${m.contact_name ?? m.wa_from}`);

        // auto-ack — best-effort, never rolls back staging. Simulated (pasted)
        // messages have no real recipient, and messages older than 24h (restart
        // replays, backfills) must never trigger a late reply to the contact.
        const ageMs = Date.now() - new Date(m.received_at).getTime();
        if (m.wa_from.startsWith("simulated") || ageMs > 24 * 3600_000) {
          await supabase.from("whatsapp_message").update({ ack_status: "skipped" }).eq("id", m.id);
          if (ageMs > 24 * 3600_000) out.log.push(`— ack skipped (message older than 24h) · ${m.contact_name ?? m.wa_from}`);
        } else if (cfg?.auto_reply) {
          const summary = composeExtractSummary(cargo, vessels);
          const body = renderTemplate(cfg.reply_template, {
            name: m.contact_name?.trim() || "Captain", summary, url: cfg.platform_url,
          }).replace(/\n{3,}/g, "\n\n").trim();
          const sent = await sendWhatsApp(supabase, { to: m.wa_from, body, kind: "ack", messageId: m.id });
          await supabase.from("whatsapp_message").update({
            ack_status: sent.status === "sent" ? "sent" : sent.status === "queued" ? "queued" : "failed",
            ack_error: sent.ok ? null : sent.error ?? null,
          }).eq("id", m.id);
        } else {
          await supabase.from("whatsapp_message").update({ ack_status: "skipped" }).eq("id", m.id);
        }
      } catch (e) {
        out.failed += 1;
        const msg = e instanceof Error ? e.message : "staging failed";
        await supabase.from("whatsapp_message").update({ status: "failed", error: msg }).eq("id", m.id);
        out.log.push(`✗ staging failed · ${msg}`);
      }
    }
  }
  return out;
}

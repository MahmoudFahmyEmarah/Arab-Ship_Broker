// The WhatsApp processor: pending inbox messages → classify (same LangGraph
// triple-gate) → stage (source 'whatsapp', WA- provisional refs, one batch per
// message) → auto-ack with the redacted extract summary.
//
// Failure containment (per message): classify/stage errors mark THAT message
// 'failed' (retryable) and never abort the sweep; an ack failure never undoes
// a successful staging; nothing here throws to the caller.
//
// Phase 1 (18 Sep 2026): messages are CLAIMED, not selected. claim_whatsapp_
// messages() hands this call the oldest pending rows with a fresh lease token
// each (FOR UPDATE SKIP LOCKED), every result write is guarded by that token,
// unprocessed claims are handed back when the time budget runs out, and a
// lease lost mid-flight (a zombie worker) discards its own batch rather than
// staging the message twice.

import type { SupabaseClient } from "@supabase/supabase-js";
import { stageBatch } from "../stage";
import { EmailLlmSource } from "../email-source";
import { recordsToSheets } from "../email/to-rows";
import { buildClassifierGraph } from "../email/graph";
import { LangChainClassifier } from "../email/classifier";
import { getActiveModel } from "../email/llm";
import { UsageMeter, aiBudgetToday, meterUsage } from "../email/usage";
import type { CargoRecord, EmailMsg, SyncStepKey, SyncStepState, VesselRecord } from "../email/types";
import { composeExtractSummary, renderTemplate } from "./ack";
import { sendWhatsApp } from "./send";
import type { WaInboundMessage } from "./types";

export interface ProcessSummary {
  processed: number;
  staged: number;
  irrelevant: number;
  failed: number;
  log: string[];
  /** the five pipeline stages, so the Intake run panel can draw the sweep */
  steps: { key: SyncStepKey; state: SyncStepState; detail?: string }[];
  usage: { tokens: number; cost: number; calls: number } | null;
}

const BATCH = 8;               // messages per LLM call (they're short)
const TIMEOUT_MS = 90_000;     // ceiling per classification call
const MIN_BATCH_MS = 20_000;   // below this much remaining budget, stop and hand the rest back

/** Per-call timeout that fits inside what is left of the caller's budget (unit-tested). */
export function batchTimeout(remainingMs: number, ceilingMs = TIMEOUT_MS): number {
  return Math.max(5_000, Math.min(ceilingMs, remainingMs - 5_000));
}

export interface ProcessOpts {
  includeFailed?: boolean;
  limit?: number;
  /** wall-clock budget for this call; leases outlive it by a minute */
  budgetMs?: number;
  /** who holds the leases: webhook · cron · admin · worker */
  owner?: string;
}

type Claimed = WaInboundMessage & { lease_token: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`classification timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

export async function processPendingWhatsapp(
  supabase: SupabaseClient,
  opts: ProcessOpts = {},
): Promise<ProcessSummary> {
  const out: ProcessSummary = { processed: 0, staged: 0, irrelevant: 0, failed: 0, log: [], steps: [], usage: null };
  const step = (key: SyncStepKey, state: SyncStepState, detail?: string) => {
    const i = out.steps.findIndex((s) => s.key === key);
    const e = { key, state, detail };
    if (i >= 0) out.steps[i] = e; else out.steps.push(e);
  };
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const budgetMs = Math.max(15_000, opts.budgetMs ?? 240_000);
  const owner = opts.owner ?? "worker";
  const t0 = Date.now();
  const remaining = () => budgetMs - (Date.now() - t0);
  step("connect", "running");

  let cfg: { auto_reply: boolean; reply_template: string; platform_url: string; is_enabled: boolean } | null = null;
  try {
    const { data } = await supabase
      .from("whatsapp_config")
      .select("auto_reply, reply_template, platform_url, is_enabled")
      .maybeSingle();
    cfg = data;
  } catch { /* config unreadable → still classify+stage, just skip acks */ }

  // Claim, don't select: each row comes back leased to this call.
  const { data: msgs, error } = await supabase.rpc("claim_whatsapp_messages", {
    p_owner: owner, p_limit: limit, p_ttl_seconds: Math.ceil(budgetMs / 1000) + 60, p_include_failed: !!opts.includeFailed,
  });
  if (error) { step("connect", "failed", error.message); out.log.push(`inbox claim failed: ${error.message}`); return out; }
  step("connect", "done", cfg ? (cfg.is_enabled ? "WhatsApp enabled" : "WhatsApp disabled — classify only") : "no config");
  let pending = (msgs ?? []) as Claimed[];
  // claims not yet handled — handed back if the budget runs out
  const unprocessed = new Map<string, string>(pending.map((m) => [m.id, m.lease_token]));
  step("fetch", "done", `${pending.length} message(s) claimed`);
  if (pending.length === 0) { step("classify", "skipped"); step("stage", "skipped"); step("gate", "skipped"); out.log.push("no pending messages"); return out; }

  // Every write is guarded by the lease token: false means the lease is no
  // longer ours (it expired and another worker claimed the message).
  const own = async (m: Claimed, patch: Record<string, unknown>): Promise<boolean> => {
    const { data, error: uErr } = await supabase.from("whatsapp_message").update(patch).eq("id", m.id).eq("lease_token", m.lease_token).select("id");
    if (uErr) { out.log.push(`✗ could not update message ${m.id.slice(0, 8)}: ${uErr.message}`); return false; }
    return (data?.length ?? 0) > 0;
  };
  const ownDelete = async (m: Claimed): Promise<boolean> => {
    const { data } = await supabase.from("whatsapp_message").delete().eq("id", m.id).eq("lease_token", m.lease_token).select("id");
    return (data?.length ?? 0) > 0;
  };
  const handBack = async () => {
    const tokens = [...unprocessed.values()];
    if (!tokens.length) return;
    try {
      await supabase.rpc("release_whatsapp_messages", { p_tokens: tokens });
      out.log.push(`${tokens.length} claimed message(s) handed back for the next sweep`);
    } catch { /* the leases expire on their own */ }
  };

  // Transport-duplicate guard (narrow BY DESIGN): only the SAME SENDER sending
  // the identical text within 3 minutes is a delivery glitch. The same text
  // from a DIFFERENT contact (colleagues forward the same circular) — or a
  // deliberate re-send later — is a real enquiry and always gets processed
  // and acknowledged. Exact re-deliveries are already blocked by the stanza-id
  // key at insert time.
  const survivors: Claimed[] = [];
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
      unprocessed.delete(m.id);
      await ownDelete(m);
      out.log.push(`— transport duplicate discarded · ${m.body.slice(0, 40)}`);
      continue;
    }
    seen.add(key);
    survivors.push(m);
  }
  pending = survivors;
  if (pending.length === 0) { step("classify", "skipped"); step("stage", "skipped"); step("gate", "skipped"); out.log.push("no new messages after dedupe"); return out; }

  let graph: ReturnType<typeof buildClassifierGraph>;
  const meter = new UsageMeter();
  let pricePerMtok = 0;
  try {
    const budget = await aiBudgetToday(supabase);
    pricePerMtok = budget.pricePerMtok;
    if (budget.left <= 0) throw new Error(`AI budget exhausted — ${budget.used.toLocaleString()} of ${budget.cap.toLocaleString()} tokens used today`);
    const { model } = await getActiveModel(supabase);
    graph = buildClassifierGraph(new LangChainClassifier(model, [meter]));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    step("classify", "failed", msg);
    out.log.push(`LLM unavailable: ${msg}`);
    await handBack(); // messages go back to pending — retried on the next sweep
    return out;
  }
  step("classify", "running", `${pending.length} message(s)`);

  for (let i = 0; i < pending.length; i += BATCH) {
    const left = remaining();
    if (left < MIN_BATCH_MS) {
      out.log.push(`time budget used — ${pending.length - i} message(s) wait for the next sweep`);
      break;
    }
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
      const res = await withTimeout(graph.invoke({ emails }), batchTimeout(left));
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
      const seenN = results.reduce((a, r) => a + r.cargo.length + r.vessels.length, 0);
      const total = res.cargo.length + res.vessels.length;
      if (seenN < total && slice.length === 1) {
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
        unprocessed.delete(m.id);
        await own(m, { status: "failed", error: msg, lease_token: null, lease_until: null });
      }
      out.log.push(`✗ batch of ${slice.length} failed — ${msg}`);
      continue;
    }
    step("stage", "running");

    for (let j = 0; j < slice.length; j += 1) {
      const m = slice[j];
      const { cargo, vessels } = results[j];
      out.processed += 1;
      unprocessed.delete(m.id);

      if (cargo.length === 0 && vessels.length === 0) {
        out.irrelevant += 1;
        // Irrelevant = personal/chit-chat. PRIVACY: never retain such content —
        // delete the row entirely. (Exact re-deliveries are still blocked by the
        // address-independent wa_message_id key while any copy exists, and a
        // re-classified replay simply lands here again.)
        await ownDelete(m);
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
        // The lease decides who owns the result. If it is no longer ours, a
        // zombie is what we are: discard OUR batch so the message is not
        // staged twice, and leave the row to its current owner.
        const kept = await own(m, {
          status: "staged", batch_id: batchId,
          staged_cargo: cargo.length, staged_vessels: vessels.length, error: null,
        });
        if (!kept) {
          if (batchId) await supabase.from("sync_batch").delete().eq("id", batchId);
          out.log.push(`— lease lost on ${m.contact_name ?? m.wa_from}: another worker owns the message; this copy of the batch was discarded`);
          continue;
        }
        out.staged += 1;
        out.log.push(`✓ staged ${cargo.length} cargo + ${vessels.length} vessel · ${m.contact_name ?? m.wa_from}`);

        // auto-ack — best-effort, never rolls back staging. Simulated (pasted)
        // messages have no real recipient, and messages older than 24h (restart
        // replays, backfills) must never trigger a late reply to the contact.
        const ageMs = Date.now() - new Date(m.received_at).getTime();
        if (m.wa_from.startsWith("simulated") || ageMs > 24 * 3600_000) {
          await own(m, { ack_status: "skipped" });
          if (ageMs > 24 * 3600_000) out.log.push(`— ack skipped (message older than 24h) · ${m.contact_name ?? m.wa_from}`);
        } else if (cfg?.auto_reply) {
          const summary = composeExtractSummary(cargo, vessels);
          const body = renderTemplate(cfg.reply_template, {
            name: m.contact_name?.trim() || "Captain", summary, url: cfg.platform_url,
          }).replace(/\n{3,}/g, "\n\n").trim();
          const sent = await sendWhatsApp(supabase, { to: m.wa_from, body, kind: "ack", messageId: m.id });
          await own(m, {
            ack_status: sent.status === "sent" ? "sent" : sent.status === "queued" ? "queued" : "failed",
            ack_error: sent.ok ? null : sent.error ?? null,
          });
        } else {
          await own(m, { ack_status: "skipped" });
        }
        // done with this message: drop the lease
        await own(m, { lease_token: null, lease_until: null });
      } catch (e) {
        out.failed += 1;
        const msg = e instanceof Error ? e.message : "staging failed";
        await own(m, { status: "failed", error: msg, lease_token: null, lease_until: null });
        out.log.push(`✗ staging failed · ${msg}`);
      }
    }
  }
  await handBack();
  step("classify", out.failed && !out.staged ? "failed" : "done", `${out.processed} processed · ${out.irrelevant} irrelevant`);
  step("stage", out.staged ? "done" : "skipped", `${out.staged} staged · ${out.failed} failed`);
  step("gate", out.staged ? "done" : "skipped", "checked at staging");
  const totals = meter.totals();
  if (totals.tokens > 0) {
    const cost = await meterUsage(supabase, totals, pricePerMtok);
    out.usage = { tokens: totals.tokens, cost, calls: totals.calls };
    out.log.push(`model usage · ${totals.tokens.toLocaleString()} tokens · USD ${cost.toFixed(4)} · ${totals.calls} call(s)`);
  }
  return out;
}

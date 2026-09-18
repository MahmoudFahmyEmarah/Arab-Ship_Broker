// Orchestrates an email sync end-to-end and streams progress events:
//   settings → decrypt → (IMAP fetch | pasted sample) → LangGraph classify each
//   → records → ParsedSheet[] → stageBatch → a review batch.
// Reuses the exact staging/diff pipeline; the result is a normal sync_batch the
// Review UI opens like any upload.

import type { SupabaseClient } from "@supabase/supabase-js";
import { stageBatch } from "../stage";
import { EmailLlmSource } from "../email-source";
import { checkpointAfterPage, claimSyncRun, getEmailCheckpoint, releaseSyncRun, setEmailCheckpoint } from "../state";
import { buildClassifierGraph } from "./graph";
import { LangChainClassifier } from "./classifier";
import { getActiveModel } from "./llm";
import { UsageMeter, aiBudgetToday, meterUsage } from "./usage";
import { fetchCirculars } from "./imap";
import { recordsToSheets } from "./to-rows";
import type { CargoRecord, EmailMsg, SyncEvent, SyncStepKey, SyncStepState, VesselRecord } from "./types";

type Emit = (e: SyncEvent) => void;
const step = (emit: Emit, key: SyncStepKey, state: SyncStepState, detail?: string) => emit({ type: "step", key, state, detail });

const CONCURRENCY = 5;             // batches classified in parallel
const RETRIES = 2;                 // attempts per batch
const BATCH_TIMEOUT_MS = 90_000;   // hard cap per batch call (stalled requests never reject)
const MAX_BATCH_EMAILS = 10;       // emails per LLM call (output-token safety)
const MAX_BATCH_CHARS = 120_000;   // ~30k input tokens per call, well under model limits

// Long digests (many circulars stacked in one email) used to be TRUNCATED at
// the classifier's per-email cap — every order past the cut was silently lost.
// Instead, split a long email into overlapping parts BEFORE batching; each part
// is classified in full and the overlap plus downstream dedup (provisional-ref
// hash for cargo, composite key for vessels) collapses anything extracted twice.
const PART_CHARS = 8_000;          // max chars per part (classifier cap is 8,800)
const PART_OVERLAP = 600;          // re-shown at each cut so no order is split blind
const MAX_PARTS = 6;               // hard cost bound (~48k chars ≈ any real digest)

export function splitLongEmail(e: EmailMsg): EmailMsg[] {
  if (e.text.length <= PART_CHARS) return [e];
  const parts: EmailMsg[] = [];
  let start = 0;
  while (start < e.text.length && parts.length < MAX_PARTS) {
    let end = Math.min(start + PART_CHARS, e.text.length);
    if (end < e.text.length) {
      const nl = e.text.lastIndexOf("\n", end);
      if (nl > start + PART_CHARS / 2) end = nl;   // prefer a line boundary
    }
    const i = parts.length + 1;
    parts.push({ ...e, id: `${e.id}#p${i}`, subject: `${e.subject} (part ${i})`, text: e.text.slice(start, end) });
    if (end >= e.text.length) break;
    start = end - PART_OVERLAP;
  }
  return parts;
}

// Overlap/dedup keys — the same commercial facts extracted twice are one item.
const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
function cargoKey(c: CargoRecord): string {
  return [c.commodity, c.qty_min_mt, c.qty_max_mt, c.load_port, c.load_zone, c.disch_port, c.disch_zone, c.laycan_from, c.laycan_to].map(norm).join("|");
}
function vesselKey(v: VesselRecord): string {
  return [v.imo || v.vessel_name, v.dwt, v.open_port, v.open_date].map(norm).join("|");
}
function dedupBy<T>(items: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = key(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Hard timeout: a stalled network request never rejects on its own, so race it
// against a timer. This is what stops the run hanging on the last email.
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`)), ms)),
  ]);
}

// Group emails into token-budgeted batches so many go in a single LLM call.
function batchEmails(emails: EmailMsg[]): EmailMsg[][] {
  const batches: EmailMsg[][] = [];
  let cur: EmailMsg[] = [];
  let curChars = 0;
  for (const e of emails) {
    const len = Math.min(e.text.length, PART_CHARS + PART_OVERLAP) + 200;
    if (cur.length > 0 && (cur.length >= MAX_BATCH_EMAILS || curChars + len > MAX_BATCH_CHARS)) {
      batches.push(cur); cur = []; curChars = 0;
    }
    cur.push(e); curChars += len;
  }
  if (cur.length > 0) batches.push(cur);
  return batches;
}

// Retry transient failures (e.g. "fetch failed" network blips, 429/503) with
// exponential backoff. Non-transient errors still surface after the attempts.
async function withRetry<T>(fn: () => Promise<T>, tries = RETRIES): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await sleep(700 * (i + 1));
    }
  }
  throw last;
}

// Run `fn` over items with at most `limit` in flight at once.
async function mapLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  const inFlight = new Set<Promise<void>>();
  let idx = 0;
  for (const item of items) {
    const i = idx++;
    const p = fn(item, i).finally(() => inFlight.delete(p));
    inFlight.add(p);
    if (inFlight.size >= limit) await Promise.race(inFlight);
  }
  await Promise.all(inFlight);
}

async function classifyAll(
  supabase: SupabaseClient,
  emails: EmailMsg[],
  emit: Emit,
): Promise<{ cargo: CargoRecord[]; vessels: VesselRecord[]; failed: number; firstError: string | null }> {
  // Daily token budget — shared with Data quality. Refusing here keeps the
  // watermark where it was, so nothing is skipped once the cap resets.
  const budget = await aiBudgetToday(supabase);
  if (budget.left <= 0) {
    throw new Error(`AI budget exhausted — ${budget.used.toLocaleString()} of ${budget.cap.toLocaleString()} tokens used today. Raise the cap in Data quality → Settings or run again tomorrow.`);
  }
  const { model, vendor, modelName } = await getActiveModel(supabase);
  const meter = new UsageMeter();
  const graph = buildClassifierGraph(new LangChainClassifier(model, [meter]));
  const expanded = emails.flatMap(splitLongEmail);
  const batches = batchEmails(expanded);
  const nSplit = expanded.length - emails.length;
  emit({ type: "log", msg: `classifying ${emails.length} email(s)${nSplit > 0 ? ` (+${nSplit} long-digest part(s))` : ""} with ${vendor} · ${modelName} — ${batches.length} batch(es) of up to ${MAX_BATCH_EMAILS}, ${CONCURRENCY} in parallel` });

  const cargo: CargoRecord[] = [];
  const vessels: VesselRecord[] = [];
  let doneEmails = 0;
  let doneBatches = 0;
  let failed = 0;
  let firstError: string | null = null;
  // Array push is safe across these awaits (single-threaded); order doesn't matter.
  await mapLimit(batches, CONCURRENCY, async (batch) => {
    try {
      const res = await withRetry(() => withTimeout(graph.invoke({ emails: batch }), BATCH_TIMEOUT_MS, "classify"), RETRIES);
      cargo.push(...res.cargo);
      vessels.push(...res.vessels);
      doneEmails += batch.length; doneBatches += 1;
      emit({ type: "log", msg: `[${doneEmails}/${expanded.length}] batch ${doneBatches}/${batches.length} → ${res.cargo.length} cargo, ${res.vessels.length} vessel` });
    } catch (e) {
      doneEmails += batch.length; doneBatches += 1; failed += 1;
      const msg = e instanceof Error ? e.message : "error";
      if (!firstError) firstError = msg;
      emit({ type: "log", msg: `[${doneEmails}/${expanded.length}] ✗ batch ${doneBatches}/${batches.length} skipped (${batch.length} email(s)) — ${msg}` });
    }
  });
  // Collapse duplicates from part overlaps (and identical orders circulated in
  // several emails of the same run — one listing either way).
  const uCargo = dedupBy(cargo, cargoKey);
  const uVessels = dedupBy(vessels, vesselKey);
  const dropped = cargo.length - uCargo.length + vessels.length - uVessels.length;
  if (dropped > 0) emit({ type: "log", msg: `deduplicated ${dropped} repeated extraction(s) across email parts` });
  // Meter what the model actually consumed, at the configured price.
  const totals = meter.totals();
  const cost = await meterUsage(supabase, totals, budget.pricePerMtok);
  if (totals.tokens > 0) {
    emit({ type: "usage", tokens: totals.tokens, cost, calls: totals.calls });
    emit({ type: "log", msg: `model usage · ${totals.tokens.toLocaleString()} tokens · USD ${cost.toFixed(4)} · ${totals.calls} call(s)` });
  }
  return { cargo: uCargo, vessels: uVessels, failed, firstError };
}

async function stageAndFinish(
  supabase: SupabaseClient,
  cargo: CargoRecord[],
  vessels: VesselRecord[],
  fileName: string,
  emit: Emit,
  startedBy: string | null = null,
  announce = true,
) {
  const sheets = recordsToSheets(cargo, vessels);
  if (sheets.length === 0) { step(emit, "stage", "skipped", "nothing to stage"); step(emit, "gate", "skipped"); return null; }
  emit({ type: "log", msg: `staging ${cargo.length} cargo + ${vessels.length} vessel record(s)…` });
  step(emit, "stage", "running", `${cargo.length} cargo · ${vessels.length} vessel`);
  const source = new EmailLlmSource(sheets);
  const label = `Email sync · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  // startedBy = the admin running the sync — credited as the poster on the
  // market cards (get_listing_posters), never the circular's sender.
  const result = await stageBatch({ supabase, source, fileName, label, startedBy });
  step(emit, "stage", "done", `${result.totals.new} new · ${result.totals.updated} updated`);
  step(emit, "gate", "done", result.gate ? `${result.gate.blocked} blocked · ${result.gate.warned} warned · ${result.gate.rules} rules` : "gate did not run");
  if (announce) emit({ type: "done", batchId: result.batchId, totals: { ...result.totals, gateBlocked: result.gate?.blocked ?? 0, queued: result.totals.queued ?? 0 } });
  return result;
}

type Totals = { new: number; updated: number; unchanged: number; invalid: number; errors: number; gateBlocked?: number; queued?: number };
const addTotals = (a: Totals, b: Totals): Totals => ({
  new: a.new + b.new, updated: a.updated + b.updated, unchanged: a.unchanged + b.unchanged, invalid: a.invalid + b.invalid, errors: a.errors + b.errors,
  gateBlocked: (a.gateBlocked ?? 0) + (b.gateBlocked ?? 0), queued: (a.queued ?? 0) + (b.queued ?? 0),
});

// Live IMAP sync of the configured circulation inbox.
//
// Phase 1 (18 Sep 2026): one run at a time per inbox (claimSyncRun), read
// OLDEST first from the IMAP UID checkpoint page by page until the inbox is
// drained, the page budget is used or the time budget is spent, and move the
// checkpoint only after each page is staged. A classification batch that
// fails stops the run with the checkpoint where it was, so that mail is read
// again next time.
export async function runEmailSync(
  { supabase, limit, emit, startedBy = null, since: sinceOverride = null, owner = "admin", budgetMs = 240_000, maxPages = 6 }:
  { supabase: SupabaseClient; limit?: number; emit: Emit; startedBy?: string | null; since?: Date | null; owner?: string; budgetMs?: number; maxPages?: number },
): Promise<void> {
  emit({ type: "log", msg: "reading inbox connection…" });
  step(emit, "connect", "running");
  const { data: cfg, error } = await supabase
    .from("email_ingest_config")
    .select("imap_host, imap_port, username, folder, search_query, is_enabled")
    .maybeSingle();
  const fail = (msg: string) => { step(emit, "connect", "failed", msg); emit({ type: "error", error: msg }); };
  if (error) { fail(error.message); return; }
  if (!cfg) { fail("No circulation inbox configured — set it up in Connections."); return; }
  if (!cfg.is_enabled) { fail("The circulation inbox is disabled. Enable it in Connections."); return; }
  if (!cfg.imap_host || !cfg.username) { fail("Inbox host/username missing in Connections."); return; }

  const { data: password, error: pErr } = await supabase.rpc("get_email_password");
  if (pErr) { fail(pErr.message); return; }
  if (!password) { fail("No inbox password stored. Add it in Connections."); return; }
  step(emit, "connect", "done", `${cfg.username} @ ${cfg.imap_host}`);

  // One run per inbox. The lease outlives the time budget by a margin so a
  // run that is still staging its last page is not taken over.
  const t0 = Date.now();
  const startedAt = new Date(t0);
  let lease: Awaited<ReturnType<typeof claimSyncRun>>;
  try {
    lease = await claimSyncRun(supabase, "email", owner, budgetMs / 1000 + 120);
  } catch (e) {
    fail(e instanceof Error ? e.message : "run lease unavailable"); return;
  }
  if (!lease.claimed) {
    const until = lease.leaseUntil ? lease.leaseUntil.toISOString().slice(11, 16) : "soon";
    const msg = `Another inbox sync (${lease.leaseOwner ?? "unknown"}) is still running — its lease expires at ${until} UTC. Nothing was fetched; try again after it finishes.`;
    step(emit, "fetch", "skipped", "another run holds the inbox");
    emit({ type: "skipped", message: msg });
    return;
  }

  try {
    let cp: Awaited<ReturnType<typeof getEmailCheckpoint>>;
    try { cp = await getEmailCheckpoint(supabase); } catch (e) { fail(e instanceof Error ? e.message : "checkpoint unreadable"); return; }
    // An explicit start point chosen on the card reads by date from there and
    // never moves the UID checkpoint; a natural run continues from the UID.
    let since = sinceOverride ?? cp.lastSyncAt ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    let uidValidity = sinceOverride ? null : cp.uidValidity;
    let lastUid = sinceOverride ? null : cp.lastUid;
    const sinceLabel = since.toISOString().slice(0, 16).replace("T", " ");
    emit({ type: "log", msg: sinceOverride
      ? `fetching mail newer than ${sinceLabel} UTC (chosen on the card)`
      : lastUid != null ? `continuing from IMAP UID ${lastUid} (last successful sync ${sinceLabel} UTC)`
      : cp.lastSyncAt ? `fetching mail newer than ${sinceLabel} UTC (last successful sync) — the UID checkpoint starts after this pass`
      : `no prior sync — reading the last 7 days` });

    const totals: Totals = { new: 0, updated: 0, unchanged: 0, invalid: 0, errors: 0, gateBlocked: 0, queued: 0 };
    let lastBatchId: string | null = null;
    let pages = 0;
    for (let page = 1; page <= maxPages; page += 1) {
      if (page > 1 && Date.now() - t0 > budgetMs) {
        emit({ type: "log", msg: `time budget used after ${page - 1} page(s) — the rest is picked up by the next run` });
        break;
      }
      step(emit, "fetch", "running", `page ${page} · since ${since.toISOString().slice(0, 16).replace("T", " ")} UTC`);
      let fetched: Awaited<ReturnType<typeof fetchCirculars>>;
      try {
        fetched = await fetchCirculars(
          { host: cfg.imap_host, port: cfg.imap_port, user: cfg.username, folder: cfg.folder, query: cfg.search_query },
          password as string,
          { limit, since, uidValidity, lastUid, onLog: (m) => emit({ type: "log", msg: m }) },
        );
      } catch (e) {
        const msg = `IMAP: ${e instanceof Error ? e.message : "fetch failed"}`;
        step(emit, "fetch", "failed", msg);
        emit({ type: "error", error: msg });
        return; // checkpoint stays where the last staged page left it
      }
      const emails: EmailMsg[] = fetched.messages;
      step(emit, "fetch", "done", `${emails.length} email(s)${fetched.hasMore ? " · more waiting" : ""}${page > 1 ? ` · page ${page}` : ""}`);

      if (emails.length === 0) {
        if (page === 1) {
          step(emit, "classify", "skipped", "nothing to classify"); step(emit, "stage", "skipped"); step(emit, "gate", "skipped");
          emit({ type: "empty", message: `No new circulars since ${sinceLabel} UTC.` });
          // Only a natural pass moves the clock; a chosen start point that finds
          // nothing must not hide older mail on the next run. The UID epoch is
          // recorded so the next run can read by UID.
          if (!sinceOverride) await setEmailCheckpoint(supabase, owner, { uidValidity: fetched.uidValidity, lastUid: lastUid ?? (fetched.mode === "date" ? null : lastUid), lastSyncAt: startedAt });
        }
        break;
      }
      pages += 1;

      step(emit, "classify", "running", `${emails.length} email(s)`);
      let classified: Awaited<ReturnType<typeof classifyAll>>;
      try {
        classified = await classifyAll(supabase, emails, emit);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "classification failed";
        step(emit, "classify", "failed", msg);
        emit({ type: "error", error: msg });
        return; // checkpoint stays — nothing was read by the model
      }
      const { cargo, vessels, failed, firstError } = classified;
      step(emit, "classify", failed > 0 ? "failed" : "done", `${cargo.length} cargo · ${vessels.length} vessel${failed ? ` · ${failed} batch(es) failed` : ""}`);
      if (failed > 0) {
        // Part of the mail was never read by the model: keep the checkpoint
        // where it was so the next run fetches the same mail again, and say so.
        // (Records from the batches that did succeed are NOT staged either —
        // staging half a page and re-reading it would duplicate the rest.)
        emit({ type: "error", error: `${failed} classification batch${failed > 1 ? "es" : ""} failed (${firstError ?? "unknown error"}). The sync checkpoint stays at ${since.toISOString().slice(0, 16).replace("T", " ")} UTC — fix the LLM key or budget in Settings and run again; nothing was skipped.` });
        return;
      }
      if (cargo.length || vessels.length) {
        const result = await stageAndFinish(supabase, cargo, vessels, `inbox:${cfg.username}`, emit, startedBy, false);
        if (result) { lastBatchId = result.batchId; Object.assign(totals, addTotals(totals, { ...result.totals, gateBlocked: result.gate?.blocked ?? 0 })); }
      } else {
        emit({ type: "log", msg: `page ${page}: no cargo or vessel records in these ${emails.length} email(s)` });
      }

      // The page is staged: move the checkpoint through it. Throws when the
      // lease expired mid-run — rows are kept, the next run re-reads them.
      const next = checkpointAfterPage(fetched, startedAt, !!sinceOverride);
      await setEmailCheckpoint(supabase, owner, next);
      since = next.lastSyncAt;
      if (next.uidValidity != null) { uidValidity = next.uidValidity; lastUid = next.lastUid; }
      if (!fetched.hasMore) break;
      emit({ type: "log", msg: `checkpoint moved to ${next.lastUid != null ? `UID ${next.lastUid}` : `${next.lastSyncAt.toISOString().slice(0, 19).replace("T", " ")} UTC`} — reading the next page` });
    }

    if (pages > 0) {
      if (lastBatchId) emit({ type: "done", batchId: lastBatchId, totals });
      else emit({ type: "empty", message: `No cargo or vessel records were found in the ${pages} page(s) read.` });
    }
  } finally {
    await releaseSyncRun(supabase, "email", owner);
  }
}

// Dry run: classify a single pasted email (no IMAP) — lets an admin validate the
// classifier and staging without live credentials.
export async function runEmailDryRun(
  { supabase, sampleText, emit }: { supabase: SupabaseClient; sampleText: string; emit: Emit },
): Promise<void> {
  const text = sampleText.trim();
  if (!text) { emit({ type: "error", error: "Paste an email to classify." }); return; }
  emit({ type: "log", msg: "dry run — classifying pasted email" });
  step(emit, "connect", "skipped", "pasted sample"); step(emit, "fetch", "skipped");
  const email: EmailMsg = { id: "sample", from: "(pasted)", subject: "(pasted sample)", date: null, text };
  step(emit, "classify", "running", "1 sample");
  let res: Awaited<ReturnType<typeof classifyAll>>;
  try {
    res = await classifyAll(supabase, [email], emit);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "classification failed";
    step(emit, "classify", "failed", msg);
    emit({ type: "error", error: msg });
    return;
  }
  step(emit, "classify", res.failed ? "failed" : "done", `${res.cargo.length} cargo · ${res.vessels.length} vessel`);
  if (res.failed && !res.cargo.length && !res.vessels.length) { emit({ type: "error", error: res.firstError ?? "classification failed" }); return; }
  await stageAndFinish(supabase, res.cargo, res.vessels, "pasted sample", emit);
}

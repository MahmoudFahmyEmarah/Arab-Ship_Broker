// Orchestrates an email sync end-to-end and streams progress events:
//   settings → decrypt → (IMAP fetch | pasted sample) → LangGraph classify each
//   → records → ParsedSheet[] → stageBatch → a review batch.
// Reuses the exact staging/diff pipeline; the result is a normal sync_batch the
// Review UI opens like any upload.

import type { SupabaseClient } from "@supabase/supabase-js";
import { stageBatch } from "../stage";
import { EmailLlmSource } from "../email-source";
import { getWatermark, setWatermark } from "../state";
import { buildClassifierGraph } from "./graph";
import { LangChainClassifier } from "./classifier";
import { getActiveModel } from "./llm";
import { fetchCirculars } from "./imap";
import { recordsToSheets } from "./to-rows";
import type { CargoRecord, EmailMsg, SyncEvent, VesselRecord } from "./types";

type Emit = (e: SyncEvent) => void;

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
): Promise<{ cargo: CargoRecord[]; vessels: VesselRecord[] }> {
  const { model, vendor, modelName } = await getActiveModel(supabase);
  const graph = buildClassifierGraph(new LangChainClassifier(model));
  const expanded = emails.flatMap(splitLongEmail);
  const batches = batchEmails(expanded);
  const nSplit = expanded.length - emails.length;
  emit({ type: "log", msg: `classifying ${emails.length} email(s)${nSplit > 0 ? ` (+${nSplit} long-digest part(s))` : ""} with ${vendor} · ${modelName} — ${batches.length} batch(es) of up to ${MAX_BATCH_EMAILS}, ${CONCURRENCY} in parallel` });

  const cargo: CargoRecord[] = [];
  const vessels: VesselRecord[] = [];
  let doneEmails = 0;
  let doneBatches = 0;
  // Array push is safe across these awaits (single-threaded); order doesn't matter.
  await mapLimit(batches, CONCURRENCY, async (batch) => {
    try {
      const res = await withRetry(() => withTimeout(graph.invoke({ emails: batch }), BATCH_TIMEOUT_MS, "classify"), RETRIES);
      cargo.push(...res.cargo);
      vessels.push(...res.vessels);
      doneEmails += batch.length; doneBatches += 1;
      emit({ type: "log", msg: `[${doneEmails}/${expanded.length}] batch ${doneBatches}/${batches.length} → ${res.cargo.length} cargo, ${res.vessels.length} vessel` });
    } catch (e) {
      doneEmails += batch.length; doneBatches += 1;
      emit({ type: "log", msg: `[${doneEmails}/${expanded.length}] ✗ batch ${doneBatches}/${batches.length} skipped (${batch.length} email(s)) — ${e instanceof Error ? e.message : "error"}` });
    }
  });
  // Collapse duplicates from part overlaps (and identical orders circulated in
  // several emails of the same run — one listing either way).
  const uCargo = dedupBy(cargo, cargoKey);
  const uVessels = dedupBy(vessels, vesselKey);
  const dropped = cargo.length - uCargo.length + vessels.length - uVessels.length;
  if (dropped > 0) emit({ type: "log", msg: `deduplicated ${dropped} repeated extraction(s) across email parts` });
  return { cargo: uCargo, vessels: uVessels };
}

async function stageAndFinish(
  supabase: SupabaseClient,
  cargo: CargoRecord[],
  vessels: VesselRecord[],
  fileName: string,
  emit: Emit,
  startedBy: string | null = null,
) {
  const sheets = recordsToSheets(cargo, vessels);
  if (sheets.length === 0) {
    emit({ type: "empty", message: "No cargo or vessel records were found in these emails." });
    return;
  }
  emit({ type: "log", msg: `staging ${cargo.length} cargo + ${vessels.length} vessel record(s)…` });
  const source = new EmailLlmSource(sheets);
  const label = `Email sync · ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  // startedBy = the admin running the sync — credited as the poster on the
  // market cards (get_listing_posters), never the circular's sender.
  const result = await stageBatch({ supabase, source, fileName, label, startedBy });
  emit({ type: "done", batchId: result.batchId, totals: result.totals });
}

// Live IMAP sync of the configured circulation inbox.
export async function runEmailSync(
  { supabase, limit, emit, startedBy = null }: { supabase: SupabaseClient; limit?: number; emit: Emit; startedBy?: string | null },
): Promise<void> {
  emit({ type: "log", msg: "reading inbox connection…" });
  const { data: cfg, error } = await supabase
    .from("email_ingest_config")
    .select("imap_host, imap_port, username, folder, search_query, is_enabled")
    .maybeSingle();
  if (error) { emit({ type: "error", error: error.message }); return; }
  if (!cfg) { emit({ type: "error", error: "No circulation inbox configured — set it up in Settings." }); return; }
  if (!cfg.is_enabled) { emit({ type: "error", error: "The circulation inbox is disabled. Enable it in Settings." }); return; }
  if (!cfg.imap_host || !cfg.username) { emit({ type: "error", error: "Inbox host/username missing in Settings." }); return; }

  const { data: password, error: pErr } = await supabase.rpc("get_email_password");
  if (pErr) { emit({ type: "error", error: pErr.message }); return; }
  if (!password) { emit({ type: "error", error: "No inbox password stored. Add it in Settings." }); return; }

  // Incremental: only mail newer than the watermark. Capture the start time up
  // front so mail that arrives during processing is picked up next run, not lost.
  const startedAt = new Date();
  const watermark = await getWatermark(supabase, "email");
  const since = watermark ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  emit({ type: "log", msg: `fetching mail newer than ${since.toISOString().slice(0, 16).replace("T", " ")} UTC${watermark ? "" : " (no prior sync — last 7 days)"}` });

  let emails: EmailMsg[];
  try {
    emails = await fetchCirculars(
      { host: cfg.imap_host, port: cfg.imap_port, user: cfg.username, folder: cfg.folder, query: cfg.search_query },
      password as string,
      { limit, since, onLog: (m) => emit({ type: "log", msg: m }) },
    );
  } catch (e) {
    emit({ type: "error", error: `IMAP: ${e instanceof Error ? e.message : "fetch failed"}` });
    return; // don't advance the watermark on a fetch failure
  }

  if (emails.length === 0) {
    emit({ type: "empty", message: `No new circulars since ${since.toISOString().slice(0, 16).replace("T", " ")} UTC.` });
    await setWatermark(supabase, "email", startedAt);
    return;
  }

  const { cargo, vessels } = await classifyAll(supabase, emails, emit);
  await stageAndFinish(supabase, cargo, vessels, `inbox:${cfg.username}`, emit, startedBy);
  // Advance the watermark only after a successful pass (staging throws → we skip this).
  await setWatermark(supabase, "email", startedAt);
}

// Dry run: classify a single pasted email (no IMAP) — lets an admin validate the
// classifier and staging without live credentials.
export async function runEmailDryRun(
  { supabase, sampleText, emit }: { supabase: SupabaseClient; sampleText: string; emit: Emit },
): Promise<void> {
  const text = sampleText.trim();
  if (!text) { emit({ type: "error", error: "Paste an email to classify." }); return; }
  emit({ type: "log", msg: "dry run — classifying pasted email" });
  const email: EmailMsg = { id: "sample", from: "(pasted)", subject: "(pasted sample)", date: null, text };
  const { cargo, vessels } = await classifyAll(supabase, [email], emit);
  await stageAndFinish(supabase, cargo, vessels, "pasted sample", emit);
}

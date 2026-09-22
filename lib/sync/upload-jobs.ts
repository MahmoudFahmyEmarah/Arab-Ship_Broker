// Background staging of large workbooks (P1-3, 20 Sep 2026; token leases,
// one-batch guarantee, real retries and private Storage added 21 Sep 2026).
//
// The upload route queues a workbook it will not parse; /api/cron/upload-jobs
// claims one job at a time and stages it with the full function budget.
//
// What one pass does, and why each step is where it is:
//
//   1. claim   claim_sync_upload_job mints a LEASE TOKEN and, on the first
//              attempt, RESERVES the batch — both inside the claiming
//              transaction. The token is this worker's proof of ownership for
//              the rest of the pass; the batch id is the same for every
//              attempt of this job, which is what makes "one job, one batch"
//              true even if this process dies mid-way.
//   2. load    the workbook comes from the private Storage object named on
//              the job, and its size and SHA-256 are verified before SheetJS
//              sees it. A job with inline bytes (a small workbook, or a
//              database without the storage schema) uses those instead.
//   3. stage   stageBatch resumes INTO the reserved batch: it asks the
//              database whether that batch may still be rebuilt, clears the
//              previous attempt's uncommitted rows, and re-stages. A batch an
//              administrator has committed or edited is refused, and the job
//              parks permanently rather than touching their work.
//   4. finish  finish_sync_upload_job requires the exact lease token. Its
//              `{ error }` AND its returned boolean are both inspected: a
//              false result means this worker LOST OWNERSHIP while it was
//              working, so nothing it did may be reported as success — no
//              audit line, no `done` count. A transient failure returns the
//              job to retry_wait with back-off; a permanent one parks it.
//
// Nothing here writes a success audit before the database has confirmed the
// finalisation, which is the difference between "we finished" and "we think
// we finished".
import type { SupabaseClient } from "@supabase/supabase-js";
import { XlsxSource } from "./xlsx-source";
import { stageBatch } from "./stage";
import { logAudit } from "@/lib/admin/data-sync-audit";
import { randomUUID } from "node:crypto";
import { SIGNED_UPLOAD_TTL_SECONDS, SYNC_UPLOAD_BUCKET, mintUploadObjectPath, payloadProblem, pathMatchesJob, sha256Hex } from "./upload-target";

export type UploadJobStatus = "queued" | "running" | "retry_wait" | "done" | "failed" | "cancelled";
export type UploadFailureKind = "transient" | "permanent" | "timeout" | "lost_lease";

export interface UploadJobRow {
  id: string;
  file_name: string;
  bytes: string | Buffer | null;
  size: number;
  payload_bytes: number | null;
  rows_parsed: number | null;
  started_by: string | null;
  status: UploadJobStatus;
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  lease_until: string | null;
  next_attempt_at: string;
  batch_id: string | null;
  failure_kind: UploadFailureKind | null;
  error: string | null;
  totals: Record<string, number> | null;
  storage_bucket: string | null;
  storage_path: string | null;
  checksum_sha256: string | null;
  payload_expires_at: string | null;
  payload_deleted_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface UploadJobsSummary {
  claimed: number;
  done: number;
  failed: number;
  retrying: number;
  lost: number;
  results: { id: string; file: string; ok: boolean; batchId?: string; status?: string; error?: string; failureKind?: UploadFailureKind }[];
}

/** PostgREST returns bytea as a hex string ("\\x…"); accept a Buffer too. */
export function jobBytes(raw: string | Buffer | null): Buffer {
  if (raw == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(raw)) return raw;
  if (raw.startsWith("\\x")) return Buffer.from(raw.slice(2), "hex");
  return Buffer.from(raw, "base64");
}

// ── queueing a workbook (the upload route's side) ──────────────────────────

export interface QueuedUpload {
  jobId: string;
  /** where the workbook actually went */
  mode: "storage" | "inline";
  bucket?: string;
  path?: string;
  checksum: string;
  sizeBytes: number;
  /** why the storage path was not used, when it was not — recorded in the audit */
  storageError?: string;
}

/**
 * Create the job row for a workbook whose bytes we already hold. Preferred
 * path: put the file in the private bucket and store only metadata, so a
 * 10 MB workbook is a 10 MB binary upload rather than a 20 MB hex insert
 * through PostgREST. A database without the storage schema, or a bucket that
 * refuses the object, falls back to inline bytes so the feature still works.
 *
 * NOTHING IS PARSED HERE (D11): the queue decision is made on size and the
 * expensive SheetJS read happens in the worker.
 */
export async function enqueueUploadJob(
  sb: SupabaseClient,
  job: { fileName: string; bytes: Buffer; startedBy: string | null; rowsParsed?: number | null },
): Promise<QueuedUpload> {
  const jobId = randomUUID();
  const checksum = sha256Hex(job.bytes);
  const sizeBytes = job.bytes.length;
  const path = mintUploadObjectPath({ jobId, adminId: job.startedBy });

  let mode: "storage" | "inline" = "inline";
  let storageError: string | null = null;
  try {
    const { error } = await sb.storage.from(SYNC_UPLOAD_BUCKET).upload(path, job.bytes, {
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
    if (error) storageError = error.message; else mode = "storage";
  } catch (e) {
    storageError = e instanceof Error ? e.message : String(e);
  }

  const row: Record<string, unknown> = {
    id: jobId, file_name: job.fileName, size: sizeBytes, payload_bytes: sizeBytes,
    checksum_sha256: checksum, started_by: job.startedBy, rows_parsed: job.rowsParsed ?? null,
  };
  if (mode === "storage") { row.storage_bucket = SYNC_UPLOAD_BUCKET; row.storage_path = path; row.bytes = null; }
  else row.bytes = "\\x" + job.bytes.toString("hex");

  const { error } = await sb.from("sync_upload_job").insert(row);
  if (error) {
    if (mode === "storage") await sb.storage.from(SYNC_UPLOAD_BUCKET).remove([path]).catch(() => undefined);
    throw new Error(`could not queue the workbook: ${error.message}`);
  }
  return {
    jobId, mode, checksum, sizeBytes,
    ...(mode === "storage" ? { bucket: SYNC_UPLOAD_BUCKET, path } : {}),
    // a database without the storage schema, or a bucket that refused the
    // object, falls back to inline bytes — say why rather than hiding it
    ...(storageError ? { storageError } : {}),
  };
}

/**
 * The browser-upload flow, for a workbook that may be larger than the
 * serverless request body limit. The job row is created FIRST, with its
 * storage path but no checksum, which makes it deliberately unclaimable: the
 * worker skips a storage-backed job until finaliseSignedUpload records what
 * actually arrived, and expire_sync_upload_payloads parks it if nothing does.
 */
export async function createSignedUploadTarget(
  sb: SupabaseClient,
  input: { fileName: string; sizeBytes: number; startedBy: string | null },
): Promise<{ jobId: string; bucket: string; path: string; token: string; expiresInSeconds: number }> {
  const jobId = randomUUID();
  const path = mintUploadObjectPath({ jobId, adminId: input.startedBy });
  const { data, error } = await sb.storage.from(SYNC_UPLOAD_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(`could not issue an upload target: ${error?.message ?? "no signed URL returned"}`);
  const { error: iErr } = await sb.from("sync_upload_job").insert({
    id: jobId, file_name: input.fileName, size: input.sizeBytes, started_by: input.startedBy,
    storage_bucket: SYNC_UPLOAD_BUCKET, storage_path: path, bytes: null, checksum_sha256: null,
  });
  if (iErr) {
    await sb.storage.from(SYNC_UPLOAD_BUCKET).remove([path]).catch(() => undefined);
    throw new Error(`could not queue the workbook: ${iErr.message}`);
  }
  return { jobId, bucket: SYNC_UPLOAD_BUCKET, path, token: data.token, expiresInSeconds: SIGNED_UPLOAD_TTL_SECONDS };
}

/**
 * The browser says its upload finished. The object is verified against what
 * the job expects before the job becomes claimable, and the path is never
 * taken from the client — it is read back from the job row.
 */
export async function finaliseSignedUpload(
  sb: SupabaseClient,
  input: { jobId: string; sizeBytes: number; checksum: string },
): Promise<{ ok: true; sizeBytes: number } | { ok: false; error: string }> {
  const { data, error } = await sb.from("sync_upload_job")
    .select("id, started_by, storage_bucket, storage_path, checksum_sha256, status")
    .eq("id", input.jobId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  const job = data as { id: string; started_by: string | null; storage_bucket: string | null; storage_path: string | null; checksum_sha256: string | null; status: string } | null;
  if (!job) return { ok: false, error: "no such upload job" };
  if (job.checksum_sha256) return { ok: false, error: "this upload was already finalised" };
  if (job.status !== "queued") return { ok: false, error: `the job is ${job.status}` };
  if (!job.storage_path) return { ok: false, error: "the job has no storage object" };
  const why = pathMatchesJob(job.storage_path, { id: job.id, started_by: job.started_by });
  if (why) return { ok: false, error: `the job's object path is not usable: ${why}` };
  if (!/^[0-9a-f]{64}$/i.test(input.checksum)) return { ok: false, error: "a SHA-256 checksum is required" };

  // verify the object really is there and really is what was declared
  const { data: blob, error: dErr } = await sb.storage.from(job.storage_bucket || SYNC_UPLOAD_BUCKET).download(job.storage_path);
  if (dErr || !blob) return { ok: false, error: `the uploaded workbook could not be read back: ${dErr?.message ?? "no body"}` };
  const buf = Buffer.from(await blob.arrayBuffer());
  const bad = payloadProblem(buf, { size: input.sizeBytes, checksum: input.checksum });
  if (bad) return { ok: false, error: bad };

  const { error: uErr } = await sb.from("sync_upload_job")
    .update({ checksum_sha256: input.checksum.toLowerCase(), payload_bytes: buf.length, size: buf.length, next_attempt_at: new Date().toISOString() })
    .eq("id", input.jobId).is("checksum_sha256", null);
  if (uErr) return { ok: false, error: uErr.message };
  return { ok: true, sizeBytes: buf.length };
}

/**
 * Is this failure worth another attempt? (workstream C)
 *
 * Permanent — the workbook or the batch will never be acceptable, so a retry
 * would waste the remaining attempts and delay the operator's answer: a
 * malformed or refused archive, a workbook over a limit, a payload that does
 * not match its checksum, a batch an administrator has already worked on.
 *
 * Timeout — the worker ran out of budget. Worth retrying (the next pass gets a
 * fresh budget) and worth distinguishing, because it points at a workbook
 * that is too big rather than at a broken one.
 *
 * Transient — everything else: a dropped connection, a lock timeout, a 5xx
 * from PostgREST, a deadlock. These are exactly what attempts exist for.
 */
export function classifyStagingFailure(message: string): Exclude<UploadFailureKind, "lost_lease"> {
  const m = (message || "").toLowerCase();
  if (/exceeded its \d+ s budget|statement timeout|canceling statement|query_canceled|etimedout|timed out/.test(m)) return "timeout";
  if (
    /batch_not_resumable/.test(m) ||
    /not a workbook|zip64|macro-enabled|password-protected|unsupported compression|corrupt central directory/.test(m) ||
    /walks out of the archive|lists ".*" twice|lists .* twice|control character|absolute path|drive letter/.test(m) ||
    /could not read the workbook|has no sheets|has no entries|is truncated|is inconsistent/.test(m) ||
    /more than the|expands \d+|looks like a compression bomb|split it and upload/.test(m) ||
    /checksum|the stored workbook is empty|declared checksum|over the \d+-byte cap/.test(m) ||
    /object path|no workbook payload|storage object is missing/.test(m) ||
    /is not permitted|is not editable|key column mismatch/.test(m)
  ) return "permanent";
  return "transient";
}

/** Read the workbook for a claimed job: a private Storage object, or inline bytes. */
export async function loadJobWorkbook(sb: SupabaseClient, job: UploadJobRow): Promise<Buffer> {
  if (job.storage_path) {
    const bucket = job.storage_bucket || SYNC_UPLOAD_BUCKET;
    // never download a path we did not mint for this job
    const why = pathMatchesJob(job.storage_path, { id: job.id, started_by: job.started_by });
    if (why) throw new Error(`refusing the stored workbook: ${why}`);
    const { data, error } = await sb.storage.from(bucket).download(job.storage_path);
    if (error || !data) throw new Error(`storage object is missing or unreadable (${bucket}/${job.storage_path}): ${error?.message ?? "no body"}`);
    const buf = Buffer.from(await data.arrayBuffer());
    const bad = payloadProblem(buf, { size: job.payload_bytes ?? job.size, checksum: job.checksum_sha256 });
    if (bad) throw new Error(bad);
    return buf;
  }
  const buf = jobBytes(job.bytes);
  const bad = payloadProblem(buf, { size: null, checksum: job.checksum_sha256 });
  if (bad) throw new Error(bad);
  return buf;
}

interface FinishOutcome { ok: boolean; reason?: string; status?: string; attempts?: number; batch_id?: string | null; failure_kind?: string | null; next_attempt_at?: string | null; detail?: string }

/**
 * Record the outcome of one claim and RETURN WHAT THE DATABASE SAID. Both the
 * transport error and the function's own boolean are inspected: either one
 * means this worker must not claim success.
 */
export async function finishJob(
  sb: SupabaseClient,
  job: UploadJobRow,
  args: { ok: boolean; batchId?: string | null; error?: string | null; totals?: Record<string, number> | null; failureKind?: UploadFailureKind | null; rowsParsed?: number | null },
): Promise<FinishOutcome> {
  const { data, error } = await sb.rpc("finish_sync_upload_job", {
    p_id: job.id,
    p_lease_token: job.lease_token,
    p_ok: args.ok,
    p_batch_id: args.batchId ?? null,
    p_error: args.error ?? null,
    p_totals: args.totals ?? null,
    p_failure_kind: args.failureKind ?? null,
    p_rows_parsed: args.rowsParsed ?? null,
  });
  if (error) return { ok: false, reason: "rpc_error", detail: error.message };
  const out = (data ?? {}) as FinishOutcome;
  if (out.ok !== true) return { ...out, ok: false, reason: out.reason ?? "refused" };
  return out;
}

/** The cron's side: claim and stage jobs until the budget is spent. */
export async function processUploadJobs(
  sb: SupabaseClient,
  opts: { budgetMs: number; perJobMs?: number; onLog?: (m: string) => void } = { budgetMs: 280_000 },
): Promise<UploadJobsSummary> {
  const t0 = Date.now();
  const log = opts.onLog ?? (() => {});
  const out: UploadJobsSummary = { claimed: 0, done: 0, failed: 0, retrying: 0, lost: 0, results: [] };

  while (Date.now() - t0 < opts.budgetMs * 0.5) {
    const remaining = opts.budgetMs - (Date.now() - t0);
    const { data, error } = await sb.rpc("claim_sync_upload_job", { p_ttl_seconds: Math.ceil(remaining / 1000) + 60 });
    if (error) throw new Error(`claiming an upload job: ${error.message}`);
    const job = ((data ?? []) as UploadJobRow[])[0];
    if (!job) break;
    out.claimed += 1;
    if (!job.lease_token) {
      // the claim must return an owner; without one nothing can be finalised
      log(`claimed ${job.file_name} without a lease token — refusing to stage it`);
      out.lost += 1;
      out.results.push({ id: job.id, file: job.file_name, ok: false, error: "the claim returned no lease token" });
      break;
    }
    log(`staging ${job.file_name} (${job.size} bytes, attempt ${job.attempts} of ${job.max_attempts}, batch ${job.batch_id ?? "?"})`);

    let stageResult: Awaited<ReturnType<typeof stageBatch>> | null = null;
    let failure: { message: string; kind: UploadFailureKind } | null = null;
    try {
      const buffer = await loadJobWorkbook(sb, job);
      const source = new XlsxSource(buffer);
      stageResult = await stageBatch({
        supabase: sb,
        source,
        fileName: job.file_name,
        startedBy: job.started_by,
        label: `UP-${new Date().toISOString().slice(0, 10)}`,
        budgetMs: Math.max(5_000, Math.min(opts.perJobMs ?? remaining - 10_000, remaining - 10_000)),
        reuseBatchId: job.batch_id,          // B: the batch the claim reserved
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failure = { message: msg, kind: classifyStagingFailure(msg) };
    }

    if (failure) {
      const settled = await finishJob(sb, job, { ok: false, error: failure.message, failureKind: failure.kind });
      if (!settled.ok) {
        // we could not even record the failure: another worker owns the job
        // now, or the database refused us. Say so; do not guess.
        log(`could not record the failure of ${job.file_name}: ${settled.reason}${settled.detail ? ` (${settled.detail})` : ""}`);
        out.lost += 1;
        out.results.push({ id: job.id, file: job.file_name, ok: false, error: `${failure.message} · finalisation refused: ${settled.reason}`, failureKind: failure.kind });
        continue;
      }
      if (settled.status === "retry_wait") out.retrying += 1; else out.failed += 1;
      await logAudit(sb, {
        actor: { id: null, name: "Upload job", kind: "system" }, action: "run.upload", targetKind: "upload_job", targetId: job.id,
        batchId: job.batch_id,
        summary: settled.status === "retry_wait"
          ? `Background upload of ${job.file_name} failed (${failure.kind}) — attempt ${settled.attempts} of ${job.max_attempts}, retrying`
          : `Background upload of ${job.file_name} parked after ${settled.attempts} attempt(s) — ${failure.message}`,
        ok: false,
        detail: { file: job.file_name, job: job.id, error: failure.message, failure_kind: failure.kind, status: settled.status, next_attempt_at: settled.next_attempt_at ?? null },
      });
      out.results.push({ id: job.id, file: job.file_name, ok: false, status: settled.status, error: failure.message, failureKind: failure.kind });
      continue;
    }

    // staging succeeded — but success is only real once the database confirms
    // that THIS worker still owned the job when it finished.
    const result = stageResult!;
    const rowsParsed = Object.values(result.totals ?? {}).reduce((a, n) => a + (typeof n === "number" ? n : 0), 0);
    const settled = await finishJob(sb, job, { ok: true, batchId: result.batchId, totals: result.totals as unknown as Record<string, number>, rowsParsed });
    if (!settled.ok) {
      // LOST OWNERSHIP. The rows are in the reserved batch, which the worker
      // that reclaimed the job will rebuild; nothing is counted as done and
      // no success audit is written.
      log(`finalisation of ${job.file_name} was refused (${settled.reason}) — not reporting success`);
      out.lost += 1;
      await logAudit(sb, {
        actor: { id: null, name: "Upload job", kind: "system" }, action: "run.upload", targetKind: "upload_job", targetId: job.id, batchId: result.batchId,
        summary: `Background upload of ${job.file_name} finished staging but lost its lease — the owning worker will redo it`,
        ok: false,
        detail: { file: job.file_name, job: job.id, reason: settled.reason, detail: settled.detail ?? null, batch: result.batchId },
      });
      out.results.push({ id: job.id, file: job.file_name, ok: false, status: settled.status, error: `finalisation refused: ${settled.reason}`, failureKind: "lost_lease" });
      continue;
    }

    out.done += 1;
    await logAudit(sb, {
      actor: { id: null, name: "Upload job", kind: "system" }, action: "run.upload", targetKind: "batch", targetId: result.batchId, batchId: result.batchId,
      summary: `Background upload of ${job.file_name} — ${result.totals.new} new · ${result.totals.updated} updated · ${result.totals.invalid} blocked`,
      detail: { file: job.file_name, bytes: job.size, totals: result.totals, gate: result.gate ?? null, job: job.id, attempts: settled.attempts },
    });
    out.results.push({ id: job.id, file: job.file_name, ok: true, batchId: result.batchId, status: settled.status });
  }
  return out;
}

/**
 * Retention (D8–D10): park uploads whose workbook never arrived, and delete
 * storage objects past their window. The database decides what is expired;
 * this removes the objects and confirms.
 */
export async function sweepUploadPayloads(sb: SupabaseClient, opts: { abandonedHours?: number; limit?: number } = {}): Promise<{ deleted: number; parked: number; errors: string[] }> {
  const errors: string[] = [];
  const { data, error } = await sb.rpc("expire_sync_upload_payloads", {
    p_abandoned_hours: opts.abandonedHours ?? 24,
    p_limit: opts.limit ?? 50,
  });
  if (error) throw new Error(`expiring upload payloads: ${error.message}`);
  const rows = (data ?? []) as { id: string; storage_bucket: string | null; storage_path: string | null; why: string }[];
  const parked = rows.filter((r) => r.why === "abandoned upload").length;
  const removable = rows.filter((r) => !!r.storage_path);
  const confirmed: string[] = [];
  for (const r of removable) {
    const bucket = r.storage_bucket || SYNC_UPLOAD_BUCKET;
    const { error: dErr } = await sb.storage.from(bucket).remove([r.storage_path as string]);
    if (dErr) { errors.push(`${bucket}/${r.storage_path}: ${dErr.message}`); continue; }
    confirmed.push(r.id);
  }
  // only the objects that are really gone are marked gone
  const withoutObject = rows.filter((r) => !r.storage_path).map((r) => r.id);
  const ids = [...confirmed, ...withoutObject];
  if (ids.length) {
    const { error: mErr } = await sb.rpc("mark_sync_upload_payload_deleted", { p_ids: ids });
    if (mErr) errors.push(`marking payloads deleted: ${mErr.message}`);
  }
  return { deleted: confirmed.length, parked, errors };
}

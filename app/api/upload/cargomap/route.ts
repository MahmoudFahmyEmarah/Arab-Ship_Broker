// POST /api/upload/cargomap — accept the CargoMap workbook, parse + diff it into
// a review batch (nothing is written to live tables here). Returns the batch id
// and per-sheet staged counts; the admin reviews and commits separately.
//
// Runs on the Node.js runtime so SheetJS and the service-role client work.
//
// P1-3 (20 Sep 2026): the archive is inspected before it is parsed
// (lib/sync/xlsx-guard.ts — parts, expansion, macros, external links, an
// exactly-consumed central directory), the real byte count is checked after
// reading (never only Content-Length), the whole workbook is bounded by the
// grid it actually produces, and staging runs under an explicit budget.
//
// 21 Sep 2026 (workstream D): the QUEUE DECISION IS MADE ON SIZE, BEFORE
// ANYTHING IS PARSED. It used to parse the workbook first and then look at
// the row count, so a 60,000-row file was fully read by SheetJS inside the
// interactive request and then parsed a second time by the worker. A file
// over SYNC_INLINE_MAX_BYTES now goes straight to the queue — into the
// private Storage bucket where possible — and is parsed once, in the worker.
// A workbook that may exceed the serverless body limit never reaches this
// route at all: the browser asks /api/upload/cargomap/target for a signed
// upload target and calls /finalize when it has finished.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { XlsxSource, stageBatch } from "@/lib/sync";
import { SYNC_INLINE_MAX_BYTES } from "@/lib/sync/xlsx-source";
import { enqueueUploadJob } from "@/lib/sync/upload-jobs";
import type { ParsedSheet } from "@/lib/sync/types";
import { setWatermark } from "@/lib/sync/state";
import { logAudit, requestContext } from "@/lib/admin/data-sync-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
/** Staging budget inside this request; the route's own limit is 300 s. */
const STAGE_BUDGET_MS = 240_000;

export async function POST(req: Request) {
  // Owner-only, edit seat: the same gate every Data Sync server action uses. A
  // view-only sub-admin (or a member) gets JSON, not a redirect — this is an
  // API route the upload card calls with fetch().
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin({ section: "datasync", edit: true });
  } catch {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  // the declared size first (cheap); the bytes actually read are checked below
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "Workbook is larger than 10 MB." }, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart upload with a 'file' field." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No workbook received. Attach the CargoMap .xlsx as 'file'." }, { status: 400 });
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json({ error: "Unsupported file — upload the unified CargoMap .xlsx workbook (.xlsm and other formats are not accepted)." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "Workbook is larger than 10 MB." }, { status: 413 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json({ error: "Workbook is larger than 10 MB." }, { status: 413 });
  }

  // Best-effort attribution (no FK on started_by, so an auth uid is safe).
  let startedBy: string | null = null;
  try {
    const server = await getSupabaseServerClient();
    const { data } = await server.auth.getUser();
    startedBy = data.user?.id ?? null;
  } catch {
    /* attribution is non-critical */
  }

  const supabase = getSupabaseAdminClient();
  const ctx = requestContext(req.headers);
  try {
    // D11: the decision is made on BYTES, so nothing large is parsed here.
    if (buffer.length > SYNC_INLINE_MAX_BYTES) {
      const queued = await enqueueUploadJob(supabase, { fileName: file.name, bytes: buffer, startedBy });
      const kb = Math.round(buffer.length / 1024);
      await logAudit(supabase, {
        actor: { id: admin.rowId, name: admin.fullName }, ctx, action: "run.upload", targetKind: "upload_job", targetId: queued.jobId,
        summary: `Queued ${file.name} for background staging — ${kb} KB, held in ${queued.mode === "storage" ? "private storage" : "the job row"}`,
        detail: { file: file.name, bytes: buffer.length, job: queued.jobId, mode: queued.mode, checksum: queued.checksum, path: queued.path ?? null, storage_error: queued.storageError ?? null },
      });
      return NextResponse.json({
        ok: true, queued: true, jobId: queued.jobId, bytes: buffer.length, mode: queued.mode,
        message: `${kb} KB — larger than the ${Math.round(SYNC_INLINE_MAX_BYTES / 1024)} KB we parse inside the request, so the workbook is queued and staged in the background within a few minutes. It appears under Intake as a batch when done, and under Uploads while it is waiting.`,
      }, { status: 202 });
    }

    // small enough to do now: parse once (archive guard + per-sheet + whole-workbook limits inside)
    const source = new XlsxSource(buffer);
    const sheets = await source.parse();
    const rows = sheets.reduce((a, s) => a + s.rows.length, 0);

    const parsed: { kind: "upload"; parse: () => Promise<ParsedSheet[]> } = { kind: "upload", parse: async () => sheets };
    const result = await stageBatch({
      supabase,
      source: parsed,
      fileName: file.name,
      startedBy,
      label: `UP-${new Date().toISOString().slice(0, 10)}`,
      budgetMs: STAGE_BUDGET_MS,
    });

    // Record when the last workbook was processed (stored for visibility; the
    // upload still processes the whole file in batches — the watermark is not
    // used to limit rows).
    try { await setWatermark(supabase, "upload", new Date()); } catch { /* non-critical */ }
    await logAudit(supabase, {
      actor: { id: admin.rowId, name: admin.fullName }, ctx, action: "run.upload", targetKind: "batch", targetId: result.batchId, batchId: result.batchId,
      summary: `Uploaded ${file.name} — ${result.totals.new} new · ${result.totals.updated} updated · ${result.totals.invalid} blocked`,
      detail: { file: file.name, bytes: buffer.length, rows, totals: result.totals, gate: result.gate ?? null },
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse the workbook.";
    await logAudit(supabase, { actor: { id: admin.rowId, name: admin.fullName }, ctx, action: "run.upload", targetKind: "batch", summary: `Workbook upload failed — ${message}`, ok: false, detail: { file: file.name, bytes: buffer.length, error: message } });
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

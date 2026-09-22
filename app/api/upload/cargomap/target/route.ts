// POST /api/upload/cargomap/target — hand the browser a short-lived signed
// upload target for a workbook that may be larger than the serverless request
// body limit (workstream D, 21 Sep 2026).
//
// The administrator is authorised FIRST. The object path is minted on the
// server, is unpredictable, and is bound to this job id and this
// administrator; the client never nominates a path and never learns another
// job's path. The job row is created with that path but no checksum, which
// makes it deliberately unclaimable until /finalize records what arrived.
//
//   POST /api/upload/cargomap/target   { fileName, sizeBytes }
//     → { jobId, bucket, path, token, expiresInSeconds }
//
// The browser then uploads with the Supabase client's uploadToSignedUrl and
// calls /api/upload/cargomap/finalize with the size and SHA-256 it sent.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSignedUploadTarget } from "@/lib/sync/upload-jobs";
import { SYNC_UPLOAD_MAX_BYTES } from "@/lib/sync/upload-target";
import { logAudit, requestContext } from "@/lib/admin/data-sync-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin({ section: "datasync", edit: true });
  } catch {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  let body: { fileName?: unknown; sizeBytes?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "Expected JSON with fileName and sizeBytes." }, { status: 400 }); }

  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const sizeBytes = Number(body.sizeBytes);
  if (!fileName || !/\.xlsx$/i.test(fileName)) {
    return NextResponse.json({ error: "Upload the unified CargoMap .xlsx workbook (.xlsm and other formats are not accepted)." }, { status: 415 });
  }
  if (fileName.length > 200 || /[/\\]/.test(fileName)) {
    return NextResponse.json({ error: "That file name is not acceptable." }, { status: 400 });
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "sizeBytes must be the workbook's size in bytes." }, { status: 400 });
  }
  if (sizeBytes > SYNC_UPLOAD_MAX_BYTES) {
    return NextResponse.json({ error: `Workbook is larger than ${Math.round(SYNC_UPLOAD_MAX_BYTES / 1024 / 1024)} MB.` }, { status: 413 });
  }

  const supabase = getSupabaseAdminClient();
  try {
    const target = await createSignedUploadTarget(supabase, { fileName, sizeBytes, startedBy: admin.rowId ?? null });
    await logAudit(supabase, {
      actor: { id: admin.rowId, name: admin.fullName }, ctx: requestContext(req.headers),
      action: "run.upload", targetKind: "upload_job", targetId: target.jobId,
      summary: `Issued an upload target for ${fileName} (${sizeBytes} bytes)`,
      detail: { file: fileName, bytes: sizeBytes, job: target.jobId, bucket: target.bucket },
    });
    // the token is what the browser needs; the path is returned for display only
    return NextResponse.json({ ok: true, ...target });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not issue an upload target.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

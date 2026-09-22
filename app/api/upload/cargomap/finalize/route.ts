// POST /api/upload/cargomap/finalize — the browser finished uploading to the
// signed target; verify what actually arrived and make the job claimable
// (workstream D, 21 Sep 2026).
//
//   POST { jobId, sizeBytes, checksumSha256 }  → { ok, queued: true, sizeBytes }
//
// The object path is NOT taken from the request: it is read back from the job
// row and re-validated against the job id and the administrator it was minted
// for. The object is downloaded once and checked against the declared size and
// digest, so a truncated or swapped upload is refused before it can ever reach
// SheetJS. Only then does the job get a checksum, which is what makes it
// claimable by the worker.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { finaliseSignedUpload } from "@/lib/sync/upload-jobs";
import { logAudit, requestContext } from "@/lib/admin/data-sync-audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  try {
    admin = await requireAdmin({ section: "datasync", edit: true });
  } catch {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  let body: { jobId?: unknown; sizeBytes?: unknown; checksumSha256?: unknown };
  try { body = (await req.json()) as typeof body; } catch { return NextResponse.json({ error: "Expected JSON with jobId, sizeBytes and checksumSha256." }, { status: 400 }); }

  const jobId = typeof body.jobId === "string" ? body.jobId : "";
  const checksum = typeof body.checksumSha256 === "string" ? body.checksumSha256 : "";
  const sizeBytes = Number(body.sizeBytes);
  if (!UUID.test(jobId)) return NextResponse.json({ error: "jobId must be the id returned by /target." }, { status: 400 });
  if (!/^[0-9a-f]{64}$/i.test(checksum)) return NextResponse.json({ error: "checksumSha256 must be a SHA-256 digest of the file you uploaded." }, { status: 400 });
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return NextResponse.json({ error: "sizeBytes must be the number of bytes uploaded." }, { status: 400 });

  const supabase = getSupabaseAdminClient();
  const res = await finaliseSignedUpload(supabase, { jobId, sizeBytes, checksum });
  const ctx = requestContext(req.headers);
  if (!res.ok) {
    await logAudit(supabase, {
      actor: { id: admin.rowId, name: admin.fullName }, ctx, action: "run.upload", targetKind: "upload_job", targetId: jobId,
      summary: `Upload of job ${jobId} could not be finalised — ${res.error}`, ok: false, detail: { job: jobId, error: res.error, declared_bytes: sizeBytes },
    });
    return NextResponse.json({ error: res.error }, { status: 422 });
  }
  await logAudit(supabase, {
    actor: { id: admin.rowId, name: admin.fullName }, ctx, action: "run.upload", targetKind: "upload_job", targetId: jobId,
    summary: `Workbook uploaded and queued for background staging (${res.sizeBytes} bytes)`,
    detail: { job: jobId, bytes: res.sizeBytes, checksum },
  });
  return NextResponse.json({
    ok: true, queued: true, jobId, sizeBytes: res.sizeBytes,
    message: "The workbook is queued and will be staged in the background within a few minutes. It appears under Intake as a batch when done.",
  });
}

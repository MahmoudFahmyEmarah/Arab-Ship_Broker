// POST /api/upload/cargomap — accept the CargoMap workbook, parse + diff it into
// a review batch (nothing is written to live tables here). Returns the batch id
// and per-sheet staged counts; the admin reviews and commits separately.
//
// Runs on the Node.js runtime so SheetJS and the service-role client work.

import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { XlsxSource, stageBatch } from "@/lib/sync";
import { setWatermark } from "@/lib/sync/state";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

export async function POST(req: Request) {
  // Admin gate (redirects non-admins). Section-level perms arrive with the UI in Phase 3.
  await requireAdmin();

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
    return NextResponse.json({ error: "Unsupported file — upload the unified CargoMap .xlsx workbook." }, { status: 415 });
  }
  if (file.size > MAX_BYTES) {
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

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const supabase = getSupabaseAdminClient();
    const result = await stageBatch({
      supabase,
      source: new XlsxSource(buffer),
      fileName: file.name,
      startedBy,
      label: `UP-${new Date().toISOString().slice(0, 10)}`,
    });

    // Record when the last workbook was processed (stored for visibility; the
    // upload still processes the whole file in batches — the watermark is not
    // used to limit rows).
    try { await setWatermark(supabase, "upload", new Date()); } catch { /* non-critical */ }

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to parse the workbook.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}

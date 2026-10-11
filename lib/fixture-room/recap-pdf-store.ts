// Fixture Room · storing and serving the recap PDF (O2ALL-005/006; C2O-101 corrections, 9 Oct 2026). SERVER ONLY.
//
// The one place the Fixture Room touches the service role, and only for the recap PDF: the private fixture-recaps
// bucket has no member policy by design (20261008051000). Authority always comes first from the member's own
// session — the publish command they ran, or get_fixture_recap_pdf (which checks room access and logs admin reads).
//
// The order is what makes the record truthful (C2O-101 P1-1/P1-2):
//   render (deterministic) → BIND version → path/digest/renderer (set-once) → upload without overwrite → read the
//   object back and compare length and SHA-256 → FINALIZE stored; any failure finalizes "failed" with the reason.
// A recap whose file is pending or failed says so; a download retries the SAME bound artifact (same renderer, same
// bytes) and never re-binds a version to different bytes.
import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { RECAP_PDF_RENDERER, recapPdfPath, renderRecapPdf, type RecapPdfSource } from "./recap-pdf";

export const RECAP_BUCKET = "fixture-recaps";
export const RECAP_URL_SECONDS = 60;

export interface StoredRecapPdf { recapVersionId: string; path: string; sha256: string; bytes: number }
export class RecapPdfError extends Error {}

/** A Storage "already exists" answer, and nothing else (C2O-101 P1-2: a missing bucket is not a conflict). */
export function isStorageConflict(error: unknown): boolean {
  const e = error as { statusCode?: string | number; status?: string | number } | null;
  return String(e?.statusCode ?? e?.status ?? "") === "409";
}

async function objectMatches(admin: SupabaseClient, path: string, sha256: string, bytes: number): Promise<boolean> {
  const d = await admin.storage.from(RECAP_BUCKET).download(path);
  if (d.error || !d.data) return false;
  const buf = Buffer.from(await d.data.arrayBuffer());
  return buf.length === bytes && createHash("sha256").update(buf).digest("hex") === sha256;
}

/** Render, bind, upload, verify and finalize a published recap version's PDF. Idempotent; throws on any failure. */
export async function storeRecapPdf(admin: SupabaseClient, recapVersionId: string): Promise<StoredRecapPdf> {
  const src = await admin.rpc("fixture_recap_pdf_source", { p_recap_version_id: recapVersionId });
  if (src.error || !src.data) throw new RecapPdfError("the published recap could not be read");
  const source = src.data as RecapPdfSource;
  const pdf = await renderRecapPdf(source);
  const path = recapPdfPath(source, pdf.sha256);
  const bind = await admin.rpc("bind_fixture_recap_pdf", {
    p_recap_version_id: recapVersionId, p_storage_path: path, p_sha256: pdf.sha256, p_bytes: pdf.bytes.length, p_renderer: RECAP_PDF_RENDERER,
  });
  if (bind.error || !bind.data) throw new RecapPdfError(bind.error?.message?.startsWith("FX_CONFLICT") ? "this recap version is bound to another file" : "the file could not be bound");
  const fail = async (reason: string): Promise<never> => {
    await admin.rpc("finalize_fixture_recap_pdf", { p_recap_version_id: recapVersionId, p_sha256: pdf.sha256, p_stored: false, p_error: reason });
    throw new RecapPdfError(reason);
  };
  if ((bind.data as { status: string }).status !== "stored") {
    const up = await admin.storage.from(RECAP_BUCKET).upload(path, pdf.bytes, { contentType: "application/pdf", upsert: false });
    if (up.error && !isStorageConflict(up.error)) await fail(`upload refused (${String((up.error as { statusCode?: string }).statusCode ?? "error")})`);
    // uploaded now, or already there: either way the bucket must hold exactly the bound bytes
    if (!(await objectMatches(admin, path, pdf.sha256, pdf.bytes.length))) await fail("the stored object differs from the bound file");
    const fin = await admin.rpc("finalize_fixture_recap_pdf", { p_recap_version_id: recapVersionId, p_sha256: pdf.sha256, p_stored: true });
    if (fin.error) throw new RecapPdfError("the stored file could not be recorded (it stays pending and is retried on download)");
  }
  await reconcileRecapPdfOrphans(admin, source.roomId).catch(() => undefined);
  return { recapVersionId, path, sha256: pdf.sha256, bytes: pdf.bytes.length };
}

/** Remove bucket objects in a room's folder that no recap version is bound to (C2O-101 P2). Returns their names. */
export async function reconcileRecapPdfOrphans(admin: SupabaseClient, roomId: string): Promise<string[]> {
  const list = await admin.storage.from(RECAP_BUCKET).list(roomId, { limit: 1000 });
  if (list.error || !list.data) return [];
  const bound = await admin.rpc("fixture_recap_pdf_bound_paths", { p_room_id: roomId });
  if (bound.error || !Array.isArray(bound.data)) return [];
  const keep = new Set((bound.data as string[]).map((p) => p.split("/").pop()));
  const orphans = list.data.map((o) => o.name).filter((n) => !keep.has(n));
  if (orphans.length) await admin.storage.from(RECAP_BUCKET).remove(orphans.map((n) => `${roomId}/${n}`));
  return orphans;
}

/** A short-lived download URL for a stored path (the caller has already proven room access). */
export async function signRecapPdf(admin: SupabaseClient, path: string, fileName: string): Promise<string> {
  const s = await admin.storage.from(RECAP_BUCKET).createSignedUrl(path, RECAP_URL_SECONDS, { download: fileName });
  if (s.error || !s.data?.signedUrl) throw new RecapPdfError("a download link could not be issued");
  return s.data.signedUrl;
}

// ── the only two entry points the Fixture actions use (they never hold a service-role client themselves) ──

/** After the member's OWN publish succeeded: store that version's PDF. Never throws; the record says what happened. */
export async function storePublishedRecapPdf(recapVersionId: string): Promise<"stored" | "failed"> {
  try { await storeRecapPdf(getSupabaseAdminClient(), recapVersionId); return "stored"; }
  catch (e) { console.error("fixture recap PDF not stored at publish", { recapVersionId, reason: (e as Error).message }); return "failed"; }
}

/** After get_fixture_recap_pdf (member session) proved room access: the stored file (finishing a pending or failed
 *  store of the SAME bound artifact first) and a 60-second link. */
export async function issueRecapPdfLink(rec: { recapVersionId: string; status: string; path: string | null; sha256: string | null }, fileName: string): Promise<{ url: string; sha256: string }> {
  const admin = getSupabaseAdminClient();
  const stored = rec.status === "stored" && rec.path && rec.sha256 ? { path: rec.path, sha256: rec.sha256 } : await storeRecapPdf(admin, rec.recapVersionId);
  return { url: await signRecapPdf(admin, stored.path, fileName), sha256: stored.sha256 };
}

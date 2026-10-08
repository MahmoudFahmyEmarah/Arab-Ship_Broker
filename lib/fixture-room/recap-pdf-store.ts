// Fixture Room · storing and serving the recap PDF (O2ALL-005, 9 Oct 2026). SERVER ONLY.
//
// The one place the Fixture Room touches the service role, and only for the recap PDF: the private fixture-recaps
// bucket has no member policy by design (20261008051000). Authority always comes first from the member's own
// session: the publish command they ran, or get_fixture_recap_pdf (which checks room access). Only then does this
// module read the published recap, store the file and issue a short-lived signed URL.
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { RECAP_PDF_RENDERER, recapPdfPath, renderRecapPdf, type RecapPdfSource } from "./recap-pdf";

export const RECAP_BUCKET = "fixture-recaps";
export const RECAP_URL_SECONDS = 60;

export interface StoredRecapPdf { recapVersionId: string; path: string; sha256: string; bytes: number }

/** Render (deterministically), upload once and record a published recap version's PDF. Idempotent. */
export async function storeRecapPdf(admin: SupabaseClient, recapVersionId: string): Promise<StoredRecapPdf> {
  const src = await admin.rpc("fixture_recap_pdf_source", { p_recap_version_id: recapVersionId });
  if (src.error || !src.data) throw new Error("recap PDF: the published recap could not be read");
  const source = src.data as RecapPdfSource;
  const pdf = renderRecapPdf(source);
  const path = recapPdfPath(source, pdf.sha256);
  const up = await admin.storage.from(RECAP_BUCKET).upload(path, pdf.bytes, { contentType: "application/pdf", upsert: false });
  // the same recap renders the same bytes, so an object already at this digest-named path is this file
  if (up.error && !/exist|duplicate|409/i.test(`${up.error.message} ${(up.error as { statusCode?: string }).statusCode ?? ""}`)) {
    throw new Error("recap PDF: the file could not be stored");
  }
  const rec = await admin.rpc("record_fixture_recap_pdf", {
    p_recap_version_id: recapVersionId, p_storage_path: path, p_sha256: pdf.sha256, p_bytes: pdf.bytes.length, p_renderer: RECAP_PDF_RENDERER,
  });
  if (rec.error || !rec.data) throw new Error("recap PDF: the file could not be recorded");
  const r = rec.data as { recapVersionId: string; path: string; sha256: string; bytes: number };
  return { recapVersionId: r.recapVersionId, path: r.path, sha256: r.sha256, bytes: r.bytes };
}

/** A short-lived download URL for a stored path (the caller has already proven room access). */
export async function signRecapPdf(admin: SupabaseClient, path: string, fileName: string): Promise<string> {
  const s = await admin.storage.from(RECAP_BUCKET).createSignedUrl(path, RECAP_URL_SECONDS, { download: fileName });
  if (s.error || !s.data?.signedUrl) throw new Error("recap PDF: a download link could not be issued");
  return s.data.signedUrl;
}

// ── the only two entry points the Fixture actions use (they never hold a service-role client themselves) ──

/** After the member's OWN publish succeeded: store that version's PDF. Never throws; a miss is rendered on download. */
export async function storePublishedRecapPdf(recapVersionId: string): Promise<boolean> {
  try { await storeRecapPdf(getSupabaseAdminClient(), recapVersionId); return true; }
  catch (e) { console.error("fixture recap PDF not stored at publish", { recapVersionId, reason: (e as Error).message }); return false; }
}

/** After get_fixture_recap_pdf (member session) proved room access: the stored file (rendered now if missing) and a link. */
export async function issueRecapPdfLink(rec: { recapVersionId: string; stored: boolean; path: string | null; sha256: string | null }, fileName: string): Promise<{ url: string; sha256: string }> {
  const admin = getSupabaseAdminClient();
  const stored = rec.stored && rec.path && rec.sha256 ? { path: rec.path, sha256: rec.sha256 } : await storeRecapPdf(admin, rec.recapVersionId);
  return { url: await signRecapPdf(admin, stored.path, fileName), sha256: stored.sha256 };
}

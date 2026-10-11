// Fixture Room · the STORED recap PDF (owner decisions O2ALL-005 / O2ALL-006, 9 Oct 2026).
//
// When a recap version is published the server renders this file ONCE from the published, already-masked recap
// content (recapCoreDocument — the canonical model the page and the stored recap text also use), binds its SHA-256
// and stores it; parties download that exact file. A publish-time snapshot, identical for every party: no
// acknowledgements (they arrive later and stay in the room), no viewer labels. Arabic and Latin text are set in
// embedded fonts with real shaping and right-to-left ordering (pdf-unicode.ts); same source, same bytes.
import { createHash } from "node:crypto";
import { recapCoreDocument, type FixtureDocument } from "./documents";
import type { FixtureRecapContent } from "./types";
import { assemblePdf, loadPdfUnicode, PAGE_H, PAGE_W, shapeLine, wrapText, type DrawOp, type PdfPage } from "./pdf-unicode";

export const RECAP_PDF_RENDERER = "recap-pdf/2";

/** What the server reads for a published recap version (service-only RPC fixture_recap_pdf_source). */
export interface RecapPdfSource {
  recapVersionId: string;
  roomId: string;
  ref: string;
  versionNo: number;
  roomVersion: number;
  publishedAt: string;
  publisherLabel: string;
  contentHash: string;
  content: FixtureRecapContent;
}

const M = 48;                                   // page margin
const W = PAGE_W - 2 * M;
const BODY = 9, SMALL = 7.5, H2 = 10, TITLE = 15;
const LEAD = 1.45;

/** Lay a FixtureDocument out on A4 pages (two passes: the footer needs the page count). */
export function layoutDocument(doc: FixtureDocument, footerLabel: string): PdfPage[] {
  const pages: DrawOp[][] = [[]];
  let y = PAGE_H - M;
  const page = () => pages[pages.length - 1]!;
  const need = (h: number) => { if (y - h < M + 28) { pages.push([]); y = PAGE_H - M; } };
  const text = (s: string, x: number, size: number, bold: boolean, width: number, gray = 0) => {
    const line = shapeLine(s, size, bold);
    // a right-to-left paragraph is right-aligned in its box
    page().push({ kind: "text", x: line.rtl ? x + width - line.width : x, y, line, size, gray });
  };
  const para = (s: string, size: number, bold: boolean, gray = 0) => {
    for (const l of wrapText(s, W, size, bold)) { need(size * LEAD); y -= size * LEAD; text(l, M, size, bold, W, gray); }
  };
  const rule = (gray = 0.8, width = 0.5) => { page().push({ kind: "rule", x1: M, y1: y, x2: PAGE_W - M, y2: y, gray, width }); };

  // letterhead
  need(TITLE * 2); y -= TITLE; text("Arab ShipBroker", M, SMALL + 1, true, W, 0.35);
  y -= TITLE * 1.3; text(doc.title, M, TITLE, true, W);
  y -= BODY * 1.6; text(doc.subtitle, M, BODY + 1, false, W, 0.25);
  y -= BODY; rule(0.6, 0.8);
  // meta block
  for (const [k, v] of doc.meta) {
    const lines = wrapText(v, W - 110, BODY, false);
    lines.forEach((l, i) => { need(BODY * LEAD); y -= BODY * LEAD; if (i === 0) text(k, M, BODY, true, 100, 0.3); text(l, M + 110, BODY, false, W - 110); });
  }
  // sections
  for (const sec of doc.sections) {
    need(H2 * 3); y -= H2 * 1.8; text(sec.title.toUpperCase(), M, H2, true, W, 0.2); y -= 4; rule(0.75, 0.6);
    if (sec.table) {
      const total = (sec.table.widths ?? sec.table.columns.map(() => 1)).reduce((a, b) => a + b, 0);
      const ws = (sec.table.widths ?? sec.table.columns.map(() => 1)).map((w) => (w / total) * W);
      const xs = ws.map((_, i) => M + ws.slice(0, i).reduce((a, b) => a + b, 0));
      need(BODY * LEAD); y -= BODY * LEAD;
      sec.table.columns.forEach((c, i) => text(c.toUpperCase(), xs[i]!, SMALL, true, ws[i]! - 6, 0.35));
      for (const row of sec.table.rows) {
        const cells = row.map((c, i) => wrapText(c, ws[i]! - 6, BODY, false));
        const h = Math.max(...cells.map((c) => c.length));
        need(h * BODY * LEAD + 4);
        y -= 3;
        for (let k = 0; k < h; k++) { y -= BODY * LEAD; cells.forEach((c, i) => { if (c[k]) text(c[k]!, xs[i]!, BODY, false, ws[i]! - 6); }); }
        y -= 2; rule(0.9, 0.4);
      }
    }
    for (const l of sec.lines ?? []) para(l, BODY, false);
  }
  // footer notes
  need(BODY * 3); y -= BODY * 1.5; rule(0.6, 0.8);
  for (const f of doc.footer) para(f, SMALL + 0.5, false, 0.3);

  return pages.map((ops, i) => {
    const foot = shapeLine(`${footerLabel}  |  page ${i + 1} of ${pages.length}  |  Arab ShipBroker`, SMALL, false);
    return { ops: [...ops, { kind: "text", x: M, y: M - 10, line: foot, size: SMALL, gray: 0.4 } as DrawOp] };
  });
}

/** Render the stored recap. Same source → same bytes → same SHA-256. Throws if any text cannot be set exactly. */
export async function renderRecapPdf(src: RecapPdfSource): Promise<{ bytes: Uint8Array; sha256: string; fileName: string }> {
  await loadPdfUnicode();
  const doc = recapCoreDocument(src.content, {
    versionNo: src.versionNo, roomVersion: src.roomVersion, publishedAt: src.publishedAt,
    publishedByLabel: src.publisherLabel, contentHash: src.contentHash,
  });
  const pages = layoutDocument(doc, `${src.content.ref} recap v${src.versionNo}`);
  const bytes = assemblePdf(pages, { title: `${src.content.ref} recap v${src.versionNo}`, createdAt: src.publishedAt, idHex: src.contentHash });
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex"), fileName: doc.fileName };
}

/** The bucket path: one object per recap version, named by its FULL digest (C2O-101 P2). */
export function recapPdfPath(src: Pick<RecapPdfSource, "roomId" | "versionNo">, sha256: string): string {
  return `${src.roomId}/recap-v${src.versionNo}-${sha256}.pdf`;
}

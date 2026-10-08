// Fixture Room · the STORED recap PDF (owner decision O2ALL-005, 9 Oct 2026).
//
// When a recap version is published, the server renders this document ONCE from the published, already-masked
// recap content, stores it in the private fixture-recaps bucket and records its SHA-256; parties download that
// exact file. It is a publish-time snapshot, identical for every party: acknowledgements (which arrive later) and
// the viewer's own labels are deliberately absent — the room shows those. Same source, same bytes (pdf-writer).
import { createHash } from "node:crypto";
import type { FixtureRecapContent } from "./types";
import { LINE_CHARS, PAGE_LINES, displayLength, renderPdf, wrap, type PdfLine, type PdfPageSpec } from "./pdf-writer";

export const RECAP_PDF_RENDERER = "recap-pdf/1";

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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function stamp(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} UTC`;
}
const dash = (v: unknown) => (v == null || v === "" ? "-" : String(v));
const upper = (s: string) => s.replace(/_/g, " ").toUpperCase();
const num = (v: number | null) => (v == null ? "-" : v.toLocaleString("en-US"));

function pad(s: string, width: number): string {
  const n = displayLength(s);
  return n >= width ? s : s + " ".repeat(width - n);
}

/** A table as fixed-width text: columns sized by share of the line, cells wrapped, rows separated. */
function table(columns: string[], shares: number[], rows: string[][]): PdfLine[] {
  const avail = LINE_CHARS - 2 - (columns.length - 1);
  const total = shares.reduce((a, b) => a + b, 0);
  const widths = shares.map((s) => Math.max(4, Math.floor((s / total) * avail)));
  const out: PdfLine[] = [{ text: "  " + columns.map((c, i) => pad(c.toUpperCase(), widths[i]!)).join(" ").trimEnd(), bold: true }];
  for (const row of rows) {
    const cells = row.map((c, i) => wrap(c, widths[i]!));
    const h = Math.max(...cells.map((c) => c.length));
    for (let k = 0; k < h; k++) out.push({ text: "  " + cells.map((c, i) => pad(c[k] ?? "", widths[i]!)).join(" ").trimEnd() });
  }
  return out;
}

/** The stored recap as lines (before paging). Exported for tests. */
export function recapPdfLines(src: RecapPdfSource): PdfLine[] {
  const c = src.content;
  const rule = "-".repeat(LINE_CHARS);
  const L: PdfLine[] = [];
  const head = (t: string) => { L.push({ text: "" }, { text: t.toUpperCase(), bold: true }); };
  const kv = (k: string, v: string) => { for (const [i, line] of wrap(v, LINE_CHARS - 16).entries()) L.push({ text: (i === 0 ? pad(k, 14) + ": " : " ".repeat(16)) + line }); };

  L.push({ text: "ARAB SHIPBROKER - FIXTURE RECAP", bold: true });
  L.push({ text: `${dash(c.cargo.commodity)} / ${dash(c.vessel.name)}` });
  L.push({ text: rule });
  kv("Reference", `${c.ref} - recap v${src.versionNo}`);
  kv("Status", upper(String(c.status)));
  kv("Published", `${stamp(src.publishedAt)} by ${src.publisherLabel}`);
  kv("Room version", String(src.roomVersion));

  head("The fixture");
  kv("Cargo", `${dash(c.cargo.commodity)}, ${num(c.cargo.qtyMin)}-${num(c.cargo.qtyMax)} MT`);
  kv("Route", `${dash(c.cargo.loadPort)} -> ${dash(c.cargo.dischPort)}`);
  kv("Vessel", `${dash(c.vessel.name)}${c.vessel.type ? `, ${c.vessel.type}` : ""}${c.vessel.dwt != null ? `, ${num(c.vessel.dwt)} DWT` : ""}`);

  head("Parties");
  L.push(...table(["Side", "Party"], [28, 72], c.parties.map((p) => [p.label, p.name ?? "withheld - via Arab ShipBroker"])));

  head("Main terms");
  L.push(...table(["#", "Term", "Agreed", "Status"], [6, 30, 46, 18], [...c.terms].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => [
    String(t.sortOrder), t.label,
    t.status === "agreed" ? dash(t.agreedValue) : `cargo ${dash(t.cargoPosition)} / vessel ${dash(t.vesselPosition)}`,
    upper(t.status),
  ])));

  head("Subjects");
  if (c.subjects.length) {
    L.push(...table(["#", "Subject", "Responsible", "Deadline", "Status"], [5, 35, 15, 29, 16], [...c.subjects].sort((a, b) => a.seq - b.seq).map((s) => [
      String(s.seq), s.title, s.responsibleSide ? `${s.responsibleSide} side` : "either side", stamp(s.deadlineAt), upper(s.status),
    ])));
  } else {
    L.push({ text: "  None recorded - the fixture is clean on agreement." });
  }

  L.push({ text: "" }, { text: rule });
  for (const line of wrap(`Counterparty identity: ${c.counterpartyDisclosed ? "disclosed by both principals" : "withheld - via Arab ShipBroker"}.`, LINE_CHARS)) L.push({ text: line });
  for (const line of wrap("Sub all terms / details of C/P otherwise as per owners' proforma.", LINE_CHARS)) L.push({ text: line });
  for (const line of wrap("Acknowledgements are recorded in the Fixture Room; this file is the recap exactly as published.", LINE_CHARS)) L.push({ text: line });
  for (const line of wrap(`Recap content hash: ${src.contentHash}`, LINE_CHARS)) L.push({ text: line });
  return L;
}

/** Page the lines, with a running header and "page n of N" footer. */
export function recapPdfPages(src: RecapPdfSource, lines: PdfLine[]): PdfPageSpec[] {
  const body = PAGE_LINES - 4;
  const chunks: PdfLine[][] = [];
  for (let i = 0; i < lines.length; i += body) chunks.push(lines.slice(i, i + body));
  if (!chunks.length) chunks.push([]);
  return chunks.map((chunk, i) => {
    const page: PdfLine[] = i === 0 ? [...chunk] : [{ text: `${src.content.ref} - recap v${src.versionNo} (continued)`, bold: true }, { text: "" }, ...chunk];
    while (page.length < PAGE_LINES - 1) page.push({ text: "" });
    page.push({ text: `${src.content.ref} recap v${src.versionNo}  |  page ${i + 1} of ${chunks.length}  |  Arab ShipBroker` });
    return { lines: page };
  });
}

/** Render the stored recap. Same source → same bytes → same SHA-256. */
export function renderRecapPdf(src: RecapPdfSource): { bytes: Uint8Array; sha256: string; replaced: number; fileName: string } {
  let lines = recapPdfLines(src);
  const probe = renderPdf(recapPdfPages(src, lines), { title: `${src.content.ref} recap v${src.versionNo}`, createdAt: src.publishedAt, idHex: src.contentHash });
  if (probe.replaced > 0) {
    lines = [...lines, { text: "" }, ...wrap(`Note: ${probe.replaced} character(s) outside the standard PDF font (for example Arabic script) are shown as "?". The room shows the original text.`, LINE_CHARS).map((t) => ({ text: t }))];
  }
  const out = probe.replaced > 0
    ? renderPdf(recapPdfPages(src, lines), { title: `${src.content.ref} recap v${src.versionNo}`, createdAt: src.publishedAt, idHex: src.contentHash })
    : probe;
  return {
    bytes: out.bytes,
    sha256: createHash("sha256").update(out.bytes).digest("hex"),
    replaced: out.replaced,
    fileName: `Fixture-${src.content.ref}-recap-v${src.versionNo}.pdf`,
  };
}

/** The bucket path: one object per recap version, named by its digest so a replacement can never reuse the name. */
export function recapPdfPath(src: Pick<RecapPdfSource, "roomId" | "versionNo">, sha256: string): string {
  return `${src.roomId}/recap-v${src.versionNo}-${sha256.slice(0, 16)}.pdf`;
}

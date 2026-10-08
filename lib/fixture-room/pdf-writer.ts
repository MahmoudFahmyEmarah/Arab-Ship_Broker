// Fixture Room · a minimal, dependency-free PDF writer for the stored recap (O2ALL-005, 9 Oct 2026).
//
// Why hand-written: the stored recap PDF is a record whose SHA-256 is kept in the ledger, so the same document must
// always produce the same bytes. This writer is deterministic by construction — no clock, no random ids, no
// compression, a fixed object order — and has nothing to install or patch. It sets text only, in the standard
// Courier fonts (every glyph 600/1000 em wide, so layout needs no font metrics), the traditional face of a fixture
// recap. Characters outside WinAnsi (e.g. Arabic script) cannot be shown by a standard font: they are replaced by
// "?", counted, and the caller prints a note — a later Unicode renderer can lift that limit.

export interface PdfLine { text: string; bold?: boolean }
export interface PdfPageSpec { lines: PdfLine[] }
export interface PdfOptions {
  title: string;
  /** ISO timestamp written as the CreationDate (the publish time), never "now". */
  createdAt: string;
  /** Hex digest used for the file /ID (e.g. the recap content hash). */
  idHex: string;
  fontSize?: number;
}

export const PAGE_W = 595.28; // A4, points
export const PAGE_H = 841.89;
export const MARGIN = 48;
export const FONT_SIZE = 9;
export const LEADING = 12.5;
/** Characters per line at the default size: Courier advances 0.6 em per glyph. */
export const LINE_CHARS = Math.floor((PAGE_W - 2 * MARGIN) / (0.6 * FONT_SIZE));
export const PAGE_LINES = Math.floor((PAGE_H - 2 * MARGIN) / LEADING);

// Unicode → WinAnsi (cp1252) for the 0x80–0x9F block; Latin-1 maps to itself.
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88,
  0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93,
  0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
// glyphs a recap commonly carries that WinAnsi lacks, spelled with what it has
const SPELL: Record<string, string> = { "→": "->", "←": "<-", "≤": "<=", "≥": ">=", "≈": "~", "×": "x", " ": " ", " ": " ", " ": " " };

/** Encode text to WinAnsi bytes; returns the bytes and how many characters had to be replaced by "?". */
export function winAnsi(text: string): { bytes: number[]; replaced: number } {
  const bytes: number[] = [];
  let replaced = 0;
  for (const raw of text.normalize("NFC")) {
    const ch = SPELL[raw] ?? raw;
    for (const c of ch) {
      const cp = c.codePointAt(0)!;
      if (cp === 0x09) { bytes.push(0x20); continue; }
      if (cp >= 0x20 && cp < 0x7f) bytes.push(cp);
      else if (cp >= 0xa0 && cp <= 0xff) bytes.push(cp);
      else if (CP1252[cp] != null) bytes.push(CP1252[cp]!);
      else { bytes.push(0x3f); replaced += 1; }
    }
  }
  return { bytes, replaced };
}

/** Count of characters a string will occupy (after spelling), for layout. */
export function displayLength(text: string): number {
  let n = 0;
  for (const raw of text.normalize("NFC")) n += [...(SPELL[raw] ?? raw)].length;
  return n;
}

/** Word-wrap to `width` characters; hard-breaks a word longer than a line. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/ +/)) {
      let w = word;
      while (displayLength(w) > width) {
        if (line) { out.push(line); line = ""; }
        const chars = [...w];
        out.push(chars.slice(0, width).join(""));
        w = chars.slice(width).join("");
      }
      if (!line) line = w;
      else if (displayLength(line) + 1 + displayLength(w) <= width) line += " " + w;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0x7f);

function pdfString(bytes: number[]): number[] {
  const out: number[] = [0x28]; // (
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c, b);
    else if (b < 0x20 || b > 0x7e) out.push(...ascii("\\" + b.toString(8).padStart(3, "0")));
    else out.push(b);
  }
  out.push(0x29);
  return out;
}

function pdfDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "D:19700101000000Z";
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

/** Render pages of lines into a PDF. Deterministic: equal input gives equal bytes. */
export function renderPdf(pages: PdfPageSpec[], opts: PdfOptions): { bytes: Uint8Array; replaced: number } {
  const size = opts.fontSize ?? FONT_SIZE;
  let replaced = 0;
  const objects: number[][] = []; // index i = object number i + 1
  const add = (body: number[]) => { objects.push(body); return objects.length; };
  const catalog = add([]); // filled below
  const pagesObj = add([]);
  const fReg = add(ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>"));
  const fBold = add(ascii("<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>"));
  const kids: number[] = [];
  for (const page of (pages.length ? pages : [{ lines: [] }])) {
    const stream: number[] = ascii(`BT\n${LEADING} TL\n${MARGIN} ${(PAGE_H - MARGIN - size).toFixed(2)} Td\n`);
    let bold: boolean | null = null;
    for (const line of page.lines) {
      if (line.bold !== bold) { bold = !!line.bold; stream.push(...ascii(`/${bold ? "F2" : "F1"} ${size} Tf\n`)); }
      const enc = winAnsi(line.text);
      replaced += enc.replaced;
      stream.push(...pdfString(enc.bytes), ...ascii(" Tj T*\n"));
    }
    stream.push(...ascii("ET\n"));
    const content = add([...ascii(`<< /Length ${stream.length} >>\nstream\n`), ...stream, ...ascii("endstream")]);
    kids.push(add(ascii(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] `
      + `/Resources << /Font << /F1 ${fReg} 0 R /F2 ${fBold} 0 R >> >> /Contents ${content} 0 R >>`)));
  }
  objects[catalog - 1] = ascii(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  objects[pagesObj - 1] = ascii(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const info = add([...ascii("<< /Title "), ...pdfString(winAnsi(opts.title).bytes),
    ...ascii(` /Producer (Arab ShipBroker recap renderer 1) /CreationDate (${pdfDate(opts.createdAt)}) >>`)]);

  const out: number[] = ascii("%PDF-1.4\n");
  out.push(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a); // binary marker comment
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out.push(...ascii(`${i + 1} 0 obj\n`), ...body, ...ascii("\nendobj\n"));
  });
  const xref = out.length;
  out.push(...ascii(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`));
  for (const o of offsets) out.push(...ascii(`${String(o).padStart(10, "0")} 00000 n \n`));
  const id = (opts.idHex.replace(/[^0-9a-f]/gi, "").toLowerCase() + "0".repeat(32)).slice(0, 32);
  out.push(...ascii(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`));
  return { bytes: Uint8Array.from(out), replaced };
}

// Fixture Room · a deterministic Unicode PDF renderer for stored documents (owner decision O2ALL-006, 9 Oct 2026).
//
// Replaces the WinAnsi writer for the stored recap: every character is set in an embedded font — Noto Sans for
// Latin and Noto Naskh Arabic for Arabic (both SIL OFL 1.1, files and licence in assets/fonts) — with real shaping
// (HarfBuzz: Arabic joining, ligatures, marks) and the Unicode Bidirectional Algorithm (bidi-js: right-to-left
// runs, mirrored brackets, numbers inside Arabic). No character is ever replaced: text neither font can show stops
// the render with an error, so a stored record is either exact or not made.
//
// Determinism (the stored file's SHA-256 is a record): no clock (CreationDate is the caller's time), no random ids
// (/ID from the caller's digest), fixed object order, every glyph placed with an explicit text matrix at two
// decimals, fonts embedded whole (no subsetting step to vary). The same document gives the same bytes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type * as HB from "harfbuzzjs";
import bidiFactory from "bidi-js";

// ── fonts ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type FaceKey = "sans" | "sansBold" | "arabic" | "arabicBold" | "math";
const FONT_FILES: Record<FaceKey, { file: string; name: string }> = {
  sans: { file: "NotoSans-Regular.ttf", name: "NotoSans-Regular" },
  sansBold: { file: "NotoSans-Bold.ttf", name: "NotoSans-Bold" },
  arabic: { file: "NotoNaskhArabic-Regular.ttf", name: "NotoNaskhArabic-Regular" },
  arabicBold: { file: "NotoNaskhArabic-Bold.ttf", name: "NotoNaskhArabic-Bold" },
  // the symbols fallback (arrows, ≤ ≥, ✓): Noto Sans has none of them
  math: { file: "NotoSansMath-Regular.ttf", name: "NotoSansMath-Regular" },
};
interface LoadedFace { key: FaceKey; bytes: Uint8Array; font: HB.Font; face: HB.Face; upem: number }
let FACES: Record<FaceKey, LoadedFace> | null = null;
// HarfBuzz is an ES module with a top-level await (its WebAssembly): loaded once, by dynamic import
let hb: typeof HB | null = null;
/** Load HarfBuzz and the four fonts once; every render awaits this first. */
export async function loadPdfUnicode(): Promise<void> {
  if (!hb) hb = await import("harfbuzzjs");
  faces();
}
export function fontsDir(): string { return join(process.cwd(), "assets", "fonts"); }
function faces(): Record<FaceKey, LoadedFace> {
  if (FACES) return FACES;
  if (!hb) throw new Error("pdf-unicode: call loadPdfUnicode() first");
  const out = {} as Record<FaceKey, LoadedFace>;
  for (const key of Object.keys(FONT_FILES) as FaceKey[]) {
    const bytes = new Uint8Array(readFileSync(join(fontsDir(), FONT_FILES[key].file)));
    const face = new hb!.Face(new hb!.Blob(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer));
    const font = new hb!.Font(face);
    font.setScale(face.upem, face.upem);
    out[key] = { key, bytes, font, face, upem: face.upem };
  }
  FACES = out;
  return out;
}

const ARABIC = /[؀-ۿݐ-ݿࡰ-࢟ࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const bidi = bidiFactory();

export interface Glyph { gid: number; x: number; y: number; face: FaceKey; text: string }
export interface ShapedLine { glyphs: Glyph[]; width: number; rtl: boolean; text: string }

export class UnsupportedTextError extends Error {}

/** Shape one logical line into positioned glyphs (points, origin at the line start), visual order. */
export function shapeLine(text: string, size: number, bold: boolean): ShapedLine {
  const F = faces();
  const line = text.normalize("NFC");
  if (!line) return { glyphs: [], width: 0, rtl: false, text: "" };
  const emb = bidi.getEmbeddingLevels(line);
  const levels = emb.levels as Uint8Array;
  const baseRtl = (emb.paragraphs?.[0]?.level ?? 0) % 2 === 1;
  const chars = [...line];
  // code-unit offsets of each code point
  const offs: number[] = []; { let o = 0; for (const ch of chars) { offs.push(o); o += ch.length; } }
  // the face of each code point: Arabic letters → Naskh; everything else → the first face that has the glyph
  // (Noto Sans, then the Math symbols face, then Naskh); a space or punctuation mark keeps its neighbour's face
  // when that face has it, so a run is not broken needlessly. A character no face has stops the render.
  type Fam = "sans" | "arabic" | "math";
  const has = (fam: Fam, ch: string) => (F[fam].font.nominalGlyph(ch.codePointAt(0)!) ?? 0) !== 0;
  const NEUTRAL = /[\s.,;:!?()\[\]{}\/\-–—'"“”‘’…·%+]/;
  const fam: Fam[] = [];
  chars.forEach((ch, i) => {
    let f: Fam | null = null;
    if (ARABIC.test(ch)) f = "arabic";
    else if (NEUTRAL.test(ch) && i > 0 && has(fam[i - 1]!, ch)) f = fam[i - 1]!;
    else f = (["sans", "math", "arabic"] as Fam[]).find((c) => has(c, ch)) ?? null;
    if (!f) throw new UnsupportedTextError(`the stored PDF fonts cannot show "${ch}" (U+${ch.codePointAt(0)!.toString(16).toUpperCase()})`);
    fam.push(f);
  });
  // runs: same embedding level and same face
  type Run = { start: number; end: number; level: number; fam: Fam };
  const runs: Run[] = [];
  for (let i = 0; i < chars.length; i++) {
    const level = levels[offs[i]!]!, f = fam[i]!;
    const last = runs[runs.length - 1];
    if (last && last.level === level && last.fam === f) last.end = i + 1; else runs.push({ start: i, end: i + 1, level, fam: f });
  }
  // shape each run in its own direction
  const shaped = runs.map((r) => {
    const key: FaceKey = r.fam === "math" ? "math" : r.fam === "arabic" ? (bold ? "arabicBold" : "arabic") : (bold ? "sansBold" : "sans");
    const face = F[key];
    const runText = chars.slice(r.start, r.end).join("");
    const buf = new hb!.Buffer();
    buf.addText(runText);
    buf.setDirection(r.level % 2 === 1 ? hb!.Direction.RTL : hb!.Direction.LTR);
    buf.setScript(r.fam === "arabic" ? "Arab" : r.fam === "math" ? "Zmth" : "Latn");
    hb!.shape(face.font, buf);
    const infos = buf.getGlyphInfos(), pos = buf.getGlyphPositions();
    // the text each glyph stands for (its cluster), for copy and search
    const runChars = [...runText]; const runOffs: number[] = []; { let o = 0; for (const ch of runChars) { runOffs.push(o); o += ch.length; } }
    const clusters = [...new Set(infos.map((g) => g.cluster))].sort((a, b) => a - b);
    const clusterText = (cl: number) => { const k = clusters.indexOf(cl); const end = k + 1 < clusters.length ? clusters[k + 1]! : runText.length; return runText.slice(cl, end); };
    const scale = size / face.upem;
    // one glyph per cluster carries the cluster's text (the one with the largest advance — the base letter); dots and
    // marks that Naskh draws as separate glyphs carry none, so copy and search do not repeat letters
    const carrier = new Map<number, number>();
    infos.forEach((g, i) => { const c = carrier.get(g.cluster); if (c === undefined || pos[i]!.xAdvance > pos[c]!.xAdvance) carrier.set(g.cluster, i); });
    const glyphs: Glyph[] = []; let x = 0;
    infos.forEach((g, i) => {
      if (g.codepoint === 0) {
        const bad = clusterText(g.cluster);
        if (/\S/.test(bad)) throw new UnsupportedTextError(`the stored PDF fonts cannot show "${bad}" (U+${bad.codePointAt(0)!.toString(16).toUpperCase()})`);
      }
      const p = pos[i]!;
      glyphs.push({ gid: g.codepoint, x: x + p.xOffset * scale, y: p.yOffset * scale, face: key, text: carrier.get(g.cluster) === i ? clusterText(g.cluster) : "" });
      x += p.xAdvance * scale;
    });
    return { run: r, glyphs, width: x };
  });
  // visual order of the runs (UAX #9 L2): reverse every maximal sequence at or above each odd level, highest first
  const order = shaped.map((_, i) => i);
  const maxLevel = Math.max(...runs.map((r) => r.level));
  const minOdd = Math.min(...runs.map((r) => r.level).filter((l) => l % 2 === 1), Infinity);
  for (let lvl = maxLevel; lvl >= minOdd && Number.isFinite(minOdd); lvl--) {
    for (let i = 0; i < order.length;) {
      if (runs[order[i]!]!.level >= lvl) {
        let j = i; while (j < order.length && runs[order[j]!]!.level >= lvl) j++;
        order.splice(i, j - i, ...order.slice(i, j).reverse()); i = j;
      } else i++;
    }
  }
  const glyphs: Glyph[] = []; let x = 0;
  for (const k of order) { for (const g of shaped[k]!.glyphs) glyphs.push({ ...g, x: g.x + x }); x += shaped[k]!.width; }
  return { glyphs, width: x, rtl: baseRtl, text: line };
}

export function measure(text: string, size: number, bold: boolean): number { return shapeLine(text, size, bold).width; }

/** Wrap a paragraph to a width (points): by words, hard-breaking a word longer than a line. */
export function wrapText(text: string, width: number, size: number, bold: boolean): string[] {
  const out: string[] = [];
  for (const para of String(text).split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/ +/)) {
      let w = word;
      while (w && measure(w, size, bold) > width) {
        if (line) { out.push(line); line = ""; }
        const cs = [...w]; let k = cs.length;
        while (k > 1 && measure(cs.slice(0, k).join(""), size, bold) > width) k--;
        out.push(cs.slice(0, k).join("")); w = cs.slice(k).join("");
      }
      if (!line) line = w;
      else if (measure(`${line} ${w}`, size, bold) <= width) line = `${line} ${w}`;
      else { out.push(line); line = w; }
    }
    out.push(line);
  }
  return out;
}

// ── PDF assembly ───────────────────────────────────────────────────────────────────────────────────────────────
export const PAGE_W = 595.28, PAGE_H = 841.89;
export type DrawOp =
  | { kind: "text"; x: number; y: number; line: ShapedLine; size: number; gray?: number }
  | { kind: "rule"; x1: number; y1: number; x2: number; y2: number; gray: number; width: number };
export interface PdfPage { ops: DrawOp[] }

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0) & 0xff);
const n2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, "") || "0";
const hex4 = (v: number) => v.toString(16).toUpperCase().padStart(4, "0");
function utf16Hex(s: string): string {
  let h = ""; for (let i = 0; i < s.length; i++) h += hex4(s.charCodeAt(i)); return h || "FFFD";
}
function pdfLiteral(s: string): number[] {
  // ASCII-only metadata strings, escaped
  const out = [0x28];
  for (const ch of s) { const c = ch.charCodeAt(0); if (c === 0x28 || c === 0x29 || c === 0x5c) out.push(0x5c, c); else out.push(c < 0x20 || c > 0x7e ? 0x3f : c); }
  out.push(0x29); return out;
}
function pdfDate(iso: string): string {
  const d = new Date(iso); if (Number.isNaN(d.getTime())) return "D:19700101000000Z";
  const p = (x: number) => String(x).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}

export function assemblePdf(pages: PdfPage[], opts: { title: string; createdAt: string; idHex: string }): Uint8Array {
  const F = faces();
  // Character ids: one CID per (glyph, text) pair, allocated in document order. Naskh draws ف/ق (and س/ش, …) with one
  // shared base glyph plus dots, so a glyph-indexed ToUnicode would name the wrong letter; a CID per pair maps each
  // occurrence to its own text while CIDToGIDMap points every such CID at the shared glyph.
  const cids = new Map<FaceKey, { byKey: Map<string, number>; gid: number[]; text: string[] }>();
  const cidOf = (g: Glyph): number => {
    let c = cids.get(g.face); if (!c) { c = { byKey: new Map(), gid: [0], text: [""] }; cids.set(g.face, c); }
    const k = `${g.gid}\u0000${g.text}`;
    let id = c.byKey.get(k);
    if (id === undefined) { id = c.gid.length; c.byKey.set(k, id); c.gid.push(g.gid); c.text.push(g.text); }
    return id;
  };
  const used = new Map<FaceKey, true>();
  for (const pg of pages) for (const op of pg.ops) if (op.kind === "text") for (const g of op.line.glyphs) { cidOf(g); used.set(g.face, true); }
  const faceOrder = (Object.keys(FONT_FILES) as FaceKey[]).filter((k) => used.has(k));
  const objects: number[][] = [];
  const add = (b: number[]) => { objects.push(b); return objects.length; };
  const stream = (dict: string, data: number[] | Uint8Array) => add([...enc(`<< ${dict} /Length ${data.length} >>\nstream\n`), ...data, ...enc("\nendstream")]);
  const catalog = add([]), pagesObj = add([]);
  const fontRef = new Map<FaceKey, number>();
  faceOrder.forEach((key, i) => {
    const f = F[key]; const c = cids.get(key)!; const ids = c.gid.map((_, id) => id).slice(1);
    const k = 1000 / f.upem;
    const file = stream(`/Length1 ${f.bytes.length}`, f.bytes);
    const desc = add(enc(`<< /Type /FontDescriptor /FontName /${FONT_FILES[key].name} /Flags 4 /FontBBox [-1000 -1000 3000 2000] /ItalicAngle 0 /Ascent 1069 /Descent -293 /CapHeight 714 /StemV 80 /FontFile2 ${file} 0 R >>`));
    const widths = ids.map((id) => `${id} [${Math.round(f.font.glyphHAdvance(c.gid[id]!) * k)}]`).join(" ");
    const map: number[] = []; for (const g of c.gid) map.push((g >> 8) & 0xff, g & 0xff);
    const cidToGid = stream("", map);
    const cid = add(enc(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${FONT_FILES[key].name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /CIDToGIDMap ${cidToGid} 0 R /DW 1000 /W [${widths}] >>`));
    const cmap = ["/CIDInit /ProcSet findresource begin", "12 dict begin", "begincmap", "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
      `/CMapName /ASB-${FONT_FILES[key].name}-UCS def`, "/CMapType 2 def", "1 begincodespacerange", "<0000> <FFFF>", "endcodespacerange"];
    // a glyph that carries no text of its own (a dot or mark drawn separately) maps to ZERO WIDTH SPACE, so an
    // extractor neither repeats a letter nor invents one
    const pairs = ids.map((id) => `<${hex4(id)}> <${c.text[id] ? utf16Hex(c.text[id]!) : "200B"}>`);
    for (let s = 0; s < pairs.length; s += 100) { const chunk = pairs.slice(s, s + 100); cmap.push(`${chunk.length} beginbfchar`, ...chunk, "endbfchar"); }
    cmap.push("endcmap", "CMapName currentdict /CMap defineresource pop", "end", "end");
    const toUni = stream("", enc(cmap.join("\n")));
    fontRef.set(key, add(enc(`<< /Type /Font /Subtype /Type0 /BaseFont /${FONT_FILES[key].name} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${toUni} 0 R >>`)));
    void i;
  });
  const fontRes = faceOrder.map((key, i) => `/F${i + 1} ${fontRef.get(key)} 0 R`).join(" ");
  const fontName = new Map(faceOrder.map((key, i) => [key, `F${i + 1}`] as const));
  const kids: number[] = [];
  for (const pg of pages) {
    const s: string[] = [];
    for (const op of pg.ops) {
      if (op.kind === "rule") { s.push(`${n2(op.gray)} G ${n2(op.width)} w ${n2(op.x1)} ${n2(op.y1)} m ${n2(op.x2)} ${n2(op.y2)} l S`); continue; }
      if (!op.line.glyphs.length) continue;
      // the logical text of the line for copy and search (the glyphs below are in visual order)
      s.push(`/Span << /ActualText <FEFF${utf16Hex(op.line.text)}> >> BDC`);
      s.push(`BT ${n2(op.gray ?? 0)} g`);
      // one TJ per stretch of glyphs in one face on the baseline: each advance is corrected to the shaped position
      const gl = op.line.glyphs;
      for (let i = 0; i < gl.length;) {
        const g0 = gl[i]!;
        s.push(`/${fontName.get(g0.face)} ${n2(op.size)} Tf 1 0 0 1 ${n2(op.x + g0.x)} ${n2(op.y + g0.y)} Tm`);
        if (g0.y !== 0) { s.push(`<${hex4(cidOf(g0))}> Tj`); i++; continue; }   // a raised or lowered mark stands alone
        const parts: string[] = [];
        let j = i;
        while (j < gl.length && gl[j]!.face === g0.face && gl[j]!.y === 0) {
          parts.push(`<${hex4(cidOf(gl[j]!))}>`);
          const nx = j + 1 < gl.length && gl[j + 1]!.face === g0.face && gl[j + 1]!.y === 0 ? gl[j + 1]!.x : null;
          if (nx !== null) {
            const dflt = F[g0.face].font.glyphHAdvance(gl[j]!.gid) * op.size / F[g0.face].upem;
            const adj = Math.round(((gl[j]!.x + dflt) - nx) * 1000 / op.size);
            if (adj !== 0) parts.push(String(adj));
          }
          j++;
        }
        s.push(`[${parts.join(" ")}] TJ`);
        i = j;
      }
      s.push("ET EMC");
    }
    const content = stream("", enc(s.join("\n")));
    kids.push(add(enc(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << ${fontRes} >> >> /Contents ${content} 0 R >>`)));
  }
  objects[catalog - 1] = enc(`<< /Type /Catalog /Pages ${pagesObj} 0 R /Lang (en) >>`);
  objects[pagesObj - 1] = enc(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
  const info = add([...enc("<< /Title "), ...pdfLiteral(opts.title), ...enc(` /Producer (Arab ShipBroker recap renderer 2) /CreationDate (${pdfDate(opts.createdAt)}) >>`)]);
  const out: number[] = enc("%PDF-1.7\n"); out.push(0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a);
  const offsets: number[] = [];
  objects.forEach((b, i) => { offsets.push(out.length); for (const x of enc(`${i + 1} 0 obj\n`)) out.push(x); for (let j = 0; j < b.length; j++) out.push(b[j]!); for (const x of enc("\nendobj\n")) out.push(x); });
  const xref = out.length;
  for (const x of enc(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)) out.push(x);
  for (const o of offsets) for (const x of enc(`${String(o).padStart(10, "0")} 00000 n \n`)) out.push(x);
  const id = (opts.idHex.replace(/[^0-9a-f]/gi, "").toLowerCase() + "0".repeat(32)).slice(0, 32);
  for (const x of enc(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`)) out.push(x);
  return Uint8Array.from(out);
}

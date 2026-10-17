// Fixture Room · font subsetting for the stored recap PDF (follow-up to O2ALL-006: a whole-font PDF was ~1.7 MB).
//
// HarfBuzz's own subsetter (harfbuzz-subset.wasm, shipped with the pinned harfbuzzjs) keeps only the glyphs a document
// draws. Glyph ids are RETAINED (HB_SUBSET_FLAGS_RETAIN_GIDS), so the renderer's CIDToGIDMap, widths and ToUnicode are
// unchanged; hinting and the layout tables (shaping already happened) are dropped. The subsetter is deterministic: the
// same font and glyph set give the same bytes, so the stored file's SHA-256 stays a record.
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface SubsetExports {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, length: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_length(b: number): number;
  hb_blob_get_data(b: number, lengthOut: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_set_add(set: number, v: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_glyph_set(i: number): number;
  hb_subset_input_set(i: number, which: number): number;
  hb_subset_input_set_flags(i: number, flags: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

const HB_MEMORY_MODE_WRITABLE = 2;
const HB_SUBSET_FLAGS_NO_HINTING = 0x1;
const HB_SUBSET_FLAGS_RETAIN_GIDS = 0x2;
const HB_SUBSET_SETS_DROP_TABLE_TAG = 3;
// shaping is done before the PDF is written, so a viewer never needs these tables
const DROP_TABLES = ["GSUB", "GPOS", "GDEF", "JSTF", "MATH", "BASE", "DSIG"];
const tag = (s: string) => ((s.charCodeAt(0) << 24) | (s.charCodeAt(1) << 16) | (s.charCodeAt(2) << 8) | s.charCodeAt(3)) >>> 0;

let HBS: SubsetExports | null = null;
function subsetter(): SubsetExports {
  if (HBS) return HBS;
  const wasm = readFileSync(join(process.cwd(), "node_modules", "harfbuzzjs", "dist", "harfbuzz-subset.wasm"));
  HBS = new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports as unknown as SubsetExports;
  return HBS;
}

/** The font reduced to the given glyph ids (plus .notdef), with every glyph id unchanged. Throws if HarfBuzz refuses. */
export function subsetFont(font: Uint8Array, gids: Iterable<number>): Uint8Array {
  const h = subsetter();
  const src = h.malloc(font.byteLength);
  if (!src) throw new Error("pdf-subset: out of memory");
  new Uint8Array(h.memory.buffer, src, font.byteLength).set(font);
  const blob = h.hb_blob_create(src, font.byteLength, HB_MEMORY_MODE_WRITABLE, 0, 0);
  const face = h.hb_face_create(blob, 0);
  h.hb_blob_destroy(blob);
  const input = h.hb_subset_input_create_or_fail();
  let result = 0;
  try {
    if (!input) throw new Error("pdf-subset: subset input unavailable");
    const glyphs = h.hb_subset_input_glyph_set(input);
    h.hb_set_add(glyphs, 0);
    for (const g of [...new Set(gids)].sort((a, b) => a - b)) h.hb_set_add(glyphs, g);
    const drop = h.hb_subset_input_set(input, HB_SUBSET_SETS_DROP_TABLE_TAG);
    for (const t of DROP_TABLES) h.hb_set_add(drop, tag(t));
    h.hb_subset_input_set_flags(input, HB_SUBSET_FLAGS_RETAIN_GIDS | HB_SUBSET_FLAGS_NO_HINTING);
    result = h.hb_subset_or_fail(face, input);
    if (!result) throw new Error("pdf-subset: HarfBuzz could not subset the font");
    const outBlob = h.hb_face_reference_blob(result);
    try {
      const length = h.hb_blob_get_length(outBlob);
      const data = h.hb_blob_get_data(outBlob, 0);
      if (!data || !length) throw new Error("pdf-subset: empty subset");
      return new Uint8Array(h.memory.buffer, data, length).slice();
    } finally {
      h.hb_blob_destroy(outBlob);
    }
  } finally {
    if (result) h.hb_face_destroy(result);
    if (input) h.hb_subset_input_destroy(input);
    h.hb_face_destroy(face);
    h.free(src);
  }
}

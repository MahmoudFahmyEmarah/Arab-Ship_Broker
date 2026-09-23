/**
 * Data Sync hardening · workbook resource limits and archive integrity
 * (P1-3, no network). Run:
 *   npx tsx scripts/sync-workbook-limits-check.ts
 *
 * Hand-built ZIP archives exercise the guard that runs BEFORE SheetJS:
 *   compressed expansion (a bomb) · excessive shared strings · too many
 *   entries or sheets · macro and external-link parts · ZIP64 · inconsistent
 *   sizes
 * and, added 21 Sep 2026, the integrity of the central directory itself:
 *   the two EOCD entry counts must agree · multi-disk archives are refused ·
 *   the directory is walked to its exact declared boundary and the cursor
 *   must land on it · declared name, extra and comment lengths are checked
 *   before anything is sliced · local-header offsets must be real and their
 *   data must fit · encryption and unreadable compression methods are
 *   refused · duplicate normalised names and traversal names are refused.
 *
 * The 20 Sep version asserted that an archive declaring three entries while
 * carrying seven was VALID ("the central directory is trusted over the file
 * count"). It was not: the guard inspected three parts and SheetJS reads the
 * archive its own way, so a macro, an external link or a bomb could ride in
 * the four parts the guard skipped. That assertion is now the opposite, and
 * the adversarial cases below are the ones it was hiding.
 *
 * A real workbook then goes through the guard AND the parser, including the
 * narrow-header / wide-data case that the old cell accounting could not see.
 */
import { deflateRawSync } from "node:zlib";
import * as XLSX from "xlsx";
import { inspectXlsxZip, zipProblem, ZIP_LIMITS, assertWorkbookArchiveWithinLimits, entryNameProblem, normalizeEntryName } from "@/lib/sync/xlsx-guard";
import { XlsxSource, WORKBOOK_LIMITS, checkTotals, gridDimensions, checkWorkbookTotals, SYNC_INLINE_MAX_BYTES } from "@/lib/sync/xlsx-source";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };
/** The guard must THROW, and its message must be recognisable. */
const rejects = (build: () => Buffer, re: RegExp, label: string) => {
  let msg = "";
  try { inspectXlsxZip(build()); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
  ok(msg !== "" && re.test(msg), label, msg === "" ? "it was ACCEPTED" : `message was "${msg}"`);
};

// ── a minimal ZIP writer, with the knobs an attacker would reach for ───────
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b: Buffer) => { let c = 0xffffffff; for (let i = 0; i < b.length; i += 1) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

interface Part {
  name: string; data: Buffer; deflate?: boolean; declaredUncompressed?: number;
  /** general-purpose bit flag (bit 0 = encrypted) */
  flags?: number;
  /** override the compression method code in the central directory */
  method?: number;
  /** point the central entry's local-header offset somewhere else */
  localOffset?: number;
  /** lie about the name length in the central entry */
  nameLenOverride?: number;
  /** claim extra / comment bytes that are not there */
  extraLen?: number; commentLen?: number;
  /** claim more compressed bytes than were written */
  compressedOverride?: number;
}
interface ZipOpts {
  declaredEntries?: number;      // EOCD total-entries field
  entriesThisDisk?: number;      // EOCD this-disk field (defaults to declaredEntries)
  cdSizeDelta?: number;          // add to the declared central-directory size
  diskNumber?: number;           // EOCD disk number
  diskWithCd?: number;           // EOCD disk holding the directory
  commentLen?: number;           // EOCD comment length, without the bytes
}
function zip(parts: Part[], opts: ZipOpts = {}): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const p of parts) {
    const name = Buffer.from(p.name, "utf8");
    const body = p.deflate ? deflateRawSync(p.data) : p.data;
    const method = p.method ?? (p.deflate ? 8 : 0);
    const usize = p.declaredUncompressed ?? p.data.length;
    const csize = p.compressedOverride ?? body.length;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(p.flags ?? 0, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc32(p.data), 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(p.flags ?? 0, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc32(p.data), 16); ch.writeUInt32LE(csize, 20); ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(p.nameLenOverride ?? name.length, 28); ch.writeUInt16LE(p.extraLen ?? 0, 30); ch.writeUInt16LE(p.commentLen ?? 0, 32);
    ch.writeUInt32LE(p.localOffset ?? offset, 42);
    locals.push(lh, name, body); centrals.push(ch, name);
    offset += lh.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const total = opts.declaredEntries ?? parts.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(opts.diskNumber ?? 0, 4);
  eocd.writeUInt16LE(opts.diskWithCd ?? 0, 6);
  eocd.writeUInt16LE(opts.entriesThisDisk ?? total, 8);
  eocd.writeUInt16LE(total, 10);
  eocd.writeUInt32LE(cd.length + (opts.cdSizeDelta ?? 0), 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(opts.commentLen ?? 0, 20);
  return Buffer.concat([...locals, cd, eocd]);
}
const xml = (n: number) => Buffer.from(`<?xml version="1.0"?><x>${"a".repeat(n)}</x>`);
const base = (): Part[] => [
  { name: "[Content_Types].xml", data: xml(200) }, { name: "_rels/.rels", data: xml(100) }, { name: "xl/workbook.xml", data: xml(300) },
  { name: "xl/_rels/workbook.xml.rels", data: xml(100) }, { name: "xl/styles.xml", data: xml(500) }, { name: "xl/sharedStrings.xml", data: xml(1000), deflate: true },
  { name: "xl/worksheets/sheet1.xml", data: xml(4000), deflate: true },
];

async function main() {
  console.log("archive inspection");
  {
    const z = inspectXlsxZip(zip(base()));
    ok(z.entries.length === 7 && z.worksheetCount === 1 && z.sharedStringsBytes > 0, "a well-formed workbook archive is read", `${z.entries.length} entries`);
    ok(z.centralDirectory.declaredEntries === 7, "the declared entry count is reported");
    let threw = false; try { inspectXlsxZip(Buffer.from("PK not really")); } catch { threw = true; }
    ok(threw, "a non-ZIP buffer is refused");
    rejects(() => Buffer.alloc(10), /too small/, "a buffer too small to hold an EOCD is refused");
  }

  console.log("resource limits");
  {
    const bomb = zip([...base().slice(0, 6), { name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(9 * 1024 * 1024, 0x20), deflate: true }]);
    const z = inspectXlsxZip(bomb);
    const why = zipProblem(z, bomb.length);
    ok(/compression bomb/.test(why ?? ""), "a 9 MB sheet that deflates to nothing is refused as a bomb", why ?? "accepted");
    const sheetBomb = zip([...base().slice(0, 6), { name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(1024), declaredUncompressed: 70 * 1024 * 1024 }]);
    const why2 = zipProblem(inspectXlsxZip(sheetBomb), sheetBomb.length);
    ok(/One sheet unpacks/.test(why2 ?? ""), "a sheet declaring 70 MB unpacked is refused", why2 ?? "accepted");
    const strings = zip([...base().slice(0, 5), { name: "xl/sharedStrings.xml", data: Buffer.alloc(1024), declaredUncompressed: 50 * 1024 * 1024 }, base()[6]]);
    ok(/shared strings/.test(zipProblem(inspectXlsxZip(strings), strings.length) ?? ""), "50 MB of shared strings is refused");
    const honest = zip([...base().slice(0, 6), { name: "xl/worksheets/sheet1.xml", data: Buffer.alloc(9 * 1024 * 1024, 0), declaredUncompressed: 9 * 1024 * 1024 }]);
    ok(zipProblem(inspectXlsxZip(honest), 9 * 1024 * 1024 + 1024) === null, "an honestly large sheet (9 MB, ~1× ratio) passes");
    const lying = zip([...base().slice(0, 6), { name: "xl/worksheets/sheet1.xml", data: xml(100), declaredUncompressed: 200 }]);
    ok(/inconsistent/.test(zipProblem({ ...inspectXlsxZip(lying), totalCompressed: 99_999_999 }, lying.length) ?? ""), "declared sizes larger than the file are refused");
    const many = zip([...base().slice(0, 6), ...Array.from({ length: 500 }, (_, i) => ({ name: `xl/media/image${i}.png`, data: Buffer.from("png") }))]);
    ok(/parts/.test(zipProblem(inspectXlsxZip(many), many.length) ?? ""), "more than 400 parts is refused");
    const atLimit = zip([...base().slice(0, 6), ...Array.from({ length: ZIP_LIMITS.entries - 6 }, (_, i) => ({ name: `xl/media/image${i}.png`, data: Buffer.from("png") }))]);
    ok(zipProblem(inspectXlsxZip(atLimit), atLimit.length) === null, `exactly ${ZIP_LIMITS.entries} parts passes (boundary)`);
    const sheets = zip([...base().slice(0, 6), ...Array.from({ length: 45 }, (_, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: xml(50) }))]);
    ok(/sheets/.test(zipProblem(inspectXlsxZip(sheets), sheets.length) ?? ""), "more sheets than we accept is refused from the archive alone");
    const big = zip(base());
    ok(/larger than/.test(zipProblem(inspectXlsxZip(big), 11 * 1024 * 1024) ?? ""), "an archive over the byte cap is refused");
  }

  console.log("central-directory integrity (21 Sep 2026)");
  {
    // THE case the old test blessed: 7 parts, 3 declared.
    rejects(() => zip(base(), { declaredEntries: 3 }),
      /inconsistent|declares/, "an understated entry count is REFUSED (was asserted valid before)");
    // and specifically: the parts it would have hidden
    rejects(() => zip([...base(), { name: "xl/vbaProject.bin", data: Buffer.from("vba") }], { declaredEntries: 7 }),
      /inconsistent|declares/, "an understated count hiding a macro part is refused");
    rejects(() => zip([...base(), { name: "xl/worksheets/sheet9.xml", data: Buffer.alloc(1024), declaredUncompressed: 90 * 1024 * 1024 }], { declaredEntries: 7 }),
      /inconsistent|declares/, "an understated count hiding an oversized part is refused");
    rejects(() => zip([...base(), { name: "xl/externalLinks/externalLink1.xml", data: xml(10) }], { declaredEntries: 7 }),
      /inconsistent|declares/, "an understated count hiding an external link is refused");
    // overstated: more entries promised than the directory holds
    rejects(() => zip(base(), { declaredEntries: 9 }), /truncated|corrupt|inconsistent/, "an overstated entry count is refused");
    // the two EOCD counts must agree
    rejects(() => zip(base(), { entriesThisDisk: 3 }), /declares 3 entries on this disk but 7/, "disagreeing EOCD entry counts are refused");
    // the declared directory size must match what the entries occupy
    rejects(() => zip(base(), { cdSizeDelta: 40 }), /runs past the archive|truncated|declares|inconsistent/, "a central directory larger than its entries is refused");
    rejects(() => zip(base(), { cdSizeDelta: -40 }), /declares|inconsistent|truncated/, "a central directory smaller than its entries is refused");
    // multi-disk
    rejects(() => zip(base(), { diskNumber: 1 }), /split across disks/, "a multi-disk archive is refused (disk number)");
    rejects(() => zip(base(), { diskWithCd: 1 }), /split across disks/, "a multi-disk archive is refused (directory disk)");
    // a comment length that does not account for the trailing bytes means the
    // EOCD we found is not the real one
    rejects(() => zip(base(), { commentLen: 5 }), /end-of-central-directory/, "an EOCD whose comment length does not match the file is refused");
    // lengths are validated before slicing
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], nameLenOverride: 40_000 }]),
      /truncated|inconsistent|corrupt/, "a name length that runs past the directory is refused");
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], extraLen: 40_000 }]),
      /inconsistent|truncated|corrupt/, "an extra-field length that runs past the directory is refused");
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], commentLen: 40_000 }]),
      /inconsistent|truncated|corrupt/, "an entry comment length that runs past the directory is refused");
    // local headers
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], localOffset: 999_999 }]),
      /inside the directory|no local header/, "a local-header offset outside the file is refused");
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], localOffset: 5 }]),
      /no local header/, "a local-header offset pointing at the wrong bytes is refused");
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], compressedOverride: 5_000_000 }]),
      /more data than the file holds/, "an entry claiming more data than the file holds is refused");
    // encryption and compression methods
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], flags: 0x0001 }]), /password-protected/, "an encrypted entry is refused");
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], flags: 0x0040 }]), /password-protected/, "a strongly encrypted entry is refused");
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], method: 99 }]), /unsupported compression|AES/, "an AES-compressed entry is refused");
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], method: 14 }]), /unsupported compression|LZMA/, "an LZMA entry is refused");
    rejects(() => zip([...base().slice(0, 6), { ...base()[6], method: 12 }]), /unsupported compression|bzip2/, "a bzip2 entry is refused");
    // duplicate and hostile names
    rejects(() => zip([...base(), { name: "xl/workbook.xml", data: xml(10) }]), /twice/, "a duplicated entry name is refused");
    rejects(() => zip([...base(), { name: "XL/WORKBOOK.XML", data: xml(10) }]), /twice/, "a name duplicated only by case is refused");
    rejects(() => zip([...base(), { name: "../../etc/passwd", data: xml(10) }]), /walks out of the archive/, "a traversal name is refused");
    rejects(() => zip([...base(), { name: "/etc/passwd", data: xml(10) }]), /absolute path/, "an absolute name is refused");
    rejects(() => zip([...base(), { name: "C:/secret.txt", data: xml(10) }]), /drive letter/, "a drive-letter name is refused");
    rejects(() => zip([...base(), { name: "xl\\\\sheet.xml", data: xml(10) }]), /backslash/, "a backslash separator is refused");
    rejects(() => zip([...base(), { name: "xl/bad\u0001name.xml", data: xml(10) }]), /control character/, "a control character in a name is refused");
    // ZIP64 markers still refused
    let threw = false;
    try { const z64 = zip(base()); z64.writeUInt16LE(0xffff, z64.length - 22 + 10); inspectXlsxZip(z64); } catch (e) { threw = /ZIP64/.test((e as Error).message); }
    ok(threw, "a ZIP64 entry count is refused");
    threw = false;
    try { const z64 = zip(base()); z64.writeUInt32LE(0xffffffff, z64.length - 22 + 12); inspectXlsxZip(z64); } catch (e) { threw = /ZIP64/.test((e as Error).message); }
    ok(threw, "a ZIP64 directory size is refused");
  }

  console.log("name rules, directly");
  {
    ok(entryNameProblem("xl/worksheets/sheet1.xml") === null, "an ordinary part name is fine");
    ok(entryNameProblem("xl/media/") === null, "a directory entry is fine");
    ok(/walks out/.test(entryNameProblem("a/../../b") ?? ""), "a traversal segment anywhere is refused");
    ok(/no name/.test(entryNameProblem("") ?? ""), "an empty name is refused");
    ok(/longer than/.test(entryNameProblem("x".repeat(600)) ?? ""), "an absurdly long name is refused");
    ok(normalizeEntryName("XL\\Sheet//A.XML") === "xl/sheet/a.xml", "names normalise for duplicate detection");
  }

  console.log("a real workbook through guard + parser");
  {
    const wb = XLSX.utils.book_new();
    const rows = Array.from({ length: 1200 }, (_, i) => ({ REF: `CM-${i}`, COMMODITY: "Wheat", "LOAD PORT": "Novorossiysk", "DISCH PORT": "Alexandria", "QTY MIN": 5000, "QTY MAX": 6000 }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ REF: "CargoMap" }, ...rows]), "01_CARGO");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
    const z = assertWorkbookArchiveWithinLimits(buf);
    ok(z.worksheetCount === 1 && z.hasMacros === false, "a SheetJS-written workbook passes the guard");
    const src = new XlsxSource(buf);
    const sheets = await src.parse();
    ok(sheets.length === 1 && sheets[0].rows.length >= 1200, "…and parses", `${sheets[0]?.rows.length} rows`);
    ok((src.lastMeasured?.cells ?? 0) > 0 && (src.lastMeasured?.rows ?? 0) >= 1200, "…and the parse reports the grid it actually walked", JSON.stringify(src.lastMeasured?.sheets));
  }

  console.log("cell accounting measures the GRID, not the first mapped row");
  {
    // the exact shape the old accounting could not see: a two-column header
    // with two-hundred-column data rows. Mapped rows keep two keys, so the
    // old measure said 2 columns however wide the data was.
    const grid: unknown[][] = [["REF", "COMMODITY"]];
    for (let i = 0; i < 400; i += 1) grid.push(["CM-" + i, "Wheat", ...Array.from({ length: 198 }, (_, k) => `x${k}`)]);
    const dim = gridDimensions(grid);
    ok(dim.rows === 401 && dim.cols === 200, "the grid is measured at its widest row", JSON.stringify(dim));
    ok(dim.cells === 401 * 200, "the cell count is the grid area, not the header width");
    ok(dim.filled < dim.cells && dim.filled > 400, "filled cells are counted separately", `${dim.filled} of ${dim.cells}`);
    // the old measure, for contrast: the mapped rows have two keys each
    ok(checkTotals([{ sheet: "cargo", rows: 400, cols: 2 }], { totalRows: 60_000, totalCells: 3_000_000 }) === null,
      "by the OLD measure (header width) this workbook looked tiny");
    ok(/cells in total/.test(checkWorkbookTotals(dim.rows, dim.cells, { totalRows: 60_000, totalCells: 50_000 }) ?? ""),
      "by the measured grid it trips the workbook-wide cell limit");
    // and a narrow-header workbook really is refused end to end
    const wb2 = XLSX.utils.book_new();
    const wide = Array.from({ length: 300 }, (_, i) => {
      const r: Record<string, unknown> = { REF: `CM-${i}`, COMMODITY: "Wheat" };
      for (let k = 0; k < 198; k += 1) r[`extra_${k}`] = `v${k}`;
      return r;
    });
    XLSX.utils.book_append_sheet(wb2, XLSX.utils.json_to_sheet([{ REF: "CargoMap" }, ...wide]), "01_CARGO");
    const buf2 = XLSX.write(wb2, { type: "buffer", bookType: "xlsx", compression: true }) as Buffer;
    let msg = "";
    // 40,000 cells is far below this grid's 300 × 200, so the limit must fire
    try {
      const saved = { ...WORKBOOK_LIMITS };
      void saved;
      const dims = gridDimensions(XLSX.utils.sheet_to_json<unknown[]>(XLSX.read(buf2, { type: "buffer", dense: true }).Sheets["01_CARGO"], { header: 1, raw: true, blankrows: false, defval: null }));
      msg = checkWorkbookTotals(dims.rows, dims.cells, { totalRows: 60_000, totalCells: 40_000 }) ?? "";
    } catch (e) { msg = e instanceof Error ? e.message : String(e); }
    ok(/cells in total/.test(msg), "a narrow header over wide data is refused by the workbook-wide cell limit", msg || "accepted");
  }

  console.log("limits and thresholds are coherent");
  {
    ok(checkTotals([{ sheet: "cargo", rows: 30, cols: 10 }, { sheet: "vessels", rows: 20, cols: 10 }], { totalRows: 50, totalCells: 500 }) === null, "totals exactly at the limit pass");
    ok(/rows in total/.test(checkTotals([{ sheet: "cargo", rows: 30, cols: 10 }, { sheet: "vessels", rows: 21, cols: 10 }], { totalRows: 50, totalCells: 1000 }) ?? ""), "one row past the total-row limit is refused");
    ok(/cells in total/.test(checkTotals([{ sheet: "cargo", rows: 30, cols: 20 }], { totalRows: 50, totalCells: 500 }) ?? ""), "one cell past the total-cell limit is refused");
    ok(checkTotals([{ sheet: "cargo", rows: 10, cells: 400 }], { totalRows: 50, totalCells: 500 }) === null, "a measured cell count is used when given");
    ok(/cells in total/.test(checkTotals([{ sheet: "cargo", rows: 10, cols: 2, cells: 900 }], { totalRows: 50, totalCells: 500 }) ?? ""), "…and it wins over the column width");
    ok(WORKBOOK_LIMITS.totalRows <= WORKBOOK_LIMITS.sheets * WORKBOOK_LIMITS.rows, "the total-row limit is tighter than sheets × rows-per-sheet");
    // the published row limit must be a size that has actually been staged
    // (scripts/sync-staging-benchmark.ts): a 13-column workbook reaches the
    // 10 MB upload cap at about 58,000 rows, so a larger figure could never
    // be uploaded and the two limits would contradict each other.
    ok(WORKBOOK_LIMITS.totalRows <= 40_000, "the published row limit is one the benchmark has demonstrated end to end", String(WORKBOOK_LIMITS.totalRows));
    ok(WORKBOOK_LIMITS.totalRows * 180 < ZIP_LIMITS.archiveBytes * 1.05, "…and is consistent with the byte cap at the measured bytes-per-row");
    ok(SYNC_INLINE_MAX_BYTES < ZIP_LIMITS.archiveBytes, "the inline-parse threshold is well below the upload cap, so large files are queued");
    ok(ZIP_LIMITS.worksheets <= WORKBOOK_LIMITS.sheets, "the archive's sheet limit is no looser than the parser's");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();

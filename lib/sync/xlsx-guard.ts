// Workbook resource guard (P1-3, 20 Sep 2026; central directory hardened
// 21 Sep 2026) — what an .xlsx unpacks to, read from the ZIP central
// directory BEFORE any XML is parsed.
//
// A 10 MB upload cap says nothing about the parse: a deflated sheet of a few
// hundred KB can expand to gigabytes of XML, a workbook can carry a thousand
// parts, and sharedStrings.xml alone can be the bomb. SheetJS reads the whole
// archive before `sheetRows` applies, so these limits must be enforced from
// the archive's own table of contents, which is cheap and exact.
//
// 21 Sep 2026 — the guard used to trust the entry count in the end-of-central
// directory record and stop there. It never proved it had consumed the whole
// central directory, and a test asserted that behaviour was correct. An
// archive that declared three entries while carrying seven therefore had four
// parts the guard never looked at, while SheetJS walks the directory its own
// way: a macro, an external link or a compression bomb could ride in the
// parts the guard skipped. The directory is now parsed to its exact declared
// boundary and the cursor must land on it, so the guard and the parser can
// never disagree about what is in the file.
//
// Every field is bounds-checked before it is used to slice, and an archive is
// refused when it is multi-disk, ZIP64, encrypted, uses a compression method
// we do not read, repeats a name, or carries a name that could escape the
// archive.
//
// Pure, synchronous, no dependencies — unit-tested by
// scripts/sync-workbook-limits-check.ts with hand-built archives, including
// the adversarial ones.

export interface ZipEntry {
  name: string;
  /** name lower-cased with separators normalised — the identity used for duplicate detection */
  normalized: string;
  compressed: number;
  uncompressed: number;
  method: number;
  flags: number;
  localOffset: number;
}
export interface ZipInspection {
  entries: ZipEntry[];
  totalCompressed: number;
  totalUncompressed: number;
  sharedStringsBytes: number;
  worksheetCount: number;
  largestWorksheetBytes: number;
  hasMacros: boolean;
  hasExternalLinks: boolean;
  /** the central directory's declared span, proven to have been consumed exactly */
  centralDirectory: { offset: number; size: number; declaredEntries: number };
}

export interface ZipLimits {
  /** ZIP parts (a normal workbook has 15–60) */
  entries: number;
  /** sum of every part's uncompressed size */
  totalUncompressedBytes: number;
  sharedStringsBytes: number;
  worksheetBytes: number;
  /** worksheet parts in the archive */
  worksheets: number;
  /** parts above this size must not expand more than `maxRatio` times */
  ratioFromBytes: number;
  maxRatio: number;
  /** the upload cap; the declared compressed total may not exceed the real file */
  archiveBytes: number;
}

export const ZIP_LIMITS: ZipLimits = {
  entries: 400,
  totalUncompressedBytes: 150 * 1024 * 1024,
  sharedStringsBytes: 40 * 1024 * 1024,
  worksheetBytes: 60 * 1024 * 1024,
  worksheets: 40,
  ratioFromBytes: 8 * 1024 * 1024,
  maxRatio: 100,
  archiveBytes: 10 * 1024 * 1024,
};

const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;
const ZIP64_EOCD = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;

/** Compression methods we can actually read. Anything else is refused rather than guessed at. */
const SUPPORTED_METHODS = new Set([0, 8]); // stored, deflate
const METHOD_NAMES: Record<number, string> = {
  1: "shrunk", 6: "imploded", 9: "enhanced deflate", 12: "bzip2", 14: "LZMA", 93: "zstd", 95: "XZ", 96: "JPEG", 97: "WavPack", 98: "PPMd", 99: "AES",
};

/** General-purpose bit flags that mean we cannot read the entry honestly. */
const FLAG_ENCRYPTED = 0x0001;
const FLAG_STRONG_ENCRYPTION = 0x0040;
const FLAG_MASKED_HEADERS = 0x2000;

const MAX_NAME_BYTES = 512;

/** Why an entry name is unacceptable, or null. */
export function entryNameProblem(name: string): string | null {
  if (name.length === 0) return "an entry has no name";
  if (Buffer.byteLength(name, "utf8") > MAX_NAME_BYTES) return `an entry name is longer than ${MAX_NAME_BYTES} bytes`;
  if (name.includes("\\")) return `entry "${name}" uses a backslash separator`;
  if (/[\x00-\x1F\x7F]/.test(name)) return `entry "${name}" contains a control character`;
  if (name.startsWith("/")) return `entry "${name}" is an absolute path`;
  if (/^[A-Za-z]:/.test(name)) return `entry "${name}" carries a drive letter`;
  const segments = name.split("/");
  if (segments.some((s) => s === "..")) return `entry "${name}" walks out of the archive`;
  if (segments.some((s) => s === "." || s === "")) {
    // a trailing "/" marks a directory entry, which is legitimate
    if (!(segments[segments.length - 1] === "" && segments.slice(0, -1).every((s) => s !== "" && s !== "."))) {
      return `entry "${name}" has an empty or "." path segment`;
    }
  }
  return null;
}

/** Normalised identity for duplicate detection: case-folded, separators unified. */
export function normalizeEntryName(name: string): string {
  return name.replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

/**
 * Parse the central directory in full. Throws with a user-facing message on a
 * malformed, inconsistent, multi-disk, ZIP64, encrypted or unreadable archive.
 */
export function inspectXlsxZip(buf: Buffer): ZipInspection {
  if (buf.length < 22) throw new Error("not a workbook: too small to be a ZIP archive");

  // ── the end-of-central-directory record ─────────────────────────────────
  // Search backwards, and accept a candidate only when its declared comment
  // length accounts for exactly the bytes that follow it. Without that check
  // any four bytes inside the compressed data can pose as an EOCD.
  let eocd = -1;
  const floor = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= floor; i -= 1) {
    if (buf.readUInt32LE(i) !== EOCD) continue;
    const commentLen = buf.readUInt16LE(i + 20);
    if (i + 22 + commentLen === buf.length) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a workbook: no ZIP end-of-central-directory record (or its comment length does not match the file)");

  const diskNumber = buf.readUInt16LE(eocd + 4);
  const diskWithCd = buf.readUInt16LE(eocd + 6);
  const entriesThisDisk = buf.readUInt16LE(eocd + 8);
  const entriesTotal = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64 in any of its forms
  if (entriesTotal === 0xffff || entriesThisDisk === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new Error("ZIP64 workbooks are not accepted — re-save the workbook from Excel as a plain .xlsx");
  }
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === ZIP64_LOCATOR) throw new Error("ZIP64 workbooks are not accepted — re-save the workbook from Excel as a plain .xlsx");

  // a workbook is one file on one disk
  if (diskNumber !== 0 || diskWithCd !== 0) throw new Error("not a workbook: the archive is split across disks");
  if (entriesThisDisk !== entriesTotal) {
    throw new Error(`the workbook archive is inconsistent: its directory declares ${entriesThisDisk} entries on this disk but ${entriesTotal} in total — re-save it and upload again`);
  }
  if (entriesTotal === 0) throw new Error("not a workbook: the archive has no entries");

  const cdEnd = cdOffset + cdSize;
  if (cdSize === 0) throw new Error("not a workbook: the central directory is empty");
  if (cdEnd > eocd) throw new Error("not a workbook: central directory runs past the archive");
  if (cdOffset > buf.length || cdEnd > buf.length) throw new Error("not a workbook: central directory lies outside the file");
  if (buf.readUInt32LE(cdOffset) === ZIP64_EOCD) throw new Error("ZIP64 workbooks are not accepted — re-save the workbook from Excel as a plain .xlsx");

  // ── the central directory, to its exact declared boundary ───────────────
  const entries: ZipEntry[] = [];
  const seen = new Map<string, string>();
  let p = cdOffset;
  for (let n = 0; n < entriesTotal; n += 1) {
    if (p + 46 > cdEnd) {
      throw new Error(`the workbook archive is truncated: entry ${n + 1} of ${entriesTotal} starts past the end of its directory — re-save it and upload again`);
    }
    if (buf.readUInt32LE(p) !== CEN) throw new Error(`not a workbook: corrupt central directory at entry ${n + 1}`);
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const uncompressed = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const entryDisk = buf.readUInt16LE(p + 34);
    const localOffset = buf.readUInt32LE(p + 42);

    // every declared length is checked BEFORE anything is sliced
    const next = p + 46 + nameLen + extraLen + commentLen;
    if (nameLen === 0) throw new Error(`not a workbook: entry ${n + 1} has a zero-length name`);
    if (next > cdEnd) {
      throw new Error(`the workbook archive is inconsistent: entry ${n + 1} declares ${nameLen + extraLen + commentLen} bytes of name, extra and comment that run past its directory — re-save it and upload again`);
    }
    if (entryDisk !== 0) throw new Error("not a workbook: the archive is split across disks");
    if (compressed === 0xffffffff || uncompressed === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error("ZIP64 workbooks are not accepted — re-save the workbook from Excel as a plain .xlsx");
    }

    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    const nameWhy = entryNameProblem(name);
    if (nameWhy) throw new Error(`the workbook archive was refused: ${nameWhy}`);

    if ((flags & FLAG_ENCRYPTED) || (flags & FLAG_STRONG_ENCRYPTION) || (flags & FLAG_MASKED_HEADERS)) {
      throw new Error(`the workbook is password-protected (${name}) — remove the protection and upload it again`);
    }
    if (!SUPPORTED_METHODS.has(method)) {
      throw new Error(`part ${name} uses an unsupported compression method (${METHOD_NAMES[method] ?? `code ${method}`}) — re-save the workbook from Excel`);
    }

    const normalized = normalizeEntryName(name);
    const prior = seen.get(normalized);
    if (prior !== undefined) {
      throw new Error(`the workbook archive lists "${name}" twice${prior === name ? "" : ` (also as "${prior}")`} — re-save it and upload again`);
    }
    seen.set(normalized, name);

    // local header must precede the directory, be real, and its data must fit
    if (localOffset + 30 > cdOffset) throw new Error(`not a workbook: part ${name} claims its data starts inside the directory`);
    if (buf.readUInt32LE(localOffset) !== LOC) throw new Error(`not a workbook: part ${name} has no local header where its directory entry points`);
    const locNameLen = buf.readUInt16LE(localOffset + 26);
    const locExtraLen = buf.readUInt16LE(localOffset + 28);
    if (localOffset + 30 + locNameLen + locExtraLen + compressed > cdOffset) {
      throw new Error(`the workbook archive is inconsistent: part ${name} declares more data than the file holds before its directory — re-save it and upload again`);
    }

    entries.push({ name, normalized, compressed, uncompressed, method, flags, localOffset });
    p = next;
  }

  // the cursor must land exactly on the declared boundary: one byte short
  // means a record we did not inspect, one byte over means we read into
  // something else. Either way the parser and the guard would disagree.
  if (p !== cdEnd) {
    throw new Error(`the workbook archive is inconsistent: its directory declares ${cdSize} bytes but ${entriesTotal} entries account for ${p - cdOffset} — re-save it and upload again`);
  }

  let totalCompressed = 0, totalUncompressed = 0, sharedStringsBytes = 0, worksheetCount = 0, largestWorksheetBytes = 0;
  let hasMacros = false, hasExternalLinks = false;
  for (const e of entries) {
    totalCompressed += e.compressed;
    totalUncompressed += e.uncompressed;
    const lower = e.normalized;
    if (lower === "xl/sharedstrings.xml") sharedStringsBytes = e.uncompressed;
    if (/^xl\/worksheets\/sheet\d+\.xml$/.test(lower)) { worksheetCount += 1; largestWorksheetBytes = Math.max(largestWorksheetBytes, e.uncompressed); }
    if (lower.endsWith("vbaproject.bin") || lower.startsWith("xl/macrosheets/")) hasMacros = true;
    if (lower.startsWith("xl/externallinks/")) hasExternalLinks = true;
  }
  return {
    entries, totalCompressed, totalUncompressed, sharedStringsBytes, worksheetCount, largestWorksheetBytes, hasMacros, hasExternalLinks,
    centralDirectory: { offset: cdOffset, size: cdSize, declaredEntries: entriesTotal },
  };
}

/** Why the archive is refused, or null when it is within limits. */
export function zipProblem(z: ZipInspection, archiveBytes: number, limits: ZipLimits = ZIP_LIMITS): string | null {
  const mb = (n: number) => `${Math.round(n / 1024 / 1024)} MB`;
  if (archiveBytes > limits.archiveBytes) return `The workbook is ${mb(archiveBytes)} — larger than the ${mb(limits.archiveBytes)} we accept.`;
  if (z.hasMacros) return "Macro-enabled workbooks are not accepted — save it as a plain .xlsx without macros.";
  if (z.hasExternalLinks) return "The workbook links to external workbooks — break the links and upload the values.";
  if (z.entries.length > limits.entries) return `The workbook archive has ${z.entries.length} parts — more than the ${limits.entries} we accept.`;
  if (z.worksheetCount > limits.worksheets) return `The workbook has ${z.worksheetCount} sheets — more than the ${limits.worksheets} we accept.`;
  if (z.totalCompressed > archiveBytes + 1024) return "The workbook archive is inconsistent (declared sizes exceed the file) — re-save it and upload again.";
  if (z.totalUncompressed > limits.totalUncompressedBytes) return `The workbook unpacks to ${mb(z.totalUncompressed)} — more than the ${mb(limits.totalUncompressedBytes)} we accept. Split it and upload it in parts.`;
  if (z.sharedStringsBytes > limits.sharedStringsBytes) return `The workbook's shared strings unpack to ${mb(z.sharedStringsBytes)} — more than the ${mb(limits.sharedStringsBytes)} we accept.`;
  if (z.largestWorksheetBytes > limits.worksheetBytes) return `One sheet unpacks to ${mb(z.largestWorksheetBytes)} — more than the ${mb(limits.worksheetBytes)} we accept. Split the workbook.`;
  for (const e of z.entries) {
    if (e.uncompressed > limits.ratioFromBytes && e.compressed > 0 && e.uncompressed / e.compressed > limits.maxRatio) {
      return `Part ${e.name} expands ${Math.round(e.uncompressed / e.compressed)}× — the workbook looks like a compression bomb and was refused.`;
    }
  }
  return null;
}

/** One call for the upload route: inspect then judge. Throws with a user-facing message. */
export function assertWorkbookArchiveWithinLimits(buf: Buffer, limits: ZipLimits = ZIP_LIMITS): ZipInspection {
  const z = inspectXlsxZip(buf);
  const why = zipProblem(z, buf.length, limits);
  if (why) throw new Error(why);
  return z;
}

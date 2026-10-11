// Fixture Room · stored recap PDF (O2ALL-005/006, C2O-101): checks of the Unicode renderer and the store.
// No network, no database. Run (the store is server-only, so the react-server condition is set):
//   node --conditions=react-server --import tsx scripts/fixture-recap-pdf-check.ts
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { recapPdfPath, renderRecapPdf, RECAP_PDF_RENDERER, type RecapPdfSource } from "../lib/fixture-room/recap-pdf";
import { recapText } from "../lib/fixture-room/recap-model";
import { loadPdfUnicode, shapeLine, UnsupportedTextError } from "../lib/fixture-room/pdf-unicode";
import { isStorageConflict, storeRecapPdf } from "../lib/fixture-room/recap-pdf-store";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; console.log(`  ok   ${m}`); };
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

const src: RecapPdfSource = {
  recapVersionId: "11111111-1111-4111-8111-111111111111", roomId: "22222222-2222-4222-8222-222222222222",
  ref: "FX-2026-00042", versionNo: 2, roomVersion: 37, publishedAt: "2026-10-09T08:15:42.123Z", publisherLabel: "Charterer side",
  contentHash: "0123456789abcdef0123456789abcdef",
  content: {
    ref: "FX-2026-00042", status: "on_subjects", roomVersion: 37, generatedAt: "2026-10-09T08:15:42Z",
    cargo: { ref: "C-1", commodity: "Wheat (milling)", qtyMin: 25000, qtyMax: 27500, loadPort: "EGALY", dischPort: "TRMER" },
    vessel: { name: "TBN", type: "Supramax", dwt: 58000 }, counterpartyDisclosed: true,
    parties: [{ side: "cargo", capacity: "principal", label: "Charterer", name: "شركة النيل للشحن" }, { side: "vessel", capacity: "principal", label: "Owner", name: "Aegean Owners SA" }],
    terms: [
      { code: "freight", label: "Freight & terms", sortOrder: 6, status: "agreed", required: true, agreedValue: "$26.00/MT FIOST", agreedAt: null, cargoPosition: null, vesselPosition: null },
      { code: "laycan", label: "Laycan", sortOrder: 4, status: "withdrawn", required: true, agreedValue: null, agreedAt: null, cargoPosition: "05 – 12 Oct", vesselPosition: "06 – 13 Oct" },
      { code: "ld_rates", label: "Load / discharge rates", sortOrder: 5, status: "countered", required: true, agreedValue: null, agreedAt: null, cargoPosition: "8,000 / 6,000", vesselPosition: null },
    ],
    subjects: [{ seq: 1, title: "موافقة الإدارة على السفينة", status: "open", responsibleSide: "cargo", deadlineAt: "2026-10-10T12:00:00Z" }],
    brokerageTerms: { text: "1.25% address commission + 1.25% brokerage" }, listingSyncTarget: null,
  } as RecapPdfSource["content"],
};

async function textOf(bytes: Uint8Array): Promise<{ pages: number; spans: string[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const spans: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent({ includeMarkedContent: true });
    let cur = "";
    for (const it of tc.items as { type?: string; str?: string }[]) {
      if (it.type === "beginMarkedContentProps") cur = ""; else if (it.type === "endMarkedContent") spans.push(cur.replace(/​/g, "")); else if (typeof it.str === "string") cur += it.str;
    }
  }
  return { pages: doc.numPages, spans };
}
const words = (s: string) => s.replace(/[()]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");

async function main() {
  await loadPdfUnicode();
  // 1 · determinism
  const a = await renderRecapPdf(src), b = await renderRecapPdf(structuredClone(src));
  ok(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes)) === 0 && a.sha256 === b.sha256, "the same published recap renders the same bytes and SHA-256");
  const changed = await renderRecapPdf({ ...src, content: { ...src.content, terms: src.content.terms.map((t) => t.code === "freight" ? { ...t, agreedValue: "$26.25/MT FIOST" } : t) } });
  ok(changed.sha256 !== a.sha256, "a different recap gives a different digest");

  // 2 · structure
  const text = latin1(a.bytes);
  ok(text.startsWith("%PDF-1.7\n") && text.endsWith("%%EOF\n"), "PDF 1.7 header and EOF marker");
  const xrefAt = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
  const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  ok(text.slice(xrefAt, xrefAt + 5) === "xref\n" && offsets.every((o, i) => text.slice(o).startsWith(`${i + 1} 0 obj\n`)), `every cross-reference offset points at its object (${offsets.length} objects)`);
  const lengths = [...text.matchAll(/\/Length (\d+) >>\nstream\n/g)];
  ok(lengths.length > 5 && lengths.every((m) => text.slice(m.index! + m[0].length + Number(m[1]), m.index! + m[0].length + Number(m[1]) + 10) === "\nendstream"), "every stream /Length is exact");
  ok(/\/CreationDate \(D:20261009081542Z\)/.test(text) && /\/ID \[<0123456789abcdef0123456789abcdef> /.test(text) && !/ModDate/.test(text), "dates come from the publish time, the id from the content hash (no clock)");
  ok(/\/Subtype \/CIDFontType2/.test(text) && /\/FontFile2 /.test(text) && /\/CIDToGIDMap \d+ 0 R/.test(text) && /\/ToUnicode /.test(text) && /\/ActualText <FEFF/.test(text)
     && /NotoNaskhArabic-Regular/.test(text) && /NotoSans-Regular/.test(text), "fonts are embedded (Noto Sans + Naskh), with CID→GID map, ToUnicode and ActualText");

  // 3 · an independent parser reads it back: Latin exactly, Arabic word for word (no letter lost or invented)
  const t = await textOf(a.bytes);
  const all = t.spans.join("\n");
  ok(t.pages === 1 && ["Fixture Recap", "FX-2026-00042 · recap v2", "$26.00/MT FIOST", "WITHDRAWN", "Brokerage: 1.25% address commission + 1.25% brokerage", "Aegean Owners SA"].every((s) => all.includes(s)), "pdf.js opens it and reads the Latin text exactly");
  ok(["شركة النيل للشحن", "موافقة الإدارة على السفينة"].every((ar) => t.spans.some((s) => words(s) === words(ar))), "pdf.js reads the Arabic back letter for letter (shared Naskh shapes map to their own letters)");

  // 4 · nothing is ever replaced: text no embedded font can show stops the render
  let threw = false;
  try { await renderRecapPdf({ ...src, content: { ...src.content, parties: [{ side: "cargo", capacity: "principal", label: "Charterer", name: "上海航运" }, src.content.parties[1]!] } }); }
  catch (e) { threw = e instanceof UnsupportedTextError; }
  ok(threw, "text no embedded font can show stops the render (never a silent ?)");
  ok(shapeLine("EGALY → TRMER", 9, false).glyphs.every((g) => g.gid !== 0) && shapeLine("شركة (مصر)", 9, false).rtl, "symbols fall back to the Math face; an Arabic paragraph is right-to-left");

  // 5 · one canonical model: the PDF says what the stored recap text says
  ok(recapText(src.content).includes("4. Laycan: [WITHDRAWN]") && all.includes("WITHDRAWN") && !all.includes("05 – 12 Oct") && recapText(src.content).includes("Brokerage: 1.25% address commission + 1.25% brokerage"),
    "a withdrawn term shows WITHDRAWN (never its old positions) and the brokerage line matches the stored text");
  ok(!/acknowledg(ed|ement) by/i.test(all) && !/Acknowledged/.test(all), "a publish-time snapshot: no acknowledgement status in the stored file");

  // 6 · paging
  const many = { ...src, content: { ...src.content, subjects: Array.from({ length: 70 }, (_, i) => ({ seq: i + 1, title: `Subject ${i + 1} with a description that wraps across the column`, status: "open" as const, responsibleSide: null, deadlineAt: null })) } };
  const long = await textOf((await renderRecapPdf(many)).bytes);
  ok(long.pages >= 2 && long.spans.some((s) => s.includes(`page ${long.pages} of ${long.pages}`)), `a long recap pages with "page n of N" (${long.pages} pages)`);
  ok(recapPdfPath(src, a.sha256) === `${src.roomId}/recap-v2-${a.sha256}.pdf` && RECAP_PDF_RENDERER === "recap-pdf/2", "the bucket path carries the full SHA-256");

  // 7 · the store: bind first, never overwrite, verify the bytes, truthful failure
  type Call = { op: string; args?: unknown };
  const fake = (o: { upload?: { error: unknown }; download?: Buffer | null; finalizeError?: boolean; bindStatus?: string }) => {
    const calls: Call[] = [];
    const admin = {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        calls.push({ op: fn, args });
        if (fn === "fixture_recap_pdf_source") return { data: src, error: null };
        if (fn === "bind_fixture_recap_pdf") return { data: { status: o.bindStatus ?? "pending" }, error: null };
        if (fn === "finalize_fixture_recap_pdf") return o.finalizeError && args.p_stored ? { data: null, error: { message: "boom" } } : { data: { status: args.p_stored ? "stored" : "failed" }, error: null };
        if (fn === "fixture_recap_pdf_bound_paths") return { data: [recapPdfPath(src, a.sha256)], error: null };
        return { data: null, error: { message: "unknown" } };
      },
      storage: { from: () => ({
        upload: async () => { calls.push({ op: "upload" }); return o.upload ?? { error: null }; },
        download: async () => { calls.push({ op: "download" }); const d = o.download === undefined ? Buffer.from(a.bytes) : o.download; return d ? { data: new Blob([new Uint8Array(d)]), error: null } : { data: null, error: { message: "not found" } }; },
        list: async () => ({ data: [{ name: `recap-v2-${a.sha256}.pdf` }, { name: "recap-v2-stray.pdf" }], error: null }),
        remove: async (names: string[]) => { calls.push({ op: "remove", args: names }); return { error: null }; },
      }) },
    };
    return { admin: admin as never, calls };
  };
  const run = async (f: ReturnType<typeof fake>) => { try { return await storeRecapPdf(f.admin, src.recapVersionId); } catch (e) { return (e as Error).message; } };
  const order = (f: ReturnType<typeof fake>) => f.calls.map((c) => c.op).filter((x) => x !== "fixture_recap_pdf_bound_paths" && x !== "remove").join(">");
  const finalOf = (f: ReturnType<typeof fake>) => f.calls.filter((c) => c.op === "finalize_fixture_recap_pdf").map((c) => (c.args as { p_stored: boolean }).p_stored);
  let f = fake({});
  let r = await run(f);
  ok(typeof r === "object" && order(f) === "fixture_recap_pdf_source>bind_fixture_recap_pdf>upload>download>finalize_fixture_recap_pdf" && finalOf(f).join() === "true", "bind → upload → read back → stored, in that order");
  ok(f.calls.some((c) => c.op === "remove" && (c.args as string[]).join() === `${src.roomId}/recap-v2-stray.pdf`), "an unbound object in the room's folder is reconciled away; the bound file is kept");
  f = fake({ upload: { error: { statusCode: "409", message: "The resource already exists" } } });
  r = await run(f);
  ok(typeof r === "object" && finalOf(f).join() === "true", "a genuine 409 is accepted only after the existing object's bytes match");
  f = fake({ upload: { error: { statusCode: "409" } }, download: Buffer.from("not the file") });
  r = await run(f);
  ok(r === "the stored object differs from the bound file" && finalOf(f).join() === "false", "a 409 over a different (corrupt) object finalizes failed");
  f = fake({ upload: { error: { statusCode: "404", message: "Bucket not found" } } });
  r = await run(f);
  ok(typeof r === "string" && /upload refused \(404\)/.test(r) && finalOf(f).join() === "false" && !isStorageConflict({ statusCode: "404", message: "Bucket not found: resource already exists" }), "a missing bucket is never taken for a conflict");
  f = fake({ upload: { error: { statusCode: "403", message: "auth" } } });
  r = await run(f);
  ok(typeof r === "string" && finalOf(f).join() === "false", "an auth or network refusal finalizes failed with the reason");
  f = fake({ finalizeError: true });
  r = await run(f);
  ok(typeof r === "string" && /stays pending/.test(r), "upload ok but the record fails: the store throws and the record stays pending (retried on download)");
  f = fake({ bindStatus: "stored" });
  r = await run(f);
  ok(typeof r === "object" && !f.calls.some((c) => c.op === "upload"), "an already stored version is never uploaded again");

  // 8 · wiring and boundaries
  const actions = readFileSync("app/(dashboard)/dashboard/fixture-room/actions.ts", "utf8");
  const store = readFileSync("lib/fixture-room/recap-pdf-store.ts", "utf8");
  const dl = actions.split("export async function getFixtureRecapPdfAction")[1] ?? "";
  ok(!/getSupabaseAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(actions) && /if \(versionId\) await storePublishedRecapPdf\(versionId\);/.test(actions)
     && dl.indexOf('supabase.rpc("get_fixture_recap_pdf"') >= 0 && dl.indexOf('supabase.rpc("get_fixture_recap_pdf"') < dl.indexOf("issueRecapPdfLink("), "the actions never hold the service role; the store runs only after the member's own publish or room-access check");
  ok(/^import "server-only";/m.test(store) && /upsert: false/.test(store) && /RECAP_URL_SECONDS = 60/.test(store), "the store is server-only, never overwrites, and links live 60 seconds");
  const mig = readFileSync("supabase/migrations/20261009300000_fixture_recap_pdf.sql", "utf8");
  ok(/before update or delete on public\.fixture_recap_pdfs/.test(mig) && /a stored recap PDF record is never deleted/.test(mig) && /get_fixture_recap_pdf\(p_room_id uuid, p_version_no integer\)\n returns jsonb language plpgsql volatile/.test(mig)
     && /'recap-pdf'\);/.test(mig) && /grant execute on function public\.bind_fixture_recap_pdf\(uuid, text, text, integer, text\) to service_role;/.test(mig), "the record refuses UPDATE of the binding and any DELETE; the member read is volatile and logs admin reads");
  ok(createHash("sha256").update(readFileSync("assets/fonts/NotoNaskhArabic-Regular.ttf")).digest("hex") === "c34fdbd98af4dbc45ca192a23d2eeb77032add83086f5fe32957d23b3f36b221"
     && /SIL Open Font License/.test(readFileSync("assets/fonts/OFL.txt", "utf8")), "the embedded fonts are the pinned files, with their licence");

  console.log(`FIXTURE RECAP PDF CHECK: ${n} passed`);
}
main().catch((e) => { console.error(e); process.exit(1); });

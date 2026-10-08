// Fixture Room · stored recap PDF (O2ALL-005): pure checks of lib/fixture-room/pdf-writer.ts and recap-pdf.ts.
// No network, no database. Run: node --import tsx scripts/fixture-recap-pdf-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderPdf, winAnsi, wrap, LINE_CHARS, PAGE_LINES } from "../lib/fixture-room/pdf-writer";
import { recapPdfLines, recapPdfPath, renderRecapPdf, RECAP_PDF_RENDERER, type RecapPdfSource } from "../lib/fixture-room/recap-pdf";

let n = 0;
const ok = (c: boolean, m: string) => { assert.ok(c, m); n++; console.log(`  ok   ${m}`); };
const latin1 = (b: Uint8Array) => Buffer.from(b).toString("latin1");

const src: RecapPdfSource = {
  recapVersionId: "11111111-1111-4111-8111-111111111111",
  roomId: "22222222-2222-4222-8222-222222222222",
  ref: "FX-2026-00042", versionNo: 2, roomVersion: 37, publishedAt: "2026-10-09T08:15:42.123Z", publisherLabel: "Charterer side",
  contentHash: "0123456789abcdef0123456789abcdef",
  content: {
    ref: "FX-2026-00042", status: "on_subjects", roomVersion: 37, generatedAt: "2026-10-09T08:15:42Z",
    cargo: { ref: "C-1", commodity: "Wheat (milling)", qtyMin: 25000, qtyMax: 27500, loadPort: "EGALY", dischPort: "TRMER" },
    vessel: { name: "TBN", type: "Supramax", dwt: 58000 },
    counterpartyDisclosed: false,
    parties: [{ side: "cargo", capacity: "principal", label: "Charterer", name: null }, { side: "vessel", capacity: "principal", label: "Owner", name: null }],
    terms: [
      { code: "freight", label: "Freight & terms", sortOrder: 6, status: "agreed", required: true, agreedValue: "$26.00/MT FIOST", agreedAt: null, cargoPosition: null, vesselPosition: null },
      { code: "laycan", label: "Laycan", sortOrder: 4, status: "agreed", required: true, agreedValue: "05 – 12 Oct", agreedAt: null, cargoPosition: null, vesselPosition: null },
      { code: "notes", label: "Other (a \\ backslash) and (parens)", sortOrder: 7, status: "open", required: false, agreedValue: null, agreedAt: null, cargoPosition: "x", vesselPosition: "y" },
    ],
    subjects: [{ seq: 1, title: "Sub stem", status: "open", responsibleSide: "cargo", deadlineAt: "2026-10-10T12:00:00Z" }],
    brokerageTerms: null, listingSyncTarget: null,
  } as RecapPdfSource["content"],
};

// 1 · determinism: same source, same bytes, same digest
const a = renderRecapPdf(src), b = renderRecapPdf(structuredClone(src));
ok(Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes)) === 0 && a.sha256 === b.sha256 && /^[0-9a-f]{64}$/.test(a.sha256), "the same published recap renders the same bytes and SHA-256");
const changed = renderRecapPdf({ ...src, content: { ...src.content, terms: src.content.terms.map((t) => t.code === "freight" ? { ...t, agreedValue: "$26.25/MT FIOST" } : t) } });
ok(changed.sha256 !== a.sha256, "a different recap gives a different digest");

// 2 · a structurally valid PDF: header, every xref offset points at its object, startxref points at the xref
const text = latin1(a.bytes);
ok(text.startsWith("%PDF-1.4\n") && text.endsWith("%%EOF\n"), "PDF 1.4 header and EOF marker");
const xrefAt = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
ok(text.slice(xrefAt, xrefAt + 5) === "xref\n", "startxref points at the cross-reference table");
const offsets = [...text.slice(xrefAt).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
ok(offsets.length > 4 && offsets.every((o, i) => text.slice(o).startsWith(`${i + 1} 0 obj\n`)), `every cross-reference offset points at its object (${offsets.length} objects)`);
const lengths = [...text.matchAll(/<< \/Length (\d+) >>\nstream\n/g)];
ok(lengths.every((m) => text.slice(m.index! + m[0].length + Number(m[1]), m.index! + m[0].length + Number(m[1]) + 9) === "endstream"), "every stream /Length is exact");
ok(/\/CreationDate \(D:20261009081542Z\)/.test(text) && /\/ID \[<0123456789abcdef0123456789abcdef> /.test(text) && !/ModDate/.test(text), "dates come from the publish time, the id from the content hash (no clock)");

// 3 · content and escaping
ok(/\(ARAB SHIPBROKER - FIXTURE RECAP\) Tj/.test(text) && /FX-2026-00042 - recap v2/.test(text), "letterhead and reference are set");
ok(text.includes("Other \\(a \\\\ backslash\\)") && text.includes("\\(parens\\)"), "parentheses and backslashes are escaped in PDF strings");
ok(text.includes("05 \\226 12 Oct"), "an en dash is encoded as WinAnsi 0x96");
ok(!/acknowledg(ed|ement) by/i.test(text) && /Acknowledgements are recorded in the Fixture Room/.test(text), "a publish-time snapshot: no acknowledgement status in the stored file");
ok(/Charterer side/.test(text) && /withheld - via Arab ShipBroker/.test(text) && !/Charterer SA|Owners SA/.test(text), "the publisher is a side label and undisclosed parties stay withheld");

// 4 · characters the standard font cannot show are replaced and noted
const arabic = renderRecapPdf({ ...src, content: { ...src.content, parties: [{ side: "cargo", capacity: "principal", label: "Charterer", name: "شركة الشحن" }, src.content.parties[1]!] } });
ok(arabic.replaced === 9 && /Note: 9 character\\\(s\\\) outside/.test(latin1(arabic.bytes)) && arabic.sha256 !== a.sha256, "Arabic script is shown as ? (9 letters) and the file says so");
ok(winAnsi("€ “q” – — · → ×").bytes.join(",") === "128,32,147,113,148,32,150,32,151,32,183,32,45,62,32,120" && winAnsi("€").replaced === 0, "WinAnsi mapping covers the recap's punctuation; arrows are spelled ->");

// 5 · wrapping and paging
ok(wrap("a ".repeat(200).trim(), LINE_CHARS).every((l) => l.length <= LINE_CHARS) && wrap("x".repeat(LINE_CHARS * 2 + 3), LINE_CHARS).length === 3, "lines wrap at the page width; an overlong word is hard-broken");
const many = { ...src, content: { ...src.content, subjects: Array.from({ length: 90 }, (_, i) => ({ seq: i + 1, title: `Subject number ${i + 1} with a description that wraps across the column`, status: "open" as const, responsibleSide: null, deadlineAt: null })) } };
const long = renderRecapPdf(many); const lt = latin1(long.bytes);
const pages = Number(lt.match(/\/Count (\d+)/)![1]);
ok(pages >= 3 && lt.includes(`page ${pages} of ${pages}`) && lt.includes("\\(continued\\)"), `a long recap pages with a running header and "page n of N" (${pages} pages)`);
ok(recapPdfLines(src).length < PAGE_LINES, "a normal recap fits one page");

// 6 · storage naming and the writer's own determinism
ok(recapPdfPath(src, a.sha256) === `${src.roomId}/recap-v2-${a.sha256.slice(0, 16)}.pdf` && RECAP_PDF_RENDERER === "recap-pdf/1", "the bucket path is <room>/recap-v<n>-<digest prefix>.pdf");
const p1 = renderPdf([{ lines: [{ text: "x" }] }], { title: "t", createdAt: "bad date", idHex: "zz" });
ok(/D:19700101000000Z/.test(latin1(p1.bytes)) && /\/ID \[<00000000000000000000000000000000> /.test(latin1(p1.bytes)), "bad inputs degrade to fixed values, never the clock");

// 7 · wiring: publish stores, download signs after the member's own check
const actions = readFileSync("app/(dashboard)/dashboard/fixture-room/actions.ts", "utf8");
const store = readFileSync("lib/fixture-room/recap-pdf-store.ts", "utf8");
const dl = actions.split("export async function getFixtureRecapPdfAction")[1] ?? "";
ok(!/getSupabaseAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(actions) && /if \(versionId\) await storePublishedRecapPdf\(versionId\);/.test(actions)
   && dl.indexOf('supabase.rpc("get_fixture_recap_pdf"') >= 0 && dl.indexOf('supabase.rpc("get_fixture_recap_pdf"') < dl.indexOf("issueRecapPdfLink("), "the actions never hold the service role; the store runs only after the member's own publish or room-access check");
ok(/getSupabaseAdminClient\(\)/.test(store) && ["lib/fixture-room/documents.ts", "lib/fixture-room/recap-pdf.ts", "lib/fixture-room/pdf-writer.ts"].every((f) => !/getSupabaseAdminClient|SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, "utf8"))), "the service role lives only in recap-pdf-store.ts");
ok(/upsert: false/.test(store) && /RECAP_URL_SECONDS = 60/.test(store) && /createSignedUrl\(path, RECAP_URL_SECONDS/.test(store), "the file is never overwritten; links live 60 seconds");
const mig = readFileSync("supabase/migrations/20261009300000_fixture_recap_pdf.sql", "utf8");
ok(/revoke all on table public\.fixture_recap_pdfs from public, anon, authenticated, service_role;/.test(mig) && /grant execute on function public\.fixture_recap_pdf_source\(uuid\) to service_role;/.test(mig)
   && /grant execute on function public\.record_fixture_recap_pdf\(uuid, text, text, integer, text\) to service_role;/.test(mig) && /grant execute on function public\.get_fixture_recap_pdf\(uuid, integer\) to authenticated, service_role;/.test(mig)
   && /fn_can_access_fixture\(p_room_id\)/.test(mig) && /FX_CONFLICT: recap v% already has a stored PDF with a different digest/.test(mig), "private table; service-only source and record; members read only for a room they can access; set-once digest");

console.log(`FIXTURE RECAP PDF CHECK: ${n} passed`);

// PDA · paired save, history and export contract (O2ALL-008 increment A). Pure + static + a real PDF render.
//   node --conditions=react-server --import tsx scripts/pda-estimate-sets-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  parsePdaSaveSetResult,
  parsePdaSetDetail,
  parsePdaSetSummaries,
  pdaRouteSnapshot,
  pdaSetTitle,
  type PdaEstimateSetDetail,
} from "../lib/pda/estimate-sets";
import { pdaEstimateSetDocument, renderPdaEstimateSetPdf } from "../lib/pda/estimate-set-pdf";
import type { PdaRoutePreviewInput, PdaRoutePreviewResult } from "../lib/pda/route-types";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}

async function textOf(bytes: Uint8Array): Promise<string> {
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
  return spans.join("\n");
}

(async () => {
  // 1 · title and snapshot
  ok(pdaSetTitle({ loadPort: "EGALY", dischargePort: "SAJED", vesselName: " MV BALTIC STAR ", quantityMt: 26000 }) === "EGALY → SAJED · MV BALTIC STAR · 26,000 MT"
    && pdaSetTitle({ loadPort: "A", dischargePort: "B", quantityMt: 1 }) === "A → B · 1 MT", "the history title names the route, vessel and quantity");
  const input = { selection: { vesselAvailabilityId: "v", cargoId: "c", quantityMt: 26000 }, load: { portLocode: "EGALY" }, discharge: { portLocode: "SAJED" } } as unknown as PdaRoutePreviewInput;
  const result = {
    canonical: { vesselAvailabilityId: "v", vesselId: null, cargoId: "c", quantityMt: 26000, loadRequest: { secret: 1 }, dischargeRequest: { secret: 2 } },
    timeline: { loadPortDays: 3 }, transits: [], totals: { allInKnown: 2700 }, notSourced: [], allocation: "vessel", displayCurrency: "USD",
  } as unknown as PdaRoutePreviewResult;
  const snap = pdaRouteSnapshot(input, result, "MV X");
  ok(!("loadRequest" in snap.canonical) && !("dischargeRequest" in snap.canonical) && snap.routeInput === input && snap.title === "EGALY → SAJED · MV X · 26,000 MT",
    "the route snapshot carries the canonical selection and inputs; the leg requests travel separately");

  // 2 · parsing
  const list = parsePdaSetSummaries([{ id: "a", title: "T", createdAt: "2026-10-18T10:00:00Z", allInKnown: "2700.5", isLatest: true, mine: false }, { title: "no id" }, null]);
  ok(list.length === 1 && list[0]!.allInKnown === 2700.5 && list[0]!.isLatest && !list[0]!.mine && list[0]!.allInComplete === null, "summaries parse; rows without an id are dropped; numbers are coerced");
  const detail = parsePdaSetDetail({
    id: "s", title: "EGALY → SAJED", createdAt: "2026-10-18T10:00:00Z", contentHash: "a".repeat(64), isLatest: true, supersedesId: null,
    allocation: "vessel", displayCurrency: "USD", quantityMt: 26000,
    route: { loadPort: "EGALY", dischargePort: "SAJED", loadCallDate: "2026-11-01", dischargeCallDate: "2026-11-08" },
    timeline: { etaLoad: "2026-11-01T00:00:00Z", loadPortDays: 3, etdLoad: "2026-11-04T00:00:00Z", passageDays: 4, etaDischarge: "2026-11-08T00:00:00Z", dischargePortDays: 3 },
    transits: [], totals: { loadPort: 1200, dischargePort: 1500, loadPortKnown: 1200, dischargePortKnown: 1500, transit: null, allInKnown: 2700, allInComplete: null, voyageOpex: null },
    notSourced: [{ code: "canal_and_strait_transits", label: "Canal and strait transits", message: "No measured route" }],
    load: { portLocode: "EGALY", coverage: "manual_required", editionLabel: null, nativeCurrency: "USD", nativeTotal: 1200, lines: [
      { lineNo: 1, label: "Agency fee", amount: 1200, explanation: "Authorized manual quotation", manual: true, enteredBy: "Set Owner", manualReason: "Agent quote A-1", evidence: { sourceId: "00000000-0000-4000-8000-000000000032", title: "Quote" } },
    ] },
    discharge: { portLocode: "SAJED", terminalName: "ميناء جدة الإسلامي", coverage: "published", editionLabel: "Jeddah Port Tariff · v2 (from 2026-01-01)", nativeCurrency: "SAR", nativeTotal: 5625, convertedCurrency: "USD", convertedTotal: 1500, lines: [
      { lineNo: 1, label: "Port dues", amount: 5625, convertedAmount: 1500, explanation: "Per call", manual: false, evidence: { title: "Jeddah tariff 2026", page: "7" } },
    ] },
  });
  ok(!("sourceId" in detail.load.lines[0]!.evidence) && detail.load.lines[0]!.evidence.title === "Quote", "evidence keeps title/page/sheet only; the source id is dropped (C2O-120)");
  ok(parsePdaSaveSetResult({ id: "x", contentHash: "h", createdAt: "t", replayed: "true" }).replayed === false, "only a literal true counts as a replayed save");

  // 3 · the export document and the PDF
  const doc = pdaEstimateSetDocument(detail as PdaEstimateSetDetail);
  const flat = JSON.stringify(doc);
  ok(doc.meta.some(([k, v]) => k === "Fingerprint" && v === `${"a".repeat(16)}…`) && !flat.includes("00000000-0000-4000-8000-000000000032") && !flat.includes('"s"'),
    "the document shows the content fingerprint, never an internal or source id");
  ok(flat.includes("NOT SOURCED") && flat.includes("Canal and strait transits: No measured route") && flat.includes("Manual quote by Set Owner · Agent quote A-1"),
    "not-sourced items, the manual attribution and the evidence are printed");
  const a = await renderPdaEstimateSetPdf(detail as PdaEstimateSetDetail);
  const b = await renderPdaEstimateSetPdf(detail as PdaEstimateSetDetail);
  ok(a.sha256 === b.sha256 && Buffer.compare(Buffer.from(a.bytes), Buffer.from(b.bytes)) === 0, "the same saved set renders the same bytes (deterministic)");
  const text = await textOf(a.bytes);
  ok(text.includes("Port Disbursement Estimate") && text.includes("Agency fee") && text.includes("USD 1,200.00") && text.includes("SAR 5,625.00"),
    "pdf.js reads the title, the charges and the amounts back");
  ok(text.includes("ميناء جدة الإسلامي") || text.split("\n").some((l) => l.replace(/\s/g, "").includes("ميناءجدةالإسلامي".replace(/\s/g, ""))),
    "an Arabic terminal name is set exactly (Unicode engine, no replacement)");
  ok(a.bytes.length < 400_000 && /PDA EGALY-SAJED 2026-10-18\.pdf/.test(a.fileName), `fonts are subset (${Math.round(a.bytes.length / 1024)} KB) and the file is named by route and date`);

  // 3b · Opus B B2O-044: unknown is never zero, incomplete says so, the edition is printed
  const empty = { ...detail, load: { ...detail.load, coverage: "manual_required", lines: [], nativeTotal: null, editionLabel: null },
    totals: { ...detail.totals, loadPort: null, loadPortKnown: null, allInComplete: null } } as PdaEstimateSetDetail;
  const emptyDoc = JSON.stringify(pdaEstimateSetDocument(empty));
  ok(!/USD 0\.00/.test(emptyDoc) && emptyDoc.includes("Port total: NOT SOURCED (no governed line or attributed quote)") && emptyDoc.includes('["Load port","NOT SOURCED"]'),
    "a leg with nothing sourced prints NOT SOURCED, never 0.00 (B2O-044 P1-2)");
  const partial = { ...detail, totals: { ...detail.totals, dischargePort: null, dischargePortKnown: 1500 } } as PdaEstimateSetDetail;
  const partialDoc = JSON.stringify(pdaEstimateSetDocument(partial));
  ok(partialDoc.includes("USD 1,500.00 (known, incomplete)") && partialDoc.includes("native known SAR 5,625.00"),
    "an incomplete leg says \"known, incomplete\" in the totals and in its section (B2O-044 P1-2)");
  ok(flat.includes("Published tariff: Jeddah Port Tariff · v2 (from 2026-01-01)") && flat.includes("No published tariff in force"),
    "each leg names the published edition that priced it, or says none was in force (B2O-044 P1-3)");
  ok(parsePdaSetDetail({ load: { lines: [{ label: "x" }] } }).load.lines[0]!.amount === null && parsePdaSetDetail({}).load.nativeTotal === null,
    "a missing amount or total stays unknown in the model, never coerced to zero (B2O-044 P1-2)");

  // 4 · static boundaries
  const actions = readFileSync("app/(dashboard)/dashboard/ports-da/actions.ts", "utf8");
  const saveBody = actions.slice(actions.indexOf("export async function savePdaRouteEstimate"), actions.indexOf("export async function listPdaEstimateSets"));
  ok(/const route = \{ \.\.\.\(await prepareRoutePreview\(raw\)\), manualActorLabel: PDA_OWNER_MARKER \};/.test(saveBody) && /computeRouteLeg\(route, "load"\)/.test(saveBody) && /computeRouteFrame\(route\)/.test(saveBody)
    && /loadResult: load\.result/.test(saveBody), "the save recomputes every part on the server from the member's own selection; no figure comes from the page");
  ok(/savePdaEstimateSet\(getSupabaseAdminClient\(\)/.test(saveBody) && /actorId: route\.appUserId/.test(saveBody), "only the service-role save is used, with the signed-in member as the actor");
  const exportBody = actions.slice(actions.indexOf("export async function exportPdaEstimateSetPdf"));
  ok(/const \{ supabase \} = await viewer\(\);\s*const set = await getPdaEstimateSet\(supabase, setId\);/.test(exportBody) && !/getSupabaseAdminClient/.test(exportBody),
    "the export reads the saved set through the member's own session (the database decides access)");
  ok(/SET_ID\.test\(setId\)/.test(exportBody) && /SET_ID\.test\(supersedesId\)/.test(saveBody), "set ids are validated before any query");
  const migration = readFileSync("supabase/migrations/20261018120000_pda_estimate_sets.sql", "utf8");
  ok(/v_hash := encode\(sha256\(convert_to\(/.test(migration) && /p_load_result - 'generatedAt'/.test(migration), "the database computes the content hash, excluding generation instants");
  ok(/before update or delete on public\.pda_estimate_sets/.test(migration) && /PDA_IMMUTABLE/.test(migration) && /constraint pda_estimate_sets_supersedes_once unique \(supersedes_id\)/.test(migration),
    "sets are append-only and each set is superseded at most once");
  ok(/v_load := public\.pda_save_estimate\(/.test(migration) && /v_discharge := public\.pda_save_estimate\(/.test(migration), "both legs go through the existing governed pda_save_estimate");
  ok(/pg_advisory_xact_lock\(hashtext\('pda_estimate_set_owner:'/.test(migration) && /a new version must be for the same vessel and cargo/.test(migration),
    "supersedes are serialised per owner and limited to the same vessel and cargo");
  ok(/grant execute on function public\.pda_save_estimate_set\([^)]*\) to service_role;/.test(migration) && /revoke all on table public\.pda_estimate_sets from public, anon, authenticated, service_role;/.test(migration),
    "save is service-only; the table has no API grant");
  const down = readFileSync("supabase/rollback/20261018120000_pda_estimate_sets_down.sql", "utf8");
  ok(/PDA_DOWN_REFUSED/.test(down) && /history-exported:/.test(down) && !/\\(gset|if|echo|endif)\b/.test(migration + down), "the DOWN refuses to destroy saved sets without an export reference; plain SQL");
  const page = readFileSync("components/pda/PdaRouteEstimator.tsx", "utf8");
  const saved = readFileSync("components/pda/PdaSavedEstimates.tsx", "utf8");
  ok(/savePdaRouteEstimate\(input, supersedesId, expected\)/.test(saved) && !/localStorage|sessionStorage|indexedDB/.test(saved + page),
    "the page sends the inputs (and the figures it showed, for comparison only); nothing is kept in browser storage");
  ok(/lastSaved\.route === routeKey\(previewInput\)/.test(page), "a new version supersedes only a save of the same vessel, cargo and ports");
  ok(/React\.useEffect\(\(\) => \{\s*generation\.current \+= 1;\s*setState\(\{ status: "idle" \}\);/.test(saved), "an input change clears the saved state (contract: an input change invalidates any save)");
  ok(/"\/dashboard\/ports-da\/\*\*": \["\.\/assets\/fonts\/\*\*", "\.\/node_modules\/harfbuzzjs\/dist\/\*\.wasm"\]/.test(readFileSync("next.config.ts", "utf8")),
    "the PDA route ships the fonts and HarfBuzz wasm the export needs (production file tracing)");

  // 5 · Opus B B2O-044: ids, names, replay, truncate, stale answers, changed figures
  const setRead = migration.slice(migration.indexOf("create or replace function public.get_pda_estimate_set"), migration.indexOf("revoke all on function public.get_pda_estimate_set"));
  const legRead = migration.slice(migration.indexOf("create or replace function public.fn_pda_member_leg"), migration.indexOf("create or replace function public.get_pda_estimate_set"));
  ok(!/get_pda_estimate\(/.test(setRead) && /fn_pda_member_leg\(s\.load_estimate_id, s\.owner_user_id\)/.test(setRead)
    && /t - 'tariffVersionId'/.test(setRead) && /#- '\{provenance,tariffVersionId\}'/.test(setRead) && !/'routeInput', s\.route_input/.test(setRead),
    "the member read is an explicit projection: no embedded get_pda_estimate, ids stripped from transits and not-sourced, no raw route input (P1-1)");
  ok(!/'(id|ruleId|sourceId|tariffVersionId|terminalId)'/.test(legRead) && /'editionLabel', v\.edition_label/.test(legRead) && !/'input'/.test(legRead),
    "a member leg carries the edition label and no rule, source, version or terminal id, and no raw request (P1-1/P1-3)");
  ok(/when l\.entered_by_label = '@owner'/.test(legRead) && /'Deleted account'/.test(legRead) && /manualActorLabel: PDA_OWNER_MARKER/.test(saveBody),
    "a saved line records the owner marker and is attributed at read time, \"Deleted account\" after erasure (P1-4)");
  ok(/before truncate on public\.pda_estimate_sets/.test(migration), "TRUNCATE is refused as well as UPDATE and DELETE (P2-4)");
  ok(/v_existing\.owner_org_id is not distinct from p_owner_org_id/.test(migration) && /PDA_TIER: actor requires an active Subscriber/.test(migration),
    "a replay needs the same organisation, and the actor's tier is re-checked before any answer (P2-5)");
  ok(/sameFigure\(expected\.allInKnown, result\.totals\.allInKnown\)/.test(actions) && /totals=\{result\?\.totals \?\? null\}/.test(page),
    "a save whose recomputed figures differ from the preview on screen is refused, nothing saved (P2-2)");
  ok(/if \(run !== generation\.current\) return;/.test(saved) && /if \(run !== sequence\.current\) return;\s*if \(!response\.ok\) \{ setExportError/.test(saved),
    "a stale save answer or an older history page never overwrites fresher state (P2-1)");

  console.log(`PDA ESTIMATE SETS CHECK: ${n} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

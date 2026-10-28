// PDA · Tariff Packs library + pack record contract (design B2ALL-061, steps 6–7). Pure + static; no database.
//   node --import tsx scripts/pda-tariff-packs-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isPdaTariffPackRef, isoDayOrToday, packCount, parsePdaTariffPacks, resolvePdaTariffPorts, summarisePdaTariffPacks } from "../lib/pda/tariff-packs";
import { isPdaTariffPackTab, lineFigure, packHandover, packTotals, parsePdaTariffPackRecord } from "../lib/pda/tariff-pack-record";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}

const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const migration = read("supabase/migrations/20261019130000_pda_tariff_packs.sql");
const down = read("supabase/rollback/20261019130000_pda_tariff_packs_down.sql");
const suite = read("supabase/tests/pda/tariff_packs.sql");
const sdk = read("sdk/app/pda.ts");
const index = read("components/pda/PdaTariffPacks.tsx");
const recordView = read("components/pda/PdaTariffPackRecord.tsx");
const shell = read("components/pda/PdaRecordShell.tsx");
const indexPage = read("app/(dashboard)/dashboard/ports-da/tariff-packs/page.tsx");
const recordPage = read("app/(dashboard)/dashboard/ports-da/tariff-packs/[ref]/page.tsx");
const vendored = read("components/pda/ports-module.css");
const generator = read("scripts/design/vendor-ports-module-css.py");

// 1 · migration: member reads behind the estimator gate, private helper, no id or URI out
for (const fn of ["list_pda_tariff_packs", "get_pda_tariff_pack"]) {
  const body = migration.slice(migration.indexOf(`function public.${fn}(`), migration.indexOf("end $$;", migration.indexOf(`function public.${fn}(`)));
  ok(/security definer set search_path to ''/.test(body) && /fn_app_user_id\(\) is null then raise exception 'PDA_AUTH/.test(body)
    && /not public\.fn_pda_member_entitled\(\) then raise exception 'PDA_TIER/.test(body), `${fn}: definer, empty search_path, PDA_AUTH + PDA_TIER gates`);
  ok(/v\.status = 'published'/.test(body) && /s\.is_active/.test(body) && /distinct on \(s\.id\)/.test(body), `${fn}: published versions of active sets, one in force per set`);
}
ok(/revoke all on function public\.list_pda_tariff_packs\(date\) from public, anon;\ngrant execute on function public\.list_pda_tariff_packs\(date\) to authenticated, service_role;/.test(migration)
  && /revoke all on function public\.get_pda_tariff_pack\(text, date\) from public, anon;\ngrant execute on function public\.get_pda_tariff_pack\(text, date\) to authenticated, service_role;/.test(migration),
  "grants: the two reads to authenticated + service_role only");
ok(/revoke all on function public\.fn_pda_tariff_pack_ref\(uuid\) from public, anon, authenticated;/.test(migration) && !/grant execute on function public\.fn_pda_tariff_pack_ref/.test(migration),
  "the reference helper is not granted to anyone");
ok(!/source_uri|storage_path|source_filename|sha256 *,|'id',|'[a-zA-Z]+Id',/.test(migration.replace(/extensions\.digest\([^;]*'sha256'\)/, "")),
  "no source URI, storage path, file name, hash or id key is projected");
ok(/p_ref !~ '\^\[0-9a-f\]\{16\}\$'/.test(migration) && (migration.match(/PDA_VALIDATION: unknown tariff pack/g) ?? []).length === 2,
  "a malformed and an unknown reference give the same PDA_VALIDATION (no existence oracle)");
ok(/effective as \(select \* from in_force where primary_source_id = v_source\)/.test(migration), "the record picks the version in force per set BEFORE filtering by document");
ok(!/\\(gset|if|echo|endif)\b/.test(migration + down) && /drop function if exists public\.get_pda_tariff_pack\(text, date\);/.test(down)
  && /drop function if exists public\.list_pda_tariff_packs\(date\);/.test(down) && /drop function if exists public\.fn_pda_tariff_pack_ref\(uuid\);/.test(down),
  "plain SQL; the DOWN drops all three functions");
ok(["K1", "K2", "K3", "K4", "K5"].every((k) => suite.includes(`-- ${k} `) || suite.includes(`--   ${k} `)) && /rollback;\s*$/.test(suite), "suite K1–K5, rolled back");

// 2 · pure model
const packs = parsePdaTariffPacks([
  { packRef: "0123456789abcdef", authority: "APA", sourceAuthority: "official", currency: "USD", lines: 3, effectiveFrom: "2026-01-01",
    ports: [{ locode: "EGALY", name: "Alexandria", terminal: null, edition: "v1", lines: 2 }, { locode: "EGALY", name: "Alexandria", terminal: "T1", edition: "t1", lines: 1 }] },
  { packRef: "fedcba9876543210", authority: "Terminal Co", sourceAuthority: "agent", currency: "EUR", lines: 1,
    ports: [{ locode: "EGALY", name: "Alexandria", terminal: "T2", edition: "x", lines: 1 }, { locode: "EGDAM", name: "Damietta", terminal: null, edition: "d", lines: 1 }] },
  { packRef: "NOT-A-REF", authority: "dropped" },
  { packRef: "0123456789abcdef0", authority: "dropped too" },
]);
ok(packs.length === 2 && packs.every((p) => isPdaTariffPackRef(p.packRef)), "entries without a valid 16-hex reference are dropped");
const resolver = resolvePdaTariffPorts(packs);
ok(resolver.length === 2 && resolver[0]!.locode === "EGALY" && packCount(resolver[0]!) === 2 && resolver[0]!.packs.length === 3,
  "resolver: Alexandria resolves to 2 packs (a port-wide and a terminal edition of one pack count once)");
ok(JSON.stringify(summarisePdaTariffPacks(packs)) === JSON.stringify({ packs: 2, portsResolved: 2, portsWithSeveral: 1 }), "summary: packs, ports resolved, ports with several");

const record = parsePdaTariffPackRecord({
  packRef: "0123456789abcdef", authority: "APA", website: "javascript:alert(1)",
  source: { title: "APA Tariff 2026", authority: "official" },
  editions: [{ port: "EGALY", portName: "Alexandria", terminal: null, edition: "v1", version: 1, currency: "USD", supersedes: false,
    lines: [
      { code: "port_dues", label: "Port dues", basis: "per_gt", rate: "0.12", unit: "GT", minimum: 150, services: ["port_dues", "bogus"] },
      { code: "tug", label: "Tug", basis: "per_call", amount: 300 },
      { code: "q", label: "Launch", basis: "manual_quote", manual: true },
    ] }],
});
ok(record !== null && record.website === null, "a non-http(s) website is never rendered as a link");
ok(parsePdaTariffPackRecord({ website: "https://x.test" }) === null, "a record without a reference is refused");
const [dues, tug, launch] = record!.editions[0]!.lines;
ok(dues!.rate === 0.12 && dues!.services.length === 1 && lineFigure(dues!, "USD") === "USD 0.12 / GT" && lineFigure(tug!, "USD") === "USD 300" && lineFigure(launch!, "USD") === "Quoted on request",
  "numeric strings parse, unknown services drop, figures read as published");
ok(packHandover(record!).some((h) => h.input === "Vessel GT" && h.lines.includes("Port dues")) && packHandover(record!).some((h) => h.input === "A quote from the agent"),
  "the estimator handover is derived from each line's basis");
ok(packTotals(record!).lines === 3 && packTotals(record!).ports === 1, "totals count lines and ports");
ok(isPdaTariffPackTab("charges") && !isPdaTariffPackTab("admin"), "only the five record tabs are accepted from the URL");

// 3 · wiring: SDK, pages, honest empty states
ok(/rpc\("list_pda_tariff_packs", \{ p_on: on \}\)/.test(sdk) && /rpc\("get_pda_tariff_pack", \{ p_ref: packRef, p_on: on \}\)/.test(sdk)
  && /startsWith\("PDA_VALIDATION"\)\) return null/.test(sdk), "the SDK calls both RPCs; an unknown pack reads as null");
for (const [name, page] of [["index", indexPage], ["record", recordPage]] as const) {
  ok(/if \(!user\) redirect\("\/auth\/login"\)/.test(page) && /isCalculatorLocked\(tier\)/.test(page) && /isoDayOrToday\(/.test(page), `${name} page: signed-in, tier-gated, date validated`);
}
ok(/isPdaTariffPackRef\(ref\)/.test(recordPage) && /Rather than fall back to another authority's tariff/.test(recordPage), "the record page refuses a bad reference and never falls back");
ok(/Not recorded yet/.test(index) && /0 of \{pack\.lines\}/.test(index) && /none recorded/.test(index), "index: shape, verification and findings say they are not recorded");
ok(/export const NR = "Not recorded yet"/.test(shell) && /Published record/.test(shell) && !/<input|<textarea|onClick/.test(recordView + shell) && /PdaRecordShell/.test(recordView),
  "record: read-only published view on the shared RecordShell with honest empty slots");
ok(!/\b(id|Id)\b\s*[:=]\s*(record|pack|e|l)\./.test(index + recordView), "no internal id is rendered");
ok(!/<main\b/.test(index + recordView + shell + recordPage), "no nested <main> landmark");

// B2O-050 corrections
ok((migration.match(/gp\.is_active and gp\.is_verified/g) ?? []).length === 3 && (migration.match(/gt\.is_active and gt\.is_verified/g) ?? []).length === 3,
  "P1-1: every pick (list, record resolver, record editions) keeps only active + verified ports and terminals");
ok(["K6", "K7"].every((k) => suite.includes(`--   ${k} `)) && suite.includes("K6 ok") && suite.includes("K7 ok") && suite.includes("has_function_privilege('service_role', 'public.list_pda_tariff_packs(date)', 'execute')"),
  "suite: K6 governance, K7 draft/in-review/inactive-set, K5 service_role on the list read");
ok(!/@font-face/.test(vendored) && /prelude\.startswith\("@font-face"\):(\n\s*#[^\n]*)+\n\s*continue/.test(generator),
  "P1-2: the generator drops @font-face and the vendored CSS carries none");
ok(/'scope', e\.scope, 'setName', e\.set_name/.test(migration) && /\$\{e\.scope \?\? ""\}-\$\{e\.setName \?\? ""\}-\$\{e\.edition\}/.test(recordView), "P2-2: editions carry scope + set name and are keyed on them");
ok(recordView.includes('className="pp-excerpt"') && !/title=\{l\.excerpt/.test(recordView), "P2-5: excerpts are visible text, not tooltips");
ok(!/"By band"/.test(read("lib/pda/tariff-pack-record.ts")) && read("lib/pda/tariff-pack-record.ts").includes('"Bands not shown yet"'), "P2-4: tiered lines say the bands are not shown yet");
ok(isoDayOrToday("2026-06-01") === "2026-06-01" && isoDayOrToday("2026-02-31") === new Date().toISOString().slice(0, 10) && isoDayOrToday("nope") === isoDayOrToday(undefined)
  && [indexPage, recordPage].every((page) => page.includes("isoDayOrToday(") && !page.includes("ISO_DAY")), "P2-10: an impossible date falls back to today on both pages");
ok(!/K2  a superseding edition[^\n]*\n[^\n]*and back on a date before/.test(suite), "P2-1: K2's claim no longer promises a superseded version comes back");

// step 12 · Tariff Layouts: a reference without figures; 05 read from the packs, the shape never guessed
const layouts = read("components/pda/PdaTariffLayouts.tsx");
const layoutsPage = read("app/(dashboard)/dashboard/ports-da/tariff-layouts/page.tsx");
const setup = read("components/pda/PdaSetupWorkspace.tsx");
ok(layoutsPage.includes('redirect("/auth/login")') && layoutsPage.includes("isCalculatorLocked(tier)") && layoutsPage.includes("isoDayOrToday(") && layoutsPage.includes("listPdaTariffPacks(supabase, on)") && layoutsPage.includes("RecordMissing"),
  "layouts page: signed-in, tier-gated, date validated, reads the governed packs, fails honestly");
ok(!/\d+(\.\d+)?\s*\/\s*(GT|NT|tonne|m|day)|Dhs|USD\s*\d|EUR\s*\d/.test(layouts) && layouts.includes("per GT or NT, per call") && layouts.includes("a genuine zero, not a sourcing gap"),
  "section 01 shows the two shapes without any figure");
ok(layouts.includes("resolvePdaTariffPorts(packs)") && layouts.includes("not derived yet") && (layouts.match(/Not recorded yet/g) ?? []).length >= 1 && layouts.includes('SECTIONS.slice(0, 3)') && layouts.includes('SECTIONS.slice(3)'),
  "section 05 lists the ports and their packs from the database with the shape honestly empty; 02–04 and 06–07 say what they need");
ok(!/<input|<textarea|<select|onClick/.test(layouts) && layouts.includes('<nav className="pd-crumbs" aria-label="Breadcrumb">'), "the reference is read-only with breadcrumbs as a nav");
ok(["/dashboard/ports-da/hub", "/dashboard/ports-da/directory", "/dashboard/ports-da/map", "/dashboard/ports-da/tariff-layouts"].every((h) => setup.includes(`href: "${h}"`)) && setup.includes("Ports Module and reference"),
  "Setup links the hub, the directory, the map and the layouts (spec P4 reference card)");

console.log(`\nPDA tariff packs: ${n} checks passed`);

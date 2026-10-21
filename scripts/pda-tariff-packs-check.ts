// PDA · Tariff Packs library + pack record contract (design B2ALL-061, steps 6–7). Pure + static; no database.
//   node --import tsx scripts/pda-tariff-packs-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { isPdaTariffPackRef, packCount, parsePdaTariffPacks, resolvePdaTariffPorts, summarisePdaTariffPacks } from "../lib/pda/tariff-packs";
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
const indexPage = read("app/(dashboard)/dashboard/ports-da/tariff-packs/page.tsx");
const recordPage = read("app/(dashboard)/dashboard/ports-da/tariff-packs/[ref]/page.tsx");

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
  ok(/if \(!user\) redirect\("\/auth\/login"\)/.test(page) && /isCalculatorLocked\(tier\)/.test(page) && /ISO_DAY\.test/.test(page), `${name} page: signed-in, tier-gated, date validated`);
}
ok(/isPdaTariffPackRef\(ref\)/.test(recordPage) && /Rather than fall back to another authority's tariff/.test(recordPage), "the record page refuses a bad reference and never falls back");
ok(/Not recorded yet/.test(index) && /0 of \{pack\.lines\}/.test(index) && /none recorded/.test(index), "index: shape, verification and findings say they are not recorded");
ok(/const NR = "Not recorded yet"/.test(recordView) && /Published record/.test(recordView) && !/<input|<textarea|onClick/.test(recordView),
  "record: read-only published view with honest empty slots");
ok(!/\b(id|Id)\b\s*[:=]\s*(record|pack|e|l)\./.test(index + recordView), "no internal id is rendered");
ok(!/<main\b/.test(index + recordView + recordPage), "no nested <main> landmark");

console.log(`\nPDA tariff packs: ${n} checks passed`);

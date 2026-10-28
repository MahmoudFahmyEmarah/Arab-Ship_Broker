// PDA · port touch census contract (design B2ALL-061, step 11). Pure + static; no database.
//   node --import tsx scripts/pda-port-census-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { filterDirectory, maxTouches, parsePdaPortCensus, pinSize, rankedPorts, targetedCount, totalTouches, touchRole, TOUCH_ROLE_LABEL, zoneShares } from "../lib/pda/port-census";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const has = (text: string, ...needles: string[]) => needles.every((needle) => text.includes(needle));
const migration = read("supabase/migrations/20261019140000_pda_port_touch_census.sql");
const down = read("supabase/rollback/20261019140000_pda_port_touch_census_down.sql");
const suite = read("supabase/tests/pda/port_touch_census.sql");
const sdk = read("sdk/app/pda.ts");

// 1 · migration: a member read behind the estimator gate; what the boards show; small cohorts suppressed; no id
ok(/security definer set search_path to ''/.test(migration) && migration.includes("v_actor uuid := public.fn_app_user_id();") && /if v_actor is null then raise exception 'PDA_AUTH/.test(migration) && /not public\.fn_pda_member_entitled\(\) then raise exception 'PDA_TIER/.test(migration),
  "definer, empty search_path, PDA_AUTH + PDA_TIER gates");
ok(/c\.status in \('IN', 'PARTIAL'\) and c\.review_status = 'APPROVED'/.test(migration) && /a\.status = 'OPEN' and a\.review_status = 'APPROVED'/.test(migration)
  && migration.includes("(c.refreshed_at >= v_ctx.fresh_after or (v_ctx.laycan_exception and c.laycan_to is not null and c.laycan_to >= current_date))")
  && migration.includes("(a.refreshed_at >= v_ctx.fresh_after or (v_ctx.laycan_exception and a.open_date is not null and a.open_date >= current_date))")
  && !/fn_market_fresh_ok\(/.test(migration.replace(/--[^\n]*/g, ""))
  && migration.includes("join public.vessels v on v.id = a.vessel_id") && migration.includes("and not v.is_sanctioned")
  && migration.includes("select * into v_ctx from market_private.market_request_context(v_actor);")
  && migration.includes("(not coalesce(c.is_spot, false) or c.created_at::date >= v_ctx.cargo_active_from)") && migration.includes("(a.open_date is not null or a.created_at::date >= v_ctx.vessel_active_from)"),
  "only what the boards show counts: status, the boards' bulk freshness / laycan predicate from the request context (no per-row helper call), the active windows, never a sanctioned vessel (C2ALL-164 P1-2)");
ok(has(migration, "cargo_agg as (", "count(distinct listing_id) as cargo_entities", "from cargo_touches group by locode", "vessel_agg as (select locode, count(*) as vessels from vessel_touches group by locode)",
    "left join cargo_agg ca on ca.locode = p.locode", "left join vessel_agg va on va.locode = p.locode") && !/\(select count\(\*\) from cargo_touches t where t\.locode = p\.locode/.test(migration)
  && has(suite, "--   C9 ", "'C9 ok:", "if ms > 2000 then raise exception"),
  "one pass per side, grouped per port and hash-joined to the ports (no correlated subquery per port); the suite pins the runtime (C9)");
ok(has(suite, "now() - interval '400 days'", "CENSUS SANCTIONED VESSEL", "is distinct from (case when lay_exc then 3 else 0 end)", "the census must reuse fn_market_fresh_ok exactly", "laycanException"),
  "suite C3 proves stale / laycan-ahead cargo, stale / open-ahead availability, the sanctioned exclusion and the predicate equivalence");
ok(/fn_cl_effective_locode\(c\.load_port_locode, c\.load_ref_locode, c\.load_port_2_locode\)/.test(migration) && /c\.load_port_4_locode/.test(migration) && /c\.disch_port_4_locode/.test(migration)
  && /select distinct listing_id, btrim\(locode\) as locode, role from cargo_slots/.test(migration), "every load/discharge slot touches once per listing");
ok(/v_min constant int := 3/.test(migration) && /select distinct a\.vessel_id as entity_id/.test(migration) && /count\(distinct listing_id\) as cargo_entities/.test(migration)
  && /pp\.entities between 1 and v_min - 1 as suppressed/.test(migration) && /pp\.vessels between 1 and v_min - 1\) as small_cell/.test(migration)
  && (migration.match(/case when not j\.suppressed and not j\.small_cell then j\.(loads|discharges|vessels) end/g) ?? []).length === 3
  && /'touches',\s+case when not j\.suppressed then j\.total end/.test(migration),
  "the cohort counts distinct listings and vessels (1 … 2 suppressed with null counts; 0 and ≥ 3 reported); a breakdown cell of 1 … 2 withholds every cell and keeps the total");
ok(/order by case when j\.suppressed then 0 else j\.total end desc, j\.trade_name, j\.locode/.test(migration) && !/order by \(pp\.cargo_n/.test(migration),
  "suppressed ports are ordered by name among the untouched ones, never by the count they withhold");
ok(/where p\.is_active and p\.is_verified/.test(migration) && !/'id',|'[a-zA-Z]+Id',/.test(migration), "active + verified ports only; no id key projected");
ok(/revoke all on function public\.get_port_touch_census\(\) from public, anon;\ngrant execute on function public\.get_port_touch_census\(\) to authenticated, service_role;/.test(migration)
  && /drop function if exists public\.get_port_touch_census\(\);/.test(down) && !/\\(gset|if|echo|endif)\b/.test(migration + down), "grants; plain-SQL DOWN drops the function");
ok(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"].every((k) => suite.includes(`--   ${k} `) && suite.includes(`'${k} ok:`)) && /rollback;\s*$/.test(suite) && suite.includes("ALL ASSERTIONS PASSED")
  && has(suite, "o3 > o7", "(vessel_e, p6", "row5->'vessels' is distinct from 'null'::jsonb", "row9->'loads' is distinct from 'null'::jsonb", "row10->'touches' is distinct from 'null'::jsonb",
    "set local role anon;", "permission denied for function", "(row8->>'vessels')::int is distinct from 0") && !suite.includes(" <> "),
  "suite C1–C8 (breakdown withheld for a vessels AND a loads cell, distinct vessels AND listings, name order among suppressed, a zero port, anon refused as a role), NULL-safe asserts, rolled back");
ok(/rpc\("get_port_touch_census"\)/.test(sdk) && /parsePdaPortCensus\(data\)/.test(sdk), "the SDK calls the governed RPC and parses the payload");

// 2 · pure model
const census = parsePdaPortCensus({
  asOf: "2026-10-21", minimumCohort: 3,
  ports: [
    { locode: "EGALY", name: "Alexandria", country: "Egypt", zone: "E.MED", latitude: 31.2, longitude: 29.9, touches: 6, loads: 4, discharges: 0, vessels: 2, suppressed: false },
    { locode: "SAJED", name: "Jeddah", country: "Saudi Arabia", zone: "R.SEA", latitude: 21.5, longitude: 39.2, touches: 3, loads: 0, discharges: 3, vessels: 0, suppressed: false },
    { locode: "EGDAM", name: "Damietta", country: "Egypt", zone: "E.MED", latitude: 31.4, longitude: 31.8, touches: null, loads: null, discharges: null, vessels: null, suppressed: true },
    { locode: "TRIST", name: "Istanbul", country: "Türkiye", zone: "B.SEA", latitude: 41, longitude: 29, touches: 0, loads: 0, discharges: 0, vessels: 0, suppressed: false },
    { locode: "EGPSD", name: "Port Said", country: "Egypt", zone: "E.MED", latitude: 31.26, longitude: 32.3, touches: 4, loads: null, discharges: null, vessels: null, suppressed: false },
    { locode: "BAD", name: "leaks", touches: 9, loads: 9, suppressed: true },
  ],
});
ok(census.ports.length === 6 && census.ports[5]!.touches === null && census.ports[5]!.loads === null, "a suppressed port never carries a count, whatever the payload says");
ok(touchRole(census.ports[0]!) === "load" && touchRole(census.ports[1]!) === "discharge" && touchRole(census.ports[2]!) === "suppressed" && touchRole(census.ports[3]!) === "none"
  && touchRole(census.ports[4]!) === "touched" && TOUCH_ROLE_LABEL.touched.includes("withheld"), "the port's role in words, incl. a reported total whose breakdown is withheld");
const ranked = rankedPorts(census);
ok(ranked[0]!.rank === 1 && ranked[0]!.locode === "EGALY" && ranked[1]!.rank === 2 && ranked[1]!.locode === "EGPSD" && ranked.find((p) => p.locode === "EGDAM")!.rank === null && ranked.find((p) => p.locode === "TRIST")!.rank === null,
  "rank by touches (a withheld breakdown still ranks by its total); suppressed and untouched ports have no rank");
ok(targetedCount(census) === 5 && totalTouches(census) === 13, "targeted = touched or suppressed; totals add only reported counts");
ok(zoneShares(census)[0]!.zone === "E.MED" && zoneShares(census)[0]!.touches === 10 && zoneShares(census)[0]!.ports === 3, "zone shares add only reported counts");
ok(maxTouches(census) === 6 && pinSize(census.ports[0]!, 6) === 22 && pinSize(census.ports[3]!, 6) === 9 && pinSize(census.ports[2]!, 6) === 11, "pin sizes: 9 untouched, 11 suppressed, 22 at the top");
ok(filterDirectory(census, "egy", null, "rank", false).map((p) => p.locode).join(",") === "EGALY,EGPSD,EGDAM" && filterDirectory(census, "", "R.SEA", "rank", false).length === 1
  && filterDirectory(census, "", null, "name", true)[0]!.name === "Port Said", "search by name/LOCODE/country/zone, zone chips, sortable columns");

// 3 · the pages: directory, map, hub
const directory = read("components/pda/PdaPortDirectory.tsx");
const directoryPage = read("app/(dashboard)/dashboard/ports-da/directory/page.tsx");
const mapPage = read("components/pda/PdaPortsMapPage.tsx");
const mapRoute = read("app/(dashboard)/dashboard/ports-da/map/page.tsx");
const map = read("components/pda/PdaPortsMap.tsx");
const hub = read("components/pda/PdaPortsHub.tsx");
const quick = read("components/pda/PdaQuickDa.tsx");
const hubPage = read("app/(dashboard)/dashboard/ports-da/hub/page.tsx");
for (const [name, page] of [["directory", directoryPage], ["map", mapRoute], ["hub", hubPage]] as const) {
  ok(page.includes('redirect("/auth/login")') && page.includes("isCalculatorLocked(tier)") && page.includes("isoDayOrToday(") && page.includes("getPdaPortCensus(supabase)") && page.includes("RecordMissing"),
    `${name} page: signed-in, tier-gated, date validated, reads the governed census, fails honestly`);
}
ok(directory.includes('<table className="pt-lines">') && directory.includes("aria-sort={sort === c.key") && directory.includes('method="get"') && directory.includes("fewer than {census.minimumCohort}") && directory.includes("Not recorded yet")
  && directory.includes('<nav className="pd-crumbs" aria-label="Breadcrumb">'), "directory: the design's table, sortable headers with aria-sort, a GET search, suppressed ports say so, congestion/DA honest");
ok(directoryPage.includes("const ZONE = /^[A-Z][A-Z.]{1,11}$/") && directoryPage.includes("SORTS.includes(query.sort") && directoryPage.includes(".slice(0, 80)"), "directory page: zone, sort and query are validated before use");
ok(map.includes("sizes?: Readonly<Record<string, number>>") && map.includes("const base = sizes?.[port.locode] ?? (held ? 12 : 9)") && map.includes("[ports, selected, sizes]") && map.includes('const BASEMAP = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"'),
  "map: pins take a size per port and redraw when sizes change; the basemap and pin style are untouched (owner ruling)");
ok(mapPage.includes("pinSize(") && mapPage.includes("No pack yet · ask the attending agent") && mapPage.includes("Not held") && mapPage.includes("/dashboard/ports-da/ports/${port.locode}?on=${on}") && !/<input|<textarea/.test(mapPage),
  "map page: sizes by touches, the design's fallbacks, links to the record and settings, nothing typed");
ok(hub.includes('touchRole(p) === "touched" ? "breakdown withheld" : null].filter(Boolean).join(" · ")') && !hub.includes("{p.touches}× · {")
  && migration.includes("withholds ALL three cells") && migration.includes("ordered by name among the untouched ones"), "the hub row never dangles a separator and names a withheld breakdown; the migration header states the whole rule");
ok(hub.includes("export const isPdaHubArm") && hub.includes("rankedPorts(census).filter((p) => p.rank != null).slice(0, 8)") && hub.includes("/dashboard/ports-da/tariff-packs/${k.packRef}?on=${on}") && hub.includes('<nav className="pmx-arms pd-topbar__end"'),
  "hub: two arms, most touched ports (ranked, max 8), tariff coverage linking to pack records");
ok(hub.includes("touched {totalTouches(census)} time{totalTouches(census) === 1 ? \"\" : \"s\"} by live listings · reported counts only") && !/live listing\{totalTouches/.test(hub),
  "the hub's badge counts touches in those words, not listings, and says suppressed counts are left out");
ok(quick.includes('new URLSearchParams({ from: "quick" })') && quick.includes("No figure is shown here on purpose") && !/fmtUSD|toFixed|usd/i.test(quick) && quick.includes("/^\\d{1,9}$/.test(mt)"),
  "quick DA: hands over from=quick + ids + ports + quantity and prices nothing itself");
ok(has(quick, "catalogUnavailable", "Your listings could not be read", 'role="alert"') && has(hub, "catalogUnavailable={catalogUnavailable}", "catalogUnavailable: boolean")
  && hubPage.includes('catalogUnavailable={loaded.estimator.bootstrap.catalogState === "unavailable"}')
  && has(quick, 'catalogUnavailable ? "Your listings could not be read" : "No cargo of yours is live"', 'catalogUnavailable ? "Your listings could not be read" : "No vessel of yours is open"'),
  "quick DA: an unreadable catalog says so (never \"none\"), from the bootstrap's own catalogState");
ok(read("lib/pda/estimator-contract.ts").includes('["fixture", "voyage", "quick"]'), "the estimator accepts the quick hand-off source");

console.log(`\nPDA port census: ${n} checks passed`);

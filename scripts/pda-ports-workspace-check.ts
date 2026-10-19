// PDA · Ports workspace contract (O2ALL-008 increment C). Pure + static; no database.
//   node --import tsx scripts/pda-ports-workspace-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PDA_ROUTE_SERVICE_CODES } from "../lib/pda/route-types";
import {
  filterPdaPorts,
  parsePdaPortsWorkspace,
  pricedServices,
  summarisePdaPorts,
  type PdaWorkspacePort,
} from "../lib/pda/ports-workspace";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/20261018100000_pda_ports_workspace.sql");
const down = read("supabase/rollback/20261018100000_pda_ports_workspace_down.sql");
const workspace = read("components/pda/PdaPortsWorkspace.tsx");
const map = read("components/pda/PdaPortsMap.tsx");
const estimator = read("components/pda/PdaRouteEstimator.tsx");
const actions = read("app/(dashboard)/dashboard/ports-da/actions.ts");
const sdk = read("sdk/app/pda.ts");
const model = read("lib/pda/ports-workspace.ts");

// 1 · the payload parser keeps only what the page may show
const parsed = parsePdaPortsWorkspace({
  callDate: "2026-06-01",
  ports: [
    {
      locode: "EGALY", name: "Alexandria", country: "EG", zone: "E.MED", latitude: 31.2, longitude: 29.9,
      terminals: ["Terminal A", 7, null],
      tariffs: [{ scope: "port_call", terminalName: null, editionLabel: "Alexandria · v1", currency: "USD", effectiveFrom: "2026-01-01",
        effectiveTo: null, publishedAt: "2026-01-02T00:00:00Z", publisherName: "APA", publisherType: "port_authority", sourceAuthority: "official",
        ruleCount: 4, services: ["port_dues", "pilotage", "made_up", 5] }],
    },
    { locode: "TRMER", name: "Mersin", country: "TR", zone: null, latitude: null, longitude: null, terminals: [], tariffs: [] },
    { locode: "AEFJR", name: "Fujairah", country: "AE", zone: "GULF", latitude: 25.1, longitude: 56.3, terminals: ["T1"],
      tariffs: [
        { scope: "port_call", editionLabel: "FJR · v3", currency: "USD", effectiveFrom: "2026-01-01", ruleCount: 9, services: [...PDA_ROUTE_SERVICE_CODES] },
      ] },
  ],
});
ok(parsed.ports.length === 3 && parsed.callDate === "2026-06-01", "the payload parses: three ports and the call date");
ok(parsed.ports[0]!.terminals.join() === "Terminal A", "non-text terminal names are dropped");
ok(parsed.ports[0]!.tariffs[0]!.services.join() === "port_dues,pilotage", "unknown service codes are dropped, never shown as priced");
ok(parsePdaPortsWorkspace(null).ports.length === 0 && parsePdaPortsWorkspace({ ports: "x" }).ports.length === 0, "a malformed payload gives an empty list, never a crash");

// 2 · coverage, filters, ordering, summary
const [alx, mer, fjr] = parsed.ports as [PdaWorkspacePort, PdaWorkspacePort, PdaWorkspacePort];
ok(pricedServices(alx).join() === "port_dues,pilotage" && pricedServices(mer).length === 0 && pricedServices(fjr).length === 9,
  "priced services are the union of the editions in force, in canonical order");
ok(filterPdaPorts(parsed.ports, "", "all").map((p) => p.locode).join() === "AEFJR,EGALY,TRMER", "ordering: most services priced first, then name");
ok(filterPdaPorts(parsed.ports, "", "tariff").map((p) => p.locode).join() === "AEFJR,EGALY", "\"Tariff held\" shows only ports with a tariff in force");
ok(filterPdaPorts(parsed.ports, "", "gap").map((p) => p.locode).join() === "TRMER", "\"No tariff\" shows only ports without one");
ok(filterPdaPorts(parsed.ports, "apa", "all").map((p) => p.locode).join() === "EGALY" && filterPdaPorts(parsed.ports, "  tr ", "all").map((p) => p.locode).join() === "TRMER",
  "search covers name, locode, country, zone, publisher and edition, case-insensitively and trimmed");
const s = summarisePdaPorts(parsed.ports);
ok(s.ports === 3 && s.withTariff === 2 && s.fullyPriced === 1 && s.withTerminals === 2, "the header summary counts ports, tariffs held, fully priced and terminals");

// 3 · the database read
const sqlServices = migration.match(/array\[('[a-z_]+'(?:,\s*'[a-z_]+')*)\]/)?.[1]?.replace(/'/g, "").split(/,\s*/) ?? [];
ok(sqlServices.join() === PDA_ROUTE_SERVICE_CODES.join(), "the SQL service list equals PDA_ROUTE_SERVICE_CODES exactly");
ok(/jsonb_array_length\(r\.applicability->'requestedServices'\) = 1/.test(migration) && /select lower\(r\.code\) as code/.test(migration),
  "a service is priced by the rule code or a SINGLE requestedServices entry (the estimator's governedServiceCodes rule)");
ok(/fn_app_user_id\(\) is null/.test(migration) && /fn_pda_member_entitled\(\)/.test(migration), "the read is gated like list_pda_coverage (signed in, T3+/partner/admin)");
ok(/revoke all on function public\.list_pda_ports_workspace\(date\) from public, anon;/.test(migration)
  && /grant execute on function public\.list_pda_ports_workspace\(date\) to authenticated, service_role;/.test(migration),
  "grants: anon none; authenticated and service_role only");
ok(/stable security definer set search_path to ''/.test(migration) && !/\binsert\b|\bupdate\b|\bdelete\b/i.test(migration.replace(/--.*$/gm, "")),
  "the function is STABLE, SECURITY DEFINER with an empty search_path, and writes nothing");
ok(!/'(id|versionId|tariffVersionId|terminalId|publisherId|sourceId|setId)'/.test(migration), "no internal id key is built into the payload (C2O-126)");
ok(/v\.status = 'published'/.test(migration) && /v\.effective_from <= p_call_date/.test(migration) && /p\.is_active and p\.is_verified/.test(migration),
  "only published editions in force on the call date, at active and verified ports");
ok(!/\\(gset|if|echo|endif)\b/.test(migration + down) && /drop function if exists public\.list_pda_ports_workspace\(date\);/.test(down),
  "plain SQL (no psql meta-commands); the DOWN drops exactly the function");

// 4 · the page
ok(/export async function loadPdaPortsWorkspace/.test(actions) && /const \{ supabase \} = await viewer\(\);/.test(actions) && /listPdaPortsWorkspace\(supabase, day\)/.test(actions),
  "the server action reads through the member's own session after the same viewer() gate as the estimator");
ok(/rpc\("list_pda_ports_workspace", \{ p_call_date: callDate \}\)/.test(sdk) && /parsePdaPortsWorkspace\(data\)/.test(sdk), "the SDK calls the governed RPC and parses the payload");
ok(!/localStorage|sessionStorage|indexedDB/.test(workspace + map + model), "nothing is typed or kept in the browser (the prototype's stores are not authorised)");
ok(!/getSupabaseAdminClient/.test(workspace + map) && !/service_role/.test(workspace + map), "the Ports tab never touches the service role");
ok(/activeTab === "ports" \? \(\s*<PdaPortsWorkspace initialSelected=\{portsFocus\} \/>/.test(estimator), "the Ports tab renders the workspace (opened on a port when a card asks)");
ok(!/href="\/admin\/port-tariffs"/.test(estimator) && /onOpenPort=\{\(\) => openPortRecord\(loadPort\)\}/.test(estimator),
  "a port card's record link opens the Ports tab on that port, never the admin-only tariff console");
ok(/dynamic\(\(\) => import\("\.\/PdaPortsMap"\), \{\s*ssr: false/.test(workspace), "the Leaflet map loads client-only");
ok(/fittedRef\.current === ports/.test(map), "the map re-fits only when the shown ports change, never on a selection");
ok(/role="radiogroup"/.test(workspace) && /aria-checked=/.test(workspace) && /<caption className="asb-sr-only">/.test(workspace) && /aria-pressed=/.test(workspace),
  "scope filter is a radiogroup, the table has a caption, the port button reports its pressed state");
ok(/role="alert"/.test(workspace) && /Try again/.test(workspace) && /aria-busy="true"/.test(workspace), "loading, error and retry states are explicit");

console.log(`PDA PORTS WORKSPACE CHECK: ${n} passed`);

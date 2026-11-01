// PDA · Attending Agent page contract (design B2ALL-061, step 10). Pure + static; no database.
//   node --import tsx scripts/pda-agent-page-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { agencyCountries, agencyPortRows, agencyServices, findAgency, initials, isPdaAgencyHandle, safeWebsite } from "../lib/pda/agent-page";
import type { PdaAgency } from "../lib/pda/agents";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const view = read("components/pda/PdaAgentPage.tsx");
const page = read("app/(dashboard)/dashboard/ports-da/agents/[agencyId]/page.tsx");
const record = read("components/pda/PdaPortRecord.tsx");

const agents: PdaAgency[] = [
  { agencyId: "7C9E6679-7425-40DE-944B-E07FC1F90AE7", displayName: "Zeta Agency", website: "https://zeta.test/x", ports: [
    { portLocode: "EGDAM", portName: "Damietta", country: "Egypt", services: ["agency", "towage"] },
    { portLocode: "EGALY", portName: "Alexandria", country: "Egypt", services: ["agency"] },
    { portLocode: "SAJED", portName: "Jeddah", country: "Saudi Arabia", services: ["cargo_handling"] } ] },
  { agencyId: "11111111-2222-4333-8444-555555555555", displayName: "Alpha", website: "javascript:alert(1)", ports: [] },
];

ok(isPdaAgencyHandle("7c9e6679-7425-40de-944b-e07fc1f90ae7") && !isPdaAgencyHandle("zeta") && !isPdaAgencyHandle("7c9e6679"), "an agency handle is the uuid members already use to ask for quotes");
ok(findAgency(agents, "7c9e6679-7425-40de-944b-e07fc1f90ae7")?.displayName === "Zeta Agency" && findAgency(agents, "99999999-2222-4333-8444-555555555555") === null, "a handle finds its agency, case-insensitively; an unknown one finds nothing");
ok(agencyServices(agents[0]!).join(",") === "towage,cargo_handling,agency" && agencyServices(agents[1]!).length === 0, "services are the union over the ports, in the canonical order");
ok(agencyCountries(agents[0]!).join("|") === "Egypt|Saudi Arabia", "countries are distinct and sorted");
const rows = agencyPortRows(agents[0]!);
ok(rows.map((r) => r.locode).join(",") === "EGALY,EGDAM,SAJED" && rows[1]!.services === "Agency · Towage", "ports are sorted by name and carry their services in words");
ok(safeWebsite("https://zeta.test/x")?.host === "zeta.test" && safeWebsite("http://zeta.test") === null && safeWebsite("javascript:alert(1)") === null && safeWebsite(null) === null, "only an https website is ever a link (http gives null)");
ok(initials("Zeta Agency") === "ZA" && initials("x") === "X", "initials for the avatar");

ok(!/<input|<textarea|<select|onClick|aria-pressed/.test(view) && view.includes("Not recorded yet") && view.includes("quoted per call"), "the page is read-only: no owner toggle, no fee inputs; unrecorded facts say so");
ok(view.includes("{isStaff ? <Link") && view.includes('href="/dashboard/agency"') && page.includes('supabase.rpc("get_my_pda_agency")') && page.includes("isStaff = parsePdaMyAgency(mine)?.agencyId.toLowerCase() === agencyId.toLowerCase()"),
  "P2-1: the Agent Portal link shows only to the agency's own staff (the database decides), and the copy says Arab ShipBroker curates the listing");
ok(view.includes("Countries served:") && view.includes("(opens in a new tab)") && view.includes('<nav className="pd-crumbs" aria-label="Breadcrumb">') && view.includes("{PDA_ROUTE_SERVICE_CODES.length} services quoted") && view.includes("Services not yet stated"),
  "P2-2/5/6/8: countries are labelled as served, the new-tab link says so, breadcrumbs are a nav, the service count is the constant, empty cells are honest");
const order = ['className="pd-back" href="/dashboard/ports-da?tab=agents"', "/dashboard/ports-da/ports/${p.locode}", 'href="/dashboard/agency"'];
ok(order.every((t) => view.includes(t)) && view.indexOf(order[0]!) < view.indexOf(order[2]!) && view.indexOf(order[2]!) < view.indexOf(order[1]!) && !/\bof 9\b/.test(view),
  "P2-7: the links appear in the page's order (back, portal, ports); no hard-coded count");
ok(view.includes('href="/dashboard/ports-da?tab=agents"') && view.includes("/dashboard/ports-da/ports/${p.locode}"), "it links to the estimator's Agents tab and to each port record");
ok(page.includes("isPdaAgencyHandle(agencyId)") && page.includes("isoDayOrToday(") && page.includes('redirect("/auth/login")') && page.includes("isCalculatorLocked(tier)") && page.includes("Rather than fall back to another agency") && page.includes("open one from a port record"),
  "the page is gated, validates the handle and never falls back to another agency");
ok(record.includes("/dashboard/ports-da/agents/${a.agencyId}"), "the port record's attending agents link to their pages");
ok(!/\b(id|Id)\b\s*[:=]\s*(agency|p|a)\./.test(view) && !/agency\.agencyId/.test(view), "no id is rendered on the page itself");

console.log(`\nPDA agent page: ${n} checks passed`);

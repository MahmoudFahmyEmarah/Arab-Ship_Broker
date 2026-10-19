// PDA · Agents phase 1 contract (O2ALL-009). Pure + static; no database.
//   node --import tsx scripts/pda-agents-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { filterPdaAgencies, parsePdaAdminAgencies, parsePdaAgencies } from "../lib/pda/agents";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8");

// 1 · the model
const agencies = parsePdaAgencies([
  { agencyId: "a1", displayName: "Seaside Agency", website: "https://seaside.example", ports: [
    { portLocode: "EGALY", portName: "Alexandria", country: "EG", services: ["agency", "made_up", "pilotage"] },
  ] },
  { agencyId: "a2", displayName: "Bosphorus Agency", website: "javascript:alert(1)", ports: [{ portLocode: "TRMER", portName: "Mersin", country: "TR", services: [] }] },
  { agencyId: "", displayName: "No id" },
  null,
]);
ok(agencies.length === 2, "rows without an id or a name are dropped");
ok(agencies[0]!.ports[0]!.services.join() === "pilotage,agency", "unknown services are dropped; services are in the canonical order");
ok(agencies[0]!.website === "https://seaside.example" && agencies[1]!.website === null, "only an https:// website is ever kept as a link (no javascript: URLs)");
ok(filterPdaAgencies(agencies, "", null).map((a) => a.agencyId).join() === "a2,a1", "the directory is ordered by agency name");
ok(filterPdaAgencies(agencies, "", "EGALY").map((a) => a.agencyId).join() === "a1" && filterPdaAgencies(agencies, " mersin ", null).map((a) => a.agencyId).join() === "a2",
  "filters by port and searches agency, port and country names, case-insensitively");
const admin = parsePdaAdminAgencies([{ agencyId: "a1", displayName: "Seaside", status: "suspended", members: 3, ports: [
  { portLocode: "EGALY", portName: "Alexandria", services: ["agency"], status: "withdrawn" },
  { portLocode: "EGPSD", portName: "Port Said", services: ["agency"], status: "active" },
] }]);
ok(admin[0]!.status === "suspended" && admin[0]!.adminPorts.length === 2 && admin[0]!.ports.map((p) => p.portLocode).join() === "EGPSD",
  "the console keeps withdrawn listings; the member-facing view of them keeps only active ones");

// 2 · the database
const migration = read("supabase/migrations/20261018130000_pda_agencies.sql");
const down = read("supabase/rollback/20261018130000_pda_agencies_down.sql");
ok((migration.match(/perform public\.fn_pda_assert_admin_actor\(p_actor\);/g) ?? []).length === 3, "all three console functions require an owner-tier admin actor");
ok(/revoke all on table public\.pda_agencies, public\.pda_port_agents, public\.pda_agency_events from public, anon, authenticated, service_role;/.test(migration),
  "no API role holds any of the three tables");
ok(/grant execute on function public\.pda_admin_upsert_agency\(uuid, uuid, jsonb\) to service_role;/.test(migration)
  && /grant execute on function public\.pda_admin_set_port_agent\(uuid, uuid, text, text\[\], boolean\) to service_role;/.test(migration)
  && /grant execute on function public\.list_pda_port_agents\(text\) to authenticated, service_role;/.test(migration),
  "commands are service-only; the directory is a member read");
ok(/where a\.status = 'active'/.test(migration) && /pa\.status = 'active'/.test(migration) && /p\.is_active and p\.is_verified/.test(migration),
  "members see only active agencies, active listings and active verified ports");
const memberRead = migration.slice(migration.indexOf("create or replace function public.list_pda_port_agents"), migration.indexOf("create or replace function public.get_my_pda_agency"));
ok(!/'organisation'|'members'|desk_email|desk_phone|invited_by/.test(memberRead), "the member directory exposes no organisation record, member count, contact or inviter");
ok(/before update or delete on public\.pda_agency_events/.test(migration) && /insert into public\.pda_agency_events/.test(migration), "every change is logged in an append-only log");
ok(/website ~ '\^https:\/\//.test(migration) && /services <@ array\['port_dues'/.test(migration), "the database itself accepts only https websites and the nine route services");
ok(!/alter table public\.organizations|org_type/.test(migration.replace(/--.*$/gm, "")), "organizations.org_type is not changed (other modules rely on its values)");
ok(/PDA_DOWN_REFUSED/.test(down) && /registry-exported:/.test(down) && !/\\(gset|if|echo|endif)\b/.test(migration + down), "the DOWN refuses to drop a curated registry without an export reference; plain SQL");

// 3 · the console and the page
const consoleActions = read("app/(admin)/admin/port-agents/actions.ts");
const consolePage = read("app/(admin)/admin/port-agents/page.tsx");
const sections = read("lib/admin/sections.ts");
ok(/requireAdmin\(\{ section: "portagents", edit: true \}\)/.test(consoleActions) && /requireAdmin\(\{ section: "portagents" \}\)/.test(consolePage)
  && /OWNER_ONLY[^;]*portagents: true/.test(sections) && /\{ id: "portagents", href: "\/admin\/port-agents" \}/.test(sections),
  "the console is an owner-only admin section, gated on both the page and every command");
ok(/actorId: actor\.rowId/.test(consoleActions) && /pdaAdminListAgencies\(db, actor\.rowId\)/.test(consolePage), "the actor is the admin's app user row, re-checked by the database");
const agentsTab = read("components/pda/PdaAgentsWorkspace.tsx");
const estimator = read("components/pda/PdaRouteEstimator.tsx");
ok(/activeTab === "agents" \? \(\s*<PdaAgentsWorkspace initialPort=\{agentsFocus\} \/>/.test(estimator) && !/pda-route__deferred/.test(estimator),
  "the Agents tab renders the directory; no tab is a placeholder any more");
ok(/onOpenAgents=\{\(\) => openPortAgents\(loadPort\)\}/.test(estimator), "a port card opens the Agents tab filtered to that port");
ok(/coming next/.test(agentsTab) && !/localStorage|sessionStorage|indexedDB|simulat/i.test(agentsTab.replace(/^\/\/.*$/gm, "")),
  "the tab says quote requests come next instead of simulating them; nothing is kept in the browser");
ok(/rel="noopener noreferrer"/.test(agentsTab) && /target="_blank"/.test(agentsTab), "an agency website opens safely in a new tab");

// 4 · Codex C2O-159 corrections
const own = migration.slice(migration.indexOf("create or replace function public.get_my_pda_agency"));
ok(/join public\.users u on u\.id = m\.user_id and u\.is_active/.test(own) && /p\.locode = pa\.port_locode and p\.is_active and p\.is_verified/.test(own),
  "the own-agency read needs an active account (P1-1) and lists only active, verified ports");
ok(/if p_active and cardinality\(v_services\) = 0 then/.test(migration), "an active listing names at least one service (P1-2)");
ok(/pa\.status = 'active' and \(v_port is null or pa\.port_locode = v_port\)\)\n\s*\) as item/.test(migration.replace(/\r\n/g, "\n")),
  "a port filter returns only that port in each agency's ports");
const lineage = read("supabase/migrations/20261018140000_pda_estimate_set_org_lineage.sql").replace(/\r\n/g, "\n");
const lineageDown = read("supabase/rollback/20261018140000_pda_estimate_set_org_lineage_down.sql").replace(/\r\n/g, "\n");
const waveEight = read("supabase/migrations/20261018120000_pda_estimate_sets.sql").replace(/\r\n/g, "\n");
const fnOf = (t: string) => t.slice(t.indexOf("create or replace function public.pda_save_estimate_set("), t.indexOf("\n$$;\n", t.indexOf("create or replace function public.pda_save_estimate_set(")) + 5);
const undo = (t: string) => t
  .replace("  -- C2O-159 P1-5: a new version stays in its predecessor's organisation (including none); never the caller's choice\n  v_org uuid := p_owner_org_id;\n", "")
  .replace("  if p_supersedes_id is not null then\n    select s.owner_org_id into v_org from public.pda_estimate_sets s where s.id = p_supersedes_id;\n  end if;\n", "")
  .replace(/v_org/g, "p_owner_org_id");
ok(undo(fnOf(lineage)) === fnOf(waveEight), "the org-lineage body is the Wave 8 body with only the organisation derivation changed (P1-5)");
ok(fnOf(lineageDown) === fnOf(waveEight) && /grant execute on function public\.pda_save_estimate_set\(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid\) to service_role;/.test(lineage + lineageDown),
  "its DOWN restores the Wave 8 body byte for byte; the save stays service-only");

console.log(`PDA AGENTS CHECK: ${n} passed`);

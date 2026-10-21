// PDA · Port Particulars record contract (design B2ALL-061, step 8) + B2O-050 P1-3 / P2-6..9. Pure + static; no database.
//   node --import tsx scripts/pda-port-record-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  identityRows,
  isPdaPortLocode,
  isPdaPortRecordTab,
  packRefFor,
  pdaInputRows,
  portAgents,
  portAuthority,
  portPacks,
  portRecordMeta,
  tariffBindingRows,
  terminalRows,
} from "../lib/pda/port-record";
import type { PdaWorkspacePort } from "../lib/pda/ports-workspace";
import type { PdaTariffPack } from "../lib/pda/tariff-packs";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const view = read("components/pda/PdaPortRecord.tsx");
const shell = read("components/pda/PdaRecordShell.tsx");
const page = read("app/(dashboard)/dashboard/ports-da/ports/[locode]/page.tsx");
const workspace = read("components/pda/PdaPortsWorkspace.tsx");
const portal = read("components/pda/PdaAgentPortal.tsx");
const setup = read("components/pda/PdaSetupWorkspace.tsx");

const port: PdaWorkspacePort = {
  locode: "EGALY", name: "Alexandria", country: "Egypt", zone: "E.MED", latitude: 31.2001, longitude: 29.9187, terminals: ["Terminal A", "Terminal B"],
  tariffs: [
    { scope: "port_call", terminalName: null, editionLabel: "APA v1", currency: "USD", effectiveFrom: "2026-01-01", effectiveTo: null, publishedAt: "2026-01-02T00:00:00Z",
      publisherName: "Alexandria Port Authority", publisherType: "port_authority", sourceAuthority: "official", ruleCount: 4, services: ["port_dues", "pilotage"] },
    { scope: "terminal", terminalName: "Terminal A", editionLabel: "TA v1", currency: "USD", effectiveFrom: "2026-01-01", effectiveTo: null, publishedAt: null,
      publisherName: "Terminal Co", publisherType: "terminal", sourceAuthority: "agent", ruleCount: 1, services: ["cargo_handling"] },
  ],
};
const packs: PdaTariffPack[] = [
  { packRef: "0123456789abcdef", authority: "Alexandria Port Authority", publisherType: "port_authority", country: "Egypt", sourceTitle: "APA 2026", sourceAuthority: "official",
    issueDate: null, currency: "USD", effectiveFrom: "2026-01-01", lines: 4, ports: [{ locode: "EGALY", name: "Alexandria", terminal: null, edition: "APA v1", lines: 4 }] },
  { packRef: "fedcba9876543210", authority: "Terminal Co", publisherType: "terminal", country: null, sourceTitle: "TA", sourceAuthority: "agent",
    issueDate: null, currency: "USD", effectiveFrom: "2026-01-01", lines: 1, ports: [{ locode: "EGALY", name: "Alexandria", terminal: "Terminal A", edition: "TA v1", lines: 1 }, { locode: "EGDAM", name: "Damietta", terminal: null, edition: "x", lines: 2 }] },
];
const agents = [
  { agencyId: "a", displayName: "Zeta Agency", website: "https://zeta.test", ports: [{ portLocode: "EGALY", portName: "Alexandria", country: "Egypt", services: ["agency" as const, "towage" as const] }] },
  { agencyId: "b", displayName: "Alpha Agency", website: null, ports: [{ portLocode: "EGDAM", portName: "Damietta", country: "Egypt", services: ["agency" as const] }] },
];

// 1 · pure model
ok(isPdaPortLocode("EGALY") && isPdaPortLocode("XXA1B") && !isPdaPortLocode("egaly") && !isPdaPortLocode("EGAL") && !isPdaPortLocode("EG ALY"), "a LOCODE is two letters + three letters/digits");
ok(isPdaPortRecordTab("costs") && !isPdaPortRecordTab("admin"), "only the five record tabs are accepted from the URL");
ok(portPacks(packs, "EGALY").length === 2 && portPacks(packs, "EGDAM").length === 1 && portPacks(packs, "NLRTM").length === 0, "the packs that price a port");
ok(packRefFor(packs, "EGALY", port.tariffs[0]!) === "0123456789abcdef" && packRefFor(packs, "EGALY", port.tariffs[1]!) === "fedcba9876543210", "each edition resolves to the pack that lists its port + terminal");
ok(packRefFor(packs, "EGALY", { ...port.tariffs[1]!, terminalName: "Terminal B" }) === null, "an edition no pack lists resolves to no link, never to another pack");
const rows = portAgents(agents, "EGALY");
ok(rows !== null && rows.length === 1 && rows[0]!.name === "Zeta Agency" && rows[0]!.services.join("|") === "Agency|Towage" && portAgents(null, "EGALY") === null,
  "attending agents are those listed at the port, with their services; an unreadable registry is null, not empty");
ok(portAuthority(port) === "Alexandria Port Authority" && portAuthority({ ...port, tariffs: [port.tariffs[1]!] }) === null, "the port authority is named only from a port-wide tariff of a port authority");
ok(identityRows(port).find((r) => r[0] === "UN/LOCODE")?.[1] === "EGALY" && identityRows(port).find((r) => r[0] === "ISPS facility number")?.[1] === null, "identity: what the registry holds; the rest is an honest empty slot");
ok(terminalRows(port).length === 2 && terminalRows(port)[0]![4] === "TA v1" && terminalRows(port)[1]![4] === "port-wide tariff applies", "terminals name the edition that prices them, or say the port-wide tariff applies");
const binding = tariffBindingRows(port, packs);
ok(binding.length === 2 && binding[0]!.scope === "Port-wide" && binding[0]!.packRef === "0123456789abcdef" && binding[1]!.scope === "Terminal A" && binding[1]!.services === "Cargo handling", "tariff binding rows: scope, services and the pack link");
ok(pdaInputRows(port).find((r) => r[0] === "Compulsory services")?.[1]?.includes("Port dues") && pdaInputRows(port).find((r) => r[0] === "Waiting days")?.[1] === null, "PDA inputs: derived where a tariff says so, empty otherwise");
const meta = portRecordMeta({ port, packs, agents, on: "2026-06-01" });
ok(meta.find((m) => m.k === "Charge lines")?.v === "5" && meta.find((m) => m.k === "Services priced")?.v === "3 of 9" && meta.find((m) => m.k === "Attending agents")?.v === "1"
  && portRecordMeta({ port, packs, agents: null, on: "2026-06-01" }).find((m) => m.k === "Attending agents")?.empty === true, "head meta: lines, services priced, agents (empty when unreadable)");

// 2 · the view and page
ok(/PdaRecordShell/.test(view) && !/<input|<textarea|onClick/.test(view) && /Not recorded yet|NR/.test(view + shell), "the record is a read-only published view on the shared shell");
ok(/isPdaPortLocode\(locode\)/.test(page) && /Rather than fall back to another port/.test(page) && /isCalculatorLocked\(tier\)/.test(page) && /redirect\("\/auth\/login"\)/.test(page) && page.includes("isoDayOrToday("),
  "the page is gated, validates the code and the date, and never falls back to another port");
ok(/catch \{\n\s*agents = null;/.test(read("app/(dashboard)/dashboard/ports-da/ports/[locode]/load.ts")) && page.includes("loadPortRecordInput("), "an unreadable agency registry (pre-Wave 9) leaves the section honest instead of failing the page");
ok(!/\b(id|Id)\b\s*[:=]\s*(port|pack|agency|a|e)\./.test(view), "no internal id is rendered");

// 3 · B2O-050 P1-3: the slide-over is a real modal
ok(workspace.includes('aria-modal="true"') && workspace.includes('event.key === "Escape"') && workspace.includes("closeButton.current?.focus()") && workspace.includes("opener?.focus()")
  && workspace.includes('event.key !== "Tab"') && workspace.includes('href={`/dashboard/ports-da/ports/${port.locode}`}'),
  "P1-3: focus moves in on open, Tab is trapped, Escape closes, focus returns to the opener, and the record page is one link away");

// 4 · B2O-050 P2-6..9
ok(portal.includes('? "expired" : "awaiting response"') && portal.includes("Date.parse(request.expiresAt) < Date.now()"), "P2-6: an expired request reads as expired");
ok(!/role="tab"/.test(portal) && !/role="tablist"/.test(portal) && (portal.match(/aria-pressed=/g) ?? []).length >= 2, "P2-7: the view and tab switches are pressed buttons, not an incomplete tab widget");
ok(!/<label>/.test(portal) && (portal.match(/className="ap-field__k"/g) ?? []).length >= 5, "P2-8: read-only fields use a span key, never a <label> without a control");
ok(/<h2 id="pda-setup-title" className="pe-set-card__t">/.test(setup) && /<h2 className="pe-set-card__t">Port database and tariffs<\/h2>/.test(setup), "P2-9: Setup cards are headed by h2s");

console.log(`\nPDA port record: ${n} checks passed`);

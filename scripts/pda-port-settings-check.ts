// PDA · Port Settings contract (design B2ALL-061, step 9). Pure + static; no database.
//   node --import tsx scripts/pda-port-settings-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { PDA_SETTING_ARMS, isPdaSettingArm, settingValue, tariffArmPacks, tariffArmRows } from "../lib/pda/port-settings";
import type { PdaPortRecordInput } from "../lib/pda/port-record";
import type { PdaWorkspacePort } from "../lib/pda/ports-workspace";
import type { PdaTariffPack } from "../lib/pda/tariff-packs";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const view = read("components/pda/PdaPortSettings.tsx");
const page = read("app/(dashboard)/dashboard/ports-da/ports/[locode]/settings/page.tsx");
const recordPage = read("app/(dashboard)/dashboard/ports-da/ports/[locode]/page.tsx");
const loader = read("app/(dashboard)/dashboard/ports-da/ports/[locode]/load.ts");
const record = read("components/pda/PdaPortRecord.tsx");

const port: PdaWorkspacePort = {
  locode: "EGALY", name: "Alexandria", country: "Egypt", zone: "E.MED", latitude: null, longitude: null, terminals: ["Terminal A"],
  tariffs: [
    { scope: "port_call", terminalName: null, editionLabel: "APA v1", currency: "USD", effectiveFrom: "2026-01-01", effectiveTo: null, publishedAt: null, publisherName: "APA", publisherType: "port_authority", sourceAuthority: "official", ruleCount: 4, services: ["port_dues", "cargo_handling"] },
  ],
};
const packs: PdaTariffPack[] = [{ packRef: "0123456789abcdef", authority: "APA", publisherType: "port_authority", country: "Egypt", sourceTitle: "APA 2026", sourceAuthority: "official",
  issueDate: null, currency: "USD", effectiveFrom: "2026-01-01", lines: 4, ports: [{ locode: "EGALY", name: "Alexandria", terminal: null, edition: "APA v1", lines: 4 }] }];
const agents = [{ agencyId: "a", displayName: "Zeta Agency", website: null, ports: [{ portLocode: "EGALY", portName: "Alexandria", country: "Egypt", services: ["agency" as const] }] }];
const input: PdaPortRecordInput = { port, packs, agents, on: "2026-06-01" };

// 1 · the model mirrors the design: four arms, every design slot named once
ok(PDA_SETTING_ARMS.map((a) => a.id).join(",") === "stay,working,verify,tariff" && isPdaSettingArm("verify") && !isPdaSettingArm("edit"), "four arms; only those are accepted from the URL");
const paths = PDA_SETTING_ARMS.flatMap((a) => a.sections.flatMap((s) => s.slots.map((x) => x.path)));
ok(paths.length === 16 && new Set(paths).size === 16 && ["stay.rule", "stay.fixedDays", "stay.turnDays", "stay.graceDays", "overstay.action", "overstay.notifyAgent", "overstay.perDayUSD",
  "working.gangsPerHatch", "working.shiftsPerDay", "working.shiftHours", "working.overtime", "shifts.included", "agentId", "verify.whoMayFill", "verify.requireBasis", "verify.autoSupersede"].every((p) => paths.includes(p)),
  "the sixteen design slots, each named once");

// 2 · values: only what the records answer; everything else honestly empty
const slot = (path: string) => PDA_SETTING_ARMS.flatMap((a) => a.sections.flatMap((s) => s.slots)).find((x) => x.path === path)!;
ok(settingValue(slot("agentId"), input).value === "Zeta Agency" && settingValue(slot("agentId"), input).source === "registry", "the proposed agent comes from the agency registry");
ok(settingValue(slot("agentId"), { ...input, agents: null }).value === null && settingValue(slot("agentId"), { ...input, agents: [] }).value === null, "no registry, or no agency listed, is an empty slot");
ok(settingValue(slot("working.overtime"), input).source === "tariff" && settingValue(slot("working.overtime"), { ...input, port: { ...port, tariffs: [] } }).value === null, "working-pattern slots point at the tariff only when it prices cargo handling");
ok(["stay.rule", "stay.fixedDays", "overstay.perDayUSD", "verify.requireBasis"].every((p) => settingValue(slot(p), input).value === null), "stay, trigger and access rules are not recorded anywhere yet");
const rows = tariffArmRows(port, packs);
ok(rows.find((r) => r[0] === "Priced by")?.[1] === "APA" && rows.find((r) => r[0] === "Charge lines")?.[1]?.startsWith("4 in all · 2 of 9") && rows.find((r) => r[0] === "Amendments")?.[1] === null,
  "the tariff arm names the authority, counts lines and priced services, and leaves amendments empty");
ok(tariffArmPacks(port, packs)[0]?.packRef === "0123456789abcdef" && tariffArmRows({ ...port, tariffs: [] }, []).find((r) => r[0] === "Priced by")?.[1] === null, "each pack links to its record; no tariff means no authority");

// 3 · the view and pages
ok(!/<input|<textarea|<select|onClick/.test(view) && view.includes("Not recorded yet") && view.includes('className="ps-arms"') && view.includes("aria-current"), "a read-only page on the design's ps-* structure, arms as links");
ok(page.includes("isPdaSettingArm(query.arm)") && page.includes("isoDayOrToday(") && page.includes('redirect("/auth/login")') && page.includes("isCalculatorLocked(tier)") && page.includes("Rather than fall back to another port"),
  "the settings page is gated, validates arm and date, and never falls back to another port");
ok(recordPage.includes("loadPortRecordInput(") && page.includes("loadPortRecordInput(") && loader.includes('return { kind: "missing" }') && loader.includes("agents = null"), "both per-port pages share one loader with honest missing/failed states");
ok(record.includes("/settings?on=${on}") && view.includes("Port record"), "the record links to its settings and the settings link back");
ok(!/\b(id|Id)\b\s*[:=]\s*(port|pack|k|a)\./.test(view), "no internal id is rendered");

console.log(`\nPDA port settings: ${n} checks passed`);

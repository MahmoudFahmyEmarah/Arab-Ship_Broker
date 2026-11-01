// PDA · the Port Settings model (design B2ALL-061, build step 9): the background behind the estimate, one page per port.
//
// The design names every slot once (stay and triggers, working pattern, third parties, the tariff arm). No settings
// store exists yet, so a slot is filled only when the port's tariffs or the agency registry already answer it; every
// other slot says "Not recorded yet" and keeps the design's explanation of what it is for. Pure, shared with the check.
import { PDA_SERVICE_LABELS, pricedServices, type PdaWorkspacePort } from "./ports-workspace";
import { PDA_ROUTE_SERVICE_CODES } from "./route-types";
import { portAgents, portPacks, type PdaPortRecordInput } from "./port-record";
import type { PdaTariffPack } from "./tariff-packs";

export interface PdaSettingSlot { path: string; label: string; unit?: string; help?: string }
export interface PdaSettingSection { id: string; label: string; slots: PdaSettingSlot[] }
export interface PdaSettingArm { id: "stay" | "working" | "verify" | "tariff"; label: string; hint: string; sections: PdaSettingSection[] }

export const PDA_SETTING_ARMS: readonly PdaSettingArm[] = [
  {
    id: "stay", label: "Stay & triggers",
    hint: "What the agreed stay is, and what happens when the ship stays longer. The estimator's Days of stay is measured against this.",
    sections: [
      { id: "agreed", label: "The agreed stay", slots: [
        { path: "stay.rule", label: "How the agreed stay is set", help: "From the cargo means quantity ÷ the agreed load or discharge rate, plus a turn day. Where the record's rate is not a usable MT/day figure the standing days are used and the estimator says so." },
        { path: "stay.fixedDays", label: "Standing days", unit: "days", help: "Used when the rule is standing days, and as the fallback when a cargo rate cannot be worked." },
        { path: "stay.turnDays", label: "Turn allowance", unit: "days", help: "Berthing, draft survey, formalities and shifting, added to the worked days." },
      ] },
      { id: "trigger", label: "When the stay runs long", slots: [
        { path: "stay.graceDays", label: "Grace before the trigger fires", unit: "days" },
        { path: "overstay.action", label: "What the trigger does", help: "Flagging re-runs the tariff at the agreed stay and reports every line whose figure moved." },
        { path: "overstay.notifyAgent", label: "Offer to notify the agent" },
        { path: "overstay.perDayUSD", label: "Flat extra-day charge", unit: "USD / day", help: "Only where the port bills a standing amount per day past the agreed stay. Leave empty where the tariff's own per-day lines already do it." },
      ] },
    ],
  },
  {
    id: "working", label: "Working pattern",
    hint: "How the port works cargo. Facts the handling flow needs. Handling money is never held here: it comes from the tariff, then a stevedore's quote, then nothing.",
    sections: [
      { id: "pattern", label: "Gangs and shifts", slots: [
        { path: "working.gangsPerHatch", label: "Gangs per hatch", unit: "gangs" },
        { path: "working.shiftsPerDay", label: "Shifts per day", unit: "shifts" },
        { path: "working.shiftHours", label: "Hours per shift", unit: "hours" },
        { path: "working.overtime", label: "Overtime and weekend rule", help: "Priced by the port tariff, priced in the stevedore's quote, or not worked. A cargo-handling line on the pack record does not state it; only a rule that names overtime does." },
      ] },
      { id: "shifts", label: "Berth shifting", slots: [
        { path: "shifts.included", label: "Shifts inside the berthing charge", unit: "shifts", help: "Each further shift is priced by the tariff's own shifting line where it has one. Where it has none the estimate says so. A cargo-handling line does not state the shifts included." },
      ] },
    ],
  },
  {
    id: "verify", label: "Third parties",
    hint: "Who may fill or correct a figure at this port. Agents and stevedores are the two poles: they verify and quote, and earn their listing by it.",
    sections: [
      { id: "access", label: "Access", slots: [
        { path: "agentId", label: "Agent proposed on the estimate", help: "The agencies Arab ShipBroker lists at this port; the estimator's Agents tab asks them for quotes." },
        { path: "verify.whoMayFill", label: "Who may fill a slot", help: "Attending agent, port authority, stevedoring company or terminal operator." },
        { path: "verify.requireBasis", label: "A basis is required with every submission" },
        { path: "verify.autoSupersede", label: "Accepting a figure supersedes the one before it" },
      ] },
    ],
  },
  {
    id: "tariff", label: "Tariff",
    hint: "Which published tariff pack prices this port, and where its rates are amended.",
    sections: [],
  },
];
export type PdaSettingArmId = PdaSettingArm["id"];
export const isPdaSettingArm = (v: unknown): v is PdaSettingArmId => PDA_SETTING_ARMS.some((a) => a.id === v);

export interface PdaSettingValue { value: string | null; source: "registry" | "tariff" | null }

/** What the port's own records already answer for a slot; everything else is honestly empty. */
export function settingValue(slot: PdaSettingSlot, input: PdaPortRecordInput): PdaSettingValue {
  if (slot.path === "agentId") {
    const rows = portAgents(input.agents, input.port.locode);
    if (rows === null) return { value: null, source: null };
    return rows.length ? { value: rows.map((r) => r.name).join(" · "), source: "registry" } : { value: null, source: null };
  }
  // every other slot (stay, triggers, working pattern, access rules) has no store yet; a tariff's cargo-handling line
  // does not answer shifts or overtime, so nothing here is ever shown as answered without a rule that states it
  return { value: null, source: null };
}

export type Row = [string, string | null];

/** The tariff arm: the packs that price the port, read from the tariffs in force. */
export function tariffArmRows(port: PdaWorkspacePort, packs: readonly PdaTariffPack[]): Row[] {
  const here = portPacks(packs, port.locode);
  const currencies = [...new Set(port.tariffs.map((t) => t.currency))];
  const lines = port.tariffs.reduce((n, t) => n + t.ruleCount, 0);
  const priced = pricedServices(port);
  return [
    ["Priced by", here.length === 0 ? null : here.length === 1 ? here[0]!.authority : `${here.length} authorities`],
    ["Local currency", currencies.length ? `${currencies.join(" / ")} · peg and indicative rate not held` : null],
    ["Charge lines", lines ? `${lines} in all · ${priced.length} of ${PDA_ROUTE_SERVICE_CODES.length} services priced (${priced.map((s) => PDA_SERVICE_LABELS[s]).join(", ")})` : null],
    ["Amendments", null],
  ];
}

export interface PdaTariffArmPack { authority: string; detail: string; packRef: string }
export function tariffArmPacks(port: PdaWorkspacePort, packs: readonly PdaTariffPack[]): PdaTariffArmPack[] {
  return portPacks(packs, port.locode).map((k) => {
    const mine = k.ports.filter((p) => p.locode === port.locode);
    const lines = mine.reduce((n, p) => n + p.lines, 0);
    return { authority: k.authority, detail: `${lines} line${lines === 1 ? "" : "s"} · ${k.currency === "mixed" ? "mixed currencies" : k.currency}${mine.some((p) => p.terminal) ? ` · ${mine.filter((p) => p.terminal).map((p) => p.terminal).join(", ")}` : ""}`, packRef: k.packRef };
  });
}

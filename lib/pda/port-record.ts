// PDA · the Port Particulars record model (design B2ALL-061, build step 8).
//
// ONE record per port, read-only, composed from reads that already exist: the port and its tariffs in force
// (list_pda_ports_workspace), the packs that price it (list_pda_tariff_packs) and the agencies listed at it
// (list_pda_port_agents). No port-record store exists yet, so every other slot of the design's 13 sections is an
// honest "Not recorded yet". Pure helpers, shared by the page and the contract check.
import type { PdaAgency } from "./agents";
import { PDA_SERVICE_LABELS, pricedServices, type PdaWorkspacePort, type PdaWorkspaceTariff } from "./ports-workspace";
import { PDA_ROUTE_SERVICE_CODES } from "./route-types";
import type { PdaTariffPack } from "./tariff-packs";

export const PDA_PORT_RECORD_TABS = [
  { id: "particulars", label: "Particulars" },
  { id: "operations", label: "Operations" },
  { id: "costs", label: "Costs" },
  { id: "commercial", label: "Commercial" },
  { id: "sources", label: "Sources" },
] as const;
export type PdaPortRecordTab = (typeof PDA_PORT_RECORD_TABS)[number]["id"];
export const isPdaPortRecordTab = (v: unknown): v is PdaPortRecordTab => PDA_PORT_RECORD_TABS.some((t) => t.id === v);

/** UN/LOCODE: two letters (country) + three letters or digits (place). */
export const isPdaPortLocode = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{2}[A-Z0-9]{3}$/.test(v);

export interface PdaPortRecordInput {
  port: PdaWorkspacePort;
  packs: PdaTariffPack[];
  /** null when the agency registry could not be read (it ships with Wave 9) */
  agents: PdaAgency[] | null;
  on: string;
}

export type Row = [string, string | null];

/** The packs whose in-force edition prices this port (any terminal). */
export const portPacks = (packs: readonly PdaTariffPack[], locode: string) => packs.filter((k) => k.ports.some((p) => p.locode === locode));

/** The pack reference behind one tariff edition, or null when no pack lists that port/terminal pairing. */
export function packRefFor(packs: readonly PdaTariffPack[], locode: string, tariff: PdaWorkspaceTariff): string | null {
  const pack = packs.find((k) => k.ports.some((p) => p.locode === locode && p.terminal === tariff.terminalName && (!p.edition || p.edition === tariff.editionLabel)));
  return pack?.packRef ?? null;
}

export interface PdaPortAgentRow { name: string; website: string | null; services: string[] }

/** The agencies listed at this port, with the services each quotes there. */
export function portAgents(agents: readonly PdaAgency[] | null, locode: string): PdaPortAgentRow[] | null {
  if (!agents) return null;
  return agents
    .map((a) => ({ a, at: a.ports.find((p) => p.portLocode === locode) }))
    .filter((x): x is { a: PdaAgency; at: NonNullable<ReturnType<PdaAgency["ports"]["find"]>> } => !!x.at)
    .map(({ a, at }) => ({ name: a.displayName, website: a.website, services: at.services.map((s) => PDA_SERVICE_LABELS[s]) }))
    .sort((x, y) => x.name.localeCompare(y.name));
}

const coords = (port: PdaWorkspacePort) => (port.latitude != null && port.longitude != null ? `${port.latitude.toFixed(4)}, ${port.longitude.toFixed(4)}` : null);

/** The only port authority we can name: the publisher of a port-wide tariff in force whose publisher is a port authority. */
export function portAuthority(port: PdaWorkspacePort): string | null {
  return port.tariffs.find((t) => t.terminalName === null && t.publisherType === "port_authority")?.publisherName ?? null;
}

export function identityRows(port: PdaWorkspacePort): Row[] {
  return [
    ["Port name", port.name],
    ["Port facility name", null],
    ["Port ID number", null],
    ["ISPS facility number", null],
    ["UN/LOCODE", port.locode],
    ["Country / flag state", port.country],
    ["Region · ASB zone", port.zone],
    ["Port authority / owner", portAuthority(port)],
  ];
}

export function positionRows(port: PdaWorkspacePort): Row[] {
  return [
    ["Latitude / longitude", coords(port)],
    ["Time zone", null],
    ["Admiralty / BA charts", null],
    ["Water density", null],
    ["Tidal range", null],
    ["Port VHF channels", null],
  ];
}

export const REGIME_SLOTS = ["Port working days & hours", "Port security level (ISPS)", "Pilotage compulsory", "Pilot availability", "Pilot station → berth", "Night navigation", "Public holidays observed", "Free pratique procedure"] as const;
export const regimeRows = (): Row[] => REGIME_SLOTS.map((k) => [k, null]);

export const MARKET_SLOTS = ["Congestion level", "Average waiting", "Indicative DA range", "Calls last 12 months"] as const;
export const marketRows = (): Row[] => MARKET_SLOTS.map((k) => [k, null]);

/** Terminals as the Ports workspace lists them (verified terminals); the operator, type and sizes are not recorded. */
export function terminalRows(port: PdaWorkspacePort): Array<[string, string | null, string | null, string | null, string]> {
  return port.terminals.map((name) => {
    const editions = port.tariffs.filter((t) => t.terminalName === name);
    return [name, null, null, null, editions.length ? editions.map((t) => t.editionLabel).join(" · ") : "port-wide tariff applies"];
  });
}

export interface PdaTariffBindingRow { edition: string; scope: string; publisher: string | null; currency: string; period: string; lines: number; services: string; packRef: string | null }

export function tariffBindingRows(port: PdaWorkspacePort, packs: readonly PdaTariffPack[]): PdaTariffBindingRow[] {
  return port.tariffs.map((t) => ({
    edition: t.editionLabel,
    scope: t.terminalName ?? "Port-wide",
    publisher: t.publisherName,
    currency: t.currency,
    period: `${t.effectiveFrom}${t.effectiveTo ? ` → ${t.effectiveTo}` : " → open"}`,
    lines: t.ruleCount,
    services: t.services.map((s) => PDA_SERVICE_LABELS[s]).join(" · "),
    packRef: packRefFor(packs, port.locode, t),
  }));
}

/** The design's "PDA inputs" handover: what Arm 1 actually reads, and where it comes from today. */
export function pdaInputRows(port: PdaWorkspacePort): Array<[string, string | null, string]> {
  const priced = pricedServices(port);
  const terminalEditions = port.tariffs.filter((t) => t.terminalName).length;
  return [
    ["Max draught / parcel limit", null, "Vessel fit and part-cargo checks"],
    ["Load & discharge rate", null, "Days alongside"],
    ["Waiting days", null, "Days at anchorage"],
    ["Working hours & holidays", null, "Overtime and idle days"],
    ["Compulsory services", priced.length ? `Tariffs in force: ${priced.map((s) => PDA_SERVICE_LABELS[s]).join(", ")}` : null, "Which charge lines apply"],
    ["Berth group → tariff band", terminalEditions ? `${terminalEditions} terminal edition${terminalEditions === 1 ? "" : "s"} in force` : null, "Which edition prices the call"],
  ];
}

export function portRecordMeta(input: PdaPortRecordInput) {
  const priced = pricedServices(input.port).length;
  const lines = input.port.tariffs.reduce((n, t) => n + t.ruleCount, 0);
  const agents = portAgents(input.agents, input.port.locode);
  return [
    { k: "Tariffs in force", v: `${input.port.tariffs.length} edition${input.port.tariffs.length === 1 ? "" : "s"}`, empty: input.port.tariffs.length === 0 },
    { k: "Charge lines", v: String(lines), empty: lines === 0 },
    { k: "Services priced", v: `${priced} of ${PDA_ROUTE_SERVICE_CODES.length}`, empty: priced === 0 },
    { k: "Terminals", v: String(input.port.terminals.length), empty: input.port.terminals.length === 0 },
    { k: "Attending agents", v: agents ? String(agents.length) : null, empty: !agents || agents.length === 0 },
    { k: "Verified slots", v: "none yet", empty: true },
  ];
}

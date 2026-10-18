// PDA · the Ports workspace model (owner ruling O2ALL-008, increment C).
//
// The Ports tab of /dashboard/ports-da reads ONE governed RPC, list_pda_ports_workspace (20261018100000): every active,
// verified port, its verified terminals and every tariff published and in force on the call date. Nothing here is typed
// or stored in the browser, so a port can only look covered when a published tariff really prices it. These helpers are
// pure (search, scope filter, ordering, summary) so the page and the contract check share one definition.
import { PDA_ROUTE_SERVICE_CODES, type PdaRouteServiceCode } from "./route-types";

export interface PdaWorkspaceTariff {
  scope: string;
  /** null = port-wide tariff */
  terminalName: string | null;
  /** the frozen member-facing edition label of the published version (20261013300000) */
  editionLabel: string;
  currency: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  publishedAt: string | null;
  publisherName: string | null;
  publisherType: string | null;
  sourceAuthority: string | null;
  ruleCount: number;
  /** which of the nine route services this edition prices (the estimator's own rule) */
  services: PdaRouteServiceCode[];
}

export interface PdaWorkspacePort {
  locode: string;
  name: string;
  country: string | null;
  zone: string | null;
  latitude: number | null;
  longitude: number | null;
  terminals: string[];
  tariffs: PdaWorkspaceTariff[];
}

export interface PdaPortsWorkspace {
  callDate: string;
  ports: PdaWorkspacePort[];
}

export type PdaPortsScope = "all" | "tariff" | "gap";

export const PDA_PORTS_SCOPES: readonly { id: PdaPortsScope; label: string }[] = [
  { id: "all", label: "All ports" },
  { id: "tariff", label: "Tariff held" },
  { id: "gap", label: "No tariff" },
];

export const PDA_SERVICE_LABELS: Record<PdaRouteServiceCode, string> = {
  port_dues: "Port dues",
  pilotage: "Pilotage",
  towage: "Towage",
  mooring: "Mooring",
  cargo_handling: "Cargo handling",
  agency: "Agency",
  waste: "Waste",
  security: "Security",
  launch: "Launch",
};

const SERVICE_SET = new Set<string>(PDA_ROUTE_SERVICE_CODES);

/** Normalise the RPC payload: unknown service codes are dropped, numbers and arrays are made safe. */
export function parsePdaPortsWorkspace(raw: unknown): PdaPortsWorkspace {
  const value = (raw ?? {}) as { callDate?: unknown; ports?: unknown };
  const ports = Array.isArray(value.ports) ? value.ports : [];
  return {
    callDate: typeof value.callDate === "string" ? value.callDate : "",
    ports: ports.map((item) => {
      const p = (item ?? {}) as Record<string, unknown>;
      const tariffs = Array.isArray(p.tariffs) ? p.tariffs : [];
      return {
        locode: String(p.locode ?? ""),
        name: String(p.name ?? p.locode ?? ""),
        country: typeof p.country === "string" ? p.country : null,
        zone: typeof p.zone === "string" ? p.zone : null,
        latitude: typeof p.latitude === "number" ? p.latitude : null,
        longitude: typeof p.longitude === "number" ? p.longitude : null,
        terminals: Array.isArray(p.terminals) ? p.terminals.filter((t): t is string => typeof t === "string") : [],
        tariffs: tariffs.map((entry) => {
          const t = (entry ?? {}) as Record<string, unknown>;
          const services = Array.isArray(t.services) ? t.services : [];
          return {
            scope: String(t.scope ?? ""),
            terminalName: typeof t.terminalName === "string" ? t.terminalName : null,
            editionLabel: String(t.editionLabel ?? ""),
            currency: String(t.currency ?? ""),
            effectiveFrom: String(t.effectiveFrom ?? ""),
            effectiveTo: typeof t.effectiveTo === "string" ? t.effectiveTo : null,
            publishedAt: typeof t.publishedAt === "string" ? t.publishedAt : null,
            publisherName: typeof t.publisherName === "string" ? t.publisherName : null,
            publisherType: typeof t.publisherType === "string" ? t.publisherType : null,
            sourceAuthority: typeof t.sourceAuthority === "string" ? t.sourceAuthority : null,
            ruleCount: typeof t.ruleCount === "number" ? t.ruleCount : 0,
            services: services.filter((s): s is PdaRouteServiceCode => typeof s === "string" && SERVICE_SET.has(s)),
          };
        }),
      };
    }),
  };
}

/** The services priced by ANY tariff in force at the port, in the canonical order. */
export function pricedServices(port: PdaWorkspacePort): PdaRouteServiceCode[] {
  const priced = new Set<PdaRouteServiceCode>();
  for (const tariff of port.tariffs) for (const service of tariff.services) priced.add(service);
  return PDA_ROUTE_SERVICE_CODES.filter((service) => priced.has(service));
}

/** Search (name, locode, country, zone, publisher, edition) and scope, ordered: most services priced first, then name. */
export function filterPdaPorts(ports: readonly PdaWorkspacePort[], query: string, scope: PdaPortsScope): PdaWorkspacePort[] {
  const q = query.trim().toLowerCase();
  return ports
    .filter((port) => {
      if (scope === "tariff" && port.tariffs.length === 0) return false;
      if (scope === "gap" && port.tariffs.length > 0) return false;
      if (!q) return true;
      const haystack = [
        port.name, port.locode, port.country ?? "", port.zone ?? "",
        ...port.tariffs.flatMap((t) => [t.publisherName ?? "", t.editionLabel]),
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => (pricedServices(b).length - pricedServices(a).length) || a.name.localeCompare(b.name) || a.locode.localeCompare(b.locode));
}

export interface PdaPortsSummary { ports: number; withTariff: number; withTerminals: number; fullyPriced: number }

export function summarisePdaPorts(ports: readonly PdaWorkspacePort[]): PdaPortsSummary {
  return {
    ports: ports.length,
    withTariff: ports.filter((p) => p.tariffs.length > 0).length,
    withTerminals: ports.filter((p) => p.terminals.length > 0).length,
    fullyPriced: ports.filter((p) => pricedServices(p).length === PDA_ROUTE_SERVICE_CODES.length).length,
  };
}

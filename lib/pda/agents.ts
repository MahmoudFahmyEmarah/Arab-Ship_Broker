// PDA · port agency directory (owner ruling O2ALL-009, Agents phase 1; 20261018130000).
//
// Only agencies ASB has invited are listed (A2). Members read active agencies at active, verified ports through
// list_pda_port_agents; the owner curates the registry in /admin/port-agents. Pure helpers here are shared by the page
// and the contract check.
import { PDA_ROUTE_SERVICE_CODES, type PdaRouteServiceCode } from "./route-types";

export interface PdaAgentPort {
  portLocode: string;
  portName: string;
  country: string | null;
  services: PdaRouteServiceCode[];
}

export interface PdaAgency {
  /** the agency handle phase 2 quote requests address (the agency organisation) */
  agencyId: string;
  displayName: string;
  website: string | null;
  ports: PdaAgentPort[];
}

export interface PdaAdminAgency extends PdaAgency {
  status: "active" | "suspended";
  organisation: string;
  members: number;
  invitedAt: string;
  adminPorts: { portLocode: string; portName: string; services: PdaRouteServiceCode[]; status: "active" | "withdrawn"; verifiedAt: string }[];
}

const SERVICES = new Set<string>(PDA_ROUTE_SERVICE_CODES);
const services = (raw: unknown): PdaRouteServiceCode[] =>
  PDA_ROUTE_SERVICE_CODES.filter((code) => Array.isArray(raw) && raw.includes(code) && SERVICES.has(code));
const text = (raw: unknown): string | null => (typeof raw === "string" && raw.trim() ? raw : null);

export function parsePdaAgencies(raw: unknown): PdaAgency[] {
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const a = (item ?? {}) as Record<string, unknown>;
    const ports = Array.isArray(a.ports) ? a.ports : [];
    return {
      agencyId: String(a.agencyId ?? ""),
      displayName: String(a.displayName ?? ""),
      // only an https:// address is ever shown as a link
      website: text(a.website) && /^https:\/\//.test(String(a.website)) ? String(a.website) : null,
      ports: ports.map((entry) => {
        const p = (entry ?? {}) as Record<string, unknown>;
        return { portLocode: String(p.portLocode ?? ""), portName: String(p.portName ?? p.portLocode ?? ""), country: text(p.country), services: services(p.services) };
      }).filter((p) => p.portLocode),
    };
  }).filter((a) => a.agencyId && a.displayName);
}

export function parsePdaAdminAgencies(raw: unknown): PdaAdminAgency[] {
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const a = (item ?? {}) as Record<string, unknown>;
    const ports = Array.isArray(a.ports) ? a.ports : [];
    const adminPorts = ports.map((entry) => {
      const p = (entry ?? {}) as Record<string, unknown>;
      return {
        portLocode: String(p.portLocode ?? ""),
        portName: String(p.portName ?? p.portLocode ?? ""),
        services: services(p.services),
        status: (p.status === "withdrawn" ? "withdrawn" : "active") as "active" | "withdrawn",
        verifiedAt: String(p.verifiedAt ?? ""),
      };
    });
    return {
      agencyId: String(a.agencyId ?? ""),
      displayName: String(a.displayName ?? ""),
      website: text(a.website),
      status: (a.status === "suspended" ? "suspended" : "active") as "active" | "suspended",
      organisation: String(a.organisation ?? ""),
      members: typeof a.members === "number" ? a.members : 0,
      invitedAt: String(a.invitedAt ?? ""),
      ports: adminPorts.filter((p) => p.status === "active").map((p) => ({ portLocode: p.portLocode, portName: p.portName, country: null, services: p.services })),
      adminPorts,
    };
  }).filter((a) => a.agencyId);
}

/** Directory search: agency name, port name or code, country; optionally only agencies at one port. */
export function filterPdaAgencies(agencies: readonly PdaAgency[], query: string, port: string | null): PdaAgency[] {
  const q = query.trim().toLowerCase();
  return agencies
    .filter((agency) => !port || agency.ports.some((p) => p.portLocode === port))
    .filter((agency) => {
      if (!q) return true;
      const hay = [agency.displayName, ...agency.ports.flatMap((p) => [p.portName, p.portLocode, p.country ?? ""])].join(" ").toLowerCase();
      return hay.includes(q);
    })
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

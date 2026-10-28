// PDA · the Attending Agent page model (design B2ALL-061, build step 10): one entity page per agency Arab ShipBroker
// has listed, reached from a port's record. Everything shown comes from the agency registry (list_pda_port_agents);
// contacts, fees, founding year and membership are not recorded yet and say so. Pure, shared with the check.
import type { PdaAgency } from "./agents";
import { PDA_SERVICE_LABELS } from "./ports-workspace";
import { PDA_ROUTE_SERVICE_CODES, type PdaRouteServiceCode } from "./route-types";

/** The agency handle members already use when they ask for quotes (the agency organisation); never a row id of anything else. */
export const isPdaAgencyHandle = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

export const findAgency = (agents: readonly PdaAgency[], agencyId: string): PdaAgency | null =>
  agents.find((a) => a.agencyId.toLowerCase() === agencyId.toLowerCase()) ?? null;

/** The services the agency quotes anywhere, in the canonical order. */
export function agencyServices(agency: PdaAgency): PdaRouteServiceCode[] {
  const all = new Set<PdaRouteServiceCode>();
  for (const p of agency.ports) for (const s of p.services) all.add(s);
  return PDA_ROUTE_SERVICE_CODES.filter((s) => all.has(s));
}

export const agencyCountries = (agency: PdaAgency): string[] => [...new Set(agency.ports.map((p) => p.country).filter((c): c is string => !!c))].sort();

export interface PdaAgencyPortRow { locode: string; name: string; country: string | null; services: string }

export function agencyPortRows(agency: PdaAgency): PdaAgencyPortRow[] {
  return [...agency.ports]
    .sort((a, b) => a.portName.localeCompare(b.portName) || a.portLocode.localeCompare(b.portLocode))
    .map((p) => ({ locode: p.portLocode, name: p.portName, country: p.country, services: p.services.map((s) => PDA_SERVICE_LABELS[s]).join(" · ") }));
}

/** Only an https address is ever rendered as a link (B2O-056 P2-3). */
export function safeWebsite(v: string | null): { href: string; host: string } | null {
  if (!v) return null;
  try {
    const url = new URL(v.trim());
    return url.protocol === "https:" ? { href: url.toString(), host: url.host } : null;
  } catch {
    return null;
  }
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

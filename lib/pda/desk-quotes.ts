// PDA · the desk records an agency's emailed quote (owner choice 19 Oct 2026; Agents phase 4). Pure helpers shared by
// the admin console and its check. Only agencies without a portal account appear here; the database enforces it.
import { PDA_ROUTE_SERVICE_CODES, type PdaRouteServiceCode } from "./route-types";
import type { PdaQuoteSnapshot } from "./quote-requests";

export interface PdaDeskQuoteRequest {
  requestId: string;
  agencyId: string;
  agencyName: string;
  port: string;
  snapshot: PdaQuoteSnapshot;
  services: PdaRouteServiceCode[];
  note: string | null;
  createdAt: string;
  expiresAt: string;
  /** quotes already recorded for this agency on this request (a new one is a revision) */
  deskQuotes: number;
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export function parsePdaDeskQuoteRequests(raw: unknown): PdaDeskQuoteRequest[] {
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      requestId: String(r.requestId ?? ""),
      agencyId: String(r.agencyId ?? ""),
      agencyName: String(r.agencyName ?? ""),
      port: String(r.port ?? ""),
      snapshot: (r.snapshot ?? { port: { locode: String(r.port ?? "") }, vessel: {}, call: {} }) as PdaQuoteSnapshot,
      services: PDA_ROUTE_SERVICE_CODES.filter((c) => Array.isArray(r.services) && r.services.includes(c)),
      note: str(r.note),
      createdAt: String(r.createdAt ?? ""),
      expiresAt: String(r.expiresAt ?? ""),
      deskQuotes: typeof r.deskQuotes === "number" ? r.deskQuotes : Number(r.deskQuotes ?? 0) || 0,
    };
  }).filter((r) => r.requestId && r.agencyId);
}

/** Lines typed in the desk form: up to 10 rows of label / service / amount; empty rows are skipped. */
export function deskQuoteLinesFromForm(form: { getAll(name: string): FormDataEntryValue[] }): { label: string; serviceCode: string | null; amount: string }[] {
  const labels = form.getAll("lineLabel").map(String);
  const services = form.getAll("lineService").map(String);
  const amounts = form.getAll("lineAmount").map(String);
  const out: { label: string; serviceCode: string | null; amount: string }[] = [];
  for (let i = 0; i < Math.min(labels.length, 10); i += 1) {
    const label = (labels[i] ?? "").trim();
    const amount = (amounts[i] ?? "").trim().replace(/,/g, "");
    if (!label && !amount) continue;
    out.push({ label, serviceCode: (services[i] ?? "").trim() || null, amount });
  }
  return out;
}

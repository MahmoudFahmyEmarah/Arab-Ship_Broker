// PDA · quote requests and agency quotes (owner decisions O2ALL-009 A1 c / A5; Agents phase 2; 20261019100000).
//
// A member asks ASB-invited agencies at one port of a SAVED estimate for a real quote; the database builds a MASKED
// snapshot (vessel size, cargo quantity, call facts — never the vessel name, IMO or the member, unless the member
// reveals their company). Agency staff answer in their inbox. Pure helpers here are shared by both pages and the check.
import { PDA_ROUTE_SERVICE_CODES, type PdaRouteServiceCode } from "./route-types";

export interface PdaAgencyQuote {
  quoteId: string;
  revision: number;
  currency: string;
  lines: { label: string; serviceCode: PdaRouteServiceCode | null; amount: number }[];
  total: number;
  validUntil: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
}

export interface PdaRequestAgency {
  agencyId: string;
  displayName: string;
  status: "sent" | "quoted" | "declined";
  declineReason: string | null;
  respondedAt: string | null;
  /** latest revision first */
  quotes: PdaAgencyQuote[];
}

export interface PdaQuoteRequest {
  requestId: string;
  setId: string;
  leg: "load" | "discharge";
  port: string;
  services: PdaRouteServiceCode[];
  note: string | null;
  revealIdentity: boolean;
  status: "open" | "withdrawn";
  createdAt: string;
  expiresAt: string;
  mine: boolean;
  agencies: PdaRequestAgency[];
}

/** The masked snapshot an agency sees. */
export interface PdaQuoteSnapshot {
  port: { locode: string; name?: string; terminal?: string };
  callDate?: string;
  vessel: { type?: string; gt?: number; scnrt?: number; dwt?: number; loaM?: number; registeredMaxDraftM?: number; flagState?: string };
  call: { days?: number; cargoQuantityMt?: number; cargoStatus?: string; voyageScope?: string; location?: string };
  requester?: { company: string };
}

export interface PdaAgencyInboxItem {
  requestId: string;
  agencyId: string;
  agencyName: string;
  port: string;
  snapshot: PdaQuoteSnapshot;
  services: PdaRouteServiceCode[];
  note: string | null;
  requestStatus: "open" | "withdrawn" | "expired";
  createdAt: string;
  expiresAt: string;
  myStatus: "sent" | "quoted" | "declined";
  declineReason: string | null;
  quotes: PdaAgencyQuote[];
}

const SERVICE = new Set<string>(PDA_ROUTE_SERVICE_CODES);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);
const services = (v: unknown): PdaRouteServiceCode[] => PDA_ROUTE_SERVICE_CODES.filter((c) => Array.isArray(v) && v.includes(c));

function parseQuotes(raw: unknown): PdaAgencyQuote[] {
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const q = (item ?? {}) as Record<string, unknown>;
    const lines = Array.isArray(q.lines) ? q.lines : [];
    return {
      quoteId: String(q.quoteId ?? ""),
      revision: num(q.revision) ?? 1,
      currency: String(q.currency ?? ""),
      lines: lines.map((entry) => {
        const l = (entry ?? {}) as Record<string, unknown>;
        const code = str(l.serviceCode);
        return { label: String(l.label ?? ""), serviceCode: code && SERVICE.has(code) ? (code as PdaRouteServiceCode) : null, amount: num(l.amount) ?? 0 };
      }),
      total: num(q.total) ?? 0,
      validUntil: String(q.validUntil ?? ""),
      reference: str(q.reference),
      note: str(q.note),
      createdAt: String(q.createdAt ?? ""),
    };
  }).filter((q) => q.quoteId);
}

export function parsePdaQuoteRequests(raw: unknown): PdaQuoteRequest[] {
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const agencies = Array.isArray(r.agencies) ? r.agencies : [];
    return {
      requestId: String(r.requestId ?? ""),
      setId: String(r.setId ?? ""),
      leg: (r.leg === "discharge" ? "discharge" : "load") as "load" | "discharge",
      port: String(r.port ?? ""),
      services: services(r.services),
      note: str(r.note),
      revealIdentity: r.revealIdentity === true,
      status: (r.status === "withdrawn" ? "withdrawn" : "open") as "open" | "withdrawn",
      createdAt: String(r.createdAt ?? ""),
      expiresAt: String(r.expiresAt ?? ""),
      mine: r.mine === true,
      agencies: agencies.map((entry) => {
        const a = (entry ?? {}) as Record<string, unknown>;
        const status: PdaRequestAgency["status"] = a.status === "quoted" ? "quoted" : a.status === "declined" ? "declined" : "sent";
        return { agencyId: String(a.agencyId ?? ""), displayName: String(a.displayName ?? ""), status, declineReason: str(a.declineReason), respondedAt: str(a.respondedAt), quotes: parseQuotes(a.quotes) };
      }),
    };
  }).filter((r) => r.requestId);
}

export function parsePdaAgencyInbox(raw: unknown): PdaAgencyInboxItem[] {
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    const st: PdaAgencyInboxItem["requestStatus"] = r.requestStatus === "withdrawn" ? "withdrawn" : r.requestStatus === "expired" ? "expired" : "open";
    const my: PdaAgencyInboxItem["myStatus"] = r.myStatus === "quoted" ? "quoted" : r.myStatus === "declined" ? "declined" : "sent";
    return {
      requestId: String(r.requestId ?? ""),
      agencyId: String(r.agencyId ?? ""),
      agencyName: String(r.agencyName ?? ""),
      port: String(r.port ?? ""),
      snapshot: (r.snapshot ?? { port: { locode: String(r.port ?? "") }, vessel: {}, call: {} }) as PdaQuoteSnapshot,
      services: services(r.services),
      note: str(r.note),
      requestStatus: st,
      createdAt: String(r.createdAt ?? ""),
      expiresAt: String(r.expiresAt ?? ""),
      myStatus: my,
      declineReason: str(r.declineReason),
      quotes: parseQuotes(r.quotes),
    };
  }).filter((r) => r.requestId && r.agencyId);
}

export interface PdaQuoteLineDraft { label: string; serviceCode: string; amount: string }

/** Validate the agency's quote form (the database re-validates everything). Returns the lines or a message. */
export function validateQuoteLines(drafts: readonly PdaQuoteLineDraft[], allowed: readonly PdaRouteServiceCode[]):
  { ok: true; lines: { label: string; serviceCode: string | null; amount: string }[]; total: number } | { ok: false; error: string } {
  const lines = drafts.filter((d) => d.label.trim() || d.amount.trim());
  if (!lines.length || lines.length > 50) return { ok: false, error: "A quote has 1 to 50 lines." };
  let total = 0;
  const out: { label: string; serviceCode: string | null; amount: string }[] = [];
  for (const line of lines) {
    const label = line.label.trim();
    const amount = line.amount.trim();
    if (!label || label.length > 200) return { ok: false, error: "Every line needs a label (up to 200 characters)." };
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(amount)) return { ok: false, error: `“${label}”: the amount must be a number with up to 2 decimals.` };
    if (line.serviceCode && !(allowed as readonly string[]).includes(line.serviceCode)) return { ok: false, error: `“${label}”: choose one of the requested services.` };
    total += Number(amount);
    out.push({ label, serviceCode: line.serviceCode || null, amount });
  }
  return { ok: true, lines: out, total: Math.round(total * 100) / 100 };
}

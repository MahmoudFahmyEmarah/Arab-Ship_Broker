// PDA · an accepted agency quote becomes a port's priced leg (owner decision O2ALL-009 A4; Agents phase 3).
//
// The quoted port of the new version is priced from the agency's quote lines — basis 'agency_quote', attributed to the
// agency, no tariff version — and the database re-checks that the leg is exactly the quote. The route totals treat an
// agency-quoted port as sourced for the services its lines name (never for services it does not name), and convert it
// to the display currency only with a governed FX rate, the same as any tariff currency.
import type { PdaExplainedLine, PdaCalculationResult, PdaRequest } from "./types";

export const PDA_AGENCY_QUOTE_BASIS = "agency_quote" as const;

export interface PdaAcceptableQuote {
  quoteId: string;
  agencyName: string;
  port: string;
  currency: string;
  total: number;
  revision: number;
  reference: string | null;
  validUntil: string;
  lines: { label: string; serviceCode: string | null; amount: number }[];
}

const cents = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** True when every line of a leg comes from an accepted agency quote. */
export function isAgencyQuoteLeg(result: Pick<PdaCalculationResult, "lines">): boolean {
  return result.lines.length > 0 && result.lines.every((line) => line.basis === PDA_AGENCY_QUOTE_BASIS);
}

/** One line of text naming the quote: "Agency quote from Seaside Agency (ref AQ-17), revision 2, valid until 2026-11-30". */
export function agencyQuoteCitation(quote: Pick<PdaAcceptableQuote, "agencyName" | "reference" | "revision" | "validUntil">): string {
  return `Agency quote from ${quote.agencyName}${quote.reference ? ` (ref ${quote.reference})` : ""}, revision ${quote.revision}, valid until ${quote.validUntil}`;
}

/**
 * The leg result for an accepted quote. `request` is the leg's canonical request after the display-currency lookup:
 * when it carries a governed rate the lines are converted (cents, like the quote), otherwise the leg stays in the quote
 * currency and the route reports FX_RATE_REQUIRED for it.
 */
export function pdaAgencyQuoteLegResult(quote: PdaAcceptableQuote, request: PdaRequest, generatedAt = new Date().toISOString()): PdaCalculationResult {
  const rate = request.convertedCurrency && request.fxRate && request.fxRate > 0 && request.convertedCurrency !== quote.currency ? request.fxRate : null;
  const citation = agencyQuoteCitation(quote);
  const lines: PdaExplainedLine[] = quote.lines.map((line) => ({
    ruleId: null,
    ruleCode: line.serviceCode,
    label: line.label,
    basis: PDA_AGENCY_QUOTE_BASIS,
    quantity: null,
    rate: null,
    amount: cents(line.amount),
    ...(rate ? { convertedAmount: cents(line.amount * rate) } : {}),
    explanation: citation,
    inputs: {},
    serviceCodes: line.serviceCode ? [line.serviceCode] : [],
    manual: true,
    manualReason: citation,
    enteredBy: quote.agencyName,
    evidence: { title: `Agency quote · ${quote.agencyName}` },
  }));
  const native = cents(lines.reduce((sum, line) => sum + line.amount, 0));
  const converted = rate ? cents(lines.reduce((sum, line) => sum + (line.convertedAmount ?? 0), 0)) : null;
  return {
    coverage: "manual_required",
    tariffVersionId: null,
    tariffEdition: null,
    nativeCurrency: quote.currency,
    ...(rate && request.convertedCurrency ? { convertedCurrency: request.convertedCurrency } : {}),
    lines,
    totals: { native, ...(converted != null ? { converted } : {}) },
    warnings: [{ code: "AGENCY_QUOTE", message: `${quote.port} is priced from an accepted agency quote, not a published tariff: ${citation}.` }],
    generatedAt,
  };
}

/** Estimate vs quote for one port, in the quote currency when both are in it; otherwise no difference is claimed. */
export function compareQuoteWithEstimate(estimate: { currency: string; total: number | null }, quote: { currency: string; total: number }):
  { comparable: true; difference: number; percent: number | null } | { comparable: false; reason: string } {
  if (estimate.total == null) return { comparable: false, reason: "your estimate has no known total for this port" };
  if (estimate.currency !== quote.currency) return { comparable: false, reason: `your estimate is in ${estimate.currency}, the quote in ${quote.currency}` };
  const difference = cents(quote.total - estimate.total);
  return { comparable: true, difference, percent: estimate.total > 0 ? Math.round((difference / estimate.total) * 1000) / 10 : null };
}

/** What the server needs to rebuild the route for an acceptance (service read; never sent to the browser). */
export interface PdaQuoteAcceptanceContext {
  quote: PdaAcceptableQuote;
  requestId: string;
  setId: string;
  leg: "load" | "discharge";
  routeInput: unknown;
  requestStatus: "open" | "withdrawn";
  setIsLatest: boolean;
  latestRevision: boolean;
  accepted: boolean;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export function parsePdaQuoteAcceptanceContext(raw: unknown): PdaQuoteAcceptanceContext {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines : [];
  const quote: PdaAcceptableQuote = {
    quoteId: String(r.quoteId ?? ""),
    agencyName: String(r.agencyName ?? ""),
    port: String(r.port ?? ""),
    currency: String(r.currency ?? ""),
    total: num(r.total) ?? 0,
    revision: num(r.revision) ?? 1,
    reference: typeof r.reference === "string" && r.reference ? r.reference : null,
    validUntil: String(r.validUntil ?? ""),
    lines: lines.map((entry) => {
      const l = (entry ?? {}) as Record<string, unknown>;
      return { label: String(l.label ?? ""), serviceCode: typeof l.serviceCode === "string" && l.serviceCode ? l.serviceCode : null, amount: num(l.amount) ?? 0 };
    }),
  };
  if (!quote.quoteId || !quote.agencyName || !/^[A-Z]{3}$/.test(quote.currency) || !quote.lines.length) throw new Error("PDA_INPUT: the quote could not be read");
  return {
    quote,
    requestId: String(r.requestId ?? ""),
    setId: String(r.setId ?? ""),
    leg: r.leg === "discharge" ? "discharge" : "load",
    routeInput: r.routeInput ?? null,
    requestStatus: r.requestStatus === "withdrawn" ? "withdrawn" : "open",
    setIsLatest: r.setIsLatest === true,
    latestRevision: r.latestRevision === true,
    accepted: r.accepted === true,
  };
}

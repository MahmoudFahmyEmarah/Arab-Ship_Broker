// PDA · saved estimate sets (owner ruling O2ALL-008, increment A; 20261018120000).
//
// A set is the immutable paired save of one route: both immutable leg estimates plus the route snapshot (inputs,
// timeline, transits, totals, not-sourced reasons). It is built ONLY from a server-recomputed preview — the page never
// sends figures to be saved — and its content hash is computed by the database.
import type { PdaRoutePreviewInput, PdaRoutePreviewResult } from "./route-types";

/**
 * What a SAVED manual line records as "entered by" (B2O-044 P1-4): a marker, never a name, so no personal data is
 * frozen in an immutable record. get_pda_estimate_set resolves it at read time to the owner's current name, or
 * "Deleted account" after erasure. A live preview, which is never stored, still shows the member's name.
 */
export const PDA_OWNER_MARKER = "@owner";

/** The route snapshot the database stores with a set (p_route of pda_save_estimate_set). */
export interface PdaRouteSnapshot {
  title: string;
  canonical: Omit<PdaRoutePreviewResult["canonical"], "loadRequest" | "dischargeRequest">;
  routeInput: PdaRoutePreviewInput;
  timeline: PdaRoutePreviewResult["timeline"];
  transits: PdaRoutePreviewResult["transits"];
  totals: PdaRoutePreviewResult["totals"];
  notSourced: PdaRoutePreviewResult["notSourced"];
  allocation: PdaRoutePreviewResult["allocation"];
  displayCurrency: string;
}

export interface PdaEstimateSetSummary {
  id: string;
  title: string;
  createdAt: string;
  loadPort: string;
  dischargePort: string;
  displayCurrency: string;
  allocation: string;
  allInKnown: number | null;
  allInComplete: number | null;
  notSourcedCount: number;
  contentHash: string;
  supersedesId: string | null;
  isLatest: boolean;
  mine: boolean;
}

export interface PdaSavedLine {
  lineNo: number;
  ruleCode: string | null;
  label: string;
  /** null only if the record is damaged: an unknown amount is never shown as zero (B2O-044 P1-2) */
  amount: number | null;
  convertedAmount: number | null;
  explanation: string;
  manual: boolean;
  manualReason: string | null;
  enteredBy: string | null;
  evidence: { title?: string; page?: string; sheet?: string; excerpt?: string };
}

export interface PdaSavedLeg {
  portLocode: string;
  terminalName: string | null;
  coverage: string;
  /** the published edition that priced the leg, by its frozen label (never its id) */
  editionLabel: string | null;
  callDate: string | null;
  nativeCurrency: string;
  nativeTotal: number | null;
  convertedCurrency: string | null;
  convertedTotal: number | null;
  lines: PdaSavedLine[];
}

export interface PdaEstimateSetDetail {
  id: string;
  title: string;
  createdAt: string;
  contentHash: string;
  supersedesId: string | null;
  isLatest: boolean;
  allocation: string;
  displayCurrency: string;
  quantityMt: number;
  /** the member projection of the route (B2O-044 P1-1): ports and call dates, no ids */
  route: { loadPort: string; dischargePort: string; loadCallDate: string | null; dischargeCallDate: string | null };
  timeline: PdaRoutePreviewResult["timeline"];
  transits: PdaRoutePreviewResult["transits"];
  totals: PdaRoutePreviewResult["totals"];
  notSourced: PdaRoutePreviewResult["notSourced"];
  load: PdaSavedLeg;
  discharge: PdaSavedLeg;
}

export interface PdaSaveSetResult {
  id: string;
  contentHash: string;
  createdAt: string;
  /** true when the same content was already the owner's latest saved set (nothing new was written) */
  replayed: boolean;
}

/** "EGALY → SAJED · MV BALTIC STAR · 26,000 MT" — what the history list shows. */
export function pdaSetTitle(input: { loadPort: string; dischargePort: string; vesselName?: string | null; quantityMt: number }): string {
  const qty = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(input.quantityMt);
  const vessel = input.vesselName?.trim();
  return `${input.loadPort} → ${input.dischargePort}${vessel ? ` · ${vessel}` : ""} · ${qty} MT`.slice(0, 300);
}

/** The route snapshot of a server-computed preview (the only thing a set is built from). */
export function pdaRouteSnapshot(input: PdaRoutePreviewInput, result: PdaRoutePreviewResult, vesselName: string | null): PdaRouteSnapshot {
  const { loadRequest: _load, dischargeRequest: _discharge, ...canonical } = result.canonical;
  return {
    title: pdaSetTitle({
      loadPort: input.load.portLocode,
      dischargePort: input.discharge.portLocode,
      vesselName,
      quantityMt: input.selection.quantityMt,
    }),
    canonical,
    routeInput: input,
    timeline: result.timeline,
    transits: result.transits,
    totals: result.totals,
    notSourced: result.notSourced,
    allocation: result.allocation,
    displayCurrency: result.displayCurrency,
  };
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

export function parsePdaSetSummaries(raw: unknown): PdaEstimateSetSummary[] {
  return (Array.isArray(raw) ? raw : []).map((item) => {
    const r = (item ?? {}) as Record<string, unknown>;
    return {
      id: String(r.id ?? ""),
      title: String(r.title ?? ""),
      createdAt: String(r.createdAt ?? ""),
      loadPort: String(r.loadPort ?? ""),
      dischargePort: String(r.dischargePort ?? ""),
      displayCurrency: String(r.displayCurrency ?? "USD"),
      allocation: String(r.allocation ?? ""),
      allInKnown: num(r.allInKnown),
      allInComplete: num(r.allInComplete),
      notSourcedCount: num(r.notSourcedCount) ?? 0,
      contentHash: String(r.contentHash ?? ""),
      supersedesId: str(r.supersedesId),
      isLatest: r.isLatest === true,
      mine: r.mine === true,
    };
  }).filter((s) => s.id);
}

function parseLeg(raw: unknown): PdaSavedLeg {
  const r = (raw ?? {}) as Record<string, unknown>;
  const lines = Array.isArray(r.lines) ? r.lines : [];
  return {
    portLocode: String(r.portLocode ?? ""),
    terminalName: str(r.terminalName),
    coverage: String(r.coverage ?? ""),
    editionLabel: str(r.editionLabel),
    callDate: str(r.callDate),
    nativeCurrency: String(r.nativeCurrency ?? ""),
    nativeTotal: num(r.nativeTotal),
    convertedCurrency: str(r.convertedCurrency),
    convertedTotal: num(r.convertedTotal),
    lines: lines.map((item) => {
      const l = (item ?? {}) as Record<string, unknown>;
      const evidence = (l.evidence ?? {}) as Record<string, unknown>;
      return {
        lineNo: num(l.lineNo) ?? 0,
        ruleCode: str(l.ruleCode),
        label: String(l.label ?? ""),
        amount: num(l.amount),
        convertedAmount: num(l.convertedAmount),
        explanation: String(l.explanation ?? ""),
        manual: l.manual === true,
        manualReason: str(l.manualReason),
        enteredBy: str(l.enteredBy),
        // evidence by title/page/sheet/excerpt only — never the source id (C2O-120)
        evidence: {
          ...(str(evidence.title) ? { title: str(evidence.title)! } : {}),
          ...(str(evidence.page) ? { page: str(evidence.page)! } : {}),
          ...(str(evidence.sheet) ? { sheet: str(evidence.sheet)! } : {}),
          ...(str(evidence.excerpt) ? { excerpt: str(evidence.excerpt)! } : {}),
        },
      };
    }),
  };
}

export function parsePdaSetDetail(raw: unknown): PdaEstimateSetDetail {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(r.id ?? ""),
    title: String(r.title ?? ""),
    createdAt: String(r.createdAt ?? ""),
    contentHash: String(r.contentHash ?? ""),
    supersedesId: str(r.supersedesId),
    isLatest: r.isLatest === true,
    allocation: String(r.allocation ?? ""),
    displayCurrency: String(r.displayCurrency ?? "USD"),
    quantityMt: num(r.quantityMt) ?? 0,
    route: (() => {
      const route = (r.route ?? {}) as Record<string, unknown>;
      return { loadPort: String(route.loadPort ?? ""), dischargePort: String(route.dischargePort ?? ""), loadCallDate: str(route.loadCallDate), dischargeCallDate: str(route.dischargeCallDate) };
    })(),
    timeline: r.timeline as PdaRoutePreviewResult["timeline"],
    transits: (Array.isArray(r.transits) ? r.transits : []) as PdaRoutePreviewResult["transits"],
    totals: (r.totals ?? {}) as PdaRoutePreviewResult["totals"],
    notSourced: (Array.isArray(r.notSourced) ? r.notSourced : []) as PdaRoutePreviewResult["notSourced"],
    load: parseLeg(r.load),
    discharge: parseLeg(r.discharge),
  };
}

export function parsePdaSaveSetResult(raw: unknown): PdaSaveSetResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  return { id: String(r.id ?? ""), contentHash: String(r.contentHash ?? ""), createdAt: String(r.createdAt ?? ""), replayed: r.replayed === true };
}

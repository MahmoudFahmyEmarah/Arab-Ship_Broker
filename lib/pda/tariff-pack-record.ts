// PDA · the Tariff Pack record model (design B2ALL-061, build step 7).
//
// The record reads ONE governed RPC, get_pda_tariff_pack (20261019130000): the issuing authority, the source document
// and every edition in force that cites it, with its charge lines exactly as published. No row id is carried. The design's
// record tabs (Pack · Layout · Charges · Hours · Sources) are filled from these facts only; what no table holds yet is
// reported as "Not recorded yet" by the page, never estimated. Pure helpers, shared by the page and the contract check.
import { PDA_SERVICE_LABELS } from "./ports-workspace";
import { PDA_ROUTE_SERVICE_CODES, type PdaRouteServiceCode } from "./route-types";

export interface PdaTariffPackLine {
  code: string;
  label: string;
  basis: string;
  amount: number | null;
  rate: number | null;
  unit: string | null;
  minimum: number | null;
  maximum: number | null;
  taxPercent: number | null;
  includedUnits: number;
  services: PdaRouteServiceCode[];
  page: string | null;
  sheet: string | null;
  excerpt: string | null;
  manual: boolean;
}

export interface PdaTariffPackEdition {
  port: string;
  portName: string;
  terminal: string | null;
  edition: string;
  version: number;
  currency: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  publishedAt: string | null;
  rounding: string | null;
  decimals: number | null;
  supersedes: boolean;
  lines: PdaTariffPackLine[];
}

export interface PdaTariffPackRecord {
  packRef: string;
  authority: string;
  publisherType: string | null;
  country: string | null;
  website: string | null;
  source: {
    title: string;
    authority: string;
    issueDate: string | null;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    language: string | null;
    registeredAt: string | null;
    currentness: string | null;
  };
  editions: PdaTariffPackEdition[];
}

export const PDA_TARIFF_PACK_TABS = [
  { id: "pack", label: "Pack" },
  { id: "layout", label: "Layout" },
  { id: "charges", label: "Charges" },
  { id: "hours", label: "Hours" },
  { id: "sources", label: "Sources" },
] as const;
export type PdaTariffPackTab = (typeof PDA_TARIFF_PACK_TABS)[number]["id"];
export const isPdaTariffPackTab = (v: unknown): v is PdaTariffPackTab => PDA_TARIFF_PACK_TABS.some((t) => t.id === v);

/** How a charge line is measured, in a broker's words. */
export const PDA_BASIS_LABELS: Record<string, string> = {
  flat: "Flat", per_call: "Per call", per_day: "Per day", per_hour: "Per hour", per_gt: "Per GT", per_nt: "Per NT",
  per_scnrt: "Per SCNRT", per_dwt: "Per DWT", per_loa: "Per metre LOA", per_cargo_mt: "Per tonne of cargo", per_unit: "Per unit",
  percentage: "Percentage of other lines", tiered_flat: "Tiered, flat per band", tiered_rate: "Tiered, rate per band",
  progressive: "Progressive bands", manual_quote: "Quoted on request",
};

/** What the estimator has to know to price a line on this basis (the design's "Handover to the estimator"). */
const BASIS_INPUT: Record<string, string> = {
  per_day: "Days alongside", per_hour: "Hours alongside", per_gt: "Vessel GT", per_nt: "Vessel NT", per_scnrt: "Vessel SCNRT",
  per_dwt: "Vessel DWT", per_loa: "Vessel LOA", per_cargo_mt: "Cargo quantity", per_unit: "Units of the service",
  tiered_flat: "Vessel size against the bands", tiered_rate: "Vessel size against the bands", progressive: "Vessel size against the bands",
  percentage: "The lines it is a percentage of", manual_quote: "A quote from the agent",
};

const SERVICE_SET = new Set<string>(PDA_ROUTE_SERVICE_CODES);
const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
const numOrNull = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);

export function parsePdaTariffPackRecord(raw: unknown): PdaTariffPackRecord | null {
  const r = (raw ?? null) as Record<string, unknown> | null;
  if (!r || typeof r.packRef !== "string") return null;
  const s = (r.source ?? {}) as Record<string, unknown>;
  const editions = Array.isArray(r.editions) ? r.editions : [];
  return {
    packRef: r.packRef,
    authority: str(r.authority) ?? str(s.title) ?? "Unnamed publisher",
    publisherType: str(r.publisherType),
    country: str(r.country),
    website: safeWebsite(r.website),
    source: {
      title: str(s.title) ?? "",
      authority: str(s.authority) ?? "unverified",
      issueDate: str(s.issueDate),
      effectiveFrom: str(s.effectiveFrom),
      effectiveTo: str(s.effectiveTo),
      language: str(s.language),
      registeredAt: str(s.registeredAt),
      currentness: str(s.currentness),
    },
    editions: editions.map((entry) => {
      const e = (entry ?? {}) as Record<string, unknown>;
      const lines = Array.isArray(e.lines) ? e.lines : [];
      return {
        port: String(e.port ?? ""),
        portName: String(e.portName ?? e.port ?? ""),
        terminal: str(e.terminal),
        edition: String(e.edition ?? ""),
        version: numOrNull(e.version) ?? 0,
        currency: String(e.currency ?? ""),
        effectiveFrom: str(e.effectiveFrom),
        effectiveTo: str(e.effectiveTo),
        publishedAt: str(e.publishedAt),
        rounding: str(e.rounding),
        decimals: numOrNull(e.decimals),
        supersedes: e.supersedes === true,
        lines: lines.map((item) => {
          const l = (item ?? {}) as Record<string, unknown>;
          const services = Array.isArray(l.services) ? l.services : [];
          return {
            code: String(l.code ?? ""),
            label: String(l.label ?? l.code ?? ""),
            basis: String(l.basis ?? ""),
            amount: numOrNull(l.amount),
            rate: numOrNull(l.rate),
            unit: str(l.unit),
            minimum: numOrNull(l.minimum),
            maximum: numOrNull(l.maximum),
            taxPercent: numOrNull(l.taxPercent),
            includedUnits: numOrNull(l.includedUnits) ?? 0,
            services: services.filter((x): x is PdaRouteServiceCode => typeof x === "string" && SERVICE_SET.has(x)),
            page: str(l.page),
            sheet: str(l.sheet),
            excerpt: str(l.excerpt),
            manual: l.manual === true,
          };
        }),
      };
    }),
  };
}

/** Only an http(s) address is ever rendered as a link. */
function safeWebsite(v: unknown): string | null {
  if (typeof v !== "string") return null;
  try {
    const url = new URL(v.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const money = (n: number, unit: string | null, currency: string) =>
  `${currency} ${new Intl.NumberFormat("en-GB", { maximumFractionDigits: 6 }).format(n)}${unit ? ` / ${unit}` : ""}`;

/** The published figure of a line as the document states it (rate for a measured basis, amount for a flat one). */
export function lineFigure(line: PdaTariffPackLine, currency: string): string {
  if (line.manual) return "Quoted on request";
  if (line.basis === "percentage" && line.rate != null) return `${line.rate} %`;
  if (line.rate != null) return money(line.rate, line.unit, currency);
  if (line.amount != null) return money(line.amount, line.unit, currency);
  if (line.basis.startsWith("tiered") || line.basis === "progressive") return "By band";
  return "—";
}

export const lineServices = (line: PdaTariffPackLine) => line.services.map((s) => PDA_SERVICE_LABELS[s]).join(" · ");
export const lineItem = (line: PdaTariffPackLine) => [line.page ? `p. ${line.page}` : null, line.sheet ? `sheet ${line.sheet}` : null].filter(Boolean).join(" · ");

/** Every estimator input the pack's lines need, with the lines that read it (derived, never typed). */
export function packHandover(record: PdaTariffPackRecord): Array<{ input: string; lines: string[] }> {
  const map = new Map<string, Set<string>>();
  for (const edition of record.editions) {
    for (const line of edition.lines) {
      const input = BASIS_INPUT[line.basis] ?? "Nothing: a fixed charge per call";
      const set = map.get(input) ?? new Set<string>();
      set.add(line.label);
      map.set(input, set);
    }
  }
  return [...map.entries()].map(([input, lines]) => ({ input, lines: [...lines] })).sort((a, b) => a.input.localeCompare(b.input));
}

export function packTotals(record: PdaTariffPackRecord) {
  const lines = record.editions.reduce((n, e) => n + e.lines.length, 0);
  const ports = new Set(record.editions.map((e) => e.port)).size;
  const currencies = [...new Set(record.editions.map((e) => e.currency).filter(Boolean))];
  const taxed = record.editions.some((e) => e.lines.some((l) => l.taxPercent != null && l.taxPercent > 0));
  return { lines, ports, currencies, taxed };
}

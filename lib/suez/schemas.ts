// Suez tariff admin schemas — validated on the server before any write
// (Voyage Economics, Stream S). Mirrors the check constraints of migration
// 20261003200000 and the params each basis expects in lib/suez/engine.ts.
import { z } from "zod";

export const SUEZ_LAYERS = ["toll", "surcharge", "fixed", "conditional", "waste"] as const;
export const SUEZ_SURCHARGE_REGIMES = ["unknown", "none", "modelled"] as const;
const categoryKey = z.string().regex(/^[a-z][a-z0-9_]{1,40}$/);
export const SUEZ_BASES = ["toll_tiered_scnt", "flat", "pct_of_toll", "tier_by_scnt", "per_unit", "gt_threshold", "flag_only"] as const;
export const SUEZ_CONDITION_KEYS = [
  "no_mooring_cranes", "late_arrival", "no_searchlight", "not_ready", "heavy_lift", "floating_unit",
  "military", "deck_protrusion", "ladder_noncompliant", "relieving_pilots", "overage", "first_transit",
] as const;

const money = z.number().finite().min(0).max(10_000_000);
const pct = z.number().finite().min(0).max(1000);

// Tariff-defined thresholds live in params (imposed tug: GT threshold, crane SWL,
// boats to lift; overage: years), never in code.
const flatParams = z.object({
  amount: money,
  fromSecondTransit: z.boolean().optional(),
  gtThreshold: z.number().finite().positive().max(500000).optional(),
  swlMt: z.number().finite().positive().max(100).optional(),
  boats: z.number().int().min(1).max(4).optional(),
}).strict();
const flagParams = z.object({ ageYears: z.number().int().min(1).max(60).optional() }).strict();
const pctParams = z.union([
  z.object({ pct: pct }).strict(),
  z.object({ pctPerUnit: pct, unit: z.string().min(1).max(20) }).strict(),
  z.object({
    bands: z.array(z.object({ key: z.string().regex(/^[a-z0-9_]{1,20}$/), label: z.string().max(60).optional(), pct: pct, capSdr: money.optional() }).strict()).min(1).max(10),
  }).strict(),
]);
const tierByScntParams = z.object({
  unit: z.string().min(1).max(20).optional(),
  tiers: z.array(z.object({ from: z.number().finite().min(0), to: z.number().finite().positive().nullable(), amount: money, includedUnits: z.number().finite().min(0) }).strict()).min(1).max(20),
}).strict();
const perUnitParams = z.object({ rate: money, unit: z.string().min(1).max(20), freeUnits: z.number().finite().min(0).optional(), units: z.number().finite().min(0).optional() }).strict();
const gtThresholdParams = z.object({ threshold: z.number().finite().positive(), below: money, atOrAbove: money, unit: z.string().max(10).optional() }).strict();
const emptyParams = z.object({}).strict();

export function paramsSchemaFor(basis: (typeof SUEZ_BASES)[number]) {
  switch (basis) {
    case "flat": return flatParams;
    case "pct_of_toll": return pctParams;
    case "tier_by_scnt": return tierByScntParams;
    case "per_unit": return perUnitParams;
    case "gt_threshold": return gtThresholdParams;
    case "flag_only": return flagParams;
    case "toll_tiered_scnt":
    default: return emptyParams;
  }
}

export const suezItemInputSchema = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/, "code: lower-case letters, digits and underscores"),
  labelEn: z.string().trim().min(2).max(200),
  labelAr: z.string().trim().max(200).optional().nullable(),
  layer: z.enum(SUEZ_LAYERS),
  basis: z.enum(SUEZ_BASES),
  currency: z.enum(["USD", "SDR"]),
  params: z.record(z.string(), z.unknown()),
  directionScope: z.enum(["any", "SB", "NB"]).default("any"),
  cargoStatusScope: z.enum(["any", "laden", "ballast"]).default("any"),
  categoryScope: z.array(categoryKey).min(1).max(20).nullable().optional(),
  confidence: z.enum(["official", "reported"]).default("official"),
  conditionKey: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional().nullable(),
  payerParty: z.enum(["owner", "charterer", "either"]).default("owner"),
  sortOrder: z.number().int().min(0).max(10000).default(100),
  isActive: z.boolean().default(true),
  notes: z.string().trim().max(1000).optional().nullable(),
}).superRefine((v, ctx) => {
  const r = paramsSchemaFor(v.basis).safeParse(v.params);
  if (!r.success) ctx.addIssue({ code: "custom", path: ["params"], message: `params for basis ${v.basis}: ${r.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` });
  if (v.layer === "conditional" && !v.conditionKey) ctx.addIssue({ code: "custom", path: ["conditionKey"], message: "a conditional item needs a condition key" });
  if (v.layer === "toll" && v.basis !== "toll_tiered_scnt") ctx.addIssue({ code: "custom", path: ["basis"], message: "the toll layer uses toll_tiered_scnt" });
  if (v.layer === "surcharge") {
    if (!v.categoryScope?.length) ctx.addIssue({ code: "custom", path: ["categoryScope"], message: "a surcharge names the vessel categories it applies to" });
    if (v.basis !== "pct_of_toll" || typeof (v.params as { pct?: unknown }).pct !== "number") ctx.addIssue({ code: "custom", path: ["params"], message: "a surcharge is pct_of_toll with params {pct}" });
  }
});
export type SuezItemInput = z.infer<typeof suezItemInputSchema>;

export const suezVersionInputSchema = z.object({
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  sourceRef: z.string().trim().min(2).max(500),
  sourceUrl: z.string().trim().url().max(500).optional().nullable().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().nullable(),
  surchargeRegime: z.enum(SUEZ_SURCHARGE_REGIMES).default("unknown"),
});

// Governed source record (suez_tariff_sources): the circular / guide / proforma
// a tariff version is built from. "on_file" needs the document's SHA-256.
export const suezSourceInputSchema = z.object({
  title: z.string().trim().min(2).max(300),
  issuer: z.string().trim().min(2).max(120),
  documentNo: z.string().trim().max(120).optional().nullable(),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  authority: z.enum(["official", "agent", "reference", "owner"]),
  evidenceStatus: z.enum(["on_file", "pending_document"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, "64 hex characters").optional().nullable(),
  sourceFilename: z.string().trim().max(200).optional().nullable(),
  sourceUri: z.string().trim().max(500).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
}).superRefine((v, ctx) => {
  if (v.evidenceStatus === "on_file" && !v.sha256) ctx.addIssue({ code: "custom", path: ["sha256"], message: "a source on file needs the document's SHA-256" });
});

export const sdrRateInputSchema = z.object({
  rateUsd: z.number().finite().min(0.5).max(5),
  asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string().trim().min(2).max(60),
  notes: z.string().trim().max(500).optional().nullable(),
});

// One CSV line per band: category,cargo_status,tier_order,scnt_from,scnt_to,sdr_per_scnt
// scnt_to may be blank for the open-ended last band. Header lines and blanks are ignored.
export interface TierCsvRow { vesselCategory: string; cargoStatus: "laden" | "ballast"; tierOrder: number; scntFrom: number; scntTo: number | null; sdrPerScnt: number }
export function parseTierCsv(text: string): { rows: TierCsvRow[]; errors: string[] } {
  const rows: TierCsvRow[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    if (/^(category|vessel_category)/i.test(line)) return;
    const parts = line.split(/[,;\t]/).map((p) => p.trim());
    if (parts.length < 6) { errors.push(`line ${i + 1}: expected 6 columns`); return; }
    const [cat, status, order, from, to, rate] = parts;
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(cat)) errors.push(`line ${i + 1}: bad category "${cat}"`);
    if (status !== "laden" && status !== "ballast") errors.push(`line ${i + 1}: cargo status must be laden or ballast`);
    const o = Number(order), f = Number(from), r = Number(rate);
    const t = to === "" || to.toLowerCase() === "null" || to.toLowerCase() === "open" ? null : Number(to);
    if (!Number.isInteger(o) || o < 0) errors.push(`line ${i + 1}: bad tier order`);
    if (!Number.isFinite(f) || f < 0) errors.push(`line ${i + 1}: bad scnt_from`);
    if (t != null && (!Number.isFinite(t) || t <= f)) errors.push(`line ${i + 1}: scnt_to must exceed scnt_from`);
    if (!Number.isFinite(r) || r < 0) errors.push(`line ${i + 1}: bad SDR per SCNT`);
    rows.push({ vesselCategory: cat, cargoStatus: status as "laden" | "ballast", tierOrder: o, scntFrom: f, scntTo: t, sdrPerScnt: r });
  });
  // Bands of one (category, status) must be contiguous and ordered.
  const groups = new Map<string, TierCsvRow[]>();
  for (const r of rows) { const k = `${r.vesselCategory}|${r.cargoStatus}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  for (const [k, g] of groups) {
    const sorted = [...g].sort((a, b) => a.tierOrder - b.tierOrder);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i - 1].scntTo == null) errors.push(`${k}: an open-ended band must be the last one`);
      else if (sorted[i].scntFrom !== sorted[i - 1].scntTo) errors.push(`${k}: band ${sorted[i].tierOrder} must start at ${sorted[i - 1].scntTo}`);
    }
    if (sorted.length && sorted[0].scntFrom !== 0) errors.push(`${k}: the first band must start at 0`);
    // A finite last band would stop charging above its ceiling (audit C2O-039 P0-2).
    if (sorted.length && sorted[sorted.length - 1].scntTo != null) errors.push(`${k}: the last band must be open-ended (leave scnt_to blank)`);
  }
  return { rows, errors };
}

// ── Runtime input boundary for the engine (audit O2C-024 item 5) ────────────
// Rejects negative, zero-where-positive, non-finite or out-of-range facts so
// the engine never computes from poisoned input.

const posInt = (max: number) => z.number().int().min(1).max(max);
// SCA tonnage certificates carry decimals (e.g. SCNT 15,836.28); two places at most.
const tonnage = (max: number) => z.number().finite().positive().max(max).refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "at most two decimals");
const nonNeg = (max: number) => z.number().finite().min(0).max(max);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO date (YYYY-MM-DD)");

export const suezInputSchema = z.object({
  vessel: z.object({
    scnt: tonnage(300000).nullable(),
    scgt: tonnage(300000).nullable().optional(),
    gt: posInt(300000).nullable(),
    category: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/),
    buildYear: z.number().int().min(1900).max(2100).nullable().optional(),
    craneCount: z.number().int().min(0).max(20).nullable().optional(),
    craneSwlMt: nonNeg(1000).nullable().optional(),
    mooringCranesOk: z.boolean().nullable().optional(),
    searchlightCompliant: z.boolean().nullable().optional(),
    firstTransit: z.boolean().nullable().optional(),
  }).strict(),
  voyage: z.object({
    direction: z.enum(["SB", "NB"]),
    cargoStatus: z.enum(["laden", "ballast"]),
    transitDate: isoDate,
    heavyLiftOver250t: z.boolean().optional(),
    floatingUnitScgt300: z.boolean().optional(),
    militaryCargo: z.boolean().optional(),
    lateArrivalBand: z.enum(["none", "b1", "b2", "b3"]).optional(),
    notReady: z.boolean().optional(),
    deckProtrusionFt: nonNeg(200).optional(),
    ladderNoncompliant: z.boolean().optional(),
    relievingPilots: z.number().int().min(0).max(10).optional(),
    wasteNormalM3: nonNeg(1000).optional(),
    wasteHazardousM3: nonNeg(1000).optional(),
    bagsM3: nonNeg(1000).optional(),
    bargeHours: nonNeg(240).optional(),
  }).strict(),
  overrides: z.object({
    sdrRate: z.object({
      value: z.number().finite().min(0.5).max(5),
      reason: z.string().trim().min(3).max(300),
      actorUserId: z.string().min(1).max(64),
      at: z.string().datetime({ offset: true }),
    }).strict().optional(),
    transitDays: nonNeg(10).optional(),
    anchorageDays: nonNeg(30).optional(),
  }).strict().optional(),
}).strict();

export type SuezInputParsed = z.infer<typeof suezInputSchema>;

export function parseSuezInput(v: unknown): { ok: true; value: SuezInputParsed } | { ok: false; errors: string[] } {
  const r = suezInputSchema.safeParse(v);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
  return { ok: true, value: r.data };
}

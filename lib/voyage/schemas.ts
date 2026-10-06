// voyage_settings validation (admin writes on /admin/voyage-data, SDK reads)
// and the fail-closed runtime boundary of the voyage engine (audit O2C-024 §5).
import { z } from "zod";
import type { VoyageInput, VoyageSettings } from "./types";

const pctSmall = z.number().finite().min(0).max(100);
const days = z.number().finite().min(0).max(60);
const productKey = z.string().regex(/^[A-Z0-9]{2,12}$/);

export const voyageSettingsSchema = z.object({
  speeds: z.object({ ladenKn: z.number().finite().min(3).max(40), ballastKn: z.number().finite().min(3).max(40) }).strict(),
  seaMargin: z.object({
    defaultPct: pctSmall,
    byLane: z.record(z.string().regex(/^[A-Z0-9.]+>[A-Z0-9.]+$/), pctSmall).default({}),
    bySeason: z.partialRecord(z.enum(["winter", "spring", "summer", "autumn"]), pctSmall).default({}),
  }).strict(),
  portTimeDays: z.object({ loadDefault: days, dischDefault: days, idleSharePct: pctSmall }).strict(),
  anchorageDaysDefault: days,
  suez: z.object({
    transitDays: days, anchorageDays: days, nm: z.number().finite().min(0).max(500),
    anchorages: z.object({ SB: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]).optional(), NB: z.tuple([z.number().min(-90).max(90), z.number().min(-180).max(180)]).optional() }).strict().optional(),
  }).strict(),
  opex: z.object({ crewUsdDay: z.number().finite().min(0).max(100000), maintenanceUsdDay: z.number().finite().min(0).max(100000) }).strict(),
  classMultipliers: z.object({ A: z.number().finite().min(0.1).max(10), B: z.number().finite().min(0.1).max(10), C: z.number().finite().min(0.1).max(10) }).strict(),
  eca: z.object({ fuelProductKey: z.enum(["LSMGO", "ULSFO", "MGO05", "MDO"]), distillateProductKey: z.enum(["LSMGO", "MGO05", "MDO"]).optional() }).strict(),
  fuelFallback: z.record(productKey, z.number().finite().min(1).max(10000)),
  seedMarker: z.string().max(60).optional(),
  confirmed: z.array(z.enum(["opex.crewUsdDay", "opex.maintenanceUsdDay", "classMultipliers", "seaMargin.defaultPct", "speeds", "portTimeDays", "suez.days"])).max(20).optional(),
}).strict();

export function parseVoyageSettings(v: unknown): { ok: true; value: VoyageSettings } | { ok: false; error: string } {
  const r = voyageSettingsSchema.safeParse(v);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, value: r.data as VoyageSettings };
}

// ── Engine input boundary ───────────────────────────────────────────────────

const nonNeg = (max: number) => z.number().finite().min(0).max(max);
const locode = z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/).nullable();
const manual = z.object({ actorUserId: z.string().min(1).max(64), reason: z.string().trim().min(3).max(300), at: z.string().datetime({ offset: true }) }).strict();
const consumptionEntry = z.object({ residual: nonNeg(500).nullable().optional(), distillate: nonNeg(500).nullable().optional() }).strict();
const seaLeg = z.object({
  key: z.enum(["ballast", "laden"]),
  from: locode, to: locode,
  nm: z.number().finite().positive().max(30000).nullable(),
  ecaNm: nonNeg(30000).nullable(),
  method: z.enum(["waypoints", "distance_only", "manual", "none"]),
  routeSource: z.string().max(80).nullable().optional(),
  routeVerified: z.boolean().nullable().optional(),
  canalNm: nonNeg(500).nullable().optional(),
  ecaConfidence: z.enum(["official", "coarse"]).nullable().optional(),
  manual: manual.optional(),
}).strict().superRefine((l, ctx) => {
  if (l.ecaNm != null && l.nm != null && l.ecaNm > l.nm) ctx.addIssue({ code: "custom", path: ["ecaNm"], message: "ECA miles cannot exceed the leg distance" });
  if (l.method === "manual" && !l.manual) ctx.addIssue({ code: "custom", path: ["manual"], message: "a manual distance needs actor, reason and time" });
  if (l.method === "none" && l.nm != null) ctx.addIssue({ code: "custom", path: ["method"], message: "a leg with a distance needs a method" });
});
const portCall = z.object({
  key: z.enum(["load", "disch"]),
  port: locode,
  qtyMt: nonNeg(500000),
  rateMtDay: z.number().finite().positive().max(200000).nullable(),
  allowanceDays: days,
  inEca: z.boolean(),
  openLoopBan: z.boolean(),
  euBerthOver2h: z.boolean(),
  inEcaSource: z.enum(["governed", "coarse", "manual"]).optional(),
  rateSource: z.enum(["listing", "manual"]).optional(),
  pda: z.object({ usd: nonNeg(5_000_000).nullable(), source: z.enum(["tariff", "manual", "none"]), manual: manual.optional(), estimateId: z.string().uuid().nullable().optional(), coverage: z.enum(["published", "partial", "manual_required"]).optional() }).strict().superRefine((p, ctx) => {
    if (p.source === "manual" && !p.manual) ctx.addIssue({ code: "custom", path: ["manual"], message: "a manual DA needs actor, reason and time" });
    if (p.source !== "none" && p.usd == null) ctx.addIssue({ code: "custom", path: ["usd"], message: "a sourced DA needs an amount" });
  }),
}).strict();
const fuelSnapshot = z.object({
  kind: z.literal("fuel_index"),
  status: z.enum(["trusted", "unavailable", "manual"]),
  algorithmVersion: z.string().min(1).max(60),
  asOf: z.string().nullable(),
  requestedPort: z.string().nullable(),
  scope: z.enum(["port", "region", "global"]).nullable(),
  actualPort: z.string().nullable(),
  region: z.string().nullable(),
  contributingPorts: z.array(z.string()),
  stemMt: z.number().finite().positive().nullable(),
  products: z.array(z.object({ key: productKey, variant: z.string().nullable().optional(), averageUsdMt: z.number().finite().positive().max(10000), freshness: z.enum(["current", "stale"]), validUntil: z.string().nullable().optional(), latestQuoteAt: z.string().nullable() }).strict()),
  noOffer: z.array(productKey),
  warnings: z.array(z.string()),
  manual: manual.optional(),
  canonicalSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();

const canalSchema = z.object({
  required: z.boolean(), name: z.string().min(1).max(40),
  leg: z.enum(["laden", "ballast"]).optional(),
  status: z.enum(["trusted", "fallback", "manual", "unavailable", "invalid"]),
  costUsd: nonNeg(10_000_000).nullable(),
  transitDays: days, anchorageDays: days, anchorageInEca: z.boolean(),
  anchorageInEcaSource: z.enum(["governed", "coarse", "manual"]).optional(),
  nm: nonNeg(500),
  tariffVersionNo: z.number().int().positive().nullable(), complete: z.boolean(),
  manual: manual.optional(),
}).strict().superRefine((c, ctx) => {
  if (c.status === "manual" && !c.manual && c.costUsd != null && !c.complete) ctx.addIssue({ code: "custom", path: ["manual"], message: "a manual canal cost needs actor, reason and time" });
});

export const voyageInputSchema = z.object({
  vessel: z.object({
    name: z.string().max(120).optional(),
    speedLadenKn: z.number().finite().min(3).max(40).nullable(),
    speedBallastKn: z.number().finite().min(3).max(40).nullable(),
    consumption: z.object({ sea_laden: consumptionEntry.optional(), sea_ballast: consumptionEntry.optional(), port_working: consumptionEntry.optional(), port_idle: consumptionEntry.optional(), anchorage: consumptionEntry.optional(), eca_sea: consumptionEntry.optional() }).strict(),
    hasScrubber: z.boolean().nullable(),
    vesselClass: z.enum(["A", "B", "C"]).nullable(),
  }).strict(),
  legs: z.object({ ballast: seaLeg.nullable(), laden: seaLeg }).strict(),
  canal: canalSchema.nullable(),
  ballastCanal: canalSchema.nullable().optional(),
  vesselSource: z.enum(["profile", "manual"]).optional(),
  scheduleSource: z.enum(["listing", "manual"]).optional(),
  ports: z.object({ load: portCall, disch: portCall }).strict(),
  anchorageDays: days,
  anchorageInEca: z.boolean(),
  waitingAnchorageEcaSource: z.enum(["governed", "manual"]).optional(),
  seaMarginPct: pctSmall.nullable(),
  lane: z.string().regex(/^[A-Z0-9.]+>[A-Z0-9.]+$/).nullable(),
  season: z.enum(["winter", "spring", "summer", "autumn"]).nullable(),
  fuel: fuelSnapshot,
  settings: voyageSettingsSchema,
  settingsSource: z.enum(["governed", "defaults"]),
  revenue: z.object({ qtyMt: z.number().finite().positive().max(500000), freightUsdMt: z.number().finite().positive().max(10000), commissionPct: pctSmall }).strict().nullable(),
  extras: z.object({ insuranceUsd: nonNeg(10_000_000), stevedoringUsd: nonNeg(10_000_000), otherUsd: nonNeg(10_000_000) }).strict(),
}).strict();

export function parseVoyageInput(v: unknown): { ok: true; value: VoyageInput } | { ok: false; errors: string[] } {
  const r = voyageInputSchema.safeParse(v);
  if (!r.success) return { ok: false, errors: r.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`) };
  return { ok: true, value: r.data as VoyageInput };
}

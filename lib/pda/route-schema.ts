import { z } from "zod";

import { PDA_ROUTE_SERVICE_CODES } from "./route-types";

const nonNegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();

export const pdaRouteTimelineSchema = z.object({
  etaLoad: z.iso.datetime({ offset: true }),
  loadTurnDays: nonNegative.max(30),
  loadProductivityMtPerDay: positive.max(1_000_000),
  passageDistanceNm: positive.max(100_000),
  passageSpeedKnots: positive.max(100),
  dischargeTurnDays: nonNegative.max(30),
  dischargeProductivityMtPerDay: positive.max(1_000_000),
  dailyOpex: nonNegative.max(10_000_000).nullable(),
}).strict();

const manualLineSchema = z.object({
  ruleCode: z.string().trim().max(80).nullable().optional(),
  label: z.string().trim().min(1).max(200),
  amount: nonNegative,
  reason: z.string().trim().min(3).max(500),
}).strict();

const manualLinesSchema = z.array(manualLineSchema).max(100).superRefine((lines, ctx) => {
  const seen = new Set<string>();
  lines.forEach((line, index) => {
    if (!line.ruleCode) return;
    if (seen.has(line.ruleCode)) {
      ctx.addIssue({
        code: "custom",
        path: [index, "ruleCode"],
        message: `Duplicate manual quotation rule code: ${line.ruleCode}`,
      });
    }
    seen.add(line.ruleCode);
  });
});

const routeLegSchema = z.object({
  portLocode: z.string().trim().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
  terminalId: z.string().uuid().nullable().optional(),
  callDate: z.iso.date(),
  call: z.object({
    cargoStatus: z.enum(["laden", "ballast"]),
    voyageScope: z.enum(["domestic", "international"]),
    location: z.enum(["alongside", "anchorage"]),
    requestedServices: z.array(z.enum(PDA_ROUTE_SERVICE_CODES)).min(1).max(PDA_ROUTE_SERVICE_CODES.length),
    hours: nonNegative.nullable().optional(),
    units: nonNegative.nullable().optional(),
  }).strict(),
  manualLines: manualLinesSchema.optional(),
}).strict();

export const pdaRoutePreviewSchema = z.object({
  selection: z.object({
    vesselAvailabilityId: z.string().uuid(),
    cargoId: z.string().uuid(),
    quantityMt: positive.max(100_000_000),
  }).strict(),
  displayCurrency: z.string().trim().regex(/^[A-Z]{3}$/),
  allocation: z.enum(["vessel", "charterer"]),
  load: routeLegSchema,
  discharge: routeLegSchema,
  timeline: pdaRouteTimelineSchema,
}).strict();

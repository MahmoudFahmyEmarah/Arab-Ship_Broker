import { z } from "zod";

import { pdaRequestSchema } from "./schemas";

const nonNegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();

export const pdaRouteTimelineSchema = z.object({
  etaLoad: z.iso.datetime({ offset: true }).nullable(),
  loadTurnDays: nonNegative.max(30),
  loadProductivityMtPerDay: positive.max(1_000_000),
  passageDistanceNm: positive.max(100_000).nullable(),
  passageSpeedKnots: positive.max(100).nullable(),
  dischargeTurnDays: nonNegative.max(30),
  dischargeProductivityMtPerDay: positive.max(1_000_000),
  dailyOpex: nonNegative.max(10_000_000).nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.passageDistanceNm == null) !== (value.passageSpeedKnots == null)) {
    ctx.addIssue({
      code: "custom",
      path: [value.passageDistanceNm == null ? "passageDistanceNm" : "passageSpeedKnots"],
      message: "passage distance and speed must be supplied together",
    });
  }
});

export const pdaRoutePreviewSchema = z.object({
  selection: z.object({
    vesselAvailabilityId: z.string().uuid(),
    cargoId: z.string().uuid(),
    quantityMt: positive.max(100_000_000),
  }).strict(),
  displayCurrency: z.string().trim().regex(/^[A-Z]{3}$/),
  allocation: z.enum(["vessel", "charterer"]),
  load: pdaRequestSchema,
  discharge: pdaRequestSchema,
  timeline: pdaRouteTimelineSchema,
}).strict();

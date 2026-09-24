import { z } from "zod";

import { PDA_BASES } from "./types";

const nonNegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();

export const pdaRequestSchema = z.object({
  portLocode: z.string().trim().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
  terminalId: z.string().uuid().nullable().optional(),
  callDate: z.iso.date(),
  vessel: z.object({
    vesselId: z.string().uuid().nullable().optional(),
    vesselName: z.string().trim().max(160).nullable().optional(),
    imo: z.string().trim().max(20).nullable().optional(),
    gt: nonNegative.nullable().optional(),
    nt: nonNegative.nullable().optional(),
    scnrt: nonNegative.nullable().optional(),
    dwt: nonNegative.nullable().optional(),
    loaM: nonNegative.nullable().optional(),
    draftM: nonNegative.nullable().optional(),
    vesselType: z.string().trim().max(100).nullable().optional(),
  }),
  call: z.object({
    days: positive,
    hours: nonNegative.nullable().optional(),
    cargoQuantityMt: nonNegative.nullable().optional(),
    units: nonNegative.nullable().optional(),
    cargoType: z.string().trim().max(120).nullable().optional(),
    cargoStatus: z.enum(["laden", "ballast"]).nullable().optional(),
    voyageScope: z.enum(["domestic", "international"]).nullable().optional(),
    location: z.enum(["alongside", "anchorage"]).nullable().optional(),
    requestedServices: z.array(z.string().trim().min(1).max(80)).max(100),
  }),
  convertedCurrency: z.string().trim().regex(/^[A-Z]{3}$/).nullable().optional(),
  fxRate: positive.nullable().optional(),
  manualLines: z
    .array(
      z.object({
        ruleCode: z.string().trim().max(80).nullable().optional(),
        label: z.string().trim().min(1).max(200),
        amount: nonNegative,
        reason: z.string().trim().min(3).max(500),
        enteredBy: z.string().trim().min(1).max(160),
      }),
    )
    .max(100)
    .optional(),
});

export const pdaTariffVersionSchema = z.object({
  id: z.string().uuid(),
  tariffSetId: z.string().uuid(),
  portLocode: z.string().regex(/^[A-Z]{2}[A-Z0-9]{3}$/),
  terminalId: z.string().uuid().nullable().optional(),
  versionNo: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  effectiveFrom: z.iso.date(),
  effectiveTo: z.iso.date().nullable().optional(),
  roundingMode: z.enum(["half_up", "up", "down"]),
  decimalPlaces: z.number().int().min(0).max(6),
  rules: z.array(
    z.object({
      id: z.string().uuid(),
      code: z.string().regex(/^[a-z][a-z0-9_]{1,79}$/),
      label: z.string().trim().min(1).max(200),
      basis: z.enum(PDA_BASES),
      amount: nonNegative.nullable().optional(),
      rate: nonNegative.nullable().optional(),
      priority: z.number().int(),
      unit: z.string().trim().max(40).nullable().optional(),
      includedUnits: nonNegative.nullable().optional(),
      minimumAmount: nonNegative.nullable().optional(),
      maximumAmount: nonNegative.nullable().optional(),
      taxPercent: nonNegative.max(1000).nullable().optional(),
      applicability: z.record(z.string(), z.unknown()).optional(),
      bands: z
        .array(
          z.object({
            order: z.number().int().nonnegative(),
            lowerBound: nonNegative,
            upperBound: positive.nullable().optional(),
            flatAmount: nonNegative.nullable().optional(),
            rate: nonNegative.nullable().optional(),
          }),
        )
        .optional(),
      manualInstructions: z.string().max(1000).nullable().optional(),
      source: z.object({
        sourceId: z.string().uuid(),
        title: z.string().min(1).max(500),
        page: z.string().max(80).nullable().optional(),
        sheet: z.string().max(120).nullable().optional(),
        excerpt: z.string().max(2000).nullable().optional(),
      }),
    }),
  ),
});

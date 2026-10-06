import { z } from "zod";

import { PDA_BASES } from "./types";

const nonNegative = z.number().finite().nonnegative();
const positive = z.number().finite().positive();
const shortList = z.array(z.string().trim().min(1).max(120)).max(100);

export const pdaApplicabilitySchema = z.object({
  requestedServices: shortList.optional(),
  vesselTypes: shortList.optional(),
  cargoTypes: shortList.optional(),
  cargoStatuses: z.array(z.enum(["laden", "ballast"])).max(2).optional(),
  voyageScopes: z.array(z.enum(["domestic", "international"])).max(2).optional(),
  locations: z.array(z.enum(["alongside", "anchorage"])).max(2).optional(),
  settlementModes: z.array(z.enum(["cash", "agent_account"])).max(2).optional(),
  flagTreatments: z.array(z.enum(["foreign", "national"])).max(2).optional(),
  minGt: nonNegative.optional(), maxGt: nonNegative.optional(),
  minNt: nonNegative.optional(), maxNt: nonNegative.optional(),
  minScnrt: nonNegative.optional(), maxScnrt: nonNegative.optional(),
  minDwt: nonNegative.optional(), maxDwt: nonNegative.optional(),
  minLoaM: nonNegative.optional(), maxLoaM: nonNegative.optional(),
  minDraftM: nonNegative.optional(), maxDraftM: nonNegative.optional(),
  minCargoQuantityMt: nonNegative.optional(), maxCargoQuantityMt: nonNegative.optional(),
  percentageBaseCodes: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,79}$/)).min(1).max(100).optional(),
}).strict().superRefine((value, ctx) => {
  // C2B-009: same rule as pda_replace_tariff_rules — each value at most once.
  for (const key of ["cargoStatuses", "voyageScopes", "locations", "settlementModes", "flagTreatments"] as const) {
    const list = value[key] as string[] | undefined;
    if (list && new Set(list).size !== list.length) {
      ctx.addIssue({ code: "custom", path: [key], message: `${key} lists a value more than once` });
    }
  }
  for (const [minimum, maximum] of [
    ["minGt", "maxGt"], ["minNt", "maxNt"], ["minScnrt", "maxScnrt"],
    ["minDwt", "maxDwt"], ["minLoaM", "maxLoaM"], ["minDraftM", "maxDraftM"],
    ["minCargoQuantityMt", "maxCargoQuantityMt"],
  ] as const) {
    if (value[minimum] != null && value[maximum] != null && value[minimum] > value[maximum]) {
      ctx.addIssue({ code: "custom", path: [maximum], message: `${maximum} must be greater than or equal to ${minimum}` });
    }
  }
});

const bandUnitSchema = z.enum(["gt", "nt", "scnrt", "dwt", "loa_m", "days", "hours", "units", "cargo_mt"]);

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
    flagState: z.string().trim().regex(/^[A-Za-z]{2}$/).nullable().optional(),
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
    settlementMode: z.enum(["cash", "agent_account"]).nullable().optional(),
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
      unit: bandUnitSchema.nullable().optional(),
      includedUnits: nonNegative.nullable().optional(),
      rounding: z.enum(["exact", "started"]).nullable().optional(),
      unitSize: positive.nullable().optional(),
      minimumAmount: nonNegative.nullable().optional(),
      maximumAmount: nonNegative.nullable().optional(),
      taxPercent: nonNegative.max(1000).nullable().optional(),
      applicability: pdaApplicabilitySchema.optional(),
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
}).superRefine((version, ctx) => {
  const byCode = new Map(version.rules.map((rule) => [rule.code, rule]));
  for (const [index, rule] of version.rules.entries()) {
    if (["tiered_flat", "tiered_rate", "progressive"].includes(rule.basis) && !rule.unit) {
      ctx.addIssue({ code: "custom", path: ["rules", index, "unit"], message: `${rule.code} requires a supported band unit` });
    }
    if (rule.basis !== "percentage") continue;
    if (!rule.applicability?.percentageBaseCodes?.length) {
      ctx.addIssue({ code: "custom", path: ["rules", index, "applicability", "percentageBaseCodes"], message: `${rule.code} requires at least one percentage base code` });
    }
    for (const baseCode of rule.applicability?.percentageBaseCodes ?? []) {
      const base = byCode.get(baseCode);
      if (!base || base.priority >= rule.priority) {
        ctx.addIssue({ code: "custom", path: ["rules", index, "applicability", "percentageBaseCodes"], message: `${baseCode} must reference a lower-priority rule in the same version` });
      }
    }
  }
});

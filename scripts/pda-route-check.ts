import assert from "node:assert/strict";
import { displayStatusLabel, fromComponentStatus, fromEstimateStatus, fromPdaLeg, fromSuezLineStatus } from "../lib/economics/status";

import { aggregatePdaRoutePreview, derivePdaRouteTimeline } from "../lib/pda/route-calculate";
import { dateTimeLocalUtcIso, formatUtcTimelineInstant } from "../lib/pda/route-datetime";
import { pdaRoutePreviewSchema } from "../lib/pda/route-schema";
import type { PdaRoutePreviewInput } from "../lib/pda/route-types";
import type { PdaCalculationResult, PdaExplainedLine, PdaRequest, PdaWarning } from "../lib/pda/types";

const originalTimezone = process.env.TZ;
try {
  process.env.TZ = "Africa/Cairo";
  const cairoIso = dateTimeLocalUtcIso("2026-10-01T00:00");
  const cairoLabel = formatUtcTimelineInstant(cairoIso);
  process.env.TZ = "America/Los_Angeles";
  assert.equal(dateTimeLocalUtcIso("2026-10-01T00:00"), cairoIso);
  assert.equal(formatUtcTimelineInstant(cairoIso), cairoLabel);
  assert.equal(cairoIso, "2026-10-01T00:00:00.000Z");
  assert.match(cairoLabel, /UTC/);
} finally {
  if (originalTimezone == null) delete process.env.TZ;
  else process.env.TZ = originalTimezone;
}
assert.equal(dateTimeLocalUtcIso("2026-02-30T12:00"), null);
assert.equal(dateTimeLocalUtcIso("2026-10-01T24:00"), null);
assert.equal(dateTimeLocalUtcIso("2026-10-01T00:00:30"), null);

const timeline = derivePdaRouteTimeline(3_000, {
  etaLoad: "2026-10-01T00:00:00.000Z",
  loadTurnDays: 1,
  loadProductivityMtPerDay: 1_200,
  passageDistanceNm: 1_100,
  passageSpeedKnots: 11,
  dischargeTurnDays: 1,
  dischargeProductivityMtPerDay: 1_200,
  dailyOpex: 6_600,
});
assert.equal(timeline.loadWorkingDays, 2.5);
assert.equal(timeline.loadPortDays, 3.5);
assert.equal(timeline.passageDays, 4.1667);
assert.equal(timeline.dischargePortDays, 3.5);
assert.equal(timeline.etdLoad, "2026-10-04T12:00:00.000Z");
assert.equal(timeline.etaDischarge, "2026-10-08T16:00:02.880Z");
assert.equal(timeline.voyageOpex, 73700.22);

const request: PdaRequest = {
  portLocode: "EGALY",
  callDate: "2026-10-01",
  vessel: { vesselId: "00000000-0000-4000-8000-000000000011", vesselName: "MV BALTIC STAR" },
  call: {
    days: 3.5,
    cargoQuantityMt: 3_000,
    cargoStatus: "laden",
    voyageScope: "international",
    location: "alongside",
    requestedServices: ["port_dues"],
  },
};

function line(
  code: string,
  amount: number,
  options: { convertedAmount?: number; manual?: boolean; serviceCodes?: string[] } = {},
): PdaExplainedLine {
  return {
    ruleId: "00000000-0000-4000-8000-000000000031",
    ruleCode: code,
    label: code.replaceAll("_", " "),
    basis: options.manual ? "manual" : "per_call",
    quantity: 1,
    rate: amount,
    amount,
    ...(options.convertedAmount == null ? {} : { convertedAmount: options.convertedAmount }),
    explanation: options.manual ? "Authorized manual quotation: Agent quote Q-7" : `${code}: governed tariff line`,
    inputs: {},
    serviceCodes: options.serviceCodes ?? [code],
    manual: options.manual ?? false,
    ...(options.manual ? { manualReason: "Agent quote Q-7", enteredBy: "Test broker" } : {}),
    evidence: {
      sourceId: "00000000-0000-4000-8000-000000000032",
      title: "Published tariff evidence",
      page: "7",
    },
  };
}

function result(input: {
  nativeCurrency: string;
  native: number;
  converted?: number;
  lines?: PdaExplainedLine[];
  warnings?: PdaWarning[];
  coverage?: PdaCalculationResult["coverage"];
  tariffVersionId?: string | null;
}): PdaCalculationResult {
  return {
    coverage: input.coverage ?? "published",
    tariffVersionId: input.tariffVersionId === undefined
      ? "00000000-0000-4000-8000-000000000021"
      : input.tariffVersionId,
    nativeCurrency: input.nativeCurrency,
    ...(input.converted == null ? {} : { convertedCurrency: "USD" }),
    lines: input.lines ?? [line("port_dues", input.native, { convertedAmount: input.converted })],
    totals: { native: input.native, ...(input.converted == null ? {} : { converted: input.converted }) },
    warnings: input.warnings ?? [],
    generatedAt: "2026-09-27T00:00:00.000Z",
  };
}

const canonical = {
  vesselAvailabilityId: "00000000-0000-4000-8000-000000000010",
  vesselId: "00000000-0000-4000-8000-000000000011",
  cargoId: "00000000-0000-4000-8000-000000000012",
  quantityMt: 3_000,
  loadRequest: request,
  dischargeRequest: { ...request, portLocode: "SAJED", callDate: "2026-10-08" },
};

const aggregate = aggregatePdaRoutePreview({
  displayCurrency: "USD",
  allocation: "vessel",
  canonical,
  load: result({ nativeCurrency: "USD", native: 15_342 }),
  discharge: result({ nativeCurrency: "SAR", native: 17_940, converted: 4_784 }),
  timeline,
  generatedAt: "2026-09-27T00:00:00.000Z",
});
assert.equal(aggregate.totals.loadPort, null);
assert.equal(aggregate.totals.dischargePort, null);
assert.equal(aggregate.totals.loadPortKnown, 15_342);
assert.equal(aggregate.totals.bothPortsKnown, 20_126);
assert.equal(aggregate.totals.handlingAndAgencyComplete, null);
assert.equal(aggregate.totals.allInKnown, 20_126);
assert.equal(aggregate.totals.transit, null);
assert.deepEqual(
  aggregate.notSourced.map((item) => item.code),
  [
    "load_port_total",
    "discharge_port_total",
    "load_cargo_handling",
    "load_agency",
    "discharge_cargo_handling",
    "discharge_agency",
    "canal_and_strait_transits",
  ],
);

// FX (Wave 3 groundwork): no governed rate supplied = none reported; a supplied rate is carried, with its provenance.
assert.deepEqual(aggregate.fxRates, []);
const withFx = aggregatePdaRoutePreview({
  ...aggregate,
  canonical,
  load: result({ nativeCurrency: "USD", native: 15_342 }),
  discharge: result({ nativeCurrency: "SAR", native: 17_940, converted: 4_784 }),
  timeline,
  fxRates: [{ base: "SAR", quote: "USD", rate: 0.26666667, effectiveOn: "2026-09-26", sourceKind: "central_bank", sourceRef: "SAMA peg", inverse: false, leg: "discharge" }],
});
assert.equal(withFx.fxRates.length, 1);
assert.equal(withFx.fxRates[0]?.sourceRef, "SAMA peg");

// Transits (Wave 3): no measured route = unknown (canal item stays); a measured route with no
// chokepoint costs nothing; Suez priced complete is added; anything unpriced is listed per chokepoint.
{
  const base = { ...aggregate, canonical, load: result({ nativeCurrency: "USD", native: 15_342 }), discharge: result({ nativeCurrency: "USD", native: 4_784 }), timeline };
  assert.ok(aggregate.notSourced.some((item) => item.code === "canal_and_strait_transits"), "no measured route: transits unknown");
  const none = aggregatePdaRoutePreview({ ...base, transitFacts: { measured: true, chokepoints: [], priced: [] } });
  assert.equal(none.totals.transit, 0);
  assert.equal(none.notSourced.some((item) => item.code === "canal_and_strait_transits" || item.code.startsWith("transit_")), false);
  assert.equal(none.totals.allInKnown, none.totals.bothPortsKnown);
  const suez = { chokepoint: "SUEZ", label: "Suez Canal transit (laden, SB)", direction: "SB" as const, transitDate: "2026-10-12", status: "partial" as const, amountUsd: 310_000, undecided: 2, tariffVersionId: "v5", note: "Suez tariff v5 on 2026-10-12" };
  const priced = aggregatePdaRoutePreview({ ...base, transitFacts: { measured: true, chokepoints: ["SUEZ"], priced: [suez] } });
  assert.equal(priced.totals.transit, 310_000);
  assert.equal(priced.transits.length, 1);
  assert.equal(priced.totals.allInKnown, (priced.totals.bothPortsKnown ?? 0) + 310_000);
  const open = aggregatePdaRoutePreview({ ...base, transitFacts: { measured: true, chokepoints: ["SUEZ", "BOSPHORUS"], priced: [{ ...suez, amountUsd: null, status: "unavailable" as const, note: "No published Suez tariff covers 2026-10-12; the canal is not priced." }] } });
  assert.equal(open.totals.transit, null);
  assert.deepEqual(open.notSourced.filter((item) => item.code.startsWith("transit_")).map((item) => item.code), ["transit_suez", "transit_bosphorus"]);
  assert.match(open.notSourced.find((item) => item.code === "transit_suez")!.message, /No published Suez tariff/);
  assert.equal(open.totals.allInComplete, null);
}

// PR-13: one status vocabulary.
{
  assert.equal(fromPdaLeg({ completeAmount: 100, knownAmount: 100, governedLines: 3, manualLines: 0 }), "live");
  assert.equal(fromPdaLeg({ completeAmount: 100, knownAmount: 100, governedLines: 2, manualLines: 1 }), "manual");
  assert.equal(fromPdaLeg({ completeAmount: null, knownAmount: 60, governedLines: 2, manualLines: 0 }), "partial");
  assert.equal(fromPdaLeg({ completeAmount: null, knownAmount: null, governedLines: 0, manualLines: 1 }), "manual");
  assert.equal(fromPdaLeg({ completeAmount: null, knownAmount: null, governedLines: 0, manualLines: 0 }), "unavailable");
  assert.equal(fromSuezLineStatus("placeholder"), "fallback");
  assert.equal(fromSuezLineStatus("invalid"), "unavailable");
  assert.equal(fromComponentStatus("fallback"), "fallback");
  assert.equal(fromEstimateStatus("partial"), "partial");
  assert.equal(displayStatusLabel("unavailable"), "Unavailable");
}

const missingFx = aggregatePdaRoutePreview({
  ...aggregate,
  canonical,
  load: result({ nativeCurrency: "EGP", native: 751_758 }),
  discharge: result({ nativeCurrency: "SAR", native: 17_940, converted: 4_784 }),
  timeline,
});
assert.equal(missingFx.totals.loadPort, null);
assert.equal(missingFx.totals.loadPortKnown, null);
assert.equal(missingFx.totals.bothPortsKnown, null);
assert.equal(missingFx.notSourced[0]?.reasonCode, "FX_RATE_REQUIRED");

const noTariff = aggregatePdaRoutePreview({
  ...aggregate,
  canonical,
  load: result({
    nativeCurrency: "USD",
    native: 0,
    lines: [],
    coverage: "manual_required",
    tariffVersionId: null,
    warnings: [{ code: "NO_PUBLISHED_TARIFF", message: "No published tariff." }],
  }),
  discharge: result({ nativeCurrency: "USD", native: 400 }),
  timeline,
});
assert.equal(noTariff.totals.loadPort, null);
assert.equal(noTariff.totals.loadPortKnown, null);
assert.equal(noTariff.notSourced[0]?.reasonCode, "NO_PUBLISHED_TARIFF");
assert.equal(noTariff.notSourced[0]?.provenance.tariffVersionId, null);

const noApplicable = aggregatePdaRoutePreview({
  ...aggregate,
  canonical,
  load: result({
    nativeCurrency: "USD",
    native: 0,
    lines: [],
    coverage: "manual_required",
    warnings: [{ code: "NO_APPLICABLE_RULES", message: "No applicable rules." }],
  }),
  discharge: result({ nativeCurrency: "USD", native: 400 }),
  timeline,
});
assert.equal(noApplicable.totals.loadPort, null);
assert.equal(noApplicable.totals.loadPortKnown, null);
assert.equal(noApplicable.notSourced[0]?.reasonCode, "NO_APPLICABLE_RULES");
assert.ok(noApplicable.notSourced[0]?.provenance.tariffVersionId);

const manualRequired = aggregatePdaRoutePreview({
  ...aggregate,
  canonical,
  load: result({
    nativeCurrency: "USD",
    native: 100,
    coverage: "partial",
    warnings: [{ code: "MANUAL_QUOTE_REQUIRED", message: "Towage quote required.", ruleCode: "towage" }],
  }),
  discharge: result({ nativeCurrency: "USD", native: 400 }),
  timeline,
});
assert.equal(manualRequired.totals.loadPort, null);
assert.equal(manualRequired.totals.loadPortKnown, 100);
assert.equal(manualRequired.notSourced[0]?.reasonCode, "MANUAL_QUOTE_REQUIRED");
assert.equal(manualRequired.notSourced[0]?.provenance.ruleCode, "towage");

// C2O-051: a band gap in a published table leaves the leg incomplete with its own reason.
const tariffGap = aggregatePdaRoutePreview({
  ...aggregate,
  canonical,
  load: result({
    nativeCurrency: "USD",
    native: 100,
    coverage: "partial",
    warnings: [
      { code: "MISSING_INPUT", message: "Berth requires draft.", ruleCode: "berth" },
      { code: "TARIFF_GAP", message: "Pilotage: the published table has no band for 9999 to 15000.", ruleCode: "pilot_prog" },
    ],
  }),
  discharge: result({ nativeCurrency: "USD", native: 400 }),
  timeline,
});
assert.equal(tariffGap.totals.loadPort, null, "a gap makes the load-port total incomplete");
assert.equal(tariffGap.totals.loadPortKnown, 100);
assert.equal(tariffGap.notSourced[0]?.reasonCode, "TARIFF_GAP", "TARIFF_GAP outranks MISSING_INPUT as the leg reason");
assert.equal(tariffGap.notSourced[0]?.provenance.ruleCode, "pilot_prog");
assert.match(tariffGap.notSourced[0]?.message ?? "", /no band/);

const manualRequiredWithNoPricedLines = aggregatePdaRoutePreview({
  ...aggregate,
  canonical,
  load: result({
    nativeCurrency: "USD",
    native: 0,
    lines: [],
    coverage: "manual_required",
    warnings: [{ code: "MANUAL_QUOTE_REQUIRED", message: "Towage quote required.", ruleCode: "towage" }],
  }),
  discharge: result({ nativeCurrency: "USD", native: 400 }),
  timeline,
});
assert.equal(manualRequiredWithNoPricedLines.totals.loadPort, null);
assert.equal(manualRequiredWithNoPricedLines.totals.loadPortKnown, null);
assert.equal(manualRequiredWithNoPricedLines.notSourced[0]?.reasonCode, "MANUAL_QUOTE_REQUIRED");

const attributedManual = result({
  nativeCurrency: "USD",
  native: 150,
  coverage: "partial",
  lines: [line("port_dues", 150, { manual: true })],
  warnings: [{ code: "MANUAL_LINE", message: "Port dues supplied manually.", ruleCode: "port_dues" }],
});
const attributedAggregate = aggregatePdaRoutePreview({
  ...aggregate,
  canonical,
  load: attributedManual,
  discharge: attributedManual,
  timeline,
});
assert.equal(attributedAggregate.totals.loadPort, null);
assert.equal(attributedAggregate.totals.loadPortKnown, 150);
assert.equal(attributedAggregate.legs.load.lines[0]?.enteredBy, "Test broker");
assert.equal(attributedAggregate.legs.load.lines[0]?.evidence.page, "7");

const agencyRequested = {
  ...canonical,
  loadRequest: { ...request, call: { ...request.call, requestedServices: ["port_dues", "agency"] } },
};
const missingAgency = aggregatePdaRoutePreview({
  ...aggregate,
  canonical: agencyRequested,
  load: result({ nativeCurrency: "USD", native: 100 }),
  discharge: result({ nativeCurrency: "USD", native: 400 }),
  timeline,
});
assert.equal(missingAgency.totals.loadPort, null);
assert.equal(missingAgency.totals.loadPortKnown, 100);
assert.ok(missingAgency.notSourced.some((item) => item.code === "load_agency"));

const inclusiveRequest: PdaRequest = {
  ...request,
  call: {
    ...request.call,
    requestedServices: ["port_dues", "cargo_handling", "agency"],
  },
};
const inclusiveResult = result({
  nativeCurrency: "USD",
  native: 175,
  lines: [line("port_dues", 100), line("cargo_handling", 50), line("agency", 25)],
});
const inclusiveAggregate = aggregatePdaRoutePreview({
  ...aggregate,
  canonical: {
    ...canonical,
    loadRequest: inclusiveRequest,
    dischargeRequest: { ...inclusiveRequest, portLocode: "SAJED" },
  },
  load: inclusiveResult,
  discharge: inclusiveResult,
  timeline,
});
assert.equal(inclusiveAggregate.totals.loadPort, 175);
assert.equal(inclusiveAggregate.totals.handlingAndAgencyComplete, 350);
assert.deepEqual(inclusiveAggregate.notSourced.map((item) => item.code), ["canal_and_strait_transits"]);

const unmatchedManualAggregate = aggregatePdaRoutePreview({
  ...aggregate,
  canonical: {
    ...canonical,
    loadRequest: inclusiveRequest,
    dischargeRequest: { ...inclusiveRequest, portLocode: "SAJED" },
  },
  load: result({
    nativeCurrency: "USD",
    native: 175,
    coverage: "partial",
    lines: inclusiveResult.lines,
    warnings: [{
      code: "MANUAL_QUOTE_UNMATCHED",
      message: "Unknown manual rule was not applied.",
      ruleCode: "unknown_manual_rule",
    }],
  }),
  discharge: inclusiveResult,
  timeline,
});
assert.equal(unmatchedManualAggregate.totals.loadPort, null);
assert.equal(unmatchedManualAggregate.totals.loadPortKnown, 175);
assert.equal(unmatchedManualAggregate.notSourced[0]?.reasonCode, "MANUAL_QUOTE_UNMATCHED");
assert.equal(unmatchedManualAggregate.notSourced[0]?.provenance.ruleCode, "unknown_manual_rule");

const explicitInput: PdaRoutePreviewInput = {
  selection: {
    vesselAvailabilityId: canonical.vesselAvailabilityId,
    cargoId: canonical.cargoId,
    quantityMt: 3_000,
  },
  displayCurrency: "USD",
  allocation: "vessel",
  load: {
    portLocode: "EGALY",
    callDate: "2026-10-01",
    call: {
      cargoStatus: "laden",
      voyageScope: "international",
      location: "alongside",
      requestedServices: ["port_dues", "cargo_handling", "agency"],
    },
  },
  discharge: {
    portLocode: "SAJED",
    callDate: "2026-10-08",
    call: {
      cargoStatus: "laden",
      voyageScope: "international",
      location: "anchorage",
      requestedServices: ["port_dues", "agency"],
    },
  },
  timeline: {
    etaLoad: "2026-10-01T00:00:00.000Z",
    loadTurnDays: 0,
    loadProductivityMtPerDay: 1_200,
    passageDistanceNm: 1_100,
    passageSpeedKnots: 11,
    dischargeTurnDays: 0,
    dischargeProductivityMtPerDay: 1_200,
    dailyOpex: null,
  },
};
assert.equal(pdaRoutePreviewSchema.safeParse(explicitInput).success, true);
// PR-10a (C2B-009 ruling): settlement is an explicit per-call fact, separate from the payer allocation.
assert.equal(pdaRoutePreviewSchema.safeParse({ ...explicitInput, load: { ...explicitInput.load, call: { ...explicitInput.load.call, settlementMode: "agent_account" } } }).success, true);
assert.equal(pdaRoutePreviewSchema.safeParse({ ...explicitInput, load: { ...explicitInput.load, call: { ...explicitInput.load.call, settlementMode: null } } }).success, true, "not stated is allowed");
assert.equal(pdaRoutePreviewSchema.safeParse({ ...explicitInput, load: { ...explicitInput.load, call: { ...explicitInput.load.call, settlementMode: "vessel" } } }).success, false, "a payer value is not a settlement mode");
assert.deepEqual(explicitInput.load.call.requestedServices, ["port_dues", "cargo_handling", "agency"]);
assert.deepEqual(explicitInput.discharge.call.requestedServices, ["port_dues", "agency"]);
const cairoMidnightInput: PdaRoutePreviewInput = {
  ...explicitInput,
  load: { ...explicitInput.load, callDate: "2026-10-01" },
  timeline: { ...explicitInput.timeline, etaLoad: "2026-09-30T21:00:00.000Z" },
};
assert.equal(pdaRoutePreviewSchema.safeParse(cairoMidnightInput).success, true);
assert.equal(cairoMidnightInput.load.callDate, "2026-10-01");
assert.equal(cairoMidnightInput.timeline.etaLoad.slice(0, 10), "2026-09-30");
assert.equal(pdaRoutePreviewSchema.safeParse({
  ...explicitInput,
  load: { ...explicitInput.load, callDate: "2026-02-30" },
}).success, false);
assert.equal(pdaRoutePreviewSchema.safeParse({
  ...explicitInput,
  timeline: { ...explicitInput.timeline, etaLoad: null },
}).success, false);
assert.equal(pdaRoutePreviewSchema.safeParse({
  ...explicitInput,
  load: { ...explicitInput.load, call: { ...explicitInput.load.call, cargoStatus: null } },
}).success, false);
assert.equal(pdaRoutePreviewSchema.safeParse({
  ...explicitInput,
  discharge: { ...explicitInput.discharge, call: { ...explicitInput.discharge.call, requestedServices: [] } },
}).success, false);
assert.equal(pdaRoutePreviewSchema.safeParse({
  ...explicitInput,
  load: {
    ...explicitInput.load,
    manualLines: [{
      ruleCode: "port_dues",
      label: "Port dues quote",
      amount: 100,
      reason: "Agent quotation Q-9",
      enteredBy: "Spoofed browser identity",
    }],
  },
}).success, false);
assert.equal(pdaRoutePreviewSchema.safeParse({
  ...explicitInput,
  discharge: {
    ...explicitInput.discharge,
    manualLines: [{
      label: "Documented launch quote",
      amount: 375,
      reason: "Agent email Q-2026-17",
    }],
  },
}).success, true);
assert.equal(pdaRoutePreviewSchema.safeParse({
  ...explicitInput,
  load: {
    ...explicitInput.load,
    manualLines: [
      { ruleCode: "towage", label: "Towage Q1", amount: 100, reason: "Agent Q-1" },
      { ruleCode: "towage", label: "Towage Q2", amount: 200, reason: "Agent Q-2" },
    ],
  },
}).success, false);
assert.equal(pdaRoutePreviewSchema.safeParse({
  ...explicitInput,
  load: {
    ...explicitInput.load,
    manualLines: [
      { label: "Free quote one", amount: 100, reason: "Agent Q-1" },
      { label: "Free quote two", amount: 200, reason: "Agent Q-2" },
    ],
  },
}).success, true);

console.log("PDA ROUTE CHECK: ALL ASSERTIONS PASSED");

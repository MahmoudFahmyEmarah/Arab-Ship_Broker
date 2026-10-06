import assert from "node:assert/strict";

import { calculatePda } from "../lib/pda/calculate";
import type { PdaRequest, PdaTariffVersion } from "../lib/pda/types";

const ids = {
  set: "00000000-0000-4000-8000-000000000001",
  version: "00000000-0000-4000-8000-000000000002",
  source: "00000000-0000-4000-8000-000000000003",
  flat: "00000000-0000-4000-8000-000000000004",
  day: "00000000-0000-4000-8000-000000000005",
  progressive: "00000000-0000-4000-8000-000000000006",
  vat: "00000000-0000-4000-8000-000000000007",
  manual: "00000000-0000-4000-8000-000000000008",
};

const source = { sourceId: ids.source, title: "Verified golden tariff", page: "4" };
const version: PdaTariffVersion = {
  id: ids.version,
  tariffSetId: ids.set,
  portLocode: "EGPSD",
  terminalId: null,
  versionNo: 1,
  currency: "USD",
  effectiveFrom: "2026-01-01",
  effectiveTo: "2026-12-31",
  roundingMode: "half_up",
  decimalPlaces: 2,
  rules: [
    { id: ids.flat, code: "port_dues", label: "Port dues", basis: "per_call", amount: 100, priority: 10, source },
    { id: ids.day, code: "berth", label: "Berth", basis: "per_day", rate: 10, includedUnits: 1, priority: 20, source },
    {
      id: ids.progressive,
      code: "cargo",
      label: "Cargo charge",
      basis: "progressive",
      unit: "cargo_mt",
      priority: 30,
      source,
      bands: [
        { order: 1, lowerBound: 0, upperBound: 1000, rate: 2 },
        { order: 2, lowerBound: 1000, upperBound: null, rate: 1 },
      ],
    },
    {
      id: ids.vat,
      code: "vat",
      label: "VAT",
      basis: "percentage",
      rate: 10,
      priority: 40,
      applicability: { percentageBaseCodes: ["port_dues", "berth"] },
      source,
    },
    {
      id: ids.manual,
      code: "towage",
      label: "Towage",
      basis: "manual_quote",
      priority: 50,
      manualInstructions: "Confirm tug allocation with the port agent.",
      source,
    },
  ],
};

const request: PdaRequest = {
  portLocode: "EGPSD",
  callDate: "2026-06-01",
  vessel: { gt: 12000, dwt: 18000, vesselType: "Bulk Carrier" },
  call: { days: 3, cargoQuantityMt: 1500, requestedServices: [] },
};

const noTariff = calculatePda(request, null);
assert.equal(noTariff.coverage, "manual_required");
assert.equal(noTariff.tariffVersionId, null);

const freeQuoteWithoutTariff = calculatePda({
  ...request,
  manualLines: [{
    label: "Agent attendance",
    amount: 75,
    reason: "Agent email A-75",
    enteredBy: "Test broker",
  }],
}, null);
assert.equal(freeQuoteWithoutTariff.lines.length, 0);
assert.equal(freeQuoteWithoutTariff.totals.native, 0);
assert.equal(freeQuoteWithoutTariff.warnings.some((item) => item.code === "MANUAL_QUOTE_NOT_APPLIED"), true);
assert.match(
  freeQuoteWithoutTariff.warnings.find((item) => item.code === "MANUAL_QUOTE_NOT_APPLIED")?.message ?? "",
  /no effective published tariff and currency.*no manual amount was priced/i,
);

const noApplicable = calculatePda(
  { ...request, call: { ...request.call, requestedServices: ["towage"] } },
  { ...version, rules: [{ ...version.rules[0]!, applicability: { requestedServices: ["pilotage"] } }] },
);
assert.equal(noApplicable.lines.length, 0);
assert.equal(noApplicable.coverage, "manual_required");
assert.equal(noApplicable.warnings[0]?.code, "NO_APPLICABLE_RULES");

assert.throws(
  () => calculatePda(request, { ...version, rules: [{ ...version.rules[0]!, applicability: { minGt: "bad" } as never }] }),
  /expected number/i,
);
assert.throws(
  () => calculatePda(request, { ...version, rules: [{ ...version.rules[0]!, applicability: { minGt: 10_000, maxGt: 5_000 } }] }),
  /maxGt must be greater than or equal to minGt/i,
);
assert.throws(
  () => calculatePda(request, {
    ...version,
    rules: [{ ...version.rules[0]!, code: "vat", basis: "percentage", rate: 10, priority: 20, applicability: {} }],
  }),
  /requires at least one percentage base code/i,
);
assert.throws(
  () => calculatePda(request, {
    ...version,
    rules: [{ ...version.rules[0]!, code: "vat", basis: "percentage", rate: 10, priority: 5, applicability: { percentageBaseCodes: ["port_dues"] } }],
  }),
  /lower-priority rule/i,
);

const mismatch = calculatePda({ ...request, portLocode: "EGALY" }, version);
assert.equal(mismatch.coverage, "manual_required");
assert.equal(mismatch.warnings[0]?.code, "PORT_MISMATCH");

const portWideAtTerminal = calculatePda(
  { ...request, terminalId: "33333333-3333-4333-8333-333333333333" },
  version,
);
assert.notEqual(portWideAtTerminal.warnings[0]?.code, "TERMINAL_MISMATCH");

const scopedVersion = { ...version, terminalId: "44444444-4444-4444-8444-444444444444" };
const wrongTerminal = calculatePda(
  { ...request, terminalId: "33333333-3333-4333-8333-333333333333" },
  scopedVersion,
);
assert.equal(wrongTerminal.coverage, "manual_required");
assert.equal(wrongTerminal.warnings[0]?.code, "TERMINAL_MISMATCH");

const expired = calculatePda({ ...request, callDate: "2027-01-01" }, version);
assert.equal(expired.warnings[0]?.code, "VERSION_NOT_EFFECTIVE");

const partial = calculatePda(request, version);
assert.equal(partial.coverage, "partial");
assert.deepEqual(
  partial.lines.map((line) => [line.ruleCode, line.amount]),
  [
    ["port_dues", 100],
    ["berth", 20],
    ["cargo", 2500],
    ["vat", 12],
  ],
);
assert.equal(partial.totals.native, 2632);
assert.equal(partial.warnings[0]?.code, "MANUAL_QUOTE_REQUIRED");
assert.deepEqual(partial.lines.map((line) => line.serviceCodes), [
  ["port_dues"],
  ["berth"],
  ["cargo"],
  ["vat"],
]);

const complete = calculatePda(
  {
    ...request,
    convertedCurrency: "EUR",
    fxRate: 0.9,
    manualLines: [{ ruleCode: "towage", label: "Towage", amount: 400, reason: "Agent quotation Q-7", enteredBy: "Test broker" }],
  },
  version,
);
assert.equal(complete.coverage, "partial");
assert.equal(complete.totals.native, 3032);
assert.equal(complete.totals.converted, 2728.8);
assert.equal(complete.lines.at(-1)?.manual, true);
assert.ok(complete.lines.every((line) => line.explanation.length > 0));
assert.ok(complete.lines.every((line) => line.evidence.title));

const duplicateRuleQuotes = calculatePda({
  ...request,
  manualLines: [
    { ruleCode: "towage", label: "Towage Q1", amount: 400, reason: "Agent quotation Q-1", enteredBy: "Test broker" },
    { ruleCode: "towage", label: "Towage Q2", amount: 900, reason: "Agent quotation Q-2", enteredBy: "Test broker" },
  ],
}, version);
assert.equal(duplicateRuleQuotes.lines.some((line) => line.ruleCode === "towage"), false);
assert.equal(duplicateRuleQuotes.totals.native, 2632);
assert.equal(duplicateRuleQuotes.warnings.some((item) => item.code === "MANUAL_QUOTE_DUPLICATE"), true);
assert.equal(duplicateRuleQuotes.warnings.some((item) => item.code === "MANUAL_QUOTE_REQUIRED"), true);

const unknownRuleQuote = calculatePda({
  ...request,
  manualLines: [{
    ruleCode: "unknown_tug_rule",
    label: "Unknown tug quote",
    amount: 800,
    reason: "Agent quotation Q-X",
    enteredBy: "Test broker",
  }],
}, version);
assert.equal(unknownRuleQuote.lines.some((line) => line.label === "Unknown tug quote"), false);
assert.equal(unknownRuleQuote.warnings.some((item) => (
  item.code === "MANUAL_QUOTE_UNMATCHED" && item.ruleCode === "unknown_tug_rule"
)), true);

const nonApplicableRuleQuote = calculatePda({
  ...request,
  call: { ...request.call, cargoStatus: "laden" },
  manualLines: [{
    ruleCode: "towage",
    label: "Ballast-only towage",
    amount: 500,
    reason: "Agent quotation Q-B",
    enteredBy: "Test broker",
  }],
}, {
  ...version,
  rules: version.rules.map((rule) => (
    rule.code === "towage" ? { ...rule, applicability: { cargoStatuses: ["ballast" as const] } } : rule
  )),
});
assert.equal(nonApplicableRuleQuote.lines.some((line) => line.label === "Ballast-only towage"), false);
assert.equal(nonApplicableRuleQuote.warnings.some((item) => (
  item.code === "MANUAL_QUOTE_UNMATCHED" && item.ruleCode === "towage"
)), true);

const freeQuoteWithTariff = calculatePda({
  ...request,
  manualLines: [{
    label: "Agent attendance",
    amount: 75,
    reason: "Agent email A-75",
    enteredBy: "Test broker",
  }],
}, version);
const appliedFreeQuote = freeQuoteWithTariff.lines.find((line) => line.label === "Agent attendance");
assert.equal(appliedFreeQuote?.amount, 75);
assert.equal(appliedFreeQuote?.ruleCode, null);
assert.equal(appliedFreeQuote?.enteredBy, "Test broker");
assert.equal(appliedFreeQuote?.manualReason, "Agent email A-75");

const deterministicA = calculatePda(request, version);
const deterministicB = calculatePda(request, version);
assert.deepEqual(
  { ...deterministicA, generatedAt: "ignored" },
  { ...deterministicB, generatedAt: "ignored" },
);

// ── PR-09 robustness (B2O-012) ──────────────────────────────────────────────
// A gap in a published table is a missing line with a warning, not a crash.
const gapped = calculatePda(request, {
  ...version,
  rules: [
    version.rules[0]!,
    { id: ids.progressive, code: "pilotage", label: "Pilotage", basis: "tiered_flat", unit: "gt", priority: 30, source,
      bands: [{ order: 1, lowerBound: 0, upperBound: 9999, flatAmount: 100 }, { order: 2, lowerBound: 15000, upperBound: null, flatAmount: 300 }] },
  ],
});
assert.equal(gapped.lines.some((l) => l.ruleCode === "pilotage"), false, "gap: no priced pilotage line");
assert.equal(gapped.warnings.some((w) => w.code === "TARIFF_GAP" && w.ruleCode === "pilotage"), true, "gap: TARIFF_GAP warning");
assert.equal(gapped.coverage, "partial", "gap: the estimate is partial, not failed");
assert.equal(gapped.totals.native, 100, "gap: the rest of the tariff is still priced");

// A condition on a fact the call did not supply warns; it is never silently skipped.
const noGt = calculatePda(
  { ...request, vessel: { dwt: 18000, vesselType: "Bulk Carrier" } },
  { ...version, rules: [{ ...version.rules[0]!, applicability: { minGt: 500 } }] },
);
assert.equal(noGt.lines.length, 0);
assert.equal(noGt.warnings.some((w) => w.code === "MISSING_INPUT" && /GT/.test(w.message)), true, "missing GT: MISSING_INPUT");
assert.equal(noGt.coverage, "manual_required");
const noCargoType = calculatePda(
  request,
  { ...version, rules: [{ ...version.rules[0]!, applicability: { cargoTypes: ["clean_bulk"] } }] },
);
assert.equal(noCargoType.warnings.some((w) => w.code === "MISSING_INPUT" && /cargo type/.test(w.message)), true, "missing cargo type: MISSING_INPUT");
// A rule excluded by its requested services stays simply not applicable.
const notRequested = calculatePda(
  { ...request, vessel: { dwt: 18000 } },
  { ...version, rules: [{ ...version.rules[0]!, applicability: { requestedServices: ["pilotage"], minGt: 500 } }] },
);
assert.equal(notRequested.warnings.some((w) => w.code === "MISSING_INPUT"), false, "not requested: no missing-input noise");

// A percentage of a base that does not apply to this call counts that base as zero.
const pctReq = calculatePda({ ...request, call: { ...request.call, voyageScope: "international" } }, {
  ...version, rules: [version.rules[0]!, { ...version.rules[1]!, applicability: { voyageScopes: ["domestic"] } }, version.rules[3]!],
});
assert.equal(pctReq.lines.find((l) => l.ruleCode === "vat")?.amount, 10, "VAT on port dues only: berth does not apply");
assert.equal(pctReq.warnings.some((w) => w.code === "MISSING_INPUT"), false);

// C2O-051: a progressive table with an uncovered interval fails closed as TARIFF_GAP.
{
  const progressiveGap = (bands: NonNullable<PdaTariffVersion["rules"][number]["bands"]>) => calculatePda(
    { ...request, vessel: { gt: 20000 } },
    { ...version, rules: [version.rules[0]!, { id: ids.progressive, code: "pilot_prog", label: "Pilotage (progressive)",
      basis: "progressive", unit: "gt", priority: 30, source, bands }] },
  );
  const internal = progressiveGap([
    { order: 1, lowerBound: 0, upperBound: 9999, rate: 0.1 },
    { order: 2, lowerBound: 15000, upperBound: null, rate: 0.05 },
  ]);
  assert.equal(internal.lines.some((l) => l.ruleCode === "pilot_prog"), false, "internal gap: no underpriced line");
  assert.equal(internal.warnings.some((w) => w.code === "TARIFF_GAP" && w.ruleCode === "pilot_prog"), true, "internal gap: TARIFF_GAP");
  assert.equal(internal.coverage, "partial");
  const first = progressiveGap([{ order: 1, lowerBound: 500, upperBound: null, rate: 0.1 }]);
  assert.equal(first.warnings.some((w) => w.code === "TARIFF_GAP" && w.ruleCode === "pilot_prog"), true, "first-interval gap: TARIFF_GAP");
  const closedEnd = progressiveGap([{ order: 1, lowerBound: 0, upperBound: 10000, rate: 0.1 }]);
  assert.equal(closedEnd.warnings.some((w) => w.code === "TARIFF_GAP"), true, "quantity beyond the last closed band: TARIFF_GAP");
  const covered = progressiveGap([
    { order: 1, lowerBound: 0, upperBound: 10000, rate: 0.1 },
    { order: 2, lowerBound: 10000, upperBound: null, rate: 0.05 },
  ]);
  assert.equal(covered.lines.find((l) => l.ruleCode === "pilot_prog")?.amount, 1500, "contiguous progressive: 10,000 x 0.1 + 10,000 x 0.05");
}

// ── PR-10a: compound bases, started-unit rounding, settlement mode ──────────
{
  const egypt = (rules: PdaTariffVersion["rules"]) => ({ ...version, rules });
  const call = (days: number, extra: Partial<PdaRequest["call"]> = {}, vessel: Partial<PdaRequest["vessel"]> = {}): PdaRequest => ({
    ...request, vessel: { gt: 40000, loaM: 225, ...vessel }, call: { days, requestedServices: [], ...extra },
  });
  // Decree 488/2015: berthing dues USD 0.02 x GRT x days, part of a day = a day.
  const berth = { id: ids.day, code: "berthing_dues", label: "Berthing dues", basis: "per_gt_day" as const, rate: 0.02, rounding: "started" as const, priority: 10, source };
  const started = calculatePda(call(3.2), egypt([berth]));
  assert.equal(started.lines[0]?.amount, 3200, "0.02 x 40,000 GT x 4 started days");
  assert.equal(started.lines[0]?.inputs.rawDuration, 3.2);
  assert.equal(started.lines[0]?.inputs.roundedUnits, 4);
  assert.match(String(started.lines[0]?.inputs.formula), /ceil/);
  const exact = calculatePda(call(3.2), egypt([{ ...berth, rounding: "exact" as const }]));
  assert.equal(exact.lines[0]?.amount, 2560, "exact: 0.02 x 40,000 x 3.2");
  assert.equal(calculatePda(call(3.0000000001), egypt([berth])).lines[0]?.amount, 2400, "float noise does not add a started day");
  // Site occupation USD 12 x LOA m x days.
  const site = { id: ids.flat, code: "site_occupation", label: "Site occupation", basis: "per_loa_day" as const, rate: 12, rounding: "started" as const, priority: 10, source };
  assert.equal(calculatePda(call(2.5), egypt([site])).lines[0]?.amount, 8100, "12 x 225 m x 3 started days");
  // Bulgaria-style: EUR 0.10 per LOA metre per started hour.
  const hourly = { id: ids.progressive, code: "berth_hourly", label: "Berth (hourly)", basis: "per_loa_hour" as const, rate: 0.1, rounding: "started" as const, priority: 10, source };
  assert.equal(calculatePda(call(1, { hours: 7.5 }, { loaM: 190 }), egypt([hourly])).lines[0]?.amount, 152, "0.10 x 190 m x 8 started hours");
  // Blocks: unit size 0.5 day, started.
  assert.equal(calculatePda(call(1.2), egypt([{ ...berth, unitSize: 0.5 }])).lines[0]?.inputs.roundedUnits, 3, "1.2 days = 3 started half-days");
  // A compound rule without its factor raises MISSING_INPUT.
  const noLoa = calculatePda(call(2, {}, { loaM: null }), egypt([site]));
  assert.equal(noLoa.lines.length, 0);
  assert.equal(noLoa.warnings.some((w) => w.code === "MISSING_INPUT"), true);
  // Settlement mode is typed and used by applicability; missing is MISSING_INPUT, never inferred.
  const agentOnly = { ...version.rules[0]!, applicability: { settlementModes: ["agent_account" as const] } };
  assert.equal(calculatePda(call(1, { settlementMode: "agent_account" }), egypt([agentOnly])).lines.length, 1);
  assert.equal(calculatePda(call(1, { settlementMode: "cash" }), egypt([agentOnly])).lines.length, 0);
  assert.equal(calculatePda(call(1), egypt([agentOnly])).warnings.some((w) => w.code === "MISSING_INPUT" && /settlement mode/.test(w.message)), true);
}

console.log("PDA CHECK: ALL ASSERTIONS PASSED");

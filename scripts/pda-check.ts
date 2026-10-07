import assert from "node:assert/strict";

import { calculatePda, flagTreatment } from "../lib/pda/calculate";
import { pdaApplicabilitySchema } from "../lib/pda/schemas";
import { assertEcbFresh, ecbFeedPayloads, ecbSourceRef, fetchEcbDaily, parseEcbDaily } from "../lib/pda/ecb";
import { withJobRunStrict } from "../lib/jobs/runs";
import { resolveDeclaredFlag, resolveFlagName } from "../lib/pda/flag";
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

// Wave 2: flag treatment is derived from the flag state against the port country (UN/LOCODE prefix);
// it is used by applicability, and a rule that names one while the flag state is unknown raises MISSING_INPUT.
{
  const portVersion = { ...version, portLocode: "EGALY", rules: [{ ...version.rules[0]!, applicability: { flagTreatments: ["foreign" as const] } }] };
  const at = (flagState: string | null | undefined) =>
    calculatePda({ ...request, portLocode: "EGALY", vessel: { ...request.vessel, flagState } }, portVersion);
  assert.equal(flagTreatment({ ...request, portLocode: "EGALY", vessel: { flagState: "pa" } }), "foreign");
  assert.equal(flagTreatment({ ...request, portLocode: "EGALY", vessel: { flagState: "EG" } }), "national");
  assert.equal(flagTreatment({ ...request, portLocode: "EGALY", vessel: { flagState: "Egypt" } }), null, "a name is not a flag state");
  assert.equal(at("PA").lines.length, 1, "foreign vessel: foreign rule applies");
  assert.equal(at("EG").lines.length, 0, "national vessel: foreign rule does not apply");
  assert.equal(at("EG").warnings.some((w) => w.code === "MISSING_INPUT"), false);
  const unknown = at(null);
  assert.equal(unknown.lines.length, 0, "never guessed");
  assert.equal(unknown.warnings.some((w) => w.code === "MISSING_INPUT" && /flag state/.test(w.message)), true);
  assert.equal(pdaApplicabilitySchema.safeParse({ flagTreatments: ["foreign", "foreign"] }).success, false);
  assert.equal(pdaApplicabilitySchema.safeParse({ flagTreatments: ["domestic"] }).success, false);
  assert.equal(pdaApplicabilitySchema.safeParse({ flagTreatments: ["foreign", "national"] }).success, true);
}

// C2O-090 B2C-035 P1-1: one canonical flag resolver; unknown, inactive, malformed or ambiguous → null (never foreign).
{
  const registry = [
    { name: "Panama", iso2: "PA", aliases: ["Republic of Panama"], is_active: true },
    { name: "Malta", iso2: "MT", aliases: ["Valletta", "Shared"], is_active: true },
    { name: "Liberia", iso2: "LR", aliases: ["Monrovia", "Shared"], is_active: true },
    { name: "Madeira", iso2: "PT", aliases: ["MAR"], is_active: true },
    { name: "Portugal", iso2: "PT", aliases: ["MAR"], is_active: true },
    { name: "Old Register", iso2: "OR", aliases: [], is_active: false },
    { name: "No Code", iso2: null, aliases: ["Nocode"], is_active: true },
    { name: "Bad Code", iso2: "B1", aliases: [], is_active: true },
    { name: "Valletta", iso2: "VA", aliases: [], is_active: true },
  ];
  assert.equal(resolveFlagName(registry, "panama"), "PA", "canonical name, case-insensitive");
  assert.equal(resolveFlagName(registry, " Republic of Panama "), "PA", "alias with a single ISO");
  assert.equal(resolveFlagName(registry, "Valletta"), "VA", "an exact canonical name wins over another register's alias");
  assert.equal(resolveFlagName(registry, "Shared"), null, "an alias pointing to two ISO codes is ambiguous");
  assert.equal(resolveFlagName(registry, "MAR"), "PT", "aliases on two registers with one ISO are not ambiguous");
  assert.equal(resolveFlagName(registry, "Old Register"), null, "inactive register");
  assert.equal(resolveFlagName(registry, "No Code"), null, "register without an ISO code");
  assert.equal(resolveFlagName(registry, "Bad Code"), null, "malformed ISO code");
  assert.equal(resolveFlagName(registry, "Atlantis"), null, "unknown");
  assert.equal(resolveFlagName(registry, "—"), null);
  assert.equal(resolveFlagName(null, "Panama"), null, "registry read failure → unknown");
  assert.equal(resolveDeclaredFlag(registry, "pa"), "PA", "declared ISO carried by an active register");
  assert.equal(resolveDeclaredFlag(registry, "ZZ"), null, "declared ZZ is not a flag state");
  assert.equal(resolveDeclaredFlag(registry, "OR"), null, "declared ISO of an inactive register");
  assert.equal(resolveDeclaredFlag(registry, null), null);
  assert.equal(resolveDeclaredFlag(null, "PA"), null, "registry read failure → unknown");
  // the engine never prices an unresolved flag as foreign
  const foreignOnly: PdaTariffVersion = { ...version, portLocode: "EGALY", rules: [{ ...version.rules[0]!, applicability: { flagTreatments: ["foreign"] } }] };
  const unresolved = calculatePda({ ...request, portLocode: "EGALY", vessel: { ...request.vessel, flagState: resolveDeclaredFlag(registry, "ZZ") } }, foreignOnly);
  assert.equal(unresolved.lines.length, 0);
  assert.ok(unresolved.warnings.some((w) => w.code === "MISSING_INPUT" && /flag state/.test(w.message)));
}

// C2O-090 B2C-035 P1-2: the registered maximum draft never stands in for the call draft.
{
  const draftRule: PdaTariffVersion = { ...version, rules: [{ ...version.rules[0]!, applicability: { minDraftM: 12 } }] };
  const registeredOnly = calculatePda({ ...request, vessel: { ...request.vessel, draftM: null, registeredMaxDraftM: 14.2 } }, draftRule);
  assert.equal(registeredOnly.lines.length, 0, "a registered 14.2 m maximum does not satisfy a 12 m call-draft rule");
  assert.ok(registeredOnly.warnings.some((w) => w.code === "MISSING_INPUT" && /draft/.test(w.message)));
  const declared = calculatePda({ ...request, vessel: { ...request.vessel, draftM: 11.5, registeredMaxDraftM: 14.2 } }, draftRule);
  assert.equal(declared.lines.length, 0, "a declared 11.5 m call draft is below the 12 m threshold");
  assert.equal(declared.warnings.some((w) => w.code === "MISSING_INPUT"), false);
  const atThreshold = calculatePda({ ...request, vessel: { ...request.vessel, draftM: 12, registeredMaxDraftM: 14.2 } }, draftRule);
  assert.equal(atThreshold.lines.length, 1, "a declared 12 m call draft meets the threshold");
}

const asyncChecks: Promise<void>[] = [];

// ECB feed (owner request 7 Oct; hardened per Codex C2O-089): one dated set, rates read only inside it, every
// required currency exactly once, fresh, exact source reference; the fetch stays on the ECB origin.
{
  const xml = `<?xml version="1.0"?><gesmes:Envelope><Cube><Cube time='2026-10-07'><Cube currency='USD' rate='1.1050'/><Cube currency='JPY' rate='162.30'/><Cube currency='RON' rate='4.9765'/><Cube currency='TRY' rate='55.41'/></Cube></Cube></gesmes:Envelope>`;
  const daily = parseEcbDaily(xml);
  assert.equal(daily.date, "2026-10-07");
  assert.equal(daily.rates.USD, 1.105);
  const payloads = ecbFeedPayloads(daily);
  assert.deepEqual(payloads.map((p) => p.quoteCurrency), ["USD", "RON", "TRY"], "every wanted currency, JPY not wanted");
  assert.ok(payloads.every((p) => p.baseCurrency === "EUR" && p.sourceKind === "ecb" && p.sourceRef === ecbSourceRef("2026-10-07")));
  assert.equal(ecbSourceRef("2026-10-07"), "ECB euro foreign exchange reference rates, 2026-10-07 (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)");
  assert.throws(() => parseEcbDaily("<Cube></Cube>"), /expected one dated rate set/);
  assert.throws(() => parseEcbDaily(xml.replace("<Cube time='2026-10-07'>", "<Cube time='2026-10-07'><Cube time='2026-10-06'>")), /expected one dated rate set/);
  assert.throws(() => parseEcbDaily("<Cube time='2026-10-07'></Cube>"), /no rates/);
  assert.throws(() => parseEcbDaily(xml.replace("<Cube currency='TRY' rate='55.41'/>", "")), /required currencies missing: TRY/, "partial file refused");
  assert.throws(() => parseEcbDaily(xml.replace("<Cube currency='JPY'", "<Cube currency='USD' rate='1.2'/><Cube currency='JPY'")), /USD is listed twice/, "duplicate refused, never last-wins");
  assert.throws(() => parseEcbDaily(xml.replace("rate='4.9765'", "rate='0'")), /invalid rate for RON/);
  // a rate outside the dated container is not read
  const outside = `<Cube><Cube currency='TRY' rate='1'/><Cube time='2026-10-07'><Cube currency='USD' rate='1.1'/><Cube currency='RON' rate='4.9'/></Cube></Cube>`;
  assert.throws(() => parseEcbDaily(outside), /required currencies missing: TRY/);
  const now = new Date("2026-10-08T15:30:00Z");
  assert.doesNotThrow(() => assertEcbFresh("2026-10-08", now));
  assert.doesNotThrow(() => assertEcbFresh("2026-10-04", now), "weekend + holiday tolerated");
  assert.throws(() => assertEcbFresh("2026-10-03", now), /stale/);
  assert.throws(() => assertEcbFresh("2026-10-09", now), /future/);
}

// ECB fetch guards: ECB origin only, XML only, bounded size.
asyncChecks.push((async () => {
  const reply = (body: string, init: { url?: string; type?: string; status?: number; length?: string } = {}) =>
    (async () => {
      const response = new Response(body, { status: init.status ?? 200, headers: { "content-type": init.type ?? "text/xml", ...(init.length ? { "content-length": init.length } : {}) } });
      Object.defineProperty(response, "url", { value: init.url ?? "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml" });
      return response;
    }) as unknown as typeof fetch;
  assert.equal(await fetchEcbDaily(reply("<Cube/>")), "<Cube/>");
  await assert.rejects(fetchEcbDaily(reply("<Cube/>", { url: "https://evil.example/x.xml" })), /away from the ECB origin/);
  await assert.rejects(fetchEcbDaily(reply("<html/>", { type: "text/html" })), /unexpected content type/);
  await assert.rejects(fetchEcbDaily(reply("x".repeat(70_000))), /too large/);
  await assert.rejects(fetchEcbDaily(reply("<Cube/>", { length: "999999" })), /too large/);
  await assert.rejects(fetchEcbDaily(reply("", { status: 503 })), /answered 503/);
})());

// Job record is truthful (C2O-089): a resolved start or finalise error is reported as not persisted, never green.
asyncChecks.push((async () => {
  type Answer = { data?: unknown; error: { message: string } | null };
  const fakeDb = (start: Answer, finish: Answer) => ({
    from: () => ({
      insert: () => ({ select: () => ({ single: async () => start }) }),
      update: () => ({ eq: async () => finish }),
    }),
  }) as unknown as Parameters<typeof withJobRunStrict>[0];
  const work = async () => ({ result: "recorded", rows: 3 });
  const okRun = await withJobRunStrict(fakeDb({ data: { id: 7 }, error: null }, { error: null }), "fx-ecb", { retries: 0 }, work);
  assert.equal(okRun.finalization.persisted, true);
  const startFailed = await withJobRunStrict(fakeDb({ data: null, error: { message: "insert denied" } }, { error: null }), "fx-ecb", { retries: 0 }, work);
  assert.equal(startFailed.finalization.persisted, false, "a resolved start error is not green");
  const finishFailed = await withJobRunStrict(fakeDb({ data: { id: 7 }, error: null }, { error: { message: "update denied" } }), "fx-ecb", { retries: 0 }, work);
  assert.equal(finishFailed.finalization.persisted, false, "a resolved finalise error is not green");
  assert.match(finishFailed.finalization.error ?? "", /update denied/);
})());

// C2B-009: the TypeScript schema refuses duplicated two-value lists, like the RPC.
{
  assert.equal(pdaApplicabilitySchema.safeParse({ settlementModes: ["cash", "agent_account", "cash"] }).success, false);
  assert.equal(pdaApplicabilitySchema.safeParse({ settlementModes: ["cash", "cash"] }).success, false);
  assert.equal(pdaApplicabilitySchema.safeParse({ cargoStatuses: ["laden", "laden"] }).success, false);
  assert.equal(pdaApplicabilitySchema.safeParse({ settlementModes: ["cash", "agent_account"] }).success, true);
}

Promise.all(asyncChecks).then(
  () => console.log("PDA CHECK: ALL ASSERTIONS PASSED"),
  (error) => { console.error(error); process.exit(1); },
);

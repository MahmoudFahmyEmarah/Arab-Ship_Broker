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

const deterministicA = calculatePda(request, version);
const deterministicB = calculatePda(request, version);
assert.deepEqual(
  { ...deterministicA, generatedAt: "ignored" },
  { ...deterministicB, generatedAt: "ignored" },
);

console.log("PDA CHECK: ALL ASSERTIONS PASSED");

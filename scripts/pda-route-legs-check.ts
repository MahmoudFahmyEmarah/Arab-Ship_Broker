// PDA · per-leg route preview contract (O2ALL-008 increment B). Pure + static; no database.
//   node --import tsx scripts/pda-route-legs-check.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { aggregatePdaRoutePreview, derivePdaRouteTimeline } from "../lib/pda/route-calculate";
import {
  composePdaRoutePreview,
  composeWhenReady,
  partFailureSummary,
  PDA_PART_IDLE,
  PDA_PART_LOADING,
  type PdaPartState,
  type PdaRouteFramePreview,
  type PdaRouteLegPreview,
} from "../lib/pda/route-legs";
import type { PdaRouteFxRate } from "../lib/pda/route-types";
import type { PdaCalculationResult, PdaRequest } from "../lib/pda/types";

let n = 0;
function ok(condition: unknown, label: string) {
  assert.ok(condition, label);
  n += 1;
  console.log(`  ok   ${label}`);
}

// fixtures (shape as scripts/pda-route-check.ts)
const timeline = derivePdaRouteTimeline(3_000, {
  etaLoad: "2026-10-01T00:00:00.000Z", loadTurnDays: 1, loadProductivityMtPerDay: 1_200, passageDistanceNm: 1_100,
  passageSpeedKnots: 11, dischargeTurnDays: 1, dischargeProductivityMtPerDay: 1_200, dailyOpex: 6_600,
});
const request: PdaRequest = {
  portLocode: "EGALY", callDate: "2026-10-01",
  vessel: { vesselId: "00000000-0000-4000-8000-000000000011", vesselName: "MV BALTIC STAR" },
  call: { days: 3.5, cargoQuantityMt: 3_000, cargoStatus: "laden", voyageScope: "international", location: "alongside", requestedServices: ["port_dues"] },
};
const dischargeRequest: PdaRequest = { ...request, portLocode: "SAJED", callDate: "2026-10-08" };
function result(nativeCurrency: string, native: number, converted?: number): PdaCalculationResult {
  return {
    coverage: "published", tariffVersionId: "00000000-0000-4000-8000-000000000021", nativeCurrency,
    ...(converted == null ? {} : { convertedCurrency: "USD" }),
    lines: [{
      ruleId: "00000000-0000-4000-8000-000000000031", ruleCode: "port_dues", label: "port dues", basis: "per_call", quantity: 1,
      rate: native, amount: native, ...(converted == null ? {} : { convertedAmount: converted }),
      explanation: "port_dues: governed tariff line", inputs: {}, serviceCodes: ["port_dues"], manual: false,
      evidence: { sourceId: "00000000-0000-4000-8000-000000000032", title: "Published tariff evidence", page: "7" },
    }],
    totals: { native, ...(converted == null ? {} : { converted }) },
    warnings: [], generatedAt: "2026-09-27T00:00:00.000Z",
  };
}
const fx: PdaRouteFxRate = { base: "SAR", quote: "USD", rate: 0.26666667, effectiveOn: "2026-09-26", sourceKind: "central_bank", sourceRef: "SAMA peg", inverse: false };
const frame: PdaRouteFramePreview = {
  canonical: { vesselAvailabilityId: "00000000-0000-4000-8000-000000000010", vesselId: "00000000-0000-4000-8000-000000000011", cargoId: "00000000-0000-4000-8000-000000000012", quantityMt: 3_000 },
  timeline,
  transitFacts: { measured: true, chokepoints: [], priced: [] },
};
const load: PdaRouteLegPreview = { side: "load", request, result: result("USD", 15_342), fx: null };
const discharge: PdaRouteLegPreview = { side: "discharge", request: dischargeRequest, result: result("SAR", 17_940, 4_784), fx };
const at = "2026-10-18T00:00:00.000Z";

// 1 · composing the parts is exactly the former single aggregation
const composed = composePdaRoutePreview({ displayCurrency: "USD", allocation: "vessel", frame, load, discharge, generatedAt: at });
const direct = aggregatePdaRoutePreview({
  displayCurrency: "USD", allocation: "vessel",
  canonical: { ...frame.canonical, loadRequest: request, dischargeRequest },
  load: load.result, discharge: discharge.result, timeline, transitFacts: frame.transitFacts,
  fxRates: [{ ...fx, leg: "discharge" }], generatedAt: at,
});
ok(JSON.stringify(composed) === JSON.stringify(direct), "composing the three parts equals the single route aggregation, field for field");
ok(composed.fxRates.length === 1 && composed.fxRates[0]!.leg === "discharge", "each leg's FX rate is carried and tagged with its leg");
ok(composed.canonical.loadRequest === request && composed.canonical.dischargeRequest === dischargeRequest, "the canonical requests are the server-built ones of each leg");
assert.throws(() => composePdaRoutePreview({ displayCurrency: "USD", allocation: "vessel", frame, load: discharge, discharge: load }));
ok(true, "legs passed on the wrong side are refused, never silently swapped");

// 2 · partial states
const okPart = <T,>(data: T): PdaPartState<T> => ({ status: "ok", data });
const failed: PdaPartState<never> = { status: "failed", error: "Exchange rates could not be loaded. Please try again." };
ok(composeWhenReady({ displayCurrency: "USD", allocation: "vessel", frame: okPart(frame), load: okPart(load), discharge: okPart(discharge) }) != null,
  "the route result exists when all three parts are ready");
ok(composeWhenReady({ displayCurrency: "USD", allocation: "vessel", frame: okPart(frame), load: okPart(load), discharge: failed }) === null
  && composeWhenReady({ displayCurrency: "USD", allocation: "vessel", frame: PDA_PART_LOADING, load: okPart(load), discharge: okPart(discharge) }) === null
  && composeWhenReady({ displayCurrency: "USD", allocation: "vessel", frame: okPart(frame), load: PDA_PART_IDLE, discharge: okPart(discharge) }) === null,
  "no route total is shown while any part is loading, idle or failed");
ok(partFailureSummary({ frame: okPart(frame), load: okPart(load), discharge: failed }).startsWith("The discharge port could not be calculated."),
  "one failed leg is named on its own");
ok(partFailureSummary({ frame: failed, load: failed, discharge: okPart(discharge) }).startsWith("The load port and the voyage timeline and transits could not be calculated."),
  "several failed parts are listed together");
ok(partFailureSummary({ frame: okPart(frame), load: PDA_PART_LOADING, discharge: okPart(discharge) }) === "", "no message while nothing has failed");

// 3 · the server
const actions = readFileSync("app/(dashboard)/dashboard/ports-da/actions.ts", "utf8");
const legBody = actions.slice(actions.indexOf("export async function previewPdaRouteLeg"), actions.indexOf("export async function previewPdaRouteFrame"));
const frameBody = actions.slice(actions.indexOf("export async function previewPdaRouteFrame"), actions.indexOf("/**\n * Transits on the measured passage"));
ok(/const route = await prepareRoutePreview\(raw\);/.test(legBody) && /const route = await prepareRoutePreview\(raw\);/.test(frameBody),
  "every part re-validates the request, the member's own selection and both verified ports (prepareRoutePreview)");
ok(/pdaRoutePreviewSchema\.safeParse\(raw\)/.test(actions) && /await viewer\(\)/.test(actions.slice(actions.indexOf("async function prepareRoutePreview"))),
  "prepareRoutePreview parses the schema and applies the viewer() gate");
ok(/side !== "load" && side !== "discharge"/.test(legBody), "an unknown leg is refused");
ok(/composePdaRoutePreview\(\{ displayCurrency: route\.input\.displayCurrency/.test(actions), "the combined previewPdaRoute composes the same parts the same way");
ok(!/save|insert|persist/i.test(legBody + frameBody), "the part actions compute only; nothing is persisted");

// 4 · the page
const page = readFileSync("components/pda/PdaRouteEstimator.tsx", "utf8");
ok(!/previewPdaRoute\(/.test(page) && /previewPdaRouteLeg\(input, part\)/.test(page) && /previewPdaRouteFrame\(input\)/.test(page),
  "the page runs the three parts, not the single call");
ok(/requestSequence\.current !== sequence \|\| partTokens\.current\[part\] !== token/.test(page),
  "a stale answer (older input, or an older run of the same part) never overwrites fresher state");
ok(/function retryPart\(part: "load" \| "discharge" \| "frame"\)[\s\S]{0,200}const input = lastInput\.current;/.test(page),
  "Retry reruns only the failed part, with the same input that failed");
ok(/failure=\{loadPart\.status === "failed" \? loadPart\.error : null\}/.test(page) && /failure=\{dischargePart\.status === "failed" \? dischargePart\.error : null\}/.test(page)
  && /onRetry=\{\(\) => retryPart\("load"\)\}/.test(page) && /onRetry=\{\(\) => retryPart\("discharge"\)\}/.test(page),
  "each port card shows its own failure and its own Retry");
ok(/busy=\{loadPart\.status === "loading"\}/.test(page) && /busy=\{dischargePart\.status === "loading"\}/.test(page), "each port card shows its own loading state");
ok(/loadPart\.status === "ok" \? loadPart\.data\.result : null/.test(page) && /awaitingRoute=/.test(page),
  "a calculated leg shows its lines even when the other leg failed, with a note that totals wait");
ok(/onRetryFrame=\{framePart\.status === "failed" \? \(\) => retryPart\("frame"\) : undefined\}/.test(page) && /role="alert"/.test(page),
  "a failed timeline/transit part is announced and retried from the summary");

console.log(`PDA ROUTE LEGS CHECK: ${n} passed`);

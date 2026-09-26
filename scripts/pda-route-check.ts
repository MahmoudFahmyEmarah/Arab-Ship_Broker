import assert from "node:assert/strict";

import { aggregatePdaRoutePreview, derivePdaRouteTimeline } from "../lib/pda/route-calculate";
import type { PdaCalculationResult, PdaRequest } from "../lib/pda/types";

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
  call: { days: 3.5, cargoQuantityMt: 3_000, requestedServices: [] },
};
const result = (nativeCurrency: string, native: number, converted?: number): PdaCalculationResult => ({
  coverage: "published",
  tariffVersionId: "00000000-0000-4000-8000-000000000021",
  nativeCurrency,
  ...(converted == null ? {} : { convertedCurrency: "USD" }),
  lines: [],
  totals: { native, ...(converted == null ? {} : { converted }) },
  warnings: [],
  generatedAt: "2026-09-27T00:00:00.000Z",
});

const aggregate = aggregatePdaRoutePreview({
  displayCurrency: "USD",
  allocation: "vessel",
  canonical: {
    vesselAvailabilityId: "00000000-0000-4000-8000-000000000010",
    vesselId: "00000000-0000-4000-8000-000000000011",
    cargoId: "00000000-0000-4000-8000-000000000012",
    quantityMt: 3_000,
    loadRequest: request,
    dischargeRequest: { ...request, portLocode: "SAJED", callDate: "2026-10-08" },
  },
  load: result("USD", 15_342),
  discharge: result("SAR", 17_940, 4_784),
  timeline,
  generatedAt: "2026-09-27T00:00:00.000Z",
});
assert.equal(aggregate.totals.loadPort, 15_342);
assert.equal(aggregate.totals.dischargePort, 4_784);
assert.equal(aggregate.totals.bothPortsKnown, 20_126);
assert.equal(aggregate.totals.allInKnown, 20_126);
assert.equal(aggregate.totals.transit, null);
assert.deepEqual(aggregate.notSourced.map((item) => item.code), ["canal_and_strait_transits"]);

const missingFx = aggregatePdaRoutePreview({
  ...aggregate,
  canonical: aggregate.canonical,
  load: result("EGP", 751_758),
  discharge: result("SAR", 17_940, 4_784),
  timeline,
});
assert.equal(missingFx.totals.bothPortsKnown, null);
assert.equal(missingFx.notSourced[0]?.reasonCode, "FX_RATE_REQUIRED");

const noPassage = derivePdaRouteTimeline(3_000, {
  etaLoad: null,
  loadTurnDays: 1,
  loadProductivityMtPerDay: 1_200,
  passageDistanceNm: null,
  passageSpeedKnots: null,
  dischargeTurnDays: 1,
  dischargeProductivityMtPerDay: 1_200,
  dailyOpex: null,
});
assert.equal(noPassage.passageDays, null);
assert.equal(noPassage.etaDischarge, null);

console.log("PDA ROUTE CHECK: ALL ASSERTIONS PASSED");

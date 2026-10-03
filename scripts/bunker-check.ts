// Fuel Bar pure checks (no database): freshness tiers, normalisation over the
// stem, index maths, fallback, never-zero, cohort disclosure. The same
// fixtures run against SQL via scripts/bunker-sql-suite.ts.
//   node --import tsx scripts/bunker-check.ts
import assert from "node:assert/strict";
import {
  appliesToStem, DAY_MS, freshnessFromAgeMs, hourBucketIso, normalisedPrice, round2,
} from "../lib/bunker/freshness";
import { computeFuelPriceIndex, FuelIndexInputError } from "../lib/bunker/index";
import { INDEX_CASES, indexQuotes, PORTS, PRODUCTS } from "./bunker-fixtures";

let passed = 0;
let failed = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}\n  ${(e as Error).message.split("\n").join("\n  ")}`);
  }
}

// ── Freshness tiers (7 / 14 / 21 days) ──────────────────────────────────────
const tiers: [number, string][] = [
  [0, "current"], [7 * DAY_MS, "current"], [7 * DAY_MS + 1, "stale"],
  [14 * DAY_MS, "stale"], [14 * DAY_MS + 1, "expired"],
  [21 * DAY_MS, "expired"], [21 * DAY_MS + 1, "hidden"], [90 * DAY_MS, "hidden"],
];
for (const [age, tier] of tiers) {
  check(`freshness at ${age / DAY_MS} d is ${tier}`, () => assert.equal(freshnessFromAgeMs(age), tier));
}

// ── Normalisation ───────────────────────────────────────────────────────────
const fees = { price: 600, bargeFeeUsd: 2000, mandatoryChargesUsd: 500, minQtyMt: 300 };
check("fixed fees spread over the default 500 MT stem", () => assert.equal(normalisedPrice(fees), 605));
check("fixed fees spread over a 1000 MT stem", () => assert.equal(normalisedPrice(fees, 1000), 602.5));
check("no fees: normalised = price", () =>
  assert.equal(normalisedPrice({ price: 640, bargeFeeUsd: 0, mandatoryChargesUsd: 0, minQtyMt: null }), 640));
check("zero stem refused", () => assert.throws(() => normalisedPrice(fees, 0)));
check("quote below its minimum stem does not apply", () => {
  assert.equal(appliesToStem({ ...fees, minQtyMt: 1000 }, 500), false);
  assert.equal(appliesToStem({ ...fees, minQtyMt: 1000 }, 1000), true);
  assert.equal(appliesToStem({ ...fees, minQtyMt: null }, 1), true);
});
check("round2 rounds half away from zero like numeric round", () => {
  assert.equal(round2(651.665), 651.67);
  assert.equal(round2(-131.665), -131.67);
  assert.equal(round2(1955 / 3), 651.67);
});
check("hour bucketing floors to the hour", () =>
  assert.equal(hourBucketIso(Date.parse("2026-10-03T00:25:59Z")), "2026-10-03T00:00:00Z"));

// ── Index cases (shared with the SQL suite) ─────────────────────────────────
const input = { products: PRODUCTS, ports: PORTS, quotes: indexQuotes() };
for (const c of INDEX_CASES) {
  check(`${c.id} ${c.title}`, () => {
    if ("error" in c.expected) {
      const code = c.expected.error;
      assert.throws(() => computeFuelPriceIndex(input, c.params),
        (e: unknown) => e instanceof FuelIndexInputError && e.message.startsWith(code));
      return;
    }
    assert.deepEqual(computeFuelPriceIndex(input, c.params), c.expected);
  });
}

// ── Invariants over every successful case ───────────────────────────────────
for (const c of INDEX_CASES) {
  if ("error" in c.expected) continue;
  const r = computeFuelPriceIndex(input, c.params);
  check(`${c.id} never zero, never both offered and missing`, () => {
    for (const p of r.products) {
      assert.ok(p.averageUsdMt > 0, `${p.key} average ${p.averageUsdMt}`);
      for (const v of [p.minUsdMt, p.medianUsdMt, p.maxUsdMt]) assert.ok(v === null || v > 0);
      assert.ok(!r.noOffer.includes(p.key), `${p.key} in both products and noOffer`);
      assert.ok(p.quoteCount >= 1);
    }
    assert.ok(r.spreads.hsfoVlsfo !== 0 && r.spreads.vlsfoLsmgo !== 0);
  });
  check(`${c.id} carries no supplier identity`, () => {
    const json = JSON.stringify(r);
    assert.ok(!/src:bunker-e2e|00000000-0000-4000-b000/.test(json), "supplier name or id leaked");
  });
  check(`${c.id} cohort rule: stats only from 3 suppliers for members`, () => {
    for (const p of r.products) {
      const hidden = c.params.viewer === "member" && p.quoteCount < 3;
      assert.equal(p.cohortSuppressed, hidden);
      assert.equal(p.minUsdMt === null, hidden);
    }
  });
}

console.log(`bunker-check: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);

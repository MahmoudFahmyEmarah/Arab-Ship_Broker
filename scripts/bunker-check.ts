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
import {
  BunkerContractError, BunkerNotDeployedError, canonicalJson, getBunkerTicker, getFuelIndexSnapshot,
  getFuelPriceIndex, sealFuelIndexSnapshot,
} from "../sdk/app/bunker";
import type { SupabaseClient } from "@supabase/supabase-js";

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

// ── SDK boundary: runtime parsing and argument rules (fake client) ─────────
async function checkAsync(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
  } catch (e) {
    failed++;
    console.error(`FAIL ${name}\n  ${(e as Error).message}`);
  }
}
const fake = (data: unknown, error: { code?: string; message: string } | null = null) => {
  const calls: unknown[] = [];
  const client = { rpc: async (_fn: string, args?: unknown) => { calls.push(args); return { data, error }; } };
  return { client: client as unknown as SupabaseClient, calls };
};
const goodIndex = computeFuelPriceIndex(input, INDEX_CASES[0].params);
const goodTicker = {
  asOf: "2026-10-03T12:00:00Z",
  sponsors: [{ name: "S", url: null, port: "Piraeus", portLocode: "GRPIR", freshness: "current", ageDays: 0,
    latestQuoteAt: "2026-10-03T11:00:00Z", prices: [{ productKey: "VLSFO", label: "VLSFO", usdMt: 600, direction: "flat" }] }],
};

(async () => {
  await checkAsync("SDK accepts the contract shape", async () => {
    assert.deepEqual(await getFuelPriceIndex(fake(goodIndex).client, { portLocode: "GRPIR" }), goodIndex);
    assert.deepEqual(await getBunkerTicker(fake(goodTicker).client), goodTicker);
  });
  await checkAsync("SDK rejects a zero price from the database", async () => {
    const bad = { ...goodIndex, products: [{ ...goodIndex.products[0], averageUsdMt: 0 }] };
    await assert.rejects(getFuelPriceIndex(fake(bad).client), BunkerContractError);
  });
  await checkAsync("SDK rejects a malformed ticker", async () => {
    await assert.rejects(getBunkerTicker(fake({ sponsors: "x" }).client), BunkerContractError);
    const noPrices = { ...goodTicker, sponsors: [{ ...goodTicker.sponsors[0], prices: [] }] };
    await assert.rejects(getBunkerTicker(fake(noPrices).client), BunkerContractError);
  });
  await checkAsync("SDK refuses an empty product list and a non-positive stem", async () => {
    const f = fake(goodIndex);
    await assert.rejects(getFuelPriceIndex(f.client, { productKeys: [] }), RangeError);
    await assert.rejects(getFuelPriceIndex(f.client, { stemMt: 0 }), RangeError);
    await assert.rejects(getFuelPriceIndex(f.client, { stemMt: Number.NaN }), RangeError);
    assert.equal(f.calls.length, 0, "no RPC call on a refused argument");
  });
  await checkAsync("SDK forwards stem and keys exactly", async () => {
    const f = fake(goodIndex);
    await getFuelPriceIndex(f.client, { portLocode: "GRPIR", productKeys: ["VLSFO"], stemMt: 1000 });
    assert.deepEqual(f.calls[0], { p_port_locode: "GRPIR", p_product_keys: ["VLSFO"], p_stem_mt: 1000 });
  });
  await checkAsync("SDK reports a missing RPC distinctly", async () => {
    await assert.rejects(getBunkerTicker(fake(null, { code: "PGRST202", message: "x" }).client), BunkerNotDeployedError);
  });

  // ── B→S snapshot (C2O-033 item 3) ──────────────────────────────────────
  await checkAsync("snapshot: trusted when every requested product has a live price", async () => {
    const snap = await getFuelIndexSnapshot(fake(goodIndex).client, { portLocode: "GRPIR", productKeys: ["VLSFO", "HSFO380"] });
    assert.equal(snap.status, "trusted");
    assert.equal(snap.actualPort, "GRPIR");
    assert.deepEqual(snap.products.map((p) => [p.key, p.averageUsdMt]), [["HSFO380", 520], ["VLSFO", 620]]);
    assert.match(snap.canonicalSha256, /^[0-9a-f]{64}$/);
    const { canonicalSha256, ...body } = snap;
    assert.equal((await sealFuelIndexSnapshot(body)).canonicalSha256, canonicalSha256, "hash recomputes");
    const reordered = Object.fromEntries(Object.entries(body).reverse()) as typeof body;
    assert.equal((await sealFuelIndexSnapshot(reordered)).canonicalSha256, canonicalSha256, "key order irrelevant");
    assert.ok(!/src:bunker-e2e|00000000-0000-4000-b000/.test(JSON.stringify(snap)), "no supplier identity");
  });
  await checkAsync("snapshot: unavailable (no prices) when a requested product has no offer", async () => {
    const snap = await getFuelIndexSnapshot(fake(goodIndex).client, { portLocode: "GRPIR", productKeys: ["VLSFO", "LSMGO"] });
    assert.equal(snap.status, "unavailable");
    assert.deepEqual(snap.products, []);
    assert.deepEqual(snap.noOffer, ["LSMGO"]);
  });
  await checkAsync("snapshot: unavailable when the index is not deployed or malformed", async () => {
    const a = await getFuelIndexSnapshot(fake(null, { code: "PGRST202", message: "x" }).client, { productKeys: ["VLSFO"] });
    const b = await getFuelIndexSnapshot(fake({ nope: 1 }).client, { productKeys: ["VLSFO"] });
    for (const snap of [a, b]) {
      assert.equal(snap.status, "unavailable");
      assert.deepEqual(snap.products, []);
      assert.match(snap.canonicalSha256, /^[0-9a-f]{64}$/);
    }
    assert.match(a.warnings[0], /not deployed/);
    assert.match(b.warnings[0], /unexpected shape/);
  });
  check("canonical JSON refuses NaN and undefined, sorts keys", () => {
    assert.throws(() => canonicalJson({ a: Number.NaN }), RangeError);
    assert.throws(() => canonicalJson({ a: undefined }), RangeError);
    assert.equal(canonicalJson({ b: 1, a: [true, null, "x"] }), '{"a":[true,null,"x"],"b":1}');
  });

  console.log(`bunker-check: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();

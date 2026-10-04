// voyage-check — golden fixtures for lib/voyage/engine.ts (voyage-engine/2).
// Pins the owner's rules (days = NM ÷ (speed × 24) × (1 + margin); the 0.10 %
// product inside ECAs; HSFO only with a scrubber; port working/idle; daily cost
// by class; fuel at the index AVERAGE) and the worked example 35 MT VLSFO +
// 4 MT distillate at 844.5 / 1,601 USD = 35,961.5. Every path the audit named
// (O2C-024) is asserted as unavailable / partial / manual / invalid, never a
// silent figure. Run: npm run test:voyage
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateVoyage, seaDays, seaMarginFor, seasonOf } from "../lib/voyage/engine";
import { parseVoyageInput, parseVoyageSettings } from "../lib/voyage/schemas";
import { canonicalJson, sealSnapshot, type FuelIndexSnapshot } from "../lib/voyage/snapshots";
import { DEFAULT_VOYAGE_SETTINGS, type VoyageInput, type VoyageSettings } from "../lib/voyage/types";

let checks = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const near = (a: number | null | undefined, b: number, tol: number, msg: string) => { assert.ok(a != null && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`); checks++; };

const S: VoyageSettings = structuredClone(DEFAULT_VOYAGE_SETTINGS);
const MANUAL = { actorUserId: "user-1", reason: "agent quote 3 Oct", at: "2026-10-03T10:00:00Z" };
const index = (products: Record<string, number>, extra: Partial<FuelIndexSnapshot> = {}): FuelIndexSnapshot => ({
  kind: "fuel_index", status: "trusted", algorithmVersion: "bunker-index/1", asOf: "2026-10-03T06:00:00Z", requestedPort: "AEFJR", scope: "port", actualPort: "AEFJR", region: null,
  contributingPorts: ["AEFJR"], stemMt: 500, products: Object.entries(products).map(([key, averageUsdMt]) => ({ key, averageUsdMt, freshness: "current" as const, latestQuoteAt: "2026-10-03T05:00:00Z" })), noOffer: [], warnings: [], ...extra,
});
const noIndex = (): FuelIndexSnapshot => ({ kind: "fuel_index", status: "unavailable", algorithmVersion: "bunker-index/0", asOf: null, requestedPort: null, scope: null, actualPort: null, region: null, contributingPorts: [], stemMt: null, products: [], noOffer: [], warnings: [] });
const port = (key: "load" | "disch", over: Partial<VoyageInput["ports"]["load"]> = {}): VoyageInput["ports"]["load"] => ({ key, port: key === "load" ? "EGALY" : "SAJED", qtyMt: 0, rateMtDay: null, allowanceDays: 0, inEca: false, openLoopBan: false, euBerthOver2h: false, pda: { usd: 12000, source: "tariff" }, ...over });
const base = (over: Partial<VoyageInput> = {}): VoyageInput => ({
  vessel: { speedLadenKn: 12.5, speedBallastKn: 13, hasScrubber: false, vesselClass: "C", consumption: { sea_laden: { residual: 7, distillate: 0.8 }, sea_ballast: { residual: 6, distillate: 0.8 }, port_working: { residual: 0, distillate: 0 }, port_idle: { residual: 0, distillate: 0 }, anchorage: { residual: 0, distillate: 0 } } },
  legs: { ballast: null, laden: { key: "laden", from: "EGALY", to: "SAJED", nm: 1500, ecaNm: 0, method: "waypoints" } },
  canal: null,
  ports: { load: port("load"), disch: port("disch") },
  anchorageDays: 0, anchorageInEca: false, seaMarginPct: 0, lane: null, season: null,
  fuel: index({ VLSFO: 844.5, LSMGO: 1601, HSFO380: 450 }),
  settings: S, settingsSource: "governed", revenue: null,
  extras: { insuranceUsd: 0, stevedoringUsd: 0, otherUsd: 0 },
  ...over,
});

// ── 1 · the owner's worked example: 35 MT VLSFO + 4 MT distillate ───────────
{
  const e = estimateVoyage(base());
  eq(e.status, "trusted", "complete governed input is trusted");
  near(e.days.seaLaden, 5, 0.001, "1,500 NM at 12.5 kn, no margin = 5 days");
  const vlsfo = e.fuel.lines.find((l) => l.productKey === "VLSFO")!;
  const lsmgo = e.fuel.lines.find((l) => l.productKey === "LSMGO")!;
  near(vlsfo.mt, 35, 0.001, "35 MT VLSFO"); near(lsmgo.mt, 4, 0.001, "4 MT distillate");
  near(e.fuel.totalUsd, 35 * 844.5 + 4 * 1601, 0.01, "fuel cost 35,961.5 at the index average");
  eq([vlsfo.status, vlsfo.pricePort, vlsfo.priceScope], ["trusted", "AEFJR", "port"], "price provenance from the index snapshot");
  near(e.opex.usdDay, 2250, 0.001, "class C daily cost 1,450 + 800");
  near(e.days.total, 5 + 1.5 + 1.5, 0.001, "sea days + default port days");
  near(e.opex.usd, 2250 * e.days.total, 0.01, "running cost × total days");
  near(e.costs.totalUsd, e.costs.voyageCostsUsd + e.costs.opexUsd, 0.01, "total = voyage costs + running cost");
  ok(e.costs.complete && e.unavailable.length === 0, "nothing unavailable");
  eq(e.algorithmVersion, "voyage-engine/2", "algorithm version stamped");
  ok(e.assumptions.some((a) => a.includes("Loading: no rate declared")), "default port time listed as an assumption");
  const m = estimateVoyage(base({ legs: { ballast: null, laden: { ...base().legs.laden, method: "manual", manual: MANUAL } } }));
  eq([m.legs[0].status, m.status], ["manual", "partial"], "a manual distance is labelled and makes the estimate partial");
  ok(m.legs[0].note.includes("agent quote 3 Oct"), "the manual reason travels with the leg");
}

// ── 2 · sea margin: default + lane + season; speeds ────────────────────────
{
  near(seaDays(1100, 12.5, 5), (1100 / (12.5 * 24)) * 1.05, 1e-9, "margin applied to days");
  eq(seaDays(0, 12.5, 5), 0, "no distance → 0 days");
  const s2 = structuredClone(S); s2.seaMargin = { defaultPct: 5, byLane: { "E.MED>AG": 7 }, bySeason: { winter: 2 } };
  const m = seaMarginFor(s2, "E.MED>AG", "winter");
  eq(m.pct, 14, "default 5 + lane 7 + winter 2 = 14 %");
  ok(m.basis.includes("lane E.MED>AG") && m.basis.includes("winter"), "basis explains the allowances");
  const e = estimateVoyage(base({ seaMarginPct: null, lane: "E.MED>AG", season: "winter", settings: s2 }));
  eq(e.seaMarginPct, 14, "engine applies lane and season when no explicit margin");
  near(e.days.seaLaden, 5 * 1.14, 0.001, "days carry the 14 % margin");
  eq(estimateVoyage(base({ seaMarginPct: 3 })).seaMarginPct, 3, "an explicit margin wins");
  eq([seasonOf("2026-01-15"), seasonOf("2026-04-15"), seasonOf("2026-07-15"), seasonOf("2026-10-15"), seasonOf("2026-12-15"), seasonOf(null)], ["winter", "spring", "summer", "autumn", "winter", null], "season from the date");
  const d = estimateVoyage(base({ vessel: { ...base().vessel, speedLadenKn: null, speedBallastKn: null } }));
  ok(d.assumptions.some((a) => a.includes("Laden speed")), "defaulted speed is listed as an assumption");
  near(d.days.seaLaden, 1500 / (S.speeds.ladenKn * 24), 0.001, "default laden speed used");
}

// ── 3 · ECA miles burn the 0.10 % product; unknown share is partial, not silent ─
{
  const v = { ...base().vessel, consumption: { ...base().vessel.consumption, sea_laden: { residual: 20, distillate: 1 } } };
  const e = estimateVoyage(base({ vessel: v, legs: { ballast: null, laden: { key: "laden", from: "EGALY", to: "UAODS", nm: 1128.5, ecaNm: 580.2, method: "waypoints" } } }));
  const days = 1128.5 / (12.5 * 24); const ecaDays = days * (580.2 / 1128.5);
  near(e.fuel.lines.find((l) => l.productKey === "VLSFO")!.mt, 20 * (days - ecaDays), 0.01, "VLSFO only outside the ECA");
  near(e.fuel.lines.find((l) => l.productKey === "LSMGO")!.mt, 20 * ecaDays + 1 * days, 0.01, "LSMGO = main engine inside ECA + distillate all voyage");
  near(e.fuel.ecaMt, 20 * ecaDays, 0.01, "ECA tonnage reported");
  eq([e.legs[0].ecaShareKnown, e.legs[0].status, e.status], [true, "trusted", "trusted"], "measured route with ECA split is trusted");
  const o = estimateVoyage(base({ vessel: { ...v, consumption: { ...base().vessel.consumption, sea_laden: { residual: 20, distillate: 1 }, eca_sea: { residual: 18, distillate: 1.5 } } }, legs: { ballast: null, laden: { key: "laden", from: "GRPIR", to: "ITTAR", nm: 1000, ecaNm: 400, method: "waypoints" } } }));
  const d2 = 1000 / (12.5 * 24); const ed2 = d2 * 0.4;
  near(o.fuel.lines.find((l) => l.productKey === "LSMGO")!.mt, 18 * ed2 + 1 * (d2 - ed2) + 1.5 * ed2, 0.01, "eca_sea residual AND distillate replace the sea figures inside the ECA");
  const u = estimateVoyage(base({ vessel: v, legs: { ballast: null, laden: { key: "laden", from: "GRPIR", to: "ITTAR", nm: 1000, ecaNm: null, method: "distance_only" } } }));
  eq([u.legs[0].ecaShareKnown, u.legs[0].status, u.status], [false, "fallback", "partial"], "unknown ECA share → leg fallback, estimate partial (ruling D1)");
  ok(u.warnings.some((w) => w.includes("ECA share unknown")) && u.fuel.ecaMt === 0, "warning says why; priced as non-ECA");
}

// ── 4 · scrubber: HSFO at sea; compliant product in a banned/EU port; unknown scrubber ─
{
  const v = { ...base().vessel, hasScrubber: true, consumption: { ...base().vessel.consumption, sea_laden: { residual: 20, distillate: 1 } } };
  const vp = { ...v, consumption: { ...v.consumption, port_working: { residual: 3, distillate: 1 }, port_idle: { residual: 1, distillate: 0.5 } } };
  const e = estimateVoyage(base({ vessel: v, legs: { ballast: null, laden: { key: "laden", from: "GRPIR", to: "ITTAR", nm: 1000, ecaNm: 400, method: "waypoints" } } }));
  const d = 1000 / (12.5 * 24);
  eq(e.fuel.residualProduct, "HSFO380", "scrubber → HSFO 380");
  near(e.fuel.lines.find((l) => l.productKey === "HSFO380")!.mt, 20 * d, 0.01, "all main-engine fuel at sea is HSFO, inside the ECA too");
  ok(!e.fuel.lines.some((l) => l.productKey === "VLSFO") && e.fuel.ecaMt === 0, "no VLSFO, no ECA switch at sea");
  const banned = estimateVoyage(base({ vessel: vp, ports: { load: port("load", { qtyMt: 10000, rateMtDay: 5000, openLoopBan: true }), disch: port("disch") } }));
  const loadLeg = banned.legs.find((l) => l.key === "load")!;
  ok(loadLeg.burns.some((b) => b.productKey === "LSMGO") && !loadLeg.burns.some((b) => b.productKey === "HSFO380"), "open-loop ban in port → compliant product, no HSFO in port");
  ok(loadLeg.note.includes("open-loop ban"), "the leg note names the reason");
  const eu = estimateVoyage(base({ vessel: vp, ports: { load: port("load", { qtyMt: 10000, rateMtDay: 5000, euBerthOver2h: true }), disch: port("disch") } }));
  ok(!eu.legs.find((l) => l.key === "load")!.burns.some((b) => b.productKey === "HSFO380"), "EU berth > 2 h → compliant product in port");
  const unknown = estimateVoyage(base({ vessel: { ...v, hasScrubber: null } }));
  eq([unknown.fuel.residualProduct, unknown.status], ["VLSFO", "partial"], "unknown scrubber → priced as no scrubber, estimate partial");
  ok(unknown.assumptions.some((a) => a.includes("Scrubber status not declared")), "the assumption is stated");
}

// ── 5 · class multipliers, assumed class ────────────────────────────────────
{
  for (const [cls, mult] of [["A", 2.2], ["B", 1.5], ["C", 1.0]] as const) near(estimateVoyage(base({ vessel: { ...base().vessel, vesselClass: cls } })).opex.usdDay, 2250 * mult, 0.001, `class ${cls} daily cost × ${mult}`);
  const n = estimateVoyage(base({ vessel: { ...base().vessel, vesselClass: null } }));
  ok(n.opex.classAssumed && n.opex.vesselClass === "C" && n.assumptions.some((a) => a.includes("class C")), "unknown class → C assumed and stated");
  const custom = structuredClone(S); custom.opex = { crewUsdDay: 2000, maintenanceUsdDay: 1000 }; custom.classMultipliers = { A: 3, B: 2, C: 1 };
  near(estimateVoyage(base({ settings: custom, vessel: { ...base().vessel, vesselClass: "B" } })).opex.usdDay, 6000, 0.001, "settings drive the running cost");
}

// ── 6 · canal: trusted / manual / unavailable snapshots ─────────────────────
{
  const v = { ...base().vessel, consumption: { ...base().vessel.consumption, sea_laden: { residual: 7, distillate: 0.8 }, anchorage: { residual: 2, distillate: 0.5 } } };
  const canal = { required: true, name: "Suez", status: "trusted" as const, costUsd: 201075, transitDays: 1, anchorageDays: 0.5, anchorageInEca: true, nm: 100, tariffVersionNo: 1, complete: true };
  const e = estimateVoyage(base({ vessel: v, canal }));
  eq([e.days.canalTransit, e.days.canalAnchorage], [1, 0.5], "canal days");
  eq(e.costs.canal, { usd: 201075, status: "trusted", required: true }, "canal cost into voyage costs");
  const anch = e.legs.find((l) => l.key === "canal_anchorage")!;
  ok(anch.ecaDays === 0.5 && anch.burns.some((b) => b.productKey === "LSMGO" && Math.abs(b.mt - (2 * 0.5 + 0.5 * 0.5)) < 0.001), "Port Said anchorage burns the compliant product");
  const bad = estimateVoyage(base({ vessel: v, canal: { ...canal, status: "unavailable", costUsd: null, complete: false } }));
  eq([bad.costs.canal.usd, bad.costs.canal.status, bad.status, bad.costs.complete], [null, "unavailable", "partial", false], "unavailable Suez estimate → canal cost null, estimate partial, incomplete");
  ok(bad.unavailable.some((u) => u.code === "canal"), "canal listed as unavailable");
  const partialSuez = estimateVoyage(base({ vessel: v, canal: { ...canal, complete: false } }));
  eq(partialSuez.costs.canal.status, "unavailable", "an incomplete Suez estimate is never taken as a scalar cost");
  eq(estimateVoyage(base({ vessel: v, canal: { ...canal, status: "manual" } })).status, "partial", "a manual Suez figure makes the voyage partial");
}

// ── 7 · ports: rate, allowance, working/idle, DAs ───────────────────────────
{
  const v = { ...base().vessel, consumption: { ...base().vessel.consumption, sea_laden: { residual: 7, distillate: 0.8 }, port_working: { residual: 3, distillate: 1 }, port_idle: { residual: 1, distillate: 0.5 } } };
  const e = estimateVoyage(base({ vessel: v, ports: {
    load: port("load", { qtyMt: 30000, rateMtDay: 5000, allowanceDays: 0.5, inEca: true, pda: { usd: 18000, source: "tariff" } }),
    disch: port("disch", { qtyMt: 30000, rateMtDay: 10000, pda: { usd: 42000, source: "manual", manual: MANUAL } }),
  } }));
  near(e.days.portLoad, 6.5, 0.001, "30,000 ÷ 5,000 + 0.5 allowance"); near(e.days.portDisch, 3, 0.001, "30,000 ÷ 10,000");
  const load = e.legs.find((l) => l.key === "load")!;
  near(load.burns.filter((b) => b.productKey === "LSMGO").reduce((a, b) => a + b.mt, 0), 3 * 5.2 + 1 * 5.2 + 1 * 1.3 + 0.5 * 1.3, 0.01, "ECA port: main + aux on the compliant product, working and idle");
  near(e.legs.find((l) => l.key === "disch")!.burns.find((b) => b.productKey === "VLSFO")!.mt, 3 * 2.4 + 1 * 0.6, 0.01, "non-ECA port burns VLSFO for the residual share");
  eq([e.costs.pdaLoad, e.costs.pdaDisch], [{ usd: 18000, status: "trusted" }, { usd: 42000, status: "manual" }], "DAs carry their source");
  eq(e.status, "partial", "a manual DA makes the estimate partial");
  const none = estimateVoyage(base({ ports: { load: port("load", { pda: { usd: null, source: "none" } }), disch: port("disch") } }));
  eq([none.costs.pdaLoad, none.costs.complete], [{ usd: null, status: "unavailable" }, false], "no DA → unavailable, total incomplete (never 0)");
  ok(none.unavailable.some((u) => u.code === "pda_load"), "load DA listed as unavailable");
}

// ── 8 · anchorage, prices: index / fallback / unavailable; missing consumption ──
{
  const v = { ...base().vessel, consumption: { ...base().vessel.consumption, sea_laden: { residual: 7, distillate: 0.8 }, anchorage: { residual: 1.5, distillate: 0.4 } } };
  const a = estimateVoyage(base({ vessel: v, anchorageDays: 2 }));
  near(a.legs.find((l) => l.key === "anchorage")!.burns.find((b) => b.productKey === "VLSFO")!.mt, 3, 0.001, "anchorage burn");
  const fb = estimateVoyage(base({ fuel: index({ LSMGO: 1601 }, { noOffer: ["VLSFO"] }) }));
  const vl = fb.fuel.lines.find((l) => l.productKey === "VLSFO")!;
  eq([vl.status, vl.usdMt, fb.fuel.status, fb.status], ["fallback", S.fuelFallback.VLSFO, "fallback", "partial"], "no offer → admin fallback, labelled, estimate partial (ruling D2)");
  ok(fb.warnings.some((w) => w.includes("no current offer")), "warning names the no-offer");
  const off = estimateVoyage(base({ fuel: noIndex() }));
  eq([off.fuel.status, off.status], ["fallback", "partial"], "index not deployed → every line fallback, partial");
  const noFb = structuredClone(S); noFb.fuelFallback = {};
  const nf = estimateVoyage(base({ fuel: noIndex(), settings: noFb }));
  eq([nf.fuel.status, nf.fuel.lines[0].usd, nf.costs.complete], ["unavailable", null, false], "no index and no fallback → fuel unavailable, total incomplete");
  const stale = estimateVoyage(base({ fuel: index({ VLSFO: 800, LSMGO: 1500 }, { products: [{ key: "VLSFO", averageUsdMt: 800, freshness: "stale", latestQuoteAt: null }, { key: "LSMGO", averageUsdMt: 1500, freshness: "current", latestQuoteAt: null }] }) }));
  ok(stale.warnings.some((w) => w.includes("stale")), "stale quotes are flagged");
  const nc = estimateVoyage(base({ vessel: { ...base().vessel, consumption: {} } }));
  eq([nc.legs[0].status, nc.fuel.totalMt, nc.costs.complete], ["unavailable", 0, false], "no consumption → leg unavailable, no tonnage invented");
  ok(nc.unavailable.some((u) => u.code === "laden_fuel"), "missing consumption is listed");
  const noBallastCons = estimateVoyage(base({ legs: { ballast: { key: "ballast", from: "TRIST", to: "EGALY", nm: 500, ecaNm: 0, method: "distance_only" }, laden: base().legs.laden }, vessel: { ...base().vessel, consumption: { sea_laden: { residual: 7, distillate: 0.8 }, port_working: { residual: 0, distillate: 0 }, port_idle: { residual: 0, distillate: 0 } } } }));
  eq(noBallastCons.legs.find((l) => l.key === "ballast")!.status, "unavailable", "ballast figures missing → ballast leg unavailable (no substitution from laden)");
  near(noBallastCons.days.seaBallast, 500 / (13 * 24), 0.01, "its days still count");
  const noDistance = estimateVoyage(base({ legs: { ballast: null, laden: { key: "laden", from: "GRPIR", to: "ITTAR", nm: null, ecaNm: null, method: "none" } } }));
  eq(noDistance.status, "unavailable", "no laden distance → estimate unavailable");
}

// ── 9 · revenue, TCE, settings source ──────────────────────────────────────
{
  const e = estimateVoyage(base({ revenue: { qtyMt: 30000, freightUsdMt: 25, commissionPct: 2.5 }, extras: { insuranceUsd: 2000, stevedoringUsd: 0, otherUsd: 500 } }));
  near(e.revenue!.grossFreightUsd, 750000, 0, "gross freight"); near(e.revenue!.commissionUsd, 18750, 0, "commission 2.5 %"); near(e.revenue!.netFreightUsd, 731250, 0, "net freight");
  near(e.revenue!.tceUsdDay, (731250 - e.costs.voyageCostsUsd) / e.days.total, 0.01, "TCE = (net − voyage costs) ÷ days");
  near(e.revenue!.resultAfterOpexUsd, 731250 - e.costs.voyageCostsUsd - e.costs.opexUsd, 0.01, "result after running cost");
  eq(estimateVoyage(base()).revenue, null, "no freight → no revenue block");
  const d = estimateVoyage(base({ settingsSource: "defaults" }));
  eq([d.settingsSource, d.status], ["defaults", "partial"], "compiled defaults → partial, never silent");
  ok(d.warnings.some((w) => w.includes("compiled defaults")), "warning says settings were not governed");
}

// ── 10 · fail-closed input boundary ────────────────────────────────────────
{
  const bad = (patch: (i: VoyageInput) => unknown) => estimateVoyage(patch(structuredClone(base())) as VoyageInput);
  eq(bad((i) => ({ ...i, vessel: { ...i.vessel, speedLadenKn: -12 } })).status, "invalid", "negative speed rejected");
  eq(bad((i) => ({ ...i, vessel: { ...i.vessel, speedLadenKn: 0 } })).status, "invalid", "zero speed rejected");
  eq(bad((i) => ({ ...i, legs: { ...i.legs, laden: { ...i.legs.laden, nm: -100 } } })).status, "invalid", "negative distance rejected");
  eq(bad((i) => ({ ...i, legs: { ...i.legs, laden: { ...i.legs.laden, nm: 100, ecaNm: 200 } } })).status, "invalid", "ECA miles above the distance rejected");
  eq(bad((i) => ({ ...i, legs: { ...i.legs, laden: { ...i.legs.laden, method: "manual" } } })).status, "invalid", "manual distance without provenance rejected");
  eq(bad((i) => ({ ...i, anchorageDays: Number.NaN })).status, "invalid", "NaN days rejected");
  eq(bad((i) => ({ ...i, fuel: { ...i.fuel, products: [{ key: "VLSFO", averageUsdMt: -5, freshness: "current", latestQuoteAt: null }] } })).status, "invalid", "negative price rejected");
  eq(bad((i) => ({ ...i, revenue: { qtyMt: 30000, freightUsdMt: 25, commissionPct: 250 } })).status, "invalid", "commission above 100 % rejected");
  eq(bad((i) => ({ ...i, ports: { ...i.ports, load: { ...i.ports.load, pda: { usd: 1000, source: "manual" } } } })).status, "invalid", "manual DA without provenance rejected");
  eq(bad((i) => ({ ...i, vessel: { ...i.vessel, consumption: { ...base().vessel.consumption, sea_laden: { residual: 7, distillate: 0.8, extra: 1 } } } })).status, "invalid", "unknown keys rejected (strict)");
  const inv = bad((i) => ({ ...i, vessel: { ...i.vessel, speedLadenKn: -12 } }));
  ok((inv.errors?.length ?? 0) > 0 && inv.costs.totalUsd === 0 && !inv.costs.complete, "invalid input yields errors and no total");
  ok(parseVoyageInput(base()).ok, "the fixture itself validates");
}

// ── 11 · snapshot sealing is canonical ─────────────────────────────────────
{
  const a = sealSnapshot(index({ VLSFO: 800, LSMGO: 1500 }));
  const b = sealSnapshot({ ...index({ LSMGO: 1500, VLSFO: 800 }), products: [...index({ VLSFO: 800, LSMGO: 1500 }).products] });
  eq(a.canonicalSha256, b.canonicalSha256, "key order does not change the hash");
  ok(/^[a-f0-9]{64}$/.test(a.canonicalSha256), "sha-256 hex");
  eq(canonicalJson({ b: 1, a: [{ d: 2, c: undefined }] }), '{"a":[{"d":2}],"b":1}', "sorted keys, undefined dropped");
  assert.throws(() => canonicalJson({ x: Number.NaN }), /non-finite/); checks++;
}

// ── 12 · contract: settings default vs seed + governance patch ──────────────
{
  const sql = readFileSync(new URL("../supabase/migrations/20261003203000_voyage_settings_seed.sql", import.meta.url), "utf8");
  const m = sql.match(/\$json\$([\s\S]*?)\$json\$/);
  ok(!!m, "seed migration carries the voyage_settings JSON");
  const seeded = JSON.parse(m![1]) as VoyageSettings;
  seeded.eca.distillateProductKey = "LSMGO"; // added by 20261003205000
  eq(seeded, DEFAULT_VOYAGE_SETTINGS, "DEFAULT_VOYAGE_SETTINGS = 203000 seed + the 205000 patch");
  const gov = readFileSync(new URL("../supabase/migrations/20261003205000_suez_voyage_governance.sql", import.meta.url), "utf8");
  ok(gov.includes("'{eca,distillateProductKey}'") && gov.includes("'seedMarker', 'stream-s-20261003'"), "governance migration patches distillateProductKey and the seed marker");
  ok(sql.includes("on conflict (key) do nothing"), "seed is idempotent on the voyage_settings key");
  // The settings reader is fail-closed: a malformed governed row is reported, never shallow-merged into the defaults.
  ok(parseVoyageSettings(DEFAULT_VOYAGE_SETTINGS).ok, "the compiled defaults validate");
  ok(!parseVoyageSettings(null).ok && !parseVoyageSettings({}).ok, "a missing or empty row is rejected");
  ok(!parseVoyageSettings({ ...DEFAULT_VOYAGE_SETTINGS, speeds: { ladenKn: -1, ballastKn: 13 } }).ok, "a negative speed is rejected");
  ok(!parseVoyageSettings({ ...DEFAULT_VOYAGE_SETTINGS, opex: { crewUsdDay: 1450, maintenanceUsdDay: 800, extra: 1 } }).ok, "an unknown nested key is rejected");
  ok(!parseVoyageSettings({ ...DEFAULT_VOYAGE_SETTINGS, fuelFallback: { VLSFO: "585" } }).ok, "a string price is rejected");
  ok(!parseVoyageSettings({ ...DEFAULT_VOYAGE_SETTINGS, seaMargin: { defaultPct: 5, byLane: { "bad lane": 7 } } }).ok, "a malformed lane key is rejected");
  const runs = readFileSync(new URL("../supabase/migrations/20261003204000_voyage_estimate_runs.sql", import.meta.url), "utf8");
  const orgFix = readFileSync(new URL("../supabase/migrations/20261003205300_voyage_save_org_fix.sql", import.meta.url), "utf8");
  ok(orgFix.includes("order by om.added_at asc nulls last"), "save_voyage_estimate orders memberships by organization_members.added_at");
  ok(!orgFix.includes("om.created_at"), "the misnamed membership column is gone from the save function");
  for (const s of ["create table if not exists public.voyage_estimate_runs", "fuel_index_snapshot", "route_eca_snapshot", "suez_cost_snapshot", "port_cost_snapshot", "settings_hash", "VOYAGE_IMMUTABLE", "grant execute on function public.save_voyage_estimate(uuid, jsonb) to service_role", "grant execute on function public.get_voyage_estimate(uuid) to authenticated, service_role"]) ok(runs.includes(s), `runs migration carries: ${s.slice(0, 50)}`);
}

console.log(`voyage-check: ${checks} checks passed`);

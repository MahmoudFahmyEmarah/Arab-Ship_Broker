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
import { CALCULATOR_MEMBER_ROLLOUT, decideCalculatorAccess } from "../lib/voyage/calculator-policy";
import { canalDirection, canalFromSuez, suezTransitDate } from "../lib/voyage/canal";
import { voyageFuelProducts } from "../lib/voyage/fuel-source";
import { estimateSuezTransit } from "../lib/suez/engine";
import type { SuezInput, SuezTariffContext, SuezTariffItem } from "../lib/suez/types";

let checks = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); checks++; };
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepStrictEqual(a, b, msg); checks++; };
const near = (a: number | null | undefined, b: number, tol: number, msg: string) => { assert.ok(a != null && Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`); checks++; };

const S: VoyageSettings = structuredClone(DEFAULT_VOYAGE_SETTINGS);
S.seaMargin.defaultPct = 0; // fixtures sail on the governed margin (an entered margin is a broker input since C2O-044 #5)
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
  anchorageDays: 0, anchorageInEca: false, seaMarginPct: null, lane: null, season: null,
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

// ── 13 · audit C2O-039: entitlement, canal status, assumed class, server-side provenance ─
{
  // P0-4 · one entitlement rule
  const row = (over: Record<string, unknown> = {}) => ({ id: "u-1", role: "Broker", is_active: true, subscription_tier: "T3", is_market_partner: false, ...over });
  eq(decideCalculatorAccess({ authenticated: false, row: null, claimRole: null }).allowed, false, "signed out → refused");
  eq(decideCalculatorAccess({ authenticated: true, row: null, claimRole: null }), { allowed: false, reason: "no_profile", tier: null }, "no portal profile → refused");
  eq(decideCalculatorAccess({ authenticated: true, row: row({ role: "admin", is_active: false }), claimRole: "admin" }), { allowed: false, reason: "inactive", tier: null }, "an inactive admin is refused");
  eq(decideCalculatorAccess({ authenticated: true, row: row({ role: "admin" }), claimRole: "admin" }), { allowed: true, actorId: "u-1", kind: "admin", tier: "T3" }, "admin row + admin claim → allowed as admin");
  eq(decideCalculatorAccess({ authenticated: true, row: row({ role: "admin" }), claimRole: null }).allowed, false, "admin row without the Auth claim is a member (rollout off → refused)");
  eq(decideCalculatorAccess({ authenticated: true, row: row({ subscription_tier: "T2" }), claimRole: null }), { allowed: false, reason: "tier_locked", tier: "T2" }, "T2 member → locked");
  eq(decideCalculatorAccess({ authenticated: true, row: row(), claimRole: null }), { allowed: false, reason: "rollout", tier: "T3" }, "T3 member while the rollout is off → refused");
  eq(decideCalculatorAccess({ authenticated: true, row: row(), claimRole: null, memberRollout: true }), { allowed: true, actorId: "u-1", kind: "member", tier: "T3" }, "T3 member after the rollout → allowed");
  eq(decideCalculatorAccess({ authenticated: true, row: row({ subscription_tier: "T1", is_market_partner: true }), claimRole: null, memberRollout: true }).allowed, true, "a market partner counts as T3");
  ok(CALCULATOR_MEMBER_ROLLOUT === false, "member rollout stays off until the production data exists");

  // P1-8 · the canal is trusted only from a trusted Suez estimate
  const sItem = (code: string, layer: SuezTariffItem["layer"], basis: SuezTariffItem["basis"], params: Record<string, unknown>, extra: Partial<SuezTariffItem> = {}): SuezTariffItem =>
    ({ code, labelEn: code, layer, basis, currency: "SDR", params, directionScope: "any", cargoStatusScope: "any", conditionKey: null, payerParty: "owner", sortOrder: 10, ...extra });
  const sCtx = (regime: "unknown" | "none" | "modelled", items: SuezTariffItem[] = []): SuezTariffContext => ({
    found: true, date: "2026-10-05", version: { id: "v", versionNo: 4, effectiveFrom: "2026-10-01", effectiveTo: null, sourceRef: "fixture", surchargeRegime: regime },
    items: [sItem("transit_toll", "toll", "toll_tiered_scnt", {}), sItem("pilotage", "fixed", "flat", { amount: 316 }, { currency: "USD" }), ...items],
    tiers: [{ vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 0, scntFrom: 0, scntTo: null, sdrPerScnt: 5, confidence: "official" }],
    sdr: { rateUsd: 1.35, asOf: "2026-10-01", source: "IMF" }, suezDays: { transitDays: 1, anchorageDays: 0.5, nm: 100 }, sources: [{ id: "src", title: "SCA schedule (fixture)", issuer: "Suez Canal Authority", documentNo: null, issueDate: "2023-10-17", authority: "official", evidenceStatus: "on_file", sha256: "1e98fa11b6183c4beefa21b6a21c7a199eb7bd17b9e2c082b7f6e951ca54c35f" }],
  });
  const sIn: SuezInput = { vessel: { scnt: 10000, gt: 12000, category: "dry_bulk", buildYear: 2015, searchlightCompliant: true, firstTransit: false }, voyage: { direction: "SB", cargoStatus: "laden", transitDate: "2026-10-05" } };
  const sur = (confidence: "official" | "reported") => sItem("surcharge_dry_bulk", "surcharge", "pct_of_toll", { pct: 22 }, { categoryScope: ["dry_bulk"], confidence });
  const G = { anchorageInEca: true, anchorageInEcaSource: "governed" as const };
  const trustedSuez = estimateSuezTransit(sIn, sCtx("modelled", [sur("official")]));
  eq(trustedSuez.status, "trusted", "fixture Suez estimate is trusted");
  eq(canalFromSuez(trustedSuez, S, G).status, "trusted", "trusted Suez → trusted canal");
  const reportedSuez = estimateSuezTransit(sIn, sCtx("modelled", [sur("reported")]));
  const fb = canalFromSuez(reportedSuez, S, G);
  ok(fb.status === "fallback" && fb.costUsd === reportedSuez.totals.appliedUsd, "a partial-but-complete Suez estimate → fallback canal with its labelled figure");
  const unk = canalFromSuez(estimateSuezTransit(sIn, sCtx("unknown")), S, G);
  ok(unk.status === "unavailable" && unk.costUsd == null, "base dues without the surcharge → canal unavailable, no figure");
  const manualSuez = estimateSuezTransit({ ...sIn, overrides: { sdrRate: { value: 1.4, reason: "bank rate today", actorUserId: "u-1", at: "2026-10-05T08:00:00Z" } } }, sCtx("modelled", [sur("official")]));
  eq(canalFromSuez(manualSuez, S, G).status, "manual", "only the stamped SDR override departs from trusted → manual canal");
  eq(canalFromSuez(null, S, G).status, "unavailable", "no Suez estimate → unavailable");
  const v = { ...base().vessel, consumption: { ...base().vessel.consumption, anchorage: { residual: 2, distillate: 0.5 } } };
  const ve = estimateVoyage(base({ vessel: v, canal: fb }));
  ok(ve.costs.canal.status === "fallback" && ve.costs.canal.usd === fb.costUsd && ve.status === "partial", "a fallback canal is costed, labelled, and keeps the voyage partial");
  ok(ve.warnings.some((w) => w.includes("labelled fallback")), "the fallback canal is explained");

  // P1-8 · an assumed cost class is a stated assumption AND a partial estimate
  eq(estimateVoyage(base({ vessel: { ...base().vessel, vesselClass: null } })).status, "partial", "unknown class → partial (never trusted on an assumed multiplier)");

  // P0-3 / P0-4 / P1-9 · contract: the save re-resolves legs and the guard covers every action
  const act = readFileSync(new URL("../app/(dashboard)/dashboard/voyage-estimator/actions.ts", import.meta.url), "utf8");
  ok((act.match(/await resolveCalculatorAccess\(\)/g) ?? []).length >= 2, "both voyage actions pass the entitlement guard");
  ok(act.includes("lookupLeg(supabase, from, to, today)") && !act.includes("payload.routeLegs") && !act.includes("payload.routeMeta"), "legs and route metadata are resolved on the server, never taken from the browser");
  ok(act.includes('p?.pda?.source === "tariff"'), "a browser-asserted tariff DA is refused");
  ok(act.includes("canalFromSuez(suez, settings, { leg: which"), "the canal status is derived on the server");
  ok(/status: l\.status/.test(act) && /status: f\.status/.test(act), "every saved line carries its governed status");
  const sz = readFileSync(new URL("../app/(dashboard)/dashboard/suez-toll/actions.ts", import.meta.url), "utf8");
  eq((sz.match(/await resolveCalculatorAccess\(\)/g) ?? []).length, 3, "all three Suez actions pass the entitlement guard");
  for (const page of ["suez-toll", "voyage-estimator"]) {
    const src = readFileSync(new URL(`../app/(dashboard)/dashboard/${page}/page.tsx`, import.meta.url), "utf8");
    ok(src.includes("resolveCalculatorAccess()") && !src.includes("loadViewerContext"), `${page} page uses the same guard as its actions`);
  }
}

// ── 14 · Opus B PR-03 / PR-04 and Codex C2O-043 ─────────────────────────────
{
  const v = { ...base().vessel, consumption: { ...base().vessel.consumption, sea_ballast: { residual: 6, distillate: 0.8 }, anchorage: { residual: 2, distillate: 0.5 } } };
  const G = { anchorageInEca: true, anchorageInEcaSource: "governed" as const };
  const sIn: SuezInput = { vessel: { scnt: 10000, gt: 12000, category: "dry_bulk", buildYear: 2015, searchlightCompliant: true, firstTransit: false }, voyage: { direction: "SB", cargoStatus: "laden", transitDate: "2026-10-05" } };
  const ctx: SuezTariffContext = {
    found: true, date: "2026-10-05", version: { id: "v", versionNo: 4, effectiveFrom: "2026-10-01", effectiveTo: null, sourceRef: "fixture", surchargeRegime: "none" },
    items: [{ code: "transit_toll", labelEn: "toll", layer: "toll", basis: "toll_tiered_scnt", currency: "SDR", params: {}, directionScope: "any", cargoStatusScope: "any", conditionKey: null, payerParty: "owner", sortOrder: 1 }],
    tiers: [{ vesselCategory: "dry_bulk", cargoStatus: "laden", tierOrder: 0, scntFrom: 0, scntTo: null, sdrPerScnt: 5, confidence: "official" }, { vesselCategory: "dry_bulk", cargoStatus: "ballast", tierOrder: 0, scntFrom: 0, scntTo: null, sdrPerScnt: 4, confidence: "official" }],
    sdr: { rateUsd: 1.35, asOf: "2026-10-01", source: "IMF" }, suezDays: { transitDays: 1, anchorageDays: 0.5, nm: 100 }, sources: [{ id: "src", title: "SCA schedule (fixture)", issuer: "Suez Canal Authority", documentNo: null, issueDate: "2023-10-17", authority: "official", evidenceStatus: "on_file", sha256: "1e98fa11b6183c4beefa21b6a21c7a199eb7bd17b9e2c082b7f6e951ca54c35f" }],
  };
  const laden = canalFromSuez(estimateSuezTransit(sIn, ctx), S, { leg: "laden", ...G });
  eq(laden.status, "trusted", "fixture canal is trusted");

  // (a) no open port: the ballast leg is reported unavailable, never dropped
  const noOpen = estimateVoyage(base({ legs: { ballast: { key: "ballast", from: null, to: "EGALY", nm: null, ecaNm: null, method: "none" }, laden: base().legs.laden } }));
  ok(noOpen.legs.some((l) => l.key === "ballast" && l.status === "unavailable") && noOpen.status === "partial" && !noOpen.costs.complete, "a ballast leg without an open port is unavailable and the estimate partial");
  const vy = readFileSync(new URL("../components/voyage/VoyageEstimatorV2.tsx", import.meta.url), "utf8");
  ok(vy.includes("const hasBallast = !!vessel && (openCode == null || openCode !== polCode)"), "the page keeps a ballast leg when the open port is unknown");

  // (b) the canal miles inside a measured track are not sailed twice
  const leg = { key: "laden" as const, from: "GRPIR", to: "SAJED", nm: 1304.2, ecaNm: 0, method: "waypoints" as const, routeVerified: true, canalNm: 100 };
  const withCanal = estimateVoyage(base({ vessel: v, legs: { ballast: null, laden: leg }, canal: laden }));
  near(withCanal.days.seaLaden, (1304.2 - 100) / (12.5 * 24), 0.01, "sea days exclude the canal miles when the transit is its own leg");
  near(withCanal.days.canalTransit, 1, 0.001, "the transit itself is the settings' canal day");
  near(estimateVoyage(base({ vessel: v, legs: { ballast: null, laden: leg } })).days.seaLaden, 1304.2 / (12.5 * 24), 0.01, "without a priced transit the full track is sailed");

  // (c) a ballast transit is its own toll (ballast bands), date and leg
  const ballastCanal = canalFromSuez(estimateSuezTransit({ ...sIn, voyage: { ...sIn.voyage, cargoStatus: "ballast", direction: "NB" } }, ctx), S, { leg: "ballast", ...G });
  const both = estimateVoyage(base({ vessel: v, legs: { ballast: { key: "ballast", from: "SAJED", to: "EGALY", nm: 900, ecaNm: 0, method: "waypoints", routeVerified: true, canalNm: 100 }, laden: leg }, canal: laden, ballastCanal }));
  near(both.costs.canal.usd, (laden.costUsd ?? 0) + (ballastCanal.costUsd ?? 0), 0.01, "two transits → both canal costs");
  ok(both.legs.some((l) => l.key === "canal_ballast") && both.legs.some((l) => l.key === "canal"), "each transit is its own leg");
  ok((ballastCanal.costUsd ?? 0) < (laden.costUsd ?? 0), "the ballast transit is priced on the ballast bands");
  eq(suezTransitDate("2026-10-10", 3.6), "2026-10-14", "transit date = start + rounded days");
  eq(suezTransitDate("2026-10-10", -2.4), "2026-10-08", "a ballast transit precedes the laycan");

  // (e) manual canal cost when the Suez estimate is incomplete
  const incomplete = estimateSuezTransit({ ...sIn, vessel: { ...sIn.vessel, scnt: null } }, ctx);
  const manualCanal = canalFromSuez(incomplete, S, { leg: "laden", ...G, manualCost: { usd: 210000, manual: MANUAL } });
  ok(manualCanal.status === "manual" && manualCanal.costUsd === 210000 && !manualCanal.complete, "an incomplete Suez estimate takes the broker's stamped canal cost as manual");
  eq(canalFromSuez(incomplete, S, { leg: "laden", ...G, manualCost: { usd: 1, manual: { ...MANUAL, reason: "" } } }).status, "unavailable", "a canal cost without a reason is refused");
  const mv = estimateVoyage(base({ vessel: v, canal: manualCanal }));
  ok(mv.costs.canal.usd === 210000 && mv.costs.canal.status === "manual" && mv.status === "partial" && mv.warnings.some((w) => w.includes("entered manually")), "the manual canal cost is costed, labelled and keeps the voyage partial");

  // C2O-043 #9 · an unverified track is a fallback
  const unv = estimateVoyage(base({ legs: { ballast: null, laden: { ...base().legs.laden, routeVerified: false } } }));
  ok(unv.legs[0].status === "fallback" && unv.status === "partial" && unv.warnings.some((w) => w.includes("unverified")), "an unverified measured track is fallback, never trusted");

  // C2O-043 #11 · asserted port/anchorage facts and typed vessel facts keep the estimate partial
  eq(estimateVoyage(base({ ports: { load: port("load", { openLoopBan: true }), disch: port("disch") } })).status, "partial", "an asserted open-loop ban is a manual fact");
  eq(estimateVoyage(base({ ports: { load: port("load", { inEcaSource: "manual" }), disch: port("disch") } })).status, "partial", "an asserted port ECA status is a manual fact");
  eq(estimateVoyage(base({ ports: { load: port("load", { inEcaSource: "governed" }), disch: port("disch", { inEcaSource: "governed" }) } })).status, "trusted", "a governed port ECA status keeps it trusted");
  eq(estimateVoyage(base({ vesselSource: "manual" })).status, "partial", "vessel facts typed for this estimate are manual");
  eq(estimateVoyage(base({ vesselSource: "profile" })).status, "trusted", "the vessel's profile facts are governed");
  eq(estimateVoyage(base({ vessel: v, canal: { ...laden, anchorageInEcaSource: "manual" } })).status, "partial", "an asserted anchorage ECA status is a manual fact");

  // PR-04 · platform assumptions are labelled until the owner confirms them
  const pa = estimateVoyage(base());
  ok(pa.platformAssumptions.some((p) => p.key === "opex.crewUsdDay" && p.label.includes("1,450")) && pa.assumptions.some((a) => a.startsWith("Platform assumption")), "unconfirmed constants are labelled platform assumption");
  const conf = estimateVoyage(base({ settings: { ...S, confirmed: ["opex.crewUsdDay", "opex.maintenanceUsdDay", "classMultipliers", "seaMargin.defaultPct", "speeds", "portTimeDays", "suez.days"] } }));
  eq(conf.platformAssumptions, [], "confirmed constants carry no label");
  ok(vy.includes("platform assumption"), "the page shows the label beside the running cost");
  ok(parseVoyageSettings({ ...S, confirmed: ["not.a.key"] }).ok === false, "only known constants can be confirmed");
  ok(parseVoyageSettings({ ...S, suez: { ...S.suez, anchorages: { SB: [31.35, 32.36] } } }).ok, "settings carry the anchorage points");

  // C2O-044 #3/#5 · coarse ECA geometry and broker inputs never yield a trusted estimate
  const coarseLeg = estimateVoyage(base({ legs: { ballast: null, laden: { ...base().legs.laden, ecaConfidence: "coarse" } } }));
  ok(coarseLeg.legs[0].status === "fallback" && coarseLeg.status === "partial", "an ECA share from a coarse ring is a fallback");
  eq(estimateVoyage(base({ ports: { load: port("load", { inEcaSource: "coarse" }), disch: port("disch") } })).status, "partial", "a port ECA status from a coarse ring is not trusted");
  for (const [what, over] of [
    ["an entered sea margin", { seaMarginPct: 4 }],
    ["port allowance days", { ports: { load: port("load", { allowanceDays: 0.5 }), disch: port("disch") } }],
    ["waiting days at anchorage", { anchorageDays: 1 }],
    ["broker cost extras", { extras: { insuranceUsd: 1000, stevedoringUsd: 0, otherUsd: 0 } }],
    ["freight and commission", { revenue: { qtyMt: 30000, freightUsdMt: 25, commissionPct: 2.5 } }],
  ] as const) {
    const e = estimateVoyage(base(over as Partial<VoyageInput>));
    ok(e.status === "partial" && e.assumptions.some((a) => a.startsWith("Broker inputs")), `${what} is a broker input: the estimate is partial and says so`);
  }
  ok(!vy.includes("Every figure comes from governed data"), "the page no longer claims every figure is governed");
  const actSrc = readFileSync(new URL("../app/(dashboard)/dashboard/voyage-estimator/actions.ts", import.meta.url), "utf8");
  ok(actSrc.includes('const ACTOR_REF = "run-actor"') && !actSrc.includes("actorUserId: actorId"), "snapshots carry the run-actor reference, never a user id");
  // PR-02 · the fuel seam asks for the bunkering port, the products burnt, the date; one provider slot for the composer
  const fs = readFileSync(new URL("../lib/voyage/fuel-source.ts", import.meta.url), "utf8");
  ok(fs.includes("const FUEL_INDEX_PROVIDER: FuelIndexProvider | null = null;") && fs.includes("export async function loadFuelIndex(supabase: SupabaseClient, req: FuelIndexRequest)"), "one provider slot; the composer swaps in getFuelIndexSnapshot");
  ok(actSrc.includes("portLocode: ladenLeg.leg.from") && actSrc.includes("productKeys: voyageFuelProducts("), "the save asks the index for the load port and the voyage's products");
  eq(voyageFuelProducts("LSMGO", "LSMGO", true), ["HSFO380", "LSMGO"], "a scrubber ship burns HSFO 380 and the 0.10 % product");
  eq(voyageFuelProducts("ULSFO", "MGO05", null), ["VLSFO", "ULSFO", "MGO05"], "unknown scrubber → VLSFO plus the ECA and distillate products");
  ok(!/585|725/.test(fs), "no fallback price is hard-coded in the seam");
  // Opus B pre-audit (f87a560): flags left false, handling rates, start date, Suez facts, direction
  eq(estimateVoyage(base({ ports: { load: port("load"), disch: port("disch", { port: "NLRTM" }) } })).status, "partial", "an EU port without the 2 h berth rule is an assertion (P1-3)");
  eq(estimateVoyage(base({ vessel: { ...base().vessel, hasScrubber: true } })).status, "partial", "a scrubber ship with no open-loop ban asserted is not trusted (P1-3)");
  eq(estimateVoyage(base({ ports: { load: port("load", { rateMtDay: 8000, rateSource: "manual" }), disch: port("disch") } })).status, "partial", "a typed handling rate is a broker input");
  eq(estimateVoyage(base({ ports: { load: port("load", { rateMtDay: 8000, rateSource: "listing" }), disch: port("disch") } })).status, "trusted", "the linked listing's handling rate keeps it trusted");
  eq(estimateVoyage(base({ scheduleSource: "manual" })).status, "partial", "a typed start date (it picks the tariff date) is a broker input (P1-2)");
  eq(canalDirection([[21.5, 39.1, 0], [27.9, 33.9, 600], [29.9, 32.55, 700], [31.3, 32.33, 790], [36, 14, 1800], [6.4, 3.4, 5600]]), "NB", "Jeddah → Lagos crosses northbound although it ends further south (P2-1)");
  eq(canalDirection([[31.3, 32.33, 0], [29.9, 32.55, 90], [21.5, 39.1, 700]]), "SB", "Port Said → Jeddah is southbound");
  ok(actSrc.includes("cat: sv.category") && actSrc.includes("scnt: num(sv.scnt)"), "the Suez vessel facts are compared with the economics profile (P1-1)");
  ok(actSrc.includes("const startDate = listedStart ?? typedStart ?? today;"), "the linked listing's laycan wins over the browser's date (P1-2)");
  // contract: server-side derivations
  const act = readFileSync(new URL("../app/(dashboard)/dashboard/voyage-estimator/actions.ts", import.meta.url), "utf8");
  for (const needle of ["rl.route!.chokepoints.includes(\"SUEZ\")", "suezDirection", "getPointEcaZones(supabase, point[0], point[1], date)", "portEca(ladenRoute?.startZones", "saved without the cargo link", "saved without the position link", "vesselSource = sameFacts(", "suezTransitDate(startDate, offset)", "cargoStatus: which", "routeVerified: r.verified"]) ok(act.includes(needle), `save derives on the server: ${needle.slice(0, 50)}`);
  ok(!act.includes("client.canal.required") || act.includes("measured ? rl.route!.chokepoints"), "the browser's canal flag counts only for a manual leg");
  const page = readFileSync(new URL("../app/(dashboard)/dashboard/voyage-estimator/page.tsx", import.meta.url), "utf8");
  ok(page.includes("loadVesselViews({ mine: true }).then((r) => r.views.map(voyageOptionFromView))") && page.includes("loadOwnerOrgs(access.actorId)"), "members get their own vessels and the owner organisations");
  ok(vy.includes("ownerOrgId: ownerOrgId || null") && vy.includes("Estimate owned by"), "a multi-seat member chooses the owning organisation");
  const mig = readFileSync(new URL("../supabase/migrations/20261003205500_suez_voyage_review_fixes.sql", import.meta.url), "utf8");
  for (const needle of ["suez_tariff_items_reported_ck", "when new.status = 'published' then coalesce(new.published_by, v_actor) else v_actor end", "'notes_changed'", "vc.user_id = coalesce(u.supabase_user_id, u.id)", "a position is linked without its vessel", "must be owned by that organisation", "origin in ('system','command')", "for share", "alter column status set not null", "revoke insert on table public.voyage_estimate_runs, public.voyage_estimate_lines from service_role", "'startZones'", "fn_point_eca_zones", "'verified'"]) ok(mig.includes(needle), `205500 carries: ${needle.slice(0, 50)}`);
  const down = readFileSync(new URL("../supabase/rollback/20261003_suez_voyage_down.sql", import.meta.url), "utf8");
  ok(down.includes("savepoint stream_s_down_requires_a_transaction") && down.includes("where origin = 'command'") && down.includes("perform set_config('asb.stream_s_down', '', false)") && down.includes("export-taken:(.{3,200})"), "the DOWN needs one transaction, reads durable origin and spends the confirmation");
}

console.log(`voyage-check: ${checks} checks passed`);

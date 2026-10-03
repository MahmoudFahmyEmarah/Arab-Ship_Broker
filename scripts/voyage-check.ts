// voyage-check — golden fixtures for lib/voyage/engine.ts (Voyage Economics, Stream S).
// Pins the owner's rules from the 3 Oct 2026 brief: days = NM ÷ (speed × 24) ×
// (1 + margin); ECA miles burn the 0.10 % product; HSFO only with a scrubber;
// port working/idle split; daily cost = (crew + maintenance) × class multiplier;
// fuel priced from the index average; and the worked example 35 MT VLSFO +
// 4 MT MGO at 844.5 / 1,601 USD = 35,961.5. Run: npm run test:voyage
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { estimateVoyage, seaDays } from "../lib/voyage/engine";
import { DEFAULT_VOYAGE_SETTINGS, type VoyageInput, type VoyageSettings } from "../lib/voyage/types";

let checks = 0;
const ok = (cond: boolean, msg: string) => { assert.ok(cond, msg); checks++; };
const near = (a: number, b: number, tol: number, msg: string) => { assert.ok(Math.abs(a - b) <= tol, `${msg}: got ${a}, want ${b} ±${tol}`); checks++; };

const S: VoyageSettings = structuredClone(DEFAULT_VOYAGE_SETTINGS);
const prices = {
  VLSFO: { usdMt: 844.5, source: "index" as const, asOf: "2026-10-03", port: "AEFJR", scope: "port" as const, quoteCount: 3 },
  LSMGO: { usdMt: 1601, source: "index" as const, asOf: "2026-10-03", port: "AEFJR", scope: "port" as const, quoteCount: 3 },
  HSFO380: { usdMt: 450, source: "index" as const },
};
const zeroPorts = {
  load: { key: "load" as const, port: "EGALY", qtyMt: 0, rateMtDay: null, allowanceDays: 0, pdaUsd: 0, pdaSource: "manual" as const },
  disch: { key: "disch" as const, port: "SAJED", qtyMt: 0, rateMtDay: null, allowanceDays: 0, pdaUsd: 0, pdaSource: "manual" as const },
};
const base = (over: Partial<VoyageInput> = {}): VoyageInput => ({
  vessel: {
    speedLadenKn: 12.5, speedBallastKn: 13, hasScrubber: false, vesselClass: "C",
    consumption: { sea_laden: { residual: 7, distillate: 0.8 }, sea_ballast: { residual: 6, distillate: 0.8 }, port_working: { residual: 0, distillate: 0 }, port_idle: { residual: 0, distillate: 0 }, anchorage: { residual: 0, distillate: 0 } },
  },
  legs: { ballast: null, laden: { key: "laden", from: "EGALY", to: "SAJED", nm: 1500, ecaNm: 0, nmSource: "manual" } },
  canal: null,
  ports: zeroPorts,
  anchorageDays: 0,
  seaMarginPct: 0,
  prices,
  settings: S,
  revenue: null,
  extras: null,
  ...over,
});

// ── 1 · the owner's worked example: 35 MT VLSFO + 4 MT MGO ──────────────────
{
  const e = estimateVoyage(base());
  near(e.days.seaLaden, 5, 0.001, "1,500 NM at 12.5 kn, no margin = 5 days");
  const vlsfo = e.fuel.lines.find((l) => l.productKey === "VLSFO")!;
  const lsmgo = e.fuel.lines.find((l) => l.productKey === "LSMGO")!;
  near(vlsfo.mt, 35, 0.001, "35 MT VLSFO");
  near(lsmgo.mt, 4, 0.001, "4 MT distillate");
  near(e.fuel.totalUsd, 35 * 844.5 + 4 * 1601, 0.01, "fuel cost 35,961.5");
  ok(vlsfo.priceSource === "index" && vlsfo.pricePort === "AEFJR", "price source and port carried into the line");
  near(e.opex.usdDay, 2250, 0.001, "class C daily cost 1,450 + 800");
  near(e.days.total, 5 + 1.5 + 1.5, 0.001, "sea days + default port days");
  near(e.opex.usd, 2250 * e.days.total, 0.01, "running cost × total days");
  near(e.costs.totalUsd, e.costs.voyageCostsUsd + e.costs.opexUsd, 0.01, "total = voyage costs + running cost");
  ok(e.ok, "complete input is ok");
}

// ── 2 · sea margin and speeds ───────────────────────────────────────────────
{
  near(seaDays(1100, 12.5, 5), (1100 / (12.5 * 24)) * 1.05, 1e-9, "margin applied to days");
  near(seaDays(1100, 12.5, 0), 3.6667, 0.001, "1,100 NM at 12.5 kn = 3.667 days");
  ok(seaDays(0, 12.5, 5) === 0 && seaDays(100, 0, 5) === 0, "no distance or no speed → 0 days");
  const e = estimateVoyage(base({ seaMarginPct: null }));
  near(e.seaMarginPct, S.seaMargin.defaultPct, 0, "null margin → settings default");
  const d = estimateVoyage(base({ vessel: { ...base().vessel, speedLadenKn: null, speedBallastKn: null } }));
  ok(d.assumptions.some((a) => a.includes("Laden speed")), "defaulted speed is listed as an assumption");
  near(d.days.seaLaden, 1500 / (S.speeds.ladenKn * 24), 0.001, "default laden speed used");
}

// ── 3 · ECA miles burn the 0.10 % product (no scrubber) ─────────────────────
{
  const e = estimateVoyage(base({ legs: { ballast: null, laden: { key: "laden", from: "EGALY", to: "UAODS", nm: 1128.5, ecaNm: 580.2, nmSource: "measured" } }, vessel: { ...base().vessel, consumption: { sea_laden: { residual: 20, distillate: 1 } } } }));
  const days = 1128.5 / (12.5 * 24);
  const ecaDays = days * (580.2 / 1128.5);
  const vlsfo = e.fuel.lines.find((l) => l.productKey === "VLSFO")!;
  const lsmgo = e.fuel.lines.find((l) => l.productKey === "LSMGO")!;
  near(vlsfo.mt, 20 * (days - ecaDays), 0.01, "VLSFO only outside the ECA");
  near(lsmgo.mt, 20 * ecaDays + 1 * days, 0.01, "LSMGO = main engine inside ECA + distillate all voyage");
  near(e.fuel.ecaMt, 20 * ecaDays, 0.01, "ECA tonnage reported");
  ok(e.legs[0].ecaNm === 580.2 && Math.abs(e.legs[0].ecaDays - ecaDays) < 0.01, "leg carries its ECA share");
  const o = estimateVoyage(base({ legs: { ballast: null, laden: { key: "laden", from: "A", to: "B", nm: 1000, ecaNm: 400 } }, vessel: { ...base().vessel, consumption: { sea_laden: { residual: 20, distillate: 1 }, eca_sea: { residual: 18, distillate: 1 } } } }));
  const d2 = 1000 / (12.5 * 24); const ed2 = d2 * 0.4;
  near(o.fuel.lines.find((l) => l.productKey === "LSMGO")!.mt, 18 * ed2 + 1 * d2, 0.01, "eca_sea figure replaces the sea figure inside the ECA");
  const u = estimateVoyage(base({ legs: { ballast: null, laden: { key: "laden", from: "A", to: "B", nm: 1000, ecaNm: null } } }));
  ok(u.warnings.some((w) => w.includes("ECA share unknown")) && u.fuel.ecaMt === 0, "unknown ECA share → warning, priced non-ECA");
}

// ── 4 · scrubber: HSFO everywhere, no ECA split ─────────────────────────────
{
  const e = estimateVoyage(base({ vessel: { ...base().vessel, hasScrubber: true, consumption: { sea_laden: { residual: 20, distillate: 1 } } }, legs: { ballast: null, laden: { key: "laden", from: "A", to: "B", nm: 1000, ecaNm: 400 } } }));
  const d = 1000 / (12.5 * 24);
  ok(e.fuel.residualProduct === "HSFO380", "scrubber → HSFO 380");
  near(e.fuel.lines.find((l) => l.productKey === "HSFO380")!.mt, 20 * d, 0.01, "all main-engine fuel is HSFO");
  near(e.fuel.lines.find((l) => l.productKey === "LSMGO")!.mt, 1 * d, 0.01, "distillate unchanged");
  ok(!e.fuel.lines.some((l) => l.productKey === "VLSFO") && e.fuel.ecaMt === 0, "no VLSFO, no ECA switch");
  ok(e.assumptions.some((a) => a.includes("Scrubber")), "scrubber assumption stated");
}

// ── 5 · class multipliers ───────────────────────────────────────────────────
{
  for (const [cls, mult] of [["A", 2.2], ["B", 1.5], ["C", 1.0]] as const) {
    const e = estimateVoyage(base({ vessel: { ...base().vessel, vesselClass: cls } }));
    near(e.opex.usdDay, 2250 * mult, 0.001, `class ${cls} daily cost × ${mult}`);
  }
  const n = estimateVoyage(base({ vessel: { ...base().vessel, vesselClass: null } }));
  ok(n.opex.vesselClass === "C" && n.assumptions.some((a) => a.includes("class C")), "unknown class → C with an assumption");
  const custom = structuredClone(S); custom.opex = { crewUsdDay: 2000, maintenanceUsdDay: 1000 }; custom.classMultipliers = { A: 3, B: 2, C: 1 };
  near(estimateVoyage(base({ settings: custom, vessel: { ...base().vessel, vesselClass: "B" } })).opex.usdDay, 6000, 0.001, "settings drive the running cost");
}

// ── 6 · canal transit: days and cost from the Suez estimate ─────────────────
{
  const e = estimateVoyage(base({
    canal: { required: true, name: "Suez", transitDays: 1, anchorageDays: 0.5, anchorageInEca: true, costUsd: 201075, nm: 100, tariffVersionNo: 1, ok: true },
    vessel: { ...base().vessel, consumption: { sea_laden: { residual: 7, distillate: 0.8 }, anchorage: { residual: 2, distillate: 0.5 } } },
  }));
  near(e.days.canalTransit, 1, 0, "transit day");
  near(e.days.canalAnchorage, 0.5, 0, "anchorage half day");
  near(e.days.total, 5 + 1 + 0.5 + 1.5 + 1.5, 0.001, "total days include canal and default port days");
  near(e.costs.canalUsd, 201075, 0, "canal cost into voyage costs");
  const anch = e.legs.find((l) => l.key === "canal_anchorage")!;
  ok(anch.ecaDays === 0.5 && anch.burns.some((b) => b.productKey === "LSMGO" && Math.abs(b.mt - (2 * 0.5 + 0.5 * 0.5)) < 0.001), "Port Said anchorage burns the ECA product");
  const bad = estimateVoyage(base({ canal: { required: true, transitDays: 1, anchorageDays: 0.5, anchorageInEca: true, costUsd: 0, ok: false } }));
  ok(!bad.ok && bad.warnings.some((w) => w.includes("transit cost could not be computed")), "canal estimate not ok → voyage not ok");
}

// ── 7 · port days: rate, allowance, working/idle split ──────────────────────
{
  const e = estimateVoyage(base({
    ports: {
      load: { key: "load", port: "EGALY", qtyMt: 30000, rateMtDay: 5000, allowanceDays: 0.5, inEca: true, pdaUsd: 18000, pdaSource: "tariff" },
      disch: { key: "disch", port: "SAJED", qtyMt: 30000, rateMtDay: 10000, allowanceDays: 0, inEca: false, pdaUsd: 42000, pdaSource: "manual" },
    },
    vessel: { ...base().vessel, consumption: { sea_laden: { residual: 7, distillate: 0.8 }, port_working: { residual: 3, distillate: 1 }, port_idle: { residual: 1, distillate: 0.5 } } },
  }));
  near(e.days.portLoad, 6.5, 0.001, "30,000 ÷ 5,000 + 0.5 allowance");
  near(e.days.portDisch, 3, 0.001, "30,000 ÷ 10,000");
  const load = e.legs.find((l) => l.key === "load")!;
  // 20 % idle: working 5.2 d, idle 1.3 d; in an ECA port the residual share goes to LSMGO
  const lsmgoLoad = load.burns.filter((b) => b.productKey === "LSMGO").reduce((a, b) => a + b.mt, 0);
  near(lsmgoLoad, 3 * 5.2 + 1 * 5.2 + 1 * 1.3 + 0.5 * 1.3, 0.01, "ECA port: main + aux burn on LSMGO, working and idle");
  const disch = e.legs.find((l) => l.key === "disch")!;
  near(disch.burns.find((b) => b.productKey === "VLSFO")!.mt, 3 * 2.4 + 1 * 0.6, 0.01, "non-ECA port burns VLSFO for the residual share");
  near(e.costs.pdaLoadUsd + e.costs.pdaDischUsd, 60000, 0, "PDAs into voyage costs");
  const def = estimateVoyage(base());
  near(def.days.portLoad, S.portTimeDays.loadDefault, 0, "no rate → default load days");
  ok(def.assumptions.some((a) => a.includes("Load rate not declared")), "default port time listed as an assumption");
}

// ── 8 · anchorage waiting, prices fallback, missing data ────────────────────
{
  const a = estimateVoyage(base({ anchorageDays: 2, anchorageInEca: false, vessel: { ...base().vessel, consumption: { sea_laden: { residual: 7, distillate: 0.8 }, anchorage: { residual: 1.5, distillate: 0.4 } } } }));
  near(a.days.anchorage, 2, 0, "broker anchorage days");
  near(a.legs.find((l) => l.key === "anchorage")!.burns.find((b) => b.productKey === "VLSFO")!.mt, 3, 0.001, "anchorage burn");
  const fb = estimateVoyage(base({ prices: { LSMGO: prices.LSMGO } }));
  const v = fb.fuel.lines.find((l) => l.productKey === "VLSFO")!;
  ok(v.priceSource === "fallback" && v.usdMt === S.fuelFallback.VLSFO && fb.warnings.some((w) => w.includes("No live index price for VLSFO")), "missing index price → settings fallback + warning");
  const noFb = structuredClone(S); noFb.fuelFallback = {};
  const nf = estimateVoyage(base({ prices: {}, settings: noFb }));
  ok(!nf.ok && nf.fuel.totalUsd === 0 && nf.warnings.some((w) => w.includes("no fallback")), "no price at all → not ok, cost 0, warning");
  const nd = estimateVoyage(base({ legs: { ballast: null, laden: { key: "laden", from: "A", to: "B", nm: null, ecaNm: null } } }));
  ok(!nd.ok && nd.days.seaLaden === 0 && nd.warnings.some((w) => w.includes("distance is unknown")), "unknown distance → not ok");
  const nc = estimateVoyage(base({ vessel: { ...base().vessel, consumption: {} } }));
  ok(nc.warnings.some((w) => w.includes("No consumption declared")) && nc.fuel.totalMt === 0, "no consumption → warning, 0 MT");
  const fbState = estimateVoyage(base({ legs: { ballast: { key: "ballast", from: "X", to: "A", nm: 500, ecaNm: 0 }, laden: base().legs.laden }, vessel: { ...base().vessel, consumption: { sea_laden: { residual: 7, distillate: 0.8 } } } }));
  ok(fbState.assumptions.some((a) => a.includes("sea_ballast consumption not declared; sea_laden")), "missing ballast figures fall back to laden with an assumption");
  near(fbState.days.seaBallast, 500 / (13 * 24), 0.01, "ballast leg at ballast speed (output rounded to 2 dp)");
}

// ── 9 · revenue and TCE ────────────────────────────────────────────────────
{
  const e = estimateVoyage(base({ revenue: { qtyMt: 30000, freightUsdMt: 25, commissionPct: 2.5 }, extras: { insuranceUsd: 2000, stevedoringUsd: 0, otherUsd: 500 } }));
  near(e.revenue!.grossFreightUsd, 750000, 0, "gross freight");
  near(e.revenue!.commissionUsd, 18750, 0, "commission 2.5 %");
  near(e.revenue!.netFreightUsd, 731250, 0, "net freight");
  near(e.costs.extrasUsd, 2500, 0, "extras");
  near(e.revenue!.tceUsdDay, (731250 - e.costs.voyageCostsUsd) / e.days.total, 0.01, "TCE = (net − voyage costs) ÷ days");
  near(e.revenue!.resultAfterOpexUsd, 731250 - e.costs.voyageCostsUsd - e.costs.opexUsd, 0.01, "result after running cost");
  ok(estimateVoyage(base()).revenue === null, "no freight → no revenue block");
  const all = [e, estimateVoyage(base({ prices: {} })), estimateVoyage(base({ vessel: { ...base().vessel, consumption: {} } }))];
  ok(all.every((x) => Number.isFinite(x.costs.totalUsd) && Number.isFinite(x.days.total) && x.fuel.lines.every((l) => Number.isFinite(l.usd))), "totals are always finite");
}

// ── 10 · contract: DEFAULT_VOYAGE_SETTINGS equals the seed migration ────────
{
  const sql = readFileSync(new URL("../supabase/migrations/20261003203000_voyage_settings_seed.sql", import.meta.url), "utf8");
  const m = sql.match(/\$json\$([\s\S]*?)\$json\$/);
  ok(!!m, "seed migration carries the voyage_settings JSON");
  assert.deepStrictEqual(JSON.parse(m![1]), DEFAULT_VOYAGE_SETTINGS); checks++;
  ok(sql.includes("'voyage_settings'") && sql.includes("on conflict (key) do nothing"), "seed is idempotent on the voyage_settings key");
}

console.log(`voyage-check: ${checks} checks passed`);

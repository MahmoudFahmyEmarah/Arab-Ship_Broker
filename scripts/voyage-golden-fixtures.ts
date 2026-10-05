// Golden voyage-estimate fixtures from the owner's answer key
// (tmp/Data/Voyage_Estimation_Spreadsheet1-_answer_(1).xlsx, 2022 course
// workbook, SHA-256 ab5bddf6…4fb25): four worked cases (Handymax, Panamax,
// Panamax with backhaul, product tanker).
//
// Each case is re-computed here from its inputs with the workbook's own
// formulas and asserted against every value the workbook recorded, so the
// fixture is a faithful transcription. The workbook's quirks are listed per
// case: a consumer (the Voyage engine, Stream S) should compare only the
// fields its model shares and treat the quirks as known differences, not as
// expected behaviour.
//
// Reference evidence only, NOT a release check (audit C2B-007 #5): this script
// does not call the Voyage engine (`estimateVoyage`, Stream S). Registering it as
// a gate needs an explicit adapter on the composed branch that runs the current
// engine on these inputs and asserts the shared outputs.
//
//   node --import tsx scripts/voyage-golden-fixtures.ts          # check only
//   node --import tsx scripts/voyage-golden-fixtures.ts --write  # (re)write the JSON
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const OUT = join(process.cwd(), "docs", "data", "voyage-golden", "answer-key-2022.json");
const SOURCE = {
  file: "tmp/Data/Voyage_Estimation_Spreadsheet1-_answer_(1).xlsx",
  sha256: "ab5bddf6026fdf4ba39d7f08205dafc1cfd8a776f906db0a3e916fdff854fb25",
};

// A time block of the voyage. Sea legs carry miles and speed (days = miles /
// (knots × 24)) unless the sheet typed the days in; reserve (BWA) blocks burn
// fuel but, in this workbook, never add to the voyage duration.
type Block = {
  label: string;
  kind: "ballast" | "laden" | "reserve" | "canal" | "port";
  miles?: number; knots?: number; days?: number;
  foPerDay: number; doPerDay: number;
  inDuration: boolean;
};
type BunkerLine = { grade: "FO" | "DO"; place: string; qty: number; usdPerMt: number; qtyFormula: string };
type Cargo = { label: string; mt: number; usdPerMt?: number; worldscale?: number; flatUsdPerMt?: number };
type Expected = {
  totalDays: number; totalFo: number; totalDo: number;
  bunkersOnBoard: number; cargoIntake: number;
  bunkerCost: number; otherExpenses: number; grossExpenses: number;
  grossFreight: number; commission: number; netFreight: number;
  grossSurplus: number; grossDaily: number; netDaily: number;
  tce: number;
};
type Case = {
  id: string; sheet: string; description: string;
  vessel: { name: string; dwt: number; constants: number; gt?: number; nt?: number };
  blocks: Block[];
  bunkerQty: (t: { fo: number; dO: number; blocks: { fo: number; dO: number }[] }) => number[];
  bunkers: Omit<BunkerLine, "qty">[];
  bunkersOnBoardExtra: number; // the Handymax sheet adds a 150 t reserve to the deadweight deduction
  expenses: { label: string; usd: number; formula?: string }[];
  cargoes: Cargo[];
  commissionRate: number;
  runningCostPerDay: number;
  tceFormula: "gross_daily/(1-commission)" | "typed";
  expected: Expected;
  quirks: string[];
};

const CASES: Case[] = [
  {
    id: "handymax-no-yokohama",
    sheet: "Handymax Cargo",
    description: "45k HSS New Orleans to Yokohama, 40,000 t at USD 40/t, 1.25 % commission",
    vessel: { name: "CBS Prosperity (geared Handymax)", dwt: 45000, constants: 250, gt: 28073, nt: 16285 },
    blocks: [
      { label: "Ballast to New Orleans", kind: "ballast", miles: 1630, knots: 13.5, foPerDay: 24.5, doPerDay: 0, inDuration: true },
      { label: "New Orleans to Yokohama", kind: "laden", miles: 9183, knots: 13.5, foPerDay: 29.5, doPerDay: 0, inDuration: true },
      { label: "BWA", kind: "reserve", days: 0, foPerDay: 29.5, doPerDay: 0, inDuration: false },
      { label: "Canal transit", kind: "canal", days: 1, foPerDay: 0, doPerDay: 1.5, inDuration: true },
      { label: "Port (load 2 + discharge 2)", kind: "port", days: 4, foPerDay: 0, doPerDay: 1.5, inDuration: true },
    ],
    bunkerQty: (t) => [960, Math.ceil(t.dO - 0 + 0)],
    bunkers: [
      { grade: "FO", place: "Baltimore", usdPerMt: 680, qtyFormula: "typed (960 for 959.36 consumed)" },
      { grade: "DO", place: "NOLS", usdPerMt: 980, qtyFormula: "ROUNDUP(total DO − ROB + DO at sea, 0)" },
    ],
    bunkersOnBoardExtra: 150,
    expenses: [
      { label: "Loading port disbursements", usd: 120000 },
      { label: "Discharging port disbursements", usd: 150000 },
      { label: "Canal transit expenses", usd: 90000 },
    ],
    cargoes: [{ label: "HSS", mt: 40000, usdPerMt: 40 }],
    commissionRate: 0.0125,
    runningCostPerDay: 6000,
    tceFormula: "typed",
    expected: {
      totalDays: 38.373456790123456, totalFo: 959.3626543209875, totalDo: 7.5,
      bunkersOnBoard: 1118, cargoIntake: 43632,
      bunkerCost: 660640, otherExpenses: 360000, grossExpenses: 1020640,
      grossFreight: 1600000, commission: 20000, netFreight: 1580000,
      grossSurplus: 559360, grossDaily: 14576.742540014478, netDaily: 8576.742540014478,
      tce: 16000,
    },
    quirks: [
      "T/C equivalent is typed (16,000), not computed.",
      "The canal day burns DO only, no FO.",
      "Bunkers on board for the intake = purchases + a typed 150 t, while the cargo line uses 40,000 t of a 43,632 t intake.",
    ],
  },
  {
    id: "panamax-norfolk-rotterdam",
    sheet: "Panamax Cargo",
    description: "Coal Norfolk to Rotterdam, 3d/3d, USD 15/t FIOT, 1.25 % (header says 75,000 t; the freight line uses 66,000 t)",
    vessel: { name: "HESSAH / CBS Serenity (geared Panamax)", dwt: 81800, constants: 500, gt: 39727, nt: 25754 },
    blocks: [
      { label: "New Orleans / Norfolk (ballast)", kind: "ballast", miles: 1342, knots: 14.5, foPerDay: 27.8, doPerDay: 0.5, inDuration: true },
      { label: "Norfolk / Rotterdam (laden)", kind: "laden", miles: 3514, knots: 14, days: 20, foPerDay: 32.6, doPerDay: 0.5, inDuration: true },
      { label: "BWA 1 day", kind: "reserve", days: 1, foPerDay: 32.6, doPerDay: 0.5, inDuration: false },
      { label: "Port (load 4 / discharge 4, counted 5)", kind: "port", days: 5, foPerDay: 0, doPerDay: 0.1, inDuration: true },
    ],
    bunkerQty: (t) => [100, t.fo - 100, 20],
    bunkers: [
      { grade: "FO", place: "ROB", usdPerMt: 640, qtyFormula: "typed" },
      { grade: "FO", place: "NOLS", usdPerMt: 640, qtyFormula: "total FO − ROB" },
      { grade: "DO", place: "ROB", usdPerMt: 980, qtyFormula: "typed (covers 12.93 consumed)" },
    ],
    bunkersOnBoardExtra: 0,
    expenses: [
      { label: "Loading port disbursements", usd: 140000 },
      { label: "Discharging port disbursements", usd: 150000 },
    ],
    cargoes: [{ label: "Coal", mt: 66000, usdPerMt: 15 }],
    commissionRate: 0.0125,
    runningCostPerDay: 6000,
    tceFormula: "typed",
    expected: {
      totalDays: 28.856321839080458, totalFo: 791.8057471264368, totalDo: 12.928160919540229,
      bunkersOnBoard: 811.8057471264368, cargoIntake: 80488.19425287357,
      bunkerCost: 526355.6781609196, otherExpenses: 290000, grossExpenses: 816355.6781609196,
      grossFreight: 990000, commission: 12375, netFreight: 977625,
      grossSurplus: 161269.32183908042, grossDaily: 5588.69986058554, netDaily: -411.3001394144603,
      tce: 16000,
    },
    quirks: [
      "The laden leg's days are typed as 20 (3,514 nm at 14 kn is 10.46 days).",
      "Port time shows load 4 / discharge 4 but the sheet counts 5 days (Loading + Discharging named cells).",
      "Header cargo 75,000 t vs 66,000 t in the freight line; DWT 81,800 vs 76,662 summer in the particulars.",
      "ROB bunkers are priced as a voyage cost; T/C equivalent is typed (16,000).",
    ],
  },
  {
    id: "panamax-backhaul",
    sheet: "Panamax Cargo with Backhaul",
    description: "60,000 t coal Norfolk/Rotterdam USD 15 + 65,000 t iron ore Saldanha Bay/Morehead City USD 20, 3d/3d, FIOT, 1.25 %",
    vessel: { name: "CBS Serenity (geared Panamax)", dwt: 76662, constants: 500, gt: 39727, nt: 25754 },
    blocks: [
      { label: "New Orleans / Norfolk (ballast)", kind: "ballast", miles: 1342, knots: 15, foPerDay: 31.5, doPerDay: 0.5, inDuration: true },
      { label: "Norfolk / Rotterdam (laden)", kind: "laden", miles: 3514, knots: 14, foPerDay: 33.5, doPerDay: 0.5, inDuration: true },
      { label: "Rotterdam / Saldanha Bay (ballast)", kind: "ballast", miles: 6116, knots: 15, foPerDay: 31.5, doPerDay: 0.5, inDuration: true },
      { label: "Saldanha Bay / Morehead City (laden)", kind: "laden", miles: 6754, knots: 14, foPerDay: 33.5, doPerDay: 0.5, inDuration: true },
      { label: "BWA 2 days", kind: "reserve", days: 2, foPerDay: 33.5, doPerDay: 0.5, inDuration: false },
      { label: "Port (load 6 + discharge 6)", kind: "port", days: 12, foPerDay: 0, doPerDay: 0.5, inDuration: true },
    ],
    bunkerQty: (t) => [100, t.blocks[0].fo + t.blocks[1].fo - 100, t.fo - (t.blocks[0].fo + t.blocks[1].fo - 100) - 100, 20, Math.ceil(t.dO - 20)],
    bunkers: [
      { grade: "FO", place: "ROB", usdPerMt: 640, qtyFormula: "typed" },
      { grade: "FO", place: "NOLS", usdPerMt: 640, qtyFormula: "FO of legs 1+2 − ROB" },
      { grade: "FO", place: "Rotterdam", usdPerMt: 630, qtyFormula: "total FO − NOLS − ROB" },
      { grade: "DO", place: "ROB", usdPerMt: 980, qtyFormula: "typed" },
      { grade: "DO", place: "NOLS", usdPerMt: 980, qtyFormula: "ROUNDUP(total DO − ROB, 0)" },
    ],
    bunkersOnBoardExtra: 0,
    expenses: [
      { label: "Loading port disbursements", usd: 290000 },
      { label: "Discharging port disbursements", usd: 270000 },
    ],
    cargoes: [
      { label: "Coal", mt: 60000, usdPerMt: 15 },
      { label: "Iron ore", mt: 65000, usdPerMt: 20 },
    ],
    commissionRate: 0.0125,
    runningCostPerDay: 8000,
    tceFormula: "gross_daily/(1-commission)",
    expected: {
      totalDays: 63.27619047619047, totalFo: 1743.3190476190475, totalDo: 32.63809523809523,
      bunkersOnBoard: 1776.3190476190475, cargoIntake: 74385.68095238095,
      bunkerCost: 1135308.7916666665, otherExpenses: 560000, grossExpenses: 1695308.7916666665,
      grossFreight: 2200000, commission: 27500, netFreight: 2172500,
      grossSurplus: 477191.2083333335, grossDaily: 7541.40229906683, netDaily: -458.59770093317,
      tce: 7636.863087662612,
    },
    quirks: [
      "Reserve (BWA) days burn fuel but are not added to the voyage duration.",
      "Bunkers on board for the intake = every purchase over the whole round voyage, not the quantity on board at loading.",
      "T/C equivalent = gross daily / (1 − commission); the running cost is not added back.",
    ],
  },
  {
    id: "tanker-houston-shanghai",
    sheet: "Tanker Cargo",
    description: "65,000 t fuel oil Houston/Shanghai and ballast back, 2d/2d, WS 130 on flat USD 28.64, 1.25 %",
    vessel: { name: "CBS Endurance (product carrier)", dwt: 69850, constants: 500, gt: 41690, nt: 20900 },
    blocks: [
      { label: "Houston / Shanghai (laden)", kind: "laden", miles: 10216, knots: 15.5, foPerDay: 44.5, doPerDay: 4, inDuration: true },
      { label: "Shanghai / Houston (ballast)", kind: "ballast", miles: 10216, knots: 15.5, foPerDay: 39.5, doPerDay: 4, inDuration: true },
      { label: "BWA 1 day", kind: "reserve", days: 1, foPerDay: 44.5, doPerDay: 4, inDuration: false },
      { label: "Canal transit 2 days", kind: "canal", days: 2, foPerDay: 44.5, doPerDay: 4, inDuration: true },
      { label: "Port (load 2 + discharge 2)", kind: "port", days: 4, foPerDay: 0, doPerDay: 4, inDuration: true },
    ],
    bunkerQty: (t) => [100, 2300, t.fo + t.dO - 100 - 2300],
    bunkers: [
      { grade: "FO", place: "ROB", usdPerMt: 640, qtyFormula: "typed" },
      { grade: "FO", place: "Houston", usdPerMt: 640, qtyFormula: "typed (tank capacity 2,400 less ROB)" },
      { grade: "FO", place: "Shanghai", usdPerMt: 660, qtyFormula: "main + auxiliary FO − ROB − Houston" },
    ],
    bunkersOnBoardExtra: 0,
    expenses: [
      { label: "Loading port disbursements", usd: 125000 },
      { label: "Discharging port disbursements", usd: 100000 },
      { label: "Canal transit expenses", usd: 10000 * 7.16 + 10000 * 7.09 + 13325 * 6.9, formula: "10,000×7.16 + 10,000×7.09 + 13,325×6.90 (banded toll on 33,325 t, the Panama tonnage)" },
    ],
    cargoes: [{ label: "Fuel oil", mt: 65000, worldscale: 130, flatUsdPerMt: 28.64 }],
    commissionRate: 0.0125,
    runningCostPerDay: 7000,
    tceFormula: "gross_daily/(1-commission)",
    expected: {
      totalDays: 60.924731182795696, totalFo: 2440.3387096774195, totalDo: 247.69892473118279,
      bunkersOnBoard: 2688.037634408602, cargoIntake: 66661.9623655914,
      bunkerCost: 1726104.8387096773, otherExpenses: 459442.5, grossExpenses: 2185547.3387096776,
      grossFreight: 2420080, commission: 30251, netFreight: 2389829,
      grossSurplus: 204281.66129032243, grossDaily: 3353.0170314154584, netDaily: -3646.9829685845416,
      tce: 3395.4602849776793,
    },
    quirks: [
      "The \"DO\" column is the auxiliary engine burning FO (4 t/day at sea and in port); it is bought as FO.",
      "The canal is the Panama Canal (banded toll on the Panama tonnage 33,325); it burns laden FO for 2 days.",
      "Worldscale freight = cargo × flat × WS / 100.",
      "T/C equivalent = gross daily / (1 − commission).",
    ],
  },
];

function compute(c: Case) {
  const blocks = c.blocks.map((b) => {
    const days = b.days ?? (b.miles ?? 0) / ((b.knots ?? 1) * 24);
    return { ...b, days, fo: days * b.foPerDay, dO: days * b.doPerDay };
  });
  const totalDays = blocks.filter((b) => b.inDuration).reduce((s, b) => s + b.days, 0);
  const fo = blocks.reduce((s, b) => s + b.fo, 0);
  const dO = blocks.reduce((s, b) => s + b.dO, 0);
  const qty = c.bunkerQty({ fo, dO, blocks });
  assert.equal(qty.length, c.bunkers.length);
  const bunkers: BunkerLine[] = c.bunkers.map((b, i) => ({ ...b, qty: qty[i] }));
  const bunkersOnBoard = qty.reduce((s, q) => s + q, 0) + c.bunkersOnBoardExtra;
  const bunkerCost = bunkers.reduce((s, b) => s + b.qty * b.usdPerMt, 0);
  const otherExpenses = c.expenses.reduce((s, e) => s + e.usd, 0);
  const grossExpenses = bunkerCost + otherExpenses;
  const freights = c.cargoes.map((g) =>
    g.worldscale != null ? (g.mt * (g.flatUsdPerMt ?? 0) * g.worldscale) / 100 : g.mt * (g.usdPerMt ?? 0));
  const grossFreight = freights.reduce((s, f) => s + f, 0);
  const commission = freights.reduce((s, f) => s + f * c.commissionRate, 0);
  const netFreight = grossFreight - commission;
  const grossSurplus = netFreight - grossExpenses;
  const grossDaily = grossSurplus / totalDays;
  // A typed T/C value is an input of the sheet, not a result: it is never
  // "computed" here, so it cannot be proven by comparing it with itself.
  const result: Omit<Expected, "tce"> & { tce: number | null } = {
    totalDays, totalFo: fo, totalDo: dO,
    bunkersOnBoard, cargoIntake: c.vessel.dwt - bunkersOnBoard - c.vessel.constants,
    bunkerCost, otherExpenses, grossExpenses,
    grossFreight, commission, netFreight,
    grossSurplus, grossDaily, netDaily: grossDaily - c.runningCostPerDay,
    tce: c.tceFormula === "typed" ? null : grossDaily / (1 - c.commissionRate),
  };
  return { blocks, bunkers, result };
}

let passed = 0, failed = 0;
function check(name: string, fn: () => void) {
  try { fn(); passed++; } catch (e) { failed++; console.error(`FAIL ${name}: ${(e as Error).message}`); }
}

const fixtures = CASES.map((c) => {
  const { blocks, bunkers, result } = compute(c);
  check(`${c.id}: every recorded workbook value`, () => {
    for (const k of Object.keys(c.expected) as (keyof Expected)[]) {
      const got = result[k];
      if (got === null) continue; // typed T/C, checked below
      assert.ok(Math.abs(got - c.expected[k]) < 1e-6, `${k}: computed ${got} vs workbook ${c.expected[k]}`);
    }
  });
  if (c.tceFormula === "typed") check(`${c.id}: typed T/C is an input, not a derivable result`, () => {
    // Neither T/C formula used elsewhere in the workbook reproduces it.
    assert.ok(Math.abs(result.grossDaily / (1 - c.commissionRate) - c.expected.tce) > 1);
    assert.ok(Math.abs(result.grossDaily - c.expected.tce) > 1);
  });
  return {
    id: c.id, sheet: c.sheet, description: c.description, vessel: c.vessel,
    blocks: blocks.map(({ label, kind, miles, knots, days, foPerDay, doPerDay, inDuration, fo, dO }) =>
      ({ label, kind, miles: miles ?? null, knots: knots ?? null, days, foPerDay, doPerDay, inDuration, fo, do: dO })),
    bunkers,
    expenses: c.expenses,
    cargoes: c.cargoes,
    commissionRate: c.commissionRate,
    runningCostPerDay: c.runningCostPerDay,
    tceFormula: c.tceFormula,
    expected: c.expected,
    quirks: c.quirks,
  };
});

check("cases are unique and complete", () => {
  assert.equal(new Set(CASES.map((c) => c.id)).size, 4);
  assert.deepEqual(CASES.map((c) => c.sheet), ["Handymax Cargo", "Panamax Cargo", "Panamax Cargo with Backhaul", "Tanker Cargo"]);
});

const json = JSON.stringify({ source: SOURCE, cases: fixtures }, null, 2) + "\n";
if (process.argv.includes("--write")) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`wrote ${OUT}`);
} else {
  check("committed JSON equals the generator output", () => {
    assert.ok(existsSync(OUT), "run with --write first");
    assert.equal(readFileSync(OUT, "utf8").replace(/\r\n/g, "\n"), json);
  });
}

console.log(`voyage-golden-fixtures: ${passed} passed, ${failed} failed (${CASES.length} cases)`);
if (failed) process.exit(1);

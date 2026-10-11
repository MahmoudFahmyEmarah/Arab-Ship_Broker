// Fixture Room · recap text parity (C2O-101 P1-3): lib/fixture-room/recap-model.ts#recapText against the database's
// public.fn_fixture_recap_text on the same contents — withdrawn terms, open terms, brokerage in every shape, Arabic.
// Run against an ISOLATED database that has the Fixture module: PARITY_DB=asb_e2e npx tsx scripts/fixture-recap-parity.ts
import { execSync } from "node:child_process";
import { recapText } from "../lib/fixture-room/recap-model";
import type { FixtureRecapContent } from "../lib/fixture-room/types";

const DB = process.env.PARITY_DB ?? "asb_e2e";
if (DB === "postgres" || /^template/.test(DB)) throw new Error(`refusing to run the parity check on ${DB}`);

const base: FixtureRecapContent = {
  ref: "FX-2026-00042", status: "on_subjects", roomVersion: 37, generatedAt: "2026-10-09T08:15:42Z",
  cargo: { ref: "C-1", commodity: "Wheat (milling)", qtyMin: 25000, qtyMax: 27500.5, loadPort: "EGALY", dischPort: "TRMER" },
  vessel: { name: "TBN", type: "Supramax", dwt: 58000 },
  counterpartyDisclosed: false,
  parties: [{ side: "cargo", capacity: "principal", label: "Charterer", name: null }, { side: "vessel", capacity: "principal", label: "Owner", name: null }],
  terms: [
    { code: "freight", label: "Freight & terms", sortOrder: 6, status: "agreed", required: true, agreedValue: "$26.00/MT FIOST", agreedAt: null, cargoPosition: null, vesselPosition: null },
    { code: "laycan", label: "Laycan", sortOrder: 4, status: "withdrawn", required: true, agreedValue: null, agreedAt: null, cargoPosition: "05 – 12 Oct", vesselPosition: "06 – 13 Oct" },
    { code: "notes", label: "Notes", sortOrder: 7, status: "countered", required: false, agreedValue: null, agreedAt: null, cargoPosition: "x", vesselPosition: null },
  ],
  subjects: [{ seq: 1, title: "Sub stem", status: "open", responsibleSide: "cargo", deadlineAt: "2026-10-10T12:00:00Z" }, { seq: 2, title: "Sub details", status: "lifted", responsibleSide: null, deadlineAt: null }],
  brokerageTerms: null, listingSyncTarget: null,
};
const cases: [string, FixtureRecapContent][] = [
  ["base (withdrawn + countered terms, no brokerage)", base],
  ["brokerage with text", { ...base, brokerageTerms: { text: "1.25% address commission + 1.25% brokerage" } }],
  ["brokerage without text (jsonb key order)", { ...base, brokerageTerms: { pct: 1.25, address: 3.75, payer: "owners" } }],
  ["brokerage array", { ...base, brokerageTerms: [1.25, "owners"] as unknown as Record<string, unknown> }],
  ["disclosed with Arabic names", { ...base, counterpartyDisclosed: true, parties: [{ side: "cargo", capacity: "principal", label: "Charterer", name: "شركة الشحن العربية" }, { side: "vessel", capacity: "principal", label: "Owner", name: "Nile Owners SA" }] }],
  ["no subjects, null vessel fields", { ...base, subjects: [], vessel: { name: null, type: null, dwt: null } }],
];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const sql = cases.map(([, c]) => `select translate(encode(convert_to(public.fn_fixture_recap_text(${q(JSON.stringify(c))}::jsonb), 'UTF8'), 'base64'), chr(10), '');`).join(String.fromCharCode(10));
const out = execSync(`docker exec -i supabase_db_arab-ship-broker psql -U postgres -d ${DB} -X -q -At -v ON_ERROR_STOP=1`, { input: "set timezone = 'UTC';" + String.fromCharCode(10) + sql, encoding: "utf8" })
  .split(/\r?\n/).filter((l) => l.trim() !== "");
let bad = 0;
cases.forEach(([name, c], i) => {
  const dbText = Buffer.from(out[i] ?? "", "base64").toString("utf8");
  const ts = recapText(c);
  if (dbText !== ts) { bad++; console.error(`MISMATCH · ${name}\n--- db\n${dbText}\n--- ts\n${ts}`); }
});
if (bad) { console.error(`FIXTURE RECAP PARITY: ${bad} of ${cases.length} differ`); process.exit(1); }
console.log(`FIXTURE RECAP PARITY: ${cases.length} contents render identically (withdrawn, open, brokerage shapes, Arabic)`);

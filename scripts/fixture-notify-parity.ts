// Fixture notifications · the SQL projector says exactly what the audited rules say (Wave 4, O2ALL-003).
// For every sample event, lib/fixture-room/notify-model.ts#notificationFor and the database's
// public.fn_fixture_notify_rule must return the same audience, importance, title, body, href and deadline.
// Needs a database with 20261008100000 applied; refuses the shared and production databases.
// Run: PARITY_DB=asb_e2e npx tsx scripts/fixture-notify-parity.ts
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { notificationFor, maskedActorLabel, type NotifyActor } from "../lib/fixture-room/notify-model";
import type { FixtureEventType } from "../lib/fixture-room/types";

const DB = process.env.PARITY_DB ?? "asb_e2e";
if (DB === "postgres" || /^template/.test(DB)) throw new Error(`refusing to run the parity check on ${DB}`);
const ROOM = "6f1c2b9e-4a7d-4c1e-9b3a-2d5e8f0a1b2c";
const REF = "FX-2026-00042";
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

const actors: NotifyActor[] = [{ side: "cargo", isPlatform: false }, { side: "vessel", isPlatform: false }, { side: "mediator", isPlatform: true }, { side: null, isPlatform: false }];
const term = { termLabel: "Freight & terms", termCode: "freight", valueKind: "money_per_mt" };
const hostile = "Call Tasos +30 690 111 2222 tasos@secret.gr, Secret Owners SA, MV HIDDEN <b>x</b>";
const textTerm = { termLabel: "Cargo & grade", termCode: "cargo_grade", valueKind: "text" };
const portTerm = { termLabel: "Ports", termCode: "ports", valueKind: "port_pair" };
const cases: [FixtureEventType, Record<string, unknown>][] = [
  ["party.invited", { partyId: "x", isPlatform: false }], ["party.accepted", {}],
  ["proposal.submitted", { ...term, kind: "bid", displayValue: "$25.00/MT", isFinal: false }],
  ["proposal.submitted", { ...term, kind: "offer", displayValue: "$27.00/MT", isFinal: true, expiresAt: "2026-10-08T12:00:00Z" }],
  ["proposal.submitted", { termCode: "freight", kind: "offer", displayValue: "$26/MT", expiresAt: null }],
  // C2O-092 P2: the deadline named in the copy — offsets, fractions, and values that must read "for a limited time"
  ...["2026-10-08T12:00:59.987654+00:00", "2026-10-08 15:30:00+03", "2026-12-31T23:59:00-05:00", "2026-02-30T10:00:00Z",
      "2026-10-08T12:00:00", "tomorrow at noon", "2026-13-01T00:00:00Z"].map((expiresAt) =>
    ["proposal.submitted", { ...term, kind: "offer", displayValue: "$27.00/MT", expiresAt }] as [FixtureEventType, Record<string, unknown>]),
  ["proposal.submitted", { kind: "bid", displayValue: "x" }],
  ["proposal.submitted", { ...textTerm, kind: "offer", displayValue: hostile, value: { text: hostile } }],
  ["proposal.submitted", { ...portTerm, portsVerified: true, kind: "bid", displayValue: "Tasos jetty → Secret berth", value: { load: "EGALY", disch: "ZZFXB", load_name: "Tasos jetty" } }],
  ["proposal.submitted", { ...portTerm, portsVerified: false, kind: "bid", displayValue: "x", value: { load: "Tasos", disch: "ZZFXB" } }],
  ["proposal.submitted", { ...portTerm, kind: "bid", displayValue: "x", value: { load: "TASOS", disch: "ZZFXB" } }],
  ["term.agreed", { ...textTerm, displayValue: hostile }], ["term.bridge_suggested", { ...textTerm, displayValue: hostile }],
  ["proposal.submitted", { termCode: "ld_rates", valueKind: "rate_pair", kind: "offer", displayValue: "8,000 / 6,000 MT/day" }],
  ["proposal.submitted", { termCode: "laycan", valueKind: "date_range", kind: "bid", displayValue: "05 – 12 Oct" }],
  ["proposal.submitted", { termCode: "quantity", valueKind: "number", kind: "bid", displayValue: "26,000 MT" }],
  ["proposal.lapsed", { ...term, side: "vessel", displayValue: "$27.00/MT" }],
  ["term.agreed", { ...term, displayValue: "$26.00/MT" }], ["term.reopened", { ...term, reason: "call Tasos" }],
  ["term.referred", term], ["term.bridge_suggested", { ...term, displayValue: "$26.25/MT", comment: "call Tasos on +30 690" }],
  ["room.fix_confirmed", { awaitingSide: "vessel" }], ["room.fix_confirmed", { awaitingSide: null }], ["room.fix_confirmed", {}],
  ["room.fixed_on_subjects", {}], ["subject.reinstated", { seq: 2, title: "Sub stem" }], ["subject.reinstated", { seq: "x" }],
  ["subject.lifted", { seq: 3, title: "Sub owners' approval" }], ["subject.lifted", {}], ["subject.failed", { seq: 1 }], ["subject.failed", { seq: 0 }],
  ["room.fixed", {}], ["recap.published", { versionNo: 2 }], ["room.counterparty_disclosed", {}],
  ["message.posted", { kind: "note", visibility: "room", body: "secret" }], ["message.posted", { kind: "nudge" }],
  ["message.posted", { kind: "note", visibility: "side" }], ["message.posted", { kind: "note", visibility: "mediator" }],
  ["room.closed", { reason: "withdrawn" }], ["room.closed", { reason: "fraud" }],
  ["room.window_extended", {}], ["room.created", {}], ["recap.acknowledged", { versionNo: 2 }], ["party.declined", {}],
];

let checked = 0;
const sqlRows: string[] = [];
const expected: (Record<string, unknown> | null)[] = [];
for (const actor of actors) {
  for (const [type, payload] of cases) {
    const label = maskedActorLabel(actor);
    const ts = notificationFor(type, { roomId: ROOM, roomRef: REF, actor, payload });
    expected.push(ts ? { audience: ts.audience, importance: ts.importance, title: ts.title, body: ts.body, href: ts.href, deadlineAt: ts.deadlineAt } : null);
    sqlRows.push(`select coalesce(public.fn_fixture_notify_rule(${q(type)}, ${q(JSON.stringify(payload))}::jsonb, ${q(label)}, ${q(REF)}, ${q(ROOM)}::uuid)::text, 'null');`);
  }
}
const out = execSync(`docker exec -i supabase_db_arab-ship-broker psql -U postgres -d ${DB} -X -q -At -v ON_ERROR_STOP=1`, { input: sqlRows.join("\n"), encoding: "utf8" })
  .split(/\r?\n/).filter((l) => l.length);
assert.equal(out.length, expected.length, `one SQL answer per case (${out.length} vs ${expected.length})`);
out.forEach((line, i) => {
  const sql = JSON.parse(line) as Record<string, unknown> | null;
  const want = expected[i];
  const got = sql ? { audience: sql.audience, importance: sql.importance, title: sql.title, body: sql.body, href: sql.href, deadlineAt: sql.deadlineAt ?? null } : null;
  assert.deepStrictEqual(got, want, `case ${i} differs:\n  sql ${JSON.stringify(got)}\n  ts  ${JSON.stringify(want)}`);
  checked++;
});
const notifying = expected.filter(Boolean).length;
const all = out.join(String.fromCharCode(10));
const leaks = out.filter((l) => /tasos|\+30|secret|hidden|<b>/i.test(l));
assert.ok(leaks.length === 0, `no free text reaches any SQL-produced message: ${leaks.join(" | ")}`);
console.log(`FIXTURE NOTIFY PARITY: ${checked} cases identical (${notifying} notify, ${checked - notifying} silent) across ${actors.length} actor kinds`);

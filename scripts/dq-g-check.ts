/**
 * Data Quality · workstream G checks (no network). Run:  npx tsx scripts/dq-g-check.ts
 *
 *   schedule    slots at HH:MM (02:30 included), one catch-up for a missed
 *               slot, the same key for every invocation inside a slot (the
 *               database's unique schedule_key refuses the duplicate —
 *               proved by dq_g_notifications_smoke.sql S6 and the
 *               two-session concurrency script), next-run and missed /
 *               catch-up state, the digest slot
 *   outbox      the worker against a fake database and a fake mailer: SMTP
 *               refuses → the row is settled as a retry, never sent; the
 *               next pass sends and settles sent; flags off → skipped with a
 *               note; the eighth failure → failed; two rows settle
 *               independently; the claim token travels to the settle
 *   states      queued/0 attempts = pending, queued/n = retrying, sending,
 *               sent, failed
 *   wording     the run-finished subject
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { digestSlot, nextNightlyAt, nightlySlot, parseHHMM, sameScope, scheduleVerdict } from "@/lib/dq/schedule";
import { deliverOutbox, renderNotification, runFinishedSubject } from "@/lib/dq/notify";
import { notificationState } from "@/lib/dq/types";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
const at = (iso: string) => new Date(iso);
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

console.log("nightly slots (HH:MM in Settings, hourly cron)");
ok(parseHHMM("02:30")?.h === 2 && parseHHMM("02:30")?.m === 30, "02:30 parses");
ok(parseHHMM("2am") === null && parseHHMM("24:00") === null && parseHHMM("") === null, "invalid times never fire");
ok(nightlySlot("02:30", at("2026-09-20T02:10:00Z"))?.key === "nightly/2026-09-19", "at 02:10 the current slot is still yesterday's 02:30");
ok(iso(nightlySlot("02:30", at("2026-09-20T02:10:00Z"))?.due) === "2026-09-19T02:30:00.000Z", "…due yesterday 02:30 exactly");
ok(nightlySlot("02:30", at("2026-09-20T02:30:00Z"))?.key === "nightly/2026-09-20", "at 02:30 today's slot is due (to the minute, not the hour)");
ok(nightlySlot("02:30", at("2026-09-20T03:10:00Z"))?.key === "nightly/2026-09-20", "at 03:10 (the first hourly tick after 02:30) today's slot is the one to create");
ok(nightlySlot("02:30", at("2026-09-20T23:59:00Z"))?.key === "nightly/2026-09-20", "at 23:59 today's slot is still the one — a missed night is caught up once, all day");
ok(nightlySlot("02:30", at("2026-09-21T02:29:59Z"))?.key === "nightly/2026-09-20", "one second before the next slot it is still the same key");
ok(nightlySlot("02:30", at("2026-09-20T03:10:00Z"))?.key === nightlySlot("02:30", at("2026-09-20T09:10:00Z"))?.key, "two invocations in one slot ask for the same key (the unique index makes the second a no-op)");
ok(nightlySlot("00:00", at("2026-09-20T00:00:00Z"))?.key === "nightly/2026-09-20", "midnight slot at midnight");
ok(nightlySlot("23:45", at("2026-09-20T00:10:00Z"))?.key === "nightly/2026-09-19", "a late-evening slot seen after midnight belongs to the previous date");
ok(nightlySlot("2am", at("2026-09-20T02:10:00Z")) === null, "an invalid time has no slot");
ok(iso(nextNightlyAt("02:30", at("2026-09-20T02:10:00Z"))) === "2026-09-20T02:30:00.000Z", "next run before the slot is today's 02:30");
ok(iso(nextNightlyAt("02:30", at("2026-09-20T02:30:00Z"))) === "2026-09-21T02:30:00.000Z", "next run at the slot is tomorrow's");
ok(iso(nextNightlyAt("22:00", at("2026-09-20T22:59:00Z"))) === "2026-09-21T22:00:00.000Z", "the old fixed 22:00 still works when configured");

console.log("schedule state (next run, missed, catch-up)");
const v1 = scheduleVerdict({ enabled: true, nightlyTime: "02:30", now: at("2026-09-20T03:00:00Z"), slotRunCreatedAt: null });
ok(v1.slot_key === "nightly/2026-09-20" && !v1.missed && !v1.catch_up && v1.next_at === "2026-09-21T02:30:00.000Z", "30 minutes after the slot with no run yet: not missed (the hourly tick is still due), next run tomorrow");
const v2 = scheduleVerdict({ enabled: true, nightlyTime: "02:30", now: at("2026-09-20T03:40:00Z"), slotRunCreatedAt: null });
ok(v2.missed && !v2.catch_up, "70 minutes after the slot with no run: missed");
const v3 = scheduleVerdict({ enabled: true, nightlyTime: "02:30", now: at("2026-09-20T09:00:00Z"), slotRunCreatedAt: "2026-09-20T08:05:00Z" });
ok(!v3.missed && v3.catch_up, "the slot's run created hours late: a catch-up, not missed");
const v4 = scheduleVerdict({ enabled: true, nightlyTime: "02:30", now: at("2026-09-20T09:00:00Z"), slotRunCreatedAt: "2026-09-20T03:05:00Z" });
ok(!v4.missed && !v4.catch_up, "the slot's run created at the first tick: on time");
const v5 = scheduleVerdict({ enabled: false, nightlyTime: "02:30", now: at("2026-09-20T09:00:00Z"), slotRunCreatedAt: null });
ok(!v5.missed && v5.next_at === null, "disabled: never missed, no next run");
const v6 = scheduleVerdict({ enabled: true, nightlyTime: "nope", now: at("2026-09-20T09:00:00Z"), slotRunCreatedAt: null });
ok(v6.slot_key === null && !v6.missed, "an invalid time has no slot and is not 'missed'");

console.log("digest slot (Monday 07:00 UTC, once, not late)");
ok(digestSlot(at("2026-09-21T07:20:00Z"))?.key === "digest/2026-09-21", "Monday 07:20 is the Monday slot");
ok(digestSlot(at("2026-09-21T23:00:00Z"))?.key === "digest/2026-09-21", "Monday evening still the same slot (same key → queued once)");
ok(digestSlot(at("2026-09-21T06:50:00Z")) === null, "Monday 06:50: last week's slot is a week old — not sent late");
ok(digestSlot(at("2026-09-22T07:20:00Z")) === null, "Tuesday: more than a day after the slot — not sent late");
ok(digestSlot(at("2026-09-20T12:00:00Z")) === null, "Sunday: nothing");

console.log("compare guard");
ok(sameScope({ kind: "tables", tables: ["ports", "vessels"] }, { kind: "tables", tables: ["vessels", "ports"] }), "same tables in any order compare");
ok(!sameScope({ kind: "tables", tables: ["ports"] }, { kind: "tables", tables: ["vessels"] }), "different tables do not");
ok(!sameScope({ kind: "filter", filter: "live" }, { kind: "filter", filter: "open" }), "different filters do not");
ok(sameScope({ kind: "db" }, { kind: "db" }), "two whole-database runs compare");

console.log("notification states");
ok(notificationState({ status: "queued", attempts: 0 }) === "pending", "queued, never tried: pending");
ok(notificationState({ status: "queued", attempts: 2 }) === "retrying", "queued after a failure: retrying");
ok(notificationState({ status: "sending", attempts: 1 }) === "sending" && notificationState({ status: "sent", attempts: 1 }) === "sent" && notificationState({ status: "failed", attempts: 8 }) === "failed", "sending / sent / failed pass through");

console.log("notification wording");
ok(runFinishedSubject({ code: "run-012", status: "completed_with_errors", found: { error: 3, warn: 10, info: 2 } }) === "[Data quality] run-012 completed with errors — 3 errors · 10 warnings", "subject says the status and counts");

// ── the outbox worker against a fake database ─────────────────────────────
type Row = Record<string, unknown>;
interface Fake { sb: SupabaseClient; calls: { name: string; args: Row }[]; inserts: { table: string; row: Row }[] }
function fakeDb(opts: { claims: Row[][]; runs: Record<string, Row>; notify: Row | null; settleResult?: boolean }): Fake {
  const calls: { name: string; args: Row }[] = [];
  const inserts: { table: string; row: Row }[] = [];
  let claimCall = 0;
  const table = (name: string) => {
    const filters: Row = {};
    const q: Record<string, unknown> = {};
    const chain = (col?: string, val?: unknown) => { if (col) filters[col] = val; return q; };
    Object.assign(q, {
      select: () => q, order: () => q, limit: () => q, lt: () => q, is: () => q, in: () => q, not: () => q, eq: chain,
      maybeSingle: async () => ({ data: name === "dq_settings" ? { notify: opts.notify } : name === "dq_runs" ? opts.runs[String(filters.id)] ?? null : null, error: null }),
      single: async () => ({ data: name === "dq_runs" ? opts.runs[String(filters.id)] ?? null : null, error: null }),
      insert: (row: Row) => { inserts.push({ table: name, row }); return Promise.resolve({ data: null, error: null }); },
      then: (res: (v: unknown) => void) => res({ data: [], count: 0, error: null }),
    });
    return q;
  };
  const sb = {
    from: table,
    rpc: async (name: string, args: Row = {}) => {
      calls.push({ name, args });
      if (name === "fn_dq_outbox_claim") return { data: opts.claims[claimCall++] ?? [], error: null };
      if (name === "fn_dq_outbox_settle") return { data: opts.settleResult ?? true, error: null };
      if (name === "fn_dq_health_cached") return { data: [{ label: "Ports", score: 97.5, open: 3 }], error: null };
      if (name === "fn_dq_open_by_severity") return { data: { error: 1, warn: 2, info: 0 }, error: null };
      return { data: null, error: { message: `unexpected rpc ${name}` } };
    },
  } as unknown as SupabaseClient;
  return { sb, calls, inserts };
}
const run = { id: "11111111-1111-4111-8111-111111111111", code: "run-042", status: "completed", notify: false, scope: { kind: "db" }, mode: "rules", rows_done: 10, total_rows: 10, batches_done: 1, found: { error: 2, warn: 0, info: 0 }, rule_errors: [], coverage_pct: 100, rules_failed: 0, rules_expected: 3, checks_failed: 0, checks_expected: 3, note: null, error: null };
const row = (attempts: number, id = 1, kind = "run_finished", payload: Row = { run_id: run.id }) => ({ id, idem_key: `${kind}/${id}`, kind, payload, status: "sending", attempts, claim_token: `token-${id}-${attempts}`, next_attempt_at: "", sent_at: null, last_error: null, recipients: null, created_at: "" });
const settles = (f: Fake) => f.calls.filter((c) => c.name === "fn_dq_outbox_settle").map((c) => c.args);
const notify = { recipients: ["ops@example.com"], on_complete: true, on_errors: true, digest: true, budget80: true };

async function main() {
  console.log("outbox worker: SMTP failure, retry, success");
  {
    const f = fakeDb({ claims: [[row(1)], [row(2)]], runs: { [run.id]: run }, notify });
    let sends = 0;
    const send = async () => { sends += 1; if (sends === 1) throw new Error("SMTP connect ECONNREFUSED"); };
    const first = await deliverOutbox(f.sb, { send });
    ok(first.claimed === 1 && first.retried === 1 && first.sent === 0, `first pass: SMTP refused → 1 retried, nothing sent (${JSON.stringify(first)})`);
    const s1 = settles(f)[0];
    ok(s1.p_ok === false && /ECONNREFUSED/.test(String(s1.p_error)) && s1.p_token === "token-1-1" && JSON.stringify(s1.p_recipients) === JSON.stringify(["ops@example.com"]), "…settled ok=false with the SMTP error, the claim token and the recipients");
    const second = await deliverOutbox(f.sb, { send });
    ok(second.sent === 1 && second.retried === 0, `second pass: sent (${JSON.stringify(second)})`);
    const s2 = settles(f)[1];
    ok(s2.p_ok === true && s2.p_error === null && s2.p_token === "token-1-2", "…settled ok=true with the new claim token — 'sent' only after SMTP accepted it");
    ok(f.inserts.filter((i) => i.table === "dq_config_events").length === 2, "both attempts are on the configuration history");
    ok(f.calls.filter((c) => c.name === "fn_dq_outbox_claim").every((c) => c.args.p_limit === 10 && c.args.p_ttl_seconds === 600), "claims ask for the default lease — 600 s, longer than any send this module makes");
  }
  console.log("outbox worker: at-least-once, honestly accounted");
  {
    // The database refuses the settle because another worker reclaimed the
    // row. The mail has already gone out; a second delivery is possible, and
    // the audit's point is that this must never be reported as a clean send.
    const f = fakeDb({ claims: [[row(1)]], runs: { [run.id]: run }, notify, settleResult: false });
    let sends = 0;
    const r = await deliverOutbox(f.sb, { send: async () => { sends += 1; } });
    ok(sends === 1 && r.sent === 0 && r.lost === 1, `a superseded claim is counted lost, never sent (${JSON.stringify(r)})`);
    const ev = f.inserts.filter((i) => i.table === "dq_config_events").map((i) => String((i.row.after as Row)?.detail ?? ""));
    ok(ev.some((d) => /reclaimed before it could be settled/.test(d) && /delivered again/.test(d)), "…and the history says the message may be delivered again");
    const g = fakeDb({ claims: [[row(1)]], runs: { [run.id]: run }, notify, settleResult: false });
    const r2 = await deliverOutbox(g.sb, { send: async () => { throw new Error("SMTP connect ECONNREFUSED"); } });
    ok(r2.retried === 0 && r2.failed === 0 && r2.lost === 1, "a failure whose settle is refused is not counted as a retry either — the row is not ours to schedule");
    const h = fakeDb({ claims: [[row(1)]], runs: { [run.id]: run }, notify: { ...notify, recipients: [] }, settleResult: false });
    const r3 = await deliverOutbox(h.sb, { send: async () => { throw new Error("must not be called"); } });
    ok(r3.skipped === 0 && r3.lost === 1, "a skip whose settle is refused is lost, not skipped");
  }
  console.log("outbox worker: a stable Message-ID makes the duplicate collapsible");
  {
    const f = fakeDb({ claims: [[row(1)]], runs: { [run.id]: run }, notify });
    const a = await renderNotification(f.sb, { kind: "run_finished", payload: { run_id: run.id }, idem_key: "run_finished/2026-09-21/run-042" }, notify);
    const b = await renderNotification(f.sb, { kind: "run_finished", payload: { run_id: run.id }, idem_key: "run_finished/2026-09-21/run-042" }, notify);
    ok("mail" in a && "mail" in b && a.mail.messageId === b.mail.messageId, "two renders of the same outbox row carry the same Message-ID");
    ok("mail" in a && a.mail.messageId === "<dq.run_finished-2026-09-21-run-042@arabshipbroker.com>", `…derived from the idempotency key (${"mail" in a ? a.mail.messageId : "?"})`);
    const c = await renderNotification(f.sb, { kind: "run_finished", payload: { run_id: run.id }, idem_key: "run_finished/2026-09-22/run-043" }, notify);
    ok("mail" in c && "mail" in a && c.mail.messageId !== a.mail.messageId, "a different row gets a different one");
    ok("mail" in a && /^<dq\.[A-Za-z0-9._-]+@[A-Za-z0-9.-]+>$/.test(a.mail.messageId), "the header is a syntactically valid Message-ID");
    const m = await deliverOutbox(f.sb, { send: async (_sb, mail) => { ok(mail.messageId === "<dq.run_finished-1@arabshipbroker.com>", "the worker passes the row's own Message-ID to the transport"); } });
    ok(m.sent === 1, "…and the send is counted once");
  }
  console.log("outbox worker: settings decide, the worker records why");
  {
    const f = fakeDb({ claims: [[row(1)]], runs: { [run.id]: run }, notify: { ...notify, on_complete: false, on_errors: false } });
    let sends = 0;
    const r = await deliverOutbox(f.sb, { send: async () => { sends += 1; } });
    ok(r.skipped === 1 && sends === 0 && settles(f)[0].p_ok === true && /^skipped: neither/.test(String(settles(f)[0].p_error)), "flags off: nothing sent, settled with a 'skipped' note");
    const g = fakeDb({ claims: [[row(1)]], runs: { [run.id]: run }, notify: { ...notify, recipients: [] } });
    const r2 = await deliverOutbox(g.sb, { send: async () => undefined });
    ok(r2.skipped === 1 && /no recipients/.test(String(settles(g)[0].p_error)), "no recipients: skipped with the reason");
    const h = fakeDb({ claims: [[row(1)]], runs: { [run.id]: { ...run, status: "completed", found: { error: 0, warn: 1, info: 0 } } }, notify: { ...notify, on_complete: false, on_errors: true } });
    const r3 = await deliverOutbox(h.sb, { send: async () => undefined });
    ok(r3.skipped === 1, "on_errors only and a clean run: skipped");
    const i = fakeDb({ claims: [[row(1)]], runs: { [run.id]: { ...run, status: "failed" } }, notify: { ...notify, on_complete: false, on_errors: true } });
    const r4 = await deliverOutbox(i.sb, { send: async () => undefined });
    ok(r4.sent === 1, "on_errors only and a failed run: sent");
    const rendered = await renderNotification(f.sb, { kind: "budget80", payload: { tokens: 850_000, cap: 1_000_000 } }, notify);
    ok("mail" in rendered && rendered.mail.subject === "[Data quality] AI budget at 85 %", "budget80 renders from its payload");
    const dg = await renderNotification(f.sb, { kind: "digest", payload: {} }, notify);
    ok("mail" in dg && /Ports: score 97\.5 · 3 open/.test(dg.mail.text) && /1 errors · 2 warnings/.test(dg.mail.text), "the digest renders health and open counts");
  }
  console.log("outbox worker: giving up, independence, claim errors");
  {
    const f = fakeDb({ claims: [[row(8)]], runs: { [run.id]: run }, notify });
    const r = await deliverOutbox(f.sb, { send: async () => { throw new Error("550 mailbox unavailable"); } });
    ok(r.failed === 1 && r.retried === 0 && settles(f)[0].p_ok === false && settles(f)[0].p_max_attempts === 8, "the eighth failure is reported as failed (the database marks it so)");
    const g = fakeDb({ claims: [[row(1, 1), row(1, 2)]], runs: { [run.id]: run }, notify });
    let n = 0;
    const r2 = await deliverOutbox(g.sb, { send: async () => { n += 1; if (n === 1) throw new Error("boom"); } });
    ok(r2.claimed === 2 && r2.retried === 1 && r2.sent === 1, "two rows: one refused, one sent — settled independently");
    ok(settles(g)[0].p_id === 1 && settles(g)[0].p_ok === false && settles(g)[1].p_id === 2 && settles(g)[1].p_ok === true, "…each settle names its own row and token");
    const h = fakeDb({ claims: [[row(1)]], runs: {}, notify });
    const r3 = await deliverOutbox(h.sb, { send: async () => undefined });
    ok(r3.skipped === 1 && /no longer exists/.test(String(settles(h)[0].p_error)), "a run that vanished is skipped, not retried forever");
    const bad = { ...fakeDb({ claims: [], runs: {}, notify }).sb, rpc: async () => ({ data: null, error: { message: "relation does not exist" } }) } as unknown as SupabaseClient;
    let threw = "";
    try { await deliverOutbox(bad); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
    ok(/outbox claim: relation does not exist/.test(threw), "a claim failure throws (the caller's cron reports it)");
    const empty = await deliverOutbox(fakeDb({ claims: [], runs: {}, notify }).sb, { send: async () => { throw new Error("must not be called"); } });
    ok(empty.claimed === 0 && empty.sent === 0, "nothing due: nothing sent");
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();

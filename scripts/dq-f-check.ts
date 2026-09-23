/**
 * Data Quality · workstream F / H checks (no network). Run:  npx tsx scripts/dq-f-check.ts
 * The AI budget helpers, the batch-timeout classifier and the engine's
 * reaction to a cancelled batch, against a fake database. Reservation
 * arithmetic, leases, settlement, grouped severities and sliced retention
 * are exercised by supabase/tests/data_quality/dq_f_performance_smoke.sql;
 * the persisted batch limit, the floor and the failure after three timeouts
 * by dq_h_scaling_smoke.sql; two-session races by dq_concurrency_two_sessions.sh.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { aiIdemKey, estimateAiTokens, isLockContention, isStatementTimeout, isTransientAiError, LOCK_RETRY_MAX, lockRetryDelayMs, must, withDeadline } from "@/lib/dq/ai-budget";
import { isStalled, processOneBatch, reserveAi } from "@/lib/dq/engine";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

console.log("budget helpers");
ok(estimateAiTokens(40, 10) === 2_500 + 40 * 350 + 10 * 60, "estimate grows with rows and rules");
ok(estimateAiTokens(0, 0) === 2_500, "an empty sample still reserves the prompt overhead");
ok(isTransientAiError("Request timed out") && isTransientAiError("429 Too Many Requests") && isTransientAiError("model overloaded"), "timeouts, rate limits and overloads are transient");
ok(!isTransientAiError("invalid api key") && !isTransientAiError("content policy"), "refusals and bad credentials are not retried");
ok(must({ error: null, data: 1 }, "x").data === 1, "a clean write passes through");
let threw = "";
try { must({ error: { message: "duplicate key" } }, "insert dq_issues"); } catch (e) { threw = e instanceof Error ? e.message : String(e); }
ok(threw === "insert dq_issues: duplicate key", "a failed write throws with the write named");
ok(aiIdemKey("b1") === "ai/b1", "one reservation key per batch");

console.log("timeout classifier — 57014 is batch pressure, 55P03 is contention");
// Both arrive as "canceling statement …" and both used to be classified as a
// statement timeout, so lock contention shrank the batch: the wrong remedy,
// and a permanent loss of throughput for the rest of the run because the
// persisted limit never grows back on its own. The assertion below used to
// read `isStatementTimeout("… lock timeout", "55P03")` — the test wrote the
// defect down as the contract (corrected 21 Sep 2026).
ok(isStatementTimeout("canceling statement due to statement timeout"), "PostgREST's statement_timeout message");
ok(isStatementTimeout("some text", "57014"), "SQLSTATE 57014 (query_canceled) is batch pressure");
ok(!isStatementTimeout("canceling statement due to lock timeout", "55P03"), "SQLSTATE 55P03 is NOT a statement timeout — shrinking the batch would not help");
ok(isLockContention("canceling statement due to lock timeout", "55P03"), "SQLSTATE 55P03 (lock_not_available) is contention");
ok(isLockContention("whatever", "55P03") && isLockContention("could not obtain lock on row"), "…by code or by message");
ok(!isLockContention("canceling statement due to statement timeout", "57014"), "a statement timeout is not contention");
ok(!isStatementTimeout("duplicate key value violates unique constraint") && !isStatementTimeout("division by zero", "22012"), "a real error is not a timeout");
ok(!isLockContention("duplicate key value violates unique constraint") && !isLockContention(null), "a real error is not contention, and neither is nothing");
// the two must never both claim one error: one error, one remedy
for (const [msg, code] of [["canceling statement due to statement timeout", "57014"], ["canceling statement due to lock timeout", "55P03"], ["boom", null], ["", null]] as [string, string | null][]) {
  ok(!(isStatementTimeout(msg, code) && isLockContention(msg, code)), `"${msg.slice(0, 40)}" (${code ?? "no code"}): classified as one thing, not both`);
}

console.log("contention back-off — bounded, and jittered so two workers stop colliding");
ok(LOCK_RETRY_MAX >= 2 && LOCK_RETRY_MAX <= 5, `the ladder is short (${LOCK_RETRY_MAX} attempts at one range)`);
{
  // jitter is +/-40 %, so the same attempt can differ between two workers
  const lo = lockRetryDelayMs(1, () => 0);
  const hi = lockRetryDelayMs(1, () => 1);
  ok(lo < hi, `attempt 1 varies with the jitter (${lo} ms … ${hi} ms)`);
  ok(lockRetryDelayMs(1, () => 0.5) < lockRetryDelayMs(3, () => 0.5), "the wait grows with the attempt");
  let worst = 0;
  for (let a = 1; a <= LOCK_RETRY_MAX; a += 1) worst += lockRetryDelayMs(a, () => 1);
  ok(worst < 5_000, `the whole ladder waits under 5 s even at the top of the jitter (${worst} ms) — it fits inside one invocation`);
  // never negative, never zero, whatever the random source returns
  let bad = 0;
  for (const r of [0, 0.001, 0.5, 0.999, 1, -1, 2, NaN]) {
    for (let a = 0; a <= LOCK_RETRY_MAX + 2; a += 1) {
      const d = lockRetryDelayMs(a, () => r);
      if (!(d > 0) || !Number.isFinite(d)) bad += 1;
    }
  }
  ok(bad === 0, "every delay is a finite, positive number for any attempt and any random source");
}

console.log("stall detection");
const now = Date.parse("2026-09-20T10:00:00Z");
ok(isStalled({ status: "running", last_batch_at: "2026-09-20T09:58:00Z", started_at: null, created_at: "" }, now), "running, last batch 2 minutes ago: stalled");
ok(!isStalled({ status: "running", last_batch_at: "2026-09-20T09:59:30Z", started_at: null, created_at: "" }, now), "running, last batch 30 s ago: not stalled");
ok(!isStalled({ status: "paused", last_batch_at: "2026-09-20T09:00:00Z", started_at: null, created_at: "" }, now), "a paused run is never stalled");
ok(isStalled({ status: "running", last_batch_at: null, started_at: "2026-09-20T09:00:00Z", created_at: "" }, now), "running with no batch yet, started an hour ago: stalled");

// ── the engine against a fake database ────────────────────────────────────
type Row = Record<string, unknown>;
function fakeDb(run: Row, rpc: (name: string, args: Row) => { data?: unknown; error?: { message: string; code?: string } | null }) {
  const calls: { name: string; args: Row }[] = [];
  const q: Record<string, unknown> = {};
  Object.assign(q, { select: () => q, eq: () => q, order: () => q, single: async () => ({ data: run, error: null }), maybeSingle: async () => ({ data: run, error: null }), update: () => q, then: (r: (v: unknown) => void) => r({ data: null, error: null }) });
  const sb = { from: () => q, rpc: async (name: string, args: Row = {}) => { calls.push({ name, args }); const r = rpc(name, args); return { data: r.data ?? null, error: r.error ?? null }; } } as unknown as SupabaseClient;
  return { sb, calls };
}
const running = { id: "r1", status: "running", mode: "rules", cursor: { idx: 0, last: "K100" } };

async function main() {
  console.log("a cancelled batch shrinks the limit and never fails the run by itself");
  {
    const f = fakeDb(running, (name) => name === "fn_dq_process_batch" ? { error: { message: "canceling statement due to statement timeout", code: "57014" } } : name === "fn_dq_batch_timeout" ? { data: { status: "running", batch_limit: 250, was: 500 } } : { data: null });
    const step = await processOneBatch(f.sb, "r1");
    ok(!step.done && "timeout" in step && step.timeout === true && step.batch_limit === 250, `the step reports a timeout with the new limit (${JSON.stringify(step)})`);
    ok(f.calls.some((c) => c.name === "fn_dq_batch_timeout" && c.args.p_run_id === "r1" && /statement timeout/.test(String(c.args.p_error))), "fn_dq_batch_timeout was called with the run and the error (its own transaction)");
    ok(!f.calls.some((c) => c.name === "fn_dq_finish_run"), "fn_dq_finish_run was NOT called — a timeout is not a failed run");
    ok(!f.calls.some((c) => c.name === "fn_dq_prepare_run"), "no re-prepare: the cursor is untouched (the cancelled batch rolled back)");
  }
  {
    const f = fakeDb(running, (name) => name === "fn_dq_process_batch" ? { error: { message: "canceling statement due to statement timeout" } } : name === "fn_dq_batch_timeout" ? { data: { status: "failed", batch_limit: 10 } } : { data: null });
    const step = await processOneBatch(f.sb, "r1");
    ok(step.done && step.status === "failed", "when the database gives up (three timeouts at the floor) the step is done/failed");
    ok(!f.calls.some((c) => c.name === "fn_dq_finish_run"), "…and the engine does not finish it a second time (the database already did)");
  }
  {
    const f = fakeDb(running, (name) => name === "fn_dq_process_batch" ? { error: { message: "division by zero", code: "22012" } } : { data: null });
    const step = await processOneBatch(f.sb, "r1");
    ok(step.done && step.status === "failed" && f.calls.some((c) => c.name === "fn_dq_finish_run" && c.args.p_status === "failed"), "a real error still fails the run through fn_dq_finish_run");
    ok(!f.calls.some((c) => c.name === "fn_dq_batch_timeout"), "…without touching the batch limit");
  }
  {
    const f = fakeDb({ ...running, status: "queued" }, (name) => name === "fn_dq_process_batch" ? { data: { done: false, batch_id: "b1", n: 1, table: "ports", key_from: "A", key_to: "B", rows: 250, rules: 3, limit: 250, next_limit: 500, ms: 300, found: { error: 0, warn: 0, info: 0 }, errors: [] } } : { data: null });
    const step = await processOneBatch(f.sb, "r1");
    ok(f.calls[0].name === "fn_dq_prepare_run" && !step.done && "batch_id" in step && step.next_limit === 500, "a queued run is prepared first; a normal batch passes the probe's next limit through");
  }
  console.log("reservation wrapper");
  {
    const f = fakeDb(running, (name) => name === "fn_dq_reserve_ai" ? { data: { ok: true, reservation_id: "res-1", reserved: 5000, left: 995_000, existing: false } } : { data: null });
    const r = await reserveAi(f.sb, 5000, "ai/b1", "b1");
    ok(r.ok && r.reservationId === "res-1" && r.left === 995_000 && !r.existing, "a reservation returns its id and what is left");
    ok(f.calls[0].args.p_idem_key === "ai/b1" && f.calls[0].args.p_batch_id === "b1" && f.calls[0].args.p_ttl_seconds === 600, "…keyed by the batch, leased for 10 minutes");
    const g = fakeDb(running, () => ({ data: { ok: false, reservation_id: null, reserved: 0, left: 1200 } }));
    const r2 = await reserveAi(g.sb, 5000, "ai/b2", "b2");
    ok(!r2.ok && r2.reservationId === null && r2.left === 1200, "over the cap: refused with what is left");
  }
  console.log("deadline");
  const fast = await withDeadline(Promise.resolve("done"), 1000, "fast call");
  ok(fast === "done", "a call inside the deadline resolves");
  let err = "";
  try { await withDeadline(new Promise((r) => setTimeout(r, 200)), 20, "slow call"); } catch (e) { err = e instanceof Error ? e.message : String(e); }
  ok(/slow call timed out/.test(err), "a call past the deadline rejects with the deadline named");
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();

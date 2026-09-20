/**
 * Data Quality · engine and delivery resilience (no network).
 * Run:  npx tsx scripts/dq-engine-resilience-check.ts
 *
 * Four defects, tested by behaviour against a fake database that keeps state
 * the way the real one does — so a "separate invocation" really is separate:
 * a new driveRun call, sharing nothing but the database.
 *
 *   E · durable failure state   the consecutive-failure count lived in a
 *       JavaScript Map keyed by run id. A serverless invocation shares no
 *       memory with the next, so the count restarted at zero every cold start
 *       and the "stop after three" limit never bound. Now it is a column, and
 *       three SEPARATE invocations reach it.
 *
 *   C · contention vs pressure  SQLSTATE 57014 (statement timeout) means the
 *       batch is too big: shrink it. 55P03 (lock_not_available) means someone
 *       else holds the rows: the size is irrelevant, wait and try the same
 *       range again. Both used to shrink the batch.
 *
 *   L · the notification lease  two workers, a lease that expires mid-send, a
 *       settle that arrives too late, a worker that never comes back, and the
 *       attempt cap that has to stop all of it.
 *
 *   M · duplicate suppression   delivery is at-least-once, so the same row
 *       sent twice must carry the same Message-ID both times.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { driveRun, processOneBatch } from "@/lib/dq/engine";
import { deliverOutbox, mailMessageId, OUTBOX_MAX_ATTEMPTS } from "@/lib/dq/notify";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };
type Row = Record<string, unknown>;

// ── a fake database that keeps state between invocations ───────────────────
interface RunState {
  id: string;
  status: string;
  consecutive_errors: number;
  last_engine_error: string | null;
  note: string | null;
  batch_limit: number | null;
  timeout_retries: number;
}

interface EngineFake {
  sb: SupabaseClient;
  runs: Map<string, RunState>;
  calls: { name: string; args: Row }[];
  /** what fn_dq_process_batch does on each successive call */
  script: (
    | { kind: "ok"; done?: boolean }
    | { kind: "error"; message: string; code?: string }
    | { kind: "throw"; message: string }
  )[];
  scriptAt: number;
  notifications: string[];
}

function engineFake(run: Partial<RunState> & { id: string }, script: EngineFake["script"]): EngineFake {
  const f: EngineFake = {
    runs: new Map(),
    calls: [],
    script,
    scriptAt: 0,
    notifications: [],
    sb: null as unknown as SupabaseClient,
  };
  f.runs.set(run.id, {
    id: run.id, status: run.status ?? "running", consecutive_errors: run.consecutive_errors ?? 0,
    last_engine_error: run.last_engine_error ?? null, note: run.note ?? null,
    batch_limit: run.batch_limit ?? 500, timeout_retries: run.timeout_retries ?? 0,
  });

  const table = (name: string) => {
    const filters: Row = {};
    const q: Record<string, unknown> = {};
    const chain = (col?: string, val?: unknown) => { if (col) filters[col] = val; return q; };
    Object.assign(q, {
      select: () => q, order: () => q, limit: () => q, lt: () => q, is: () => q, in: () => q, not: () => q, filter: () => q, eq: chain,
      update: (patch: Row) => { const r = f.runs.get(String(filters.id)); if (r && name === "dq_runs") Object.assign(r, patch); return q; },
      insert: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: async () => ({ data: name === "dq_runs" ? f.runs.get(String(filters.id)) ?? null : null, error: null }),
      single: async () => {
        const r = name === "dq_runs" ? f.runs.get(String(filters.id)) ?? null : null;
        return { data: r, error: r ? null : { message: "not found" } };
      },
      then: (res: (v: unknown) => void) => res({ data: [], count: 0, error: null }),
    });
    return q;
  };

  f.sb = {
    from: table,
    rpc: async (name: string, args: Row = {}) => {
      f.calls.push({ name, args });
      const run = f.runs.get(String(args.p_run_id ?? ""));
      if (name === "fn_dq_process_batch") {
        const step = f.script[Math.min(f.scriptAt, f.script.length - 1)];
        f.scriptAt += 1;
        if (step.kind === "throw") throw new Error(step.message);
        if (step.kind === "error") return { data: null, error: { message: step.message, code: step.code } };
        return { data: { done: step.done ?? false, batch_id: "b1", n: 1, table: "ports", key_from: "a", key_to: "z", rows: 10, rules: 1, found: { error: 0, warn: 0, info: 0 }, errors: [] }, error: null };
      }
      if (name === "fn_dq_run_note_error") {
        if (!run) return { data: { ok: false, reason: "no_such_run" }, error: null };
        run.consecutive_errors += 1;
        run.last_engine_error = String(args.p_error ?? "").slice(0, 500);
        const max = Number(args.p_max ?? 3);
        return { data: { ok: true, consecutive_errors: run.consecutive_errors, give_up: run.consecutive_errors >= max, status: run.status }, error: null };
      }
      if (name === "fn_dq_run_clear_errors") {
        if (run) { run.consecutive_errors = 0; run.last_engine_error = null; }
        return { data: null, error: null };
      }
      if (name === "fn_dq_finish_run") {
        if (run) run.status = String(args.p_status ?? "failed");
        // the database enqueues the notification inside the same transaction,
        // keyed by the run: once, however many invocations see it finish
        if (!f.notifications.includes(`run/${args.p_run_id}`)) f.notifications.push(`run/${args.p_run_id}`);
        return { data: null, error: null };
      }
      if (name === "fn_dq_batch_timeout") {
        if (!run) return { data: null, error: { message: "no run" } };
        const cur = run.batch_limit ?? 500;
        const next = Math.max(10, Math.floor(cur / 2));
        run.batch_limit = next;
        if (cur <= 10) run.timeout_retries += 1;
        return { data: { status: "running", batch_limit: next, was: cur }, error: null };
      }
      if (name === "fn_dq_prepare_run") return { data: { status: "running" }, error: null };
      if (name === "fn_dq_outbox_claim") return { data: [], error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return f;
}

const rpcNames = (f: EngineFake) => f.calls.map((c) => c.name);

async function main() {
  console.log("E · the failure count survives the invocation");
  {
    const f = engineFake({ id: "r1" }, [{ kind: "throw", message: "fetch failed: ECONNRESET" }]);
    // three SEPARATE calls, as three cron invocations would be. The old
    // in-process Map would have answered 1, 1, 1 and never given up.
    const a = await driveRun("r1", 1_000, f.sb);
    ok(!a.done && a.status === "running", `invocation 1: reports the failure and hands back (${a.status})`);
    ok(f.runs.get("r1")!.consecutive_errors === 1, "…and the count is in the database, not in this process");

    const b = await driveRun("r1", 1_000, f.sb);
    ok(!b.done && f.runs.get("r1")!.consecutive_errors === 2, "invocation 2 sees the first one's failure (count 2)");

    const c = await driveRun("r1", 1_000, f.sb);
    ok(c.done && c.status === "failed", "invocation 3 reaches the limit and fails the run");
    ok(f.runs.get("r1")!.status === "failed", "…the run really is failed in the database");
    ok(f.runs.get("r1")!.last_engine_error === "fetch failed: ECONNRESET", "…and the error that caused it is retained");
    ok(f.notifications.length === 1, `…and exactly one notification was enqueued (${f.notifications.length})`);
    ok(f.calls.filter((x) => x.name === "fn_dq_finish_run").length === 1, "the run is failed once, not once per invocation");
  }

  console.log("E · a successful batch clears the streak, and only then");
  {
    const f = engineFake({ id: "r2", consecutive_errors: 2 }, [{ kind: "ok" }, { kind: "ok", done: true }]);
    await driveRun("r2", 2_000, f.sb);
    ok(f.runs.get("r2")!.consecutive_errors === 0, "two failures then progress: the streak is cleared");
    ok(rpcNames(f).includes("fn_dq_run_clear_errors"), "…by the database, atomically");
  }
  {
    // a run that never progresses is never cleared
    const f = engineFake({ id: "r3", consecutive_errors: 1 }, [{ kind: "throw", message: "still broken" }]);
    await driveRun("r3", 1_000, f.sb);
    ok(f.runs.get("r3")!.consecutive_errors === 2, "another failure adds to the streak rather than resetting it");
    ok(!rpcNames(f).includes("fn_dq_run_clear_errors"), "…and nothing cleared it");
  }
  {
    // the count could not be recorded: do not fail the run on one unrecorded
    // error — the stall detector handles a run that stops progressing
    const f = engineFake({ id: "ghost" }, [{ kind: "throw", message: "boom" }]);
    f.runs.delete("ghost");
    const r = await driveRun("ghost", 1_000, f.sb);
    ok(!r.done && r.status === "running", "an unrecordable failure leaves the run alone rather than failing it blind");
  }

  console.log("C · 57014 shrinks the batch; 55P03 does not");
  {
    const f = engineFake({ id: "t1" }, [{ kind: "error", message: "canceling statement due to statement timeout", code: "57014" }]);
    const step = await processOneBatch(f.sb, "t1");
    ok("timeout" in step && step.timeout === true, "a statement timeout is reported as a timeout");
    ok(rpcNames(f).includes("fn_dq_batch_timeout"), "…and the persisted limit is shrunk");
    ok(f.runs.get("t1")!.batch_limit === 250, `…from 500 to 250 (${f.runs.get("t1")!.batch_limit})`);
  }
  {
    // contention three times: retried in place, then handed back
    const f = engineFake({ id: "t2" }, [
      { kind: "error", message: "canceling statement due to lock timeout", code: "55P03" },
      { kind: "error", message: "canceling statement due to lock timeout", code: "55P03" },
      { kind: "error", message: "canceling statement due to lock timeout", code: "55P03" },
    ]);
    const t0 = Date.now();
    const step = await processOneBatch(f.sb, "t2");
    const waited = Date.now() - t0;
    ok("contended" in step && step.contended === true, "contention is reported as contention, not as a timeout");
    ok(!rpcNames(f).includes("fn_dq_batch_timeout"), "…the batch is NOT shrunk: the size was never the problem");
    ok(f.runs.get("t2")!.batch_limit === 500, `…the persisted limit is untouched (${f.runs.get("t2")!.batch_limit})`);
    ok(f.calls.filter((c) => c.name === "fn_dq_process_batch").length === 3, "…the same range was tried three times");
    ok(waited >= 150 && waited < 5_000, `…with a real but bounded wait between attempts (${waited} ms)`);
  }
  {
    // contention that clears on the second attempt: the run just carries on
    const f = engineFake({ id: "t3" }, [
      { kind: "error", message: "canceling statement due to lock timeout", code: "55P03" },
      { kind: "ok" },
    ]);
    const step = await processOneBatch(f.sb, "t3");
    ok(!("contended" in step) && !("timeout" in step && step.timeout), "contention that clears is invisible to the caller");
    ok(f.runs.get("t3")!.batch_limit === 500, "…and cost nothing in throughput");
  }
  {
    // a real error still fails the run
    const f = engineFake({ id: "t4" }, [{ kind: "error", message: "column dq_issues.nope does not exist", code: "42703" }]);
    const step = await processOneBatch(f.sb, "t4");
    ok(step.done === true && step.status === "failed", "a genuine error fails the run rather than being retried for ever");
  }

  // ── L · the notification lease, with two workers ─────────────────────────
  console.log("L · two workers, one row");
  interface OutRow { id: number; idem_key: string; kind: string; payload: Row; status: string; attempts: number; claim_token: string | null; lease_until: number; last_error: string | null }

  function outboxFake(rows: OutRow[], clock = { t: 1_000_000 }) {
    const calls: { name: string; args: Row }[] = [];
    const notify = { recipients: ["ops@example.com"], on_complete: true, on_errors: true, digest: true, budget80: true };
    const run = { id: "run-1", code: "run-042", status: "completed", notify: true, scope: { kind: "db" }, mode: "rules", rows_done: 1, total_rows: 1, batches_done: 1, found: { error: 1, warn: 0, info: 0 }, rule_errors: [], coverage_pct: 100, rules_failed: 0, rules_expected: 1, checks_failed: 0, checks_expected: 1, note: null, error: null };
    const table = (name: string) => {
      const q: Record<string, unknown> = {};
      Object.assign(q, {
        select: () => q, order: () => q, limit: () => q, lt: () => q, is: () => q, in: () => q, not: () => q, filter: () => q, eq: () => q,
        maybeSingle: async () => ({ data: name === "dq_settings" ? { notify } : name === "dq_runs" ? run : null, error: null }),
        single: async () => ({ data: name === "dq_runs" ? run : null, error: null }),
        insert: () => Promise.resolve({ data: null, error: null }),
        then: (res: (v: unknown) => void) => res({ data: [], count: 0, error: null }),
      });
      return q;
    };
    const sb = {
      from: table,
      rpc: async (name: string, args: Row = {}) => {
        calls.push({ name, args });
        if (name === "fn_dq_outbox_claim") {
          const max = Number(args.p_max_attempts ?? OUTBOX_MAX_ATTEMPTS);
          const ttl = Number(args.p_ttl_seconds ?? 600) * 1000;
          // the cap is applied BEFORE claiming, exactly as the SQL does
          for (const r of rows) {
            if (r.attempts >= max && (r.status === "queued" || (r.status === "sending" && r.lease_until < clock.t))) {
              r.status = "failed";
              r.claim_token = null;
              r.last_error = r.last_error ?? `abandoned after ${r.attempts} attempt(s): the worker never settled its claim`;
            }
          }
          const due = rows.filter((r) => (r.status === "queued" || (r.status === "sending" && r.lease_until < clock.t)) && r.attempts < max).slice(0, Number(args.p_limit ?? 10));
          for (const r of due) { r.status = "sending"; r.attempts += 1; r.claim_token = `tok-${r.id}-${r.attempts}`; r.lease_until = clock.t + ttl; }
          return { data: due.map((r) => ({ ...r })), error: null };
        }
        if (name === "fn_dq_outbox_settle") {
          const r = rows.find((x) => x.id === Number(args.p_id));
          if (!r || r.claim_token !== args.p_token) return { data: false, error: null };   // the lease was lost
          const max = Number(args.p_max_attempts ?? OUTBOX_MAX_ATTEMPTS);
          r.status = args.p_ok ? "sent" : (r.attempts >= max ? "failed" : "queued");
          r.claim_token = null;
          r.last_error = (args.p_error as string | null) ?? null;
          return { data: true, error: null };
        }
        return { data: null, error: null };
      },
    } as unknown as SupabaseClient;
    return { sb, calls, rows, clock };
  }

  const mkRow = (over: Partial<OutRow> = {}): OutRow => ({
    id: 1, idem_key: "run_finished/run-1", kind: "run_finished", payload: { run_id: "run-1" },
    status: "queued", attempts: 0, claim_token: null, lease_until: 0, last_error: null, ...over,
  });

  {
    // the lease expires while worker A is sending; worker B claims and sends
    // too. A's settle must be refused, and A must not report it as sent.
    const row = mkRow();
    const f = outboxFake([row]);
    const sentBy: string[] = [];
    const a = deliverOutbox(f.sb, { ttlSeconds: 1, send: async () => {
      sentBy.push("A");
      f.clock.t += 5_000;                       // A's lease expires mid-send
      const b = await deliverOutbox(f.sb, { ttlSeconds: 600, send: async () => { sentBy.push("B"); } });
      ok(b.sent === 1, "worker B claims the expired lease and sends");
    } });
    const ra = await a;
    ok(sentBy.join(",") === "A,B", `the message really did go out twice (${sentBy.join(",")}) — at-least-once, stated plainly`);
    ok(ra.sent === 0 && ra.lost === 1, `worker A reports it as lost, never as sent (${JSON.stringify(ra)})`);
    ok(row.status === "sent" && row.attempts === 2, "the row is settled once, by the worker that still held the lease");
  }
  {
    // a stale settle from a worker whose claim was superseded changes nothing
    const row = mkRow({ status: "sending", attempts: 1, claim_token: "tok-1-1", lease_until: 0 });
    const f = outboxFake([row]);
    const r = await deliverOutbox(f.sb, { send: async () => undefined });
    ok(r.sent === 1 && row.claim_token === null, "the new claimant settles cleanly");
    const stale = await f.sb.rpc("fn_dq_outbox_settle", { p_id: 1, p_token: "tok-1-1", p_ok: true, p_error: null, p_recipients: [], p_max_attempts: 8 });
    ok(stale.data === false, "…and the superseded worker's settle is refused by the database");
    ok(row.status === "sent", "…leaving the row exactly as the real claimant left it");
  }
  {
    // a worker that never comes back: the attempt is spent at claim time, so
    // the budget shrinks — and the cap eventually gives up on the row
    const row = mkRow();
    const f = outboxFake([row]);
    for (let i = 0; i < OUTBOX_MAX_ATTEMPTS + 2; i += 1) {
      await f.sb.rpc("fn_dq_outbox_claim", { p_limit: 10, p_ttl_seconds: 1, p_max_attempts: OUTBOX_MAX_ATTEMPTS });
      f.clock.t += 5_000;                        // the worker dies; the lease expires
    }
    ok(row.attempts <= OUTBOX_MAX_ATTEMPTS, `a crashing worker cannot exceed the cap (${row.attempts} attempts)`);
    ok(row.status === "failed", "…and the row is given up rather than retried for ever");
    ok(/abandoned after/.test(row.last_error ?? ""), `…with a reason an administrator can read ("${row.last_error}")`);
  }
  {
    // the cap is honoured by the worker too, not only by the claim
    const row = mkRow({ attempts: OUTBOX_MAX_ATTEMPTS - 1 });
    const f = outboxFake([row]);
    const r = await deliverOutbox(f.sb, { send: async () => { throw new Error("550 mailbox unavailable"); } });
    ok(r.failed === 1 && row.status === "failed", "the last attempt's failure marks the row failed, not queued");
  }

  console.log("M · the duplicate is collapsible");
  {
    const a = mailMessageId("run_finished/run-1");
    const b = mailMessageId("run_finished/run-1");
    ok(a === b && /^<[^<>@\s]+@[^<>@\s]+>$/.test(a), `the same row yields the same RFC-shaped Message-ID both times (${a})`);
    ok(mailMessageId("run_finished/run-2") !== a, "a different row yields a different one");
    ok(!/[<>\s]/.test(a.slice(1, -1)), "the id contains nothing that would break the header");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

void main();

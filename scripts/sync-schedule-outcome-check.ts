/**
 * Data Sync hardening · scheduled-run outcomes and strict job finalisation
 * (workstreams F and G, no network; 21 Sep 2026). Run:
 *   npx tsx scripts/sync-schedule-outcome-check.ts
 *
 * The database side is proved by schedule_retry_alerts_smoke.sql. What is
 * proved here is the decision the ROUTE makes before it calls the database:
 * which of the five outcomes a run actually had, and whether a job_runs row
 * really settled.
 *
 *   F  success / empty / skipped_lease / failed / forced, from the settle a
 *      RunSettler produces — including the case the old cron could not see,
 *      a run refused because another lease was active
 *   G  finishJobRunStrict distinguishes persisted from lost: a resolved
 *      `{ error }`, a thrown error and a lost connection all report
 *      persisted: false after their retries, and a route can then be honest
 */
import { classifyRunOutcome, outcomeAdvancesSchedule, nextRunAt, isDue, specFromRow, DEFAULT_SCHEDULE } from "@/lib/sync/email/schedule";
import { finishJobRunStrict, withJobRunStrict } from "@/lib/jobs/runs";
import { RunSettler } from "@/lib/sync/email/finalize";
import type { SupabaseClient } from "@supabase/supabase-js";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };

/** A job_runs table that answers however the test wants. */
function fakeJobs(answers: ({ error?: { message: string } | null } | "throw")[]) {
  let i = 0;
  const attempts: unknown[] = [];
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    insert: () => q, select: () => q,
    single: async () => ({ data: { id: 42 }, error: null }),
    update: (patch: unknown) => { attempts.push(patch); return q; },
    eq: async () => {
      const a = answers[Math.min(i, answers.length - 1)]; i += 1;
      if (a === "throw") throw new Error("socket hang up");
      return { data: null, error: a.error ?? null };
    },
  });
  const sb = { from: () => q } as unknown as SupabaseClient;
  return { sb, attempts: () => attempts, calls: () => i };
}

async function main() {
  console.log("what a scheduled wake-up actually did");
  {
    const done = { ok: true, rows: 7, meta: { batch_id: "b1", new: 5, updated: 2 } };
    const empty = { ok: true, rows: 0, meta: { empty: true, message: "nothing new" } };
    const skipped = { ok: true, rows: 0, meta: { skipped: true, message: "Another inbox sync (cron) is still running" } };
    const failed = { ok: false, rows: null, error: "IMAP connect ECONNREFUSED" };

    ok(classifyRunOutcome(done, { due: true }) === "success", "rows staged is a success");
    ok(classifyRunOutcome(empty, { due: true }) === "empty", "an empty inbox is a complete run");
    ok(classifyRunOutcome(skipped, { due: true }) === "skipped_lease", "a lease refusal is its own outcome");
    ok(classifyRunOutcome(failed, { due: true }) === "failed", "an error is a failure");
    ok(classifyRunOutcome(null) === "failed", "no settle at all is a failure");
    ok(classifyRunOutcome({ ok: true, rows: 0, meta: null }, { due: true }) === "empty", "a clean run with no rows counts as empty");

    // a forced call that was not due does not own the slot
    ok(classifyRunOutcome(done, { forced: true, due: false }) === "forced", "a forced run that was not due is 'forced'");
    ok(classifyRunOutcome(done, { forced: true, due: true }) === "success", "a forced run that WAS due is judged on its result");
    // a lease refusal stays a lease refusal even when forced
    ok(classifyRunOutcome(skipped, { forced: true, due: false }) === "skipped_lease", "a forced run refused by the lease is still a lease refusal");
    // a failure while forced is still a failure, not a silent 'forced'
    ok(classifyRunOutcome(failed, { forced: true, due: false }) === "failed", "a forced run that failed is still a failure");

    ok(outcomeAdvancesSchedule("success") && outcomeAdvancesSchedule("empty"), "success and empty advance the cadence");
    ok(!outcomeAdvancesSchedule("failed") && !outcomeAdvancesSchedule("skipped_lease") && !outcomeAdvancesSchedule("forced"),
      "a failure, a lease refusal and a forced call do not");
  }

  console.log("the classifier reads a real RunSettler, not a hand-made object");
  {
    const s1 = new RunSettler();
    s1.note({ type: "skipped", message: "Another inbox sync (cron) is still running — its lease expires at 03:20 UTC." });
    ok(classifyRunOutcome(s1.outcome, { due: true }) === "skipped_lease", "the settler's skipped event maps to skipped_lease");
    const s2 = new RunSettler();
    s2.note({ type: "done", batchId: "b9", totals: { new: 3, updated: 1, unchanged: 0, invalid: 0, errors: 0 } });
    ok(classifyRunOutcome(s2.outcome, { due: true }) === "success", "the settler's done event maps to success");
    const s3 = new RunSettler();
    s3.note({ type: "empty", message: "no new circulars" });
    ok(classifyRunOutcome(s3.outcome, { due: true }) === "empty", "the settler's empty event maps to empty");
    const s4 = new RunSettler();
    s4.note({ type: "error", error: "IMAP timeout" });
    ok(classifyRunOutcome(s4.outcome, { due: true }) === "failed", "the settler's error event maps to failed");
    // the FIRST settling event wins, so a late error cannot rewrite a success
    const s5 = new RunSettler();
    s5.note({ type: "done", batchId: "b1", totals: { new: 1, updated: 0, unchanged: 0, invalid: 0, errors: 0 } });
    s5.note({ type: "error", error: "teardown blew up" });
    ok(classifyRunOutcome(s5.outcome, { due: true }) === "success", "the first settling event decides");
  }

  console.log("the cadence anchor survives a run of failures");
  {
    // every 3 days at 02:00; the anchor is the last SUCCESSFUL run
    const spec = { ...DEFAULT_SCHEDULE, enabled: true, kind: "every_n_days" as const, hourUtc: 2, intervalDays: 3 };
    const anchor = new Date("2026-09-01T02:00:00Z");
    // 02:00 on the 1st succeeded; the 2nd's run failed and is retrying at 03:30
    const now = new Date("2026-09-02T03:30:00Z");
    const anchored = nextRunAt(spec, now, anchor);
    ok(anchored?.toISOString() === "2026-09-04T02:00:00.000Z",
      "the next normal slot steps from the anchor: 1st + 3 days", anchored?.toISOString());
    // had the retry moved the anchor, the rhythm would have slipped a day
    const drifted = nextRunAt(spec, now, now);
    ok(drifted?.toISOString() === "2026-09-05T02:00:00.000Z",
      "anchoring on the retry instead would slip the rhythm to the 5th", drifted?.toISOString());
    ok(anchored?.toISOString() !== drifted?.toISOString(),
      "…which is exactly why a retry must not move the anchor");
    ok(isDue(new Date("2026-09-04T02:00:00Z"), new Date("2026-09-04T02:00:01Z")), "a slot one second past is due");
    ok(!isDue(new Date("2026-09-04T02:00:00Z"), new Date("2026-09-04T01:59:59Z")), "a slot one second away is not");
    ok(specFromRow(null).enabled === false, "a missing config row is a disabled schedule");
  }

  console.log("strict finalisation reports the truth");
  {
    const first = fakeJobs([{ error: null }]);
    const r1 = await finishJobRunStrict(first.sb, 42, { ok: true, rows: 3 });
    ok(r1.persisted && r1.attempts === 1, "a clean update persists on the first attempt", JSON.stringify(r1));

    // supabase-js RESOLVES with { error } — the old code could not see this
    const resolved = fakeJobs([{ error: { message: "permission denied" } }]);
    const r2 = await finishJobRunStrict(resolved.sb, 42, { ok: true }, { retries: 0, delayMs: 0 });
    ok(!r2.persisted && /permission denied/.test(r2.error ?? ""), "a RESOLVED error is reported, not swallowed", JSON.stringify(r2));

    const thrown = fakeJobs(["throw"]);
    const r3 = await finishJobRunStrict(thrown.sb, 42, { ok: true }, { retries: 0, delayMs: 0 });
    ok(!r3.persisted && /socket hang up/.test(r3.error ?? ""), "a thrown error is reported too", JSON.stringify(r3));

    // a transient failure is retried, and a later success counts
    const flaky = fakeJobs([{ error: { message: "503" } }, { error: null }]);
    const r4 = await finishJobRunStrict(flaky.sb, 42, { ok: true }, { retries: 2, delayMs: 0 });
    ok(r4.persisted && r4.attempts === 2, "a transient failure is retried and then persists", JSON.stringify(r4));

    const always = fakeJobs([{ error: { message: "still down" } }]);
    const r5 = await finishJobRunStrict(always.sb, 42, { ok: true }, { retries: 2, delayMs: 0 });
    ok(!r5.persisted && r5.attempts === 3, "it gives up after its retries and says so", JSON.stringify(r5));
    ok(always.calls() === 3, "…having really tried three times", String(always.calls()));

    const none = await finishJobRunStrict(fakeJobs([{ error: null }]).sb, null, { ok: true });
    ok(!none.persisted && /no job_runs row/.test(none.error ?? ""), "no job row means nothing was persisted");

    // the terminal status carries the run's result
    const patchCheck = fakeJobs([{ error: null }]);
    await finishJobRunStrict(patchCheck.sb, 42, { ok: false, error: "IMAP down", rows: null });
    const patch = patchCheck.attempts()[0] as { status: string; error: string };
    ok(patch.status === "failed" && /IMAP down/.test(patch.error), "a failed run is recorded as failed, with its reason", JSON.stringify(patch));
  }

  console.log("withJobRunStrict hands the route both facts");
  {
    const okJob = fakeJobs([{ error: null }]);
    const a = await withJobRunStrict(okJob.sb, "sync-health", {}, async () => ({ result: "worked", rows: 1 }));
    ok(a.result === "worked" && a.finalization.persisted, "the work result and a confirmed finalisation");

    const lost = fakeJobs([{ error: { message: "gone" } }]);
    const b = await withJobRunStrict(lost.sb, "sync-health", { retries: 0 }, async () => ({ result: "worked", rows: 1 }));
    ok(b.result === "worked" && !b.finalization.persisted,
      "the work still succeeded even though its record did not — and the route is told", JSON.stringify(b.finalization));

    let threw = "";
    const boom = fakeJobs([{ error: null }]);
    try { await withJobRunStrict(boom.sb, "sync-health", { retries: 0 }, async () => { throw new Error("the work failed"); }); }
    catch (e) { threw = (e as Error).message; }
    ok(/the work failed/.test(threw), "a failure inside the work still propagates");
    ok((boom.attempts()[0] as { status: string }).status === "failed", "…after its own finalisation was attempted");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();

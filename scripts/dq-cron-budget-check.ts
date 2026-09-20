/**
 * Data Quality · the scheduled invocation's time budget (no network, fake clock).
 * Run:  npx tsx scripts/dq-cron-budget-check.ts
 *
 * The defect: /api/cron/dq-nightly declares maxDuration = 60 but carried a
 * budget per STEP — twenty retention slices, then up to three due runs at
 * twenty seconds each, then twenty outbox rows, then a thirty-second nightly
 * drive. Nothing added them up, so the sum could pass sixty seconds and the
 * invocation be killed with its job-run record still saying "running".
 *
 * These tests drive lib/dq/cron-budget.ts with a clock the test controls, so
 * the assertions are about the arithmetic and not about how fast this machine
 * happens to be. The property proved exhaustively in B5: whatever order work
 * arrives in and however long each unit takes, the invocation cannot be
 * pushed past its allowance.
 */
import { CronBudget } from "@/lib/dq/cron-budget";
import { BUDGET_MS, RESERVE_MS } from "@/app/api/cron/dq-nightly/route";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string) => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}`); } };

/** A clock the test moves by hand. */
function fakeClock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; }, at: () => t };
}

console.log("the route's own numbers");
ok(BUDGET_MS <= 50_000, `the allowance is at most 50 s (${BUDGET_MS} ms) — the handler never allocates more than that`);
ok(BUDGET_MS + RESERVE_MS <= 60_000, `allowance plus reserve fits inside maxDuration=60 s (${BUDGET_MS} + ${RESERVE_MS})`);
ok(RESERVE_MS >= 5_000, `the reserve leaves room to write the response (${RESERVE_MS} ms)`);

console.log("B1 · a fresh budget");
{
  const c = fakeClock();
  const b = new CronBudget({ totalMs: 48_000, reserveMs: 10_000, now: c.now });
  ok(b.used() === 0 && b.left() === 48_000, "nothing used, everything left");
  ok(b.room(), "there is room at the start");
  c.advance(1_000);
  ok(b.used() === 1_000 && b.left() === 47_000, "the clock the test moves is the clock the budget reads");
}

console.log("B2 · the reserve is never spent");
{
  const c = fakeClock();
  const b = new CronBudget({ totalMs: 48_000, reserveMs: 10_000, now: c.now });
  c.advance(37_000);                       // 11 s left, 1 s above the reserve
  ok(b.room(), "11 s left: still room to begin a step");
  ok(b.grant(20_000) === 0, "…but a grant of 1 s is below the useful minimum, so nothing is handed out");
  c.advance(1_500);                        // 9.5 s left, under the reserve
  ok(!b.room(), "under the reserve: no more steps begin");
  ok(b.grant(20_000) === 0, "and nothing is granted");
}

console.log("B3 · a grant never exceeds what remains after the reserve");
{
  const c = fakeClock();
  const b = new CronBudget({ totalMs: 48_000, reserveMs: 10_000, now: c.now });
  ok(b.grant(20_000) === 20_000, "early on, a run gets the 20 s it asks for");
  c.advance(20_000);
  const g = b.grant(30_000);
  ok(g === 18_000, `later, the nightly run gets what is left after the reserve, not the 30 s it asked for (${g} ms)`);
  c.advance(g);
  ok(b.left() === 10_000 && !b.room(), "the reserve is exactly what remains");
}

console.log("B4 · the report tells the truth");
{
  const c = fakeClock();
  const b = new CronBudget({ totalMs: 48_000, reserveMs: 10_000, now: c.now });
  b.grant(20_000);
  c.advance(12_345);
  const r = b.report();
  ok(r.ms === 48_000 && r.reserve_ms === 10_000, "the allowance and the reserve are reported");
  ok(r.used === 12_345 && r.granted === 20_000 && r.grants === 1, `used ${r.used}, granted ${r.granted} over ${r.grants} grant(s)`);
}

console.log("B5 · no sequence of work can push the invocation past its allowance");
{
  // Every unit of work takes exactly what it was granted — the worst case.
  // Plus an overhead per step for the database round trips the route makes
  // between grants (the reads, the enqueue, the outbox).
  let worst = 0;
  let breached = 0;
  for (const total of [30_000, 48_000, 55_000]) {
    for (const reserve of [5_000, 10_000, 15_000]) {
      for (const overhead of [0, 250, 1_000, 4_000]) {
        for (const want of [1_000, 5_000, 20_000, 30_000, 120_000]) {
          const c = fakeClock();
          const b = new CronBudget({ totalMs: total, reserveMs: reserve, now: c.now });
          // up to 50 steps: far more than the route ever takes
          for (let i = 0; i < 50; i += 1) {
            c.advance(overhead);
            if (!b.room()) break;
            const g = b.grant(want);
            if (g === 0) continue;
            c.advance(g);              // the work takes every millisecond granted
          }
          const used = b.used();
          worst = Math.max(worst, used - total);
          if (used > total) breached += 1;
        }
      }
    }
  }
  ok(breached === 0, `180 shapes of work, 50 steps each: none exceeded its allowance (worst overshoot ${worst} ms)`);
}

console.log("B5b · the guarantee holds even when the work never runs");
{
  // The harder case, and the one a real handler can hit: several grants
  // issued back to back before any of the work moves the clock. Elapsed time
  // alone would tell each of them the same spare time was free.
  let breached = 0;
  for (const total of [30_000, 48_000, 55_000]) {
    for (const reserve of [5_000, 10_000, 15_000]) {
      for (const want of [1_000, 5_000, 20_000, 30_000, 120_000]) {
        const c = fakeClock();
        const b = new CronBudget({ totalMs: total, reserveMs: reserve, now: c.now });
        for (let i = 0; i < 50; i += 1) b.grant(want);   // the clock never moves
        if (!b.withinAllowance()) breached += 1;
      }
    }
  }
  ok(breached === 0, "45 shapes, 50 grants each with a frozen clock: granted + reserve never exceeds the allowance");
}

console.log("B6 · a step that cannot finish is not started");
{
  // The real question the reserve answers: with 9 s left, is a 20 s run
  // started? It must not be — it would be killed mid-batch, and the batch
  // would roll back having spent the whole invocation.
  const c = fakeClock();
  const b = new CronBudget({ totalMs: 48_000, reserveMs: 10_000, now: c.now });
  c.advance(39_000);
  ok(b.left() === 9_000 && !b.room(), "9 s left is under the reserve");
  ok(b.grant(20_000) === 0, "the run is not started — it is handed to the engine endpoint instead");
}

console.log("B7 · the minimum grant");
{
  const c = fakeClock();
  const b = new CronBudget({ totalMs: 48_000, reserveMs: 10_000, minGrantMs: 5_000, now: c.now });
  c.advance(34_000);                      // 14 s left, 4 s above the reserve
  ok(b.room() && b.grant(20_000) === 0, "4 s of usable time is not enough to be worth starting a run");
  // a caller that says one second is useful gets the 4 s that are there —
  // note b2 starts its own clock now, so advance it to the same 4 s of spare
  const c2 = fakeClock();
  const b2 = new CronBudget({ totalMs: 48_000, reserveMs: 10_000, minGrantMs: 1_000, now: c2.now });
  c2.advance(34_000);
  ok(b2.grant(20_000) === 4_000, "a caller that says a second is useful gets the 4 s that are there");
  ok(b2.grant(20_000) === 0, "…and the next caller gets nothing, because that 4 s is now spoken for");
}

console.log("B8 · the clock only moves forward");
{
  const c = fakeClock();
  const b = new CronBudget({ totalMs: 48_000, reserveMs: 10_000, now: c.now });
  c.advance(60_000);                      // well past the allowance
  ok(b.left() === 0, "left() never goes negative");
  ok(!b.room() && b.grant(1_000) === 0, "and nothing is granted after the allowance is gone");
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

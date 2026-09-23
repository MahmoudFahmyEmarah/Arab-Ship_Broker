// One clock for a scheduled invocation (21 Sep 2026).
//
// A Vercel function has a hard ceiling (maxDuration). The data-quality cron
// used to carry a budget per STEP — twenty retention slices, then three due
// runs at twenty seconds each, then twenty outbox rows, then a thirty-second
// nightly drive — and nothing added them up. The sum could pass sixty
// seconds, and a cron killed mid-step is the worst outcome available: the
// response is never written, so the job-run record stays "running" and
// nothing says what was finished.
//
// This is the arithmetic, alone, so it can be tested against a clock that
// does what the test says rather than what the machine happens to do.
//
//   total    the whole invocation's allowance, below maxDuration
//   reserve  never begin a step with less than this left. A step that cannot
//            finish is worse than a step not started: it burns the budget AND
//            leaves the work undone.
//   grant    the time to hand one unit of work — never more than remains
//            after the reserve, and never more than the unit deserves
//
// The property that matters, and that the tests prove exhaustively: whatever
// order the steps come in and however long each one takes, the sum of what is
// granted can never push the invocation past `total`.

export interface CronBudgetOptions {
  /** the whole allowance in ms (default 48 000, under a 60 s maxDuration) */
  totalMs?: number;
  /** never start a step with less than this left (default 10 000) */
  reserveMs?: number;
  /** the clock; injected so a test can move time on its own terms */
  now?: () => number;
  /** the least useful grant: below this, hand out nothing (default 5 000) */
  minGrantMs?: number;
}

export class CronBudget {
  readonly totalMs: number;
  readonly reserveMs: number;
  readonly minGrantMs: number;
  private readonly now: () => number;
  private readonly t0: number;
  /** what has been handed out, for the response and for the tests */
  private grantedMs = 0;
  private grants = 0;
  /**
   * How far into the allowance the budget considers itself, counting time
   * already PROMISED as well as time already spent.
   *
   * Elapsed time alone is not enough. Two grants issued before the work runs
   * would each be told the same spare time was available, and their sum could
   * pass the allowance — the very arithmetic this class exists to prevent. A
   * grant therefore moves this forward immediately, and real time overtakes
   * it whenever the work runs longer than it was given.
   */
  private committedMs = 0;

  constructor(opts: CronBudgetOptions = {}) {
    this.totalMs = opts.totalMs ?? 48_000;
    this.reserveMs = opts.reserveMs ?? 10_000;
    this.minGrantMs = opts.minGrantMs ?? 5_000;
    this.now = opts.now ?? Date.now;
    this.t0 = this.now();
  }

  /** Milliseconds gone. */
  used(): number {
    return this.now() - this.t0;
  }

  /** Milliseconds left of the allowance (never below zero). */
  left(): number {
    return Math.max(0, this.totalMs - this.used());
  }

  /** True while there is room to begin another step. */
  room(): boolean {
    return this.left() > this.reserveMs;
  }

  /**
   * The time to give one unit of work: what it wants, or what is left after
   * the reserve, whichever is smaller. Zero means "do not start this" — and
   * zero is returned rather than a too-small number, so a caller that forgets
   * to check `room()` still cannot start work it has no time for.
   */
  grant(preferredMs: number): number {
    const committed = Math.max(this.used(), this.committedMs);
    const spare = this.totalMs - committed - this.reserveMs;
    if (spare < this.minGrantMs) return 0;
    const ms = Math.min(Math.max(0, preferredMs), spare);
    if (ms < this.minGrantMs) return 0;
    this.committedMs = committed + ms;
    this.grantedMs += ms;
    this.grants += 1;
    return ms;
  }

  /** What the response reports: enough to see why work was deferred. */
  report(): { ms: number; reserve_ms: number; used: number; granted: number; grants: number } {
    return { ms: this.totalMs, reserve_ms: this.reserveMs, used: this.used(), granted: this.grantedMs, grants: this.grants };
  }

  /**
   * The invariant, for the tests: everything handed out, plus the reserve,
   * always fits inside the allowance — whether or not the work ever ran.
   */
  withinAllowance(): boolean {
    return this.grantedMs + this.reserveMs <= this.totalMs;
  }
}

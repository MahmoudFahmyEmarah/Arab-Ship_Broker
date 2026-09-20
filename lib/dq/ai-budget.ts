// AI budget helpers for the engine (workstream F, 19 Sep 2026). Pure.

/** Tokens to reserve before a review call: prompt overhead + a per-row and per-rule allowance. */
export function estimateAiTokens(rows: number, rules: number): number {
  return 2_500 + rows * 350 + rules * 60;
}

/** Retry once on a transient provider failure; never on a refusal the provider meant. */
export function isTransientAiError(message: string): boolean {
  return /timed out|timeout|ECONNRESET|ETIMEDOUT|429|rate limit|overloaded|502|503|504|temporarily/i.test(message);
}

/** Wrap a provider call with a deadline. */
export function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_r, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${Math.round(ms / 1000)} s`)), ms)),
  ]);
}

/** Throw when a Supabase write answered with an error, naming the write. */
export function must<T extends { error: { message: string } | null }>(res: T, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res;
}

/** The idempotency key of a batch's AI reservation: one reservation per batch, however often the batch is re-kicked. */
export function aiIdemKey(batchId: string): string { return `ai/${batchId}`; }

// Two different failures used to be classified as one (21 Sep 2026). Both
// arrive as "canceling statement …", but they call for opposite remedies:
//
//   57014  query_canceled — the statement ran past statement_timeout. The
//          batch is too large for the time allowed: shrink it.
//   55P03  lock_not_available — another transaction holds the row locks and
//          lock_timeout fired. The batch size is irrelevant; shrinking it
//          lowers throughput for the rest of the run and does not help. Wait
//          a jittered moment and try the same range again.

/** Another transaction held the locks (lock_timeout / NOWAIT) — retry the same range, do not shrink it. */
export function isLockContention(message: string | null | undefined, code?: string | null): boolean {
  if (code === "55P03") return true;
  return /lock timeout|could not obtain lock|lock_not_available|55P03/i.test(message ?? "");
}

/** A batch RPC the database cancelled for time (statement_timeout) — shrink the batch, do not fail the run. */
export function isStatementTimeout(message: string | null | undefined, code?: string | null): boolean {
  // contention first: it also reads as "canceling statement …" but needs the
  // other remedy, so the classifiers must never both claim one error
  if (isLockContention(message, code)) return false;
  if (code === "57014") return true;
  return /statement timeout|canceling statement|57014/i.test(message ?? "");
}

/** Attempts at one contended range before the engine hands the range back to the caller. */
export const LOCK_RETRY_MAX = 3;

/**
 * How long to wait before retrying a contended range: bounded exponential
 * back-off with +/-40 % jitter, so two workers that collided do not line up
 * and collide again. Attempt 1 waits ~0.2 s, attempt 3 at most ~1.1 s — the
 * whole ladder fits inside a single cron invocation's budget.
 */
export function lockRetryDelayMs(attempt: number, rnd: () => number = Math.random): number {
  const n = Math.max(0, Math.floor(Number.isFinite(attempt) ? attempt : 0) - 1);
  const base = Math.min(200 * 2 ** Math.min(n, 10), 1_600);
  // a random source that returns something other than a number in [0, 1) is
  // treated as the middle of the range: a back-off must always be a real,
  // positive wait, or the retry becomes a spin
  const r = rnd();
  const jitter = Number.isFinite(r) ? Math.min(1, Math.max(0, r)) : 0.5;
  return Math.round(base * (0.6 + 0.8 * jitter));
}

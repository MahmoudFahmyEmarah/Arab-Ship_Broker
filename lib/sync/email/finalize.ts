// One terminal outcome per email-sync run (P1-2, 20 Sep 2026).
//
// The SSE route and the cron route used to write the job_runs status from
// inside the emit callback ("fire and forget") and again from a finally
// block, so a run could end with two writes racing, or — when the client
// disconnected mid-stream — with none awaited at all. RunSettler keeps the
// FIRST settling event (done / empty / skipped / error) and writes the job's
// terminal status exactly once, awaited, when the route finalises.
import type { SupabaseClient } from "@supabase/supabase-js";
import { finishJobRun, finishJobRunStrict, type StrictFinalization } from "@/lib/jobs/runs";
import { settleFor, type SyncEvent } from "./types";

export type RunSettle = NonNullable<ReturnType<typeof settleFor>>;

/** What a run that produced no done / empty / skipped / error event is recorded as. */
export const NO_RESULT: RunSettle = { ok: false, rows: null, error: "sync ended without a result" };

export class RunSettler {
  private first: RunSettle | null = null;
  private finished: Promise<RunSettle> | null = null;
  /** The run's log lines, for the job's meta. */
  readonly log: string[] = [];

  /** Observe an event. Returns its settle (if it is one); never writes. */
  note(e: SyncEvent): RunSettle | null {
    if (e.type === "log") this.log.push(e.msg);
    const s = settleFor(e);
    if (s && !this.first) this.first = s;
    return s;
  }

  /** The first settling outcome seen so far, or null. */
  get outcome(): RunSettle | null { return this.first; }

  /**
   * Whether the terminal status was CONFIRMED in the database. Only set by
   * finishStrict(); null after the best-effort finish(), because that path
   * deliberately does not know.
   */
  finalization: StrictFinalization | null = null;

  /**
   * Write the terminal job_runs status exactly once and return the outcome
   * used. Later calls return the same promise, so two finalisation paths
   * (the run's own end and a stream teardown) cannot both write.
   *
   * Best effort: use this where the caller must respond regardless (the SSE
   * route, whose client may already be gone).
   */
  finish(sb: SupabaseClient, runId: number | null, extraMeta?: Record<string, unknown>): Promise<RunSettle> {
    if (!this.finished) {
      const s = this.first ?? NO_RESULT;
      const meta = { ...(s.meta ?? {}), ...(extraMeta ?? {}), log: this.log.slice(-40) };
      this.finished = finishJobRun(sb, runId, { ...s, meta }).then(() => s);
    }
    return this.finished;
  }

  /**
   * As finish(), but the write is verified and retried, and the result is
   * recorded on `finalization` so a scheduled route can report the truth:
   * the sync itself may have succeeded while its job_runs row did not settle
   * (workstream G). Still exactly once, and still never throws.
   */
  finishStrict(sb: SupabaseClient, runId: number | null, extraMeta?: Record<string, unknown>): Promise<RunSettle> {
    if (!this.finished) {
      const s = this.first ?? NO_RESULT;
      const meta = { ...(s.meta ?? {}), ...(extraMeta ?? {}), log: this.log.slice(-40) };
      this.finished = finishJobRunStrict(sb, runId, { ...s, meta }, { retries: 2 }).then((f) => { this.finalization = f; return s; });
    }
    return this.finished;
  }
}

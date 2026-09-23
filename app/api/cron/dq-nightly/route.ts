// Data-quality scheduler (Vercel cron, hourly — see vercel.json). Every hour:
//   1. retention, one bounded slice per call until the database says no more
//   2. wizard-scheduled runs whose time has come are driven
//   3. stalled runs are re-kicked
//   4. the notification outbox is drained (retries with back-off included)
//   5. the weekly digest is ENQUEUED for its slot (Monday 07:00 UTC) — the
//      outbox's idempotency key is the marker, so it is queued once and
//      marked sent only after SMTP accepted it
//   6. the nightly whole-database run is created for the current SLOT
//      (nightly_time in Settings, UTC): the most recent HH:MM at or before
//      now. dq_runs.schedule_key is unique per slot, so a second invocation
//      in the same hour, a retried cron or two overlapping regions cannot
//      create a second run; a slot the cron missed is created by the next
//      invocation (one catch-up, never a backfill of older nights).
//
// ONE DEADLINE GOVERNS ALL OF IT (21 Sep 2026). The steps above used to carry
// separate budgets that could sum past the platform's 60-second limit: twenty
// retention slices, then three due runs at twenty seconds each, then twenty
// outbox rows, then a thirty-second nightly drive. A cron killed mid-step is
// the worst outcome available — the response is never written, so the job-run
// record stays "running" and nothing says what was finished. So:
//
//   · one clock starts with the request and every step reads the same
//     remaining time (`left()`)
//   · no step BEGINS with less than RESERVE_MS left, and a drive is given
//     only the time actually available, never a fixed 20 or 30 seconds
//   · at most ONE run is driven here; every other due or stalled run is
//     handed to the engine endpoint, which has its own invocation and its
//     own budget
//   · whatever is deferred is named in the response, so a backlog is visible
//     rather than silent
//
//   GET /api/cron/dq-nightly   Authorization: Bearer <CRON_SECRET> (Vercel sends it on its own cron calls)
import { NextRequest, NextResponse, after } from "next/server";
import { dqDb, driveRun, engineSecretOk, getSettings, isStalled, kickEngine } from "@/lib/dq/engine";
import { cronTrigger } from "@/lib/cron/auth";
import { engineOrigin } from "@/lib/dq/origin";
import { digestSlot, nightlySlot, SLOT_GRACE_MS } from "@/lib/dq/schedule";
import { deliverOutbox } from "@/lib/dq/notify";
import { withJobRun } from "@/lib/jobs/runs";
import { CronBudget } from "@/lib/dq/cron-budget";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RETENTION_MAX_SLICES = 20;
/** The synchronous work must be finished by here, leaving the rest of maxDuration for the response and the deferred kicks. */
export const BUDGET_MS = 48_000;
/** No step begins with less than this left: a step that cannot finish is worse than a step not started. */
export const RESERVE_MS = 10_000;
/** Runs handed to the engine endpoint in one invocation (each becomes its own invocation). */
const MAX_KICKS = 6;
/** What one run would like, if the clock allows it. */
const DRIVE_PREFERRED_MS = 20_000;

export async function GET(req: NextRequest) {
  // one clock, one allowance, every step measured against it
  const budget = new CronBudget({ totalMs: BUDGET_MS, reserveMs: RESERVE_MS });
  const room = () => budget.room();

  const isVercelCron = cronTrigger(req.headers) === "cron"; // label only
  if (!engineSecretOk(req.headers.get("authorization"))) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const sb = dqDb();
  // configured origin only (workstream A) — a request host never receives the secret
  let base: string;
  try { base = engineOrigin(); } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "engine origin not configured" }, { status: 500 });
  }

  const summary = await withJobRun(sb, "dq-nightly", { trigger: isVercelCron ? "cron" : "manual" }, async () => {
    const now = new Date();
    const settings = await getSettings(sb);
    const deferred: string[] = [];
    let kicks = 0;
    /** Hand a run to the engine endpoint: its own invocation, its own budget. */
    const handOff = (runId: string, why: string) => {
      if (kicks >= MAX_KICKS) { deferred.push(`${why} ${runId} (left for the next hour: kick limit)`); return; }
      kicks += 1;
      deferred.push(`${why} ${runId}`);
      after(() => kickEngine(runId, base));
    };
    const out: {
      created: string | null; slot: string | null; catch_up?: boolean; resumed: string[]; queuedPorts?: number; retention?: { slices: number; more: boolean };
      notifications?: { claimed: number; sent: number; skipped: number; retried: number; failed: number; lost: number }; digest?: string; skipped?: string;
      budget: { ms: number; reserve_ms: number; used: number; granted: number; grants: number; deferred: string[] };
    } = { created: null, slot: null, resumed: [], budget: { ...budget.report(), deferred } };

    // Port identity (10 Sep 2026): queue any port text nobody has placed yet,
    // so Manual Review → Ports shows tonight's arrivals even when the audit
    // run itself is switched off.
    const { data: swept } = await sb.rpc("fn_port_review_sweep");
    if (swept != null) out.queuedPorts = Number(swept);

    // Retention (audit P7; workstream F): one slice per call, each its own
    // short transaction; stop when the database reports nothing more — or
    // when the clock says the next slice might not finish.
    let slices = 0; let more = false;
    for (; slices < RETENTION_MAX_SLICES; slices += 1) {
      if (!room()) { more = true; deferred.push(`retention after ${slices} slice(s)`); break; }
      const { data, error } = await sb.rpc("fn_dq_retention");
      if (error) break;
      more = !!(data as { more?: boolean } | null)?.more;
      if (!more) { slices += 1; break; }
    }
    out.retention = { slices, more };

    // A run the wizard scheduled ("Schedule nightly") sits queued with a
    // scheduled_for; nothing drove it before (audit C10). ONE is driven here,
    // with the time this invocation actually has; the others go to the engine
    // endpoint rather than being tried in a budget that cannot hold them.
    const { data: due } = await sb.from("dq_runs").select("id").eq("status", "queued").eq("trigger", "scheduler").is("schedule_key", null).lte("scheduled_for", now.toISOString()).order("scheduled_for").limit(MAX_KICKS + 1);
    const dueIds = ((due ?? []) as { id: string }[]).map((r) => r.id);
    if (dueIds.length) {
      const [first, ...rest] = dueIds;
      const grant = budget.grant(DRIVE_PREFERRED_MS);
      if (grant > 0) {
        const d = await driveRun(first, grant);
        out.resumed.push(first);
        if (!d.done) handOff(first, "unfinished scheduled run");
      } else {
        handOff(first, "scheduled run (no time left in this invocation)");
      }
      for (const id of rest) handOff(id, "scheduled run");
    }

    // stalled runs: no batch reported for STALL_MS (the engine chain broke).
    // Cheap here — each is a kick, not a drive.
    const { data: running } = await sb.from("dq_runs").select("id, status, last_batch_at, started_at, created_at").eq("status", "running");
    for (const r of (running ?? []) as { id: string; status: "running"; last_batch_at: string | null; started_at: string | null; created_at: string }[]) {
      if (!isStalled(r, now.getTime())) continue;
      out.resumed.push(r.id);
      handOff(r.id, "stalled run");
    }

    // the weekly digest: enqueue for its slot; the outbox key makes it once
    const digest = digestSlot(now);
    if (digest && settings.notify?.digest) {
      const { data: queued } = await sb.rpc("fn_dq_outbox_enqueue", { p_kind: "digest", p_idem_key: digest.key, p_payload: { due: digest.due.toISOString() } });
      out.digest = queued ? `${digest.key} queued` : `${digest.key} already queued`;
    }

    // notifications: whatever is due, retries included — bounded by the rows
    // the remaining time can plausibly carry, since each is an SMTP round trip
    if (room()) {
      const limit = budget.left() > 25_000 ? 20 : 5;
      try { out.notifications = await deliverOutbox(sb, { limit }); } catch (e) { out.notifications = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, lost: 0 }; out.skipped = `outbox: ${e instanceof Error ? e.message : String(e)}`; }
    } else {
      deferred.push("notification outbox (the hourly cron retries; an engine invocation also drains it)");
    }

    if (dueIds.length) { out.skipped = "drove the wizard-scheduled run(s) instead of creating the nightly one"; Object.assign(out.budget, budget.report()); return { result: out, rows: dueIds.length }; }
    if (!settings.nightly_enabled) { out.skipped = "nightly schedule disabled in Settings"; Object.assign(out.budget, budget.report()); return { result: out, rows: 0 }; }

    const slot = nightlySlot(settings.nightly_time, now);
    if (!slot) { out.skipped = `nightly_time "${settings.nightly_time}" is not HH:MM`; Object.assign(out.budget, budget.report()); return { result: out, rows: 0 }; }
    out.slot = slot.key;
    const { data: existing } = await sb.from("dq_runs").select("id, status").eq("schedule_key", slot.key).maybeSingle();
    if (existing) { out.skipped = `slot ${slot.key} already has run ${(existing as { id: string }).id}`; Object.assign(out.budget, budget.report()); return { result: out, rows: 0 }; }
    out.catch_up = now.getTime() - slot.due.getTime() > SLOT_GRACE_MS;

    // The slot's run is CREATED even when the clock has run out — the insert
    // is one statement, and the unique schedule_key is what stops a duplicate
    // being made later. Only the driving is conditional.
    const { data: run, error } = await sb.from("dq_runs").insert({
      scope: { kind: "db" }, mode: settings.nightly_mode, batch_size: settings.batch_size, trigger: "scheduler", started_by_name: "Scheduler (nightly)",
      notify: settings.notify?.on_complete ?? false, schedule_key: slot.key, scheduled_for: slot.due.toISOString(),
    }).select("id").single();
    if (error) {
      // 23505: another invocation created this slot's run between our check and our insert — that is the point of the key
      if (error.code === "23505") { out.skipped = `slot ${slot.key} was created by a concurrent invocation`; Object.assign(out.budget, budget.report()); return { result: out, rows: 0 }; }
      throw new Error(error.message);
    }
    out.created = (run as { id: string }).id;
    let batches = 0;
    const nightlyGrant = budget.grant(30_000);
    if (nightlyGrant > 0) {
      const first = await driveRun(out.created, nightlyGrant);
      batches = first.batches;
      if (!first.done) handOff(out.created, "unfinished nightly run");
    } else {
      handOff(out.created, "nightly run (no time left in this invocation)");
    }
    Object.assign(out.budget, budget.report());
    return { result: out, rows: batches };
  });
  return NextResponse.json({ ok: true, ...summary });
}

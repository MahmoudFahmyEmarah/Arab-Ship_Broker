// Data Quality notifications — the outbox worker (workstream G, 19 Sep 2026;
// rewritten 20 Sep). The settings store recipients and four flags; this is
// the delivery, through the platform's SMTP transport (Group Mail settings).
//
// Nothing here decides that a notification is due. The database enqueues a
// row in dq_notification_outbox inside the transaction that settles a run
// (fn_dq_settle_run / fn_dq_finish_run), meters AI usage (fn_dq_settle_ai,
// the 80 % notice) or the cron's digest slot — each with an idempotency key,
// so a run is announced once however many engine invocations see it finish.
// This worker CLAIMS due rows (FOR UPDATE SKIP LOCKED, a lease), renders
// them, sends, and SETTLES: sent only after SMTP accepted the message; a
// failure re-queues with exponential back-off (2^attempts minutes, capped
// at four hours) and gives up after eight attempts (status failed, requeue
// from the console).
//
// DELIVERY IS AT-LEAST-ONCE, deliberately and explicitly (21 Sep 2026).
// The claim token makes the DATABASE row single-owner, but it cannot un-send a
// message SMTP has already accepted: a send that outlives its lease can be
// reclaimed and sent again. Three things make that safe rather than merely
// tolerated — a 600-second lease, longer than any send this module makes; a
// stable Message-ID per outbox row, so a receiving server can collapse a
// duplicate; and a worker that reports `sent` only when the database confirms
// the settle, counting a superseded claim as `lost` instead.
//
//   run finished     on_complete: every completed / failed run the scheduler
//                    or an admin marked "notify"; on_errors: any run that
//                    ended with rule errors or new error issues
//   budget 80 %      once a day, the first time the AI budget crosses 80 %
//   weekly digest    Monday 07:00 UTC: health tiles, open issues, pending
//                    AI suggestions older than three days
// A notification the settings do not want is settled as sent with a
// delivery note ("skipped: …"), so the console can see why nothing went out.
import type { SupabaseClient } from "@supabase/supabase-js";
import { smtpTransport } from "@/lib/billing/mail";
import { withDeadline } from "./ai-budget";
import { engineOrigin } from "./origin";
import { runCoverageLabel } from "./types";
import type { DqNotification, DqRun, DqSettings } from "./types";

export interface Mail {
  to: string[];
  subject: string;
  text: string;
  /**
   * Stable across retries of the same notification, because it is derived
   * from the row's idempotency key. Delivery is AT-LEAST-ONCE: a send that
   * outlives its lease can be reclaimed and sent again, and no database token
   * can un-send a message SMTP has already accepted. A stable Message-ID is
   * what lets the receiving server collapse that duplicate.
   */
  messageId: string;
}

/** The Message-ID for one outbox row: same row, same id, however many attempts. */
export function mailMessageId(idemKey: string, domain = "arabshipbroker.com"): string {
  const slug = idemKey.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100) || "dq";
  return `<dq.${slug}@${domain}>`;
}
/** Sends one mail; throws when the transport refused it (the row is retried). */
export type MailSender = (sb: SupabaseClient, mail: Mail) => Promise<void>;

export const OUTBOX_MAX_ATTEMPTS = 8;

/**
 * How long a claim is held, and how long one send may take.
 *
 * The lease must comfortably outlive the send, or a send still in flight is
 * reclaimed by the next worker and the message goes out twice. Bounding the
 * send is the half that makes the lease meaningful: nodemailer will wait on a
 * silent server far longer than 600 s if nothing stops it, and then no lease
 * is long enough. So the send carries its own deadline at a fifth of the
 * lease, and the gap between them is the margin.
 */
export const OUTBOX_LEASE_SECONDS = 600;
export const OUTBOX_SEND_DEADLINE_MS = 120_000;

export async function smtpSend(sb: SupabaseClient, mail: Mail): Promise<void> {
  const t = await smtpTransport(sb);
  if (!t) throw new Error("SMTP not configured (Group Mail settings)");
  try {
    await t.transport.sendMail({
      from: { name: t.fromName, address: t.user }, to: mail.to, envelope: { from: t.user, to: mail.to },
      subject: mail.subject, text: mail.text,
      // stable across attempts: a duplicate delivery is collapsible rather
      // than a second message in the recipient's inbox
      messageId: mail.messageId,
      headers: { "X-Auto-Response-Suppress": "All", "X-ASB-Notification": mail.messageId },
    });
  } finally {
    t.transport.close();
  }
}

function consoleUrl(path: string): string {
  try { return `${engineOrigin()}${path}`; } catch { return path; }
}

export function runFinishedSubject(run: Pick<DqRun, "code" | "status" | "found">): string {
  const s = run.status === "completed" ? "completed" : run.status === "completed_with_errors" ? "completed with errors" : run.status;
  return `[Data quality] ${run.code} ${s} — ${run.found.error} errors · ${run.found.warn} warnings`;
}

export function runFinishedText(run: DqRun): string {
  const errs = [...(run.rule_errors ?? [])];
  return [
    `Run ${run.code} ${run.status === "completed_with_errors" ? "completed with errors" : run.status}.`,
    `Scope: ${run.scope.kind}${run.scope.tables?.length ? ` (${run.scope.tables.join(", ")})` : ""} · mode ${run.mode}.`,
    `Rows checked: ${run.rows_done.toLocaleString()} of ${run.total_rows.toLocaleString()} · batches ${run.batches_done}.`,
    `Found: ${run.found.error} errors, ${run.found.warn} warnings, ${run.found.info} info.`,
    `Coverage: ${runCoverageLabel(run)}.`,
    errs.length ? `Failed checks: ${errs.map((e) => `${e.rule} on ${e.table}${e.check_idx != null ? ` (check ${e.check_idx + 1})` : ""}${e.stage === "keys" ? " at key preparation" : ""}: ${e.error}`).join("; ")}` : null,
    run.note ? `Notes: ${run.note}` : null,
    run.error ? `Error: ${run.error}` : null,
    "",
    `Open the run: ${consoleUrl(`/admin/data-quality?tab=runs&run=${run.id}`)}`,
  ].filter((l) => l !== null).join("\n");
}

export function budget80Subject(p: { tokens: number; cap: number }): string {
  return `[Data quality] AI budget at ${p.cap > 0 ? Math.round((p.tokens / p.cap) * 100) : 0} %`;
}
export function budget80Text(p: { tokens: number; cap: number }): string {
  return `Today's AI review usage is ${p.tokens.toLocaleString()} of ${p.cap.toLocaleString()} tokens. Runs in AI mode will stop reviewing when the cap is reached; rule results are unaffected.\n\nSettings: ${consoleUrl("/admin/data-quality?tab=settings")}`;
}

/** Monday digest: health, open issues, AI suggestions waiting. */
export async function digestText(sb: SupabaseClient): Promise<string> {
  const [{ data: health }, { data: sev }, { count: stale }] = await Promise.all([
    sb.rpc("fn_dq_health_cached"),
    sb.rpc("fn_dq_open_by_severity", { p_table: null }),
    sb.from("dq_ai_suggestions").select("id", { count: "exact", head: true }).eq("status", "pending").lt("created_at", new Date(Date.now() - 3 * 86_400_000).toISOString()),
  ]);
  const tiles = (health ?? []) as { label: string; score: number; open: number; partial?: boolean }[];
  const s = (sev ?? {}) as { error?: number; warn?: number; info?: number };
  return [
    "Weekly data-quality digest",
    "",
    ...tiles.map((t) => `${t.label}: score ${Number(t.score).toFixed(1)}${t.partial ? " (partial)" : ""} · ${t.open} open`),
    "",
    `Open issues: ${s.error ?? 0} errors · ${s.warn ?? 0} warnings · ${s.info ?? 0} info.`,
    `AI suggestions waiting more than 3 days: ${stale ?? 0}.`,
    "",
    `Console: ${consoleUrl("/admin/data-quality")}`,
  ].join("\n");
}

export type Rendered = { mail: Mail } | { skip: string };

/** The mail for one outbox row, or the reason the settings do not want it. */
export async function renderNotification(sb: SupabaseClient, row: Pick<DqNotification, "kind" | "payload"> & { idem_key?: string }, notify: DqSettings["notify"] | null | undefined): Promise<Rendered> {
  const key = row.idem_key ?? `${row.kind}/${String(row.payload?.run_id ?? row.payload?.day ?? "unknown")}`;
  const recipients = (notify?.recipients ?? []).filter(Boolean);
  if (!recipients.length) return { skip: "skipped: no recipients in Settings → Notifications" };
  if (row.kind === "run_finished") {
    const runId = String(row.payload?.run_id ?? "");
    const { data, error } = await sb.from("dq_runs").select("*").eq("id", runId).maybeSingle();
    if (error) throw new Error(`reading run ${runId}: ${error.message}`);
    const run = data as DqRun | null;
    if (!run) return { skip: "skipped: the run no longer exists" };
    const wantComplete = !!run.notify || !!notify?.on_complete;
    const wantErrors = !!notify?.on_errors && (run.status !== "completed" || (run.found?.error ?? 0) > 0);
    if (!wantComplete && !wantErrors) return { skip: "skipped: neither 'run completed' nor 'new errors' is on for this run" };
    return { mail: { to: recipients, subject: runFinishedSubject(run), text: runFinishedText(run), messageId: mailMessageId(key) } };
  }
  if (row.kind === "budget80") {
    if (!notify?.budget80) return { skip: "skipped: the 80 % budget notice is off" };
    const p = { tokens: Number(row.payload?.tokens ?? 0), cap: Number(row.payload?.cap ?? 0) };
    return { mail: { to: recipients, subject: budget80Subject(p), text: budget80Text(p), messageId: mailMessageId(key) } };
  }
  if (!notify?.digest) return { skip: "skipped: the weekly digest is off" };
  return { mail: { to: recipients, subject: "[Data quality] Weekly digest", text: await digestText(sb), messageId: mailMessageId(key) } };
}

export interface DeliveryReport {
  claimed: number;
  sent: number;
  skipped: number;
  retried: number;
  failed: number;
  /** claims superseded before they could be settled; their rows belong to another worker */
  lost: number;
}

type Claimed = DqNotification & { claim_token: string };

/**
 * Record the outcome of one claim and say whether the DATABASE accepted it.
 * Both the transport error and the function's own boolean are inspected: a
 * false result means this worker's claim was superseded, so the row now
 * belongs to someone else and nothing here may be reported as settled.
 */
async function settle(sb: SupabaseClient, row: Claimed, ok: boolean, note: string | null, recipients: string[] | null, maxAttempts: number): Promise<{ settled: boolean; reason?: string }> {
  const { data, error } = await sb.rpc("fn_dq_outbox_settle", { p_id: row.id, p_token: row.claim_token, p_ok: ok, p_error: note, p_recipients: recipients, p_max_attempts: maxAttempts });
  if (error) return { settled: false, reason: `rpc error: ${error.message}` };
  if (data !== true) return { settled: false, reason: "lost_lease" };
  return { settled: true };
}

async function record(sb: SupabaseClient, row: Claimed, ok: boolean, mail: Mail | null, detail: string): Promise<void> {
  await sb.from("dq_config_events").insert({
    kind: "notification", key: row.idem_key, before: null,
    after: { to: mail?.to ?? [], subject: mail?.subject ?? row.kind, ok, detail, attempt: row.attempts }, actor_name: "Data quality",
  }).then(() => undefined, () => undefined);
}

/**
 * Claim due outbox rows, send them, settle them. Safe to call from any
 * engine invocation, the hourly cron or a console action; bounded by
 * `limit`; never throws for a single row's failure (that row is retried),
 * only when the outbox itself cannot be claimed.
 */
export async function deliverOutbox(sb: SupabaseClient, opts: { limit?: number; ttlSeconds?: number; send?: MailSender; maxAttempts?: number; sendDeadlineMs?: number } = {}): Promise<DeliveryReport> {
  const report: DeliveryReport = { claimed: 0, sent: 0, skipped: 0, retried: 0, failed: 0, lost: 0 };
  const maxAttempts = opts.maxAttempts ?? OUTBOX_MAX_ATTEMPTS;
  // the lease must outlive a slow SMTP conversation, or a send in flight gets
  // reclaimed and sent a second time; the cap travels with the claim so a row
  // whose worker keeps crashing is given up in the database rather than
  // re-claimed for ever
  const { data, error } = await sb.rpc("fn_dq_outbox_claim", {
    p_limit: opts.limit ?? 10,
    p_ttl_seconds: opts.ttlSeconds ?? OUTBOX_LEASE_SECONDS,
    p_max_attempts: maxAttempts,
  });
  if (error) throw new Error(`outbox claim: ${error.message}`);
  const rows = (data ?? []) as Claimed[];
  if (!rows.length) return report;
  report.claimed = rows.length;
  const { data: s } = await sb.from("dq_settings").select("notify").eq("id", 1).maybeSingle();
  const notify = (s as { notify?: DqSettings["notify"] } | null)?.notify ?? null;
  const send = opts.send ?? smtpSend;
  for (const row of rows) {
    let rendered: Rendered;
    try {
      rendered = await renderNotification(sb, row, notify);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const s = await settle(sb, row, false, `render: ${msg}`, null, maxAttempts);
      if (!s.settled) { report.lost += 1; continue; }
      if (row.attempts >= maxAttempts) report.failed += 1; else report.retried += 1;
      continue;
    }
    if ("skip" in rendered) {
      const s = await settle(sb, row, true, rendered.skip, [], maxAttempts);
      if (!s.settled) { report.lost += 1; await record(sb, row, false, null, `not settled (${s.reason}); nothing was sent`); continue; }
      report.skipped += 1;
      continue;
    }
    try {
      // bounded, and bounded well inside the lease: an unbounded send is how a
      // claim outlives its lease and the message is sent twice
      await withDeadline(send(sb, rendered.mail), opts.sendDeadlineMs ?? OUTBOX_SEND_DEADLINE_MS, `sending ${row.idem_key}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const s = await settle(sb, row, false, msg, rendered.mail.to, maxAttempts);
      if (!s.settled) {
        report.lost += 1;
        await record(sb, row, false, rendered.mail, `send failed (${msg}) AND the failure could not be recorded (${s.reason})`);
        continue;
      }
      const gaveUp = row.attempts >= maxAttempts;
      if (gaveUp) report.failed += 1; else report.retried += 1;
      await record(sb, row, false, rendered.mail, gaveUp ? `failed after ${row.attempts} attempts: ${msg}` : `attempt ${row.attempts} failed, will retry: ${msg}`);
      continue;
    }
    const s = await settle(sb, row, true, null, rendered.mail.to, maxAttempts);
    if (!s.settled) {
      // The mail HAS gone out. The row belongs to another worker now, which
      // may send it again — that is the at-least-once contract, and the
      // stable Message-ID is what makes the duplicate collapsible. Never
      // count it as sent here: this worker no longer owns the row.
      report.lost += 1;
      await record(sb, row, true, rendered.mail, `sent, but the row was reclaimed before it could be settled (${s.reason}) — it may be delivered again`);
      continue;
    }
    report.sent += 1;
    await record(sb, row, true, rendered.mail, "sent");
  }
  return report;
}

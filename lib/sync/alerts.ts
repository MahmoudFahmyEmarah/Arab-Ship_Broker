// Data Sync health alerting — the consumer that was missing (workstream I,
// 21 Sep 2026).
//
// sync_health_alerts has said what is wrong since 20 September, and nothing
// read it. A view nobody reads is not monitoring, and a module whose failures
// are only visible to somebody who goes looking is not unattended.
//
// What this does, once per cron tick:
//   1. fn_sync_alert_state folds the view into sync_alert_state — one row per
//      (kind, ref) with how many CONSECUTIVE checks have seen it — and hands
//      back only what should be said now:
//        notify   present for `min_consecutive` checks and not yet reported
//        recover  reported earlier and now gone
//      Calling it again immediately returns nothing, which is what stops the
//      owner being mailed every five minutes about the same stuck lease.
//   2. one mail per tick, listing the new conditions and the recovered ones,
//      through the platform's SMTP transport (Group Mail settings).
//   3. recovered rows older than the keep window are forgotten.
//
// The dedupe state is written by the database BEFORE the mail is attempted, so
// a transport failure cannot loop: the condition is marked notified and the
// next tick will not repeat it. That is the deliberate trade — at most one
// missed alert mail rather than an unbounded mail storm — and the console's
// health panel shows the same state whether or not the mail arrived.
import type { SupabaseClient } from "@supabase/supabase-js";
import { smtpTransport } from "@/lib/billing/mail";

export type AlertAction = "notify" | "recover";

export interface AlertRow {
  action: AlertAction;
  kind: string;
  ref: string;
  detail: string | null;
  consecutive: number;
  since: string | null;
}

export interface AlertConfig { enabled: boolean; recipients: string[]; min_consecutive: number }

/** What each health kind means, in the words the runbook uses. */
export const ALERT_KIND_LABEL: Record<string, string> = {
  stuck_lease: "A sync lease expired and was never released",
  whatsapp_failed: "A WhatsApp message is parked as failed",
  whatsapp_stale: "A WhatsApp message has been pending too long",
  gate_error: "Staged rows the data-quality gate could not evaluate",
  partial_batch: "A batch has been partly committed for over a day",
  unfinished_job: "A background job never reported a terminal status",
  upload_job_stuck: "A queued upload has not been staged",
  upload_job_failed: "An upload job is parked as failed",
  upload_job_retry: "An upload job has been waiting to retry for over an hour",
};

export interface AlertReport {
  enabled: boolean;
  notified: number;
  recovered: number;
  sent: boolean;
  skipped?: string;
  pruned: number;
  error?: string;
  rows: AlertRow[];
}

export function alertSubject(notify: AlertRow[], recover: AlertRow[]): string {
  if (notify.length && recover.length) return `[Data sync] ${notify.length} new alert${notify.length === 1 ? "" : "s"}, ${recover.length} cleared`;
  if (notify.length) return `[Data sync] ${notify.length} alert${notify.length === 1 ? "" : "s"}: ${ALERT_KIND_LABEL[notify[0].kind] ?? notify[0].kind}`;
  return `[Data sync] ${recover.length} alert${recover.length === 1 ? "" : "s"} cleared`;
}

export function alertText(notify: AlertRow[], recover: AlertRow[], origin: string | null): string {
  const line = (r: AlertRow) => `  · ${ALERT_KIND_LABEL[r.kind] ?? r.kind} — ${r.detail ?? r.ref} [${r.kind}/${r.ref}]`;
  const parts: string[] = [];
  if (notify.length) parts.push(`Needs attention (${notify.length}):`, ...notify.map(line), "");
  if (recover.length) parts.push(`Cleared (${recover.length}):`, ...recover.map(line), "");
  parts.push(
    "Each condition is reported once. A recovery line means it is no longer present.",
    origin ? `Data Sync console: ${origin}/admin/data-sync?view=health` : "Data Sync console: /admin/data-sync?view=health",
  );
  return parts.join("\n");
}

export async function readAlertConfig(sb: SupabaseClient): Promise<AlertConfig> {
  const { data } = await sb.from("sync_alert_config").select("enabled, recipients, min_consecutive").eq("id", 1).maybeSingle();
  const c = (data ?? null) as AlertConfig | null;
  return {
    enabled: !!c?.enabled,
    recipients: (c?.recipients ?? []).filter((r) => typeof r === "string" && r.includes("@")),
    min_consecutive: Number(c?.min_consecutive ?? 2),
  };
}

export type AlertSender = (sb: SupabaseClient, mail: { to: string[]; subject: string; text: string }) => Promise<void>;

const smtpSend: AlertSender = async (sb, mail) => {
  const t = await smtpTransport(sb);
  if (!t) throw new Error("SMTP is not configured (Group Mail settings)");
  try {
    await t.transport.sendMail({
      from: { name: t.fromName, address: t.user }, to: mail.to, envelope: { from: t.user, to: mail.to },
      subject: mail.subject, text: mail.text, headers: { "X-Auto-Response-Suppress": "All" },
    });
  } finally {
    t.transport.close();
  }
};

/**
 * One health check. Always folds the state (so the console's panel is current
 * even when alerting is switched off); mails only when it is on, there are
 * recipients, and there is something to say.
 */
export async function runHealthCheck(
  sb: SupabaseClient,
  opts: { send?: AlertSender; origin?: string | null; keepHours?: number } = {},
): Promise<AlertReport> {
  const cfg = await readAlertConfig(sb);
  const { data, error } = await sb.rpc("fn_sync_alert_state", { p_min_consecutive: cfg.min_consecutive });
  if (error) throw new Error(`reading health state: ${error.message}`);
  const rows = (data ?? []) as AlertRow[];
  const notify = rows.filter((r) => r.action === "notify");
  const recover = rows.filter((r) => r.action === "recover");

  const { data: pruned } = await sb.rpc("fn_sync_alert_prune", { p_keep_hours: opts.keepHours ?? 72 });
  const report: AlertReport = {
    enabled: cfg.enabled, notified: notify.length, recovered: recover.length, sent: false,
    pruned: Number(pruned ?? 0), rows,
  };

  if (!notify.length && !recover.length) { report.skipped = "nothing new to report"; return report; }
  if (!cfg.enabled) { report.skipped = "health alerting is switched off in Data Sync → Health"; return report; }
  if (!cfg.recipients.length) { report.skipped = "no recipients configured"; return report; }

  try {
    await (opts.send ?? smtpSend)(sb, {
      to: cfg.recipients,
      subject: alertSubject(notify, recover),
      text: alertText(notify, recover, opts.origin ?? null),
    });
    report.sent = true;
  } catch (e) {
    report.error = e instanceof Error ? e.message : String(e);
  }
  return report;
}

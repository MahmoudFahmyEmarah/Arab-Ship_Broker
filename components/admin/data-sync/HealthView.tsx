"use client";

// Data Sync → Health (workstream I, 21 Sep 2026).
//
// Two things existed with nothing in front of them: sync_health_alerts, which
// said what was wrong, and listUploadJobs, which knew about queued and failed
// workbooks. Neither was on a screen, so an operator could only find a stuck
// upload by asking the database. This panel is that screen, and it is also
// where alerting is switched on — until it is, the module is not unattended.
//
//   · Conditions   every health condition, how many consecutive checks have
//                  seen it, whether it has been reported, and when it cleared
//   · Alerting     on / off, recipients, and how many consecutive failing
//                  checks are required before anyone is mailed
//   · Uploads      a page of upload jobs with state, attempts, next retry,
//                  batch link, concise error and storage retention, plus the
//                  actions that are safe: open the batch, queue a parked job
//                  again, cancel a queued one, remove a finished one
//
// Every action is a real button, so it is in the tab order and takes the
// module's focus ring; a retry is offered only when the database says the
// job's batch may still be rebuilt, and Remove asks first.
import * as React from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, RefreshCw, Trash2, XCircle } from "lucide-react";
import {
  cancelUploadJob, getSyncHealth, listUploadJobs, removeUploadJob, retryUploadJob, saveAlertConfig,
  type SyncHealth, type UploadJobRow,
} from "@/app/(admin)/admin/data-sync/actions";
import { Badge, Btn, Card, SectionLabel, Switch, utcShort, type BadgeTone } from "./ui";

const KIND_LABEL: Record<string, string> = {
  stuck_lease: "Sync lease never released",
  whatsapp_failed: "WhatsApp message failed",
  whatsapp_stale: "WhatsApp message pending too long",
  gate_error: "Gate could not evaluate staged rows",
  partial_batch: "Batch partly committed for over a day",
  unfinished_job: "Background job never finished",
  upload_job_stuck: "Queued upload not staged",
  upload_job_failed: "Upload job parked",
  upload_job_retry: "Upload job waiting to retry",
};

const STATUS_TONE: Record<UploadJobRow["status"], BadgeTone> = {
  queued: "neutral", running: "info", retry_wait: "updated", done: "new", failed: "invalid", cancelled: "neutral",
};
const STATUS_LABEL: Record<UploadJobRow["status"], string> = {
  queued: "queued", running: "running", retry_wait: "retrying", done: "done", failed: "failed", cancelled: "cancelled",
};
const STATE_FILTERS: (UploadJobRow["status"] | "all")[] = ["all", "queued", "running", "retry_wait", "failed", "done", "cancelled"];

const fmt = (iso: string | null | undefined) => (iso ? utcShort(iso) : "—");
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function HealthView({ onOpenBatchId }: { onOpenBatchId?: (id: string) => void }) {
  const [health, setHealth] = React.useState<SyncHealth | null>(null);
  const [jobs, setJobs] = React.useState<{ rows: UploadJobRow[]; total: number; page: number; pageSize: number } | null>(null);
  const [status, setStatus] = React.useState<string>("all");
  const [page, setPage] = React.useState(1);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<{ enabled: boolean; recipients: string; min: number } | null>(null);

  const loadHealth = React.useCallback(async () => {
    const r = await getSyncHealth();
    if (!r.success) { setMsg(r.error); return; }
    setHealth(r.data);
    setDraft({ enabled: r.data.config.enabled, recipients: r.data.config.recipients.join(", "), min: r.data.config.min_consecutive });
  }, []);
  const loadJobs = React.useCallback(async (p: number, st: string) => {
    const r = await listUploadJobs({ page: p, pageSize: 10, status: st === "all" ? null : st });
    if (!r.success) { setMsg(r.error); return; }
    setJobs(r.data);
  }, []);

  React.useEffect(() => { void loadHealth(); }, [loadHealth]);
  React.useEffect(() => { void loadJobs(page, status); }, [loadJobs, page, status]);

  const act = async (id: string, what: "retry" | "cancel" | "remove") => {
    if (what === "remove" && !window.confirm("Remove this upload job and its stored workbook? This cannot be undone.")) return;
    setBusy(id); setMsg(null);
    const r = what === "retry" ? await retryUploadJob(id) : what === "cancel" ? await cancelUploadJob(id) : await removeUploadJob(id);
    setBusy(null);
    if (!r.success) { setMsg(r.error); return; }
    setMsg(what === "retry" ? "Queued again — the next upload pass picks it up." : what === "cancel" ? "Cancelled." : "Removed.");
    await Promise.all([loadJobs(page, status), loadHealth()]);
  };

  const saveAlerts = async () => {
    if (!draft) return;
    setBusy("alerts"); setMsg(null);
    const r = await saveAlertConfig({
      enabled: draft.enabled,
      recipients: draft.recipients.split(",").map((x) => x.trim()).filter(Boolean),
      min_consecutive: draft.min,
    });
    setBusy(null);
    if (!r.success) { setMsg(r.error); return; }
    setMsg("Saved.");
    await loadHealth();
  };

  const open = (health?.alerts ?? []).filter((a) => !a.cleared_at);
  const cleared = (health?.alerts ?? []).filter((a) => !!a.cleared_at);
  const pages = jobs ? Math.max(1, Math.ceil(jobs.total / jobs.pageSize)) : 1;
  const alertingOn = !!health?.config.enabled && (health?.config.recipients.length ?? 0) > 0;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {msg && <div className="ds-note" role="status" aria-live="polite">{msg}</div>}

      {/* ── is this module actually watched? ─────────────────────────────── */}
      <div className="ds-note" role="status">
        {alertingOn ? (
          <>
            <CheckCircle2 size={14} aria-hidden style={{ verticalAlign: "-2px" }} />{" "}
            <strong>Alerting is on.</strong> {health?.config.recipients.length} recipient(s) are mailed once a condition has been
            seen {health?.config.min_consecutive} time(s) in a row, and again when it clears. Last check {fmt(health?.lastCheck.at)}.
          </>
        ) : (
          <>
            <AlertTriangle size={14} aria-hidden style={{ verticalAlign: "-2px" }} />{" "}
            <strong>Alerting is off.</strong> Health conditions are recorded but nobody is told. Add a recipient and switch it on
            below before relying on unattended processing.
          </>
        )}
      </div>

      {/* ── conditions ──────────────────────────────────────────────────── */}
      <Card>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
          <SectionLabel>Conditions</SectionLabel>
          <span className="ds-table__meta">
            {open.length === 0 ? "nothing to report" : `${open.length} open`}{cleared.length ? ` · ${cleared.length} recently cleared` : ""}
          </span>
          <span style={{ marginLeft: "auto" }}>
            <Btn kind="ghost" size="sm" onClick={() => void loadHealth()} title="Re-read the health state">
              <RefreshCw size={13} aria-hidden /> Refresh
            </Btn>
          </span>
        </div>
        {!health ? <div className="ds-empty"><Loader2 size={20} className="ds-spin" /></div>
          : open.length === 0 && cleared.length === 0 ? (
            <div className="ds-empty">No health condition has been seen. The check runs every fifteen minutes.</div>
          ) : (
            <div className="ds-scroll-x">
              <table className="ds-table ds-table--dense ds-table--rows">
                <thead>
                  <tr><th scope="col">Condition</th><th scope="col">What</th><th scope="col">Checks</th><th scope="col">First seen</th><th scope="col">State</th></tr>
                </thead>
                <tbody>
                  {[...open, ...cleared].map((a) => (
                    <tr key={`${a.kind}/${a.ref}`}>
                      <td><div className="ds-table__name">{KIND_LABEL[a.kind] ?? a.kind}</div><div className="ds-table__meta">{a.kind}</div></td>
                      <td style={{ fontSize: 12 }}>{a.detail ?? a.ref}</td>
                      <td className="ds-table__num">{a.consecutive}</td>
                      <td style={{ whiteSpace: "nowrap" }}><div className="ds-table__meta">{fmt(a.first_seen)}</div></td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        {a.cleared_at ? <Badge tone="new">cleared</Badge> : a.notified_at ? <Badge tone="updated">reported</Badge> : <Badge tone="neutral">watching</Badge>}
                        <div className="ds-table__meta">{fmt(a.cleared_at ?? a.notified_at ?? a.last_seen)}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Card>

      {/* ── alerting ────────────────────────────────────────────────────── */}
      <Card>
        <SectionLabel>Alerting</SectionLabel>
        {draft && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
            <Switch checked={draft.enabled} onChange={(v) => setDraft({ ...draft, enabled: v })}
              label="Mail these recipients when a condition is confirmed" />
            <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span className="ds-label">Recipients (comma-separated)</span>
              <input className="ds-input" value={draft.recipients} placeholder="ops@arabshipbroker.com"
                onChange={(e) => setDraft({ ...draft, recipients: e.target.value })} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: 280 }}>
              <span className="ds-label">Consecutive failing checks before mailing</span>
              <input className="ds-input" type="number" min={1} max={20} value={draft.min}
                onChange={(e) => setDraft({ ...draft, min: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
            </label>
            <p className="ds-table__meta" style={{ margin: 0 }}>
              The check runs every fifteen minutes, so two checks is about half an hour of a condition persisting.
              Each condition is mailed once, and once more when it clears.
            </p>
            <div>
              <Btn kind="primary" disabled={busy === "alerts"} onClick={() => void saveAlerts()}>
                {busy === "alerts" ? "Saving…" : "Save alert settings"}
              </Btn>
            </div>
          </div>
        )}
      </Card>

      {/* ── uploads ─────────────────────────────────────────────────────── */}
      <Card flush>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", padding: "12px 14px 10px" }}>
          <SectionLabel>Uploads</SectionLabel>
          <span className="ds-table__meta">
            {jobs ? `${jobs.total} job(s)` : "loading…"} · queued workbooks are staged by the upload pass every five minutes
          </span>
          <label style={{ marginLeft: "auto", display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span className="ds-label" style={{ margin: 0 }}>State</span>
            <select className="ds-input" style={{ width: 130, padding: "4px 6px", fontSize: 12 }} value={status}
              onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter uploads by state">
              {STATE_FILTERS.map((v) => (
                <option key={v} value={v}>{v === "all" ? "All states" : STATUS_LABEL[v]}</option>
              ))}
            </select>
          </label>
        </div>
        {!jobs ? <div className="ds-empty"><Loader2 size={20} className="ds-spin" /></div>
          : jobs.rows.length === 0 ? <div className="ds-empty">No upload jobs{status === "all" ? "" : ` in state ${STATUS_LABEL[status as UploadJobRow["status"]] ?? status}`}.</div>
          : (
            <>
              <div className="ds-scroll-x">
                <table className="ds-table ds-table--dense ds-table--rows">
                  <thead>
                    <tr>
                      <th scope="col">Workbook</th><th scope="col">Uploaded by</th><th scope="col">Queued</th>
                      <th scope="col">State</th><th scope="col">Attempts</th><th scope="col">Next / finished</th>
                      <th scope="col">Batch</th><th scope="col">Note</th><th scope="col">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.rows.map((j) => {
                      const canRetry = (j.status === "failed" || j.status === "cancelled") && j.payload_deleted_at == null && j.batch_resumable === true;
                      const canCancel = j.status === "queued" || j.status === "retry_wait";
                      const terminal = j.status === "failed" || j.status === "cancelled" || j.status === "done";
                      const retention = j.payload_deleted_at ? "workbook removed"
                        : j.payload_expires_at ? `kept until ${fmt(j.payload_expires_at)}`
                        : j.storage_path ? "kept in private storage" : "held in the job row";
                      return (
                        <tr key={j.id}>
                          <td>
                            <div className="ds-table__name ds-mono" style={{ fontSize: 12 }}>{j.file_name}</div>
                            <div className="ds-table__meta">{size(j.size)} · {retention}</div>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>{j.uploader ?? "—"}</td>
                          <td style={{ whiteSpace: "nowrap" }}><div className="ds-table__meta">{fmt(j.created_at)}</div></td>
                          <td>
                            <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
                            {j.failure_kind && <div className="ds-table__meta">{j.failure_kind}</div>}
                          </td>
                          <td className="ds-table__num">{j.attempts} / {j.max_attempts}</td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <div className="ds-table__meta">
                              {j.status === "retry_wait" ? fmt(j.next_attempt_at)
                                : j.status === "running" ? `lease to ${fmt(j.lease_until)}`
                                : fmt(j.finished_at)}
                            </div>
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            {j.batch_id ? (
                              <Btn kind="ghost" size="sm" onClick={() => onOpenBatchId?.(j.batch_id as string)} title="Open the batch this job staged into">
                                {j.batch_id.slice(0, 8)}
                              </Btn>
                            ) : <span className="ds-table__meta">—</span>}
                            {j.batch_resumable === false && <div className="ds-table__meta">reviewed — no retry</div>}
                          </td>
                          <td style={{ fontSize: 12, maxWidth: 240 }}>
                            {j.error ? j.error.slice(0, 180) : j.totals ? `${j.totals.new ?? 0} new · ${j.totals.updated ?? 0} updated` : "—"}
                          </td>
                          <td style={{ whiteSpace: "nowrap" }}>
                            <span style={{ display: "inline-flex", gap: 4 }}>
                              {canRetry && (
                                <Btn kind="accent" size="sm" disabled={busy === j.id} onClick={() => void act(j.id, "retry")}
                                  title="Queue this workbook again; it re-stages into the same batch">
                                  <RefreshCw size={13} aria-hidden /> Retry
                                </Btn>
                              )}
                              {canCancel && (
                                <Btn kind="ghost" size="sm" disabled={busy === j.id} onClick={() => void act(j.id, "cancel")}
                                  title="Cancel this job before it is staged">
                                  <XCircle size={13} aria-hidden /> Cancel
                                </Btn>
                              )}
                              {terminal && (
                                <Btn kind="danger" size="sm" disabled={busy === j.id} onClick={() => void act(j.id, "remove")}
                                  title="Remove the job and its stored workbook">
                                  <Trash2 size={13} aria-hidden /> Remove
                                </Btn>
                              )}
                              {!canRetry && !canCancel && !terminal && (
                                <span className="ds-table__meta"><Clock size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> in progress</span>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", flexWrap: "wrap" }}>
                <span className="ds-table__meta">Page {jobs.page} of {pages} · {jobs.total} job(s)</span>
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                  <Btn kind="ghost" size="sm" disabled={jobs.page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>Previous</Btn>
                  <Btn kind="ghost" size="sm" disabled={jobs.page >= pages} onClick={() => setPage((p) => p + 1)}>Next</Btn>
                </span>
              </div>
            </>
          )}
      </Card>
    </section>
  );
}

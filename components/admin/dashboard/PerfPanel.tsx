"use client";

// Performance & infrastructure — Supabase figures read live, the deployment
// (when Vercel is connected), the platform's API routes, the cron run log
// (job_runs, with the timestamp fallback for jobs that have not run since the
// log shipped) and the security posture computed from pg_catalog.
import * as React from "react";
import type { DashboardFeed, DomainSnapshot, Level, VercelSnapshot } from "@/lib/admin/dashboard/types";
import { ageOf, domainLevel, fmtDay, fmtInt, fmtWhen } from "@/lib/admin/dashboard/model";
import { Box, Dot, Fresh, Panel, SourcePill, Tile } from "./ui";

const ROUTES: { path: string; kind: string; job?: string; note: string }[] = [
  { path: "/api/sync/email", kind: "stream", job: "email-sync", note: "IMAP sync, SSE" },
  { path: "/api/ports/search", kind: "api", note: "port picker" },
  { path: "/api/circulars/parse", kind: "api", note: "LLM extraction" },
  { path: "/api/upload/cargomap", kind: "api", note: "workbook upload" },
  { path: "/api/cron/refresh-matches", kind: "cron", job: "refresh-matches", note: "daily 05:00 UTC" },
  { path: "/api/cron/market-insights", kind: "cron", job: "market-insights", note: "Mondays 06:00 UTC" },
  { path: "/api/group-mail/dispatch", kind: "cron", job: "groupmail-dispatch", note: "pg_cron */10" },
  { path: "/api/bunker/ingest", kind: "api", job: "bunker-ingest", note: "bunker ticker" },
  { path: "/api/contact", kind: "api", note: "public contact form" },
  { path: "/api/whatsapp/webhook", kind: "webhook", job: "whatsapp-webhook", note: "bridge inbound" },
];

const SUPABASE_URL = "https://supabase.com/dashboard/project/rezfejaxbmdzkslrrefr";

const JOB_ORDER = ["groupmail-dispatch", "refresh-matches", "market-insights", "email-sync", "whatsapp-webhook", "bunker-ingest"];

function Yes({ ok, text }: { ok: boolean | null; text?: string }) {
  if (ok == null) return <b className="adb-muted">—</b>;
  return <b className={ok ? "is-ok" : "is-crit"}>{text ?? (ok ? "yes" : "no")}</b>;
}

function DomainBox({ d }: { d: DomainSnapshot }) {
  const dl = domainLevel(d);
  const dmarcNote = !d.dmarc.present ? "add v=DMARC1; p=quarantine; rua=mailto:…"
    : d.dmarc.policy === "none" ? "p=none only monitors — move to p=quarantine once all mail is signed"
    : d.dmarc.has_report ? "enforcing, reports on" : "enforcing, add rua= for reports";
  return (
    <Box className={`adb-domain${dl.level === "crit" ? " is-crit" : ""}`} title={`Domain & mail · ${d.registrar ?? "registrar"}`}
      right={<span className={`adb-state is-${dl.level}`}>{dl.state}</span>}>
      <div className="adb-domain__grid">
        <div className="adb-kv"><span>Domain</span><b>{d.domain}</b></div>
        <div className="adb-kv"><span>Expires</span><b className={d.days_left != null && d.days_left < 60 ? "is-warn" : ""}>{fmtDay(d.expires_at)}{d.days_left != null ? ` · ${fmtInt(d.days_left)} d` : ""}</b></div>
        <div className="adb-kv" title={d.nameservers.join(", ")}><span>Nameservers</span><b className="adb-ellipsis">{d.nameservers.length ? d.nameservers.map((n) => n.replace(/\.$/, "")).join(", ") : "—"}</b></div>
        <div className="adb-kv"><span>DNSSEC</span><Yes ok={d.dnssec} text={d.dnssec ? "signed" : "not signed (optional)"} /></div>
        <div className="adb-kv" title={d.mx.map((m) => `${m.priority} ${m.host}`).join(", ")}><span>MX</span><b>{d.mx.length ? `${d.mx.length} host${d.mx.length === 1 ? "" : "s"} · ${d.mx[0].host}` : "none"}</b></div>
        <div className="adb-kv" title={d.spf.record ?? ""}><span>SPF</span><Yes ok={d.spf.present} text={d.spf.present ? `present · ${d.spf.all ?? "?"}all` : "missing"} /></div>
        <div className="adb-kv"><span>DKIM (selector {d.dkim.selector})</span><Yes ok={d.dkim.present} text={d.dkim.present ? "key published" : "missing"} /></div>
        <div className="adb-kv" title={d.dmarc.record ?? ""}><span>DMARC</span><b className={!d.dmarc.present || d.dmarc.policy === "none" ? "is-warn" : "is-ok"}>{d.dmarc.present ? `p=${d.dmarc.policy ?? "?"}` : "missing"}</b></div>
        <div className="adb-kv"><span>SMTP {d.smtp.host ?? "—"}:{d.smtp.port}</span><Yes ok={d.smtp.reachable} text={d.smtp.reachable ? `reachable · ${d.smtp.ms} ms` : d.smtp.reachable === false ? `unreachable · ${d.smtp.error ?? ""}` : "not probed"} /></div>
        <div className="adb-kv"><span>Sending mailbox</span><b>{d.mailbox ?? "—"}</b></div>
        <div className="adb-kv"><span>Namecheap API</span>
          {d.namecheap.connected
            ? <b>auto-renew <span className={d.namecheap.auto_renew ? "is-ok" : "is-warn"}>{d.namecheap.auto_renew ? "on" : "off"}</span> · lock {d.namecheap.locked ? "on" : "off"} · WhoisGuard {d.namecheap.whois_guard ? "on" : "off"}</b>
            : <b className="adb-muted">not connected · set NAMECHEAP_API_USER / KEY / CLIENT_IP</b>}
        </div>
      </div>
      <div className="adb-sec__fix">
        <span className="adb-eyebrow">DMARC</span>
        <span>{dmarcNote}</span>
      </div>
      {d.errors.length > 0 && <div className="adb-note">{d.errors.join(" · ")}</div>}
      <div className="adb-note">Checked {fmtWhen(d.checked_at)} UTC · registry via RDAP, records via DNS, host via TCP · cached 10 min.</div>
    </Box>
  );
}

export function PerfPanel({ feed, now, stale, vercel, domain }: { feed: DashboardFeed; now: Date; stale: boolean; vercel: VercelSnapshot | null; domain: DomainSnapshot | null }) {
  const db = feed.db, sec = feed.security, gm = feed.cron_groupmail;
  const errN = sec.definer_views.length + sec.rls_off_tables.length;
  const runs = feed.events?.job_runs ?? null;
  const lastByJob = new Map((runs?.last_by_job ?? []).map((r) => [r.job, r]));
  const runsInRange = runs ? runs.recent.reduce<Record<string, number>>((acc, r) => { acc[r.job] = (acc[r.job] ?? 0) + 1; return acc; }, {}) : {};

  // Fallback timestamps for jobs that have not written job_runs yet.
  const fallback: Record<string, { rows: string; when: string; level: Level }> = {
    "groupmail-dispatch": { rows: gm ? `${fmtInt(gm.runs_24h)} ticks / 24 h` : "not scheduled", when: gm ? fmtWhen(gm.last_start) : "—", level: !gm ? "crit" : gm.failed_24h ? "warn" : "ok" },
    "refresh-matches": { rows: `${fmtInt(feed.matches.n)} pairs`, when: fmtWhen(feed.matches.computed_at), level: (now.getTime() - new Date(feed.matches.computed_at ?? 0).getTime()) > 36 * 3600e3 ? "crit" : "ok" },
    "market-insights": { rows: feed.insights.last_week ?? "—", when: fmtWhen(feed.insights.last_published_at), level: "ok" },
    "email-sync": { rows: feed.email.last_batch_status ?? "—", when: fmtWhen(feed.email.last_sync_at), level: (now.getTime() - new Date(feed.email.last_sync_at ?? 0).getTime()) > 24 * 3600e3 ? "warn" : "ok" },
    "whatsapp-webhook": { rows: feed.whatsapp?.state ?? "no runtime", when: feed.whatsapp ? fmtWhen(feed.whatsapp.worker_seen) : "—", level: feed.whatsapp && (now.getTime() - new Date(feed.whatsapp.worker_seen ?? 0).getTime()) < 3600e3 ? "ok" : "crit" },
    "bunker-ingest": { rows: "no runs logged", when: "—", level: "info" },
  };
  const jobs = JOB_ORDER.map((job) => {
    const r = lastByJob.get(job);
    if (r) {
      return {
        job, logged: true,
        rows: r.status === "failed" ? `failed · ${(r.error ?? "").slice(0, 40)}` : r.status === "running" ? "running…" : `${r.rows ?? "—"} rows`,
        when: fmtWhen(r.started_at),
        level: (r.status === "succeeded" ? "ok" : r.status === "failed" ? "crit" : "warn") as Level,
      };
    }
    return { job, logged: false, ...fallback[job] };
  });

  return (
    <Panel
      label="Performance and infrastructure"
      title="Performance & infrastructure"
      sub="Supabase health, the deployment, the ten API routes, cron runs, security posture, and the Namecheap domain and mail service."
      stale={stale}
      right={<Fresh text={vercel ? "Vercel + Supabase · live" : "Supabase live · Vercel not connected"} level={vercel ? "ok" : "info"} />}
    >
      <div className="adb-cols4 adb-mb">
        <Tile label="Database size" value={<>{db.size_mb} <small>MB</small></>} href={`${SUPABASE_URL}/reports/database`} external
          sub={`${fmtInt(db.tables)} tables · ${fmtInt(db.views)} views · ${fmtInt(db.functions)} functions`} />
        <Tile label="Connections" value={<>{fmtInt(db.connections)} <small>/ {fmtInt(db.max_connections)}</small></>} href={`${SUPABASE_URL}/reports/database`} external
          sub="pooled connections in use right now" valueLevel={db.connections / db.max_connections > 0.8 ? "warn" : undefined} />
        <Tile label="Deployment" value={vercel ? vercel.state : "N/A"} valueLevel={vercel ? (vercel.state === "READY" ? "ok" : "crit") : undefined}
          href={vercel?.inspector_url ?? "https://vercel.com/dashboard"} external
          sub={vercel ? `${vercel.sha?.slice(0, 7) ?? "—"} · ${ageOf(vercel.created_at, now)} ago` : "set VERCEL_TOKEN + VERCEL_PROJECT_ID"} />
        <Tile label="Job failures" value={runs ? fmtInt(runs.failed_range) : "—"} valueLevel={runs && runs.failed_range > 0 ? "crit" : runs ? "ok" : undefined}
          sub={runs ? `${fmtInt(runs.total)} runs logged in total` : "job_runs unavailable"} />
      </div>

      <div className="adb-split">
        <div className="adb-table">
          <div className="adb-table__inner">
            <div className="adb-table__head adb-routes">
              <span>API route</span><span>Kind</span><span className="r">Runs</span><span className="r">Err</span><span className="r">p75</span>
            </div>
            {ROUTES.map((r) => {
              const last = r.job ? lastByJob.get(r.job) : undefined;
              return (
                <div key={r.path} className="adb-table__row adb-routes is-static">
                  <span className="adb-ellipsis" title={r.note}>{r.path}</span>
                  <span className="adb-muted">{r.kind}</span>
                  <span className={`r${r.job ? "" : " adb-muted"}`}>{r.job ? fmtInt(runsInRange[r.job] ?? 0) : "—"}</span>
                  <span className={`r${last?.status === "failed" ? " is-crit" : " adb-muted"}`}>{r.job ? (last?.status === "failed" ? "1" : "0") : "—"}</span>
                  <span className="r adb-muted">—</span>
                </div>
              );
            })}
            <div className="adb-table__foot">Runs and errors come from job_runs (last 10). Request counts and p75 latency need the Vercel observability API (Pro plan).</div>
          </div>
        </div>

        <div className="adb-stack">
          <Box title="Cron run log" right={<SourcePill text={runs ? "job_runs · live" : "timestamps"} title={runs ? "Each background job writes a job_runs row (started, finished, status, rows, error). Jobs that have not run since the log shipped fall back to the timestamps they leave behind." : "job_runs could not be read; showing the timestamps each job leaves behind."} />}>
            <div className="adb-jobs">
              {jobs.map((j) => (
                <div key={j.job} className="adb-job" title={j.logged ? "from job_runs" : "from the job's own timestamps (no run logged yet)"}>
                  <Dot level={j.level} size={8} />
                  <span className="adb-ellipsis">{j.job}{j.logged ? "" : " *"}</span>
                  <span className="adb-muted">{j.rows}</span>
                  <span className="adb-muted">{j.when}</span>
                </div>
              ))}
            </div>
            {jobs.some((j) => !j.logged) && <div className="adb-note">* not logged yet — shown from the job&apos;s own timestamps.</div>}
          </Box>
          <Box className={`adb-security${errN ? " is-crit" : ""}`} title="Security posture"
            right={<a href={`${SUPABASE_URL}/advisors/security`} target="_blank" rel="noreferrer" className="adb-link">Advisors →</a>}>
            <div className="adb-sec">
              <span className="adb-sec__cell is-crit"><b>{fmtInt(errN)}</b><span>error</span></span>
              <span className="adb-sec__cell is-warn"><b>{fmtInt(sec.definer_fn_anon + sec.mutable_search_path)}</b><span>warn</span></span>
              <span className="adb-sec__cell is-info"><b>{fmtInt(db.tables - sec.rls_off_tables.length)}</b><span>RLS on</span></span>
            </div>
            <div className="adb-kv-list adb-sec__list">
              <div className="adb-kv" title={sec.definer_views.join(", ") || "none"}>
                <span>Security-definer views</span>
                <b className={sec.definer_views.length ? "is-crit" : "is-ok"}>{fmtInt(sec.definer_views.length)}</b>
              </div>
              {sec.definer_views.length > 0 && (
                <div className="adb-sec__names" title={sec.definer_views.join(", ")}>
                  {sec.definer_views.slice(0, 3).map((v) => <code key={v}>{v}</code>)}
                  {sec.definer_views.length > 3 && <span className="adb-muted">+{sec.definer_views.length - 3} more</span>}
                </div>
              )}
              <div className="adb-kv"><span>Definer functions callable by anon</span><b className={sec.definer_fn_anon ? "is-warn" : "is-ok"}>{fmtInt(sec.definer_fn_anon)}</b></div>
              <div className="adb-kv"><span>Definer functions without a pinned search_path</span><b className={sec.mutable_search_path ? "is-warn" : "is-ok"}>{fmtInt(sec.mutable_search_path)}</b></div>
              <div className="adb-kv"><span>Tables with RLS enabled</span><b className={sec.rls_off_tables.length ? "is-crit" : "is-ok"}>{fmtInt(db.tables - sec.rls_off_tables.length)} / {fmtInt(db.tables)}</b></div>
            </div>
            {sec.definer_views.length > 0 && (
              <div className="adb-sec__fix">
                <span className="adb-eyebrow">Fix</span>
                <span>Recreate each view <code>with (security_invoker = true)</code> so it runs with the caller&apos;s RLS.</span>
              </div>
            )}
          </Box>
        </div>
      </div>
      {domain && <div className="adb-mt"><DomainBox d={domain} /></div>}
    </Panel>
  );
}

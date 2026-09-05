"use client";

// Console home — the Admin Dashboard design: range control, health command
// strip (chips open a drawer with history + fix), a 12-column grid with
// market / users / ingestion / growth / infrastructure on the left and
// "Needs your action" + alerts (with editable thresholds) on the right.
// Data arrives from the server page (get_admin_dashboard + optional Vercel);
// this component only derives the view model and handles interaction.
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { DashboardFeed, DomainSnapshot, HealthChip, RangeKey, Thresholds, VercelSnapshot } from "@/lib/admin/dashboard/types";
import {
  RANGE_KEYS, RANGE_LABEL, THRESHOLD_KEYS, THRESHOLD_META, ageOf, buildAlerts, buildChips, buildTasks, fmtClock, fmtClockCairo, fmtInt, normalizeThresholds,
} from "@/lib/admin/dashboard/model";
import { saveAlertThresholds } from "@/app/(admin)/admin/dashboard/actions";
import { Dot, Panel, StatePill } from "./ui";
import { MarketPulse } from "./MarketPulse";
import { UsersPanel } from "./UsersPanel";
import { IngestPanel } from "./IngestPanel";
import { GrowthPanel } from "./GrowthPanel";
import { PerfPanel } from "./PerfPanel";

export type DashboardShow = { market: boolean; users: boolean; ingest: boolean; growth: boolean; perf: boolean };

export function AdminDashboard({
  feed, error, vercel, domain, range, show, taskAccess, canEditThresholds, loadedAt,
}: {
  feed: DashboardFeed | null;
  error: string | null;
  vercel: VercelSnapshot | null;
  domain: DomainSnapshot | null;
  range: RangeKey;
  show: DashboardShow;
  taskAccess: Record<string, boolean>;
  canEditThresholds: boolean;
  /** server render time (ISO) — the page's "as of" clock, so server and client agree */
  loadedAt: string;
}) {
  const router = useRouter();
  const now = React.useMemo(() => new Date(feed?.generated_at ?? loadedAt), [feed?.generated_at, loadedAt]);
  const [refreshing, startRefresh] = React.useTransition();
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [thOpen, setThOpen] = React.useState(false);
  const [th, setTh] = React.useState<Thresholds>(() => normalizeThresholds(feed?.thresholds));
  const [saving, startSave] = React.useTransition();

  React.useEffect(() => { setTh(normalizeThresholds(feed?.thresholds)); }, [feed?.thresholds]);

  const chips = React.useMemo(() => (feed ? buildChips(feed, th, now, vercel, domain) : []), [feed, th, now, vercel, domain]);
  const tasks = React.useMemo(() => (feed ? buildTasks(feed, th, now).filter((t) => taskAccess[t.section]) : []), [feed, th, now, taskAccess]);
  const alerts = React.useMemo(() => (feed ? buildAlerts(chips, feed, now) : []), [chips, feed, now]);
  const drawer: HealthChip | null = chips.find((c) => c.id === drawerId) ?? null;

  React.useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawer]);

  const stale = !feed;
  const freshText = feed ? `refreshed ${ageOf(feed.generated_at, new Date(loadedAt))} ago` : "no data";
  const bad = chips.filter((c) => c.level === "crit").length;
  const warn = chips.filter((c) => c.level === "warn").length;
  const na = chips.filter((c) => c.level === "info").length;
  const taskTotal = tasks.reduce((s, t) => s + t.n, 0);
  const critN = alerts.filter((a) => a.level === "crit").length;
  const warnN = alerts.filter((a) => a.level === "warn").length;

  const pickRange = (r: RangeKey) => router.push(`/admin/dashboard?range=${r}`);
  const refresh = () => startRefresh(() => router.refresh());
  const saveTh = () => startSave(async () => {
    const res = await saveAlertThresholds(th);
    if (res.success) toast.success("Alert thresholds saved."); else toast.error(res.error ?? "Could not save thresholds.");
  });

  return (
    <div className="adm-page adb-page">
      {/* ── head ─────────────────────────────────────────────────── */}
      <div className="adb-head">
        <div className="adb-head__titles">
          <h1 className="adb-h1">Dashboard</h1>
          <div className="adb-head__sub">Health → action → market → users → infrastructure. Every number links to the page that owns it.</div>
        </div>
        <span className="adb-spacer" />
        <div className="adb-range" role="tablist" aria-label="Time range">
          {RANGE_KEYS.map((r) => (
            <button key={r} type="button" role="tab" aria-selected={r === range} className={`adb-range__btn${r === range ? " is-on" : ""}`} onClick={() => pickRange(r)}>{r}</button>
          ))}
        </div>
        <span className="adb-asof" title="Server clock in UTC, with the same instant on the Cairo clock">
          <Dot level={stale ? "warn" : "ok"} size={7} />
          as of {fmtClock(now)} UTC · {fmtClockCairo(now)} Cairo · {freshText}
        </span>
        <button type="button" className="adb-btn" onClick={refresh} disabled={refreshing}>{refreshing ? "Refreshing…" : "Refresh"}</button>
        <button type="button" className="adb-btn is-primary" onClick={() => window.print()}>Export summary</button>
      </div>

      {stale && (
        <div className="adb-stale" role="alert">
          <span className="adb-stale__mark" />
          get_admin_dashboard() did not return{error ? `: ${error}` : ""}. Panels below are empty until it does.
          <button type="button" className="adb-stale__retry" onClick={refresh}>Retry</button>
        </div>
      )}

      {/* ── command strip ─────────────────────────────────────────── */}
      <section data-screen-label="Command strip" className="adb-section">
        <div className="adb-strip__head">
          <span className="adb-eyebrow">Health</span>
          <span className="adb-hint">Is the platform healthy right now? Click a chip for history and a fix.</span>
          <span className="adb-spacer" />
          <span className="adb-hint">{feed ? `${bad} down · ${warn} aging · ${chips.length - bad - warn - na} ok${na ? ` · ${na} not connected` : ""}` : "—"}</span>
        </div>
        <div className="adb-strip">
          {chips.map((c) => (
            <button key={c.id} type="button" className={`adb-chip is-${c.level}`} onClick={() => setDrawerId(c.id)} title={c.drawer.subtitle}>
              <span className="adb-chip__stripe" />
              <span className="adb-chip__top">
                <Dot level={c.level} pulse={c.level === "crit"} />
                <span className="adb-chip__name">{c.name}</span>
                <StatePill level={c.level} text={c.state} />
              </span>
              <span className="adb-chip__detail">{c.detail}</span>
              <span className="adb-chip__sub">{c.sub}</span>
            </button>
          ))}
          {chips.length === 0 && Array.from({ length: 10 }).map((_, i) => <div key={i} className="adb-chip is-skeleton" aria-hidden />)}
        </div>
      </section>

      {/* ── grid ──────────────────────────────────────────────────── */}
      <div className="adb-grid">
        <div className="adb-left">
          {feed && show.market && <MarketPulse feed={feed} range={range} now={now} stale={stale} freshText={freshText} />}
          {feed && show.users && <UsersPanel feed={feed} range={range} stale={stale} freshText={freshText} />}
          {feed && show.ingest && <IngestPanel feed={feed} range={range} stale={stale} freshText={freshText} />}
          {feed && show.growth && <GrowthPanel feed={feed} range={range} now={now} stale={stale} vercel={vercel} />}
          {feed && show.perf && <PerfPanel feed={feed} now={now} stale={stale} vercel={vercel} domain={domain} />}
          {!feed && <div className="adb-panel is-stale adb-empty">Waiting for data…</div>}
        </div>

        <div className="adb-right">
          <Panel label="Needs your action" title="Needs your action" sub="Prioritised by severity, then size. One primary action per row." stale={stale}
            right={<span className="adb-count">{fmtInt(taskTotal)}</span>}>
            {feed && tasks.length === 0 && <div className="adb-empty">Nothing waiting. Queues are clear and every position can match.</div>}
            <div className="adb-tasks">
              {tasks.map((t) => (
                <div key={t.id} className="adb-task">
                  <span className={`adb-task__bar is-${t.level}`} />
                  <div className="adb-task__body">
                    <div className="adb-task__what"><span>{t.what}</span><b>{fmtInt(t.n)}</b></div>
                    <div className={`adb-task__age${t.level === "crit" ? " is-crit" : ""}`}>{t.age}</div>
                  </div>
                  <Link href={t.action.href} className="adb-btn is-small">{t.action.label}</Link>
                </div>
              ))}
            </div>
          </Panel>

          <Panel label="Alerts" title="Alerts" sub="Threshold breaches, newest first." stale={stale}
            right={<span className="adb-sev"><span className="is-crit">{critN} crit</span><span className="is-warn">{warnN} warn</span></span>}>
            <div className="adb-alerts">
              {feed && alerts.length === 0 && <div className="adb-empty">No threshold is breached.</div>}
              {alerts.map((a) => {
                const inner = (
                  <>
                    <span className={`adb-alert__mark is-${a.level}`} />
                    <span className="adb-alert__body"><span className="adb-alert__title">{a.title}</span><span className="adb-alert__detail">{a.detail}</span></span>
                    <span className="adb-alert__when">{a.when}</span>
                  </>
                );
                if (a.chipId) return <button key={a.id} type="button" className={`adb-alert is-${a.level}`} onClick={() => setDrawerId(a.chipId)}>{inner}</button>;
                if (a.href) return <Link key={a.id} href={a.href} className={`adb-alert is-${a.level}`}>{inner}</Link>;
                return <div key={a.id} className={`adb-alert is-${a.level}`}>{inner}</div>;
              })}
            </div>
            <button type="button" className="adb-th__toggle" onClick={() => setThOpen((v) => !v)} aria-expanded={thOpen}>
              <span>Thresholds</span><span className="adb-muted">{thOpen ? "▴" : "▾"}</span>
            </button>
            {thOpen && (
              <div className="adb-th">
                {THRESHOLD_KEYS.map((k) => (
                  <label key={k} className="adb-th__row">
                    <span>{THRESHOLD_META[k].label}</span>
                    <span className="adb-th__input">
                      <input type="number" min={0} step="any" value={th[k]} disabled={!canEditThresholds}
                        onChange={(e) => setTh((prev) => ({ ...prev, [k]: Number(e.target.value) }))} />
                      <span className="adb-th__unit">{THRESHOLD_META[k].unit}</span>
                    </span>
                  </label>
                ))}
                <div className="adb-th__foot">
                  <span className="adb-hint">{canEditThresholds ? "Saved to Platform settings → Alerts (app_settings)." : "Only the owner can change thresholds."}</span>
                  {canEditThresholds && <button type="button" className="adb-btn is-small is-primary" onClick={saveTh} disabled={saving}>{saving ? "Saving…" : "Save"}</button>}
                </div>
              </div>
            )}
          </Panel>
        </div>
      </div>

      {/* ── drawer ────────────────────────────────────────────────── */}
      {drawer && (
        <>
          <div className="adb-scrim" onClick={() => setDrawerId(null)} />
          <aside className="adb-drawer" role="dialog" aria-modal="true" aria-label={drawer.name}>
            <div className="adb-drawer__head">
              <Dot level={drawer.level} size={10} pulse={drawer.level === "crit"} />
              <div className="adb-drawer__titles">
                <div className="adb-drawer__title">{drawer.name}</div>
                <div className="adb-drawer__sub">{drawer.drawer.subtitle}</div>
              </div>
              <button type="button" className="adb-drawer__close" aria-label="Close" onClick={() => setDrawerId(null)}>×</button>
            </div>
            <div className="adb-drawer__body">
              <div className="adb-drawer__sec"><div className="adb-eyebrow">Current</div><div className="adb-drawer__text">{drawer.drawer.current}</div></div>
              <div className="adb-drawer__sec">
                <div className="adb-eyebrow">History</div>
                {drawer.drawer.history.length === 0 && <div className="adb-hint">No run history is recorded for this signal yet.</div>}
                <div className="adb-history">
                  {drawer.drawer.history.map((h, i) => (
                    <div key={i} className="adb-history__row"><Dot level={h.level} size={8} /><span className="adb-muted">{h.when}</span><span>{h.text}</span></div>
                  ))}
                </div>
              </div>
              <div className="adb-drawer__sec"><div className="adb-eyebrow">Threshold</div><div className="adb-drawer__small">{drawer.drawer.threshold}</div></div>
              <div className="adb-drawer__sec"><div className="adb-eyebrow">Source</div><div className="adb-drawer__small">{drawer.drawer.source}</div></div>
            </div>
            <div className="adb-drawer__foot">
              {drawer.drawer.secondary && (drawer.drawer.secondary.external
                ? <a href={drawer.drawer.secondary.href} target="_blank" rel="noreferrer" className="adb-btn">{drawer.drawer.secondary.label}</a>
                : <Link href={drawer.drawer.secondary.href} className="adb-btn">{drawer.drawer.secondary.label}</Link>)}
              {drawer.drawer.fix && (drawer.drawer.fix.external
                ? <a href={drawer.drawer.fix.href} target="_blank" rel="noreferrer" className="adb-btn is-primary">{drawer.drawer.fix.label}</a>
                : <Link href={drawer.drawer.fix.href} className="adb-btn is-primary">{drawer.drawer.fix.label}</Link>)}
            </div>
          </aside>
        </>
      )}
      <div className="adb-print-only">Arab ShipBroker · admin summary · {RANGE_LABEL[range]} · as of {fmtClock(now)} UTC · {fmtClockCairo(now)} Cairo</div>
    </div>
  );
}

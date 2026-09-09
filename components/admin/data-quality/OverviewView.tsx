"use client";

// Overview — health score per table (100 − Σ open × weight ÷ rows × 100) with
// a 14-day trend, open issues by severity, the post-commit checks the
// dashboard already counts, what changed since the last run, AI queue.
import * as React from "react";
import { getOverview, type DqOverview } from "@/app/(admin)/admin/data-quality/actions";
import { Badge, Empty, Loading, Spark, fmtDateTime, fmtDur, fmtInt, scoreColor, sevColor } from "./ui";
import { useConsole } from "./DataQualityConsole";

export function OverviewView() {
  const { boot, nav, tableLabel } = useConsole();
  const [ov, setOv] = React.useState<DqOverview | null>(null);
  const [err, setErr] = React.useState<string | null>(null);
  React.useEffect(() => { let alive = true; getOverview().then((r) => { if (!alive) return; if (r.success) setOv(r.data); else setErr(r.error); }); return () => { alive = false; }; }, []);
  if (err) return <div className="adm-empty">{err}</div>;
  if (!ov) return <Loading />;
  const w = boot.settings.weights;
  const goIssues = (patch: Record<string, string | null>) => nav({ tab: "issues", table: null, view: null, rule: null, ...patch });
  const maxCheck = Math.max(1, ...ov.checks.map((c) => c.n));
  const noRuns = !ov.lastRun;
  const total = ov.sev.error + ov.sev.warn + ov.sev.info;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", alignItems: "center" }} className="dq-muted">
        <span><strong style={{ color: "var(--asb-ink)", fontWeight: 600 }}>Last run</strong> {ov.lastRun ? `${ov.lastRun.code} · ${fmtDateTime(ov.lastRun.finished_at)} · ${fmtDur(ov.lastRun.duration_ms)} · ${fmtInt(ov.lastRun.rows_done)} rows · ${fmtInt(ov.lastRun.found.error + ov.lastRun.found.warn + ov.lastRun.found.info)} issues` : "none yet"}</span>
        <span><strong style={{ color: "var(--asb-ink)", fontWeight: 600 }}>Next scheduled</strong> {boot.settings.nightly_enabled ? `Nightly ${boot.settings.nightly_time} UTC · whole database · ${boot.settings.nightly_mode === "both" ? "rules + AI" : boot.settings.nightly_mode}` : "not scheduled"}</span>
        <span><strong style={{ color: "var(--asb-ink)", fontWeight: 600 }}>Registry</strong> {boot.settings.registry_release ? `UN/LOCODE ${boot.settings.registry_release}` : "no release imported"}</span>
        <span style={{ marginLeft: "auto" }}>Health = 100 − Σ(open issues × weight) ÷ rows × 100 · weights error {w.error} · warn {w.warn} · info {w.info}</span>
      </div>

      {noRuns && total === 0 ? (
        <Empty title="No runs yet" action={<button type="button" className="adm-btn primary" onClick={() => nav({ tab: "newrun" })}>+ New run</button>}>
          The {boot.counts.rules} seeded rules are ready at the gate, but no batch audit has run. Start one to score every table.
        </Empty>
      ) : (
        <>
          <div className="dq-grid">
            {ov.health.map((t) => {
              const delta = t.trend.length > 1 ? Math.round(t.score - t.trend[0]) : 0;
              const color = scoreColor(t.score);
              return (
                <button key={t.table} type="button" className="adm-stat" onClick={() => goIssues({ table: t.table, view: "open" })} title={`Open the Issues view filtered to ${t.label}`}>
                  <span className="adm-stat__label">{t.label}</span>
                  <span style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
                    <span className="adm-stat__value" style={{ color, lineHeight: 1 }}>{Math.round(t.score)}</span>
                    <Spark values={t.trend} color={color} />
                  </span>
                  <span style={{ height: 4, borderRadius: 2, background: "var(--asb-gray-100)", overflow: "hidden", display: "block" }}><span style={{ display: "block", height: "100%", width: `${t.score}%`, background: color }} /></span>
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 6 }} className="dq-muted num">
                    <span>{fmtInt(t.rows)} rows · {fmtInt(t.open)} open</span>
                    <span style={{ color: delta >= 0 ? "var(--asb-green)" : "var(--asb-red)", fontWeight: 600 }}>{t.trend.length > 1 ? `${delta >= 0 ? "+" : ""}${delta} / ${t.trend.length - 1} snapshots` : "first score"}</span>
                  </span>
                  <span className="dq-muted">{t.coverage} rules cover this table</span>
                </button>
              );
            })}
          </div>

          <div className="dq-two">
            <div className="adm-card">
              <div className="adm-card__head"><span className="adm-card__title">Open issues by severity</span><a href="#" className="adm-link" style={{ fontSize: 11 }} onClick={(e) => { e.preventDefault(); goIssues({ view: "open" }); }}>All issues →</a></div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 10 }}>
                {([["error", "Error", "Blocks the market", "var(--asb-red-bg)", "rejected", "blocks"], ["warn", "Warn", "Visible but allowed", "var(--asb-amber-bg)", "pending", "open"], ["info", "Info", "Advisory", "var(--asb-gray-100)", "draft", "open"]] as const).map(([k, label, note, bg, badge, view]) => (
                  <button key={k} type="button" className="dq-card-btn" style={{ background: bg }} onClick={() => goIssues({ view, severity: k })} title={`Open Issues filtered to ${label}`}>
                    <Badge cls={badge}>{label}</Badge>
                    <div className="num" style={{ fontSize: 27, fontWeight: 600, color: sevColor(k), letterSpacing: "-.02em", marginTop: 6, lineHeight: 1 }}>{fmtInt(ov.sev[k])}</div>
                    <div style={{ fontSize: 11, color: "var(--asb-ink-secondary)", marginTop: 4 }}>{note}</div>
                  </button>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="adm-card__title" style={{ marginBottom: 8 }}>Post-commit checks today</div>
                <div className="adm-bars">
                  {ov.checks.map((c) => (
                    <a key={c.label} href="#" className="adm-bar" style={{ color: "inherit", textDecoration: "none", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr) 44px" }} title={`Source: ${c.source}`} onClick={(e) => { e.preventDefault(); goIssues({ table: c.table, view: "open" }); }}>
                      <span className="adm-bar__lbl">{c.label}</span>
                      <span className="adm-bar__rail"><span className="adm-bar__fill" style={{ width: `${(c.n / maxCheck) * 100}%`, background: sevColor(c.severity) }} /></span>
                      <span className="adm-bar__num" style={{ color: "var(--asb-ink)", fontWeight: 600 }}>{fmtInt(c.n)}</span>
                    </a>
                  ))}
                </div>
              </div>
              {ov.noisyRules.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div className="adm-card__title" style={{ marginBottom: 6 }}>Noisy rules</div>
                  <div className="dq-muted">{ov.noisyRules.map((r) => <span key={r.code} style={{ marginRight: 10 }}><a href="#" className="adm-link" onClick={(e) => { e.preventDefault(); nav({ tab: "rules", rule: r.code }); }}>{r.code}</a> {r.fp} % false positives</span>)}</div>
                </div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div className="adm-card">
                <div className="adm-card__head"><span className="adm-card__title">What changed since last run</span><span className="adm-card__sub">{ov.lastRun ? `${ov.lastRun.code} · ${fmtDateTime(ov.lastRun.finished_at)}` : "—"}</span></div>
                {ov.changes.length === 0 ? <div className="dq-muted">Nothing new since the last run.</div> : (
                  <div className="adm-list">
                    {ov.changes.map((ch, i) => (
                      <div key={i} className="adm-list__row" style={{ padding: "8px 0" }}>
                        <span className={`adm-list__icon ${({ new: "is-red", fixed: "is-cargo", regressed: "is-amber", rule: "is-vessel" })[ch.kind]}`}>{({ new: "+", fixed: "✓", regressed: "↺", rule: "R" })[ch.kind]}</span>
                        <div className="adm-list__body"><div className="adm-list__title" style={{ fontWeight: 500 }}>{ch.title}</div><div className="adm-list__meta">{ch.meta}</div></div>
                        <a href="#" className="adm-link" style={{ fontSize: 11, whiteSpace: "nowrap" }} onClick={(e) => { e.preventDefault(); if (ch.kind === "rule" && ch.rule) nav({ tab: "rules", rule: ch.rule }); else goIssues({ table: ch.table ?? null, view: ch.view ?? "open", rule: ch.rule ?? null }); }}>View</a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="adm-card">
                <div className="adm-card__head"><span className="adm-card__title">AI suggestions waiting</span><a href="#" className="adm-link" style={{ fontSize: 11 }} onClick={(e) => { e.preventDefault(); nav({ tab: "ai" }); }}>Review queue →</a></div>
                <div style={{ display: "flex", gap: 10 }}>
                  {([["Proposed rules", ov.aiRules, "rules"], ["Proposed fixes", ov.aiFixes, "fixes"]] as const).map(([l, n, sub]) => (
                    <button key={l} type="button" className="dq-card-btn" style={{ flex: 1, background: "var(--asb-blue-light)" }} onClick={() => nav({ tab: "ai", sug: sub })}>
                      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".09em", textTransform: "uppercase", color: "var(--asb-steel)" }}>{l}</div>
                      <div className="num" style={{ fontSize: 21, fontWeight: 600, color: "var(--asb-navy)" }}>{n}</div>
                    </button>
                  ))}
                </div>
                <p className="dq-muted" style={{ margin: "10px 0 0" }}>The model never writes. Every acceptance is an admin action in the audit log.{boot.activeModel ? ` Model ${boot.activeModel.model}.` : " No active LLM key — add one in Data Sync → Settings."}</p>
              </div>
            </div>
          </div>
          <div className="dq-muted" style={{ display: "none" }}>{ov.health.map((h) => tableLabel(h.table)).join(", ")}</div>
        </>
      )}
    </section>
  );
}

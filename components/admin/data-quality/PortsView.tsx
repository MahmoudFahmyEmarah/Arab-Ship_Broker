"use client";

// Ports registry — UN/LOCODE release in use, refresh (CSV upload or URL),
// the drift report (ports vs unlocode_registry) and the exceptions list.
import * as React from "react";
import { getPortsRegistry, savePortException } from "@/app/(admin)/admin/data-quality/actions";
import type { DqDriftRow, DqPortException } from "@/lib/dq/types";
import { Badge, Loading, downloadText, fmtDateTime, fmtInt } from "./ui";
import { useConsole } from "./DataQualityConsole";

type Data = { settings: { registry_release: string | null; registry_imported_at: string | null }; drift: DqDriftRow[]; exceptions: DqPortException[]; stats: { ports: number; adopted: number; requested: number; absent: number; registry: number; registryCountries: number } };

export function PortsView() {
  const { canEdit, toast, confirm, refreshBoot } = useConsole();
  const [d, setD] = React.useState<Data | null>(null);
  const [refresh, setRefresh] = React.useState<{ release: string; url: string; all: boolean; file: File | null; busy: boolean } | null>(null);
  const [exc, setExc] = React.useState<{ locode: string; reason: string } | null>(null);
  const load = React.useCallback(async () => { const r = await getPortsRegistry(); if (r.success) setD(r.data); else toast(r.error); }, [toast]);
  React.useEffect(() => { load(); }, [load]);
  if (!d) return <Loading />;
  const stBadge = (s: string | null) => (s?.startsWith("A") ? "live" : s && /^R/.test(s) ? "pending" : "expired");
  const actBadge = (a: string) => (/^OK/.test(a) || a === "Updated" ? "live" : /pending/i.test(a) ? "pending" : /Needs|Request|Add|Set/.test(a) ? "closed" : "expired");
  const needAction = d.drift.filter((x) => !/^OK/.test(x.action) && x.action !== "Updated").length;

  const doRefresh = async () => {
    if (!refresh) return;
    setRefresh({ ...refresh, busy: true });
    try {
      let res: Response;
      if (refresh.file) { const fd = new FormData(); fd.set("file", refresh.file); fd.set("release", refresh.release); fd.set("all", String(refresh.all)); res = await fetch("/api/dq/registry", { method: "POST", body: fd }); }
      else res = await fetch("/api/dq/registry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: refresh.url, release: refresh.release, all: refresh.all }) });
      const j = (await res.json()) as { ok: boolean; rows?: number; error?: string; countries?: number | string };
      if (!j.ok) throw new Error(j.error ?? "Import failed");
      toast(`Registry ${refresh.release} imported — ${fmtInt(j.rows ?? 0)} rows (${j.countries === "all" ? "all countries" : `${j.countries} trading countries`}). Drift recomputed.`);
      setRefresh(null); await load(); refreshBoot();
    } catch (e) { toast(e instanceof Error ? e.message : "Import failed"); setRefresh({ ...refresh, busy: false }); }
  };

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="adm-stats" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <div className="adm-stat"><span className="adm-stat__label">Registry in use</span><span className="adm-stat__value" style={{ fontSize: 21 }}>{d.settings.registry_release ? `UN/LOCODE ${d.settings.registry_release}` : "none imported"}</span><span className="adm-stat__sub">{d.settings.registry_imported_at ? `UNECE code list · imported ${fmtDateTime(d.settings.registry_imported_at)} · ${fmtInt(d.stats.registry)} codes · ${d.stats.registryCountries} countries` : "the one-off enrichment (unlocode_status / function on ports) stands in until a release is imported"}</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Releases</span><span className="adm-stat__value" style={{ fontSize: 21 }}>2 per year</span><span className="adm-stat__sub">UNECE publishes CSV and the EC Interoperable Europe RDF export</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Ports rows</span><span className="adm-stat__value">{fmtInt(d.stats.ports)}</span><span className="adm-stat__sub">{d.stats.adopted} adopted · {d.stats.requested} requested (R*) · {d.stats.absent} absent</span></div>
        <div className="adm-stat"><span className="adm-stat__label">Drift items</span><span className={`adm-stat__value${needAction ? " is-amber" : ""}`}>{d.drift.length}</span><span className="adm-stat__sub">{needAction} need action · {d.exceptions.length} exceptions</span></div>
      </div>
      <div className="adm-card" style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 240, fontSize: 12, color: "var(--asb-ink-secondary)", lineHeight: 1.5 }}><strong style={{ color: "var(--asb-navy)" }}>Source of truth.</strong> Registry names are shown to members; our trade names stay as aliases. Every port row must exist in the registry; trading ports carry seaport function <strong>1</strong> or an approved exception; coordinates within 25 km; status adopted. Ranges and countries in circulars stay text at info level.</div>
        <button type="button" className="adm-btn" disabled={!canEdit} title="Imports a UNECE release into unlocode_registry; the drift report is recomputed live" onClick={() => setRefresh({ release: new Date().getFullYear() + "-" + (new Date().getMonth() < 6 ? "1" : "2"), url: "", all: false, file: null, busy: false })}>Refresh from release…</button>
        <button type="button" className="adm-btn" title="Download the drift report as CSV" onClick={() => downloadText("unlocode-drift.csv", ["locode,port,ours,registry,issue,status,action", ...d.drift.map((x) => [x.locode, x.port, x.ours, x.registry, x.issue, x.status, x.action].map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))].join("\n"), "text/csv")}>Export drift</button>
      </div>
      {refresh && (
        <div className="adm-card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="adm-card__title">Refresh from a UNECE release</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 10 }}>
            <div className="adm-field"><label className="adm-field__label">Release label</label><input className="adm-input" value={refresh.release} onChange={(e) => setRefresh({ ...refresh, release: e.target.value })} placeholder="2026-1" /></div>
            <div className="adm-field"><label className="adm-field__label">CSV file (UNECE code list part 1–3, or a headed export)</label><input type="file" accept=".csv,text/csv" onChange={(e) => setRefresh({ ...refresh, file: e.target.files?.[0] ?? null })} /></div>
            <div className="adm-field"><label className="adm-field__label">…or a https URL to the CSV</label><input className="adm-input" value={refresh.url} onChange={(e) => setRefresh({ ...refresh, url: e.target.value })} placeholder="https://…/loc261csv.csv" /></div>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={refresh.all} onChange={(e) => setRefresh({ ...refresh, all: e.target.checked })} />Import every country (≈110k rows). Default: only the countries present in our ports table.</label>
          <div style={{ display: "flex", gap: 6 }}><button type="button" className="adm-btn primary" disabled={refresh.busy || (!refresh.file && !refresh.url)} onClick={doRefresh}>{refresh.busy ? "Importing…" : "Import"}</button><button type="button" className="adm-btn ghost" onClick={() => setRefresh(null)}>Cancel</button><span className="dq-muted" style={{ alignSelf: "center" }}>Previous releases stay in unlocode_registry keyed by code; the drift report always compares against the latest import.</span></div>
        </div>
      )}
      <div className="adm-table">
        <div className="dq-group-head"><strong>Drift report</strong><span>ports vs unlocode_registry{d.settings.registry_release ? ` · release ${d.settings.registry_release}` : " · registry empty: only function/exception checks apply"}</span></div>
        <div style={{ overflowX: "auto" }}><table style={{ minWidth: 860 }}><thead><tr><th>LOCODE</th><th>Port</th><th>Ours</th><th>Registry</th><th>Drift</th><th>Status</th><th>Action</th></tr></thead><tbody>
          {d.drift.length === 0 && <tr className="no-hover"><td colSpan={7} style={{ textAlign: "center", padding: 26, color: "var(--asb-gray-500)" }}>No drift — every port agrees with the registry.</td></tr>}
          {d.drift.map((x, i) => <tr key={`${x.locode}-${i}`} className="no-hover"><td className="mono" style={{ color: "var(--asb-navy)", fontWeight: 600 }}>{x.locode}</td><td>{x.port ?? "—"}</td><td>{x.ours ?? "—"}</td><td>{x.registry ?? "—"}</td><td style={{ color: "var(--asb-ink-secondary)" }}>{x.issue}</td><td><Badge cls={stBadge(x.status)}>{x.status ?? "—"}</Badge></td><td><span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}><Badge cls={actBadge(x.action)}>{x.action}</Badge>{/exception/i.test(x.action) && canEdit && <button type="button" className="adm-btn small ghost" onClick={() => setExc({ locode: x.locode, reason: "" })}>+ Exception</button>}</span></td></tr>)}
        </tbody></table></div>
      </div>
      <div className="adm-table">
        <div className="dq-group-head"><strong>Exceptions</strong><span>trading ports without seaport function 1 — each needs a reason and an approver</span><button type="button" className="adm-btn small" style={{ marginLeft: "auto" }} disabled={!canEdit} onClick={() => setExc({ locode: "", reason: "" })}>+ Exception</button></div>
        <div style={{ overflowX: "auto" }}><table style={{ minWidth: 720 }}><thead><tr><th>LOCODE</th><th>Reason</th><th>Requested by</th><th>On</th><th>Status</th><th /></tr></thead><tbody>
          {d.exceptions.length === 0 && <tr className="no-hover"><td colSpan={6} style={{ textAlign: "center", padding: 22, color: "var(--asb-gray-500)" }}>No exceptions.</td></tr>}
          {d.exceptions.map((e) => <tr key={e.locode} className="no-hover"><td className="mono" style={{ color: "var(--asb-navy)", fontWeight: 600 }}>{e.locode}</td><td style={{ maxWidth: 360 }}>{e.reason}</td><td>{e.requested_by_name ?? "—"}{e.approved_by_name ? ` · ${e.status} by ${e.approved_by_name}` : ""}</td><td>{fmtDateTime(e.requested_at)}</td><td><Badge cls={e.status === "approved" ? "live" : e.status === "pending" ? "pending" : "expired"}>{e.status}</Badge></td><td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{e.status === "pending" && <><button type="button" className="adm-btn small approve" disabled={!canEdit} onClick={() => confirm({ title: `Approve exception for ${e.locode}?`, label: "Approve", body: `DQ-R02 stops firing for ${e.locode}. Reason: ${e.reason}`, undo: "Reject it again from this table.", run: async () => { const r = await savePortException(e.locode, e.reason, "approve"); if (!r.success) { toast(r.error); return; } await load(); toast(`Exception for ${e.locode} approved — DQ-R02 no longer fires for it.`); } })}>Approve</button> <button type="button" className="adm-btn small ghost" disabled={!canEdit} onClick={async () => { const r = await savePortException(e.locode, e.reason, "reject"); if (!r.success) { toast(r.error); return; } await load(); }}>Reject</button></>}</td></tr>)}
        </tbody></table></div>
      </div>
      {exc && (
        <div className="dq-confirm" onMouseDown={(e) => { if (e.target === e.currentTarget) setExc(null); }}>
          <div className="adm-card" role="dialog" aria-modal="true" style={{ width: "min(440px,100%)", padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: "var(--asb-navy)" }}>Request a seaport exception</div>
            <div className="adm-field"><label className="adm-field__label">LOCODE</label><input className="adm-input" value={exc.locode} onChange={(e) => setExc({ ...exc, locode: e.target.value.toUpperCase() })} placeholder="SARAR" /></div>
            <div className="adm-field"><label className="adm-field__label">Reason</label><textarea className="adm-textarea" rows={3} value={exc.reason} onChange={(e) => setExc({ ...exc, reason: e.target.value })} placeholder="Industrial seaport operated by …; registry function not yet updated." /></div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}><button type="button" className="adm-btn" onClick={() => setExc(null)}>Cancel</button><button type="button" className="adm-btn primary" disabled={!exc.locode || !exc.reason.trim()} onClick={async () => { const r = await savePortException(exc.locode, exc.reason, "request"); setExc(null); if (!r.success) { toast(r.error); return; } await load(); toast(`Exception for ${exc.locode} requested — pending approval.`); }}>Request</button></div>
          </div>
        </div>
      )}
    </section>
  );
}

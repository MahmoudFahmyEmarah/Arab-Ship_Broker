"use client";

// History → Audit trail. Who did what, when, to what — read from
// public.data_sync_audit (written by every mutating action and route in the
// module). Filter by family, actor, free text and date; export the current
// view as CSV. Read-only by construction: nothing here can change history.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, RefreshCcw } from "lucide-react";
import { listDataSyncAudit } from "@/app/(admin)/admin/data-sync/actions";
import { AUDIT_FAMILIES, type AuditRow } from "@/lib/admin/data-sync-audit";
import { Badge, Btn, Card, Seg, relTime, utcShort, C } from "./ui";

const PAGE = 100;

export function AuditTrail({ onOpenBatch }: { onOpenBatch: (batchId: string) => void }) {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [actors, setActors] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [family, setFamily] = useState<string>("all");
  const [actor, setActor] = useState<string>("all");
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [more, setMore] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => { const id = setTimeout(() => setDebounced(q), 300); return () => clearTimeout(id); }, [q]);

  const load = useCallback(async (append = false, before?: number) => {
    setLoading(true);
    const r = await listDataSyncAudit({
      family: family === "all" ? null : family,
      actorId: actor === "all" ? null : actor,
      q: debounced || null,
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
      limit: PAGE,
      beforeId: before ?? null,
    });
    setLoading(false);
    if (!r.success) { toast.error(r.error); return; }
    setRows((prev) => (append ? [...prev, ...r.data.rows] : r.data.rows));
    setActors(r.data.actors);
    setMore(r.data.rows.length === PAGE);
  }, [family, actor, debounced, from, to]);

  useEffect(() => {
    let cancelled = false;
    (async () => { await Promise.resolve(); if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);

  const csv = useMemo(() => {
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const head = ["at_utc", "actor", "kind", "action", "target_kind", "target_id", "batch_id", "ok", "summary", "detail"].join(",");
    const body = rows.map((r) => [r.at, r.actor_name ?? "", r.actor_kind, r.action, r.target_kind ?? "", r.target_id ?? "", r.batch_id ?? "", r.ok ? "ok" : "failed", r.summary, JSON.stringify(r.detail)].map(esc).join(","));
    return [head, ...body].join("\n");
  }, [rows]);

  const exportCsv = () => {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `data-sync-audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const familyOf = (action: string) => action.split(".")[0];

  return (
    <div className="ds-stack">
      <div className="ds-row">
        <Seg
          value={family} onChange={setFamily}
          options={[{ value: "all", label: "Everything" }, ...AUDIT_FAMILIES.map((f) => ({ value: f.id, label: f.label }))]}
        />
        <select className="ds-input" style={{ width: "auto" }} value={actor} onChange={(e) => setActor(e.target.value)} aria-label="Actor">
          <option value="all">Everyone</option>
          <option value="system">Cron / webhook</option>
          {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <input className="ds-input" style={{ width: 220 }} placeholder="Search summary / target…" value={q} onChange={(e) => setQ(e.target.value)} />
        <input className="ds-input" style={{ width: "auto" }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From" />
        <input className="ds-input" style={{ width: "auto" }} type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" />
        <div className="ds-push" style={{ display: "flex", gap: 8 }}>
          <Btn size="sm" kind="ghost" icon={<RefreshCcw size={13} />} onClick={() => load()}>Refresh</Btn>
          <Btn size="sm" icon={<Download size={13} />} disabled={rows.length === 0} onClick={exportCsv}>Export CSV ({rows.length})</Btn>
        </div>
      </div>

      {loading && rows.length === 0 ? (
        <div className="ds-empty"><Loader2 size={20} className="ds-spin" /></div>
      ) : rows.length === 0 ? (
        <Card><div className="ds-empty">No audit entries match these filters.</div></Card>
      ) : (
        <Card flush>
          <div className="ds-scroll-x">
            <table className="ds-table ds-table--dense ds-table--rows">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Action</th>
                  <th>What</th>
                  <th>Target</th>
                  <th style={{ width: 70 }}>Result</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <tr onClick={() => setOpen(open === r.id ? null : r.id)} title="Click for detail">
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div style={{ fontSize: 13 }}>{relTime(r.at)}</div>
                        <div className="ds-table__meta">{utcShort(r.at)}</div>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <div className="ds-table__name">{r.actor_name ?? (r.actor_kind === "cron" ? "Cron" : r.actor_kind === "webhook" ? "Webhook" : "System")}</div>
                        {r.actor_kind !== "admin" && <div className="ds-table__meta">{r.actor_kind}</div>}
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>
                        <Badge tone={r.ok ? (familyOf(r.action) === "settings" ? "info" : "neutral") : "invalid"}>{r.action}</Badge>
                      </td>
                      <td style={{ minWidth: 260 }}>{r.summary}</td>
                      <td className="ds-table__meta" style={{ whiteSpace: "nowrap" }}>
                        {r.batch_id ? (
                          <button type="button" onClick={(e) => { e.stopPropagation(); onOpenBatch(r.batch_id!); }}
                            style={{ border: 0, background: "transparent", cursor: "pointer", font: "inherit", color: C.blue, padding: 0 }}>
                            batch {r.batch_id.slice(0, 8)}
                          </button>
                        ) : r.target_id ? `${r.target_kind ?? ""} ${r.target_id}`.trim().slice(0, 40) : "—"}
                      </td>
                      <td><Badge tone={r.ok ? "new" : "invalid"}>{r.ok ? "ok" : "failed"}</Badge></td>
                    </tr>
                    {open === r.id && (
                      <tr>
                        <td colSpan={6} style={{ background: C.sunken }}>
                          <pre style={{ margin: 0, fontFamily: C.mono, fontSize: 12, whiteSpace: "pre-wrap", color: C.ink }}>
                            {JSON.stringify({ id: r.id, at: r.at, actor_id: r.actor_id, ip: r.ip, target_kind: r.target_kind, target_id: r.target_id, detail: r.detail }, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {more && (
            <div style={{ padding: "9px 14px", borderTop: "1px solid var(--ccx-line2)" }}>
              <Btn size="sm" busy={loading} onClick={() => load(true, rows[rows.length - 1]?.id)}>Load older</Btn>
            </div>
          )}
        </Card>
      )}
      <div className="ds-note">
        Written server-side by every Data Sync action and route; nobody can edit or delete an entry. IP and browser are kept for 24 months.
      </div>
    </div>
  );
}

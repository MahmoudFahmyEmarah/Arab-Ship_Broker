"use client";

// Database Preview — browse the live tables, edit one or many records, delete,
// and undo. Every mutation goes through the audited RPCs (record_edit_audit),
// so nothing here is unrecoverable. Server-paginated: the browser only ever
// holds one page of rows.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Search, Loader2, Pencil, Trash2, Check, X, RotateCcw, History, ChevronLeft, ChevronRight, Database,
} from "lucide-react";
import {
  PREVIEW_TABLES, previewTable, coerce, type PreviewCol, type PreviewTable,
} from "@/lib/sync/preview";
import {
  listRecords, editRecord, bulkEditRecords, deleteRecord, undoEdit, listEditAudit,
  type PreviewRow, type EditAuditRow,
} from "@/app/(admin)/admin/data-sync/actions";
import { C, btn, cell } from "./ui";

const PAGE = 50;

export function PreviewView() {
  const [tableId, setTableId] = useState<string>(PREVIEW_TABLES[0].id);
  const t = previewTable(tableId) as PreviewTable;

  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<PreviewRow | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  // debounce the search box
  useEffect(() => {
    const id = setTimeout(() => setDebounced(search), 300);
    return () => clearTimeout(id);
  }, [search]);

  // reset paging + selection whenever the table or query changes (deferred off
  // the effect's synchronous phase to avoid a cascading re-render)
  useEffect(() => {
    let cancelled = false;
    (async () => { await Promise.resolve(); if (!cancelled) { setOffset(0); setSelected(new Set()); } })();
    return () => { cancelled = true; };
  }, [tableId, debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await listRecords(tableId, { search: debounced, limit: PAGE, offset });
    setLoading(false);
    if (!res.success) { toast.error(res.error); setRows([]); setTotal(0); return; }
    setRows(res.data.rows);
    setTotal(res.data.total);
  }, [tableId, debounced, offset]);

  useEffect(() => {
    let cancelled = false;
    (async () => { await Promise.resolve(); if (!cancelled) await load(); })();
    return () => { cancelled = true; };
  }, [load]);

  const allOnPageSelected = rows.length > 0 && rows.every((r) => selected.has(r.key));
  const toggleAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) rows.forEach((r) => next.delete(r.key));
      else rows.forEach((r) => next.add(r.key));
      return next;
    });
  };
  const toggleOne = (key: string) =>
    setSelected((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const doDelete = async (key: string) => {
    if (!confirm(`Delete ${t.label.slice(0, -1)} "${key}"? It is recoverable from Recent edits.`)) return;
    setBusyKey(key);
    const r = await deleteRecord(tableId, key);
    setBusyKey(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Deleted ${key} — undo from Recent edits.`);
    setSelected((p) => { const n = new Set(p); n.delete(key); return n; });
    await load();
  };

  return (
    <div>
      {/* table selector */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {PREVIEW_TABLES.map((pt) => {
          const on = pt.id === tableId;
          return (
            <button key={pt.id} onClick={() => setTableId(pt.id)}
              style={{ padding: "7px 13px", borderRadius: 7, border: `1px solid ${on ? C.brass : C.line}`,
                background: on ? C.brassBg : "#fff", color: on ? C.brassDeep : C.ink2, cursor: "pointer",
                font: "inherit", fontSize: 13, fontWeight: on ? 600 : 500 }}>
              {pt.label}
            </button>
          );
        })}
        <button onClick={() => setHistoryOpen(true)} style={{ ...btn("ghost"), marginLeft: "auto" }}>
          <History size={14} /> Recent edits
        </button>
      </div>

      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: "1 1 260px", maxWidth: 360 }}>
          <Search size={15} color={C.ink3} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)" }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${t.searchCols.join(" / ")}…`}
            style={{ width: "100%", padding: "9px 12px 9px 34px", borderRadius: 8, border: `1px solid ${C.line}`,
              font: "inherit", fontSize: 13.5, color: C.ink, background: "#fff" }} />
        </div>
        <div style={{ fontSize: 12.5, color: C.ink3, fontFamily: C.mono }}>→ {t.table}</div>
      </div>

      {/* bulk action bar */}
      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", marginBottom: 12,
          background: C.brassBg, border: `1px solid ${C.brass}`, borderRadius: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.brassDeep }}>{selected.size} selected</span>
          <button onClick={() => setBulkOpen(true)} style={btn("dark")}><Pencil size={14} /> Edit a field on all</button>
          <button onClick={() => setSelected(new Set())} style={{ ...btn("ghost"), marginLeft: "auto" }}>Clear</button>
        </div>
      )}

      {/* grid */}
      <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", background: "#fff" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={{ ...THL, width: 38, textAlign: "center" }}>
                  <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} aria-label="Select all on page" />
                </th>
                {t.columns.map((c) => (
                  <th key={c.col} style={{ ...THL, width: c.w }}>{c.label}</th>
                ))}
                <th style={{ ...THL, width: 84, textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={t.columns.length + 2} style={{ padding: 40, textAlign: "center", color: C.ink3 }}>
                  <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
                </td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={t.columns.length + 2} style={{ padding: "44px 20px", textAlign: "center", color: C.ink3, fontSize: 14 }}>
                  {debounced ? "No records match your search." : "No records in this table yet."}
                </td></tr>
              ) : rows.map((r) => {
                const sel = selected.has(r.key);
                return (
                  <tr key={r.key} style={{ background: sel ? "#fffdf6" : "#fff" }}>
                    <td style={{ ...TDL, textAlign: "center" }}>
                      <input type="checkbox" checked={sel} onChange={() => toggleOne(r.key)} aria-label={`Select ${r.key}`} />
                    </td>
                    {t.columns.map((c) => (
                      <td key={c.col} style={{ ...TDL, ...(c.editable === false ? { fontFamily: C.mono, fontWeight: 600, color: C.navy } : {}) }}>
                        {cell(r.data[c.col])}
                      </td>
                    ))}
                    <td style={{ ...TDL, textAlign: "right", whiteSpace: "nowrap" }}>
                      <button onClick={() => setEditing(r)} title="Edit" style={ICON}><Pencil size={15} /></button>
                      <button onClick={() => doDelete(r.key)} disabled={busyKey === r.key} title="Delete" style={{ ...ICON, color: C.red }}>
                        {busyKey === r.key ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Trash2 size={15} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* pager */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderTop: `1px solid ${C.line}`, fontSize: 12.5, color: C.ink3 }}>
          <span><Database size={13} style={{ verticalAlign: "-2px" }} /> {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`} of {total}</span>
          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            <button onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={offset === 0 || loading}
              style={{ ...btn("ghost"), padding: "6px 10px", opacity: offset === 0 ? 0.4 : 1 }}><ChevronLeft size={14} /></button>
            <button onClick={() => setOffset((o) => o + PAGE)} disabled={offset + PAGE >= total || loading}
              style={{ ...btn("ghost"), padding: "6px 10px", opacity: offset + PAGE >= total ? 0.4 : 1 }}><ChevronRight size={14} /></button>
          </div>
        </div>
      </div>

      {editing && (
        <EditDrawer table={t} row={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {bulkOpen && (
        <BulkDrawer table={t} keys={Array.from(selected)} onClose={() => setBulkOpen(false)}
          onDone={async () => { setBulkOpen(false); setSelected(new Set()); await load(); }} />
      )}
      {historyOpen && <HistoryDrawer onClose={() => setHistoryOpen(false)} onUndone={load} />}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── one editable field control ──────────────────────────────────────────────
function FieldInput({ col, value, onChange }: { col: PreviewCol; value: unknown; onChange: (v: unknown) => void }) {
  const base: React.CSSProperties = {
    width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`,
    font: "inherit", fontSize: 13.5, color: C.ink, background: "#fff",
  };
  if (col.type === "bool") {
    return (
      <select value={value === true ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")} style={base}>
        <option value="true">yes</option>
        <option value="false">no</option>
      </select>
    );
  }
  if (col.type === "enum") {
    return (
      <select value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} style={base}>
        {col.nullable && <option value="">—</option>}
        {col.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const inputType = col.type === "int" || col.type === "num" ? "number" : col.type === "date" ? "date" : "text";
  return (
    <input type={inputType} value={value == null ? "" : String(value)}
      step={col.type === "num" ? "any" : undefined}
      onChange={(e) => onChange(e.target.value)} style={base} />
  );
}

// ── single-record edit drawer ───────────────────────────────────────────────
function EditDrawer({ table, row, onClose, onSaved }: {
  table: PreviewTable; row: PreviewRow; onClose: () => void; onSaved: () => void;
}) {
  const editable = table.columns.filter((c) => c.editable !== false);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const d: Record<string, unknown> = {};
    for (const c of editable) d[c.col] = row.data[c.col] ?? (c.type === "bool" ? false : "");
    return d;
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const patch: Record<string, unknown> = {};
    for (const c of editable) {
      const next = coerce(c.type, draft[c.col]);
      const orig = row.data[c.col] ?? null;
      const origNorm = c.type === "bool" ? orig === true : orig;
      if (JSON.stringify(next) !== JSON.stringify(origNorm ?? null)) patch[c.col] = next;
    }
    if (Object.keys(patch).length === 0) { toast("No changes to save."); return; }
    setSaving(true);
    const r = await editRecord(table.id, row.key, patch);
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Saved ${row.key} · ${Object.keys(patch).length} field${Object.keys(patch).length > 1 ? "s" : ""} updated.`);
    onSaved();
  };

  return (
    <Drawer title={`Edit ${row.key}`} subtitle={`→ ${table.table}`} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {editable.map((c) => (
          <label key={c.col} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>{c.label}</span>
            <FieldInput col={c} value={draft[c.col]} onChange={(v) => setDraft((d) => ({ ...d, [c.col]: v }))} />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button onClick={save} disabled={saving} style={btn("primary")}>
          {saving ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />} Save changes
        </button>
        <button onClick={onClose} style={btn("ghost")}>Cancel</button>
      </div>
    </Drawer>
  );
}

// ── bulk field-set drawer ───────────────────────────────────────────────────
function BulkDrawer({ table, keys, onClose, onDone }: {
  table: PreviewTable; keys: string[]; onClose: () => void; onDone: () => void;
}) {
  const editable = table.columns.filter((c) => c.editable !== false);
  const [colId, setColId] = useState(editable[0].col);
  const col = editable.find((c) => c.col === colId) as PreviewCol;
  const [value, setValue] = useState<unknown>(col.type === "bool" ? false : "");
  const [saving, setSaving] = useState(false);

  const apply = async () => {
    setSaving(true);
    const r = await bulkEditRecords(table.id, keys, { [colId]: coerce(col.type, value) });
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Set ${col.label} on ${r.data.updated} record${r.data.updated > 1 ? "s" : ""} — undo as one group from Recent edits.`);
    onDone();
  };

  return (
    <Drawer title={`Edit ${keys.length} records`} subtitle={`→ ${table.table}`} onClose={onClose}>
      <p style={{ fontSize: 13, color: C.ink2, marginTop: 0, marginBottom: 18, lineHeight: 1.5 }}>
        Choose one field and a value to apply to all {keys.length} selected records. This is recorded as a single
        group so you can undo the whole action at once.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>Field</span>
          <select value={colId} onChange={(e) => { setColId(e.target.value); const nc = editable.find((c) => c.col === e.target.value)!; setValue(nc.type === "bool" ? false : ""); }}
            style={{ padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`, font: "inherit", fontSize: 13.5, background: "#fff" }}>
            {editable.map((c) => <option key={c.col} value={c.col}>{c.label}</option>)}
          </select>
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>New value</span>
          <FieldInput col={col} value={value} onChange={setValue} />
        </label>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button onClick={apply} disabled={saving} style={btn("primary")}>
          {saving ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />} Apply to {keys.length}
        </button>
        <button onClick={onClose} style={btn("ghost")}>Cancel</button>
      </div>
    </Drawer>
  );
}

// ── recent-edits history + undo ─────────────────────────────────────────────
function HistoryDrawer({ onClose, onUndone }: { onClose: () => void; onUndone: () => void }) {
  const [rows, setRows] = useState<EditAuditRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const res = await listEditAudit(20);
    setRows(res.success ? res.data : []);
    if (!res.success) toast.error(res.error);
  }, []);
  useEffect(() => { let c = false; (async () => { await Promise.resolve(); if (!c) await reload(); })(); return () => { c = true; }; }, [reload]);

  const undo = async (r: EditAuditRow) => {
    setBusy(r.id);
    const res = r.group_id ? await undoEdit({ groupId: r.group_id }) : await undoEdit({ auditId: r.id });
    setBusy(null);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Reverted · ${res.data.restored} restored · ${res.data.reinserted} re-inserted`);
    await reload();
    onUndone();
  };

  return (
    <Drawer title="Recent edits" subtitle="Undo any direct edit or delete" onClose={onClose}>
      {rows === null ? (
        <div style={{ padding: 30, textAlign: "center", color: C.ink3 }}><Loader2 size={18} style={{ animation: "spin 1s linear infinite" }} /></div>
      ) : rows.length === 0 ? (
        <div style={{ padding: "24px 4px", color: C.ink3, fontSize: 13.5 }}>No direct edits recorded yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {rows.map((r, i) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 2px", borderTop: i ? `1px solid ${C.line}` : "none" }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", padding: "2px 6px", borderRadius: 3,
                color: r.op === "delete" ? C.red : C.amber, background: r.op === "delete" ? C.redBg : C.amberBg }}>
                {r.op === "delete" ? "DEL" : "UPD"}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: C.navy, fontWeight: 600, fontFamily: C.mono }}>
                  {r.business_key}
                  {r.group_id && <span style={{ marginLeft: 6, fontSize: 11, color: C.brassDeep, fontFamily: "inherit" }}>· bulk</span>}
                </div>
                <div style={{ fontSize: 11.5, color: C.ink3 }}>{r.table_name} · {new Date(r.edited_at).toLocaleString()}</div>
              </div>
              {r.undone ? (
                <span style={{ fontSize: 11.5, color: C.ink3, display: "inline-flex", alignItems: "center", gap: 4 }}><Check size={13} /> undone</span>
              ) : (
                <button onClick={() => undo(r)} disabled={busy === r.id} style={btn("danger")}>
                  {busy === r.id ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={13} />} Undo
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}

// ── shared right-side drawer shell ──────────────────────────────────────────
function Drawer({ title, subtitle, onClose, children }: {
  title: string; subtitle?: string; onClose: () => void; children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div onMouseDown={(e) => { if (e.target === ref.current) onClose(); }} ref={ref}
      style={{ position: "fixed", inset: 0, background: "rgba(10,26,47,.34)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "min(560px, 94vw)", height: "100%", background: "#fff", boxShadow: "-8px 0 32px rgba(0,0,0,.18)",
        display: "flex", flexDirection: "column", animation: "slideIn .16s ease-out" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "18px 22px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: C.navy }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: C.ink3, fontFamily: C.mono, marginTop: 2 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} style={{ ...ICON, color: C.ink2 }} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ padding: "20px 22px", overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
      <style>{`@keyframes slideIn{from{transform:translateX(24px);opacity:.6}to{transform:translateX(0);opacity:1}}`}</style>
    </div>
  );
}

const THL: React.CSSProperties = {
  textAlign: "left", padding: "9px 12px", fontSize: 11, fontWeight: 600, letterSpacing: ".03em",
  textTransform: "uppercase", color: C.ink3, background: "#fafbfc", borderBottom: `1px solid ${C.line}`,
  whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1,
};
const TDL: React.CSSProperties = {
  padding: "8px 12px", borderBottom: `1px solid ${C.line}`, fontSize: 13, color: C.ink, whiteSpace: "nowrap",
  maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
};
const ICON: React.CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: 5, color: C.ink2,
  display: "inline-flex", alignItems: "center", borderRadius: 6,
};

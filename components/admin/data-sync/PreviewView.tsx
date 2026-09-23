"use client";

// Database — browse the live tables, edit one or many records, delete, and undo.
// Every mutation goes through the audited RPCs (record_edit_audit), so nothing
// here is unrecoverable. Server-paginated: the browser only ever holds one page
// of rows.
//
// The design's layout: a table rail on the left, the grid on the right. Only
// the active table's row count is fetched — counting all ten on every render
// would be ten queries for a number nobody reads.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Search, Loader2, Pencil, Trash2, Check, X, RotateCcw, History, ChevronLeft, ChevronRight, Database, Plus,
} from "lucide-react";
import {
  PREVIEW_TABLES, previewTable, coerce, type PreviewCol, type PreviewTable,
} from "@/lib/sync/preview";
import {
  listRecords, editRecord, bulkEditRecords, deleteRecord, bulkDeleteRecords, insertRecord, undoEdit, listEditAudit,
  type PreviewRow, type EditAuditRow,
} from "@/app/(admin)/admin/data-sync/actions";
import { Btn, Card, Chip, SectionLabel, C, btn, cell } from "./ui";
import { describeUndoConflicts } from "@/lib/sync/batch-status";

// Saved views are a per-viewer convenience (name → search string, per table),
// kept in localStorage — nothing server-side, nothing shared.
type SavedView = { name: string; search: string };
const viewsKey = (tableId: string) => `ds:views:${tableId}`;
const readViews = (tableId: string): SavedView[] => { try { return JSON.parse(localStorage.getItem(viewsKey(tableId)) ?? "[]") as SavedView[]; } catch { return []; } };
const writeViews = (tableId: string, v: SavedView[]) => { try { localStorage.setItem(viewsKey(tableId), JSON.stringify(v.slice(0, 12))); } catch { /* private mode */ } };

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
  const [adding, setAdding] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [views, setViews] = useState<SavedView[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => { await Promise.resolve(); if (!cancelled) setViews(readViews(tableId)); })();
    return () => { cancelled = true; };
  }, [tableId]);
  const saveView = () => {
    const name = prompt("Name this view", search.slice(0, 30) || t.label)?.trim();
    if (!name) return;
    const next = [{ name, search }, ...views.filter((v) => v.name !== name)];
    setViews(next); writeViews(tableId, next);
  };
  const removeView = (name: string) => { const next = views.filter((v) => v.name !== name); setViews(next); writeViews(tableId, next); };

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

  const doBulkDelete = async () => {
    const keys = Array.from(selected);
    if (!confirm(`Delete ${keys.length} selected record${keys.length > 1 ? "s" : ""} from ${t.table}? The whole group is recoverable from Recent edits in one click.`)) return;
    setBulkDeleting(true);
    const r = await bulkDeleteRecords(tableId, keys);
    setBulkDeleting(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Deleted ${r.data.deleted} record${r.data.deleted > 1 ? "s" : ""} — undo the whole group from Recent edits.`);
    setSelected(new Set());
    await load();
  };

  return (
    <div className="ds-dbsplit">
      {/* ── table rail ─────────────────────────────────────────────────── */}
      <div>
        <div className="ds-rail__head">Live tables</div>
        <div className="ds-rail">
          {PREVIEW_TABLES.map((pt) => (
            <button
              key={pt.id} type="button" onClick={() => setTableId(pt.id)}
              className={`ds-rail__item${pt.id === tableId ? " is-active" : ""}`}
              title={`→ ${pt.table}`}
            >
              <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{pt.label}</span>
              {pt.id === tableId && <span className="ds-rail__count">{total.toLocaleString()}</span>}
            </button>
          ))}
        </div>
        <div style={{ marginTop: 10 }}>
          <Btn size="sm" kind="ghost" icon={<History size={14} />} onClick={() => setHistoryOpen(true)}>
            Recent edits
          </Btn>
        </div>
      </div>

      {/* ── grid ───────────────────────────────────────────────────────── */}
      <div className="ds-stack" style={{ gap: 12 }}>
        <div className="ds-row">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: C.navy }}>{t.label}</div>
            <div className="ds-rowsub">→ {t.table}</div>
          </div>
          <div className="ds-push" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", flex: "1 1 220px", minWidth: 200 }}>
              <Search size={15} color={C.ink3} style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)" }} />
              <input
                className="ds-input" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder={`Search ${t.searchCols.join(" / ")}…`}
                style={{ paddingLeft: 32 }}
              />
            </div>
            {t.insertable !== false && (
              <Btn kind="primary" icon={<Plus size={15} />} onClick={() => setAdding(true)}>Add record</Btn>
            )}
          </div>
        </div>

        {/* saved views */}
        <div className="ds-row">
          <SectionLabel>Saved views</SectionLabel>
          <Chip active={!search} onClick={() => setSearch("")}>All rows</Chip>
          {views.map((v) => (
            <Chip key={v.name} active={search === v.search && !!search} onClick={() => setSearch(v.search)} title={`Search: ${v.search || "(none)"}`}
              icon={<span role="button" aria-label={`Remove view ${v.name}`} onClick={(e) => { e.stopPropagation(); removeView(v.name); }} style={{ color: C.ink3, marginLeft: 2 }}>✕</span>}>
              {v.name}
            </Chip>
          ))}
          {search && <Btn size="sm" kind="ghost" onClick={saveView}>Save current search</Btn>}
        </div>

        {/* bulk action bar */}
        {selected.size > 0 && (
          <div className="ds-selbar">
            <span className="ds-selbar__n">
              {selected.size} selected · one transaction, one undo group
            </span>
            <Btn kind="accent" icon={<Pencil size={14} />} onClick={() => setBulkOpen(true)}>Bulk field edit</Btn>
            <Btn kind="danger" icon={<Trash2 size={14} />} busy={bulkDeleting} onClick={doBulkDelete}>Delete selected</Btn>
            <Btn kind="ghost" className="ds-push" onClick={() => setSelected(new Set())}>Clear</Btn>
          </div>
        )}

        <Card flush>
          <div className="ds-scroll-x">
            <table className="ds-table ds-table--dense" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th style={{ width: 38, textAlign: "center" }}>
                    <input type="checkbox" checked={allOnPageSelected} onChange={toggleAll} aria-label="Select all on page" />
                  </th>
                  {t.columns.map((c) => (
                    <th key={c.col} style={{ width: c.w }}>
                      {c.label}{c.editable === false ? " ·" : ""}
                    </th>
                  ))}
                  <th style={{ width: 84, textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={t.columns.length + 2} className="ds-empty">
                    <Loader2 size={20} className="ds-spin" />
                  </td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={t.columns.length + 2} className="ds-empty">
                    {debounced ? "No records match your search." : "No records in this table yet."}
                  </td></tr>
                ) : rows.map((r) => {
                  const sel = selected.has(r.key);
                  return (
                    <tr key={r.key} style={{ background: sel ? C.brassBg : undefined }}>
                      <td style={{ textAlign: "center" }}>
                        <input type="checkbox" checked={sel} onChange={() => toggleOne(r.key)} aria-label={`Select ${r.key}`} />
                      </td>
                      {t.columns.map((c) => (
                        <td key={c.col} style={c.editable === false ? { fontFamily: C.mono, fontWeight: 600, color: C.navy } : undefined}>
                          {cell(r.data[c.col])}
                        </td>
                      ))}
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <button type="button" onClick={() => setEditing(r)} title="Edit" style={ICON}><Pencil size={15} /></button>
                        <button type="button" onClick={() => doDelete(r.key)} disabled={busyKey === r.key} title="Delete" style={{ ...ICON, color: C.red }}>
                          {busyKey === r.key ? <Loader2 size={15} className="ds-spin" /> : <Trash2 size={15} />}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* pager */}
          <div className="ds-row" style={{ padding: "9px 14px", borderTop: "1px solid var(--ccx-line2)", fontSize: 12.5, color: C.ink3 }}>
            <span>
              <Database size={13} style={{ verticalAlign: "-2px" }} />{" "}
              {total === 0 ? "0" : `${offset + 1}–${Math.min(offset + PAGE, total)}`} of {total.toLocaleString()}
            </span>
            <div className="ds-push" style={{ display: "flex", gap: 6 }}>
              <Btn size="sm" disabled={offset === 0 || loading} aria-label="Previous page"
                onClick={() => setOffset((o) => Math.max(0, o - PAGE))}><ChevronLeft size={14} /></Btn>
              <Btn size="sm" disabled={offset + PAGE >= total || loading} aria-label="Next page"
                onClick={() => setOffset((o) => o + PAGE)}><ChevronRight size={14} /></Btn>
            </div>
          </div>
        </Card>

        <div className="ds-row" style={{ justifyContent: "space-between" }}>
          <span className="ds-note">Server-paged · {PAGE} rows · search runs in the database</span>
          <span className="ds-note">Deletes are FK-protected — retire a row instead of deleting it where the table allows</span>
        </div>
      </div>

      {editing && (
        <EditDrawer table={t} row={editing} onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }} />
      )}
      {adding && (
        <AddDrawer table={t} onClose={() => setAdding(false)}
          onSaved={async () => { setAdding(false); await load(); }} />
      )}
      {bulkOpen && (
        <BulkDrawer table={t} keys={Array.from(selected)} onClose={() => setBulkOpen(false)}
          onDone={async () => { setBulkOpen(false); setSelected(new Set()); await load(); }} />
      )}
      {historyOpen && <HistoryDrawer onClose={() => setHistoryOpen(false)} onUndone={load} />}
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
    const v = value == null ? "" : String(value);
    return (
      <select value={v} onChange={(e) => onChange(e.target.value)} style={base}>
        {(col.nullable || v === "") && <option value="">{col.nullable ? "—" : "Select…"}</option>}
        {col.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  if (col.type === "list") {
    const display = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
    return (
      <input type="text" value={display} placeholder="comma-separated"
        onChange={(e) => onChange(e.target.value)} style={base} />
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
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
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

// ── add-record drawer (key + every editable column; audited, undoable) ──────
function AddDrawer({ table, onClose, onSaved }: {
  table: PreviewTable; onClose: () => void; onSaved: () => void;
}) {
  const keyCol = table.columns.find((c) => c.col === table.keyCol);
  const fields = table.columns.filter((c) => c.col !== table.keyCol && c.editable !== false);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const d: Record<string, unknown> = { [table.keyCol]: "" };
    for (const c of fields) d[c.col] = c.def ?? (c.type === "bool" ? false : "");
    return d;
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const key = String(draft[table.keyCol] ?? "").trim();
    if (!key) { toast.error(`${keyCol?.label ?? table.keyCol} is required.`); return; }
    const row: Record<string, unknown> = { [table.keyCol]: key };
    for (const c of fields) {
      const v = coerce(c.type, draft[c.col]);
      if (c.required && (v === null || v === "")) { toast.error(`${c.label} is required.`); return; }
      if (v !== null || c.nullable) row[c.col] = v;
    }
    setSaving(true);
    const r = await insertRecord(table.id, row);
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Added ${key} to ${table.table} — undo from Recent edits.`);
    onSaved();
  };

  const req = (yes?: boolean) => yes && <span style={{ color: C.red }}> *</span>;

  return (
    <Drawer title={`Add ${table.label.replace(/s$/, "").toLowerCase()}`} subtitle={`→ ${table.table}`} onClose={onClose}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 5, gridColumn: "1 / -1" }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>{keyCol?.label ?? table.keyCol}{req(true)}</span>
          <input value={String(draft[table.keyCol] ?? "")}
            onChange={(e) => setDraft((d) => ({ ...d, [table.keyCol]: e.target.value }))}
            style={{ width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`,
              font: "inherit", fontSize: 13.5, fontFamily: C.mono, color: C.navy, background: "#fff" }} />
        </label>
        {fields.map((c) => (
          <label key={c.col} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>{c.label}{req(c.required)}</span>
            <FieldInput col={c} value={draft[c.col]} onChange={(v) => setDraft((d) => ({ ...d, [c.col]: v }))} />
          </label>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
        <button onClick={save} disabled={saving} style={btn("primary")}>
          {saving ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />} Add record
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
    setRows(res.success ? res.data.rows : []);
    if (!res.success) toast.error(res.error);
  }, []);
  useEffect(() => { let c = false; (async () => { await Promise.resolve(); if (!c) await reload(); })(); return () => { c = true; }; }, [reload]);

  const undo = async (r: EditAuditRow) => {
    setBusy(r.id);
    const refArg = r.group_id ? { groupId: r.group_id } : { auditId: r.id };
    let res = await undoEdit(refArg);
    if (res.success && !res.data.ok) {
      const cs = res.data.conflicts ?? [];
      const go = confirm(`${cs.length} row${cs.length === 1 ? "" : "s"} changed since this edit:\n${describeUndoConflicts(cs)}\n\nForce the undo anyway? Those later changes will be overwritten.`);
      if (!go) { setBusy(null); toast.message("Undo cancelled — nothing was changed."); return; }
      res = await undoEdit(refArg, true);
    }
    setBusy(null);
    if (!res.success) { toast.error(res.error); return; }
    const parts = [
      res.data.restored ? `${res.data.restored} restored` : null,
      res.data.reinserted ? `${res.data.reinserted} re-inserted` : null,
      res.data.removed ? `${res.data.removed} removed` : null,
    ].filter(Boolean).join(" · ");
    toast.success(`Reverted · ${parts || "done"}`);
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
                color: r.op === "delete" ? C.red : r.op === "insert" ? C.green : C.amber,
                background: r.op === "delete" ? C.redBg : r.op === "insert" ? C.greenBg : C.amberBg }}>
                {r.op === "delete" ? "DEL" : r.op === "insert" ? "ADD" : "UPD"}
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

const ICON: React.CSSProperties = {
  border: "none", background: "transparent", cursor: "pointer", padding: 5, color: C.ink2,
  display: "inline-flex", alignItems: "center", borderRadius: 6,
};

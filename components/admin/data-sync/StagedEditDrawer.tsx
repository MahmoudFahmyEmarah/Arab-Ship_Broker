"use client";

// Shared editor for a staged sync row — used by the Review tab and by Manual
// Review's "Needs fixing" queue. Same typed fields as Database Preview; on save
// the server (editStagedRow) re-validates + re-diffs, so fixing a value clears
// its error and the row becomes committable (or leaves the invalid queue).

import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { X, Check, Loader2 } from "lucide-react";
import { previewTable, coerce, type PreviewCol } from "@/lib/sync/preview";
import { editStagedRow, type StagedRowView } from "@/app/(admin)/admin/data-sync/actions";
import { C, btn } from "./ui";

export function StagedEditDrawer({ row, sheetId, onClose, onSaved }: {
  row: StagedRowView; sheetId: string; onClose: () => void; onSaved: () => void;
}) {
  const pt = previewTable(sheetId);
  const editable = (pt?.columns ?? []).filter((c) => c.editable !== false);
  const [draft, setDraft] = useState<Record<string, unknown>>(() => {
    const d: Record<string, unknown> = {};
    for (const c of editable) d[c.col] = row.payload[c.col] ?? (c.type === "bool" ? false : "");
    return d;
  });
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const save = async () => {
    const patch: Record<string, unknown> = {};
    for (const c of editable) {
      const next = coerce(c.type, draft[c.col]);
      const orig = row.payload[c.col] ?? null;
      const origNorm = c.type === "bool" ? orig === true : orig;
      if (JSON.stringify(next) !== JSON.stringify(origNorm ?? null)) patch[c.col] = next;
    }
    if (Object.keys(patch).length === 0) { toast("No changes to save."); return; }
    setSaving(true);
    const r = await editStagedRow(row.id, patch);
    setSaving(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Saved · ${r.data.classification === "invalid" ? "still has errors" : "ready to sync"}.`);
    onSaved();
  };

  if (!pt) return null;
  const field: React.CSSProperties = { width: "100%", padding: "8px 10px", borderRadius: 7, border: `1px solid ${C.line}`, font: "inherit", fontSize: 13.5, color: C.ink, background: "#fff" };
  return (
    <div ref={ref} onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(10,26,47,.34)", zIndex: 62, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "min(560px, 94vw)", height: "100%", background: "#fff", boxShadow: "-8px 0 32px rgba(0,0,0,.18)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "16px 20px", borderBottom: `1px solid ${C.line}` }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, color: C.navy }}>Edit staged record</div>
            <div style={{ fontSize: 12.5, color: C.ink3, fontFamily: C.mono, marginTop: 2 }}>{row.business_key ?? "—"} → {pt.table}</div>
          </div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: C.ink2, padding: 4 }} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ padding: "18px 20px", overflowY: "auto", flex: 1 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14 }}>
            {editable.map((c) => (
              <label key={c.col} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>{c.label}</span>
                <EditField col={c} value={draft[c.col]} onChange={(v) => setDraft((d) => ({ ...d, [c.col]: v }))} field={field} />
              </label>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, padding: "14px 20px", borderTop: `1px solid ${C.line}` }}>
          <button onClick={save} disabled={saving} style={btn("primary")}>
            {saving ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />} Save
          </button>
          <button onClick={onClose} style={btn("ghost")}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function EditField({ col, value, onChange, field }: { col: PreviewCol; value: unknown; onChange: (v: unknown) => void; field: React.CSSProperties }) {
  if (col.type === "bool") {
    return (
      <select value={value === true ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")} style={field}>
        <option value="true">yes</option><option value="false">no</option>
      </select>
    );
  }
  if (col.type === "enum") {
    return (
      <select value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value)} style={field}>
        {col.nullable && <option value="">—</option>}
        {col.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const inputType = col.type === "int" || col.type === "num" ? "number" : col.type === "date" ? "date" : "text";
  return <input type={inputType} value={value == null ? "" : String(value)} step={col.type === "num" ? "any" : undefined} onChange={(e) => onChange(e.target.value)} style={field} />;
}

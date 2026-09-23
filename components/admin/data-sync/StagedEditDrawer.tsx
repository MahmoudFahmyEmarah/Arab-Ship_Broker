"use client";

// Shared editor for a staged sync row — used by the Review tab and by Manual
// Review's "Needs fixing" queue. Same typed fields as Database Preview; on save
// the server (editStagedRow) re-validates + re-diffs, so fixing a value clears
// its error and the row becomes committable (or leaves the invalid queue).

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { previewTable, coerce, type PreviewCol } from "@/lib/sync/preview";
import { editStagedRow, type StagedRowView } from "@/app/(admin)/admin/data-sync/actions";
import { Btn, Drawer, DrawerSection, C } from "./ui";

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

  return (
    <Drawer
      narrow
      title="Edit staged record"
      sub={`${row.business_key ?? "—"} → ${pt.table}`}
      onClose={onClose}
      foot={
        <>
          <Btn kind="primary" busy={saving} icon={<Check size={15} />} onClick={save}>Save</Btn>
          <Btn kind="ghost" onClick={onClose}>Cancel</Btn>
        </>
      }
    >
      <DrawerSection>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 13 }}>
          {editable.map((c) => (
            <label key={c.col} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: C.ink2 }}>{c.label}</span>
              <EditField col={c} value={draft[c.col]} onChange={(v) => setDraft((d) => ({ ...d, [c.col]: v }))} />
            </label>
          ))}
        </div>
        <div className="ds-note" style={{ marginTop: 12 }}>
          Saving re-validates and re-diffs the row on the server, so a corrected field clears its own gate error.
        </div>
      </DrawerSection>
    </Drawer>
  );
}

function EditField({ col, value, onChange }: { col: PreviewCol; value: unknown; onChange: (v: unknown) => void }) {
  if (col.type === "bool") {
    return (
      <select className="ds-input" value={value === true ? "true" : "false"} onChange={(e) => onChange(e.target.value === "true")}>
        <option value="true">yes</option><option value="false">no</option>
      </select>
    );
  }
  if (col.type === "enum") {
    return (
      <select className="ds-input" value={value == null ? "" : String(value)} onChange={(e) => onChange(e.target.value)}>
        {col.nullable && <option value="">—</option>}
        {col.options?.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    );
  }
  const inputType = col.type === "int" || col.type === "num" ? "number" : col.type === "date" ? "date" : "text";
  return (
    <input
      className="ds-input" type={inputType} value={value == null ? "" : String(value)}
      step={col.type === "num" ? "any" : undefined} onChange={(e) => onChange(e.target.value)}
    />
  );
}

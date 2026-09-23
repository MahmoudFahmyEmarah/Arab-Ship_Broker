"use client";

// Review → "Duplicate pairs". The design's side-by-side cards for the two
// uniqueness rules (DQ-U03 same cargo under two refs, DQ-U04 the same ship
// with and without an IMO). Detection runs server-side over the open + draft
// batches; a merge fills the kept row's gaps and parks the duplicate as
// 'unchanged' (never committed) — reversible with Restore from the row drawer.

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { GitMerge, RefreshCcw } from "lucide-react";
import { findDuplicatePairs, mergeStagedRows, type DupPair } from "@/app/(admin)/admin/data-sync/actions";
import { Badge, Btn, Card, SectionLabel, C } from "./ui";

const DISMISS_KEY = "ds:dupes:dismissed";
const readDismissed = (): Set<string> => {
  try { return new Set(JSON.parse(localStorage.getItem(DISMISS_KEY) ?? "[]") as string[]); } catch { return new Set(); }
};
const writeDismissed = (s: Set<string>) => { try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-200))); } catch { /* private mode */ } };

export function DupPairs({ batchId, onMerged }: { batchId: string; onMerged: () => Promise<void> }) {
  const [pairs, setPairs] = useState<DupPair[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const r = await findDuplicatePairs(batchId);
    if (!r.success) { toast.error(r.error); setPairs([]); return; }
    setPairs(r.data);
  }, [batchId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setDismissed(readDismissed());
      await load();
    })();
    return () => { cancelled = true; };
  }, [load]);

  const visible = (pairs ?? []).filter((p) => !dismissed.has(p.id));
  if (pairs === null || visible.length === 0) return null;

  const merge = async (p: DupPair) => {
    const keep = p.sides.find((s) => s.keep)!;
    const drop = p.sides.find((s) => !s.keep)!;
    setBusy(p.id);
    const r = await mergeStagedRows(keep.id, drop.id, drop.origin);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(r.data.filled.length ? `Merged · filled ${r.data.filled.join(", ")} on the kept row` : "Merged · duplicate parked");
    await load();
    await onMerged();
  };

  const dismiss = (p: DupPair) => {
    const next = new Set(dismissed).add(p.id);
    setDismissed(next); writeDismissed(next);
  };

  return (
    <div className="ds-stack" style={{ gap: 10 }}>
      <div className="ds-row">
        <SectionLabel>Duplicate pairs · {visible.length}</SectionLabel>
        <Btn size="sm" kind="ghost" className="ds-push" icon={<RefreshCcw size={13} />} onClick={load}>Re-check</Btn>
      </div>
      {visible.map((p) => (
        <Card key={p.id}>
          <div className="ds-row" style={{ marginBottom: 10 }}>
            <Badge tone="updated" title={p.rule === "DQ-U03" ? "Same order under two refs" : "Same ship with and without an IMO"}>{p.rule}</Badge>
            <span style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>{p.title}</span>
            <span className="ds-note">{p.why}</span>
          </div>
          <div className="ds-change__cols" style={{ border: "var(--bd-hair)", borderRadius: "var(--r-soft-10)", overflow: "hidden" }}>
            {p.sides.map((s) => (
              <div key={s.id} className="ds-change__col" style={{ background: s.keep ? C.greenBg : undefined }}>
                <div className="ds-row" style={{ marginBottom: 6 }}>
                  <span className="ds-change__collabel" style={{ marginBottom: 0 }}>{s.label}</span>
                  {s.keep && <Badge tone="new">Keep</Badge>}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", fontSize: 12.5 }}>
                  {s.fields.map(([k, v]) => (
                    <span key={k} style={{ display: "contents" }}>
                      <span style={{ color: C.ink3 }}>{k}</span>
                      <span style={{ color: C.ink, overflowWrap: "anywhere" }}>{v}</span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="ds-row" style={{ marginTop: 10 }}>
            <Btn kind="primary" size="sm" icon={<GitMerge size={13} />} busy={busy === p.id} onClick={() => merge(p)}>Merge into kept row</Btn>
            <Btn kind="ghost" size="sm" disabled={!!busy} onClick={() => dismiss(p)}>Not a duplicate</Btn>
            <span className="ds-note ds-push">Reversible — the parked row keeps its data and can be restored from its drawer.</span>
          </div>
        </Card>
      ))}
    </div>
  );
}

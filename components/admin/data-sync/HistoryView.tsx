"use client";

// History — the module's audit trail, day-grouped. Two streams, one timeline:
//   • sync batches (sync_batch) — upload / circular / WhatsApp runs
//   • record edits (record_edit_audit) — direct Database-tab edits, grouped
// Both are read-only reads that already existed; the only writes offered here
// are the reversals the module already supports (undoBatch / undoEdit), so the
// tab adds a view over history, not a new way to change data.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  FileSpreadsheet, Mail, MessageSquare, Pencil, Plus, Trash2, RotateCcw, Loader2,
} from "lucide-react";
import {
  listEditAudit, listBatches, undoEdit, undoBatch,
  type BatchMeta, type EditAuditRow,
} from "@/app/(admin)/admin/data-sync/actions";
import { Badge, Btn, Card, Seg, toneForStatus, utcShort, C } from "./ui";
import { describeUndoConflicts, hasCommittedRows } from "@/lib/sync/batch-status";
import { AuditTrail } from "./AuditTrail";

type SourceFilter = "all" | "upload" | "email" | "whatsapp" | "edit";
type OutcomeFilter = "all" | "committed" | "reversible" | "undone";

/** One row on the timeline, normalised from either stream. */
type Item = {
  key: string;
  kind: "batch" | "edit";
  at: string;
  source: string;
  type: string;
  title: string;
  meta: string;
  status: string;
  /** Present when this entry can still be reversed. */
  restore: { batchId?: string; auditId?: string; groupId?: string } | null;
};

const SOURCE_ICON: Record<string, React.ComponentType<{ size?: number }>> = {
  upload: FileSpreadsheet, xlsx: FileSpreadsheet, workbook: FileSpreadsheet,
  email: Mail, whatsapp: MessageSquare,
};
const OP_ICON = { insert: Plus, update: Pencil, delete: Trash2 } as const;

const dayOf = (iso: string) => iso.slice(0, 10);

/** "Today" / "Yesterday" / "12 Sep 2026" — computed after mount so the server
 *  and first client render agree on the raw ISO day. */
function dayLabel(day: string, today: string, yesterday: string): string {
  if (day === today) return "Today";
  if (day === yesterday) return "Yesterday";
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? day
    : d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function HistoryView({ batches, onOpenBatch, onOpenBatchId, onChanged }: {
  batches: BatchMeta[];
  onOpenBatch: (b: BatchMeta) => void;
  onOpenBatchId: (id: string) => void;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"timeline" | "audit">("timeline");
  const [edits, setEdits] = useState<EditAuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [source, setSource] = useState<SourceFilter>("all");
  const [outcome, setOutcome] = useState<OutcomeFilter>("all");
  const [busy, setBusy] = useState<string | null>(null);
  // Phase 6: the page loads the 12 most recent batches; older ones page in from the server.
  const [older, setOlder] = useState<BatchMeta[]>([]);
  const [moreLeft, setMoreLeft] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const allBatches = useMemo(() => [...batches, ...older], [batches, older]);
  const loadOlder = async () => {
    setLoadingOlder(true);
    const r = await listBatches({ offset: allBatches.length, limit: 25 });
    setLoadingOlder(false);
    if (!r.success) { toast.error(r.error); return; }
    const seen = new Set(allBatches.map((b) => b.id));
    const fresh = r.data.rows.filter((b) => !seen.has(b.id));
    setOlder((o) => [...o, ...fresh]);
    if (fresh.length === 0 || allBatches.length + fresh.length >= r.data.total) setMoreLeft(false);
  };
  // Day names resolve after mount; before that every group shows its ISO date.
  const [days, setDays] = useState<{ today: string; yesterday: string }>({ today: "", yesterday: "" });

  const load = useCallback(async () => {
    setLoading(true);
    const r = await listEditAudit(50);
    setLoading(false);
    if (!r.success) { toast.error(r.error); return; }
    setEdits(r.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      const now = new Date();
      const y = new Date(now.getTime() - 86_400_000);
      setDays({ today: now.toISOString().slice(0, 10), yesterday: y.toISOString().slice(0, 10) });
      await load();
    })();
    return () => { cancelled = true; };
  }, [load]);

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];

    for (const b of allBatches) {
      const t = Object.values(b.counts ?? {}).reduce(
        (a, c) => ({ n: a.n + (c.new ?? 0), u: a.u + (c.updated ?? 0), i: a.i + (c.invalid ?? 0) }),
        { n: 0, u: 0, i: 0 },
      );
      const at = b.committed_at ?? b.created_at;
      out.push({
        key: `b:${b.id}`,
        kind: "batch",
        at,
        source: b.source,
        type: "Batch",
        title: b.label ?? b.id.slice(0, 8),
        meta: [
          b.file_name,
          `${t.n} new`,
          `${t.u} updated`,
          t.i ? `${t.i} blocked` : null,
        ].filter(Boolean).join(" · "),
        status: b.status,
        restore: hasCommittedRows(b.status) ? { batchId: b.id } : null,
      });
    }

    for (const e of edits) {
      out.push({
        key: `e:${e.id}`,
        kind: "edit",
        at: e.edited_at,
        source: "edit",
        type: e.op === "insert" ? "Insert" : e.op === "delete" ? "Delete" : "Edit",
        title: e.business_key,
        meta: `${e.table_name}${e.group_id ? " · bulk group" : ""}`,
        status: e.undone ? "undone" : "committed",
        restore: e.undone ? null : { auditId: e.id, groupId: e.group_id ?? undefined },
      });
    }

    const bySource = (i: Item) =>
      source === "all" ? true
        : source === "edit" ? i.kind === "edit"
        : source === "upload" ? i.kind === "batch" && i.source !== "email" && i.source !== "whatsapp"
        : i.source === source;

    const byOutcome = (i: Item) =>
      outcome === "all" ? true
        : outcome === "undone" ? i.status === "undone"
        : outcome === "reversible" ? i.restore !== null
        : hasCommittedRows(i.status);

    return out
      .filter((i) => bySource(i) && byOutcome(i))
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  }, [allBatches, edits, source, outcome]);

  const grouped = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const i of items) {
      const d = dayOf(i.at);
      const list = m.get(d);
      if (list) list.push(i); else m.set(d, [i]);
    }
    return [...m.entries()];
  }, [items]);

  const doUndoBatch = async (batchId: string) => {
    if (!confirm("Undo this batch? Every row it changed is restored and every row it inserted is removed.")) return;
    setBusy(batchId);
    const r = await undoBatch(batchId);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Undone · ${r.data.reverted} restored · ${r.data.deleted} removed`);
    onChanged();
  };

  const doUndoEdit = async (item: Item) => {
    const ref = item.restore;
    if (!ref) return;
    const isGroup = !!ref.groupId;
    if (!confirm(isGroup ? "Undo this whole bulk edit group?" : `Undo the ${item.type.toLowerCase()} on ${item.title}?`)) return;
    setBusy(item.key);
    const refArg = isGroup ? { groupId: ref.groupId } : { auditId: ref.auditId };
    let r = await undoEdit(refArg);
    if (r.success && !r.data.ok) {
      const cs = r.data.conflicts ?? [];
      const go = confirm(`${cs.length} row${cs.length === 1 ? "" : "s"} changed since this edit:\n${describeUndoConflicts(cs)}\n\nForce the undo anyway? Those later changes will be overwritten.`);
      if (!go) { setBusy(null); toast.message("Undo cancelled — nothing was changed."); return; }
      r = await undoEdit(refArg, true);
    }
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Undone · ${r.data.restored} restored · ${r.data.reinserted} reinserted${r.data.forced ? ` · ${r.data.forced} later change(s) overridden` : ""}`);
    await load();
    onChanged();
  };

  return (
    <div className="ds-stack">
      <div className="ds-row">
        <Seg value={mode} onChange={setMode} options={[{ value: "timeline", label: "Timeline" }, { value: "audit", label: "Audit trail" }] as const} />
        <span className="ds-note">{mode === "timeline" ? "Batches and record edits, reversible from here." : "Who did what, when — every action in this module, server-recorded."}</span>
      </div>
      {mode === "audit" && <AuditTrail onOpenBatch={onOpenBatchId} />}
      {mode === "timeline" && (<>
      <div className="ds-row">
        <Seg
          value={source} onChange={setSource}
          options={[
            { value: "all", label: "All sources" },
            { value: "upload", label: "Workbook" },
            { value: "email", label: "Circulars" },
            { value: "whatsapp", label: "WhatsApp" },
            { value: "edit", label: "Direct edits" },
          ] as const}
        />
        <Seg
          value={outcome} onChange={setOutcome}
          options={[
            { value: "all", label: "Everything" },
            { value: "committed", label: "Committed" },
            { value: "reversible", label: "Reversible" },
            { value: "undone", label: "Undone" },
          ] as const}
        />
        <span className="ds-note ds-push">
          Batches from this page · last 50 record edits
        </span>
      </div>

      {loading ? (
        <div className="ds-empty"><Loader2 size={20} className="ds-spin" /></div>
      ) : grouped.length === 0 ? (
        <Card><div className="ds-empty">Nothing matches these filters.</div></Card>
      ) : (
        <div className="ds-stack">
          {grouped.map(([day, dayItems]) => (
            <div key={day} className="ds-day">
              <div className="ds-day__label">{dayLabel(day, days.today, days.yesterday)}</div>
              <div className="ds-timeline">
                {dayItems.map((i, idx) => {
                  const Icon = i.kind === "edit"
                    ? OP_ICON[i.type === "Insert" ? "insert" : i.type === "Delete" ? "delete" : "update"]
                    : (SOURCE_ICON[i.source] ?? FileSpreadsheet);
                  const batch = i.kind === "batch" ? batches.find((b) => `b:${b.id}` === i.key) : undefined;
                  return (
                    <div key={i.key} className="ds-timeline__item">
                      <div className="ds-timeline__rail">
                        <span className="ds-timeline__dot" style={{ background: i.status === "undone" ? C.ink3 : i.status === "committed" ? C.green : C.amber }} />
                        {idx < dayItems.length - 1 && <span className="ds-timeline__line" />}
                      </div>
                      <Card className="ds-timeline__body" style={{ padding: "10px 13px" }}>
                        <span style={{ color: C.ink3, display: "inline-flex", flex: "none" }}><Icon size={15} /></span>
                        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                          <div className="ds-row" style={{ gap: 8 }}>
                            <Badge tone={toneForStatus(i.status)}>{i.type}</Badge>
                            <span style={{ fontSize: 14, fontWeight: 600, color: C.navy, overflowWrap: "anywhere" }}>{i.title}</span>
                          </div>
                          <div className="ds-rowsub" style={{ marginTop: 3 }}>{i.meta || "—"}</div>
                        </div>
                        <span className="ds-mono" style={{ fontSize: 12, color: C.ink3 }}>{utcShort(i.at).slice(11)}</span>
                        {batch && (
                          <Btn size="sm" kind="ghost" onClick={() => onOpenBatch(batch)}>Open</Btn>
                        )}
                        {i.restore && (
                          <Btn
                            size="sm" kind="danger" icon={<RotateCcw size={13} />}
                            busy={busy === (i.kind === "batch" ? i.restore.batchId : i.key)}
                            onClick={() => (i.kind === "batch" ? doUndoBatch(i.restore!.batchId!) : doUndoEdit(i))}
                          >
                            {i.restore.groupId ? "Undo group" : "Undo"}
                          </Btn>
                        )}
                      </Card>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="ds-row" style={{ justifyContent: "center", paddingTop: 6 }}>
        {moreLeft
          ? <Btn size="sm" kind="ghost" busy={loadingOlder} onClick={loadOlder}>Show older batches</Btn>
          : <span className="ds-note">Every batch is shown.</span>}
      </div>
      </>)}
    </div>
  );
}

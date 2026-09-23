"use client";

// Data Sync — the module UI. Six views behind one screen, per the approved
// "intake room" design:
//   • Intake       — channel cards (workbook / circulars / WhatsApp) + recent batches
//   • Review       — triage the staged batch: sheet chips, grouped rows, row drawer
//   • Database     — the live tables, server-paged, with guarded edits
//   • Queues       — commodities to map and vessels awaiting an IMO
//   • History      — batches and record edits on one reversible timeline
//   • Connections  — inbox, LLM and WhatsApp credentials + schedules
// Backed entirely by the Phase 1 RPCs + Phase 2/3 actions; the browser never
// writes to a live table. Skin lives in app/(admin)/admin-data-sync.css.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  FileSpreadsheet, RotateCcw, Trash2, Mail, Database,
  Layers, FileSearch, Filter, Clock, SlidersHorizontal,
  MessageSquare, Sparkles, ShieldAlert, Activity,
} from "lucide-react";
import {
  commitSheet, commitAll, commitSelection, undoBatch, discardBatch, regateBatch, listStaged, getBatch,
  type BatchMeta, type StagedRowView,
} from "@/app/(admin)/admin/data-sync/actions";
import { getIntakeHealth, type IntakeHealth } from "@/app/(admin)/admin/data-sync/settings-actions";
import type { processWhatsapp } from "@/app/(admin)/admin/data-sync/actions";
import type { SyncEvent } from "@/lib/sync/email/types";
import { RunPanel, emptyRun, type RunState } from "./RunPanel";
import { ReviewView } from "./ReviewView";
import { PreviewView } from "./PreviewView";
import { ManualReviewView } from "./ManualReviewView";
import { SettingsView } from "./SettingsView";
import { EmailSyncCard } from "./EmailSyncCard";
import { WhatsappCard } from "./WhatsappCard";
import { HistoryView } from "./HistoryView";
import { HealthView } from "./HealthView";
import { UploadCard } from "./UploadCard";
import { Badge, Btn, Card, SectionLabel, toneForStatus, relTime, C } from "./ui";
import { batchActions, batchStatusLabel, describeUndoConflicts, hasCommittedRows, isGateStale, isOpenBatch, isTerminalBatch, describeCommit, sheetsFullyCommitted } from "@/lib/sync/batch-status";
import { explainJobFailure } from "@/lib/sync/job-failure";

type SheetInfo = { id: string; label: string; table: string };
type SheetCount = { new: number; updated: number; unchanged: number; invalid: number; errors: number };
const ZERO: SheetCount = { new: 0, updated: 0, unchanged: 0, invalid: 0, errors: 0 };

// A child sheet can only be committed on its own AFTER its parent sheets (which
// it references by foreign key) are committed. Cargo rows reference ports.
// "Sync all" always commits in dependency order, so it's never blocked.
const DEPENDS: Record<string, string[]> = { cargo: ["ports"] };
const REVIEW_PAGE = 100; // staged rows fetched per page in Review

// Hydration-safe timestamp: the server (and the first client render) show a
// deterministic UTC string; after mount we swap to the viewer's local format.
// Rendering toLocaleString() directly would mismatch server vs browser locale.
function LocalTime({ iso }: { iso: string }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => { await Promise.resolve(); if (!cancelled) setLocal(new Date(iso).toLocaleString()); })();
    return () => { cancelled = true; };
  }, [iso]);
  return <>{local ?? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`}</>;
}

type ViewId = "intake" | "review" | "database" | "queues" | "history" | "health" | "connections";

// The module's seven views, in pipeline order. `badge` is filled in at render
// time from live counts; a view is never hidden, only disabled when it has
// nothing to show (Review with no open batch).
const TABS: { id: ViewId; label: string; icon: LucideIcon; tip: string }[] = [
  { id: "intake",      label: "Intake",      icon: Layers,             tip: "Channels, health and the run panel" },
  { id: "review",      label: "Review",      icon: FileSearch,         tip: "Triage the staged batch" },
  { id: "database",    label: "Database",    icon: Database,           tip: "The live tables" },
  { id: "queues",      label: "Queues",      icon: Filter,             tip: "Commodities to map and vessels without IMO" },
  { id: "history",     label: "History",     icon: Clock,              tip: "Batches, runs and edit groups" },
  { id: "health",      label: "Health",      icon: Activity,           tip: "Health conditions, alerting and queued uploads" },
  { id: "connections", label: "Connections", icon: SlidersHorizontal,  tip: "Inbox, LLM and WhatsApp" },
];

export function DataSyncClient({
  sheets, initialBatches, initialQueuePending = 0,
}: { sheets: SheetInfo[]; initialBatches: BatchMeta[]; initialQueuePending?: number }) {
  const router = useRouter();
  const tableFor = useMemo(() => Object.fromEntries(sheets.map((s) => [s.id, s.table])), [sheets]);
  const labelFor = useMemo(() => Object.fromEntries(sheets.map((s) => [s.id, s.label])), [sheets]);

  const [view, setView] = useState<ViewId>("intake");
  const [batch, setBatch] = useState<BatchMeta | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "parsing" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // review state
  const [activeSheet, setActiveSheet] = useState<string>(sheets[0]?.id ?? "cargo");
  const [changesOnly, setChangesOnly] = useState(true);
  // the figure tile in Review — filters on the server (phase 6)
  const classRef = useRef<string>("all");
  const [rows, setRows] = useState<StagedRowView[]>([]);
  const [total, setTotal] = useState(0);
  const [reviewOffset, setReviewOffset] = useState(0);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [committed, setCommitted] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null); // sheetId | 'all' | 'undo' | 'discard'
  const [queuePending, setQueuePending] = useState(initialQueuePending);
  const fileRef = useRef<HTMLInputElement>(null);

  const countsFor = useCallback(
    (id: string): SheetCount => (batch?.counts?.[id] ?? ZERO),
    [batch],
  );

  const totals = useMemo(() => {
    const t = { ...ZERO };
    for (const s of sheets) {
      const c = countsFor(s.id);
      t.new += c.new; t.updated += c.updated; t.unchanged += c.unchanged; t.invalid += c.invalid; t.errors += c.errors;
    }
    return t;
  }, [sheets, countsFor]);

  // a failed commit may be retried, so 'failed' is no longer terminal (phase 2)
  const terminal = batch ? isTerminalBatch(batch.status) : true;
  const canCommitSheet = (id: string) => {
    const c = countsFor(id);
    return !!batch && !terminal && !committed.has(id) && c.new + c.updated > 0;
  };
  const pendingCommit = sheets.some((s) => canCommitSheet(s.id));

  // A child sheet is blocked while any parent it depends on still has pending
  // (uncommitted new/updated) rows. Returns a message to show, or null.
  const commitBlockedReason = (id: string): string | null => {
    if (!batch || terminal) return null;
    const pendingParents = (DEPENDS[id] ?? []).filter((p) => {
      const c = countsFor(p);
      return c.new + c.updated > 0 && !committed.has(p) && batch.status !== "committed";
    });
    if (!pendingParents.length) return null;
    const names = pendingParents.map((p) => labelFor[p] ?? p).join(" & ");
    return `Commit ${names} first — ${labelFor[id] ?? id} reference ${names} that must exist in the database. Or use “Sync all”, which commits in the right order.`;
  };

  // ── data loading ──────────────────────────────────────────────────────────
  const loadRows = useCallback(
    async (batchId: string, sheet: string, changes: boolean, offset: number) => {
      setRowsLoading(true);
      const res = await listStaged(batchId, sheet, { changesOnly: changes, limit: REVIEW_PAGE, offset, classification: classRef.current });
      setRowsLoading(false);
      if (!res.success) {
        toast.error(res.error);
        setRows([]); setTotal(0);
        return;
      }
      setRows(res.data.rows);
      setTotal(res.data.total);
    },
    [],
  );

  useEffect(() => {
    if (!(view === "review" && batch)) return;
    const id = batch.id;
    let cancelled = false;
    // Kick the fetch off the effect's synchronous phase (no sync setState).
    (async () => {
      await Promise.resolve();
      if (!cancelled) loadRows(id, activeSheet, changesOnly, reviewOffset);
    })();
    return () => { cancelled = true; };
  }, [view, batch, activeSheet, changesOnly, reviewOffset, loadRows]);

  // Switching tab or toggling the filter jumps back to the first page.
  const goToSheet = (id: string) => { setActiveSheet(id); setReviewOffset(0); };
  const toggleChangesOnly = (v: boolean) => { setChangesOnly(v); setReviewOffset(0); };

  const refreshBatch = useCallback(async (id: string): Promise<BatchMeta | null> => {
    const res = await getBatch(id);
    if (res.success && res.data) { setBatch(res.data); return res.data; }
    return null;
  }, []);

  // ── upload ────────────────────────────────────────────────────────────────
  const openBatch = useCallback(
    async (b: BatchMeta) => {
      setBatch(b);
      setCommitted(sheetsFullyCommitted(b.status, b.counts, sheets.map((s) => s.id)));
      const first =
        sheets.find((s) => { const c = b.counts?.[s.id] ?? ZERO; return c.new + c.updated > 0; })?.id ??
        sheets[0]?.id ?? "cargo";
      setActiveSheet(first);
      setView("review");
    },
    [sheets],
  );

  const handleFile = useCallback(
    async (file: File) => {
      if (!/\.xlsx$/i.test(file.name)) { toast.error("Upload the unified CargoMap .xlsx workbook."); return; }
      if (file.size > 10 * 1024 * 1024) { toast.error("Workbook is larger than 10 MB."); return; }
      setUploadState("parsing"); setUploadError(null);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload/cargomap", { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const msg = json?.error ?? `Upload failed (${res.status}).`;
          setUploadState("error"); setUploadError(msg); toast.error(msg);
          return;
        }
        setUploadState("idle");
        if (json.queued) {
          // P1-3: too large for one request — the upload-jobs cron stages it
          toast.message(json.message ?? "The workbook is queued and will be staged in the background.");
          router.refresh();
          return;
        }
        toast.success(`Staged ${json.totals.new + json.totals.updated} changes for review.`);
        const meta = await getBatch(json.batchId);
        if (meta.success && meta.data) { await openBatch(meta.data); router.refresh(); }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Network error during upload.";
        setUploadState("error"); setUploadError(msg); toast.error(msg);
      }
    },
    [openBatch, router],
  );

  // ── commit / undo / discard ───────────────────────────────────────────────
  const doCommitSheet = async (sheetId: string) => {
    if (!batch) return;
    const blocked = commitBlockedReason(sheetId);
    if (blocked) { toast.error(blocked); return; }
    setBusy(sheetId);
    const r = await commitSheet(batch.id, sheetId);
    setBusy(null);
    if (!r.success) { toast.error(isGateStale(r.error) ? `${r.error} — use “Run the gate” on this batch.` : r.error); return; }
    const d = describeCommit(r.data, false);
    if (d.ok) toast.success(`${r.data.inserted + r.data.updated} rows → ${tableFor[sheetId]} · ${d.text}`);
    else toast.warning(`${r.data.inserted + r.data.updated} rows → ${tableFor[sheetId]} · ${d.text}`);
    // what counts as "committed" comes from the refreshed batch, never assumed
    const fresh = await refreshBatch(batch.id);
    setCommitted(sheetsFullyCommitted(fresh?.status ?? r.data.status ?? batch.status, fresh?.counts ?? batch.counts, sheets.map((s) => s.id)));
    await loadRows(batch.id, activeSheet, changesOnly, reviewOffset);
    router.refresh();
  };

  // Phase 3: the gate's verdict is part of the batch. Re-run it when a
  // commit says rows are stale, when staging could not run it, or on demand.
  const doRegate = async (b: BatchMeta) => {
    setBusy("regate");
    const r = await regateBatch(b.id);
    setBusy(null);
    // the action inspects regate_sync_batch's ok flag: ok=false means the batch is now
    // gate_failed with the reason on it — refresh what is shown either way
    if (!r.success) toast.error(r.error);
    else if (r.data.errors.length) toast.error(`Gate ran with ${r.data.errors.length} rule error(s): ${r.data.errors[0]}${r.data.errors.length > 1 ? " …" : ""} — those rows stay refused until the rule is fixed.`);
    else toast.success(`Gate ran · ${r.data.blocked} blocked · ${r.data.warned} warned · ${r.data.rules} rules`);
    if (batch?.id === b.id) { await refreshBatch(b.id); await loadRows(b.id, activeSheet, changesOnly, reviewOffset); }
    router.refresh();
  };

  const doCommitAll = async () => {
    if (!batch) return;
    setBusy("all");
    const r = await commitAll(batch.id);
    setBusy(null);
    if (!r.success) { toast.error(isGateStale(r.error) ? `${r.error} — use “Run the gate” on this batch.` : r.error); return; }
    // "Sync all" says what actually happened: committed, or partly committed with what remains
    const d = describeCommit(r.data, true);
    if (d.ok) toast.success(d.text); else toast.warning(d.text);
    const fresh = await refreshBatch(batch.id);
    setCommitted(sheetsFullyCommitted(fresh?.status ?? r.data.status ?? batch.status, fresh?.counts ?? batch.counts, sheets.map((s) => s.id)));
    await loadRows(batch.id, activeSheet, changesOnly, reviewOffset);
    router.refresh();
  };

  const reloadCurrent = useCallback(async () => {
    if (batch) await loadRows(batch.id, activeSheet, changesOnly, reviewOffset);
  }, [batch, activeSheet, changesOnly, reviewOffset, loadRows]);

  // Commit only the reviewed/accepted rows the admin ticked.
  const doCommitSelection = async (ids: string[]) => {
    if (!batch) return;
    const blocked = commitBlockedReason(activeSheet);
    if (blocked) { toast.error(blocked); return; }
    setBusy("selection");
    const r = await commitSelection(batch.id, activeSheet, ids);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    const d = describeCommit(r.data, false);
    if (d.ok) toast.success(`${r.data.inserted + r.data.updated} selected row(s) → ${tableFor[activeSheet]} · ${d.text}`);
    else toast.warning(`${r.data.inserted + r.data.updated} selected row(s) → ${tableFor[activeSheet]} · ${d.text}`);
    const fresh = await refreshBatch(batch.id);
    setCommitted(sheetsFullyCommitted(fresh?.status ?? r.data.status ?? batch.status, fresh?.counts ?? batch.counts, sheets.map((s) => s.id)));
    await reloadCurrent();
    router.refresh();
  };

  const doUndo = async (b: BatchMeta) => {
    if (!confirm(`Undo batch ${b.label ?? b.id.slice(0, 8)}? This restores every row it changed and removes rows it inserted.`)) return;
    setBusy("undo");
    let r = await undoBatch(b.id);
    if (r.success && !r.data.ok) {
      // rows changed since the commit: the database touched nothing and
      // named them — the admin decides whether to override those later edits
      const n = r.data.conflicts.length;
      const go = confirm(`${n} row${n === 1 ? "" : "s"} changed since this batch was committed:\n${describeUndoConflicts(r.data.conflicts)}\n\nForce the undo anyway? Those later edits will be overwritten by the pre-commit values.`);
      if (!go) { setBusy(null); toast.message("Undo cancelled — nothing was changed."); return; }
      r = await undoBatch(b.id, true);
    }
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Undone · ${r.data.reverted} restored · ${r.data.deleted} removed${r.data.forced ? ` · ${r.data.forced} later edit(s) overridden` : ""}`);
    setCommitted(new Set());
    if (batch?.id === b.id) await refreshBatch(b.id);
    router.refresh();
  };

  const doDiscard = async (b: BatchMeta) => {
    if (!confirm(`Discard batch ${b.label ?? b.id.slice(0, 8)}? Its staged rows are deleted. (A batch that already wrote rows cannot be discarded — undo it instead.)`)) return;
    setBusy("discard");
    const r = await discardBatch(b.id);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Batch discarded.");
    if (batch?.id === b.id) { setBatch(null); setView("intake"); }
    router.refresh();
  };

  // ── derived: pipeline counters ────────────────────────────────────────────
  // Every figure comes from data already on the page (the open batch + the
  // recent-batch list). No extra round trip just to draw the strip.
  const draftTotals = useMemo(() => {
    const t = { staged: 0, blocked: 0 };
    for (const b of initialBatches) {
      if (!isOpenBatch(b.status)) continue;
      for (const c of Object.values(b.counts ?? {})) {
        t.staged += (c.new ?? 0) + (c.updated ?? 0);
        t.blocked += c.invalid ?? 0;
      }
    }
    return t;
  }, [initialBatches]);

  const stagedNow = batch && !terminal ? totals.new + totals.updated : draftTotals.staged;
  const blockedNow = batch && !terminal ? totals.invalid : draftTotals.blocked;
  const committedRecently = useMemo(
    () => initialBatches.filter((b) => hasCommittedRows(b.status)).length,
    [initialBatches],
  );

  const goReview = () => { if (batch) setView("review"); else toast.message("Open a batch from Intake first."); };

  const PIPELINE: {
    stage: string; n: number; sub: string; dot: string; color: string; view: ViewId; tip: string; go: () => void;
  }[] = [
    { stage: "Intake", n: 3, sub: "channels", dot: C.brass, color: C.navy, view: "intake",
      tip: "Workbook, circulation inbox and WhatsApp", go: () => setView("intake") },
    { stage: "Staged", n: stagedNow, sub: batch && !terminal ? "in the open batch" : "in draft batches", dot: C.brass, color: C.navy, view: "review",
      tip: "Rows waiting to be committed", go: goReview },
    { stage: "Needs a decision", n: blockedNow, sub: "held back by the gate or the parser", dot: blockedNow ? C.red : C.green,
      color: blockedNow ? C.red : C.ink3, view: "review", tip: "Rows the gate blocked, plus rows that failed parsing or miss a required field", go: goReview },
    { stage: "Queues", n: queuePending, sub: "awaiting a mapping", dot: queuePending ? C.amber : C.green,
      color: queuePending ? C.amber : C.ink3, view: "queues", tip: "Commodities to map and vessels without an IMO",
      go: () => setView("queues") },
    { stage: "Committed", n: committedRecently, sub: "reversible with Undo batch", dot: C.green, color: C.green,
      view: "history", tip: "Every commit keeps a before-image", go: () => setView("history") },
  ];

  const badgeFor = (id: ViewId): { n: number; tone: "" | "warn" | "danger" } =>
    id === "review" ? { n: blockedNow || stagedNow, tone: blockedNow ? "danger" : "" }
      : id === "queues" ? { n: queuePending, tone: "" }
      : { n: 0, tone: "" };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ color: C.ink }}>
      {/* view switch */}
      <div className="ds-tabs" role="tablist" aria-label="Data Sync views">
        {TABS.map((t) => {
          const on = view === t.id;
          const disabled = t.id === "review" && !batch;
          const b = badgeFor(t.id);
          const Icon = t.icon;
          return (
            <button
              key={t.id} type="button" role="tab" aria-selected={on} disabled={disabled}
              title={disabled ? "Open a batch from Intake first" : t.tip}
              onClick={() => !disabled && setView(t.id)}
              className={`ds-tab${on ? " is-active" : ""}`}
            >
              <span style={{ display: "inline-flex", color: on ? C.brass : C.ink3 }}><Icon size={15} /></span>
              {t.label}
              {b.n > 0 && (
                <span className={`ds-tab__badge${b.tone ? ` ds-tab__badge--${b.tone}` : ""}`}>{b.n}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* pipeline — where the work currently sits, and a shortcut to each stage */}
      <div className="ds-pipeline">
        {PIPELINE.map((p) => (
          <button
            key={p.stage} type="button" title={p.tip} onClick={p.go}
            className={`ds-pipeline__cell${view === p.view ? " is-active" : ""}`}
          >
            <span className="ds-pipeline__stage">
              <span className="ds-pipeline__dot" style={{ background: p.dot }} />
              {p.stage}
            </span>
            <span className="ds-pipeline__n" style={{ color: p.color }}>{p.n}</span>
            <span className="ds-pipeline__sub">{p.sub}</span>
          </button>
        ))}
      </div>

      {view === "intake" && (
        <IntakeView
          uploadState={uploadState} uploadError={uploadError}
          onPick={() => fileRef.current?.click()}
          onDrop={(f) => handleFile(f)}
          batches={initialBatches}
          onOpen={openBatch} onUndo={doUndo} onDiscard={doDiscard} onRegate={doRegate} busy={busy}
          onGoHistory={() => setView("history")}
          onOpenBatchId={async (id) => { const m = await getBatch(id); if (m.success && m.data) { await openBatch(m.data); router.refresh(); } }}
          onEmailDone={async (id) => {
            const m = await getBatch(id);
            if (m.success && m.data) { await openBatch(m.data); router.refresh(); }
          }}
        />
      )}
      {view === "review" && batch && (
        <ReviewView
          batch={batch} sheets={sheets} tableFor={tableFor} labelFor={labelFor}
          activeSheet={activeSheet} setActiveSheet={goToSheet}
          changesOnly={changesOnly} setChangesOnly={toggleChangesOnly}
          rows={rows} total={total} rowsLoading={rowsLoading}
          offset={reviewOffset} page={REVIEW_PAGE} setOffset={setReviewOffset}
          totals={totals} countsFor={countsFor}
          committed={committed} canCommitSheet={canCommitSheet} pendingCommit={pendingCommit} terminal={terminal}
          commitBlockedReason={commitBlockedReason}
          busy={busy}
          onCommitSheet={doCommitSheet} onCommitAll={doCommitAll}
          onCommitSelection={doCommitSelection} onReload={reloadCurrent}
          onUndo={() => doUndo(batch)} onDiscard={() => doDiscard(batch)} onRegate={() => doRegate(batch)}
          onFigureChange={(f) => { classRef.current = f; setReviewOffset(0); void loadRows(batch.id, activeSheet, changesOnly, 0); }}
        />
      )}
      {view === "database" && <PreviewView />}
      {view === "queues" && <ManualReviewView onPendingChange={setQueuePending} />}
      {view === "history" && (
        <HistoryView batches={initialBatches} onOpenBatch={openBatch} onChanged={() => router.refresh()}
          onOpenBatchId={async (id) => { const m = await getBatch(id); if (m.success && m.data) { await openBatch(m.data); router.refresh(); } }} />
      )}
      {view === "health" && (
        <HealthView onOpenBatchId={async (id) => { const m = await getBatch(id); if (m.success && m.data) { await openBatch(m.data); router.refresh(); } }} />
      )}
      {view === "connections" && <SettingsView />}

      <input ref={fileRef} type="file" accept=".xlsx" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

// ── Intake ──────────────────────────────────────────────────────────────────
// Health at the top (is each channel actually live?), the three channels side
// by side, then the recent batches. Every health figure is read through an
// action that already existed; this view adds no server logic of its own.
function IntakeView(props: {
  uploadState: "idle" | "parsing" | "error"; uploadError: string | null;
  onPick: () => void; onDrop: (f: File) => void;
  batches: BatchMeta[];
  onOpen: (b: BatchMeta) => void; onUndo: (b: BatchMeta) => void; onDiscard: (b: BatchMeta) => void; onRegate: (b: BatchMeta) => void;
  busy: string | null; onEmailDone: (batchId: string) => void;
  onGoHistory: () => void; onOpenBatchId: (id: string) => void;
}) {
  const {
    uploadState, uploadError, onPick, onDrop, batches,
    onOpen, onUndo, onDiscard, onRegate, busy, onEmailDone, onGoHistory, onOpenBatchId,
  } = props;

  // One gated round trip for the whole tile row (was four actions × requireAdmin).
  const [health, setHealth] = useState<IntakeHealth | null | "error">(null);
  const loadHealth = useCallback(async () => {
    const r = await getIntakeHealth();
    setHealth(r.success ? r.data : "error");
  }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => { await Promise.resolve(); if (!cancelled) await loadHealth(); })();
    return () => { cancelled = true; };
  }, [loadHealth]);
  const h = health && health !== "error" ? health : null;

  // The run panel — fed by the inbox stream or the WhatsApp sweep summary.
  const [run, setRun] = useState<RunState | null>(null);
  const onEmailEvent = useCallback((e: SyncEvent | { type: "start"; title: string } | { type: "finish" }) => {
    setRun((prev) => {
      if (e.type === "start") return emptyRun(e.title, "email");
      if (!prev) return prev;
      const next: RunState = { ...prev, steps: { ...prev.steps }, log: prev.log };
      if (e.type === "step") next.steps[e.key] = { state: e.state, detail: e.detail };
      else if (e.type === "log") next.log = [...prev.log, e.msg];
      else if (e.type === "usage") next.usage = { tokens: e.tokens, cost: e.cost, calls: e.calls };
      else if (e.type === "done") { next.state = "done"; next.finishedAt = Date.now(); next.result = { batchId: e.batchId, totals: e.totals }; }
      else if (e.type === "empty" || e.type === "skipped") { next.state = "done"; next.finishedAt = Date.now(); next.result = { batchId: null, message: e.message }; }
      else if (e.type === "error") { next.state = "failed"; next.finishedAt = Date.now(); next.error = e.error; }
      else if (e.type === "finish") { if (next.state === "running") { next.state = "failed"; next.error = next.error ?? "The stream ended without a result."; next.finishedAt = Date.now(); } void loadHealth(); }
      return next;
    });
  }, [loadHealth]);
  const onWaRun = useCallback((phase: "start" | "finish", title: string, result?: Awaited<ReturnType<typeof processWhatsapp>>) => {
    if (phase === "start") { setRun(emptyRun(title, "whatsapp")); return; }
    setRun((prev) => {
      if (!prev) return prev;
      const next: RunState = { ...prev, finishedAt: Date.now() };
      if (!result || !result.success) { next.state = "failed"; next.error = result && !result.success ? result.error : "Sweep failed."; return next; }
      const d = result.data;
      next.steps = Object.fromEntries((d.steps ?? []).map((st) => [st.key, { state: st.state, detail: st.detail }]));
      next.log = d.log;
      next.usage = d.usage ?? null;
      next.state = d.failed && !d.staged ? "failed" : "done";
      next.error = d.failed && !d.staged ? d.log.find((l) => l.startsWith("✗")) ?? "Sweep failed." : null;
      next.result = { batchId: null, message: `${d.processed} processed · ${d.staged} staged · ${d.irrelevant} irrelevant · ${d.failed} failed` };
      return next;
    });
    void loadHealth();
  }, [loadHealth]);

  // Most recent workbook-sourced batch, summarised for the upload card.
  const lastWorkbook = useMemo(() => {
    const b = batches.find((x) => x.source !== "email" && x.source !== "whatsapp");
    if (!b) return null;
    const t = Object.values(b.counts ?? {}).reduce((a, c) => a + (c.new ?? 0) + (c.updated ?? 0), 0);
    return `${relTime(b.created_at)} · ${t} staged · ${b.status}`;
  }, [batches]);

  const pct = h && Number.isFinite(h.budget.cap) && h.budget.cap > 0 ? Math.min(100, Math.round((h.budget.used / h.budget.cap) * 100)) : null;
  const lastFailure = h?.jobs.lastFailed
    ? explainJobFailure(h.jobs.lastFailed.error, h.jobs.lastFailed.job)
    : null;
  const tiles = [
    {
      label: "Circulation inbox", icon: Mail,
      value: !h ? "…" : !h.inbox ? "Not set up" : h.inbox.enabled ? "Connected" : "Disabled",
      sub: h?.inbox?.lastSuccess ? `Last successful run ${relTime(h.inbox.lastSuccess)}` : "No successful run yet",
      tone: !h ? C.ink3 : h.inbox?.enabled ? C.green : C.ink3,
      tip: "IMAP connection health and the start point of the next run",
    },
    {
      label: "Model · budget today", icon: Sparkles,
      value: !h ? "…" : !h.llm ? "No active key" : pct === null ? `${h.llm.model}` : `${h.llm.model} · ${pct}%`,
      sub: !h ? "" : `USD ${h.budget.cost.toFixed(2)} · ${h.budget.used.toLocaleString()}${Number.isFinite(h.budget.cap) ? ` of ${h.budget.cap.toLocaleString()}` : ""} tokens · shared with Data quality`,
      tone: !h ? C.ink3 : !h.llm ? C.amber : pct !== null && pct >= 80 ? C.amber : C.green,
      tip: "One Vault-stored key; every classifier call is metered into the daily cap set in Data quality → Settings",
    },
    {
      label: "WhatsApp pairing", icon: MessageSquare,
      value: !h ? "…" : h.whatsapp.worker_alive && h.whatsapp.state === "connected" ? "Linked" : "Paused",
      sub: h?.whatsapp.worker_seen ? `Worker last seen ${relTime(h.whatsapp.worker_seen)}` : "Worker has never checked in",
      tone: !h ? C.ink3 : h.whatsapp.worker_alive && h.whatsapp.state === "connected" ? C.green : C.amber,
      tip: "Pair in Connections; messages queue while paused",
    },
    {
      label: "Failed jobs · 7 d", icon: ShieldAlert,
      value: !h ? "…" : String(h.jobs.failed7d),
      sub: h?.jobs.lastFailed && lastFailure
        ? `${relTime(h.jobs.lastFailed.started_at)} · ${lastFailure.summary} ${lastFailure.action ?? ""}`.trim()
        : "No failed runs this week",
      tone: !h ? C.ink3 : h.jobs.failed7d > 0 ? C.amber : C.green,
      tip: h?.jobs.lastFailed?.error
        ? `Full technical error: ${h.jobs.lastFailed.error}`
        : "job_runs rows for email-sync / whatsapp-webhook that ended in an error",
    },
  ];

  const nextRun = h?.inbox?.scheduleEnabled
    ? `${h.inbox.scheduleLabel}${h.inbox.nextRunAt ? ` · next ${relTime(h.inbox.nextRunAt).replace(" ago", "")}` : ""}`
    : "On demand";

  return (
    <div className="ds-stack">
      {/* health */}
      <div className="ds-tiles">
        {tiles.map((t) => {
          const Icon = t.icon;
          return (
            <Card key={t.label} title={t.tip}>
              <div className="ds-tile">
                <span className="ds-tile__icon" style={{ color: t.tone }}><Icon size={17} /></span>
                <div style={{ minWidth: 0 }}>
                  <div className="ds-tile__label">{t.label}</div>
                  <div className="ds-tile__value" style={{ color: t.tone === C.green ? C.navy : t.tone, overflowWrap: "anywhere" }}>{t.value}</div>
                  <div className="ds-tile__sub" title={t.tip}>{t.sub}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      {health === "error" && <div className="ds-note" style={{ color: C.red }}>Could not read intake health — the tiles show placeholders.</div>}

      {/* channels */}
      <div>
        <SectionLabel>Channels</SectionLabel>
        <div className="ds-channels" style={{ marginTop: 10 }}>
          <UploadCard
            state={uploadState} error={uploadError}
            onPick={onPick} onDrop={onDrop} lastRun={lastWorkbook}
          />
          <EmailSyncCard onDone={onEmailDone} enabled={h ? !!h.inbox?.enabled : null} onEvent={onEmailEvent} nextRun={nextRun} />
          <WhatsappCard onOpenBatch={onOpen} linked={h ? h.whatsapp.worker_alive && h.whatsapp.state === "connected" : null} onRun={onWaRun} />
        </div>
      </div>

      {/* live run */}
      {run && <RunPanel run={run} onDismiss={() => setRun(null)} onOpenBatch={onOpenBatchId} />}

      {/* recent batches */}
      <div>
        <div className="ds-row" style={{ marginBottom: 10 }}>
          <SectionLabel>Recent batches</SectionLabel>
          <button type="button" onClick={onGoHistory}
            className="ds-push"
            style={{ border: 0, background: "transparent", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600, color: C.blue }}>
            Full history →
          </button>
        </div>
        {batches.length === 0 ? (
          <Card><div className="ds-empty">No syncs yet. Upload a workbook, or run the inbox, to stage your first batch.</div></Card>
        ) : (
          <div className="ds-scroll-x">
            <table className="ds-table ds-table--dense">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th>Source</th>
                  <th className="ds-table__num">New</th>
                  <th className="ds-table__num">Upd</th>
                  <th className="ds-table__num">Blocked</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const t = Object.values(b.counts ?? {}).reduce(
                    (a, c) => ({ n: a.n + (c.new ?? 0), u: a.u + (c.updated ?? 0), i: a.i + (c.invalid ?? 0) }),
                    { n: 0, u: 0, i: 0 },
                  );
                  const SrcIcon = b.source === "email" ? Mail : b.source === "whatsapp" ? MessageSquare : FileSpreadsheet;
                  return (
                    <tr key={b.id}>
                      <td>
                        <div className="ds-table__name">{b.label ?? b.id.slice(0, 8)}</div>
                        <div className="ds-table__meta">{b.file_name ?? "—"}</div>
                      </td>
                      <td>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: C.ink2 }}>
                          <SrcIcon size={14} />
                          {b.source === "email" ? "Circular" : b.source === "whatsapp" ? "WhatsApp" : "Workbook"}
                        </span>
                      </td>
                      <td className="ds-table__num" style={{ color: t.n ? C.green : C.ink3 }}>{t.n}</td>
                      <td className="ds-table__num" style={{ color: t.u ? C.amber : C.ink3 }}>{t.u}</td>
                      <td className="ds-table__num" style={{ color: t.i ? C.red : C.ink3 }}>{t.i}</td>
                      <td><Badge tone={toneForStatus(b.status)}>{batchStatusLabel(b.status)}</Badge></td>
                      <td className="ds-table__meta" style={{ whiteSpace: "nowrap" }}><LocalTime iso={b.created_at} /></td>
                      <td>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <Btn size="sm" onClick={() => onOpen(b)}>Review</Btn>
                          {batchActions(b.status).undo && (
                            <Btn size="sm" kind="danger" icon={<RotateCcw size={13} />}
                              busy={busy === "undo"} onClick={() => onUndo(b)}>Undo</Btn>
                          )}
                          {batchActions(b.status).regate && (
                            <Btn size="sm" busy={busy === "regate"} title="Run the data-quality gate on this batch again"
                              onClick={() => onRegate(b)}>Run gate</Btn>
                          )}
                          {batchActions(b.status).discard && (
                            <Btn size="sm" kind="danger" icon={<Trash2 size={13} />}
                              busy={busy === "discard"} onClick={() => onDiscard(b)}>Discard</Btn>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

// Data Sync — the module UI. Two views behind one screen:
//   • Sync Workspace — upload the CargoMap workbook (→ a review batch) + recent batches
//   • Review — per-sheet tab strip, batch summary, row-level diff, per-tab / global commit
// Backed entirely by the Phase 1 RPCs + Phase 2/3 actions; the browser never
// writes to a live table. Visual language matches the approved prototype.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Upload, FileSpreadsheet, Loader2, Check, AlertTriangle, RotateCcw,
  Trash2, Database, Mail, Info, Lock, X, Pencil,
} from "lucide-react";
import {
  commitSheet, commitAll, commitSelection, editStagedRow, undoBatch, discardBatch, listStaged, getBatch,
  findMatches, sendMatchTeaser,
  type BatchMeta, type StagedRowView, type MatchView,
} from "@/app/(admin)/admin/data-sync/actions";
import { previewTable, coerce, type PreviewCol } from "@/lib/sync/preview";
import { PreviewView } from "./PreviewView";
import { ManualReviewView } from "./ManualReviewView";
import { SettingsView } from "./SettingsView";
import { EmailSyncCard } from "./EmailSyncCard";
import { WhatsappCard } from "./WhatsappCard";
import { C, btn, cell } from "./ui";

type SheetInfo = { id: string; label: string; table: string };
type SheetCount = { new: number; updated: number; unchanged: number; invalid: number; errors: number };
const ZERO: SheetCount = { new: 0, updated: 0, unchanged: 0, invalid: 0, errors: 0 };

// A child sheet can only be committed on its own AFTER its parent sheets (which
// it references by foreign key) are committed. Cargo rows reference ports.
// "Sync all" always commits in dependency order, so it's never blocked.
const DEPENDS: Record<string, string[]> = { cargo: ["ports"] };
const REVIEW_PAGE = 100; // staged rows fetched per page in Review

const CLASS_META: Record<string, { label: string; c: string; bg: string }> = {
  new: { label: "NEW", c: C.green, bg: C.greenBg },
  updated: { label: "UPD", c: C.amber, bg: C.amberBg },
  unchanged: { label: "—", c: C.ink3, bg: C.sunken },
  invalid: { label: "ERR", c: C.red, bg: C.redBg },
};

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

function Pill({ cls }: { cls: string }) {
  const m = CLASS_META[cls] ?? CLASS_META.unchanged;
  return (
    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: m.c, background: m.bg, padding: "2px 6px", borderRadius: 3 }}>
      {m.label}
    </span>
  );
}

export function DataSyncClient({
  sheets, initialBatches, initialQueuePending = 0,
}: { sheets: SheetInfo[]; initialBatches: BatchMeta[]; initialQueuePending?: number }) {
  const router = useRouter();
  const tableFor = useMemo(() => Object.fromEntries(sheets.map((s) => [s.id, s.table])), [sheets]);
  const labelFor = useMemo(() => Object.fromEntries(sheets.map((s) => [s.id, s.label])), [sheets]);

  const [view, setView] = useState<"sync" | "review" | "preview" | "manual" | "settings">("sync");
  const [batch, setBatch] = useState<BatchMeta | null>(null);
  const [uploadState, setUploadState] = useState<"idle" | "parsing" | "error">("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);

  // review state
  const [activeSheet, setActiveSheet] = useState<string>(sheets[0]?.id ?? "cargo");
  const [changesOnly, setChangesOnly] = useState(true);
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

  const terminal = batch ? ["committed", "undone", "committing", "failed"].includes(batch.status) : true;
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
      const res = await listStaged(batchId, sheet, { changesOnly: changes, limit: REVIEW_PAGE, offset });
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

  const refreshBatch = useCallback(async (id: string) => {
    const res = await getBatch(id);
    if (res.success && res.data) setBatch(res.data);
  }, []);

  // ── upload ────────────────────────────────────────────────────────────────
  const openBatch = useCallback(
    async (b: BatchMeta) => {
      setBatch(b);
      setCommitted(b.status === "committed" ? new Set(sheets.map((s) => s.id)) : new Set());
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
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`${r.data.inserted + r.data.updated} rows → ${tableFor[sheetId]} · ${r.data.inserted} new · ${r.data.updated} updated`);
    setCommitted((s) => new Set(s).add(sheetId));
    await refreshBatch(batch.id);
    await loadRows(batch.id, activeSheet, changesOnly, reviewOffset);
    router.refresh();
  };

  const doCommitAll = async () => {
    if (!batch) return;
    setBusy("all");
    const r = await commitAll(batch.id);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Batch committed · ${r.data.inserted} inserted · ${r.data.updated} updated`);
    setCommitted(new Set(sheets.map((s) => s.id)));
    await refreshBatch(batch.id);
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
    toast.success(`${r.data.inserted + r.data.updated} selected row(s) → ${tableFor[activeSheet]} · ${r.data.inserted} new · ${r.data.updated} updated`);
    await refreshBatch(batch.id);
    await reloadCurrent();
    router.refresh();
  };

  const doUndo = async (b: BatchMeta) => {
    if (!confirm(`Undo batch ${b.label ?? b.id.slice(0, 8)}? This restores every row it changed and removes rows it inserted.`)) return;
    setBusy("undo");
    const r = await undoBatch(b.id);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Undone · ${r.data.reverted} restored · ${r.data.deleted} removed`);
    setCommitted(new Set());
    if (batch?.id === b.id) await refreshBatch(b.id);
    router.refresh();
  };

  const doDiscard = async (b: BatchMeta) => {
    if (!confirm(`Discard draft batch ${b.label ?? b.id.slice(0, 8)}? Staged rows are deleted; nothing was committed.`)) return;
    setBusy("discard");
    const r = await discardBatch(b.id);
    setBusy(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success("Draft discarded.");
    if (batch?.id === b.id) { setBatch(null); setView("sync"); }
    router.refresh();
  };

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ color: C.ink }}>
      {/* view switch */}
      <div style={{ display: "flex", gap: 2, borderBottom: `1px solid ${C.line}`, marginBottom: 20 }}>
        {([
          { id: "sync", label: "Sync Workspace", badge: 0 },
          { id: "review", label: "Review", badge: pendingCommit ? totals.new + totals.updated : 0 },
          { id: "preview", label: "Database Preview", badge: 0 },
          { id: "manual", label: "Manual Review", badge: queuePending },
          { id: "settings", label: "Settings", badge: 0 },
        ] as const).map((t) => {
          const on = view === t.id;
          const disabled = t.id === "review" && !batch;
          return (
            <button key={t.id} disabled={disabled}
              onClick={() => !disabled && setView(t.id)}
              style={{ padding: "9px 16px", border: "none", background: "transparent", cursor: disabled ? "default" : "pointer",
                font: "inherit", fontSize: 14, fontWeight: on ? 600 : 500, color: disabled ? C.ink3 : on ? C.navy : C.ink2,
                borderBottom: `2px solid ${on ? C.brass : "transparent"}`, marginBottom: -1, opacity: disabled ? 0.5 : 1 }}>
              {t.label}
              {t.badge > 0 && (
                <span style={{ marginLeft: 8, minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: t.id === "manual" ? C.navy : C.brass, color: "#fff", fontSize: 11, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {view === "sync" && (
        <SyncView
          uploadState={uploadState} uploadError={uploadError}
          onPick={() => fileRef.current?.click()}
          onDrop={(f) => handleFile(f)}
          batches={initialBatches}
          sheets={sheets}
          onOpen={openBatch} onUndo={doUndo} onDiscard={doDiscard} busy={busy}
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
          onUndo={() => doUndo(batch)} onDiscard={() => doDiscard(batch)}
        />
      )}
      {view === "preview" && <PreviewView />}
      {view === "manual" && <ManualReviewView onPendingChange={setQueuePending} />}
      {view === "settings" && <SettingsView />}

      <input ref={fileRef} type="file" accept=".xlsx" hidden
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
    </div>
  );
}

// ── Sync Workspace ──────────────────────────────────────────────────────────
function SyncView(props: {
  uploadState: "idle" | "parsing" | "error"; uploadError: string | null;
  onPick: () => void; onDrop: (f: File) => void;
  batches: BatchMeta[]; sheets: SheetInfo[];
  onOpen: (b: BatchMeta) => void; onUndo: (b: BatchMeta) => void; onDiscard: (b: BatchMeta) => void;
  busy: string | null; onEmailDone: (batchId: string) => void;
}) {
  const { uploadState, uploadError, onPick, onDrop, batches, onOpen, onUndo, onDiscard, busy, onEmailDone } = props;
  const [drag, setDrag] = useState(false);

  return (
    <div style={{ maxWidth: 1240 }}>
      {/* Three intake sources side by side (stack on narrow screens). */}
      <div className="ds-src3">
        {/* upload */}
        <div className="ds-src3-card">
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) onDrop(f); }}
          onClick={uploadState === "parsing" ? undefined : onPick}
          style={{ border: `2px dashed ${drag ? C.brass : C.line}`, borderRadius: 12, padding: "34px 22px", textAlign: "center", height: "100%", boxSizing: "border-box",
            cursor: uploadState === "parsing" ? "default" : "pointer", background: drag ? "#fffdf6" : C.card, transition: "border-color .14s,background .14s" }}
        >
          {uploadState === "parsing" ? (
            <>
              <Loader2 size={30} color={C.brass} style={{ margin: "0 auto 12px", animation: "spin 1s linear infinite" }} />
              <div style={{ fontSize: 15, fontWeight: 600, color: C.navy }}>Parsing &amp; diffing…</div>
              <div style={{ fontSize: 13, color: C.ink3, marginTop: 4 }}>Matching by REF / IMO / LOCODE against the live database</div>
            </>
          ) : (
            <>
              <div style={{ width: 52, height: 52, borderRadius: 12, background: C.sunken, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: C.brass }}>
                <Upload size={24} />
              </div>
              <div style={{ fontSize: 15.5, fontWeight: 600, color: C.navy, marginBottom: 4 }}>Upload the CargoMap workbook</div>
              <div style={{ fontSize: 13, color: C.ink3, marginBottom: 14 }}>Drop the .xlsx here, or click to choose · max 10 MB</div>
              <span style={{ ...btn("primary"), display: "inline-flex" }}><FileSpreadsheet size={15} /> Choose file</span>
            </>
          )}
          {uploadState === "error" && uploadError && (
            <div style={{ marginTop: 14, fontSize: 12.5, color: C.red, display: "flex", gap: 6, justifyContent: "center", alignItems: "center" }}>
              <AlertTriangle size={14} /> {uploadError}
            </div>
          )}
        </div>
        </div>

        {/* email → LLM source */}
        <div className="ds-src3-card">
          <EmailSyncCard onDone={onEmailDone} />
        </div>

        {/* whatsapp → LLM source */}
        <div className="ds-src3-card">
          <WhatsappCard onOpenBatch={onOpen} />
        </div>
      </div>

      {/* recent batches */}
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: C.ink3, marginBottom: 10 }}>Recent batches</div>
      {batches.length === 0 ? (
        <div style={{ padding: "28px 20px", textAlign: "center", color: C.ink3, fontSize: 14, border: `1px solid ${C.line}`, borderRadius: 10, background: C.card }}>
          No syncs yet. Upload a workbook to stage your first batch.
        </div>
      ) : (
        <div style={{ border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", background: C.card }}>
          {batches.map((b, i) => {
            const t = Object.values(b.counts ?? {}).reduce(
              (a, c) => ({ n: a.n + (c.new ?? 0), u: a.u + (c.updated ?? 0), e: a.e + (c.errors ?? 0) }), { n: 0, u: 0, e: 0 });
            const statusColor = b.status === "committed" ? C.green : b.status === "undone" ? C.ink3 : b.status === "failed" ? C.red : C.amber;
            return (
              <div key={b.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderTop: i ? `1px solid ${C.line}` : "none" }}>
                <span style={{ width: 34, height: 34, borderRadius: 8, background: b.source === "email" ? C.greenBg : C.brassBg, color: b.source === "email" ? C.green : C.brassDeep, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {b.source === "email" ? <Mail size={17} /> : <FileSpreadsheet size={17} />}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>
                    {b.label ?? b.id.slice(0, 8)}
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", color: statusColor, textTransform: "uppercase" }}>{b.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: C.ink3, fontFamily: C.mono }}>
                    {b.file_name ?? "—"} · {t.n} new · {t.u} upd{t.e ? ` · ${t.e} err` : ""} · <LocalTime iso={b.created_at} />
                  </div>
                </div>
                <button onClick={() => onOpen(b)} style={btn("ghost")}>Review</button>
                {b.status === "committed" && (
                  <button onClick={() => onUndo(b)} disabled={busy === "undo"} style={btn("danger")}>
                    {busy === "undo" ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={14} />} Undo
                  </button>
                )}
                {(b.status === "draft" || b.status === "failed") && (
                  <button onClick={() => onDiscard(b)} disabled={busy === "discard"} style={btn("danger")}>
                    <Trash2 size={14} /> Discard
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      <style>{`
        @keyframes spin{to{transform:rotate(360deg)}}
        .ds-src3{display:flex;gap:16px;align-items:stretch;margin-bottom:24px}
        .ds-src3-card{flex:1 1 0;min-width:0;border-radius:12px}
        .ds-src3-card>div{height:100%;box-sizing:border-box}
        @media(max-width:1080px){.ds-src3{flex-direction:column}}
      `}</style>
    </div>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────
function ReviewView(props: {
  batch: BatchMeta; sheets: SheetInfo[]; tableFor: Record<string, string>; labelFor: Record<string, string>;
  activeSheet: string; setActiveSheet: (s: string) => void;
  changesOnly: boolean; setChangesOnly: (b: boolean) => void;
  rows: StagedRowView[]; total: number; rowsLoading: boolean;
  offset: number; page: number; setOffset: (fn: (o: number) => number) => void;
  totals: SheetCount; countsFor: (id: string) => SheetCount;
  committed: Set<string>; canCommitSheet: (id: string) => boolean; pendingCommit: boolean; terminal: boolean;
  commitBlockedReason: (id: string) => string | null;
  busy: string | null;
  onCommitSheet: (id: string) => void; onCommitAll: () => void;
  onCommitSelection: (ids: string[]) => void; onReload: () => Promise<void>;
  onUndo: () => void; onDiscard: () => void;
}) {
  const {
    batch, sheets, tableFor, labelFor, activeSheet, setActiveSheet, changesOnly, setChangesOnly,
    rows, total, rowsLoading, offset, page, setOffset,
    totals, countsFor, committed, canCommitSheet, pendingCommit, terminal,
    commitBlockedReason, busy, onCommitSheet, onCommitAll, onCommitSelection, onReload, onUndo, onDiscard,
  } = props;

  const blockedReason = commitBlockedReason(activeSheet);

  const stat = (n: number, label: string, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>{n}</span>
      <span style={{ fontSize: 11, color: C.ink3 }}>{label}</span>
    </div>
  );

  return (
    <div>
      {/* summary bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 26, flexWrap: "wrap", padding: "16px 20px", background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ width: 40, height: 40, borderRadius: 9, background: batch.source === "email" ? C.greenBg : C.brassBg, color: batch.source === "email" ? C.green : C.brassDeep, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {batch.source === "email" ? <Mail size={20} /> : <FileSpreadsheet size={20} />}
          </span>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600, color: C.navy }}>
              {batch.label ?? batch.id.slice(0, 8)}
              <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: terminal ? (batch.status === "committed" ? C.green : C.ink3) : C.amber }}>{batch.status}</span>
            </div>
            <div style={{ fontSize: 12, color: C.ink3, fontFamily: C.mono }}>{batch.file_name ?? batch.source}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {stat(totals.new, "to insert", C.green)}
          {stat(totals.updated, "to update", C.amber)}
          {stat(totals.invalid, "invalid", totals.invalid ? C.red : C.ink3)}
          {stat(totals.errors, "flagged", totals.errors ? C.amber : C.ink3)}
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
          {batch.status === "committed" ? (
            <button onClick={onUndo} disabled={busy === "undo"} style={btn("danger")}>
              {busy === "undo" ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <RotateCcw size={14} />} Undo batch
            </button>
          ) : (
            <button onClick={onDiscard} disabled={!!busy} style={btn("ghost")}>Discard</button>
          )}
          <button onClick={onCommitAll} disabled={!pendingCommit || !!busy} style={{ ...btn("primary"), opacity: pendingCommit && !busy ? 1 : 0.45, cursor: pendingCommit && !busy ? "pointer" : "default" }}>
            {busy === "all" ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> : <Check size={15} />} Sync all{pendingCommit ? ` (${totals.new + totals.updated})` : ""}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", minHeight: 340, border: `1px solid ${C.line}`, borderRadius: 10, overflow: "hidden", background: C.card }}>
        {/* tab strip */}
        <div style={{ width: 190, flex: "none", borderRight: `1px solid ${C.line}`, padding: "8px 0", background: C.sunken }}>
          {sheets.map((s) => {
            const c = countsFor(s.id);
            const pend = c.new + c.updated;
            const on = s.id === activeSheet;
            const done = committed.has(s.id) || batch.status === "committed";
            const blocked = pend > 0 && !done && !!commitBlockedReason(s.id);
            return (
              <button key={s.id} onClick={() => setActiveSheet(s.id)}
                style={{ width: "100%", textAlign: "left", border: "none", background: on ? C.card : "transparent", cursor: "pointer",
                  padding: "9px 14px", display: "flex", alignItems: "center", gap: 8, font: "inherit",
                  borderLeft: `3px solid ${on ? C.brass : "transparent"}` }}>
                <span style={{ fontSize: 13, fontWeight: on ? 600 : 500, color: on ? C.navy : C.ink2, flex: 1 }}>{s.label}</span>
                {done && pend > 0 ? <Check size={15} color={C.green} /> :
                  blocked ? <Lock size={13} color={C.ink3} /> :
                  pend > 0 ? <span title={c.errors ? `${c.errors} flagged` : undefined} style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: c.errors ? C.redBg : C.brassBg, color: c.errors ? C.red : C.brassDeep, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{pend}</span> :
                  c.invalid > 0 ? <span title={`${c.invalid} invalid — cannot sync`} style={{ minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, background: C.redBg, color: C.red, fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", cursor: "help" }}>{c.invalid}</span> : null}
              </button>
            );
          })}
        </div>

        {/* panel */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "12px 18px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>{labelFor[activeSheet]}</div>
              <div style={{ fontSize: 12, color: C.ink3, fontFamily: C.mono }}>→ {tableFor[activeSheet]}</div>
            </div>
            <label style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: C.ink2, cursor: "pointer", userSelect: "none" }}>
              <span onClick={() => setChangesOnly(!changesOnly)} style={{ width: 34, height: 20, borderRadius: 10, background: changesOnly ? C.brass : C.line, position: "relative", flex: "none", transition: "background .15s" }}>
                <span style={{ position: "absolute", top: 2, left: changesOnly ? 16 : 2, width: 16, height: 16, borderRadius: "50%", background: "#fff", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
              </span>
              Changes only
            </label>
            {/* Blocked sheets keep the button clickable so the click explains why. */}
            <button onClick={() => onCommitSheet(activeSheet)} disabled={!canCommitSheet(activeSheet) || !!busy}
              title={blockedReason ?? undefined}
              style={{ ...btn("dark"), opacity: canCommitSheet(activeSheet) && !busy && !blockedReason ? 1 : 0.45, cursor: canCommitSheet(activeSheet) && !busy ? "pointer" : "default" }}>
              {busy === activeSheet ? <Loader2 size={15} style={{ animation: "spin 1s linear infinite" }} /> :
                blockedReason ? <Lock size={15} /> : <Check size={15} />}
              {blockedReason
                ? "Commit parents first"
                : `Sync ${countsFor(activeSheet).new + countsFor(activeSheet).updated} to ${tableFor[activeSheet]}`}
            </button>
          </div>
          {blockedReason && (
            <div style={{ padding: "8px 18px", background: C.brassBg, borderBottom: `1px solid ${C.line}`, fontSize: 12.5, color: C.brassDeep, display: "flex", alignItems: "center", gap: 8 }}>
              <Lock size={13} /> {blockedReason}
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto" }}>
            {rowsLoading ? (
              <div style={{ padding: 40, textAlign: "center", color: C.ink3 }}>
                <Loader2 size={20} style={{ animation: "spin 1s linear infinite" }} />
              </div>
            ) : rows.length === 0 ? (
              <div style={{ padding: "44px 20px", textAlign: "center", color: C.ink3, fontSize: 14 }}>
                {changesOnly ? "No changes in this tab — everything already matches the database." : "No rows staged for this sheet."}
              </div>
            ) : (
              <DiffTable rows={rows} sheetId={activeSheet}
                onCommitSelection={onCommitSelection} onReload={onReload}
                busy={busy} blockedReason={blockedReason} tableLabel={tableFor[activeSheet]} />
            )}
          </div>

          {/* pager — page through the whole staged sheet, not just the first page */}
          {total > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 18px", borderTop: `1px solid ${C.line}`, fontSize: 12.5, color: C.ink3 }}>
              <span><Database size={13} style={{ verticalAlign: "-2px" }} /> {offset + 1}–{Math.min(offset + page, total)} of {total.toLocaleString()} {changesOnly ? "changed " : ""}rows</span>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button onClick={() => setOffset((o) => Math.max(0, o - page))} disabled={offset === 0 || rowsLoading}
                  style={{ ...btn("ghost"), padding: "6px 12px", opacity: offset === 0 ? 0.4 : 1, cursor: offset === 0 ? "default" : "pointer" }}>Prev</button>
                <span style={{ display: "inline-flex", alignItems: "center", padding: "0 6px", fontVariantNumeric: "tabular-nums" }}>
                  Page {Math.floor(offset / page) + 1} / {Math.max(1, Math.ceil(total / page))}
                </span>
                <button onClick={() => setOffset((o) => o + page)} disabled={offset + page >= total || rowsLoading}
                  style={{ ...btn("ghost"), padding: "6px 12px", opacity: offset + page >= total ? 0.4 : 1, cursor: offset + page >= total ? "default" : "pointer" }}>Next</button>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// ── the diff table (columnar grid, one column per field) ────────────────────
// Columns are derived from the data in first-seen order and always include any
// column that changed, so every edited field is visible. Changed cells show the
// old value struck-through above the new value (amber). Matches the prototype's
// renderDiffTable. Wide sheets scroll horizontally; Δ stays pinned left.
function DiffTable({ rows, sheetId, onCommitSelection, onReload, busy, blockedReason, tableLabel }: {
  rows: StagedRowView[]; sheetId: string;
  onCommitSelection: (ids: string[]) => void; onReload: () => Promise<void>;
  busy: string | null; blockedReason: string | null; tableLabel: string;
}) {
  const cols = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      for (const k of Object.keys(r.payload)) {
        const v = r.payload[k];
        if (!seen.has(k) && v !== null && v !== "" && k !== "is_spot") { seen.add(k); out.push(k); }
      }
      if (r.diff) for (const k of Object.keys(r.diff)) if (!seen.has(k)) { seen.add(k); out.push(k); }
      // Always surface a column for a flagged field, even if its value is null —
      // otherwise a "missing X" error would have no cell to highlight.
      for (const f of r.flags) if (f.field && !seen.has(f.field)) { seen.add(f.field); out.push(f.field); }
    }
    return out;
  }, [rows]);

  const hasSource = rows.some((r) => r.source);
  const [srcDrawer, setSrcDrawer] = useState<StagedRowView | null>(null);
  const [editRow, setEditRow] = useState<StagedRowView | null>(null);

  // A row can be committed on its own only if it's new/updated and not yet committed.
  const selectable = (r: StagedRowView) => !r.committed && (r.classification === "new" || r.classification === "updated");
  const [sel, setSel] = useState<Set<string>>(new Set());
  useEffect(() => { let x = false; (async () => { await Promise.resolve(); if (!x) setSel(new Set()); })(); return () => { x = true; }; }, [rows]);
  const selectableIds = rows.filter(selectable).map((r) => r.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => sel.has(id));
  const toggleAll = () => setSel(() => (allSelected ? new Set() : new Set(selectableIds)));
  const toggleOne = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const th: React.CSSProperties = { textAlign: "left", padding: "9px 12px", fontSize: 11, fontWeight: 600, letterSpacing: ".03em", textTransform: "uppercase", color: C.ink3, background: "#fafbfc", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 1 };
  const td: React.CSSProperties = { padding: "7px 12px", borderBottom: `1px solid ${C.line}`, fontSize: 13, whiteSpace: "nowrap", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis" };

  const busySel = busy === "selection";
  return (
    <>
    {/* selection toolbar */}
    {sel.size > 0 && (
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", background: C.brassBg, borderBottom: `1px solid ${C.brass}` }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.brassDeep }}>{sel.size} selected</span>
        <button onClick={() => !blockedReason && onCommitSelection([...sel])} disabled={busySel || !!blockedReason}
          title={blockedReason ?? undefined}
          style={{ ...btn("dark"), opacity: busySel || blockedReason ? 0.5 : 1 }}>
          {busySel ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : blockedReason ? <Lock size={14} /> : <Check size={14} />}
          Sync {sel.size} selected to {tableLabel}
        </button>
        <button onClick={() => setSel(new Set())} style={{ ...btn("ghost"), marginLeft: "auto" }}>Clear</button>
      </div>
    )}
    <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
      <thead>
        <tr>
          <th style={{ ...th, width: 128, position: "sticky", left: 0, zIndex: 3 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={selectableIds.length === 0} aria-label="Select all committable rows" />
              <span>Δ</span>
            </div>
          </th>
          {cols.map((c) => <th key={c} style={th}>{c}</th>)}
          {hasSource && <th style={{ ...th, width: 66 }}>Source</th>}
          <th style={{ ...th, width: 74 }}>Flags</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const errs = r.flags.filter((f) => f.level === "error");
          const warns = r.flags.filter((f) => f.level === "warn");
          const infos = r.flags.filter((f) => f.level === "info");
          const hasErr = errs.length > 0;
          const bg = r.committed ? "#fafcfb" : hasErr ? "#fdf3f3" : r.classification === "new" ? "#f4fbf6" : r.classification === "updated" ? "#fdfaf3" : "#fff";
          const bar = hasErr ? C.red : r.classification === "new" ? C.green : r.classification === "updated" ? C.brass : "transparent";
          // Which specific cell each flag points at → highlight that cell.
          const cellFlag = new Map<string, { level: "error" | "warn"; msg: string }>();
          for (const f of r.flags) {
            if (!f.field || (f.level !== "error" && f.level !== "warn")) continue;
            const prev = cellFlag.get(f.field);
            if (!prev || (prev.level === "warn" && f.level === "error")) cellFlag.set(f.field, { level: f.level, msg: f.msg });
          }
          return (
            <tr key={r.id} style={{ background: bg, borderLeft: `3px solid ${bar}`, opacity: r.committed ? 0.6 : 1 }}>
              <td style={{ ...td, position: "sticky", left: 0, background: bg, zIndex: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" checked={sel.has(r.id)} disabled={!selectable(r)} onChange={() => toggleOne(r.id)} aria-label={`Select ${r.business_key ?? r.id}`} />
                  <Pill cls={r.classification} />
                  {r.committed ? <Check size={12} color={C.green} /> : (
                    <button onClick={() => setEditRow(r)} title="Edit this record" style={{ border: "none", background: "transparent", cursor: "pointer", color: C.ink3, padding: 2, display: "inline-flex" }}><Pencil size={13} /></button>
                  )}
                </div>
              </td>
              {cols.map((c) => {
                const ch = r.diff?.[c];
                const val = cell(ch ? ch.new : r.payload[c]);
                const flag = cellFlag.get(c);
                const flagBg = flag?.level === "error" ? "#f2b8b8" : flag?.level === "warn" ? "#f1ddb2" : undefined;
                return (
                  <td key={c} style={{ ...td, background: flagBg ?? (ch ? "#fbf3e0" : undefined), verticalAlign: ch ? "top" : "middle",
                    color: flag?.level === "error" ? C.red : undefined, fontWeight: flag ? 600 : undefined,
                    cursor: flag ? "help" : undefined }}
                    title={flag ? flag.msg : ch ? `${cell(ch.old)} → ${val}` : String(r.payload[c] ?? "")}>
                    {ch ? (
                      <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
                        <span style={{ color: C.ink3, textDecoration: "line-through", fontSize: 11 }}>{cell(ch.old)}</span>
                        <span style={{ color: flag?.level === "error" ? C.red : C.amber, fontWeight: 600 }}>{val}</span>
                      </span>
                    ) : val}
                  </td>
                );
              })}
              {hasSource && (
                <td style={td}>
                  {r.source ? (
                    <button onClick={() => setSrcDrawer(r)} title="View the source email"
                      style={{ display: "inline-flex", alignItems: "center", gap: 4, border: `1px solid ${C.line}`, background: "#fff", color: C.navy2, borderRadius: 5, padding: "3px 8px", cursor: "pointer", font: "inherit", fontSize: 12 }}>
                      <Mail size={12} /> View
                    </button>
                  ) : null}
                </td>
              )}
              <td style={td}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {errs.length > 0 && <span title={errs.map((f) => f.msg).join("\n")} style={{ color: C.red, display: "inline-flex", alignItems: "center", gap: 3, cursor: "help", fontSize: 12 }}><AlertTriangle size={14} />{errs.length}</span>}
                  {warns.length > 0 && <span title={warns.map((f) => f.msg).join("\n")} style={{ color: C.amber, display: "inline-flex", cursor: "help" }}><AlertTriangle size={14} /></span>}
                  {infos.length > 0 && <span title={infos.map((f) => f.msg).join("\n")} style={{ color: C.brassDeep, display: "inline-flex", cursor: "help" }}><Info size={14} /></span>}
                  {errs.length + warns.length + infos.length === 0 && <Check size={14} color={C.green} />}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
    {srcDrawer && <SourceDrawer row={srcDrawer} sheetId={sheetId} onClose={() => setSrcDrawer(null)} />}
    {editRow && <StagedEditDrawer row={editRow} sheetId={sheetId} onClose={() => setEditRow(null)}
      onSaved={async () => { setEditRow(null); await onReload(); }} />}
    </>
  );
}

// Edit a staged record before it's committed — same typed fields as Database
// Preview; on save the server re-validates + re-diffs so fixing a value clears
// its error and the row can then be synced.
function StagedEditDrawer({ row, sheetId, onClose, onSaved }: {
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
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

// Build the "extracted fields" list from a staged row's payload (curated for
// cargo/vessels, generic otherwise) — the right pane of the Source drawer.
function extractedFields(payload: Record<string, unknown>, sheetId: string): { label: string; value: string }[] {
  const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  const n = (v: unknown) => (typeof v === "number" ? v.toLocaleString("en-US") : s(v));
  const join = (...parts: (string | null)[]) => parts.filter(Boolean).join(" · ") || null;
  const port = (name: string, loc: string, zone: string) => {
    const nm = s(payload[name]); const lc = s(payload[loc]); const zn = s(payload[zone]);
    if (!nm && !lc && !zn) return null;
    return `${nm ?? "—"}${lc ? ` (${lc})` : ""}${zn ? ` · ${zn}` : ""}`;
  };
  let pairs: [string, string | null][];
  if (sheetId === "cargo") {
    const qty = payload.qty_min_mt != null || payload.qty_max_mt != null ? `${n(payload.qty_min_mt) ?? "—"} – ${n(payload.qty_max_mt) ?? "—"}` : null;
    pairs = [
      ["REF", s(payload.ref)],
      ["CARGO_TYPE", s(payload.cargo_type)],
      ["COMMODITY", s(payload.commodity_name)],
      ["LOAD", port("load_port_name", "load_port_locode", "load_zone")],
      ["DISCHARGE", port("disch_port_name", "disch_port_locode", "disch_zone")],
      ["QTY (MT)", qty],
      ["LAYCAN", join(s(payload.laycan_from), s(payload.laycan_to))],
      ["ASB_REGIME", s(payload.asb_regime)],
      ["LOAD / DISCH RATE", join(s(payload.load_rate), s(payload.disch_rate))],
      ["LAYTIME", s(payload.laytime_structure)],
      ["LOAD_TERMS", s(payload.load_terms)],
      ["FREIGHT (USD/MT)", n(payload.freight_idea_usd_mt)],
      ["COMMISSION_PCT", n(payload.commission_pct)],
      ["BROKER", s(payload.broker)],
      ["NOTES", s(payload.notes)],
    ];
  } else if (sheetId === "vessels") {
    pairs = [
      ["IMO", s(payload.imo_number)],
      ["VESSEL_NAME", s(payload.vessel_name)],
      ["VESSEL_TYPE", s(payload.vessel_type)],
      ["DWT", n(payload.dwt_grain)],
      ["FLAG", s(payload.flag)],
      ["BUILT", s(payload.build_year)],
    ];
  } else {
    pairs = Object.entries(payload).filter(([k, v]) => v != null && v !== "" && k !== "is_spot").map(([k, v]) => [k.toUpperCase(), n(v)]);
  }
  return pairs.filter(([, v]) => v != null).map(([label, value]) => ({ label, value: value as string }));
}

// The message behind a channel-sourced row: original text + contact beside the
// parsed record, plus the match panel (live DB + staged drafts) and — for
// WhatsApp rows — the admin-triggered masked teaser send.
function SourceDrawer({ row, sheetId, onClose }: { row: StagedRowView; sheetId: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const source = row.source!;
  const isWa = source.channel === "whatsapp";
  const fields = extractedFields(row.payload, sheetId);
  const [matches, setMatches] = useState<MatchView[] | null | "loading">(null);
  const [sendingTeaser, setSendingTeaser] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runMatches = async () => {
    setMatches("loading");
    const r = await findMatches(row.id);
    if (!r.success) { toast.error(r.error); setMatches(null); return; }
    setMatches(r.data);
  };

  const sendTeaser = async () => {
    if (!source.msgId) return;
    if (!confirm("Send the masked match summary to this contact on WhatsApp?")) return;
    setSendingTeaser(true);
    const r = await sendMatchTeaser(source.msgId, row.id);
    setSendingTeaser(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(r.data.status === "queued" ? "Teaser queued — the worker sends it in seconds." : "Teaser sent.");
  };

  const bandColor = (b: string) => (b === "Strong" ? C.green : b === "Good" ? C.amber : C.ink3);

  return (
    <div ref={ref} onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}
      style={{ position: "fixed", inset: 0, background: "rgba(10,26,47,.34)", zIndex: 60, display: "flex", justifyContent: "flex-end" }}>
      <div style={{ width: "min(920px, 96vw)", height: "100%", background: "#fff", boxShadow: "-8px 0 32px rgba(0,0,0,.18)", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 20px", borderBottom: `1px solid ${C.line}` }}>
          <Pill cls={row.classification} />
          <span style={{ fontSize: 14.5, fontWeight: 600, color: C.navy }}>Circulation → extracted record</span>
          <button onClick={onClose} style={{ marginLeft: "auto", border: "none", background: "transparent", cursor: "pointer", color: C.ink2, padding: 4 }} aria-label="Close"><X size={18} /></button>
        </div>
        <div style={{ flex: 1, display: "flex", minHeight: 0 }} className="ds-src-panes">
          {/* left — original message + contact */}
          <div style={{ flex: 1, minWidth: 0, borderRight: `1px solid ${C.line}`, padding: "16px 20px", overflowY: "auto", background: C.sunken }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: C.ink3, marginBottom: 6 }}>
              {isWa ? "ORIGINAL WHATSAPP MESSAGE" : "ORIGINAL EMAIL"}
            </div>
            {isWa ? (
              <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "10px 12px", marginBottom: 10 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#e7f6ee", color: "#1f8a4c", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {(source.name ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>{source.name ?? "Unknown contact"}</div>
                  <div style={{ fontSize: 12, color: C.ink3, fontFamily: C.mono }}>{(source.from ?? "").replace("@s.whatsapp.net", "")}{source.date ? ` · ${new Date(source.date).toLocaleString()}` : ""}</div>
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 12, color: C.ink3, fontFamily: C.mono }}>{source.from || "—"}{source.date ? ` · ${new Date(source.date).toLocaleString()}` : ""}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: C.navy, margin: "6px 0 10px" }}>{source.subject || "(no subject)"}</div>
              </>
            )}
            <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: C.mono, fontSize: 12.5, color: C.ink, margin: 0, lineHeight: 1.55, background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "12px 14px" }}>
              {source.text || "(no body captured)"}
            </pre>
          </div>
          {/* right — extracted fields + matches */}
          <div style={{ flex: 1, minWidth: 0, padding: "16px 20px", overflowY: "auto" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: C.ink3, marginBottom: 10 }}>EXTRACTED FIELDS</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {fields.map((f) => (
                <div key={f.label}>
                  <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".05em", color: C.ink3, marginBottom: 2 }}>{f.label}</div>
                  <div style={{ fontSize: 13.5, color: C.ink }}>{f.value}</div>
                </div>
              ))}
            </div>

            {(sheetId === "cargo" || sheetId === "vessels") && (
              <div style={{ marginTop: 20, paddingTop: 16, borderTop: `1px solid ${C.line}` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", color: C.ink3 }}>MATCHES</span>
                  <button onClick={runMatches} disabled={matches === "loading"} style={{ ...btn("ghost"), padding: "5px 10px", fontSize: 12 }}>
                    {matches === "loading" ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Database size={13} />}
                    {matches === null ? "Find matches" : "Refresh"}
                  </button>
                  {isWa && source.msgId && Array.isArray(matches) && (
                    <button onClick={sendTeaser} disabled={sendingTeaser} style={{ ...btn("primary"), padding: "5px 10px", fontSize: 12, marginLeft: "auto" }}>
                      {sendingTeaser ? <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> : <Mail size={13} />} Send summary to contact
                    </button>
                  )}
                </div>
                {Array.isArray(matches) && (
                  matches.length === 0 ? (
                    <div style={{ fontSize: 13, color: C.ink3 }}>No matches in the live database or staged drafts.</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {matches.map((m, i) => (
                        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, border: `1px solid ${C.line}`, borderRadius: 7, padding: "7px 10px" }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: bandColor(m.band), border: `1px solid ${bandColor(m.band)}`, borderRadius: 3, padding: "1px 5px" }}>{m.band.toUpperCase()}</span>
                          <span style={{ fontWeight: 600, color: C.navy }}>{m.label}</span>
                          <span style={{ color: C.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.facts.join(" · ")}</span>
                          <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: m.origin === "live" ? C.green : C.brassDeep, background: m.origin === "live" ? C.greenBg : C.brassBg, padding: "1px 6px", borderRadius: 3 }}>{m.origin.toUpperCase()}</span>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <style>{`@media(max-width:720px){.ds-src-panes{flex-direction:column!important}}`}</style>
    </div>
  );
}

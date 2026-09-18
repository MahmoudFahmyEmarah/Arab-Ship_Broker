"use client";

// Review — triage one staged batch before it is written.
//
// The design's layout: a batch header with clickable figure tiles, a chip row
// for the sheets, then the rows grouped by what the gate decided (new /
// updated / blocked), each row opening the detail drawer. The old columnar
// diff table is kept behind a "Table" toggle for wide side-by-side comparison.
//
// Commit, undo, discard, paging and the dependency rule are all passed in from
// DataSyncClient — this file decides nothing about what may be written.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Anchor, Check, Database, Info, Lock, Mail, MessageCircle, Pencil,
  AlertTriangle, Loader2, RotateCcw,
} from "lucide-react";
import {
  syncVesselPositions,
  type BatchMeta, type StagedRowView,
} from "@/app/(admin)/admin/data-sync/actions";
import { StagedEditDrawer } from "./StagedEditDrawer";
import { RowDrawer } from "./RowDrawer";
import { rowSummary } from "@/lib/sync/present";
import { DupPairs } from "./DupPairs";
import { Badge, Btn, Card, Chip, SectionLabel, Seg, Switch, cell, toneForStatus, C } from "./ui";
import { batchActions, batchStatusLabel } from "@/lib/sync/batch-status";

type SheetInfo = { id: string; label: string; table: string };
type SheetCount = { new: number; updated: number; unchanged: number; invalid: number; errors: number };

const CLASS_TONE = {
  new: "new", updated: "updated", invalid: "invalid", unchanged: "neutral",
} as const;

/** Groups render in pipeline order — what blocks first, then what is ready. */
const GROUP_ORDER: (keyof typeof CLASS_TONE)[] = ["invalid", "updated", "new", "unchanged"];
const GROUP_NOTE: Record<string, string> = {
  invalid: "Blocked by the gate — fix the flagged field before committing.",
  updated: "Already in the database; these fields would change.",
  new: "Not in the database — these would be inserted.",
  unchanged: "Identical to the database. Nothing to do.",
};

type Figure = "all" | "new" | "updated" | "invalid";

export function ReviewView(props: {
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
  onUndo: () => void; onDiscard: () => void; onRegate: () => void;
  /** phase 6: when given, the figure tiles filter on the server and `rows` arrive already filtered */
  onFigureChange?: (f: Figure) => void;
}) {
  const {
    batch, sheets, tableFor, labelFor, activeSheet, setActiveSheet, changesOnly, setChangesOnly,
    rows, total, rowsLoading, offset, page, setOffset,
    totals, countsFor, committed, canCommitSheet, pendingCommit, terminal,
    commitBlockedReason, busy, onCommitSheet, onCommitAll, onCommitSelection, onReload, onUndo, onDiscard, onRegate, onFigureChange,
  } = props;

  const blockedReason = commitBlockedReason(activeSheet);
  const [figure, setFigure] = useState<Figure>("all");
  const [mode, setMode] = useState<"grouped" | "table">("grouped");
  const [sel, setSel] = useState<Set<string>>(new Set());
  // The drawer holds an id, not a row: after a reload the row object is new,
  // and deriving it here keeps the open drawer on the freshest copy without
  // mirroring server state into a second piece of client state.
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<StagedRowView | null>(null);

  // A new page of rows invalidates the selection — the ids are no longer on screen.
  useEffect(() => {
    let cancelled = false;
    (async () => { await Promise.resolve(); if (!cancelled) setSel(new Set()); })();
    return () => { cancelled = true; };
  }, [rows]);

  // Post 02_VESSELS open positions into vessel_availability (STATUS=Open rows).
  const [posting, setPosting] = useState(false);
  const postPositions = async () => {
    setPosting(true);
    const r = await syncVesselPositions(batch.id);
    setPosting(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Open positions posted — ${r.data.posted} open · ${r.data.closed} closed · ${r.data.skipped} skipped.`);
    await onReload();
  };

  // phase 6: with a server-side figure filter the rows arrive already filtered
  const serverFiltered = onFigureChange != null;
  const visible = useMemo(
    () => (figure === "all" || serverFiltered ? rows : rows.filter((r) => r.classification === figure)),
    [rows, figure, serverFiltered],
  );

  const groups = useMemo(() => {
    const m = new Map<string, StagedRowView[]>();
    for (const r of visible) {
      const list = m.get(r.classification);
      if (list) list.push(r); else m.set(r.classification, [r]);
    }
    return GROUP_ORDER.filter((g) => m.has(g)).map((g) => ({ cls: g, rows: m.get(g)! }));
  }, [visible]);

  const drawerRow = drawerId ? rows.find((r) => r.id === drawerId) ?? null : null;

  // Keyboard triage (design: J K X ↵). Only while no drawer/input has focus.
  const [focusId, setFocusId] = useState<string | null>(null);

  const selectable = (r: StagedRowView) => !r.committed && (r.classification === "new" || r.classification === "updated");
  const toggleOne = (id: string) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroup = (rs: StagedRowView[]) => {
    const ids = rs.filter(selectable).map((r) => r.id);
    const allOn = ids.length > 0 && ids.every((id) => sel.has(id));
    setSel((p) => {
      const n = new Set(p);
      for (const id of ids) { if (allOn) n.delete(id); else n.add(id); }
      return n;
    });
  };

  const pendingHere = countsFor(activeSheet).new + countsFor(activeSheet).updated;
  const SrcIcon = batch.source === "email" ? Mail : batch.source === "whatsapp" ? MessageCircle : Database;

  const figures: { id: Figure; n: number; label: string; color: string }[] = [
    { id: "all", n: totals.new + totals.updated + totals.invalid, label: "in this batch", color: C.navy },
    { id: "new", n: totals.new, label: "to insert", color: totals.new ? C.green : C.ink3 },
    { id: "updated", n: totals.updated, label: "to update", color: totals.updated ? C.amber : C.ink3 },
    { id: "invalid", n: totals.invalid, label: "blocked", color: totals.invalid ? C.red : C.ink3 },
  ];

  // Row order as displayed, so the drawer's "Next row" follows what's on screen.
  const ordered = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const nextAfter = (id: string) => {
    const i = ordered.findIndex((r) => r.id === id);
    return i >= 0 && i < ordered.length - 1 ? ordered[i + 1] : null;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (drawerId || editRow || mode !== "grouped" || ordered.length === 0) return;
      const i = focusId ? ordered.findIndex((r) => r.id === focusId) : -1;
      if (e.key === "j" || e.key === "J" || e.key === "ArrowDown") { e.preventDefault(); setFocusId(ordered[Math.min(ordered.length - 1, i + 1)].id); }
      else if (e.key === "k" || e.key === "K" || e.key === "ArrowUp") { e.preventDefault(); setFocusId(ordered[Math.max(0, i - 1)].id); }
      else if ((e.key === "x" || e.key === "X") && i >= 0) { e.preventDefault(); if (selectable(ordered[i])) toggleOne(ordered[i].id); }
      else if (e.key === "Enter" && i >= 0) { e.preventDefault(); setDrawerId(ordered[i].id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div className="ds-stack">
      {/* ── batch header ─────────────────────────────────────────────────── */}
      <Card flush>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap", padding: "14px 16px" }}>
          <span style={{ width: 38, height: 38, borderRadius: "var(--r-soft-10)", flex: "none", background: batch.source === "email" ? C.greenBg : C.brassBg, color: batch.source === "email" ? C.green : C.brassDeep, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <SrcIcon size={19} />
          </span>
          <div style={{ flex: "1 1 220px", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 15, fontWeight: 600, color: C.navy }}>{batch.label ?? batch.id.slice(0, 8)}</span>
              <Badge tone={toneForStatus(batch.status)}>{batchStatusLabel(batch.status)}</Badge>
            </div>
            <div className="ds-rowsub" style={{ marginTop: 2 }}>{batch.file_name ?? batch.source}</div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {batchActions(batch.status).undo && (
              <Btn kind="danger" icon={<RotateCcw size={14} />} busy={busy === "undo"} onClick={onUndo}>Undo batch</Btn>
            )}
            {batchActions(batch.status).discard && (
              <Btn kind="ghost" disabled={!!busy} onClick={onDiscard}>Discard</Btn>
            )}
            {(batchActions(batch.status).regate || batchActions(batch.status).commit) && (
              <Btn kind="ghost" busy={busy === "regate"} disabled={!!busy} title="Run the data-quality gate on this batch again — needed after edits, after a rule change, or when staging could not run it" onClick={onRegate}>Run the gate</Btn>
            )}
            {batchActions(batch.status).commit && (
              <Btn
                kind="primary" icon={<Check size={15} />} busy={busy === "all"}
                disabled={!pendingCommit || !!busy}
                title="Commits every sheet in dependency order"
                onClick={onCommitAll}
              >
                Sync all{pendingCommit ? ` (${totals.new + totals.updated})` : ""}
              </Btn>
            )}
          </div>
        </div>

        {/* clickable figures — each one filters the list below */}
        <div className="ds-figs">
          {figures.map((f) => (
            <button
              key={f.id} type="button"
              className={`ds-fig${figure === f.id ? " is-active" : ""}`}
              onClick={() => { setFigure(f.id); onFigureChange?.(f.id); }}
              title={f.id === "all" ? "Show everything staged" : `Show only rows classified ${f.id}`}
            >
              <div className="ds-fig__n" style={{ color: f.color }}>{f.n}</div>
              <div className="ds-fig__label">{f.label}</div>
            </button>
          ))}
        </div>

        {blockedReason && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 16px", background: C.brassBg, borderTop: "1px solid var(--ccx-line2)", fontSize: 12.5, color: C.brassDeep }}>
            <Lock size={13} /> {blockedReason}
          </div>
        )}
      </Card>

      {/* ── sheet chips + controls ───────────────────────────────────────── */}
      <div className="ds-row">
        <SectionLabel>Sheet</SectionLabel>
        {sheets.map((s) => {
          const c = countsFor(s.id);
          const pend = c.new + c.updated;
          const done = committed.has(s.id) || batch.status === "committed";
          const locked = pend > 0 && !done && !!commitBlockedReason(s.id);
          return (
            <Chip
              key={s.id} active={s.id === activeSheet} onClick={() => setActiveSheet(s.id)}
              count={pend || c.invalid}
              countTone={c.invalid && !pend ? "danger" : c.errors ? "warn" : undefined}
              title={locked ? commitBlockedReason(s.id) ?? undefined : `${s.label} → ${s.table}`}
              icon={
                done && pend > 0 ? <Check size={13} color={C.green} />
                  : locked ? <Lock size={12} color={C.ink3} />
                  : undefined
              }
            >
              {s.label}
            </Chip>
          );
        })}
        <div className="ds-push" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Switch checked={changesOnly} onChange={setChangesOnly} label="Changes only" />
          <span className="ds-note" title="Keyboard triage works while no field has focus">
            <span className="ds-kbd">J</span> <span className="ds-kbd">K</span> move · <span className="ds-kbd">X</span> select · <span className="ds-kbd">↵</span> open
          </span>
          <Seg
            value={mode} onChange={setMode}
            options={[{ value: "grouped", label: "Grouped" }, { value: "table", label: "Table" }] as const}
          />
        </div>
      </div>

      {/* per-sheet actions */}
      <div className="ds-row">
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: C.navy }}>{labelFor[activeSheet]}</div>
          <div className="ds-rowsub">→ {tableFor[activeSheet]}</div>
        </div>
        <div className="ds-push" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {activeSheet === "vessels" && (
            <Btn
              busy={posting} disabled={!!busy} icon={<Anchor size={15} />}
              title="Create/refresh open-position postings (vessel_availability) from the workbook's STATUS=Open rows"
              onClick={postPositions}
            >
              Post open positions
            </Btn>
          )}
          {/* Blocked sheets keep the button clickable so the click explains why. */}
          <Btn
            kind="accent" busy={busy === activeSheet}
            disabled={!canCommitSheet(activeSheet) || !!busy}
            icon={blockedReason ? <Lock size={15} /> : <Check size={15} />}
            title={blockedReason ?? undefined}
            onClick={() => onCommitSheet(activeSheet)}
          >
            {blockedReason ? "Commit parents first" : `Sync ${pendingHere} to ${tableFor[activeSheet]}`}
          </Btn>
        </div>
      </div>

      {/* ── duplicate pairs (DQ-U03 / DQ-U04) ────────────────────────────── */}
      {!terminal && <DupPairs batchId={batch.id} onMerged={onReload} />}

      {/* ── selection bar ────────────────────────────────────────────────── */}
      {sel.size > 0 && (
        <div className="ds-selbar">
          <span className="ds-selbar__n">{sel.size} selected</span>
          <Btn
            kind="accent" busy={busy === "selection"} disabled={!!blockedReason || !!busy}
            icon={blockedReason ? <Lock size={14} /> : <Check size={14} />}
            title={blockedReason ?? undefined}
            onClick={() => !blockedReason && onCommitSelection([...sel])}
          >
            Sync {sel.size} selected to {tableFor[activeSheet]}
          </Btn>
          <Btn kind="ghost" className="ds-push" onClick={() => setSel(new Set())}>Clear</Btn>
        </div>
      )}

      {/* ── rows ─────────────────────────────────────────────────────────── */}
      {rowsLoading ? (
        <Card><div className="ds-empty"><Loader2 size={20} className="ds-spin" /></div></Card>
      ) : visible.length === 0 ? (
        <Card>
          <div className="ds-empty">
            {figure !== "all"
              ? `No rows classified “${figure}” on this page.`
              : changesOnly
                ? "No changes in this sheet — everything already matches the database."
                : "No rows staged for this sheet."}
          </div>
        </Card>
      ) : mode === "table" ? (
        <Card flush>
          <div className="ds-scroll-x">
            <DiffTable
              rows={visible} sel={sel} onToggle={toggleOne}
              selectable={selectable} onEdit={setEditRow} onOpen={(r) => setDrawerId(r.id)}
            />
          </div>
        </Card>
      ) : (
        <div className="ds-stack">
          {groups.map((g) => {
            const ids = g.rows.filter(selectable).map((r) => r.id);
            const allOn = ids.length > 0 && ids.every((id) => sel.has(id));
            return (
              <div key={g.cls} className="ds-group">
                <div className="ds-group__head">
                  <Badge tone={CLASS_TONE[g.cls]}>{g.cls}</Badge>
                  <span className="ds-group__count">{g.rows.length} row{g.rows.length === 1 ? "" : "s"}</span>
                  <span className="ds-group__note">{GROUP_NOTE[g.cls]}</span>
                  {ids.length > 0 && (
                    <label className="ds-push" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: C.ink2, cursor: "pointer" }}>
                      <input type="checkbox" checked={allOn} onChange={() => toggleGroup(g.rows)} />
                      Select group
                    </label>
                  )}
                </div>
                <Card flush>
                  <div className="ds-scroll-x">
                    <table className="ds-table ds-table--dense ds-table--rows">
                      <tbody>
                        {g.rows.map((r) => {
                          const errs = r.flags.filter((f) => f.level === "error");
                          const warns = r.flags.filter((f) => f.level === "warn");
                          const reason = errs[0]?.msg ?? warns[0]?.msg
                            ?? (r.diff ? `${Object.keys(r.diff).length} field${Object.keys(r.diff).length === 1 ? "" : "s"} differ` : "");
                          return (
                            <tr key={r.id} onClick={() => setDrawerId(r.id)} className={focusId === r.id ? "is-focus" : undefined}
                              tabIndex={0} role="button" aria-label={`Open ${r.business_key ?? "row"} — ${reason || r.classification}`}
                              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawerId(r.id); } }}
                              onFocus={() => setFocusId(r.id)}
                              onMouseEnter={() => setFocusId(r.id)} style={{ opacity: r.committed ? 0.6 : 1 }}>
                              <td style={{ width: 34 }} onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox" checked={sel.has(r.id)} disabled={!selectable(r)}
                                  onChange={() => toggleOne(r.id)}
                                  aria-label={`Select ${r.business_key ?? r.id}`}
                                />
                              </td>
                              <td style={{ minWidth: 130 }}>
                                <div className="ds-rowkey">{r.business_key ?? r.id.slice(0, 8)}</div>
                                <div className="ds-rowsub">{labelFor[activeSheet]}</div>
                              </td>
                              <td style={{ minWidth: 220 }}>
                                <div className="ds-rowsummary">{rowSummary(r.payload, activeSheet)}</div>
                                {reason && <div className="ds-rowsub">{reason}</div>}
                              </td>
                              <td style={{ width: 120 }}>
                                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                  {errs.length > 0 && <span className="ds-flagchip ds-flagchip--error" title={errs.map((f) => f.msg).join("\n")}>{errs.length} error</span>}
                                  {warns.length > 0 && <span className="ds-flagchip" title={warns.map((f) => f.msg).join("\n")}>{warns.length} warn</span>}
                                  {errs.length + warns.length === 0 && <Check size={14} color={C.green} />}
                                </div>
                              </td>
                              <td style={{ width: 54 }} onClick={(e) => e.stopPropagation()}>
                                {r.source && (
                                  <span title={`From ${r.source.channel}`} style={{ color: C.ink3, display: "inline-flex" }}>
                                    {r.source.channel === "whatsapp" ? <MessageCircle size={14} /> : <Mail size={14} />}
                                  </span>
                                )}
                              </td>
                              <td style={{ width: 66, textAlign: "right" }}>
                                {r.committed ? <Check size={14} color={C.green} /> : <span className="ds-open">Open →</span>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      )}

      {/* pager — page through the whole staged sheet, not just the first page */}
      {total > 0 && (
        <div className="ds-row" style={{ fontSize: 12.5, color: C.ink3 }}>
          <span>
            <Database size={13} style={{ verticalAlign: "-2px" }} />{" "}
            {offset + 1}–{Math.min(offset + page, total)} of {total.toLocaleString()} {changesOnly ? "changed " : ""}rows
            {figure !== "all" && ` · showing ${visible.length} ${figure}`}
          </span>
          <div className="ds-push" style={{ display: "flex", gap: 6 }}>
            <Btn size="sm" disabled={offset === 0 || rowsLoading} onClick={() => setOffset((o) => Math.max(0, o - page))}>Prev</Btn>
            <span style={{ display: "inline-flex", alignItems: "center", padding: "0 6px", fontVariantNumeric: "tabular-nums" }}>
              Page {Math.floor(offset / page) + 1} / {Math.max(1, Math.ceil(total / page))}
            </span>
            <Btn size="sm" disabled={offset + page >= total || rowsLoading} onClick={() => setOffset((o) => o + page)}>Next</Btn>
          </div>
        </div>
      )}

      {drawerRow && (
        <RowDrawer
          row={drawerRow} sheetId={activeSheet}
          sheetLabel={labelFor[activeSheet]} tableLabel={tableFor[activeSheet]}
          batch={batch} blockedReason={blockedReason} busy={busy}
          onClose={() => setDrawerId(null)}
          onReload={onReload}
          onCommitRow={(id) => onCommitSelection([id])}
          onNext={(() => { const n = nextAfter(drawerRow.id); return n ? () => setDrawerId(n.id) : null; })()}
        />
      )}
      {editRow && (
        <StagedEditDrawer
          row={editRow} sheetId={activeSheet} onClose={() => setEditRow(null)}
          onSaved={async () => { setEditRow(null); await onReload(); }}
        />
      )}
      {batch.status === "committed" && (
        <div className="ds-note">This batch is committed. Undo restores every row it changed and removes every row it inserted.</div>
      )}
      {batch.status === "partial" && (
        <div className="ds-note">This batch is partly committed: some rows are in the live tables, the rest still wait. Commit the rest, or undo what was written — it cannot be discarded.</div>
      )}
      {batch.status === "gate_failed" && (
        <div className="ds-note" style={{ color: C.red }}>The data-quality gate could not run on this batch, so nothing can be committed from it. Run the gate again; if it keeps failing, the rule it names needs fixing in Data quality → Rules.</div>
      )}
    </div>
  );
}

// ── the columnar diff table (kept as the wide side-by-side view) ────────────
// Columns are derived from the data in first-seen order and always include any
// column that changed, so every edited field is visible. Changed cells show the
// old value struck-through above the new value (amber). Wide sheets scroll
// horizontally; the Δ column stays pinned left.
function DiffTable({ rows, sel, onToggle, selectable, onEdit, onOpen }: {
  rows: StagedRowView[];
  sel: Set<string>;
  onToggle: (id: string) => void;
  selectable: (r: StagedRowView) => boolean;
  onEdit: (r: StagedRowView) => void;
  onOpen: (r: StagedRowView) => void;
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

  const td: React.CSSProperties = { whiteSpace: "nowrap", maxWidth: 230, overflow: "hidden", textOverflow: "ellipsis" };

  return (
    <table className="ds-table ds-table--dense">
      <thead>
        <tr>
          <th style={{ width: 118, position: "sticky", left: 0, zIndex: 3 }}>Δ</th>
          {cols.map((c) => <th key={c}>{c}</th>)}
          <th style={{ width: 74 }}>Flags</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const errs = r.flags.filter((f) => f.level === "error");
          const warns = r.flags.filter((f) => f.level === "warn");
          const infos = r.flags.filter((f) => f.level === "info");
          const hasErr = errs.length > 0;
          const bg = r.committed ? C.sunken : hasErr ? C.redBg : r.classification === "new" ? C.greenBg : r.classification === "updated" ? C.amberBg : C.card;
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
              <td style={{ position: "sticky", left: 0, background: bg, zIndex: 2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox" checked={sel.has(r.id)} disabled={!selectable(r)}
                    onChange={() => onToggle(r.id)}
                    aria-label={`Select ${r.business_key ?? r.id}`}
                  />
                  <Badge tone={CLASS_TONE[r.classification]}>{r.classification.slice(0, 3)}</Badge>
                  {r.committed ? <Check size={12} color={C.green} /> : (
                    <>
                      <button type="button" onClick={() => onEdit(r)} title="Edit this record"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: C.ink3, padding: 2, display: "inline-flex" }}>
                        <Pencil size={13} />
                      </button>
                      <button type="button" onClick={() => onOpen(r)} title="Open the row detail"
                        style={{ border: "none", background: "transparent", cursor: "pointer", color: C.blue, padding: 2, display: "inline-flex", fontSize: 11, fontWeight: 600 }}>
                        →
                      </button>
                    </>
                  )}
                </div>
              </td>
              {cols.map((c) => {
                const ch = r.diff?.[c];
                const val = cell(ch ? ch.new : r.payload[c]);
                const flag = cellFlag.get(c);
                const flagBg = flag?.level === "error" ? C.redBg : flag?.level === "warn" ? C.amberBg : undefined;
                return (
                  <td key={c} style={{ ...td, background: flagBg ?? (ch ? C.brassBg : undefined), verticalAlign: ch ? "top" : "middle",
                    color: flag?.level === "error" ? C.red : undefined, fontWeight: flag ? 600 : undefined,
                    cursor: flag ? "help" : undefined }}
                    title={flag ? flag.msg : ch ? `${cell(ch.old)} → ${val}` : String(r.payload[c] ?? "")}>
                    {ch ? (
                      <span style={{ display: "inline-flex", flexDirection: "column", lineHeight: 1.2 }}>
                        <span className="ds-was">{cell(ch.old)}</span>
                        <span className="ds-now" style={{ color: flag?.level === "error" ? C.red : undefined, fontWeight: 600 }}>{val}</span>
                      </span>
                    ) : val}
                  </td>
                );
              })}
              <td>
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
  );
}

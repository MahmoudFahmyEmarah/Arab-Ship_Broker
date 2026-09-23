"use client";

// Review → row detail. The design's slide-over: one staged row seen four ways.
//
//   Changes  what the file/circular would alter, field by field (row.diff)
//   Checks   the gate flags on the row, each with an inline single-field fix
//   Source   the original message + extracted fields + live/draft matches
//   History  where this row came from and what has happened to it
//
// Every write goes through an action that already existed — editStagedRow for a
// fix, commitSelection for the row commit, sendMatchTeaser for the WhatsApp
// summary. The drawer introduces no server logic.

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Database, Mail, MessageCircle, AlertTriangle, Info } from "lucide-react";
import {
  editStagedRow, findMatches, sendMatchTeaser, restoreMergedRow,
  type BatchMeta, type MatchView, type StagedRowView,
} from "@/app/(admin)/admin/data-sync/actions";
import { extractedFields, rowSummary } from "@/lib/sync/present";
export { extractedFields, rowSummary };
import { previewTable, coerce, type PreviewCol } from "@/lib/sync/preview";
import { Badge, Btn, Drawer, DrawerSection, Seg, cell, relTime, C } from "./ui";

type Panel = "changes" | "checks" | "source" | "history";

const CLASS_TONE = {
  new: "new", updated: "updated", invalid: "invalid", unchanged: "neutral",
} as const;

const LEVEL_ICON = { error: AlertTriangle, warn: AlertTriangle, info: Info } as const;

export function RowDrawer({
  row, sheetId, sheetLabel, tableLabel, batch, blockedReason, busy,
  onClose, onReload, onCommitRow, onNext,
}: {
  row: StagedRowView;
  sheetId: string;
  sheetLabel: string;
  tableLabel: string;
  batch: BatchMeta;
  blockedReason: string | null;
  busy: string | null;
  onClose: () => void;
  onReload: () => Promise<void>;
  onCommitRow: (id: string) => void;
  /** Advance to the next row in the current list, or null at the end. */
  onNext: (() => void) | null;
}) {
  const [panel, setPanel] = useState<Panel>(
    row.flags.some((f) => f.level === "error") ? "checks" : row.diff ? "changes" : row.source ? "source" : "changes",
  );

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const changes = useMemo(
    () => Object.entries(row.diff ?? {}).map(([field, v]) => ({ field, old: v.old, next: v.new })),
    [row.diff],
  );

  const canCommit = !row.committed && (row.classification === "new" || row.classification === "updated");

  return (
    <Drawer
      title={row.business_key ?? row.id.slice(0, 8)}
      sub={`${sheetLabel} → ${tableLabel}${row.row_index != null ? ` · row ${row.row_index}` : ""}`}
      onClose={onClose}
      head={<Badge tone={CLASS_TONE[row.classification]}>{row.classification}</Badge>}
      foot={
        <>
          <Btn
            kind="primary" icon={<Check size={15} />}
            busy={busy === "selection"}
            disabled={!canCommit || !!blockedReason}
            title={blockedReason ?? (canCommit ? `Commit this row to ${tableLabel}` : "Nothing to commit on this row")}
            onClick={() => onCommitRow(row.id)}
          >
            {row.committed ? "Already synced" : `Sync this row to ${tableLabel}`}
          </Btn>
          {onNext && <Btn kind="ghost" onClick={onNext}>Next row →</Btn>}
        </>
      }
    >
      <div className="ds-drawer__section" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Seg
          value={panel} onChange={setPanel}
          options={[
            { value: "changes", label: "Changes", count: changes.length },
            { value: "checks", label: "Checks", count: row.flags.length },
            { value: "source", label: "Source" },
            { value: "history", label: "History" },
          ] as const}
        />
      </div>

      {panel === "changes" && <ChangesPanel row={row} changes={changes} onReload={onReload} />}
      {panel === "checks" && <ChecksPanel row={row} sheetId={sheetId} onReload={onReload} />}
      {panel === "source" && <SourcePanel row={row} sheetId={sheetId} />}
      {panel === "history" && <HistoryPanel row={row} sheetLabel={sheetLabel} tableLabel={tableLabel} batch={batch} />}
    </Drawer>
  );
}

// ── Changes ─────────────────────────────────────────────────────────────────
// "Take file" is what a commit does by default. "Keep database" writes the
// database value back onto the staged row through editStagedRow, which
// re-diffs it — so the field drops out of the diff and the commit leaves it
// alone. Both are reversible until the row is committed.
function ChangesPanel({ row, changes, onReload }: {
  row: StagedRowView;
  changes: { field: string; old: unknown; next: unknown }[];
  onReload: () => Promise<void>;
}) {
  const [busyField, setBusyField] = useState<string | null>(null);
  const [decided, setDecided] = useState<Record<string, "file" | "db">>({});
  const merged = row.flags.find((f) => f.msg.startsWith("merged into"));
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    setRestoring(true);
    const r = await restoreMergedRow(row.id);
    setRestoring(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(`Restored — now ${r.data.classification}.`);
    await onReload();
  };
  const keepDb = async (field: string, dbValue: unknown) => {
    setBusyField(field);
    const r = await editStagedRow(row.id, { [field]: dbValue });
    setBusyField(null);
    if (!r.success) { toast.error(r.error); return; }
    setDecided((d) => ({ ...d, [field]: "db" }));
    toast.success(`Kept the database value for ${field}.`);
    await onReload();
  };
  if (merged) {
    return (
      <DrawerSection label="Merged">
        <div className="ds-note" style={{ fontSize: 13 }}>
          This row was merged into another as a duplicate. It is parked as “unchanged” and will not be committed.
        </div>
        <div style={{ marginTop: 10 }}>
          <Btn size="sm" busy={restoring} onClick={restore}>Restore this row</Btn>
        </div>
      </DrawerSection>
    );
  }
  if (changes.length === 0) {
    return (
      <DrawerSection label="Changes">
        <div className="ds-note" style={{ fontSize: 13 }}>
          {row.classification === "new"
            ? "This row is new — nothing to compare. Every field will be inserted as shown in Source."
            : "No field differs from the database. This row is already in sync."}
        </div>
      </DrawerSection>
    );
  }
  return (
    <DrawerSection label={`Changes · ${changes.length} field${changes.length === 1 ? "" : "s"}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {changes.map((ch) => {
          const flag = row.flags.find((f) => f.field === ch.field);
          return (
            <div key={ch.field} className="ds-change">
              <div className="ds-change__head">
                <span className="ds-change__field">{ch.field}</span>
                {flag && <span className="ds-change__reason">{flag.msg}</span>}
              </div>
              <div className="ds-change__cols">
                <div className="ds-change__col">
                  <div className="ds-change__collabel">In the database</div>
                  <div className="ds-change__colvalue" style={{ color: C.ink3, textDecoration: "line-through" }}>{cell(ch.old)}</div>
                </div>
                <div className="ds-change__col">
                  <div className="ds-change__collabel">From this batch</div>
                  <div className="ds-change__colvalue" style={{ color: C.amber, fontWeight: 600 }}>{cell(ch.next)}</div>
                </div>
              </div>
              {!row.committed && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", padding: "7px 11px", borderTop: "1px solid var(--ccx-line2)", flexWrap: "wrap" }}>
                  <Btn size="sm" kind={decided[ch.field] === "db" ? "ghost" : "accent"} disabled={!!busyField}
                    onClick={() => setDecided((d) => ({ ...d, [ch.field]: "file" }))}>Take file</Btn>
                  <Btn size="sm" kind="ghost" busy={busyField === ch.field} disabled={!!busyField && busyField !== ch.field}
                    onClick={() => keepDb(ch.field, ch.old)}>Keep database</Btn>
                  <span className="ds-note">
                    {decided[ch.field] === "db" ? "Database value kept — this field is no longer in the diff." : "Commit applies the file value (default)."}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="ds-note" style={{ marginTop: 10 }}>
        “Take file” is what a commit does by default. “Keep database” rewrites the staged value to match the database, so the commit leaves that field alone.
      </div>
    </DrawerSection>
  );
}

// ── Checks ──────────────────────────────────────────────────────────────────
// Each flag that names a field gets an inline editor. Saving calls the existing
// editStagedRow, which re-validates and re-diffs server-side — so a fixed field
// clears its own error without any new validation path here.
function ChecksPanel({ row, sheetId, onReload }: {
  row: StagedRowView; sheetId: string; onReload: () => Promise<void>;
}) {
  const pt = previewTable(sheetId);
  const colFor = (field?: string): PreviewCol | undefined =>
    field ? pt?.columns.find((c) => c.col === field && c.editable !== false) : undefined;

  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const fix = async (field: string, col: PreviewCol) => {
    setSaving(field);
    const r = await editStagedRow(row.id, { [field]: coerce(col.type, draft[field] ?? "") });
    setSaving(null);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(r.data.classification === "invalid" ? "Saved — the row still has errors." : "Saved — the row is ready to sync.");
    await onReload();
  };

  if (row.flags.length === 0) {
    return (
      <DrawerSection label="Gate checks">
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: C.green }}>
          <Check size={15} /> All gate rules pass. This row is clean.
        </div>
      </DrawerSection>
    );
  }

  return (
    <DrawerSection label={`Gate checks · ${row.flags.length}`}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {row.flags.map((f, i) => {
          const col = colFor(f.field);
          const level = (f.level === "error" || f.level === "warn" ? f.level : "info") as keyof typeof LEVEL_ICON;
          const Icon = LEVEL_ICON[level];
          const tint = level === "error" ? C.red : level === "warn" ? C.amber : C.blue;
          const key = f.field ?? `flag-${i}`;
          return (
            <div key={key} className="ds-change">
              <div className="ds-change__head">
                <span style={{ display: "inline-flex", color: tint }}><Icon size={14} /></span>
                <span className="ds-change__field" style={{ color: tint, textTransform: "uppercase" }}>{level}</span>
                {f.field && <span className="ds-change__reason">field {f.field}</span>}
              </div>
              <div style={{ padding: "8px 11px", fontSize: 13, color: C.ink }}>{f.msg}</div>
              {col && (
                <div style={{ display: "flex", gap: 8, padding: "0 11px 10px", alignItems: "center", flexWrap: "wrap" }}>
                  <input
                    className="ds-input" style={{ flex: "1 1 180px", width: "auto" }}
                    value={draft[col.col] ?? (row.payload[col.col] == null ? "" : String(row.payload[col.col]))}
                    onChange={(e) => setDraft((d) => ({ ...d, [col.col]: e.target.value }))}
                    placeholder={col.label}
                  />
                  <Btn size="sm" kind="accent" busy={saving === col.col} onClick={() => fix(col.col, col)}>
                    Fix &amp; re-check
                  </Btn>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DrawerSection>
  );
}

// ── Source ──────────────────────────────────────────────────────────────────
function SourcePanel({ row, sheetId }: { row: StagedRowView; sheetId: string }) {
  const source = row.source;
  const [matches, setMatches] = useState<MatchView[] | null | "loading">(null);
  const [sending, setSending] = useState(false);
  const fields = useMemo(() => extractedFields(row.payload, sheetId), [row.payload, sheetId]);

  const runMatches = async () => {
    setMatches("loading");
    const r = await findMatches(row.id);
    if (!r.success) { toast.error(r.error); setMatches(null); return; }
    setMatches(r.data);
  };

  const sendTeaser = async () => {
    if (!source?.msgId) return;
    if (!confirm("Send the masked match summary to this contact on WhatsApp?")) return;
    setSending(true);
    const r = await sendMatchTeaser(source.msgId, row.id);
    setSending(false);
    if (!r.success) { toast.error(r.error); return; }
    toast.success(r.data.status === "queued" ? "Teaser queued — the worker sends it in seconds." : "Teaser sent.");
  };

  const band = (b: string) => (b === "Strong" ? C.green : b === "Good" ? C.amber : C.ink3);
  const isWa = source?.channel === "whatsapp";

  return (
    <>
      {source ? (
        <DrawerSection label={isWa ? "Original WhatsApp message" : "Original email"}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 9 }}>
            <span style={{ width: 30, height: 30, borderRadius: "50%", flex: "none", background: isWa ? C.greenBg : C.brassBg, color: isWa ? C.green : C.brassDeep, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isWa ? <MessageCircle size={15} /> : <Mail size={15} />}
            </span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: C.navy }}>
                {source.name ?? source.subject ?? "(no subject)"}
              </div>
              <div className="ds-rowsub">
                {(source.from ?? "—").replace("@s.whatsapp.net", "")}
                {source.date ? ` · ${relTime(source.date)}` : ""}
              </div>
            </div>
          </div>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: C.mono, fontSize: 12.5, color: C.ink, margin: 0, lineHeight: 1.55, background: C.sunken, borderRadius: "var(--r-soft-10)", padding: "11px 13px", maxHeight: 260, overflow: "auto" }}>
            {source.text || "(no body captured)"}
          </pre>
          <div className="ds-note" style={{ marginTop: 8 }}>PII is masked before the model call.</div>
        </DrawerSection>
      ) : (
        <DrawerSection label="Source">
          <div className="ds-note" style={{ fontSize: 13 }}>
            This row came from the workbook{row.row_index != null ? ` — row ${row.row_index}` : ""}. There is no message behind it.
          </div>
        </DrawerSection>
      )}

      <DrawerSection label="Extracted fields">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 11 }}>
          {fields.map((f) => (
            <div key={f.label}>
              <div className="ds-change__collabel">{f.label}</div>
              <div style={{ fontSize: 13, color: C.ink, overflowWrap: "anywhere" }}>{f.value}</div>
            </div>
          ))}
        </div>
      </DrawerSection>

      {(sheetId === "cargo" || sheetId === "vessels") && (
        <DrawerSection label="Matches">
          <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
            <Btn size="sm" busy={matches === "loading"} icon={<Database size={13} />} onClick={runMatches}>
              {matches === null ? "Find matches" : "Refresh"}
            </Btn>
            {isWa && source?.msgId && Array.isArray(matches) && (
              <Btn size="sm" kind="primary" busy={sending} icon={<Mail size={13} />} onClick={sendTeaser}>
                Send summary to contact
              </Btn>
            )}
          </div>
          {Array.isArray(matches) && (
            matches.length === 0 ? (
              <div className="ds-note" style={{ fontSize: 13 }}>No matches in the live database or staged drafts.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {matches.map((m, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, border: "var(--bd-hair)", borderRadius: "var(--r-soft-10)", padding: "7px 10px" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: band(m.band), border: `1px solid ${band(m.band)}`, borderRadius: 3, padding: "1px 5px" }}>{m.band.toUpperCase()}</span>
                    <span style={{ fontWeight: 600, color: C.navy }}>{m.label}</span>
                    <span style={{ color: C.ink3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.facts.join(" · ")}</span>
                    <span style={{ marginLeft: "auto", fontSize: 10, fontWeight: 700, letterSpacing: ".04em", color: m.origin === "live" ? C.green : C.brassDeep, background: m.origin === "live" ? C.greenBg : C.brassBg, padding: "1px 6px", borderRadius: 3 }}>{m.origin.toUpperCase()}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </DrawerSection>
      )}
    </>
  );
}

// ── History ─────────────────────────────────────────────────────────────────
// Provenance assembled from what the row and its batch already carry. There is
// no per-row audit table, so this states only what is known rather than
// implying an event log that does not exist.
function HistoryPanel({ row, sheetLabel, tableLabel, batch }: {
  row: StagedRowView; sheetLabel: string; tableLabel: string; batch: BatchMeta;
}) {
  const events: { what: string; at: string | null }[] = [
    {
      what: `Staged into ${sheetLabel} from ${batch.label ?? batch.id.slice(0, 8)} (${batch.source})`,
      at: batch.created_at,
    },
    ...(row.row_index != null ? [{ what: `Arrived as row ${row.row_index} of the source`, at: null }] : []),
    {
      what: `Classified as ${row.classification}${row.flags.length ? ` with ${row.flags.length} gate flag${row.flags.length === 1 ? "" : "s"}` : " with a clean gate"}`,
      at: null,
    },
    ...(row.committed
      ? [{ what: `Committed to ${tableLabel}`, at: batch.committed_at }]
      : [{ what: `Not yet committed to ${tableLabel}`, at: null }]),
  ];

  return (
    <DrawerSection label="Provenance">
      <div className="ds-timeline">
        {events.map((e, i) => (
          <div key={i} className="ds-timeline__item">
            <div className="ds-timeline__rail" style={{ paddingTop: 6 }}>
              <span className="ds-timeline__dot" />
              {i < events.length - 1 && <span className="ds-timeline__line" />}
            </div>
            <div style={{ paddingBottom: 8, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: C.ink }}>{e.what}</div>
              {e.at && <div className="ds-rowsub">{relTime(e.at)} · {new Date(e.at).toLocaleString()}</div>}
            </div>
          </div>
        ))}
      </div>
      <div className="ds-note" style={{ marginTop: 8 }}>
        Committed rows keep a before-image — the whole batch is reversible from History.
      </div>
    </DrawerSection>
  );
}

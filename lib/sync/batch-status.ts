// The batch lifecycle (Data Sync hardening phase 2, 18 Sep 2026) — one
// reading of what each status allows, shared by the server actions and the
// console. The database enforces the same rules (commit_sync_batch's status
// precondition, trg_sync_batch_discard_guard, undo's conflict check); this is
// what the buttons show.
//
//   draft        staged before phase 2 (gate ran, status was never updated)
//   gated        staged and checked by the data-quality gate — ready to commit
//   gate_failed  the gate could not run — re-run it before committing
//   committing   a commit is in progress
//   committed    every new / updated row is in the live tables
//   partial      some rows are committed, some still wait
//   undone       every committed row was restored / removed
//   failed       the last commit raised; the error is on the batch

export type BatchStatus = "draft" | "gated" | "gate_failed" | "committing" | "committed" | "partial" | "undone" | "failed";

export const BATCH_STATUS_LABEL: Record<BatchStatus, string> = {
  draft: "draft",
  gated: "ready",
  gate_failed: "gate failed",
  committing: "committing",
  committed: "committed",
  partial: "partly committed",
  undone: "undone",
  failed: "failed",
};

export function batchStatusLabel(status: string): string {
  return (BATCH_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

export interface BatchActions {
  /** rows can be committed (more of them, for a partial batch) */
  commit: boolean;
  /** committed rows can be restored / removed */
  undo: boolean;
  /** the batch can be deleted — the database still refuses when any audit row exists */
  discard: boolean;
  /** the data-quality gate should run again before anything else */
  regate: boolean;
}

export function batchActions(status: string): BatchActions {
  switch (status as BatchStatus) {
    case "draft":       return { commit: true,  undo: false, discard: true,  regate: true };
    case "gated":       return { commit: true,  undo: false, discard: true,  regate: false };
    case "gate_failed": return { commit: false, undo: false, discard: true,  regate: true };
    case "committing":  return { commit: false, undo: false, discard: false, regate: false };
    case "committed":   return { commit: false, undo: true,  discard: false, regate: false };
    case "partial":     return { commit: true,  undo: true,  discard: false, regate: false };
    case "undone":      return { commit: false, undo: false, discard: false, regate: false };
    case "failed":      return { commit: true,  undo: false, discard: true,  regate: false };
    default:            return { commit: false, undo: false, discard: false, regate: false };
  }
}

/** Still has rows waiting to be committed (the "open batches" lists). */
export const OPEN_BATCH_STATUSES: BatchStatus[] = ["draft", "gated", "gate_failed", "partial", "failed", "committing"];
export const isOpenBatch = (status: string): boolean => (OPEN_BATCH_STATUSES as string[]).includes(status);

/** Nothing more can happen to its staged rows from the review grid. */
export const isTerminalBatch = (status: string): boolean => status === "committed" || status === "undone" || status === "committing";

/** Has (or had) rows in the live tables — counts as a commit in history views. */
export const hasCommittedRows = (status: string): boolean => status === "committed" || status === "partial";

export interface UndoConflict { audit_id?: string; table: string; key: string | null; op: string; changed: string[] }

/** "ports ZZSM1 (trade_name) · cargo_listings CM-12 (qty_max_mt, freight_idea_usd_mt)" */
export function describeUndoConflicts(conflicts: UndoConflict[], max = 6): string {
  const lines = conflicts.slice(0, max).map((c) => `${c.table} ${c.key ?? "?"} (${c.changed.join(", ")})`);
  if (conflicts.length > max) lines.push(`… and ${conflicts.length - max} more`);
  return lines.join("\n");
}

/** Strip the database's own prefixes so the toast reads plainly. */
export const friendlyBatchError = (message: string): string =>
  message.replace(/^(BATCH_STATE|DISCARD_GUARD|UNDO_CONFLICT|GATE_STALE|GATE_FAILED):\s*/, "");

/** The data-quality channel a batch is gated on: workbook uploads are 'sync', circulars and WhatsApp are 'pipeline'. */
export const gateChannelFor = (source: string): "sync" | "pipeline" => (source === "upload" ? "sync" : "pipeline");

/** A commit refusal that the gate can fix: the console offers "Run the gate". */
export const isGateStale = (message: string): boolean => /^GATE_STALE:/.test(message) || /must pass the data-quality gate/.test(message);

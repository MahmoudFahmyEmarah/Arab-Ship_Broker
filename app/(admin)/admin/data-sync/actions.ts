"use server";

import type { SupabaseClient } from "@supabase/supabase-js";
import { OPEN_BATCH_STATUSES, batchActions, friendlyBatchError, gateChannelFor, type UndoConflict } from "@/lib/sync/batch-status";
// Data Sync server actions. Every mutation is gated by requireAdmin({ edit }) and
// runs through the service-role client; commits/undo call the Phase 1 RPCs so the
// audited, reversible write path is the only way rows reach a live table.

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { validateRow } from "@/lib/dq/gate";
import { findCargoDuplicates, findVesselDuplicates, mergePatch, type DupPair, type QueuedVesselLite, type StagedLite } from "@/lib/sync/dupes";
import { sanitizeSearch, pickAllowedKeys } from "@/lib/sync/guards";
import { logAudit, AUDIT_FAMILIES, type AuditRow } from "@/lib/admin/data-sync-audit";
import type { ProcessSummary } from "@/lib/sync/whatsapp/process";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { SHEET_SPECS, specById, ZONES } from "@/lib/sync/sheets";
import { classify } from "@/lib/sync/diff";
import { previewTable, coerce } from "@/lib/sync/preview";
import { str, num, intStrip, locode, upper, parseLaycan } from "@/lib/sync/normalize";
import { FUEL_TYPES } from "@/lib/schemas/vessel";
import { isValidImo } from "@/lib/sync/imo";
import { parseSender } from "@/lib/sync/sender";
import type { Cell, Flag, RawRow } from "@/lib/sync/types";

const SHEET_IDS = new Set<string>(SHEET_SPECS.map((s) => s.id));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BULK = 500;

type Result<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | { success: false; error: string };

async function adminClient() {
  await requireAdmin({ section: "datasync", edit: true });
  return getSupabaseAdminClient();
}

// Writes need the acting admin's public.users.id for the RPC audit columns and
// their name for the module's own audit trail (data_sync_audit).
async function adminWrite() {
  const u = await requireAdmin({ section: "datasync", edit: true });
  return { c: getSupabaseAdminClient(), actor: u.rowId, who: { id: u.rowId, name: u.fullName } };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// requireAdmin denies by redirect(), which throws. Re-throw it so the bounce
// happens instead of a toast reading "NEXT_REDIRECT" (same as DQ audit C2).
const fail = (e: unknown, fallback: string): { success: false; error: string } => {
  unstable_rethrow(e);
  return { success: false, error: e instanceof Error ? e.message : fallback };
};

function badBatch(id: string): string | null {
  return UUID_RE.test(id) ? null : "Invalid batch id.";
}

// A commit that raises inside commit_sync_batch rolls back its own status
// write (the "failed" update sits in the transaction that then aborts), so the
// batch looked untouched and the error text was lost. Phase 0 (18 Sep 2026):
// the app records the failure in a second statement, and never lets the
// bookkeeping mask the original error.
async function markBatchFailed(c: SupabaseClient, batchId: string, error: string): Promise<void> {
  try { await c.rpc("mark_sync_batch_failed", { p_batch_id: batchId, p_error: error.slice(0, 2000) }); } catch { /* the toast still carries the error */ }
}

// ── commit ─────────────────────────────────────────────────────────────────
export async function commitSheet(
  batchId: string,
  sheet: string,
): Promise<Result<{ inserted: number; updated: number; skipped: number }>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  if (!SHEET_IDS.has(sheet)) return { success: false, error: `Unknown sheet "${sheet}".` };
  try {
    const { c, who } = await adminWrite();
    const { data, error } = await c.rpc("commit_sync_batch", { p_batch_id: batchId, p_sheet: sheet });
    if (error) { await markBatchFailed(c, batchId, error.message); return { success: false, error: friendlyBatchError(error.message) }; }
    await logAudit(c, { actor: who, action: "batch.commit", targetKind: "batch", targetId: batchId, batchId, summary: `Committed sheet ${sheet} — ${(data as { inserted: number }).inserted} inserted · ${(data as { updated: number }).updated} updated`, detail: { sheet, ...(data as object) } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: data as { inserted: number; updated: number; skipped: number } };
  } catch (e) {
    return fail(e, "Commit failed.");
  }
}

// Commit only the specific staged rows the admin selected (reviewed/accepted).
export async function commitSelection(
  batchId: string,
  sheet: string,
  rowIds: string[],
): Promise<Result<{ inserted: number; updated: number; skipped: number }>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  if (!SHEET_IDS.has(sheet)) return { success: false, error: `Unknown sheet "${sheet}".` };
  if (!Array.isArray(rowIds) || rowIds.length === 0) return { success: false, error: "Select at least one row." };
  if (rowIds.length > 1000) return { success: false, error: "Too many rows selected." };
  if (!rowIds.every((id) => UUID_RE.test(id))) return { success: false, error: "Invalid row id in selection." };
  try {
    const { c, who } = await adminWrite();
    const { data, error } = await c.rpc("commit_sync_batch", { p_batch_id: batchId, p_sheet: sheet, p_row_ids: rowIds });
    if (error) { await markBatchFailed(c, batchId, error.message); return { success: false, error: friendlyBatchError(error.message) }; }
    await logAudit(c, { actor: who, action: "batch.commit_selection", targetKind: "batch", targetId: batchId, batchId, summary: `Committed ${rowIds.length} selected row(s) of ${sheet} — ${(data as { inserted: number }).inserted} inserted · ${(data as { updated: number }).updated} updated`, detail: { sheet, rowIds: rowIds.slice(0, 50), ...(data as object) } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: data as { inserted: number; updated: number; skipped: number } };
  } catch (e) {
    return fail(e, "Commit failed.");
  }
}

// Edit a staged row before it's committed. Re-runs the SAME validation + diff as
// staging, so fixing a bad value clears the error (and vice-versa), and the row
// commits with the edited values. Refuses once the row is committed.
export async function editStagedRow(
  rowId: string,
  patch: Record<string, unknown>,
): Promise<Result<{ classification: string }>> {
  if (!UUID_RE.test(rowId)) return { success: false, error: "Invalid row id." };
  if (!isPlainObject(patch) || Object.keys(patch).length === 0) return { success: false, error: "Nothing to save." };
  try {
    const { c, who } = await adminWrite();
    const { data: row, error: rErr } = await c
      .from("sync_staged_row")
      .select("sheet, target_table, key_column, business_key, payload, raw, committed, batch_id, sync_batch ( source )")
      .eq("id", rowId)
      .maybeSingle();
    if (rErr) return { success: false, error: rErr.message };
    if (!row) return { success: false, error: "Staged row not found." };
    if (row.committed) return { success: false, error: "This row is already committed — undo the batch to change it." };

    const spec = specById(row.sheet as string);
    if (!spec) return { success: false, error: `Unknown sheet "${row.sheet}".` };
    const pt = previewTable(row.sheet as string);

    // Front gate: only columns the editor exposes as editable. A client could
    // otherwise write review_status / commodity_id / anything the target table
    // has, and commit_sync_batch would faithfully apply it.
    const editable = (pt?.columns ?? []).filter((cc) => cc.editable !== false).map((cc) => cc.col);
    const clean = pickAllowedKeys(patch, editable);
    if (Object.keys(clean).length === 0) return { success: false, error: "None of those fields can be edited here." };

    const payload = { ...(row.payload as RawRow) };
    for (const [k, v] of Object.entries(clean)) {
      const col = pt?.columns.find((cc) => cc.col === k);
      payload[k] = (col ? coerce(col.type, v) : v) as Cell;
    }
    const raw = (row.raw ?? {}) as RawRow;

    // Mirror buildStagedRow: key → classify vs live → validate → invalid on error.
    const flags: Flag[] = [];
    const keyVal = payload[spec.keyColumn];
    const businessKey = keyVal == null || keyVal === "" ? null : String(keyVal);
    let classification: string;
    let diff: unknown = null;

    if (!businessKey) {
      flags.push({ level: "error", field: spec.keyColumn, msg: `missing ${spec.keyColumn} — cannot sync without a business key` });
      classification = "invalid";
    } else {
      const { data: existing } = await c.from(spec.targetTable).select("*").eq(spec.keyColumn, businessKey).maybeSingle();
      const res = classify(payload, (existing ?? undefined) as Record<string, Cell> | undefined);
      classification = res.classification;
      diff = res.diff;
      if (classification === "new") {
        for (const col of spec.columns) {
          if (col.required && (payload[col.column] == null || payload[col.column] === ""))
            flags.push({ level: "error", field: col.column, msg: `${col.column} is required for a new row` });
        }
      }
      flags.push(...(spec.validate?.(payload, raw) ?? []));
      if (flags.some((f) => f.level === "error")) classification = "invalid";
    }

    const { error: uErr } = await c
      .from("sync_staged_row")
      .update({ payload, flags, diff, classification, business_key: businessKey })
      .eq("id", rowId);
    if (uErr) return { success: false, error: uErr.message };
    // The data-quality gate re-checks the edited row on its channel (block →
    // stays invalid, warn → rides with the row); the class comes back from the DB.
    const batchSource = (row as { sync_batch?: { source?: string } | { source?: string }[] | null }).sync_batch;
    const srcKind = Array.isArray(batchSource) ? batchSource[0]?.source : batchSource?.source;
    const { error: gErr } = await c.rpc("fn_dq_gate_batch", { p_batch_id: (row as { batch_id: string }).batch_id, p_channel: srcKind === "upload" ? "sync" : "pipeline", p_actor: "staged-row edit", p_row_id: rowId });
    if (gErr) console.error("[data-sync] gate re-check:", gErr.message);
    const { data: after } = await c.from("sync_staged_row").select("classification").eq("id", rowId).maybeSingle();
    await logAudit(c, { actor: who, action: "row.edit", targetKind: "staged_row", targetId: rowId, batchId: (row as { batch_id: string }).batch_id, summary: `Edited staged row ${row.business_key ?? rowId.slice(0, 8)} (${row.sheet}) — ${Object.keys(clean).join(", ")}`, detail: { sheet: row.sheet, fields: clean, classification: (after as { classification?: string } | null)?.classification ?? classification } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { classification: (after as { classification?: string } | null)?.classification ?? classification } };
  } catch (e) {
    return fail(e, "Could not save the edit.");
  }
}

export async function commitAll(
  batchId: string,
): Promise<Result<{ inserted: number; updated: number; skipped: number }>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const { c, who } = await adminWrite();
    const { data, error } = await c.rpc("commit_sync_batch", { p_batch_id: batchId, p_sheet: null });
    if (error) { await markBatchFailed(c, batchId, error.message); return { success: false, error: friendlyBatchError(error.message) }; }
    await logAudit(c, { actor: who, action: "batch.commit", targetKind: "batch", targetId: batchId, batchId, summary: `Committed whole batch — ${(data as { inserted: number }).inserted} inserted · ${(data as { updated: number }).updated} updated`, detail: data as Record<string, unknown> });
    revalidatePath("/admin/data-sync");
    return { success: true, data: data as { inserted: number; updated: number; skipped: number } };
  } catch (e) {
    return fail(e, "Commit failed.");
  }
}

// ── run the data-quality gate again ────────────────────────────────────────
// Phase 3 (18 Sep 2026): commit refuses any row the gate has not passed —
// never checked, edited since, or judged under older rules. This re-runs the
// gate on the whole batch, recounts it and settles its status.
export async function regateBatch(
  batchId: string,
): Promise<Result<{ blocked: number; warned: number; rules: number; errors: string[] }>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const { c, who } = await adminWrite();
    const { data: b, error: rErr } = await c.from("sync_batch").select("source, status").eq("id", batchId).maybeSingle();
    if (rErr) return { success: false, error: rErr.message };
    if (!b) return { success: false, error: "Batch not found." };
    const { data, error } = await c.rpc("regate_sync_batch", { p_batch_id: batchId, p_channel: gateChannelFor(b.source), p_actor: who.name ?? "gate re-run" });
    if (error) return { success: false, error: friendlyBatchError(error.message) };
    const g = data as { ok?: boolean; error?: string; blocked: number; warned: number; rules: number; errors?: string[] };
    if (g.ok === false) {
      // the gate could not run: the batch is now gate_failed with the reason on it
      await logAudit(c, { actor: who, action: "batch.regate", targetKind: "batch", targetId: batchId, batchId, summary: `The data-quality gate could not run — ${g.error ?? "unknown error"}`, detail: g, ok: false });
      revalidatePath("/admin/data-sync");
      return { success: false, error: `The data-quality gate could not run on this batch: ${g.error ?? "unknown error"}. The batch is marked "gate failed"; fix the rule it names in Data quality → Rules and run the gate again.` };
    }
    await logAudit(c, { actor: who, action: "batch.regate", targetKind: "batch", targetId: batchId, batchId, summary: `Ran the data-quality gate — ${g.blocked} blocked · ${g.warned} warned · ${g.rules} rules${g.errors?.length ? ` · ${g.errors.length} rule error(s)` : ""}`, detail: g, ok: !(g.errors?.length) });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { blocked: g.blocked ?? 0, warned: g.warned ?? 0, rules: g.rules ?? 0, errors: g.errors ?? [] } };
  } catch (e) {
    return fail(e, "The gate could not run.");
  }
}

// ── undo (the reversible guarantee) ────────────────────────────────────────
// Phase 2 (18 Sep 2026): undo first compares every live row with the
// audit's after-image. When rows changed since the commit it returns them
// (ok: false, conflicts) and touches nothing; the console asks, then calls
// again with force = true, which restores anyway and records each override.
export interface UndoOutcome {
  ok: boolean;
  reverted: number;
  deleted: number;
  forced: number;
  conflicts: UndoConflict[];
}
export async function undoBatch(
  batchId: string,
  force = false,
): Promise<Result<UndoOutcome>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const { c, who } = await adminWrite();
    const { data, error } = await c.rpc("undo_sync_batch", { p_batch_id: batchId, p_force: force, p_actor: who.name ?? null });
    if (error) return { success: false, error: friendlyBatchError(error.message) };
    const out = data as UndoOutcome;
    if (out.ok) {
      await logAudit(c, { actor: who, action: "batch.undo", targetKind: "batch", targetId: batchId, batchId, summary: `Undid batch — ${out.reverted} restored · ${out.deleted} removed${out.forced ? ` · ${out.forced} later edit(s) overridden` : ""}`, detail: { ...out, force } });
      revalidatePath("/admin/data-sync");
    }
    return { success: true, data: out };
  } catch (e) {
    return fail(e, "Undo failed.");
  }
}

// ── discard a batch nothing was written from (safe hard delete) ─────────────
// The status says what the console may offer; trg_sync_batch_discard_guard
// is the final word — a batch with any audit row cannot be deleted.
export async function discardBatch(batchId: string): Promise<Result> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const { c, who } = await adminWrite();
    const { data: batch, error: readErr } = await c
      .from("sync_batch").select("status").eq("id", batchId).maybeSingle();
    if (readErr) return { success: false, error: readErr.message };
    if (!batch) return { success: false, error: "Batch not found." };
    if (!batchActions(batch.status).discard) {
      return { success: false, error: "This batch has committed rows — undo it instead of discarding." };
    }
    const { error } = await c.from("sync_batch").delete().eq("id", batchId); // cascades staged rows
    if (error) return { success: false, error: friendlyBatchError(error.message) };
    await logAudit(c, { actor: who, action: "batch.discard", targetKind: "batch", targetId: batchId, batchId, summary: `Discarded draft batch (was ${batch.status})`, detail: { status: batch.status } });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Discard failed.");
  }
}

// ── read staged rows for the review grid (server-paginated) ─────────────────
export interface EmailSourceView {
  from: string | null;
  subject: string | null;
  date: string | null;
  text: string | null;
  channel: "email" | "whatsapp";
  name: string | null;    // contact display name (whatsapp)
  msgId: string | null;   // whatsapp_message.id (teaser linkage)
}

export interface StagedRowView {
  id: string;
  classification: "new" | "updated" | "unchanged" | "invalid";
  business_key: string | null;
  payload: Record<string, unknown>;
  diff: Record<string, { old: unknown; new: unknown }> | null;
  flags: { level: string; field?: string; msg: string }[];
  row_index: number | null;
  committed: boolean;
  source: EmailSourceView | null; // the source email, for email-sourced rows
}

export async function listStaged(
  batchId: string,
  sheet: string,
  opts: { changesOnly?: boolean; limit?: number; offset?: number; classification?: string } = {},
): Promise<Result<{ rows: StagedRowView[]; total: number }>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  if (!SHEET_IDS.has(sheet)) return { success: false, error: `Unknown sheet "${sheet}".` };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  try {
    const c = await adminClient();
    let q = c
      .from("sync_staged_row")
      .select("id, classification, business_key, payload, diff, flags, raw, row_index, committed", { count: "exact" })
      .eq("batch_id", batchId)
      .eq("sheet", sheet);
    if (opts.changesOnly) q = q.neq("classification", "unchanged");
    // Phase 6: the figure tiles filter on the server, so the page shown is the
    // batch-wide set they count, not the loaded page filtered afterwards.
    if (opts.classification && ["new", "updated", "unchanged", "invalid"].includes(opts.classification)) q = q.eq("classification", opts.classification);
    q = q.order("row_index", { ascending: true, nullsFirst: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) return { success: false, error: error.message };
    const rows = (data ?? []).map((d) => {
      const row = d as Record<string, unknown>;
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      const source: EmailSourceView | null = raw._SRC_FROM || raw._SRC_SUBJECT || raw._SRC_TEXT
        ? {
            from: (raw._SRC_FROM as string) ?? null,
            subject: (raw._SRC_SUBJECT as string) ?? null,
            date: (raw._SRC_DATE as string) ?? null,
            text: (raw._SRC_TEXT as string) ?? null,
            channel: (raw._SRC_CHANNEL as "email" | "whatsapp") ?? "email",
            name: (raw._SRC_NAME as string) ?? null,
            msgId: (raw._SRC_MSG_ID as string) ?? null,
          }
        : null;
      const { raw: _drop, ...rest } = row;
      void _drop;
      return { ...rest, source } as StagedRowView;
    });
    return { success: true, data: { rows, total: count ?? 0 } };
  } catch (e) {
    return fail(e, "Could not read staged rows.");
  }
}

// ── invalid staged rows → Manual Review "Needs fixing" (per active batch) ────
// Auto-collects every invalid staged row in the batch currently under review,
// tagged with its category (sheet). Fixing a row via editStagedRow re-validates
// it, so it drops out of this list once the errors clear.
export interface InvalidStagedRow extends StagedRowView {
  sheet: string;
}

async function latestReviewBatch(c: Awaited<ReturnType<typeof adminClient>>) {
  const { data } = await c
    .from("sync_batch")
    .select("id, label")
    .in("status", ["draft", "committing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data ?? null) as { id: string; label: string | null } | null;
}

export async function listInvalidStaged(): Promise<Result<{
  batchId: string | null; batchLabel: string | null; rows: InvalidStagedRow[];
}>> {
  try {
    const c = await adminClient();
    const batch = await latestReviewBatch(c);
    if (!batch) return { success: true, data: { batchId: null, batchLabel: null, rows: [] } };

    const { data, error } = await c
      .from("sync_staged_row")
      .select("id, sheet, classification, business_key, payload, diff, flags, raw, row_index, committed")
      .eq("batch_id", batch.id)
      .eq("classification", "invalid")
      .eq("committed", false)
      .order("sheet", { ascending: true })
      .order("row_index", { ascending: true, nullsFirst: false });
    if (error) return { success: false, error: error.message };

    const rows = (data ?? []).map((d) => {
      const row = d as Record<string, unknown>;
      const raw = (row.raw ?? {}) as Record<string, unknown>;
      const source: EmailSourceView | null = raw._SRC_FROM || raw._SRC_SUBJECT || raw._SRC_TEXT
        ? {
            from: (raw._SRC_FROM as string) ?? null, subject: (raw._SRC_SUBJECT as string) ?? null,
            date: (raw._SRC_DATE as string) ?? null, text: (raw._SRC_TEXT as string) ?? null,
            channel: (raw._SRC_CHANNEL as "email" | "whatsapp") ?? "email",
            name: (raw._SRC_NAME as string) ?? null, msgId: (raw._SRC_MSG_ID as string) ?? null,
          }
        : null;
      const { raw: _drop, ...rest } = row;
      void _drop;
      return { ...rest, source } as InvalidStagedRow;
    });
    return { success: true, data: { batchId: batch.id, batchLabel: batch.label, rows } };
  } catch (e) {
    return fail(e, "Could not read invalid rows.");
  }
}

export async function countInvalidStagedPending(): Promise<number> {
  try {
    const c = await adminClient();
    const batch = await latestReviewBatch(c);
    if (!batch) return 0;
    const { count } = await c
      .from("sync_staged_row")
      .select("id", { count: "exact", head: true })
      .eq("batch_id", batch.id)
      .eq("classification", "invalid")
      .eq("committed", false);
    return count ?? 0;
  } catch (e) {
    unstable_rethrow(e);
    return 0;
  }
}

// ── post 02_VESSELS open positions into vessel_availability ──────────────────
// Reads the staged vessels rows' raw cells (which carry the open-position
// columns the vessel master mapping ignores), parses them with the sync
// normalizers, and hands a clean array to sync_vessel_positions() which upserts
// one OPEN posting per vessel (and closes non-open ones).
export async function syncVesselPositions(
  batchId: string,
): Promise<Result<{ posted: number; closed: number; skipped: number }>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const { c, who } = await adminWrite();
    const { data, error } = await c
      .from("sync_staged_row")
      .select("raw")
      .eq("batch_id", batchId)
      .eq("sheet", "vessels");
    if (error) return { success: false, error: error.message };

    const asNum = (v: Cell): number | null => {
      const n = num(v);
      return typeof n === "number" ? n : null;
    };
    const asInt = (v: Cell): number | null => {
      const n = intStrip(v);
      return typeof n === "number" ? n : null;
    };
    const fuelSet = new Set<string>(FUEL_TYPES as readonly string[]);

    const positions = (data ?? [])
      .map((row) => ((row as { raw: Record<string, Cell> }).raw ?? {}))
      .map((raw) => {
        const imo = str(raw["IMO"] ?? raw["IMO_NUMBER"] ?? null);
        const status = str(raw["STATUS"] ?? null);
        if (!imo || !status) return null;
        const from = parseLaycan(raw["OPEN_FROM"] ?? null);
        const to = parseLaycan(raw["OPEN_TO"] ?? null);
        const oz = upper(raw["OPEN_ZONE"] ?? null);
        const openZone = oz && ZONES.has(oz) ? oz : null;
        const fuelRaw = str(raw["FUEL_TYPE"] ?? null);
        const fuel = fuelRaw && fuelSet.has(fuelRaw) ? fuelRaw : null;
        let rangeDays: number | null = null;
        if (from.date && to.date) {
          const d = Math.round((Date.parse(to.date) - Date.parse(from.date)) / 86_400_000);
          rangeDays = d >= 0 && d <= 60 ? d : null;
        }
        return {
          imo,
          status,
          open_port_locode: locode(raw["OPEN_LOCODE"] ?? null),
          open_zone: openZone,
          open_date: from.date,
          open_date_range_days: rangeDays,
          service_speed_kn: asNum(raw["SERVICE_SPEED_KN"] ?? null),
          me_consumption_mt_day: asNum(raw["ME_CONS_SEA_MT"] ?? null),
          me_consumption_port_mt_day: asNum(raw["ME_CONS_PORT_MT"] ?? null),
          aux_consumption_port_mt_day: asNum(raw["AUX_CONS_PORT_MT"] ?? null),
          fuel_type: fuel,
          brob_mt: asNum(raw["BROB_MT"] ?? null),
          num_grabs: asInt(raw["NUM_GRABS"] ?? null),
          grab_capacity_mt: asNum(raw["GRAB_CAPACITY_MT"] ?? null),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    if (positions.length === 0)
      return { success: true, data: { posted: 0, closed: 0, skipped: 0 } };

    const { data: res, error: rErr } = await c.rpc("sync_vessel_positions", {
      p_positions: positions,
    });
    if (rErr) return { success: false, error: rErr.message };
    await logAudit(c, { actor: who, action: "positions.post", targetKind: "batch", targetId: batchId, batchId, summary: `Posted open positions from the workbook — ${(res as { posted: number }).posted} open · ${(res as { closed: number }).closed} closed · ${(res as { skipped: number }).skipped} skipped`, detail: { positions: positions.length, ...(res as object) } });
    revalidatePath("/dashboard");
    revalidatePath("/");
    return {
      success: true,
      data: res as { posted: number; closed: number; skipped: number },
    };
  } catch (e) {
    return fail(e, "Could not post open positions.");
  }
}

// ── batch meta (status + per-sheet counts) for the review header ────────────
export interface BatchMeta {
  id: string;
  label: string | null;
  source: string;
  status: string;
  counts: Record<string, { new: number; updated: number; unchanged: number; invalid: number; errors: number }>;
  file_name: string | null;
  created_at: string;
  committed_at: string | null;
}

// Phase 6: History reads batches in pages instead of stopping at the 12 the page loads.
export async function listBatches(opts: { offset?: number; limit?: number } = {}): Promise<Result<{ rows: BatchMeta[]; total: number }>> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const offset = Math.max(opts.offset ?? 0, 0);
  try {
    const c = await adminClient();
    const { data, error, count } = await c
      .from("sync_batch")
      .select("id, label, source, status, counts, file_name, created_at, committed_at", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return { success: false, error: error.message };
    return { success: true, data: { rows: (data ?? []) as BatchMeta[], total: count ?? 0 } };
  } catch (e) {
    return fail(e, "Could not read batches.");
  }
}

export async function getBatch(batchId: string): Promise<Result<BatchMeta | null>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("sync_batch")
      .select("id, label, source, status, counts, file_name, created_at, committed_at")
      .eq("id", batchId)
      .maybeSingle();
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data as BatchMeta) ?? null };
  } catch (e) {
    return fail(e, "Could not read batch.");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 4 — Database Preview (view + audited single/bulk edit + delete + undo)
// ════════════════════════════════════════════════════════════════════════════

export interface PreviewRow {
  key: string;
  data: Record<string, unknown>;
}

// ── read live records (server-paginated + optional search) ──────────────────
export async function listRecords(
  tableId: string,
  opts: { search?: string; limit?: number; offset?: number } = {},
): Promise<Result<{ rows: PreviewRow[]; total: number }>> {
  const t = previewTable(tableId);
  if (!t) return { success: false, error: `Unknown table "${tableId}".` };
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const offset = Math.max(opts.offset ?? 0, 0);
  const select = Array.from(new Set([t.keyCol, ...t.columns.map((c) => c.col)])).join(", ");
  try {
    const c = await adminClient();
    let q = c.from(t.table).select(select, { count: "exact" });
    const s = opts.search ? sanitizeSearch(opts.search) : "";
    if (s) q = q.or(t.searchCols.map((col) => `${col}.ilike.%${s}%`).join(","));
    q = q.order(t.keyCol, { ascending: true, nullsFirst: false }).range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) return { success: false, error: error.message };
    const rows = (data ?? []).map((d) => {
      const rec = d as unknown as Record<string, unknown>;
      return { key: String(rec[t.keyCol] ?? ""), data: rec };
    });
    return { success: true, data: { rows, total: count ?? 0 } };
  } catch (e) {
    return fail(e, "Could not read records.");
  }
}

// Translate raw Postgres error codes into messages an admin can act on.
function friendlyDbError(err: { code?: string; message: string }, verb: string): string {
  switch (err.code) {
    case "23503":
      return `Cannot ${verb} — other records still reference this one. Retire it instead (set Active to no).`;
    case "23505":
      return err.message.includes("already exists")
        ? err.message
        : `A record with this key already exists.`;
    case "23502":
      return `A required field is missing: ${err.message}`;
    case "22P02":
      return `A value has the wrong format for its column: ${err.message}`;
    default:
      return err.message;
  }
}

// Only columns the Preview registry exposes as editable may reach the DB —
// the RPC's own column filter is the backstop, this is the front gate.
function pickEditable(t: NonNullable<ReturnType<typeof previewTable>>, patch: Record<string, unknown>) {
  const allowed = new Set(t.columns.filter((c) => c.editable !== false).map((c) => c.col));
  return Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)));
}

// ── single audited edit ─────────────────────────────────────────────────────
export async function editRecord(
  tableId: string,
  key: string,
  patch: Record<string, unknown>,
): Promise<Result<{ auditId: string }>> {
  const t = previewTable(tableId);
  if (!t) return { success: false, error: `Unknown table "${tableId}".` };
  if (!key) return { success: false, error: "Missing record key." };
  if (!isPlainObject(patch)) return { success: false, error: "Nothing to save." };
  const clean = pickEditable(t, patch);
  if (Object.keys(clean).length === 0) return { success: false, error: "Nothing to save." };
  try {
    const { c, actor, who } = await adminWrite();
    const { data, error } = await c.rpc("edit_live_record", {
      p_table: t.table, p_key: key, p_patch: clean, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "save") };
    await logAudit(c, { actor: who, action: "record.edit", targetKind: "record", targetId: `${t.table}:${key}`, summary: `Edited ${t.label.slice(0, -1)} ${key} — ${Object.keys(clean).join(", ")}`, detail: { table: t.table, key, patch: clean, auditId: (data as { audit_id: string }).audit_id } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { auditId: (data as { audit_id: string }).audit_id } };
  } catch (e) {
    return fail(e, "Edit failed.");
  }
}

// ── audited insert (Add record; undo removes it again) ──────────────────────
export async function insertRecord(
  tableId: string,
  row: Record<string, unknown>,
): Promise<Result<{ auditId: string; key: string }>> {
  const t = previewTable(tableId);
  if (!t) return { success: false, error: `Unknown table "${tableId}".` };
  if (t.insertable === false)
    return { success: false, error: `${t.label} are created by their own flows — adding here is disabled.` };
  if (!isPlainObject(row)) return { success: false, error: "Nothing to add." };
  const key = String(row[t.keyCol] ?? "").trim();
  if (!key) return { success: false, error: `${t.keyCol} is required.` };
  // required-field gate (mirrors NOT NULL columns without defaults)
  for (const col of t.columns) {
    if (col.required && (row[col.col] === null || row[col.col] === undefined || row[col.col] === ""))
      return { success: false, error: `${col.label} is required.` };
  }
  // key + registry columns only — nothing else reaches the RPC
  const allowed = new Set([t.keyCol, ...t.columns.map((c) => c.col)]);
  const clean = Object.fromEntries(Object.entries(row).filter(([k, v]) => allowed.has(k) && v !== undefined));
  try {
    const { c, actor, who } = await adminWrite();
    const { data, error } = await c.rpc("insert_live_record", {
      p_table: t.table, p_row: clean, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "add") };
    await logAudit(c, { actor: who, action: "record.insert", targetKind: "record", targetId: `${t.table}:${key}`, summary: `Added ${t.label.slice(0, -1)} ${key}`, detail: { table: t.table, key, row: clean } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { auditId: (data as { audit_id: string }).audit_id, key } };
  } catch (e) {
    return fail(e, "Add failed.");
  }
}

// ── bulk edit (one patch → many keys, grouped for one-click undo) ────────────
export async function bulkEditRecords(
  tableId: string,
  keys: string[],
  patch: Record<string, unknown>,
): Promise<Result<{ updated: number; groupId: string }>> {
  const t = previewTable(tableId);
  if (!t) return { success: false, error: `Unknown table "${tableId}".` };
  if (!Array.isArray(keys) || keys.length === 0) return { success: false, error: "Select at least one row." };
  if (keys.length > MAX_BULK) return { success: false, error: `Bulk edits are capped at ${MAX_BULK} rows.` };
  if (!isPlainObject(patch)) return { success: false, error: "Choose a field and value to apply." };
  const clean = pickEditable(t, patch);
  if (Object.keys(clean).length === 0) return { success: false, error: "Choose a field and value to apply." };
  try {
    const { c, actor, who } = await adminWrite();
    const { data, error } = await c.rpc("bulk_update_live_records", {
      p_table: t.table, p_keys: keys, p_patch: clean, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "apply") };
    await logAudit(c, { actor: who, action: "record.bulk_edit", targetKind: "record", targetId: t.table, summary: `Bulk-edited ${keys.length} ${t.label} — ${Object.keys(clean).join(", ")}`, detail: { table: t.table, keys: keys.slice(0, 100), patch: clean, groupId: (data as { group_id: string }).group_id } });
    revalidatePath("/admin/data-sync");
    const d = data as { updated: number; group_id: string };
    return { success: true, data: { updated: d.updated, groupId: d.group_id } };
  } catch (e) {
    return fail(e, "Bulk edit failed.");
  }
}

// ── delete many selected records as one undoable group ──────────────────────
export async function bulkDeleteRecords(
  tableId: string,
  keys: string[],
): Promise<Result<{ deleted: number; groupId: string }>> {
  const t = previewTable(tableId);
  if (!t) return { success: false, error: `Unknown table "${tableId}".` };
  if (!Array.isArray(keys) || keys.length === 0) return { success: false, error: "Select at least one row." };
  if (keys.length > MAX_BULK) return { success: false, error: `Bulk deletes are capped at ${MAX_BULK} rows.` };
  try {
    const { c, actor, who } = await adminWrite();
    const { data, error } = await c.rpc("bulk_delete_live_records", {
      p_table: t.table, p_keys: keys, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "delete") };
    await logAudit(c, { actor: who, action: "record.bulk_delete", targetKind: "record", targetId: t.table, summary: `Bulk-deleted ${keys.length} ${t.label}`, detail: { table: t.table, keys: keys.slice(0, 100), groupId: (data as { group_id: string }).group_id } });
    revalidatePath("/admin/data-sync");
    const d = data as { deleted: number; group_id: string };
    return { success: true, data: { deleted: d.deleted, groupId: d.group_id } };
  } catch (e) {
    return fail(e, "Bulk delete failed.");
  }
}

// ── audited delete ──────────────────────────────────────────────────────────
export async function deleteRecord(tableId: string, key: string): Promise<Result> {
  const t = previewTable(tableId);
  if (!t) return { success: false, error: `Unknown table "${tableId}".` };
  if (!key) return { success: false, error: "Missing record key." };
  try {
    const { c, actor, who } = await adminWrite();
    const { error } = await c.rpc("delete_live_record", { p_table: t.table, p_key: key, p_actor: actor });
    if (error) return { success: false, error: friendlyDbError(error, "delete") };
    await logAudit(c, { actor: who, action: "record.delete", targetKind: "record", targetId: `${t.table}:${key}`, summary: `Deleted ${t.label.slice(0, -1)} ${key}`, detail: { table: t.table, key } });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Delete failed.");
  }
}

// ── undo an edit or a whole bulk group ──────────────────────────────────────
export interface UndoEditOutcome { ok: boolean; restored: number; reinserted: number; removed?: number; forced?: number; conflicts?: UndoConflict[] }
export async function undoEdit(
  ref: { auditId?: string; groupId?: string },
  force = false,
): Promise<Result<UndoEditOutcome>> {
  const { auditId, groupId } = ref;
  if (auditId && !UUID_RE.test(auditId)) return { success: false, error: "Invalid edit id." };
  if (groupId && !UUID_RE.test(groupId)) return { success: false, error: "Invalid group id." };
  if (!auditId && !groupId) return { success: false, error: "Nothing to undo." };
  try {
    const { c, actor, who } = await adminWrite();
    // Same rule as batches (phase 2): conflicts come back first; force overrides.
    const { data, error } = await c.rpc("undo_record_edits", {
      p_audit_id: auditId ?? null, p_group_id: groupId ?? null, p_actor: actor, p_force: force,
    });
    if (error) return { success: false, error: friendlyDbError(error, "undo") };
    const out = data as UndoEditOutcome;
    if (out.ok) {
      await logAudit(c, { actor: who, action: "record.undo", targetKind: "record", targetId: groupId ?? auditId ?? null, summary: `Undid ${groupId ? "a bulk edit group" : "a record edit"} — ${out.restored} restored · ${out.reinserted} reinserted${out.forced ? ` · ${out.forced} later edit(s) overridden` : ""}`, detail: { auditId, groupId, force, ...out } });
      revalidatePath("/admin/data-sync");
    }
    return { success: true, data: out };
  } catch (e) {
    return fail(e, "Undo failed.");
  }
}

export interface EditAuditRow {
  id: string;
  table_name: string;
  business_key: string;
  op: "insert" | "update" | "delete";
  group_id: string | null;
  edited_at: string;
  undone: boolean;
}

export async function listEditAudit(limit = 15): Promise<Result<EditAuditRow[]>> {
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("record_edit_audit")
      .select("id, table_name, business_key, op, group_id, edited_at, undone")
      .order("edited_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 50));
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as EditAuditRow[] };
  } catch (e) {
    return fail(e, "Could not read edit history.");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Phase 4 — Manual Review queue (UNMAPPED commodities → ASB regime)
// ════════════════════════════════════════════════════════════════════════════

export interface CommodityQueueRow {
  id: string;
  raw_name: string;
  sample_ref: string | null;
  source: string;
  status: "pending" | "mapped" | "ignored";
  mapped_commodity_id: string | null;
  created_at: string;
}

export async function listCommodityQueue(
  status: "pending" | "mapped" | "ignored" = "pending",
): Promise<Result<CommodityQueueRow[]>> {
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("commodity_review_queue")
      .select("id, raw_name, sample_ref, source, status, mapped_commodity_id, created_at")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as CommodityQueueRow[] };
  } catch (e) {
    return fail(e, "Could not read the review queue.");
  }
}

export async function countCommodityQueuePending(): Promise<number> {
  try {
    const c = await adminClient();
    const { count } = await c
      .from("commodity_review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    return count ?? 0;
  } catch (e) {
    unstable_rethrow(e);
    return 0;
  }
}

export interface ResolveCommodityInput {
  canonical: string;
  cargoType: string;
  imsbc: string;
  category?: string | null;
  isGrain?: boolean;
  isDg?: boolean;
  notes?: string | null;
}

export async function resolveCommodityReview(
  id: string,
  input: ResolveCommodityInput,
): Promise<Result<{ commodityId: string }>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  if (!input.canonical?.trim()) return { success: false, error: "Canonical name is required." };
  if (!input.cargoType || !input.imsbc) return { success: false, error: "Cargo type and IMSBC category are required." };
  try {
    const { c, actor, who } = await adminWrite();
    const { data, error } = await c.rpc("resolve_commodity_review", {
      p_id: id,
      p_canonical: input.canonical.trim(),
      p_cargo_type: input.cargoType,
      p_imsbc: input.imsbc,
      p_category: input.category ?? null,
      p_is_grain: input.isGrain ?? false,
      p_is_dg: input.isDg ?? false,
      p_notes: input.notes ?? null,
      p_actor: actor,
    });
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "queue.commodity.resolve", targetKind: "queue", targetId: id, summary: `Mapped commodity → ${input.canonical.trim()} (${input.cargoType} · ${input.imsbc})`, detail: { ...input, commodityId: (data as { commodity_id: string }).commodity_id } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { commodityId: (data as { commodity_id: string }).commodity_id } };
  } catch (e) {
    return fail(e, "Could not resolve the commodity.");
  }
}

export async function ignoreCommodityReview(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const { c, actor, who } = await adminWrite();
    const { error } = await c
      .from("commodity_review_queue")
      .update({ status: "ignored", resolved_by: actor, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "queue.commodity.ignore", targetKind: "queue", targetId: id, summary: "Ignored a commodity review entry" });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not update the queue.");
  }
}

/** All four queue badges in one gated round trip. */
export async function countQueues(): Promise<Result<{ commodities: number; vessels: number; ports: number; invalid: number }>> {
  try {
    const c = await adminClient();
    const batch = await latestReviewBatch(c);
    const head = { count: "exact" as const, head: true };
    const [cc, vc, pc, ic] = await Promise.all([
      c.from("commodity_review_queue").select("id", head).eq("status", "pending"),
      c.from("vessel_review_queue").select("id", head).eq("status", "pending"),
      c.from("port_review_queue").select("id", head).eq("status", "pending"),
      batch
        ? c.from("sync_staged_row").select("id", head).eq("batch_id", batch.id).eq("classification", "invalid").eq("committed", false)
        : Promise.resolve({ count: 0 }),
    ]);
    return { success: true, data: { commodities: cc.count ?? 0, vessels: vc.count ?? 0, ports: pc.count ?? 0, invalid: ic.count ?? 0 } };
  } catch (e) {
    return fail(e, "Could not count the queues.");
  }
}

// ── Port review queue (unclassified port text → an alias or an area) ─────────
// The gate (DQ-P03) refuses any cargo whose port side is neither a port, a
// list of ports, nor a known area. Those names land here: map the text to an
// existing port (an alias) or declare it an area with a nominated reference
// port, and every listing that used the text is re-classified.
export interface PortQueueRow {
  id: string;
  raw_name: string;
  name_key: string;
  side: "load" | "disch" | "open";
  sample_ref: string | null;
  source: string | null;
  first_batch_id: string | null;
  hits: number;
  suggested_zone: string | null;
  status: "pending" | "mapped" | "ignored";
  resolved_kind: "port" | "alias" | "area" | null;
  mapped_locode: string | null;
  mapped_area_key: string | null;
  created_at: string;
}

export interface PortOpt { locode: string; trade_name: string; zone: string | null; country: string | null }

export async function listPortQueue(
  status: "pending" | "mapped" | "ignored" = "pending",
): Promise<Result<PortQueueRow[]>> {
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("port_review_queue")
      .select("id, raw_name, name_key, side, sample_ref, source, first_batch_id, hits, suggested_zone, status, resolved_kind, mapped_locode, mapped_area_key, created_at")
      .eq("status", status)
      .order("hits", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as PortQueueRow[] };
  } catch (e) {
    return fail(e, "Could not read the port queue.");
  }
}

export async function countPortQueuePending(): Promise<number> {
  try {
    const c = await adminClient();
    const { count } = await c
      .from("port_review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    return count ?? 0;
  } catch (e) {
    unstable_rethrow(e);
    return 0;
  }
}

/** Re-scan live listings and uncommitted staged rows for unclassified ports. */
export async function sweepPortQueue(): Promise<Result<{ queued: number }>> {
  try {
    const { c, who } = await adminWrite();
    const { data, error } = await c.rpc("fn_port_review_sweep");
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "queue.port.sweep", targetKind: "queue", summary: `Swept the port queue — ${Number(data ?? 0)} entries queued`, detail: { queued: Number(data ?? 0) } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { queued: Number(data ?? 0) } };
  } catch (e) {
    return fail(e, "Could not sweep the port queue.");
  }
}

export async function listPortsForPicker(): Promise<Result<PortOpt[]>> {
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("ports")
      .select("locode, trade_name, zone, country")
      .eq("is_active", true)
      .order("trade_name")
      .limit(2000);
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as PortOpt[] };
  } catch (e) {
    return fail(e, "Could not read the ports registry.");
  }
}

export interface ResolvePortInput {
  kind: "alias" | "area";
  /** alias target, or the area's reference port */
  locode?: string | null;
  areaName?: string | null;
  areaKind?: "country" | "area" | "range";
  zone?: string | null;
  candidates?: string[];
}

export async function resolvePortReview(id: string, input: ResolvePortInput): Promise<Result<{ reclassified: number }>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  if (input.kind === "alias" && !input.locode) return { success: false, error: "Pick the port this name refers to." };
  if (input.kind === "area" && !input.locode) {
    return { success: false, error: "Nominate a reference port — without one the area still cannot feed distance or costs." };
  }
  try {
    const { c, who } = await adminWrite();
    const { data, error } = await c.rpc("resolve_port_review", {
      p_id: id,
      p_kind: input.kind,
      p_locode: input.locode ?? null,
      p_area_name: input.areaName ?? null,
      p_area_kind: input.areaKind ?? "area",
      p_zone: input.zone ?? null,
      p_candidates: input.candidates ?? [],
    });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    revalidatePath("/dashboard");
    revalidatePath("/");
    const out = (data ?? {}) as { listings_reclassified?: number };
    await logAudit(c, { actor: who, action: "queue.port.resolve", targetKind: "queue", targetId: id, summary: `Resolved port text as ${input.kind}${input.locode ? ` → ${input.locode}` : ""} — ${Number(out.listings_reclassified ?? 0)} listing(s) reclassified`, detail: { ...input, ...out } });
    return { success: true, data: { reclassified: Number(out.listings_reclassified ?? 0) } };
  } catch (e) {
    return fail(e, "Could not resolve the port.");
  }
}

export async function ignorePortReview(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const { c, who } = await adminWrite();
    const { error } = await c.rpc("resolve_port_review", { p_id: id, p_kind: "ignore" });
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "queue.port.ignore", targetKind: "queue", targetId: id, summary: "Ignored a port review entry" });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not update the queue.");
  }
}

// ── Vessel review queue (IMO-less vessels → composite-keyed sync) ────────────
export interface VesselQueueRow {
  id: string;
  vessel_name: string;
  built: number | null;
  dwt_grain: number | null;
  vessel_type: string | null;
  flag: string | null;
  grt: number | null;
  nrt: number | null;
  open_date: string | null;
  imo_hint: string | null;
  open_port: string | null;
  open_country: string | null;
  open_zone: string | null;
  direction: string | null;
  dest_zones: string[] | null;
  posted_at: string | null;
  // company links (Equasis roles) — commercial/ship manager is the one that matters commercially
  owner_company: string | null;
  commercial_manager: string | null;
  ism_manager: string | null;
  source: string;
  status: "pending" | "synced" | "ignored";
  resolved_with_imo: boolean | null;   // false on a synced row = IMO still pending
  source_email: EmailSourceView | null;
  created_at: string;
}

export async function listVesselQueue(
  status: "pending" | "synced" | "ignored" = "pending",
): Promise<Result<VesselQueueRow[]>> {
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("vessel_review_queue")
      .select("id, vessel_name, built, dwt_grain, vessel_type, flag, grt, nrt, open_date, imo_hint, open_port, open_country, open_zone, direction, dest_zones, posted_at, owner_company, commercial_manager, ism_manager, source, status, resolved_with_imo, source_email, created_at")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as VesselQueueRow[] };
  } catch (e) {
    return fail(e, "Could not read the vessel queue.");
  }
}

export async function countVesselQueuePending(): Promise<number> {
  try {
    const c = await adminClient();
    const { count } = await c
      .from("vessel_review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    return count ?? 0;
  } catch (e) {
    unstable_rethrow(e);
    return 0;
  }
}

export interface VesselQueuePatch {
  vessel_name?: string;
  built?: number | null;
  dwt_grain?: number | null;
  vessel_type?: string | null;
  flag?: string | null;
  grt?: number | null;
  nrt?: number | null;
  open_date?: string | null;
  open_port?: string | null;
  open_country?: string | null;
  open_zone?: string | null;
  direction?: string | null;
  owner_company?: string | null;
  commercial_manager?: string | null;
  ism_manager?: string | null;
}

function vesselPatchToUpdate(patch: VesselQueuePatch): Record<string, unknown> {
  const upd: Record<string, unknown> = {};
  if (patch.vessel_name !== undefined && patch.vessel_name.trim()) upd.vessel_name = patch.vessel_name.trim();
  if (patch.built !== undefined) upd.built = patch.built;
  if (patch.dwt_grain !== undefined) upd.dwt_grain = patch.dwt_grain;
  if (patch.vessel_type !== undefined) upd.vessel_type = patch.vessel_type;
  if (patch.flag !== undefined) upd.flag = patch.flag;
  if (patch.grt !== undefined) upd.grt = patch.grt;
  if (patch.nrt !== undefined) upd.nrt = patch.nrt;
  if (patch.open_date !== undefined) upd.open_date = patch.open_date;
  if (patch.open_port !== undefined) upd.open_port = patch.open_port;
  if (patch.open_country !== undefined) upd.open_country = patch.open_country;
  if (patch.open_zone !== undefined) upd.open_zone = patch.open_zone;
  if (patch.direction !== undefined) upd.direction = patch.direction;
  if (patch.owner_company !== undefined) upd.owner_company = patch.owner_company;
  if (patch.commercial_manager !== undefined) upd.commercial_manager = patch.commercial_manager;
  if (patch.ism_manager !== undefined) upd.ism_manager = patch.ism_manager;
  return upd;
}


// imo null/blank → composite sync (name+built+dwt); otherwise upsert by IMO.
// An optional patch lets the admin CORRECT the extracted fields (name, dwt,
// built, type, flag) before the vessel is synced — the RPC reads the queue row.
export async function resolveVesselReview(
  id: string,
  imo?: string | null,
  patch?: VesselQueuePatch,
  opts: { allowWithoutImo?: boolean } = {},
): Promise<Result<{ vesselId: string; op: string; availabilityId: string | null; portResolved: boolean }>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  const trimmed = imo?.trim() || null;
  // The IMO is the vessel's identity — mandatory. The explicit "temporary"
  // path (allowWithoutImo) is the only way round it, and the queue row keeps
  // resolved_with_imo=false so the gap stays visible until it is filled.
  if (!trimmed && !opts.allowWithoutImo)
    return { success: false, error: "The IMO number is required. Use “Sync without IMO (temporary)” only when it genuinely cannot be found yet." };
  if (trimmed && !/^\d{7}$/.test(trimmed)) return { success: false, error: "An IMO number is 7 digits." };
  if (trimmed && !isValidImo(trimmed)) return { success: false, error: `IMO ${trimmed} fails the check digit — please re-check it.` };
  if (patch && "vessel_name" in patch && !patch.vessel_name?.trim())
    return { success: false, error: "The vessel needs a name." };
  try {
    const { c, actor, who } = await adminWrite();
    if (patch && Object.keys(patch).length > 0) {
      const upd = vesselPatchToUpdate(patch);
      const { error: uErr } = await c.from("vessel_review_queue").update(upd).eq("id", id);
      if (uErr) return { success: false, error: uErr.message };
    }
    // The data-quality gate on the review channel: the vessel row the sync is
    // about to write is checked first; a block-level rule refuses the sync.
    {
      const { data: q } = await c.from("vessel_review_queue").select("vessel_name, vessel_type, dwt_grain, built, flag, grt, nrt").eq("id", id).maybeSingle();
      const qr = (q ?? {}) as { vessel_name?: string; vessel_type?: string | null; dwt_grain?: number | null; built?: number | null; flag?: string | null; grt?: number | null; nrt?: number | null };
      const gate = await validateRow(c, "vessels", {
        vessel_name: qr.vessel_name, imo_number: trimmed, vessel_type: qr.vessel_type ?? null, dwt_grain: qr.dwt_grain ?? null, build_year: qr.built ?? null,
        flag: qr.flag ?? null, gross_tonnage: qr.grt ?? null, scnrt: qr.nrt ?? null,
      }, "review", { id: actor, name: "Manual Review sync" });
      if (gate.blocked) {
        const why = gate.issues.filter((i) => i.mode === "block").map((i) => `${i.rule_code} — ${i.message}`).join("; ");
        return { success: false, error: `Refused by the data-quality gate: ${why}. Fix it in the form, or relax the rule's review channel in Data quality → Gate.` };
      }
    }
    const { data, error } = await c.rpc("resolve_vessel_review", { p_id: id, p_imo: trimmed, p_actor: actor });
    if (error) return { success: false, error: error.message };
    const d = data as { vessel_id: string; op: string; availability_id: string | null; port_resolved: boolean | null };
    // Poster line on the market: the circular's sender (person + company)
    // rides onto the posted position. Best-effort — never fails the sync.
    if (d.availability_id) {
      try {
        const { data: q } = await c.from("vessel_review_queue").select("source_email").eq("id", id).single();
        const src = (q?.source_email ?? null) as { from?: string | null; name?: string | null } | null;
        if (src) {
          const sender = parseSender(src.from, src.name);
          if (sender.contact || sender.company)
            await c.from("vessel_availability")
              .update({ source_contact: sender.contact, source_company: sender.company })
              .eq("id", d.availability_id);
        }
      } catch (e) {
        console.error("[data-sync] poster source on availability:", e);
      }
    }
    await logAudit(c, { actor: who, action: "queue.vessel.sync", targetKind: "queue", targetId: id, summary: `Synced queued vessel ${trimmed ? `with IMO ${trimmed}` : "WITHOUT an IMO (temporary)"} — ${d.op}`, detail: { imo: trimmed, patch: patch ?? null, ...d } });
    revalidatePath("/admin/data-sync");
    // The sync now posts the OPEN position too — refresh the market pages.
    revalidatePath("/dashboard", "layout");
    revalidatePath("/dashboard/vessels");
    revalidatePath("/");
    return { success: true, data: { vesselId: d.vessel_id, op: d.op, availabilityId: d.availability_id ?? null, portResolved: !!d.port_resolved } };
  } catch (e) {
    return fail(e, "Could not sync the vessel.");
  }
}

// Save corrected fields on a queue entry WITHOUT syncing (used before matching
// so the match runs on what the admin actually sees).
// ── reference lists for the vessel review drawer ────────────────────────────
export interface FlagStateOpt { name: string; category: "open" | "national" | "unknown" }
export async function listFlagStates(): Promise<Result<FlagStateOpt[]>> {
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("flag_states")
      .select("name, category")
      .eq("is_active", true)
      .order("sort_order", { ascending: true, nullsFirst: false })
      .order("name")
      .limit(500);
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as FlagStateOpt[] };
  } catch (e) {
    return fail(e, "Could not read the flag registry.");
  }
}

export interface OrganizationOpt { name: string; org_type: string | null }
export async function listOrganizationNames(): Promise<Result<OrganizationOpt[]>> {
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("organizations")
      .select("name, org_type")
      .order("name")
      .limit(2000);
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as OrganizationOpt[] };
  } catch (e) {
    return fail(e, "Could not read the company registry.");
  }
}

export async function resolveVesselQueuePatchOnly(id: string, patch: VesselQueuePatch): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const { c, who } = await adminWrite();
    const upd = vesselPatchToUpdate(patch);
    if (Object.keys(upd).length === 0) return { success: true };
    const { error } = await c.from("vessel_review_queue").update(upd).eq("id", id);
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "queue.vessel.patch", targetKind: "queue", targetId: id, summary: `Corrected queued vessel fields — ${Object.keys(upd).join(", ")}`, detail: upd });
    return { success: true };
  } catch (e) {
    return fail(e, "Could not save the edits.");
  }
}

// Matches for a QUEUED vessel — works on incomplete records (whatever fields
// exist participate; a missing DWT simply yields no qty scoring candidates).
export async function findVesselQueueMatches(id: string): Promise<Result<MatchView[]>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const c = await adminClient();
    const { data: q, error } = await c
      .from("vessel_review_queue")
      .select("dwt_grain, built, open_port, open_country, open_zone, dest_zones")
      .eq("id", id).maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!q) return { success: false, error: "Queue entry not found." };
    if (q.dwt_grain == null) return { success: false, error: "Add a DWT first — matching needs at least the vessel size." };
    const { loadMatches } = await import("@/lib/sync/match");
    const matches = await loadMatches(c, "vessels", {
      dwt_grain: q.dwt_grain, build_year: q.built,
      open_port: q.open_port, open_country: q.open_country, open_zone: q.open_zone, dest_zones: q.dest_zones,
    });
    return { success: true, data: matches.map(({ kind, label, facts, band, origin }) => ({ kind, label, facts, band, origin })) };
  } catch (e) {
    return fail(e, "Match search failed.");
  }
}

// Reply to the queued vessel's WhatsApp contact with the masked match summary.
export async function sendVesselQueueTeaser(id: string): Promise<Result<{ status: string }>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const { c, who } = await adminWrite();
    const { data: q, error } = await c
      .from("vessel_review_queue")
      .select("dwt_grain, built, open_port, open_country, open_zone, dest_zones, source_email")
      .eq("id", id).maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!q) return { success: false, error: "Queue entry not found." };
    const src = (q.source_email ?? {}) as { from?: string | null; channel?: string };
    const to = src.from ?? "";
    const isWa = src.channel === "whatsapp" || /@(s\.whatsapp\.net|lid)$/.test(to);
    if (!isWa || !to || to.startsWith("simulated")) {
      return { success: false, error: "This entry has no reachable WhatsApp contact." };
    }
    if (q.dwt_grain == null) return { success: false, error: "Add a DWT first — the summary needs the vessel size." };

    const { data: cfg } = await c.from("whatsapp_config").select("platform_url").maybeSingle();
    const { loadMatches } = await import("@/lib/sync/match");
    const { composeTeaser } = await import("@/lib/sync/whatsapp/ack");
    const { sendWhatsApp } = await import("@/lib/sync/whatsapp/send");
    const matches = await loadMatches(c, "vessels", {
      dwt_grain: q.dwt_grain, build_year: q.built,
      open_port: q.open_port, open_country: q.open_country, open_zone: q.open_zone, dest_zones: q.dest_zones,
    });
    const body = composeTeaser(matches, cfg?.platform_url ?? "https://arabshipbroker.com");
    const sent = await sendWhatsApp(c, { to, body, kind: "teaser", messageId: null });
    if (!sent.ok) return { success: false, error: sent.error ?? "Send failed." };
    await logAudit(c, { actor: who, action: "whatsapp.teaser", targetKind: "queue", targetId: id, summary: `Sent the masked match summary to the queued vessel's contact (${sent.status})`, detail: { status: sent.status, matches: matches.length } });
    return { success: true, data: { status: sent.status } };
  } catch (e) {
    return fail(e, "Teaser send failed.");
  }
}

export async function ignoreVesselReview(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const { c, actor, who } = await adminWrite();
    const { error } = await c
      .from("vessel_review_queue")
      .update({ status: "ignored", resolved_by: actor, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "queue.vessel.ignore", targetKind: "queue", targetId: id, summary: "Ignored a vessel review entry" });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not update the queue.");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// WhatsApp source — inbox, processing sweep, matches, teaser
// ════════════════════════════════════════════════════════════════════════════

export interface WhatsappMessageRow {
  id: string;
  provider: string;
  wa_from: string;
  contact_name: string | null;
  body: string;
  received_at: string;
  status: "pending" | "staged" | "irrelevant" | "failed";
  error: string | null;
  batch_id: string | null;
  staged_cargo: number;
  staged_vessels: number;
  ack_status: string;
  teaser_sent_at: string | null;
}

export async function listWhatsappMessages(limit = 15): Promise<Result<WhatsappMessageRow[]>> {
  try {
    const c = await adminClient();
    const { data, error } = await c
      .from("whatsapp_message")
      .select("id, provider, wa_from, contact_name, body, received_at, status, error, batch_id, staged_cargo, staged_vessels, ack_status, teaser_sent_at")
      .in("status", ["pending", "staged", "failed"]) // never surface irrelevant/personal noise
      .order("received_at", { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 50));
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as WhatsappMessageRow[] };
  } catch (e) {
    return fail(e, "Could not read WhatsApp messages.");
  }
}

// Delete one inbox message (its review batch, if any, is untouched).
export async function deleteWhatsappMessage(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid message id." };
  try {
    const { c, who } = await adminWrite();
    const { error } = await c.from("whatsapp_message").delete().eq("id", id);
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "whatsapp.message.delete", targetKind: "whatsapp_message", targetId: id, summary: "Deleted a WhatsApp inbox message" });
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return fail(e, "Could not delete the message.");
  }
}

// Clear the whole inbox (messages only — review batches and synced data stay).
export async function clearWhatsappInbox(): Promise<Result<{ deleted: number }>> {
  try {
    const { c, who } = await adminWrite();
    const { data, error } = await c
      .from("whatsapp_message")
      .delete()
      .in("status", ["pending", "staged", "failed", "irrelevant"])
      .select("id");
    if (error) return { success: false, error: error.message };
    await logAudit(c, { actor: who, action: "whatsapp.inbox.clear", targetKind: "whatsapp_message", summary: `Cleared the WhatsApp inbox — ${data?.length ?? 0} message(s)`, detail: { deleted: data?.length ?? 0 } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { deleted: data?.length ?? 0 } };
  } catch (e) {
    return fail(e, "Could not clear the inbox.");
  }
}

// Manual sweep: classify+stage+ack anything pending (and optionally failed).
export type { ProcessSummary } from "@/lib/sync/whatsapp/process";
export async function processWhatsapp(includeFailed = false): Promise<Result<ProcessSummary>> {
  try {
    const { c, who } = await adminWrite();
    const { processPendingWhatsapp } = await import("@/lib/sync/whatsapp/process");
    const res = await processPendingWhatsapp(c, { includeFailed, limit: 25, budgetMs: 50_000, owner: "admin" });
    await logAudit(c, { actor: who, action: "run.whatsapp.sweep", targetKind: "run", summary: `WhatsApp sweep — ${res.processed} processed · ${res.staged} staged · ${res.irrelevant} irrelevant · ${res.failed} failed`, detail: { includeFailed, processed: res.processed, staged: res.staged, irrelevant: res.irrelevant, failed: res.failed, usage: res.usage }, ok: !(res.failed && !res.staged) });
    revalidatePath("/admin/data-sync");
    return { success: true, data: res };
  } catch (e) {
    return fail(e, "Processing failed.");
  }
}

// A pasted-message dry run (no WhatsApp connection needed): inserts a synthetic
// inbox message and processes it — mirrors the email "Test with a pasted email".
export async function simulateWhatsapp(sample: string): Promise<Result<{ log: string[]; steps: ProcessSummary["steps"]; usage: ProcessSummary["usage"] }>> {
  const text = sample?.trim();
  if (!text) return { success: false, error: "Paste a WhatsApp message to classify." };
  if (text.length > 8000) return { success: false, error: "Sample is too long." };
  try {
    const { c, who } = await adminWrite();
    const { error } = await c.from("whatsapp_message").insert({
      wa_message_id: `SIM:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      provider: "unofficial", wa_from: "simulated@s.whatsapp.net",
      contact_name: "Simulated contact", body: text, raw: { simulated: true },
    });
    if (error) return { success: false, error: error.message };
    const { processPendingWhatsapp } = await import("@/lib/sync/whatsapp/process");
    const res = await processPendingWhatsapp(c, { limit: 5, budgetMs: 50_000, owner: "admin:simulate" });
    await logAudit(c, { actor: who, action: "run.whatsapp.simulate", targetKind: "run", summary: `WhatsApp dry run on a pasted message — ${res.staged} staged · ${res.irrelevant} irrelevant · ${res.failed} failed`, detail: { chars: text.length, usage: res.usage } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { log: res.log, steps: res.steps, usage: res.usage } };
  } catch (e) {
    return fail(e, "Simulation failed.");
  }
}

// ── matches for a staged row (live DB + uncommitted drafts) ──────────────────
export interface MatchView {
  kind: "vessel" | "cargo";
  label: string;
  facts: string[];
  band: "Strong" | "Good" | "Possible";
  origin: "live" | "draft";
}

export async function findMatches(stagedRowId: string): Promise<Result<MatchView[]>> {
  if (!UUID_RE.test(stagedRowId)) return { success: false, error: "Invalid row id." };
  try {
    const c = await adminClient();
    const { data: row, error } = await c
      .from("sync_staged_row").select("sheet, payload").eq("id", stagedRowId).maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!row) return { success: false, error: "Staged row not found." };
    if (row.sheet !== "cargo" && row.sheet !== "vessels")
      return { success: false, error: "Matching is available for cargo and vessel rows." };
    const { loadMatches } = await import("@/lib/sync/match");
    const matches = await loadMatches(c, row.sheet as "cargo" | "vessels", (row.payload ?? {}) as Record<string, unknown>);
    return { success: true, data: matches.map(({ kind, label, facts, band, origin }) => ({ kind, label, facts, band, origin })) };
  } catch (e) {
    return fail(e, "Match search failed.");
  }
}

// ── admin-triggered teaser: masked match summary → the WhatsApp contact ──────
export async function sendMatchTeaser(
  whatsappMessageId: string,
  stagedRowId: string,
): Promise<Result<{ status: string }>> {
  if (!UUID_RE.test(whatsappMessageId) || !UUID_RE.test(stagedRowId))
    return { success: false, error: "Invalid id." };
  try {
    const { c, who } = await adminWrite();
    const { data: msg, error: mErr } = await c
      .from("whatsapp_message").select("id, wa_from").eq("id", whatsappMessageId).maybeSingle();
    if (mErr) return { success: false, error: mErr.message };
    if (!msg) return { success: false, error: "WhatsApp message not found." };

    const { data: row, error: rErr } = await c
      .from("sync_staged_row").select("sheet, payload").eq("id", stagedRowId).maybeSingle();
    if (rErr) return { success: false, error: rErr.message };
    if (!row || (row.sheet !== "cargo" && row.sheet !== "vessels"))
      return { success: false, error: "Staged row not found." };

    const { data: cfg } = await c.from("whatsapp_config").select("platform_url").maybeSingle();
    const { loadMatches } = await import("@/lib/sync/match");
    const { composeTeaser } = await import("@/lib/sync/whatsapp/ack");
    const { sendWhatsApp } = await import("@/lib/sync/whatsapp/send");

    const matches = await loadMatches(c, row.sheet as "cargo" | "vessels", (row.payload ?? {}) as Record<string, unknown>);
    const body = composeTeaser(matches, cfg?.platform_url ?? "https://arabshipbroker.com");
    const sent = await sendWhatsApp(c, { to: msg.wa_from, body, kind: "teaser", messageId: msg.id });
    if (!sent.ok) return { success: false, error: sent.error ?? "Teaser send failed." };

    await c.from("whatsapp_message").update({ teaser_sent_at: new Date().toISOString() }).eq("id", msg.id);
    await logAudit(c, { actor: who, action: "whatsapp.teaser", targetKind: "whatsapp_message", targetId: msg.id, summary: `Sent the masked match summary to ${msg.wa_from.replace("@s.whatsapp.net", "")} (${sent.status})`, detail: { stagedRowId, status: sent.status, matches: matches.length } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { status: sent.status } };
  } catch (e) {
    return fail(e, "Teaser send failed.");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Duplicate pairs (Review) — DQ-U03 same cargo under two refs, DQ-U04 the same
// ship with and without an IMO. Detection is pure (lib/sync/dupes.ts); the
// merge is reversible: the dropped row is re-classified 'unchanged' (never
// committed) and carries an info flag pointing at the kept row, so "Restore"
// simply re-validates it.
// ════════════════════════════════════════════════════════════════════════════
export type { DupPair } from "@/lib/sync/dupes";

export async function findDuplicatePairs(batchId: string): Promise<Result<DupPair[]>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const c = await adminClient();
    // The open batch plus any other draft batch: a workbook row and a circular
    // row for the same order live in different batches by construction.
    const { data: drafts } = await c.from("sync_batch").select("id").in("status", OPEN_BATCH_STATUSES).order("created_at", { ascending: false }).limit(6);
    const ids = Array.from(new Set([batchId, ...((drafts ?? []) as { id: string }[]).map((b) => b.id)]));
    const [{ data: rows, error }, { data: queue }] = await Promise.all([
      c.from("sync_staged_row")
        .select("id, sheet, business_key, classification, committed, payload, batch_id")
        .in("batch_id", ids).in("sheet", ["cargo", "vessels"]).neq("classification", "unchanged")
        .limit(4000),
      c.from("vessel_review_queue").select("id, vessel_name, built, dwt_grain").eq("status", "pending").limit(500),
    ]);
    if (error) return { success: false, error: error.message };
    const staged = (rows ?? []) as StagedLite[];
    const pairs = [
      ...findCargoDuplicates(staged),
      ...findVesselDuplicates(staged.filter((r) => r.batch_id === batchId), (queue ?? []) as QueuedVesselLite[]),
    ];
    return { success: true, data: pairs.slice(0, 40) };
  } catch (e) {
    return fail(e, "Could not look for duplicates.");
  }
}

export async function mergeStagedRows(keepId: string, dropId: string, dropOrigin: "staged" | "queue"): Promise<Result<{ filled: string[] }>> {
  if (!UUID_RE.test(keepId) || !UUID_RE.test(dropId)) return { success: false, error: "Invalid row id." };
  try {
    const { c, actor, who } = await adminWrite();
    const { data: keep, error: kErr } = await c.from("sync_staged_row").select("id, sheet, payload, committed, flags").eq("id", keepId).maybeSingle();
    if (kErr) return { success: false, error: kErr.message };
    if (!keep) return { success: false, error: "The row to keep was not found." };
    if (keep.committed) return { success: false, error: "The kept row is already committed — undo the batch first." };

    let filled: string[] = [];
    if (dropOrigin === "queue") {
      // DQ-U04: the IMO-less queue entry is superseded by the registered row.
      const { error } = await c.from("vessel_review_queue")
        .update({ status: "ignored", resolved_by: actor, resolved_at: new Date().toISOString() })
        .eq("id", dropId).eq("status", "pending");
      if (error) return { success: false, error: error.message };
    } else {
      const { data: drop, error: dErr } = await c.from("sync_staged_row").select("id, sheet, payload, committed, flags").eq("id", dropId).maybeSingle();
      if (dErr) return { success: false, error: dErr.message };
      if (!drop) return { success: false, error: "The duplicate row was not found." };
      if (drop.committed) return { success: false, error: "The duplicate is already committed — undo the batch first." };
      if (drop.sheet !== keep.sheet) return { success: false, error: "Rows belong to different sheets." };
      // Fill the kept row's gaps from the duplicate, through the same
      // validate + gate path as any edit.
      const pt = previewTable(keep.sheet as string);
      const editable = (pt?.columns ?? []).filter((cc) => cc.editable !== false).map((cc) => cc.col);
      const patch = mergePatch(keep.payload as Record<string, unknown>, drop.payload as Record<string, unknown>, editable);
      filled = Object.keys(patch);
      if (filled.length) {
        const r = await editStagedRow(keepId, patch);
        if (!r.success) return r;
      }
      // Park the duplicate: 'unchanged' is never committed, stays visible with
      // "Changes only" off, and restoring is one re-validate away.
      const flags = [...((drop.flags as { level: string; field?: string; msg: string }[]) ?? []).filter((f) => !f.msg.startsWith("merged into")),
        { level: "info", msg: `merged into ${keepId}` }];
      const { error } = await c.from("sync_staged_row").update({ classification: "unchanged", flags }).eq("id", dropId);
      if (error) return { success: false, error: error.message };
    }
    await logAudit(c, { actor: who, action: "row.merge", targetKind: "staged_row", targetId: keepId, summary: `Merged duplicate ${dropOrigin === "queue" ? "queue entry" : "staged row"} ${dropId.slice(0, 8)} into ${keepId.slice(0, 8)}${filled.length ? ` — filled ${filled.join(", ")}` : ""}`, detail: { keepId, dropId, dropOrigin, filled } });
    revalidatePath("/admin/data-sync");
    return { success: true, data: { filled } };
  } catch (e) {
    return fail(e, "Merge failed.");
  }
}

/** Undo a merge: re-validate the parked row so it regains its real class. */
export async function restoreMergedRow(rowId: string): Promise<Result<{ classification: string }>> {
  if (!UUID_RE.test(rowId)) return { success: false, error: "Invalid row id." };
  try {
    const { c, who } = await adminWrite();
    const { data: row, error } = await c.from("sync_staged_row").select("payload, flags, sheet").eq("id", rowId).maybeSingle();
    if (error) return { success: false, error: error.message };
    if (!row) return { success: false, error: "Row not found." };
    const flags = ((row.flags as { level: string; msg: string }[]) ?? []).filter((f) => !f.msg.startsWith("merged into"));
    await c.from("sync_staged_row").update({ flags }).eq("id", rowId);
    // Re-run the row through validate + diff + gate by "editing" its key column
    // to itself — the cheapest way to reclassify without a second code path.
    const spec = specById(row.sheet as string);
    const key = spec ? (row.payload as RawRow)[spec.keyColumn] : null;
    if (!spec || key == null) return { success: false, error: "Row has no business key to re-validate." };
    await logAudit(c, { actor: who, action: "row.restore", targetKind: "staged_row", targetId: rowId, summary: `Restored merged row ${String(key)} (${row.sheet}) for re-validation` });
    return editStagedRow(rowId, { [spec.keyColumn]: key });
  } catch (e) {
    return fail(e, "Restore failed.");
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Audit trail (read) — public.data_sync_audit, written by every action above.
// ════════════════════════════════════════════════════════════════════════════
export type { AuditRow } from "@/lib/admin/data-sync-audit";

export async function listDataSyncAudit(f: {
  family?: string | null; actorId?: string | null; q?: string | null;
  from?: string | null; to?: string | null; limit?: number; beforeId?: number | null;
} = {}): Promise<Result<{ rows: AuditRow[]; actors: { id: string; name: string }[] }>> {
  try {
    const c = await adminClient();
    const limit = Math.min(Math.max(f.limit ?? 100, 1), 500);
    let q = c.from("data_sync_audit")
      .select("id, at, actor_id, actor_name, actor_kind, action, target_kind, target_id, batch_id, summary, detail, ok, ip")
      .order("id", { ascending: false }).limit(limit);
    if (f.family && AUDIT_FAMILIES.some((x) => x.id === f.family)) q = q.like("action", `${f.family}.%`);
    if (f.actorId === "system") q = q.neq("actor_kind", "admin");
    else if (f.actorId && UUID_RE.test(f.actorId)) q = q.eq("actor_id", f.actorId);
    if (f.q) { const t = sanitizeSearch(f.q); if (t) q = q.or(`summary.ilike.%${t}%,target_id.ilike.%${t}%,action.ilike.%${t}%`); }
    if (f.from) q = q.gte("at", f.from);
    if (f.to) q = q.lte("at", f.to);
    if (f.beforeId) q = q.lt("id", f.beforeId);
    const [{ data, error }, actorsRes] = await Promise.all([
      q,
      c.from("data_sync_audit").select("actor_id, actor_name").not("actor_id", "is", null).order("at", { ascending: false }).limit(500),
    ]);
    if (error) return { success: false, error: error.message };
    const seen = new Map<string, string>();
    for (const a of (actorsRes.data ?? []) as { actor_id: string; actor_name: string | null }[]) if (!seen.has(a.actor_id)) seen.set(a.actor_id, a.actor_name ?? a.actor_id.slice(0, 8));
    return { success: true, data: { rows: (data ?? []) as AuditRow[], actors: [...seen].map(([id, name]) => ({ id, name })) } };
  } catch (e) {
    return fail(e, "Could not read the audit trail.");
  }
}

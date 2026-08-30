"use server";

// Data Sync server actions. Every mutation is gated by requireAdmin({ edit }) and
// runs through the service-role client; commits/undo call the Phase 1 RPCs so the
// audited, reversible write path is the only way rows reach a live table.

import { revalidatePath } from "next/cache";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { SHEET_SPECS, specById, ZONES } from "@/lib/sync/sheets";
import { classify } from "@/lib/sync/diff";
import { previewTable, coerce } from "@/lib/sync/preview";
import { str, num, intStrip, locode, upper, parseLaycan } from "@/lib/sync/normalize";
import { FUEL_TYPES } from "@/lib/schemas/vessel";
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

// Writes need the acting admin's public.users.id for the audit trail.
async function adminWrite() {
  const u = await requireAdmin({ section: "datasync", edit: true });
  return { c: getSupabaseAdminClient(), actor: u.rowId };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// PostgREST .or() parses commas/parens/dots — strip them so a search term can
// never break out of the ilike filter it's interpolated into.
function sanitizeSearch(s: string): string {
  return s.replace(/[,()%*\\]/g, " ").trim().slice(0, 60);
}

function badBatch(id: string): string | null {
  return UUID_RE.test(id) ? null : "Invalid batch id.";
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
    const c = await adminClient();
    const { data, error } = await c.rpc("commit_sync_batch", { p_batch_id: batchId, p_sheet: sheet });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true, data: data as { inserted: number; updated: number; skipped: number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Commit failed." };
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
    const c = await adminClient();
    const { data, error } = await c.rpc("commit_sync_batch", { p_batch_id: batchId, p_sheet: sheet, p_row_ids: rowIds });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true, data: data as { inserted: number; updated: number; skipped: number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Commit failed." };
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
    const c = await adminClient();
    const { data: row, error: rErr } = await c
      .from("sync_staged_row")
      .select("sheet, target_table, key_column, business_key, payload, raw, committed")
      .eq("id", rowId)
      .maybeSingle();
    if (rErr) return { success: false, error: rErr.message };
    if (!row) return { success: false, error: "Staged row not found." };
    if (row.committed) return { success: false, error: "This row is already committed — undo the batch to change it." };

    const spec = specById(row.sheet as string);
    if (!spec) return { success: false, error: `Unknown sheet "${row.sheet}".` };
    const pt = previewTable(row.sheet as string);

    const payload = { ...(row.payload as RawRow) };
    for (const [k, v] of Object.entries(patch)) {
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
    revalidatePath("/admin/data-sync");
    return { success: true, data: { classification } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not save the edit." };
  }
}

export async function commitAll(
  batchId: string,
): Promise<Result<{ inserted: number; updated: number; skipped: number }>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const c = await adminClient();
    const { data, error } = await c.rpc("commit_sync_batch", { p_batch_id: batchId, p_sheet: null });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true, data: data as { inserted: number; updated: number; skipped: number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Commit failed." };
  }
}

// ── undo (the reversible guarantee) ────────────────────────────────────────
export async function undoBatch(
  batchId: string,
): Promise<Result<{ reverted: number; deleted: number }>> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const c = await adminClient();
    const { data, error } = await c.rpc("undo_sync_batch", { p_batch_id: batchId });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true, data: data as { reverted: number; deleted: number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Undo failed." };
  }
}

// ── discard a draft batch (nothing committed → safe hard delete) ────────────
export async function discardBatch(batchId: string): Promise<Result> {
  const bad = badBatch(batchId);
  if (bad) return { success: false, error: bad };
  try {
    const c = await adminClient();
    const { data: batch, error: readErr } = await c
      .from("sync_batch").select("status").eq("id", batchId).maybeSingle();
    if (readErr) return { success: false, error: readErr.message };
    if (!batch) return { success: false, error: "Batch not found." };
    if (batch.status === "committed" || batch.status === "committing") {
      return { success: false, error: "This batch has committed rows — undo it instead of discarding." };
    }
    const { error } = await c.from("sync_batch").delete().eq("id", batchId); // cascades staged rows
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Discard failed." };
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
  opts: { changesOnly?: boolean; limit?: number; offset?: number } = {},
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read staged rows." };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read invalid rows." };
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
  } catch {
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
    const c = await adminClient();
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
    revalidatePath("/dashboard");
    revalidatePath("/");
    return {
      success: true,
      data: res as { posted: number; closed: number; skipped: number },
    };
  } catch (e) {
    return {
      success: false,
      error: e instanceof Error ? e.message : "Could not post open positions.",
    };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read batch." };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read records." };
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
    const { c, actor } = await adminWrite();
    const { data, error } = await c.rpc("edit_live_record", {
      p_table: t.table, p_key: key, p_patch: clean, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "save") };
    revalidatePath("/admin/data-sync");
    return { success: true, data: { auditId: (data as { audit_id: string }).audit_id } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Edit failed." };
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
    const { c, actor } = await adminWrite();
    const { data, error } = await c.rpc("insert_live_record", {
      p_table: t.table, p_row: clean, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "add") };
    revalidatePath("/admin/data-sync");
    return { success: true, data: { auditId: (data as { audit_id: string }).audit_id, key } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Add failed." };
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
    const { c, actor } = await adminWrite();
    const { data, error } = await c.rpc("bulk_update_live_records", {
      p_table: t.table, p_keys: keys, p_patch: clean, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "apply") };
    revalidatePath("/admin/data-sync");
    const d = data as { updated: number; group_id: string };
    return { success: true, data: { updated: d.updated, groupId: d.group_id } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Bulk edit failed." };
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
    const { c, actor } = await adminWrite();
    const { data, error } = await c.rpc("bulk_delete_live_records", {
      p_table: t.table, p_keys: keys, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "delete") };
    revalidatePath("/admin/data-sync");
    const d = data as { deleted: number; group_id: string };
    return { success: true, data: { deleted: d.deleted, groupId: d.group_id } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Bulk delete failed." };
  }
}

// ── audited delete ──────────────────────────────────────────────────────────
export async function deleteRecord(tableId: string, key: string): Promise<Result> {
  const t = previewTable(tableId);
  if (!t) return { success: false, error: `Unknown table "${tableId}".` };
  if (!key) return { success: false, error: "Missing record key." };
  try {
    const { c, actor } = await adminWrite();
    const { error } = await c.rpc("delete_live_record", { p_table: t.table, p_key: key, p_actor: actor });
    if (error) return { success: false, error: friendlyDbError(error, "delete") };
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

// ── undo an edit or a whole bulk group ──────────────────────────────────────
export async function undoEdit(
  ref: { auditId?: string; groupId?: string },
): Promise<Result<{ restored: number; reinserted: number; removed?: number }>> {
  const { auditId, groupId } = ref;
  if (auditId && !UUID_RE.test(auditId)) return { success: false, error: "Invalid edit id." };
  if (groupId && !UUID_RE.test(groupId)) return { success: false, error: "Invalid group id." };
  if (!auditId && !groupId) return { success: false, error: "Nothing to undo." };
  try {
    const { c, actor } = await adminWrite();
    const { data, error } = await c.rpc("undo_record_edits", {
      p_audit_id: auditId ?? null, p_group_id: groupId ?? null, p_actor: actor,
    });
    if (error) return { success: false, error: friendlyDbError(error, "undo") };
    revalidatePath("/admin/data-sync");
    return { success: true, data: data as { restored: number; reinserted: number; removed?: number } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Undo failed." };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read edit history." };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read the review queue." };
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
  } catch {
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
    const { c, actor } = await adminWrite();
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
    revalidatePath("/admin/data-sync");
    return { success: true, data: { commodityId: (data as { commodity_id: string }).commodity_id } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not resolve the commodity." };
  }
}

export async function ignoreCommodityReview(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const { c, actor } = await adminWrite();
    const { error } = await c
      .from("commodity_review_queue")
      .update({ status: "ignored", resolved_by: actor, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not update the queue." };
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
  source: string;
  status: "pending" | "synced" | "ignored";
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
      .select("id, vessel_name, built, dwt_grain, vessel_type, flag, grt, nrt, open_date, imo_hint, open_port, open_country, open_zone, direction, dest_zones, posted_at, source, status, source_email, created_at")
      .eq("status", status)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) return { success: false, error: error.message };
    return { success: true, data: (data ?? []) as VesselQueueRow[] };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not read the vessel queue." };
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
  } catch {
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
  return upd;
}

// imo null/blank → composite sync (name+built+dwt); otherwise upsert by IMO.
// An optional patch lets the admin CORRECT the extracted fields (name, dwt,
// built, type, flag) before the vessel is synced — the RPC reads the queue row.
export async function resolveVesselReview(
  id: string,
  imo?: string | null,
  patch?: VesselQueuePatch,
): Promise<Result<{ vesselId: string; op: string }>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  const trimmed = imo?.trim() || null;
  if (trimmed && !/^\d{7}$/.test(trimmed)) return { success: false, error: "An IMO number is 7 digits — leave it blank to sync without one." };
  if (patch && "vessel_name" in patch && !patch.vessel_name?.trim())
    return { success: false, error: "The vessel needs a name." };
  try {
    const { c, actor } = await adminWrite();
    if (patch && Object.keys(patch).length > 0) {
      const upd = vesselPatchToUpdate(patch);
      const { error: uErr } = await c.from("vessel_review_queue").update(upd).eq("id", id);
      if (uErr) return { success: false, error: uErr.message };
    }
    const { data, error } = await c.rpc("resolve_vessel_review", { p_id: id, p_imo: trimmed, p_actor: actor });
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    const d = data as { vessel_id: string; op: string };
    return { success: true, data: { vesselId: d.vessel_id, op: d.op } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not sync the vessel." };
  }
}

// Save corrected fields on a queue entry WITHOUT syncing (used before matching
// so the match runs on what the admin actually sees).
export async function resolveVesselQueuePatchOnly(id: string, patch: VesselQueuePatch): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const { c } = await adminWrite();
    const upd = vesselPatchToUpdate(patch);
    if (Object.keys(upd).length === 0) return { success: true };
    const { error } = await c.from("vessel_review_queue").update(upd).eq("id", id);
    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not save the edits." };
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
    return { success: false, error: e instanceof Error ? e.message : "Match search failed." };
  }
}

// Reply to the queued vessel's WhatsApp contact with the masked match summary.
export async function sendVesselQueueTeaser(id: string): Promise<Result<{ status: string }>> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const c = await adminClient();
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
    return { success: true, data: { status: sent.status } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Teaser send failed." };
  }
}

export async function ignoreVesselReview(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid queue id." };
  try {
    const { c, actor } = await adminWrite();
    const { error } = await c
      .from("vessel_review_queue")
      .update({ status: "ignored", resolved_by: actor, resolved_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not update the queue." };
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
    return { success: false, error: e instanceof Error ? e.message : "Could not read WhatsApp messages." };
  }
}

// Delete one inbox message (its review batch, if any, is untouched).
export async function deleteWhatsappMessage(id: string): Promise<Result> {
  if (!UUID_RE.test(id)) return { success: false, error: "Invalid message id." };
  try {
    const { c } = await adminWrite();
    const { error } = await c.from("whatsapp_message").delete().eq("id", id);
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not delete the message." };
  }
}

// Clear the whole inbox (messages only — review batches and synced data stay).
export async function clearWhatsappInbox(): Promise<Result<{ deleted: number }>> {
  try {
    const { c } = await adminWrite();
    const { data, error } = await c
      .from("whatsapp_message")
      .delete()
      .in("status", ["pending", "staged", "failed", "irrelevant"])
      .select("id");
    if (error) return { success: false, error: error.message };
    revalidatePath("/admin/data-sync");
    return { success: true, data: { deleted: data?.length ?? 0 } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Could not clear the inbox." };
  }
}

// Manual sweep: classify+stage+ack anything pending (and optionally failed).
export async function processWhatsapp(includeFailed = false): Promise<Result<{ processed: number; staged: number; irrelevant: number; failed: number; log: string[] }>> {
  try {
    const c = await adminClient();
    const { processPendingWhatsapp } = await import("@/lib/sync/whatsapp/process");
    const res = await processPendingWhatsapp(c, { includeFailed });
    revalidatePath("/admin/data-sync");
    return { success: true, data: res };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Processing failed." };
  }
}

// A pasted-message dry run (no WhatsApp connection needed): inserts a synthetic
// inbox message and processes it — mirrors the email "Test with a pasted email".
export async function simulateWhatsapp(sample: string): Promise<Result<{ log: string[] }>> {
  const text = sample?.trim();
  if (!text) return { success: false, error: "Paste a WhatsApp message to classify." };
  if (text.length > 8000) return { success: false, error: "Sample is too long." };
  try {
    const c = await adminClient();
    const { error } = await c.from("whatsapp_message").insert({
      wa_message_id: `SIM:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      provider: "unofficial", wa_from: "simulated@s.whatsapp.net",
      contact_name: "Simulated contact", body: text, raw: { simulated: true },
    });
    if (error) return { success: false, error: error.message };
    const { processPendingWhatsapp } = await import("@/lib/sync/whatsapp/process");
    const res = await processPendingWhatsapp(c);
    revalidatePath("/admin/data-sync");
    return { success: true, data: { log: res.log } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Simulation failed." };
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
    return { success: false, error: e instanceof Error ? e.message : "Match search failed." };
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
    const c = await adminClient();
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
    revalidatePath("/admin/data-sync");
    return { success: true, data: { status: sent.status } };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : "Teaser send failed." };
  }
}

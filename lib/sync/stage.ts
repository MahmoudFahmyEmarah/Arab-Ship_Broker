// stageBatch — turn a SyncSource into a durable sync_batch + sync_staged_row[].
//
// Source-agnostic: it never learns whether rows came from XLSX or email. Reads
// go through the service-role client (admin server actions gate access first).
// Everything here operates on staging; the live tables are untouched until an
// admin runs commit_sync_batch (Phase 1).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Cell, SheetCounts, StagedRow, SyncSource, RawRow } from "./types";
import { specById } from "./sheets";
import { buildStagedRow, mapRow } from "./diff";
import { fetchCommodityIndex, resolveCommodity, type CommodityIndex } from "./commodity";
import { fetchPortIndex, resolvePortLocode } from "./ports";
import { gateChannelFor } from "./batch-status";
import { referencedPortCodes, unknownPortCodes } from "./ports-check";

const CHUNK = 500;

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

// Retry a DB step over transient network blips ("fetch failed", 503, timeouts).
// Accepts a Supabase query builder (a PromiseLike, not a real Promise).
async function dbRetry<T>(fn: () => PromiseLike<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i += 1) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}

function emptyCounts(): SheetCounts {
  return { new: 0, updated: 0, unchanged: 0, invalid: 0, errors: 0, queued: 0 };
}

const asInt = (v: Cell): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null);
const asStr = (v: Cell): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
// Any parseable date/datetime string → "yyyy-mm-dd" (email-header formats included).
const isoDay = (v: string | null): string | null => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(+d) ? null : d.toISOString().slice(0, 10);
};

// Queue IMO-less vessels for manual review, deduped by a name+built+dwt
// composite. The DWT in the key is rounded to the nearest 100 — the same ship
// is routinely reported as 9,299 in one circular and 9,300 in the next, and an
// exact key turned every such wobble into a duplicate queue entry.
const compositeKeyFor = (name: string, built: number | null, dwt: number | null) =>
  `${name.toLowerCase()}|${built ?? ""}|${dwt != null ? Math.round(dwt / 100) * 100 : ""}`;

// Same ship, slightly different report? (placeholder "Unnamed vessel" rows are
// exempt — different ships share that name)
function isNearDup(
  a: { vessel_name: string; built: number | null; dwt_grain: number | null },
  name: string, built: number | null, dwt: number | null,
): boolean {
  if (a.vessel_name.toLowerCase() !== name.toLowerCase()) return false;
  if (name.toLowerCase().startsWith("unnamed vessel")) return false;
  if (a.built != null && built != null && a.built !== built) return false;
  if (a.dwt_grain != null && dwt != null) {
    const tol = Math.max(100, Math.round(a.dwt_grain / 20));
    if (Math.abs(a.dwt_grain - dwt) > tol) return false;
  }
  return true;
}

async function enqueueVessels(
  supabase: SupabaseClient,
  rows: StagedRow[],
  sourceKind: string,
  batchId: string,
): Promise<number> {
  const seen = new Set<string>();
  const queue: Record<string, unknown>[] = [];
  const incoming: { name: string; built: number | null; dwt: number | null }[] = [];
  for (const s of rows) {
    const raw = s.raw as Record<string, Cell>;
    // A circular may describe an unnamed vessel ("our vessel, 17k dwt…") — keep
    // it reviewable under a contact-derived placeholder instead of dropping it.
    const name =
      asStr(s.payload["vessel_name"]) ??
      `Unnamed vessel (${asStr(raw._SRC_NAME) ?? asStr(raw._SRC_FROM) ?? "unknown contact"})`;
    const built = asInt(s.payload["build_year"]);
    const dwt = asInt(s.payload["dwt_grain"]);
    const composite = compositeKeyFor(name, built, dwt);
    if (seen.has(composite)) continue;
    seen.add(composite);
    incoming.push({ name, built, dwt });
    const source_email = raw._SRC_FROM || raw._SRC_SUBJECT || raw._SRC_TEXT
      ? {
          from: raw._SRC_FROM ?? null, subject: raw._SRC_SUBJECT ?? null,
          date: raw._SRC_DATE ?? null, text: raw._SRC_TEXT ?? null,
          channel: raw._SRC_CHANNEL ?? "email", name: raw._SRC_NAME ?? null, msgId: raw._SRC_MSG_ID ?? null,
        }
      : null;
    const destZones = asStr(raw["DEST_ZONES"]);
    queue.push({
      vessel_name: name, built, dwt_grain: dwt,
      vessel_type: asStr(s.payload["vessel_type"]), flag: asStr(s.payload["flag"]),
      // tonnage intelligence — GRT is key for the Port Module / cost calc
      grt: asInt(raw["GRT"]), nrt: asInt(raw["NRT"]),
      // open-position intelligence (raw-only keys from the channel extraction).
      // Open date is a KEY matchmaking factor and never stays empty: the
      // extracted date wins, else the circular's posted date, else today —
      // the day the record entered the database.
      open_date: asStr(raw["OPEN_DATE"]) ?? isoDay(asStr(raw["_SRC_DATE"])) ?? isoDay(new Date().toISOString()),
      open_port: asStr(raw["OPEN_PORT"]), open_country: asStr(raw["OPEN_COUNTRY"]),
      open_zone: asStr(raw["OPEN_ZONE"]), direction: asStr(raw["DIRECTION"]),
      dest_zones: destZones ? destZones.split("|").filter(Boolean) : null,
      posted_at: asStr(raw["_SRC_DATE"]),
      composite_key: composite, source_email, source: sourceKind,
      first_batch_id: batchId, status: "pending", resolved_vessel_id: null, resolved_at: null,
    });
  }
  if (!queue.length) return 0;
  try {
    // Near-duplicate guard: a PENDING row for the same ship (same name, built
    // compatible, DWT within ~5%) absorbs the new sighting — position fields
    // refresh, missing scalars fill in — instead of spawning a second entry.
    const { data: pending, error: pErr } = await supabase
      .from("vessel_review_queue")
      .select("id, vessel_name, built, dwt_grain, posted_at")
      .eq("status", "pending")
      .in("vessel_name", incoming.map((i) => i.name))
      .limit(400);
    if (pErr) throw new Error(`vessel review queue: ${pErr.message}`);
    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const inserts: Record<string, unknown>[] = [];
    for (const q of queue) {
      const hit = (pending ?? []).find((p) =>
        isNearDup(p, q.vessel_name as string, q.built as number | null, q.dwt_grain as number | null));
      if (hit) {
        updates.push({
          id: hit.id,
          patch: {
            // fresher sighting wins the position; scalars only fill gaps
            open_port: q.open_port, open_country: q.open_country, open_zone: q.open_zone,
            direction: q.direction, dest_zones: q.dest_zones,
            open_date: q.open_date, posted_at: q.posted_at ?? hit.posted_at,
            source_email: q.source_email,
            ...(q.grt != null ? { grt: q.grt } : {}),
            ...(q.nrt != null ? { nrt: q.nrt } : {}),
            ...(q.built != null ? { built: q.built } : {}),
          },
        });
      } else {
        inserts.push(q);
      }
    }
    if (updates.length) {
      // one round trip for every refreshed sighting (phase 5)
      const { error } = await supabase.from("vessel_review_queue").upsert(updates.map((u) => ({ id: u.id, ...u.patch })), { onConflict: "id" });
      if (error) throw new Error(`vessel review queue: ${error.message}`);
    }
    if (inserts.length) {
      // Re-surface (re-open) a previously-resolved vessel when it's sighted again.
      const { error } = await supabase.from("vessel_review_queue").upsert(inserts, { onConflict: "composite_key" });
      if (error) throw new Error(`vessel review queue: ${error.message}`);
    }
    return queue.length;
  } catch (e) {
    // Phase 4 (18 Sep 2026): the queue is where these vessels LIVE — a failed
    // write used to drop them silently (the client returns {error}, it does
    // not throw). Now staging fails and says so; nothing is lost because the
    // batch is marked failed and can be staged again.
    throw new Error(`${queue.length} vessel(s) without an IMO could not be queued for Manual Review — ${e instanceof Error ? e.message : String(e)}. Fix the queue and stage the batch again.`);
  }
}

export interface StageResult {
  batchId: string;
  label: string | null;
  counts: Record<string, SheetCounts>;
  totals: SheetCounts;
  errors: { sheet: string; row: number; field?: string; msg: string }[];
  /** data-quality gate: rows blocked from commit / rows carrying warnings */
  gate?: { blocked: number; warned: number; rules: number };
}

export interface StageArgs {
  supabase: SupabaseClient;
  source: SyncSource;
  fileName?: string | null;
  startedBy?: string | null;
  label?: string | null;
}

export async function stageBatch({
  supabase,
  source,
  fileName = null,
  startedBy = null,
  label = null,
}: StageArgs): Promise<StageResult> {
  // 1 · open the batch (retried — a transient network drop here otherwise loses
  // the whole classified batch)
  const { data: batch, error: batchErr } = await dbRetry(() =>
    supabase
      .from("sync_batch")
      .insert({ source: source.kind, file_name: fileName, started_by: startedBy, label, status: "draft" })
      .select("id")
      .single(),
  );
  if (batchErr) throw new Error(`could not open sync batch: ${batchErr.message}`);
  const batchId = batch.id as string;

  const counts: Record<string, SheetCounts> = {};
  const totals = emptyCounts();
  const errors: StageResult["errors"] = [];

  try {
    const parsed = await source.parse();
    // ports staged in this same workbook count as known for its cargo rows
    const portsSpec = specById("ports");
    const batchPortCodes = new Set<string>(
      portsSpec
        ? parsed.filter((p) => p.sheet === "ports").flatMap((p) => p.rows.map((r) => String(mapRow(portsSpec, r).payload[portsSpec.keyColumn] ?? "").trim().toUpperCase()).filter(Boolean))
        : [],
    );

    for (const { sheet, rows } of parsed) {
      const spec = specById(sheet);
      if (!spec) continue;
      counts[sheet] = emptyCounts();

      // 2a · commodity normalization: split the packaging out of the raw
      // commodity phrase ("Brucite Ore in big bags" → name + packaging) and
      // link the cleaned name to the commodities catalog. Runs on the RAW
      // rows so the mapped payload, the diff and the review UI all see the
      // resolved values. A failed catalog fetch skips resolution (never
      // fatal) — and also disables the unlinked→queue rule below so a
      // transient DB error cannot flood the review queue.
      let commodityIndex: CommodityIndex | null = null;
      if (sheet === "cargo") {
        // 2b · port resolution: circulars name ports ("Novo", "Constantza",
        // "Jeddah Port"); key them to the registry LOCODE here so the listing
        // lands with its code + canonical name + zone, and the market cards
        // show port → port. Unresolvable text (countries, ranges) stays as the
        // name and the cards show it, then the zone.
        const portIndex = await fetchPortIndex(supabase);
        if (portIndex) {
          for (const raw of rows) {
            for (const [nameKey, codeKey] of [["LOAD_PORT", "LOAD_LOCODE"], ["DISCH_PORT", "DISCH_LOCODE"]] as const) {
              const code = raw[codeKey];
              if (code != null && String(code).trim()) continue;
              const nm = raw[nameKey];
              const hit = resolvePortLocode(typeof nm === "string" ? nm : null, portIndex);
              if (hit) raw[codeKey] = hit;
            }
          }
        }
        commodityIndex = await fetchCommodityIndex(supabase);
        if (commodityIndex) {
          for (const raw of rows) {
            const res = resolveCommodity(
              typeof raw["COMMODITY"] === "string" ? raw["COMMODITY"] : null,
              commodityIndex,
            );
            if (!res) continue;
            raw["COMMODITY"] = res.name;
            if (raw["PACKAGING"] == null || raw["PACKAGING"] === "") raw["PACKAGING"] = res.packaging;
            raw["COMMODITY_ID"] = res.commodityId;
          }
        }
      }

      // 2 · fetch existing live rows for this sheet's keys (chunked .in)
      const mappedPayloads = rows.map((r) => mapRow(spec, r).payload);
      const keys = Array.from(
        new Set(
          mappedPayloads
            .map((p) => p[spec.keyColumn])
            .filter((k): k is string | number => k != null && k !== "")
            .map(String),
        ),
      );
      // Phase 5: read only the columns the comparison looks at — the key, the
      // sheet's columns and whatever the mapper derived — instead of every column.
      const compareColumns = Array.from(new Set([spec.keyColumn, ...spec.columns.map((c) => c.column), ...mappedPayloads.flatMap((p) => Object.keys(p))])).join(", ");
      const existingByKey = new Map<string, Record<string, Cell>>();
      for (const part of chunk(keys, CHUNK)) {
        if (part.length === 0) continue;
        const { data, error } = await dbRetry(() => supabase.from(spec.targetTable).select(compareColumns).in(spec.keyColumn, part));
        if (error) throw new Error(`reading ${spec.targetTable}: ${error.message}`);
        for (const row of (data ?? []) as unknown as Record<string, Cell>[]) existingByKey.set(String(row[spec.keyColumn]), row);
      }

      // 2c · what this source said last time (latest COMMITTED staged payload
      // per key) so a re-upload of the same workbook does not overwrite edits
      // made in the database since (see classify()).
      const previousByKey = new Map<string, RawRow>();
      for (const part of chunk(keys, CHUNK)) {
        if (part.length === 0) continue;
        // Phase 4: scoped to THIS source (a circular's payload is no baseline
        // for a workbook upload), latest committed payload per key, one call.
        const { data, error } = await dbRetry(() => supabase.rpc("fn_sync_previous_payloads", { p_table: spec.targetTable, p_source: source.kind, p_keys: part }));
        if (error) throw new Error(`reading previous sync of ${spec.targetTable}: ${error.message}`);
        for (const row of (data ?? []) as { business_key: string; payload: RawRow }[]) previousByKey.set(row.business_key, row.payload ?? {});
      }

      // 3 · build + persist staged rows
      const built: StagedRow[] = rows.map((raw, i) => buildStagedRow(spec, raw, i + 1, existingByKey, null, previousByKey));

      // Phase 4: a port code the registry does not know makes the row invalid
      // HERE, with the field named — commit used to drop the code silently.
      if (sheet === "cargo") {
        const codes = referencedPortCodes(built.map((s) => s.payload));
        const known = new Set<string>();
        for (const part of chunk(codes, CHUNK)) {
          if (!part.length) continue;
          const { data, error } = await dbRetry(() => supabase.from("ports").select("locode").in("locode", part));
          if (error) throw new Error(`reading ports: ${error.message}`);
          for (const p of (data ?? []) as { locode: string }[]) known.add(String(p.locode).toUpperCase());
        }
        for (const s of built) {
          for (const u of unknownPortCodes(s.payload, known, batchPortCodes)) {
            s.flags.push({ level: "error", field: u.field, msg: `port code ${u.code} is not in the registry — place it in Admin → Ports or correct the code` });
          }
          if (s.classification !== "invalid" && s.flags.some((f) => f.level === "error")) s.classification = "invalid";
        }
      }

      // Vessels without an IMO have no business key → route them to the vessel
      // review queue (synced later by a name+built+dwt composite key) instead of
      // staging them as invalid rows. Only IMO-keyed vessels go through the sync.
      let staged = built;
      if (sheet === "vessels") {
        const noImo = built.filter((s) => !s.businessKey);
        staged = built.filter((s) => s.businessKey);
        if (noImo.length) {
          const queued = await enqueueVessels(supabase, noImo, source.kind, batchId);
          counts[sheet].queued = (counts[sheet].queued ?? 0) + queued;
          totals.queued = (totals.queued ?? 0) + queued;
        }
      }

      for (const s of staged) {
        counts[sheet][s.classification] += 1;
        totals[s.classification] += 1;
        const rowErrors = s.flags.filter((f) => f.level === "error");
        counts[sheet].errors += rowErrors.length ? 1 : 0;
        totals.errors += rowErrors.length ? 1 : 0;
        for (const f of rowErrors) errors.push({ sheet, row: s.rowIndex, field: f.field, msg: f.msg });
      }

      const records = staged.map((s) => ({
        batch_id: batchId,
        sheet: s.sheet,
        target_table: s.targetTable,
        key_column: s.keyColumn,
        business_key: s.businessKey,
        classification: s.classification,
        payload: s.payload,
        raw: s.raw,
        diff: s.diff,
        flags: s.flags,
        source_email_id: s.sourceEmailId,
        row_index: s.rowIndex,
        source: source.kind,
      }));

      for (const part of chunk(records, CHUNK)) {
        const { error } = await dbRetry(() => supabase.from("sync_staged_row").insert(part));
        if (error) throw new Error(`staging ${sheet}: ${error.message}`);
      }

      // 3b · surface unresolved commodities into the Manual Review queue:
      // rows flagged UNMAPPED (no regime) plus any row the catalog resolver
      // could not link (commodity_id still null). Best-effort: a queue hiccup
      // must never fail the batch.
      if (sheet === "cargo") {
        const seen = new Set<string>();
        const queue: { raw_name: string; sample_ref: string | null; source: string; first_batch_id: string }[] = [];
        for (const s of staged) {
          const unmappedRegime = s.flags.some((f) => f.field === "asb_regime");
          const unlinked = commodityIndex != null && s.payload["commodity_id"] == null;
          if (!unmappedRegime && !unlinked) continue;
          const name = s.payload["commodity_name"];
          if (typeof name !== "string" || !name.trim() || seen.has(name)) continue;
          seen.add(name);
          queue.push({ raw_name: name.trim(), sample_ref: s.businessKey, source: source.kind, first_batch_id: batchId });
        }
        if (queue.length) {
          try {
            await supabase
              .from("commodity_review_queue")
              .upsert(queue, { onConflict: "raw_name", ignoreDuplicates: true });
          } catch {
            /* queue is advisory; swallow so the batch still stages */
          }
        }
      }
    }

    // 3c · the data-quality gate (the same rules the audits run): every
    // staged row is checked on this channel; block-level hits make the row
    // invalid so commit_sync_batch never writes it, warn-level hits ride with
    // the row into Review with their DQ code. Never fails the batch by itself.
    let gate: StageResult["gate"];
    try {
      const channel = gateChannelFor(source.kind);
      const { data: g, error: gErr } = await dbRetry(() => supabase.rpc("fn_dq_gate_batch", { p_batch_id: batchId, p_channel: channel, p_actor: label ?? fileName ?? source.kind }));
      if (gErr) {
        errors.push({ sheet: "gate", row: 0, msg: `data-quality gate: ${gErr.message}` });
      } else {
        const res = g as { blocked: number; warned: number; rules: number; errors?: string[] };
        gate = { blocked: res.blocked ?? 0, warned: res.warned ?? 0, rules: res.rules ?? 0 };
        for (const e of res.errors ?? []) errors.push({ sheet: "gate", row: 0, msg: `data-quality gate: ${e}` });
        if (gate.blocked > 0) {
          // rows moved to invalid — recount from the database
          const { data: rc } = await supabase.from("sync_staged_row").select("sheet, classification").eq("batch_id", batchId);
          for (const k of Object.keys(counts)) counts[k] = { ...emptyCounts(), errors: counts[k].errors };
          totals.new = 0; totals.updated = 0; totals.unchanged = 0; totals.invalid = 0;
          for (const row of (rc ?? []) as { sheet: string; classification: "new" | "updated" | "unchanged" | "invalid" }[]) {
            if (!counts[row.sheet]) counts[row.sheet] = emptyCounts();
            counts[row.sheet][row.classification] += 1; totals[row.classification] += 1;
          }
        }
      }
    } catch (e) {
      errors.push({ sheet: "gate", row: 0, msg: `data-quality gate: ${e instanceof Error ? e.message : String(e)}` });
    }

    // 4 · record the summary on the batch, and its state (phase 2, 18 Sep
    //     2026): 'gated' when the data-quality gate ran, 'gate_failed' when it
    //     could not — commit_sync_batch refuses the latter until it is re-run.
    await supabase.from("sync_batch").update({ counts, status: gate ? "gated" : "gate_failed" }).eq("id", batchId);

    return { batchId, label, counts, totals, errors, gate };
  } catch (err) {
    await supabase
      .from("sync_batch")
      .update({ status: "failed", error: err instanceof Error ? err.message : String(err) })
      .eq("id", batchId);
    throw err;
  }
}

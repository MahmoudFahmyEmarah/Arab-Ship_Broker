// Per-source incremental sync checkpoint (sync_source_state).
//
//   upload   last_sync_at only — recorded for visibility.
//   email    last_sync_at + the IMAP checkpoint (uid_validity, last_uid) and
//            the run lease (phase 1, 18 Sep 2026). One run at a time; the
//            checkpoint moves only for the lease holder and only forward.
//
// Every read or write here throws on a Supabase error: a checkpoint that
// silently failed to save means the next run re-reads the same mail.

import type { SupabaseClient } from "@supabase/supabase-js";

export type SyncSourceKind = "email" | "upload";

export async function getWatermark(
  supabase: SupabaseClient,
  source: SyncSourceKind,
): Promise<Date | null> {
  const { data, error } = await supabase
    .from("sync_source_state")
    .select("last_sync_at")
    .eq("source", source)
    .maybeSingle();
  if (error) throw new Error(`sync checkpoint for ${source} could not be read: ${error.message}`);
  const iso = data?.last_sync_at as string | null | undefined;
  return iso ? new Date(iso) : null;
}

export async function setWatermark(
  supabase: SupabaseClient,
  source: SyncSourceKind,
  at: Date,
): Promise<void> {
  const { error } = await supabase
    .from("sync_source_state")
    .upsert(
      { source, last_sync_at: at.toISOString(), updated_at: new Date().toISOString() },
      { onConflict: "source" },
    );
  if (error) throw new Error(`sync checkpoint for ${source} could not be saved: ${error.message}`);
}

// ── email: checkpoint + lease ────────────────────────────────────────────────

export interface EmailCheckpoint {
  lastSyncAt: Date | null;
  uidValidity: number | null;
  lastUid: number | null;
  leaseOwner: string | null;
  leaseUntil: Date | null;
}

export async function getEmailCheckpoint(supabase: SupabaseClient): Promise<EmailCheckpoint> {
  const { data, error } = await supabase
    .from("sync_source_state")
    .select("last_sync_at, uid_validity, last_uid, lease_owner, lease_until")
    .eq("source", "email")
    .maybeSingle();
  if (error) throw new Error(`email checkpoint could not be read: ${error.message}`);
  const r = (data ?? {}) as { last_sync_at?: string | null; uid_validity?: number | string | null; last_uid?: number | string | null; lease_owner?: string | null; lease_until?: string | null };
  const num = (v: number | string | null | undefined) => (v == null ? null : Number(v));
  return {
    lastSyncAt: r.last_sync_at ? new Date(r.last_sync_at) : null,
    uidValidity: num(r.uid_validity),
    lastUid: num(r.last_uid),
    leaseOwner: r.lease_owner ?? null,
    leaseUntil: r.lease_until ? new Date(r.lease_until) : null,
  };
}

export interface LeaseResult { claimed: boolean; leaseOwner: string | null; leaseUntil: Date | null }

/** Take the run lease for a source, or learn who holds it. Throws when the database cannot answer. */
export async function claimSyncRun(supabase: SupabaseClient, source: SyncSourceKind, owner: string, ttlSeconds: number): Promise<LeaseResult> {
  const { data, error } = await supabase.rpc("claim_sync_run", { p_source: source, p_owner: owner, p_ttl_seconds: Math.ceil(ttlSeconds) });
  if (error) throw new Error(`the ${source} run lease could not be taken: ${error.message}`);
  const d = data as { claimed: boolean; lease_owner: string | null; lease_until: string | null };
  return { claimed: !!d?.claimed, leaseOwner: d?.lease_owner ?? null, leaseUntil: d?.lease_until ? new Date(d.lease_until) : null };
}

/** Best effort — an expired or stolen lease is simply not ours to release. */
export async function releaseSyncRun(supabase: SupabaseClient, source: SyncSourceKind, owner: string): Promise<void> {
  try { await supabase.rpc("release_sync_run", { p_source: source, p_owner: owner }); } catch { /* the lease expires on its own */ }
}

/**
 * Move the email checkpoint after a page was staged. Throws when the lease
 * is no longer ours: the rows ARE staged, the checkpoint did NOT move, and
 * the next run will read the same mail again (its rows classify as
 * updated / unchanged, nothing is duplicated silently).
 */
export async function setEmailCheckpoint(
  supabase: SupabaseClient,
  owner: string,
  cp: { uidValidity: number | null; lastUid: number | null; lastSyncAt: Date | null },
): Promise<void> {
  const { data, error } = await supabase.rpc("set_email_checkpoint", {
    p_owner: owner, p_uid_validity: cp.uidValidity, p_last_uid: cp.lastUid, p_last_sync_at: cp.lastSyncAt?.toISOString() ?? null,
  });
  if (error) throw new Error(`email checkpoint could not be saved: ${error.message}`);
  if (data !== true) throw new Error("the run lease expired before the checkpoint could be saved — the staged rows are kept, and the next run re-reads this mail");
}

/**
 * Pure rule for what the checkpoint becomes after one page (unit-tested).
 *  - date mode with more mail waiting: clock = newest message of the page,
 *    UID untouched (the page was chosen by time, not UID order)
 *  - date mode that drained the inbox, or UID mode: clock = run start (or the
 *    page's newest when more waits), UID = highest UID staged
 *  - an explicit start point chosen on the card never moves the UID checkpoint
 */
export function checkpointAfterPage(
  page: { mode: "uid" | "date"; hasMore: boolean; newestAt: Date | null; uidValidity: number | null; lastUid: number | null },
  startedAt: Date,
  explicitStart: boolean,
): { uidValidity: number | null; lastUid: number | null; lastSyncAt: Date } {
  const lastSyncAt = page.hasMore && page.newestAt ? page.newestAt : startedAt;
  const advanceUid = !explicitStart && page.uidValidity != null && page.lastUid != null && (page.mode === "uid" || !page.hasMore);
  return { uidValidity: advanceUid ? page.uidValidity : null, lastUid: advanceUid ? page.lastUid : null, lastSyncAt };
}

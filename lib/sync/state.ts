// Per-source incremental sync checkpoint (sync_source_state).
//
//   upload   last_sync_at only — recorded for visibility.
//   email    last_sync_at + the IMAP checkpoint (uid_validity, last_uid) and
//            the run lease. One run at a time; the checkpoint moves only for
//            the lease holder and only forward.
//
// Lease v2 (20 Sep 2026): claim_sync_run_v2 mints an opaque token per run.
// Any unexpired lease refuses every new claim — the owner label is
// informational, never an identity — and the checkpoint moves / the lease is
// released only with the exact token. A run that lost its lease (expired,
// taken over) can therefore never move another run's checkpoint.
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

// ── email: when the sync last RAN ────────────────────────────────────────────
// The checkpoint (last_sync_at) is the newest mail a run has read, not a run time: while mail is waiting it is the
// newest staged message's date, weeks behind the clock during a backfill. The card showed it as "Last run", so a sync
// made on 15 Nov read "15 Sep" (owner, 15 Nov 2026). When a run happened comes from job_runs.

export interface EmailRunTimes {
  /** the newest email-sync run of any outcome: when it finished (or started, while running), and its status */
  lastRun: { at: string; status: string } | null;
  /** when the newest succeeded email-sync run finished */
  lastSuccessAt: string | null;
}

type RunRow = { status?: string | null; started_at?: string | null; finished_at?: string | null } | null;

/** Pure: the two job_runs rows → the times the card and the tile show. */
export function emailRunTimes(last: RunRow, lastOk: RunRow): EmailRunTimes {
  const at = (r: RunRow) => r?.finished_at ?? r?.started_at ?? null;
  const lastAt = at(last);
  return {
    lastRun: lastAt ? { at: lastAt, status: last?.status ?? "unknown" } : null,
    lastSuccessAt: at(lastOk),
  };
}

export async function getEmailRunTimes(supabase: SupabaseClient): Promise<EmailRunTimes> {
  const runs = () => supabase.from("job_runs").select("status, started_at, finished_at").eq("job", "email-sync");
  const [last, ok] = await Promise.all([
    runs().order("started_at", { ascending: false }).limit(1).maybeSingle(),
    runs().eq("status", "succeeded").order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (last.error) throw new Error(`email sync runs could not be read: ${last.error.message}`);
  if (ok.error) throw new Error(`email sync runs could not be read: ${ok.error.message}`);
  return emailRunTimes(last.data as RunRow, ok.data as RunRow);
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

export interface LeaseResult {
  claimed: boolean;
  /** The opaque token of THIS run's lease; null when the claim was refused. */
  leaseToken: string | null;
  /** Informational label of the holder (ours when claimed, theirs when refused). */
  leaseOwner: string | null;
  leaseUntil: Date | null;
}

/**
 * Take the run lease for a source, or learn who holds it. Any unexpired lease
 * refuses the claim, whatever label it carries. Throws when the database
 * cannot answer.
 */
export async function claimSyncRun(supabase: SupabaseClient, source: SyncSourceKind, ownerLabel: string, ttlSeconds: number): Promise<LeaseResult> {
  const { data, error } = await supabase.rpc("claim_sync_run_v2", { p_source: source, p_owner_label: ownerLabel, p_ttl_seconds: Math.ceil(ttlSeconds) });
  if (error) throw new Error(`the ${source} run lease could not be taken: ${error.message}`);
  const d = data as { claimed: boolean; lease_token: string | null; lease_owner: string | null; lease_until: string | null };
  return {
    claimed: !!d?.claimed,
    leaseToken: d?.claimed ? (d.lease_token ?? null) : null,
    leaseOwner: d?.lease_owner ?? null,
    leaseUntil: d?.lease_until ? new Date(d.lease_until) : null,
  };
}

/** Best effort — only our own token releases; an expired or stolen lease is simply not ours. */
export async function releaseSyncRun(supabase: SupabaseClient, source: SyncSourceKind, leaseToken: string | null): Promise<void> {
  if (!leaseToken) return;
  try { await supabase.rpc("release_sync_run_v2", { p_source: source, p_token: leaseToken }); } catch { /* the lease expires on its own */ }
}

/**
 * Move the email checkpoint after a page was staged, under this run's token.
 * Throws when the lease is no longer ours: the rows ARE staged, the checkpoint
 * did NOT move, and the next run will read the same mail again (its rows
 * classify as updated / unchanged, nothing is duplicated silently).
 */
export async function setEmailCheckpoint(
  supabase: SupabaseClient,
  leaseToken: string,
  cp: { uidValidity: number | null; lastUid: number | null; lastSyncAt: Date | null },
): Promise<void> {
  const { data, error } = await supabase.rpc("set_email_checkpoint_v2", {
    p_token: leaseToken, p_uid_validity: cp.uidValidity, p_last_uid: cp.lastUid, p_last_sync_at: cp.lastSyncAt?.toISOString() ?? null,
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
 *    (and, since 20 Sep 2026, the caller does not save the clock either)
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

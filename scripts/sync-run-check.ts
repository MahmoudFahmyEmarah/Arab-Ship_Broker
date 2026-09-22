/**
 * Data Sync hardening · email run rules (no network, no database). Run:
 *   npx tsx scripts/sync-run-check.ts
 * Through runEmailSync with every collaborator replaced:
 *   P0-1  a refused lease means no fetch at all (two cron runs cannot both fetch);
 *         the checkpoint and the release carry the run's token, never the label
 *   P1-1  a manual backfill (start point on the card) moves no checkpoint;
 *         with no UID checkpoint, the natural run that follows still sees the
 *         older pending mail
 *   P1-2  RunSettler writes one terminal status, once, with or without events
 */
import { runEmailSync, type RunDeps } from "@/lib/sync/email/run";
import { RunSettler } from "@/lib/sync/email/finalize";
import type { SyncEvent } from "@/lib/sync/email/types";
import type { SupabaseClient } from "@supabase/supabase-js";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };

// a Supabase stand-in good enough for runEmailSync's own reads (config + password)
function fakeSupabase(): SupabaseClient {
  const cfg = { imap_host: "imap.test", imap_port: 993, username: "circ@test", folder: "INBOX", search_query: "", is_enabled: true };
  return {
    from: () => ({ select: () => ({ maybeSingle: async () => ({ data: cfg, error: null }) }) }),
    rpc: async (fn: string) => (fn === "get_email_password" ? { data: "pw", error: null } : { data: null, error: null }),
  } as unknown as SupabaseClient;
}

interface Trace { fetches: { since: Date; lastUid: number | null; uidValidity: number | null }[]; checkpoints: { token: string; cp: unknown }[]; releases: (string | null)[]; claims: string[] }
function fakeDeps(t: Trace, opts: { claimed?: boolean; lastSyncAt?: Date | null; lastUid?: number | null; uidValidity?: number | null; messages?: number; hasMore?: boolean } = {}): Partial<RunDeps> {
  const token = "tok-" + Math.random().toString(36).slice(2);
  return {
    claimSyncRun: async (_sb, _src, label) => { t.claims.push(label); return opts.claimed === false ? { claimed: false, leaseToken: null, leaseOwner: "cron", leaseUntil: new Date(Date.now() + 60_000) } : { claimed: true, leaseToken: token, leaseOwner: label, leaseUntil: new Date(Date.now() + 60_000) }; },
    getEmailCheckpoint: async () => ({ lastSyncAt: opts.lastSyncAt ?? null, uidValidity: opts.uidValidity ?? null, lastUid: opts.lastUid ?? null, leaseOwner: null, leaseUntil: null }),
    setEmailCheckpoint: async (_sb, tok, cp) => { t.checkpoints.push({ token: tok, cp }); },
    releaseSyncRun: async (_sb, _src, tok) => { t.releases.push(tok); },
    fetchCirculars: async (_cfg, _pw, o = {}) => {
      t.fetches.push({ since: o.since as Date, lastUid: o.lastUid ?? null, uidValidity: o.uidValidity ?? null });
      const n = opts.messages ?? 0;
      return { messages: Array.from({ length: n }, (_, i) => ({ id: String(100 + i), from: "a@b", subject: `s${i}`, date: null, text: `cargo ${i}` })),
               newestAt: n ? new Date("2026-09-20T09:00:00Z") : null, hasMore: !!opts.hasMore, mode: "date" as const, uidValidity: 1234, lastUid: n ? 100 + n - 1 : null, waiting: n };
    },
    classifyAll: async (_sb, emails) => ({ cargo: emails.map((e) => ({ commodity: e.subject } as never)), vessels: [], failed: 0, firstError: null }),
    stageAndFinish: async () => ({ batchId: "batch-1", totals: { new: 1, updated: 0, unchanged: 0, invalid: 0, errors: 0 }, gate: null } as never),
  };
}
const collect = () => { const events: SyncEvent[] = []; return { events, emit: (e: SyncEvent) => { events.push(e); } }; };

async function main() {
  console.log("P0-1 · a refused lease never fetches");
  {
    const t: Trace = { fetches: [], checkpoints: [], releases: [], claims: [] };
    const { events, emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t, { claimed: false }) });
    ok(t.fetches.length === 0, "no IMAP fetch when the claim is refused");
    ok(events.some((e) => e.type === "skipped"), "the run reports itself as skipped");
    ok(t.releases.every((r) => r === null), "nothing to release (no token was granted)");
  }
  console.log("P0-1 · the token, not the label, moves the checkpoint and releases");
  {
    const t: Trace = { fetches: [], checkpoints: [], releases: [], claims: [] };
    const { emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t, { messages: 2, lastSyncAt: new Date("2026-09-19T00:00:00Z") }) });
    ok(t.fetches.length === 1, "one page fetched");
    ok(t.checkpoints.length === 1 && t.checkpoints[0].token.startsWith("tok-"), "the checkpoint moved with the run's token", JSON.stringify(t.checkpoints));
    ok(t.releases.length === 1 && t.releases[0] === t.checkpoints[0].token, "released with the same token");
  }

  console.log("P1-1 · a manual backfill moves no checkpoint");
  {
    // no UID checkpoint yet; last natural sync was 19 Sep 00:00 (older mail pending)
    const t: Trace = { fetches: [], checkpoints: [], releases: [], claims: [] };
    const { emit } = collect();
    const natural = new Date("2026-09-19T00:00:00Z");
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "admin:x", since: new Date("2026-09-20T08:00:00Z"), deps: fakeDeps(t, { messages: 3, hasMore: true, lastSyncAt: natural, lastUid: null, uidValidity: null }), maxPages: 2 });
    ok(t.fetches.length === 2 && t.fetches[0].since.toISOString() === "2026-09-20T08:00:00.000Z", "the backfill reads from the chosen start point, page by page", JSON.stringify(t.fetches));
    ok(t.fetches.every((f) => f.lastUid === null && f.uidValidity === null), "…by date, never by UID");
    ok(t.checkpoints.length === 0, "NO checkpoint write during a backfill (not the clock, not the UID)", String(t.checkpoints.length));
    // the natural run that follows still starts from its own checkpoint
    const t2: Trace = { fetches: [], checkpoints: [], releases: [], claims: [] };
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t2, { messages: 1, lastSyncAt: natural, lastUid: null, uidValidity: null }) });
    ok(t2.fetches.length === 1 && t2.fetches[0].since.getTime() === natural.getTime(), "the natural run resumes from the original checkpoint and sees the older mail");
    ok(t2.checkpoints.length === 1, "…and the natural run does move the checkpoint");
  }
  console.log("P1-1 · an empty backfill page does not touch the clock either");
  {
    const t: Trace = { fetches: [], checkpoints: [], releases: [], claims: [] };
    const { emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "admin:x", since: new Date("2026-09-20T08:00:00Z"), deps: fakeDeps(t, { messages: 0, lastSyncAt: new Date("2026-09-19T00:00:00Z") }) });
    ok(t.checkpoints.length === 0, "empty backfill page: no checkpoint write");
    const t2: Trace = { fetches: [], checkpoints: [], releases: [], claims: [] };
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t2, { messages: 0, lastSyncAt: new Date("2026-09-19T00:00:00Z") }) });
    ok(t2.checkpoints.length === 1, "empty natural page: the clock moves (nothing waits)");
  }

  console.log("P1-2 · one terminal status");
  {
    const writes: unknown[] = [];
    const sb = { from: () => ({ update: (patch: unknown) => ({ eq: async () => { writes.push(patch); return { error: null }; } }) }) } as unknown as SupabaseClient;
    const s = new RunSettler();
    s.note({ type: "log", msg: "one" });
    s.note({ type: "done", batchId: "b", totals: { new: 2, updated: 1, unchanged: 0, invalid: 0, errors: 0 } });
    s.note({ type: "error", error: "late error" });
    const a = await s.finish(sb, 7);
    const b = await s.finish(sb, 7);
    ok(writes.length === 1, "finish twice → one job_runs write", String(writes.length));
    ok(a.ok && a.rows === 3 && b === a, "the FIRST settling event wins (done, 3 rows)");
    ok((writes[0] as { status: string }).status === "succeeded", "…written as succeeded");
    const s2 = new RunSettler();
    const w2: unknown[] = [];
    const sb2 = { from: () => ({ update: (patch: unknown) => ({ eq: async () => { w2.push(patch); return { error: null }; } }) }) } as unknown as SupabaseClient;
    const c = await s2.finish(sb2, 8);
    ok(!c.ok && /without a result/.test(c.error ?? "") && (w2[0] as { status: string }).status === "failed", "no settling event → one failed write with the reason");
    const s3 = new RunSettler();
    await s3.finish(sb2, null);
    ok(w2.length === 1, "a run without a job row (dry run) writes nothing");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
main();

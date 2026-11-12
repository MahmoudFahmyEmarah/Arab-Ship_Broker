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
import { PAGE_START_FLOOR_MS, pageStartNeedMs, runEmailSync, type RunDeps } from "@/lib/sync/email/run";
import { deadlineOnlyFailure } from "@/lib/sync/email/batch-split";
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

interface Trace { fetches: { since: Date; lastUid: number | null; uidValidity: number | null }[]; checkpoints: { token: string; cp: unknown }[]; releases: (string | null)[]; claims: string[]; stages?: number }
type ClassifyResult = Awaited<ReturnType<RunDeps["classifyAll"]>>;
function fakeDeps(t: Trace, opts: { claimed?: boolean; lastSyncAt?: Date | null; lastUid?: number | null; uidValidity?: number | null; messages?: number; hasMore?: boolean; classify?: (call: number) => Partial<ClassifyResult> } = {}): Partial<RunDeps> {
  const token = "tok-" + Math.random().toString(36).slice(2);
  let classifyCalls = 0;
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
    classifyAll: async (_sb, emails) => ({
      cargo: emails.map((e) => ({ commodity: e.subject } as never)), vessels: [], failed: 0, firstError: null, deadlineOnly: false,
      ...(opts.classify?.(++classifyCalls) ?? {}),
    }),
    stageAndFinish: async () => { t.stages = (t.stages ?? 0) + 1; return { batchId: "batch-1", totals: { new: 1, updated: 0, unchanged: 0, invalid: 0, errors: 0 }, gate: null } as never; },
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

  // 12 Nov 2026 (owner): a page begun with ~40 s left was cut at the run deadline and the whole run reported FAILED,
  // although the pages before it were staged and the checkpoint had moved through them
  console.log("12 Nov · the run's time budget");
  const fresh = (): Trace => ({ fetches: [], checkpoints: [], releases: [], claims: [] });
  const natural = { messages: 2, hasMore: true, lastSyncAt: new Date("2026-09-09T00:00:00Z"), lastUid: 500, uidValidity: 1234 };
  const deadline = { failed: 1, firstError: "SYNC_DEADLINE: the classify call reached the run deadline", deadlineOnly: true, cargo: [] };
  const errors = (ev: SyncEvent[]) => ev.filter((e) => e.type === "error").map((e) => (e as { error: string }).error);
  const logs = (ev: SyncEvent[]) => ev.filter((e) => e.type === "log").map((e) => (e as { msg: string }).msg);
  const resumes = (ev: SyncEvent[]) => ev.filter((e) => e.type === "resume").map((e) => (e as { since: string }).since);
  // a fake wall clock: each classifyAll call "takes" `ms`, so the measured gate can be driven without waiting
  const withClock = async (fn: (advance: (ms: number) => void) => Promise<void>) => {
    const real = Date.now; let offset = 0;
    Date.now = () => real() + offset;
    try { await fn((ms) => { offset += ms; }); } finally { Date.now = real; }
  };
  ok(pageStartNeedMs(0) === 60_000 && pageStartNeedMs(40_000) === 60_000 && pageStartNeedMs(50_000) === 72_500 && pageStartNeedMs(130_000) === 172_500,
    "a page needs the slowest page so far x 1.25 + 10 s, never less than the 60 s floor");
  {
    // less than the floor left after page 1: page 2 is never fetched, so no model call is paid for and lost
    const t = fresh();
    const { events, emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", budgetMs: PAGE_START_FLOOR_MS - 1, maxPages: 6, deps: fakeDeps(t, natural) });
    ok(t.fetches.length === 1, "a page that cannot get its window is not started", String(t.fetches.length));
    ok(events.some((e) => e.type === "done") && errors(events).length === 0 && resumes(events).length === 0, "…and the run ends as done, not failed (a natural run needs no resume point)");
    ok(logs(events).some((m) => /^time budget used after 1 page\(s\) \(\d+ s left; the slowest page took 0 s, so the next needs about 60 s\) — the rest is picked up by the next run$/.test(m)), "…saying how much time was left", JSON.stringify(logs(events)));
  }
  {
    const t = fresh();
    const { events, emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", budgetMs: PAGE_START_FLOOR_MS + 60_000, maxPages: 2, deps: fakeDeps(t, natural) });
    ok(t.fetches.length === 2 && t.checkpoints.length === 2, "with a page's window left, the next page is read", `${t.fetches.length} fetches`);
    ok(logs(events).some((m) => m === "page limit reached after 2 page(s) — the rest is picked up by the next run") && logs(events).filter((m) => m.endsWith("reading the next page")).length === 1,
      "the last allowed page says the page limit stopped the run, not \"reading the next page\"", JSON.stringify(logs(events)));
  }
  await withClock(async (advance) => {
    // B2O-130 P2-2: page 1 took 130 s, 110 s are left; the fixed 100 s window would have started page 2 and lost it
    const t = fresh();
    const { events, emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", budgetMs: 240_000, maxPages: 6, deps: fakeDeps(t, { ...natural, classify: () => { advance(130_000); return {}; } }) });
    ok(t.fetches.length === 1 && t.stages === 1, "a page as slow as the last one is not started when it cannot finish", `${t.fetches.length} fetches`);
    ok(logs(events).some((m) => /\(110 s left; the slowest page took 130 s, so the next needs about 173 s\)/.test(m)), "…measured from this run's pages", JSON.stringify(logs(events)));
  });
  await withClock(async (advance) => {
    // and fast pages are not stopped early: 50 s pages fit four in 240 s (the fixed 100 s window allowed three)
    const t = fresh();
    const { emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", budgetMs: 240_000, maxPages: 6, deps: fakeDeps(t, { ...natural, classify: () => { advance(50_000); return {}; } }) });
    ok(t.fetches.length === 4 && t.checkpoints.length === 4, "fast pages keep going while the measured window fits", `${t.fetches.length} fetches`);
  });
  {
    // the deadline cuts page 2 after page 1 was staged: the run is done, page 2 is read again next time
    const t = fresh();
    const { events, emit } = collect();
    const settler = new RunSettler();
    await runEmailSync({ supabase: fakeSupabase(), emit: (e) => { settler.note(e); emit(e); }, owner: "cron", deps: fakeDeps(t, { ...natural, classify: (n) => (n === 2 ? deadline : {}) }) });
    ok(t.fetches.length === 2 && t.stages === 1, "page 1 staged, page 2 cut by the deadline is not staged", `stages=${t.stages}`);
    ok(t.checkpoints.length === 1, "the checkpoint moved through page 1 only (page 2 is read again)", String(t.checkpoints.length));
    ok(errors(events).length === 0 && events.some((e) => e.type === "done" && e.batchId === "batch-1"), "the run ends as done with page 1's batch, not FAILED", JSON.stringify(errors(events)));
    ok(settler.outcome?.ok === true && settler.outcome.rows === 1, "the job is recorded as succeeded (scheduled runs too)");
    ok(logs(events).some((m) => m === "time budget used during page 2 (its 2 email(s) were not staged) — the rest is picked up by the next run"), "…and the log says the rest is read next time", JSON.stringify(logs(events)));
    ok(resumes(events).length === 0, "…with no resume point (the checkpoint carries a natural run)");
  }
  {
    // a cut after a finished page that held no records: nothing to review, still not a failure
    const t = fresh();
    const { events, emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t, { ...natural, classify: (n) => (n === 2 ? deadline : { cargo: [] }) }) });
    ok(errors(events).length === 0 && events.some((e) => e.type === "empty") && t.stages === undefined && t.checkpoints.length === 1,
      "a cut after a page with no records ends as empty, checkpoint after page 1", JSON.stringify(events.filter((e) => e.type !== "log" && e.type !== "step")));
  }
  {
    // B2O-130 P2-1: a backfill persists nothing, so every early stop hands the card where the backfill stopped
    const chosen = new Date("2026-09-01T00:00:00Z");
    const cases: [string, Partial<Parameters<typeof runEmailSync>[0]>, ((n: number) => Partial<ClassifyResult>) | undefined][] = [
      ["a deadline cut", {}, (n) => (n === 2 ? deadline : {})],
      ["the time gate", { budgetMs: PAGE_START_FLOOR_MS - 1 }, undefined],
      ["the page limit", { maxPages: 1 }, undefined],
    ];
    for (const [label, extra, classify] of cases) {
      const t = fresh();
      const { events, emit } = collect();
      await runEmailSync({ supabase: fakeSupabase(), emit, owner: "admin:x", since: chosen, ...extra, deps: fakeDeps(t, { ...natural, classify }) });
      ok(t.checkpoints.length === 0 && errors(events).length === 0, `backfill stopped by ${label}: no checkpoint write, not a failure`);
      ok(resumes(events).length === 1 && resumes(events)[0] === "2026-09-20T09:00:00.000Z", `…the card is handed the point after the last staged page`, JSON.stringify(resumes(events)));
      ok(logs(events).some((m) => / — this backfill stopped at 2026-09-20 09:00 UTC; the card keeps that as the start point, press Sync now to continue$/.test(m)), "…and the log says so, never \"the next run\"", JSON.stringify(logs(events)));
    }
  }
  {
    // the deadline on the FIRST page is still a failure: nothing moved, and a rerun may stop in the same place
    const t = fresh();
    const { events, emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t, { ...natural, classify: () => deadline }) });
    ok(t.checkpoints.length === 0 && t.stages === undefined, "a first page cut by the deadline stages nothing and moves nothing");
    ok(errors(events).length === 1 && /the first page of mail did not finish within this run's time budget — run it again; if it stops on the same page again, report it/.test(errors(events)[0]), "…and fails with advice that does not promise a rerun fixes it", JSON.stringify(errors(events)));
  }
  {
    // any failure other than the run's own deadline stays a failure, even after a staged page
    for (const [label, r] of [
      ["a provider timeout", { failed: 1, firstError: "SYNC_PROVIDER_TIMEOUT: classify timed out after 90s; this run admitted no successor calls", deadlineOnly: false }],
      ["a deadline mixed with another failure", { failed: 2, firstError: "SYNC_DEADLINE: the classify call reached the run deadline", deadlineOnly: false }],
      ["a model error", { failed: 1, firstError: "UNREADABLE_EMAIL: the model's reply for the email \"x\" could not be read", deadlineOnly: false }],
    ] as const) {
      const t = fresh();
      const { events, emit } = collect();
      await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t, { ...natural, classify: (n) => (n === 2 ? { ...r, cargo: [] } : {}) }) });
      ok(errors(events).length === 1 && !events.some((e) => e.type === "done") && t.checkpoints.length === 1, `${label} on page 2 still fails the run (checkpoint after page 1)`, JSON.stringify(errors(events)));
    }
  }
  {
    const { readFileSync } = await import("node:fs");
    const run = readFileSync("lib/sync/email/run.ts", "utf8").replace(/\r\n/g, "\n");
    ok(/failures\.push\(e\);/.test(run) && /deadlineOnly: deadlineOnlyFailure\(failures\) \};/.test(run),
      "classifyAll judges deadline-only on every failed batch's reason");
    ok(deadlineOnlyFailure([new Error("SYNC_DEADLINE: the classify call reached the run deadline"), new Error("SYNC_DEADLINE: less than 3s remains; no new classify call was started")]),
      "deadline-only: every failure is the run deadline");
    ok(!deadlineOnlyFailure([]) && !deadlineOnlyFailure([new Error("SYNC_DEADLINE: x"), new Error("SYNC_PROVIDER_TIMEOUT: classify timed out after 90s")])
      && !deadlineOnlyFailure([new Error("SYNC_DEADLINE: x"), "SYNC_DEADLINE: a string, not an Error"]) && !deadlineOnlyFailure([new Error("fetch failed")]),
      "…not with no failures, a provider timeout, a non-Error reason or a real error among them");
    const card = readFileSync("components/admin/data-sync/EmailSyncCard.tsx", "utf8").replace(/\r\n/g, "\n");
    ok(/else if \(evt\.type === "resume"\) resumeFrom = evt\.since;/.test(card) && /await loadWatermark\(\);\n\s*if \(resumeFrom\) setSince\(toLocalInput\(resumeFrom\)\);/.test(card),
      "the card keeps a stopped backfill's point as its start point, after the watermark reload (local time, like every start point)");
  }

  // B2C-198: a provider timeout gets its own advice, and the abort signal reaches the model call explicitly
  {
    const { readFileSync } = await import("node:fs");
    const run = readFileSync("lib/sync/email/run.ts", "utf8").replace(/\r\n/g, "\n");
    ok(/const providerTimeout = \/SYNC_PROVIDER_TIMEOUT\/\.test\(firstError/.test(run) && /: providerTimeout\n\s*\? "the AI provider did not answer in time \(not the key or budget\)/.test(run),
      "a provider timeout is advised as a rerun, never as 'fix the key or budget'");
    const clf = readFileSync("lib/sync/email/classifier.ts", "utf8");
    const graph = readFileSync("lib/sync/email/graph.ts", "utf8");
    ok(/\{ callbacks: this\.callbacks, signal \}/.test(clf) && /clf\.classifyBatch\(s\.emails, config\?\.signal\)/.test(graph),
      "the abort signal is passed to the model call explicitly");
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  finished = true;
  if (fail) process.exit(1);
}
// A run whose promise never settles lets Node exit 0 with the rest unrun (seen 12 Nov 2026): that is a failure.
let finished = false;
process.on("beforeExit", () => { if (!finished) { console.error(`stalled after ${pass + fail} check(s) — a promise never settled`); process.exit(1); } });
main().catch((e) => { console.error(e); process.exit(1); });

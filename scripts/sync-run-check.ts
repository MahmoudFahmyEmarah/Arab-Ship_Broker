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
import { CEILING_MESSAGE, CLIENT_CEILING_MS, boxFor, pointAfterRun, runErrorText, startPointChanged, startPointToSend, toLocalInput } from "@/lib/sync/email/start-point";
import { RunSettler } from "@/lib/sync/email/finalize";
import { emailRunTimes, getEmailRunTimes } from "@/lib/sync/state";
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
               // each page is an hour later (page 1 09:00, page 2 10:00 …), so a stop point taken from the wrong page shows
               newestAt: n ? new Date(Date.UTC(2026, 8, 20, 8 + t.fetches.length)) : null, hasMore: !!opts.hasMore, mode: "date" as const, uidValidity: 1234, lastUid: n ? 100 + n - 1 : null, waiting: n };
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
  // a fake wall clock, frozen except for what each classifyAll call "takes", so the gate's arithmetic is exact
  const withClock = async (fn: (advance: (ms: number) => void) => Promise<void>) => {
    const real = Date.now; const base = real(); let offset = 0;
    Date.now = () => base + offset;
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
    // [label, run options, classify stub, the point after the last staged page (page 1 = 09:00, page 2 = 10:00)]
    const cases: [string, Partial<Parameters<typeof runEmailSync>[0]>, ((n: number) => Partial<ClassifyResult>) | undefined, string][] = [
      ["a deadline cut on page 2", {}, (n) => (n === 2 ? deadline : {}), "2026-09-20T09:00:00.000Z"],
      ["a deadline cut on page 3", {}, (n) => (n === 3 ? deadline : {}), "2026-09-20T10:00:00.000Z"],
      ["the time gate", { budgetMs: PAGE_START_FLOOR_MS - 1 }, undefined, "2026-09-20T09:00:00.000Z"],
      ["the page limit after 1 page", { maxPages: 1 }, undefined, "2026-09-20T09:00:00.000Z"],
      ["the page limit after 2 pages", { maxPages: 2 }, undefined, "2026-09-20T10:00:00.000Z"],
    ];
    for (const [label, extra, classify, point] of cases) {
      const t = fresh();
      const { events, emit } = collect();
      await runEmailSync({ supabase: fakeSupabase(), emit, owner: "admin:x", since: chosen, ...extra, deps: fakeDeps(t, { ...natural, classify }) });
      ok(t.checkpoints.length === 0 && errors(events).length === 0, `backfill stopped by ${label}: no checkpoint write, not a failure`);
      ok(resumes(events).length === 1 && resumes(events)[0] === point, `…the card is handed ${point.slice(11, 16)}, the point after the last staged page`, JSON.stringify(resumes(events)));
      ok(logs(events).some((m) => m.endsWith(` — this backfill stopped at ${point.slice(0, 16).replace("T", " ")} UTC; the card keeps that as the start point, press Sync now to continue`)), "…and the log says so, never \"the next run\"", JSON.stringify(logs(events)));
    }
  }
  {
    // B2O-131 P2-2: a backfill that stops on an ERROR keeps its point too (the card would fall back to the checkpoint)
    const chosen = new Date("2026-09-01T00:00:00Z");
    const failing = (n: number): Partial<ClassifyResult> => (n === 2 ? { failed: 1, firstError: "UNREADABLE_EMAIL: x", deadlineOnly: false, cargo: [] } : {});
    for (const [label, deps] of [
      ["a failed batch", (t: Trace) => fakeDeps(t, { ...natural, classify: failing })],
      ["a classification that throws", (t: Trace) => { const base = fakeDeps(t, natural); let n = 0; return { ...base, classifyAll: async (...a: Parameters<RunDeps["classifyAll"]>) => { if (++n === 2) throw new Error("AI budget exhausted"); return base.classifyAll!(...a); } }; }],
      ["an IMAP failure", (t: Trace) => { const base = fakeDeps(t, natural); let n = 0; return { ...base, fetchCirculars: async (...a: Parameters<RunDeps["fetchCirculars"]>) => { if (++n === 2) throw new Error("socket hang up"); return base.fetchCirculars!(...a); } }; }],
    ] as const) {
      const t = fresh();
      const { events, emit } = collect();
      await runEmailSync({ supabase: fakeSupabase(), emit, owner: "admin:x", since: chosen, deps: deps(t) });
      const at = events.findIndex((e) => e.type === "resume"), err = events.findIndex((e) => e.type === "error");
      ok(errors(events).length === 1 && resumes(events).length === 1 && resumes(events)[0] === "2026-09-20T09:00:00.000Z" && at < err,
        `backfill stopped by ${label}: the card is handed the point after page 1, before the error`, JSON.stringify(events.filter((e) => e.type === "resume" || e.type === "error")));
    }
    {
      const t = fresh();
      const { events, emit } = collect();
      await runEmailSync({ supabase: fakeSupabase(), emit, owner: "admin:x", since: chosen, deps: fakeDeps(t, { ...natural, classify: failing }) });
      ok(/This backfill stopped at 2026-09-20 09:00 UTC; the card keeps that as the start point — /.test(errors(events)[0] ?? ""), "…and a backfill's error names its stop point, not \"the sync checkpoint\"", JSON.stringify(errors(events)));
    }
    {
      // a staging failure is thrown to the route; the point is handed over first
      const t = fresh();
      const { events, emit } = collect();
      const base = fakeDeps(t, natural); let n = 0;
      const threw = await runEmailSync({ supabase: fakeSupabase(), emit, owner: "admin:x", since: chosen, deps: { ...base, stageAndFinish: async (...a: Parameters<RunDeps["stageAndFinish"]>) => { if (++n === 2) throw new Error("vessel review queue: invalid input"); return base.stageAndFinish!(...a); } } }).then(() => false, () => true);
      ok(threw && resumes(events).length === 1 && resumes(events)[0] === "2026-09-20T09:00:00.000Z", "a backfill whose staging throws still hands the card the point after page 1", JSON.stringify(resumes(events)));
    }
    {
      // natural runs never hand out a point, on any exit
      const t = fresh();
      const { events, emit } = collect();
      await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t, { ...natural, classify: failing }) });
      ok(resumes(events).length === 0 && /The sync checkpoint stays at 2026-09-20 09:00 UTC — /.test(errors(events)[0] ?? ""), "a natural run's error keeps its wording and hands out no point");
    }
  }
  {
    // B2O-132 P2-1: a backfill that ends before its first page hands back the point it was sent ("try again after it
    // finishes" must continue the backfill, not fall back to the checkpoint)
    const chosen = new Date("2026-09-01T00:00:00Z");
    const noInbox = { from: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }), rpc: async () => ({ data: null, error: null }) } as unknown as SupabaseClient;
    const cases: [string, SupabaseClient, (t: Trace) => Partial<RunDeps>, "skipped" | "error"][] = [
      ["a refused lease (another run holds the inbox)", fakeSupabase(), (t) => fakeDeps(t, { ...natural, claimed: false }), "skipped"],
      ["a lease claim that throws", fakeSupabase(), (t) => ({ ...fakeDeps(t, natural), claimSyncRun: async () => { throw new Error("lease unavailable"); } }), "error"],
      ["an unreadable checkpoint", fakeSupabase(), (t) => ({ ...fakeDeps(t, natural), getEmailCheckpoint: async () => { throw new Error("checkpoint unreadable"); } }), "error"],
      ["no inbox configured", noInbox, (t) => fakeDeps(t, natural), "error"],
    ];
    for (const [label, sb, deps, terminal] of cases) {
      const t = fresh();
      const { events, emit } = collect();
      await runEmailSync({ supabase: sb, emit, owner: "admin:x", since: chosen, deps: deps(t) });
      const at = events.findIndex((e) => e.type === "resume"), end = events.findIndex((e) => e.type === terminal);
      ok(t.fetches.length === 0 && resumes(events).length === 1 && resumes(events)[0] === chosen.toISOString() && at >= 0 && at < end,
        `backfill ended by ${label}: the card is handed back the point it sent, before the ${terminal}`, JSON.stringify(events.filter((e) => e.type !== "log" && e.type !== "step")));
    }
    const t = fresh();
    const { events, emit } = collect();
    await runEmailSync({ supabase: fakeSupabase(), emit, owner: "cron", deps: fakeDeps(t, { ...natural, claimed: false }) });
    ok(events.some((e) => e.type === "skipped") && resumes(events).length === 0, "a natural run refused the lease hands out no point");
  }
  {
    // what the card does with its held point when a stream ends with no point handed back
    ok(pointAfterRun({ settled: true, sentSince: undefined }) === "clear" && pointAfterRun({ settled: true, sentSince: "2026-09-01T00:00:00.000Z" }) === "clear",
      "a settled run that handed none back leaves nothing to continue (natural, or a backfill read through)");
    const cut = pointAfterRun({ settled: false, sentSince: "2026-09-01T00:00:00.000Z" });
    ok(typeof cut === "object" && cut.hold === "2026-09-01T00:00:00.000Z", "a backfill cut off without a result holds the point it was sent, so a retry re-reads from there");
    ok(pointAfterRun({ settled: false, sentSince: undefined }) === "keep", "a natural run cut off without a result changes nothing");
    // B2O-133 P2: what the box shows when it is (re)filled — the held point, else the checkpoint (a cleared point too)
    const cp = "2026-09-11T12:59:41.123Z", held = "2026-09-20T09:00:37.250Z";
    ok(boxFor(held, cp) === toLocalInput(held) && boxFor(held, null) === toLocalInput(held), "a held point fills the box");
    ok(boxFor(null, cp) === toLocalInput(cp) && boxFor(null, null) === "", "a cleared point returns the box to the checkpoint (empty before it loads)");
    ok(startPointToSend(boxFor(null, cp), cp, null) === undefined, "…so the next click after a clear is a natural run, never the old point's minute");
  }
  {
    // B2O-131 P1-1 / P2-1: what a "Sync now" click sends, judged in the box's own form, in several zones
    // the zone in force before the loop, restored by name afterwards (deleting TZ does not restore it on Windows)
    const realTz = process.env.TZ;
    const startZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const jan = new Date("2026-01-15T12:00:00Z");
    const startOffset = jan.getTimezoneOffset();
    const janOffset: Record<string, number> = { UTC: 0, "Africa/Cairo": -120, "America/New_York": 300, "Asia/Kolkata": -330 };
    for (const tz of ["UTC", "Africa/Cairo", "America/New_York", "Asia/Kolkata"]) {
      process.env.TZ = tz;
      ok(jan.getTimezoneOffset() === janOffset[tz], `${tz}: the zone switch took effect (offset ${janOffset[tz]} min in January)`, String(jan.getTimezoneOffset()));
      const wm = "2026-09-11T12:59:41.123Z";                       // a checkpoint is page.newestAt or startedAt: seconds
      const box = toLocalInput(wm);
      ok(startPointToSend(box, wm, null) === undefined && !startPointChanged(box, wm), `${tz}: an untouched box is a natural run, never a backfill from the minute's floor`);
      ok(startPointToSend(toLocalInput("2026-09-11T12:59:00.000Z"), "2026-09-11T12:59:00.000Z", null) === undefined, `${tz}: …also when the checkpoint is on an exact minute`);
      const chosen = toLocalInput("2026-09-01T06:30:00.000Z");
      ok(startPointToSend(chosen, wm, null) === "2026-09-01T06:30:00.000Z" && startPointChanged(chosen, wm), `${tz}: a point the owner chose is sent as that instant`);
      const resume = "2026-09-20T09:00:37.250Z";
      ok(startPointToSend(toLocalInput(resume), wm, resume) === resume, `${tz}: the box still showing a stopped backfill's point sends it exactly (seconds kept)`);
      ok(startPointToSend(chosen, wm, resume) === "2026-09-01T06:30:00.000Z" && startPointToSend(box, wm, resume) === undefined, `${tz}: …but an edited box, or the checkpoint, wins over a held point`);
      ok(startPointToSend("", wm, resume) === undefined && startPointToSend("", null, null) === undefined && toLocalInput(null) === "" && toLocalInput("not a date") === "", `${tz}: an empty box is a natural run`);
    }
    process.env.TZ = "America/New_York";
    // 1 Nov 2026 01:30 happens twice in New York; the exact point is sent, never re-parsed from the ambiguous wall time
    const second = "2026-11-01T06:30:12.000Z";                     // 01:30:12 EST, the second 01:30
    ok(toLocalInput(second) === "2026-11-01T01:30" && startPointToSend(toLocalInput(second), null, second) === second, "a stop point in a repeated DST hour is sent exactly");
    process.env.TZ = realTz ?? startZone;
    ok(jan.getTimezoneOffset() === startOffset, `the zone in force before the loop (${startZone}) is back afterwards`, String(jan.getTimezoneOffset()));
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
    const page = readFileSync("components/admin/data-sync/DataSyncClient.tsx", "utf8").replace(/\r\n/g, "\n");
    ok(/const sinceChanged = resumeFrom != null \|\| startPointChanged\(since, watermark\);/.test(card) && /run\(\{ limit: 25, since: startPointToSend\(since, watermark, resume\.current\) \}\)/.test(card)
      && !/const toLocalInput =/.test(card) && !/sinceIso/.test(card),
      "the card decides what to send only through the tested start-point helpers (no ISO-vs-minute comparison left)");
    ok(/else if \(evt\.type === "resume"\) \{ resumed = true; holdResume\(evt\.since\); setSince\(toLocalInput\(evt\.since\)\); \}/.test(card)
      && /setSince\(boxFor\(resume\.current, r\.data\.email\)\)/.test(card)
      && /const next = pointAfterRun\(\{ settled, sentSince: typeof body\.since === "string" \? body\.since : undefined \}\);\n(\s*\/\/[^\n]*\n)*\s*if \(next === "clear"\) \{ holdResume\(null\); setSince\(boxFor\(null, watermark\)\); \}\n\s*else if \(next !== "keep"\) holdResume\(next\.hold\);/.test(card)
      && /if \(evt\.type === "done" \|\| evt\.type === "empty" \|\| evt\.type === "skipped" \|\| evt\.type === "error"\) settled = true;/.test(card)
      && /onClick=\{\(\) => \{ holdResume\(null\); setSince\(toLocalInput\(watermark\)\); \}\}/.test(card),
      "the card shows a handed-back point, prefers it on every reload, and settles it through pointAfterRun; a clear refills the box (Reset drops it)");
    // B2O-133 P3: the point is settled on every exit, a clean stream end and a throw alike
    const settleCalls = card.match(/\n\s*settlePoint\(\);/g) ?? [];
    ok(settleCalls.length === 2 && /settlePoint\(\);\n\s*await loadWatermark\(\);\n\s*\} catch \(e\) \{\n\s*settlePoint\(\);/.test(card)
      && /let resumed = false;[^\n]*\n\s*let settled = false;[^\n]*\n[\s\S]*const settlePoint = \(\) => \{[\s\S]*try \{\n\s*const res = await fetch/.test(card),
      "the held point is settled on a clean end and in the catch (a cut that surfaces as a throw), with the flags outside the try");
    // B2O-133 P2 + P3: a mounted card follows the page's point to a new value AND to "cleared"; the ref before any reload
    ok(/if \(resumeFrom !== shownResume\) \{\n\s*setShownResume\(resumeFrom\);\n\s*setSince\(boxFor\(resumeFrom, watermark\)\);\n\s*\}/.test(card)
      && /useLayoutEffect\(\(\) => \{ resume\.current = resumeFrom; \}, \[resumeFrom\]\);/.test(card) && !/useEffect\(\(\) => \{ resume\.current/.test(card),
      "a mounted card follows the page's point, cleared included (box during render, ref in a layout effect)");
    ok(/const ceiling = new AbortController\(\);/.test(card) && /signal: ceiling\.signal/.test(card) && /clearTimeout\(timer\);\n\s*onRunning\(false\);/.test(card)
      && /ceiling\.abort\(new Error\(CEILING_MESSAGE\)\), CLIENT_CEILING_MS\)/.test(card) && /const msg = runErrorText\(e, ceiling\.signal\.aborted\);/.test(card) && !/const CLIENT_CEILING_MS/.test(card),
      "a stalled request is given up a little after the route's 300 s (a slow checkpoint reload afterwards is not bounded), and the cut says so");
    // B2O-134 P2: mid-stream, Chromium rejects the read with its own DOMException, not the abort reason
    const chromiumCut = new DOMException("BodyStreamBuffer was aborted", "AbortError");
    ok(CLIENT_CEILING_MS === 330_000 && runErrorText(chromiumCut, true) === CEILING_MESSAGE && runErrorText(new Error(CEILING_MESSAGE), true) === CEILING_MESSAGE,
      "a cut by the card's own ceiling shows the ceiling's message, whatever the browser rejected with");
    ok(runErrorText(new Error("Request failed (403)."), false) === "Request failed (403)." && runErrorText("boom", false) === "Email sync failed." && runErrorText(new Error(""), false) === "Email sync failed.",
      "any other failure shows its own message (or a plain fallback)");
    const route = readFileSync("app/api/sync/email/route.ts", "utf8").replace(/\r\n/g, "\n");
    ok(/if \(e\.type === "resume"\) pointHandedBack = true;/.test(route) && /if \(!sample && since && !pointHandedBack && !settler\.outcome\) emit\(\{ type: "resume", since: since\.toISOString\(\) \}\);\n\s*emit\(\{ type: "error"/.test(route),
      "an unexpected throw that reaches the route hands a backfill its sent point, unless the run handed one back or had already settled");
    ok(!/useState\(false\)/.test(card.slice(card.indexOf("export function EmailSyncCard"), card.indexOf("const [log, setLog]"))) && /onRunning\(true\);/.test(card) && /onRunning\(false\);/.test(card),
      "the card's busy state is the page's, so a card shown again mid-run stays busy");
    ok(/export function DataSyncClient[\s\S]*const \[emailResume, setEmailResume\] = useState<string \| null>\(null\);[\s\S]*const \[emailRunning, setEmailRunning\] = useState\(false\);[\s\S]*function IntakeView/.test(page)
      && /emailResume=\{emailResume\} onEmailResume=\{setEmailResume\}/.test(page) && /emailRunning=\{emailRunning\} onEmailRunning=\{setEmailRunning\}/.test(page)
      && /resumeFrom=\{emailResume\} onResume=\{onEmailResume\} running=\{emailRunning\} onRunning=\{onEmailRunning\}/.test(page),
      "the point and the busy state are held by the page, which outlives the card when a run opens its batch in Review");
  }

  // 15 Nov 2026 (owner): "the last sync date is 15/9/2026 and the sync date is 15/11/2026 … not consistent". The card's
  // "Last run" showed the checkpoint (the newest mail read), and batch names carried an unlabelled UTC time
  console.log("15 Nov · the inbox's dates say what they are");
  {
    const failed = { status: "failed", started_at: "2026-11-15T06:10:00Z", finished_at: "2026-11-15T06:14:30Z" };
    const okRow = { status: "succeeded", started_at: "2026-11-15T05:50:00Z", finished_at: "2026-11-15T05:54:10Z" };
    const r1 = emailRunTimes(failed, okRow);
    ok(r1.lastRun?.at === "2026-11-15T06:14:30Z" && r1.lastRun.status === "failed" && r1.lastSuccessAt === "2026-11-15T05:54:10Z", "the last run is the newest run of any outcome (when it finished), the last success is separate");
    const r2 = emailRunTimes({ status: "running", started_at: "2026-11-15T07:00:00Z", finished_at: null }, null);
    ok(r2.lastRun?.at === "2026-11-15T07:00:00Z" && r2.lastRun.status === "running" && r2.lastSuccessAt === null, "a run still going shows when it started; no success yet is null");
    ok(emailRunTimes(null, null).lastRun === null, "no runs at all → no last run");
    // through a stand-in job_runs table: other jobs never count, and the two reads pick the right rows
    const rows = [
      { job: "email-sync", status: "succeeded", started_at: "2026-11-15T05:50:00Z", finished_at: "2026-11-15T05:54:10Z" },
      { job: "email-sync", status: "failed", started_at: "2026-11-15T06:10:00Z", finished_at: "2026-11-15T06:14:30Z" },
      { job: "email-sync", status: "succeeded", started_at: "2026-11-14T09:00:00Z", finished_at: "2026-11-14T09:03:00Z" },
      { job: "whatsapp-sweep", status: "succeeded", started_at: "2026-11-15T08:00:00Z", finished_at: "2026-11-15T08:00:20Z" },
    ];
    const table = (data: typeof rows, error: { message: string } | null = null) => ({
      from: (name: string) => {
        if (name !== "job_runs") throw new Error(`unexpected table ${name}`);
        let q = [...data];
        const b = {
          select: () => b,
          eq: (k: string, v: unknown) => { q = q.filter((r) => (r as Record<string, unknown>)[k] === v); return b; },
          order: (k: string, o: { ascending: boolean }) => { q.sort((x, y) => { const a = String((x as Record<string, unknown>)[k]), c = String((y as Record<string, unknown>)[k]); return (a < c ? -1 : a > c ? 1 : 0) * (o.ascending ? 1 : -1); }); return b; },
          limit: (n: number) => { q = q.slice(0, n); return b; },
          maybeSingle: async () => ({ data: error ? null : q[0] ?? null, error }),
        };
        return b;
      },
    }) as unknown as SupabaseClient;
    const got = await getEmailRunTimes(table(rows));
    ok(got.lastRun?.at === "2026-11-15T06:14:30Z" && got.lastRun.status === "failed" && got.lastSuccessAt === "2026-11-15T05:54:10Z",
      "read from job_runs: the newest email-sync run and the newest succeeded one (a later WhatsApp sweep never counts)", JSON.stringify(got));
    const broken = await getEmailRunTimes(table(rows, { message: "permission denied" })).then(() => "", (e: Error) => e.message);
    ok(/email sync runs could not be read: permission denied/.test(broken), "a failed read says so instead of showing no run");
    const { readFileSync } = await import("node:fs");
    const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
    const card = src("components/admin/data-sync/EmailSyncCard.tsx"), shell = src("components/admin/data-sync/ChannelCard.tsx"), page = src("components/admin/data-sync/DataSyncClient.tsx");
    ok(/last=\{lastRun \? `\$\{relTime\(lastRun\.at\)\}/.test(card) && /moreFacts=\{\[\{ label: "Mail read up to", value: watermark \?/.test(card) && !/last=\{watermark/.test(card)
      && /setLastRun\(r\.data\.emailRuns\.lastRun\)/.test(card) && /moreFacts\?\.map\(\(f\) =>/.test(shell),
      "the card's Last run is a run time (job_runs); the checkpoint is shown as \"Mail read up to\"");
    ok(/Last successful run \$\{relTime\(h\.inbox\.lastSuccessAt\)\}/.test(page) && /mail read up to \$\{new Date\(h\.inbox\.mailReadUpTo\)/.test(page) && !/inbox\??\.lastSuccess\b/.test(page),
      "the Intake tile's last successful run is a run time too, with how far the mail has been read beside it");
    ok(/Mail read up to:\{" "\}/.test(src("components/admin/data-sync/SettingsView.tsx")) && !/Last sync:\{" "\}/.test(src("components/admin/data-sync/SettingsView.tsx")),
      "Settings names the checkpoint for what it is");
    ok(/const label = `Email sync · \$\{new Date\(\)\.toISOString\(\)\.slice\(0, 16\)\.replace\("T", " "\)\} UTC`;/.test(src("lib/sync/email/run.ts"))
      && /\$\{new Date\(m\.received_at\)\.toISOString\(\)\.slice\(0, 16\)\.replace\("T", " "\)\} UTC`;/.test(src("lib/sync/whatsapp/process.ts")),
      "email and WhatsApp batch names say their time is UTC (the table's Created column is local)");
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

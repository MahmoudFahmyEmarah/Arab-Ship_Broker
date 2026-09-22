/**
 * Data Sync hardening · background upload jobs, without a network or a
 * database (workstreams A, B, C and D; 21 Sep 2026). Run:
 *   npx tsx scripts/sync-upload-jobs-check.ts
 *
 * The SQL side is proved by upload_lease_idempotency_smoke.sql. What has to
 * be proved HERE is the worker's own behaviour, which no SQL test can reach:
 *
 *   · it checks BOTH the Supabase `{ error }` and the boolean the
 *     finalisation function returns, and treats either as lost ownership
 *   · it never writes a success audit, and never counts a job as done, when
 *     the finalisation was refused
 *   · it stages into the batch the CLAIM reserved, never a fresh one
 *   · it classifies failures so that a broken workbook parks and a dropped
 *     connection retries
 *   · the storage path it will download is one this server minted for that
 *     job and that administrator, and the bytes are checked against their
 *     declared size and digest before SheetJS sees them
 */
import {
  classifyStagingFailure, finishJob, loadJobWorkbook, processUploadJobs, jobBytes,
  type UploadJobRow,
} from "@/lib/sync/upload-jobs";
import { mintUploadObjectPath, pathMatchesJob, payloadProblem, sha256Hex, adminPrefix, SYNC_UPLOAD_BUCKET } from "@/lib/sync/upload-target";
import type { SupabaseClient } from "@supabase/supabase-js";

let pass = 0, fail = 0;
const ok = (c: boolean, label: string, extra = "") => { if (c) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.error(` FAIL  ${label}${extra ? ` — ${extra}` : ""}`); } };

const ADMIN = "11111111-2222-4333-8444-555555555555";
const JOB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const job = (over: Partial<UploadJobRow> = {}): UploadJobRow => ({
  id: JOB, file_name: "cargomap.xlsx", bytes: null, size: 4, payload_bytes: 4, rows_parsed: null,
  started_by: ADMIN, status: "running", attempts: 1, max_attempts: 3,
  lease_token: "tok-1", lease_until: new Date(Date.now() + 60_000).toISOString(),
  next_attempt_at: new Date().toISOString(), batch_id: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
  failure_kind: null, error: null, totals: null,
  storage_bucket: null, storage_path: null, checksum_sha256: null,
  payload_expires_at: null, payload_deleted_at: null,
  created_at: new Date().toISOString(), started_at: null, finished_at: null, ...over,
});

// ── a fake Supabase client: records every call, answers from a script ──────
interface FakeOpts {
  claims?: UploadJobRow[][];
  finish?: (args: Record<string, unknown>) => { data?: unknown; error?: { message: string } | null };
  download?: Buffer | { error: string };
}
function fake(opts: FakeOpts) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const inserts: { table: string; row: Record<string, unknown> }[] = [];
  let claimN = 0;
  const table = (name: string) => {
    const q: Record<string, unknown> = {};
    Object.assign(q, {
      select: () => q, eq: () => q, order: () => q, limit: () => q, is: () => q, in: () => q, not: () => q, delete: () => q, update: () => q,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      insert: (row: Record<string, unknown>) => { inserts.push({ table: name, row }); return Promise.resolve({ data: null, error: null }); },
      then: (res: (v: unknown) => void) => res({ data: [], error: null }),
    });
    return q;
  };
  const sb = {
    from: table,
    storage: {
      from: () => ({
        download: async () => (opts.download instanceof Buffer
          ? { data: { arrayBuffer: async () => opts.download as Buffer }, error: null }
          : { data: null, error: { message: (opts.download as { error: string })?.error ?? "missing" } }),
        remove: async () => ({ data: null, error: null }),
        upload: async () => ({ data: null, error: null }),
      }),
    },
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      calls.push({ name, args });
      if (name === "claim_sync_upload_job") return { data: opts.claims?.[claimN++] ?? [], error: null };
      if (name === "finish_sync_upload_job") { const r = opts.finish?.(args) ?? { data: { ok: true, status: "done" } }; return { data: r.data ?? null, error: r.error ?? null }; }
      if (name === "fn_sync_upload_batch_resumable") return { data: { resumable: true, reason: "clean" }, error: null };
      return { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { sb, calls, inserts };
}

async function main() {
  console.log("storage targets are minted, never accepted from a client");
  {
    const p1 = mintUploadObjectPath({ jobId: JOB, adminId: ADMIN });
    const p2 = mintUploadObjectPath({ jobId: JOB, adminId: ADMIN });
    ok(p1 !== p2, "two paths for the same job differ (unpredictable)", `${p1} vs ${p2}`);
    ok(/^jobs\/\d{4}\/\d{2}\/[0-9a-z]+\/[0-9a-f-]{36}-[0-9a-f]{32}\.xlsx$/.test(p1), "the path has the expected shape", p1);
    ok(p1.includes(JOB), "the path carries its job id");
    ok(p1.includes(adminPrefix(ADMIN)), "the path carries the administrator's prefix");
    ok(pathMatchesJob(p1, { id: JOB, started_by: ADMIN }) === null, "a minted path is accepted for its own job");
    ok(/different job/.test(pathMatchesJob(p1, { id: "99999999-9999-4999-8999-999999999999", started_by: ADMIN }) ?? ""), "…and refused for another job");
    ok(/different administrator/.test(pathMatchesJob(p1, { id: JOB, started_by: "99999999-9999-4999-8999-999999999999" }) ?? ""), "…and refused for another administrator");
    ok(/not one this server issued/.test(pathMatchesJob(`jobs/2026/09/${adminPrefix(ADMIN)}/${JOB}-short.xlsx`, { id: JOB, started_by: ADMIN }) ?? ""), "a hand-written path without real randomness is refused");
    ok(/malformed/.test(pathMatchesJob("../../etc/passwd", { id: JOB, started_by: ADMIN }) ?? ""), "a traversal path is refused");
    ok(/malformed/.test(pathMatchesJob("/absolute/x.xlsx", { id: JOB, started_by: ADMIN }) ?? ""), "an absolute path is refused");
    ok(pathMatchesJob("", { id: JOB, started_by: ADMIN }) !== null, "an empty path is refused");
    let threw = "";
    try { mintUploadObjectPath({ jobId: "not-a-uuid", adminId: ADMIN }); } catch (e) { threw = (e as Error).message; }
    ok(/job id/.test(threw), "minting without a real job id throws");
  }

  console.log("a downloaded workbook is checked before it is parsed");
  {
    const buf = Buffer.from("PKhello");
    ok(payloadProblem(buf, { size: buf.length, checksum: sha256Hex(buf) }) === null, "the right size and digest pass");
    ok(/is empty/.test(payloadProblem(Buffer.alloc(0), {}) ?? ""), "an empty object is refused");
    ok(/declared 99/.test(payloadProblem(buf, { size: 99 }) ?? ""), "a size mismatch is refused");
    ok(/does not match its declared checksum/.test(payloadProblem(buf, { checksum: "a".repeat(64) }) ?? ""), "a digest mismatch is refused");
    ok(/not a SHA-256/.test(payloadProblem(buf, { checksum: "nope" }) ?? ""), "a malformed digest is refused");
    ok(/over the/.test(payloadProblem(Buffer.alloc(11 * 1024 * 1024), {}) ?? ""), "an oversized object is refused");
    ok(jobBytes("\\x504b0304").equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])), "inline bytea hex is decoded");
    ok(jobBytes(null).length === 0, "a null payload decodes to nothing");
  }

  console.log("loadJobWorkbook refuses anything it did not mint");
  {
    const good = Buffer.from("PKpayload");
    const path = mintUploadObjectPath({ jobId: JOB, adminId: ADMIN });
    const f = fake({ download: good });
    const buf = await loadJobWorkbook(f.sb, job({ storage_bucket: SYNC_UPLOAD_BUCKET, storage_path: path, payload_bytes: good.length, checksum_sha256: sha256Hex(good) }));
    ok(buf.equals(good), "a valid storage object is returned");
    let msg = "";
    try { await loadJobWorkbook(f.sb, job({ storage_path: "jobs/2026/09/aaa/not-mine.xlsx" })); } catch (e) { msg = (e as Error).message; }
    ok(/refusing the stored workbook/.test(msg), "a foreign path is refused before any download", msg);
    msg = "";
    const bad = fake({ download: { error: "Object not found" } });
    try { await loadJobWorkbook(bad.sb, job({ storage_path: path })); } catch (e) { msg = (e as Error).message; }
    ok(/storage object is missing/.test(msg), "a missing object is a clear error", msg);
    msg = "";
    try { await loadJobWorkbook(fake({ download: good }).sb, job({ storage_path: path, payload_bytes: 2, checksum_sha256: sha256Hex(good) })); } catch (e) { msg = (e as Error).message; }
    ok(/declared 2/.test(msg), "a size mismatch stops the parse", msg);
  }

  console.log("failure classification decides retry or park");
  {
    const permanent = [
      "not a workbook: corrupt central directory",
      "ZIP64 workbooks are not accepted",
      "Macro-enabled workbooks are not accepted",
      "the workbook is password-protected (xl/sheet1.xml)",
      "part x uses an unsupported compression method (AES)",
      "the workbook archive is inconsistent: its directory declares 7 entries",
      'the workbook archive lists "xl/workbook.xml" twice',
      "The workbook has 70,000 rows in total — more than the 60,000 we accept",
      "Part xl/sheet1.xml expands 400× — the workbook looks like a compression bomb",
      "BATCH_NOT_RESUMABLE: 3 row(s) of this batch are already committed",
      "the stored workbook does not match its declared checksum",
      "the stored workbook is empty",
      "refusing the stored workbook: the object path belongs to a different job",
      "sync target table users is not permitted",
    ];
    for (const m of permanent) ok(classifyStagingFailure(m) === "permanent", `permanent: ${m.slice(0, 54)}…`, classifyStagingFailure(m));
    const timeouts = ["Staging exceeded its 240 s budget while staging cargo", "canceling statement due to statement timeout", "connect ETIMEDOUT"];
    for (const m of timeouts) ok(classifyStagingFailure(m) === "timeout", `timeout: ${m.slice(0, 50)}…`, classifyStagingFailure(m));
    const transient = ["fetch failed", "ECONNRESET", "503 Service Unavailable", "deadlock detected", "could not open sync batch: network error"];
    for (const m of transient) ok(classifyStagingFailure(m) === "transient", `transient: ${m}`, classifyStagingFailure(m));
  }

  console.log("finishJob reads BOTH the error and the boolean");
  {
    const okCase = fake({ finish: () => ({ data: { ok: true, status: "done", attempts: 1 } }) });
    ok((await finishJob(okCase.sb, job(), { ok: true, batchId: "b" })).ok === true, "a confirmed finalisation is ok");
    ok(okCase.calls[0].args.p_lease_token === "tok-1", "…and it passes the lease token", String(okCase.calls[0].args.p_lease_token));
    const rpcErr = fake({ finish: () => ({ error: { message: "connection reset" } }) });
    const r1 = await finishJob(rpcErr.sb, job(), { ok: true });
    ok(r1.ok === false && r1.reason === "rpc_error", "a transport error is NOT success", JSON.stringify(r1));
    const refused = fake({ finish: () => ({ data: { ok: false, reason: "lost_lease", status: "running" } }) });
    const r2 = await finishJob(refused.sb, job(), { ok: true });
    ok(r2.ok === false && r2.reason === "lost_lease", "a false result is NOT success", JSON.stringify(r2));
    const nulled = fake({ finish: () => ({ data: null }) });
    const r3 = await finishJob(nulled.sb, job(), { ok: true });
    ok(r3.ok === false, "a null result is NOT success", JSON.stringify(r3));
  }

  console.log("a pass that loses its lease reports nothing as done");
  {
    // staging will fail (no real workbook), so the failure path is exercised;
    // what matters is that a refused finalisation is counted as lost.
    const f = fake({
      claims: [[job({ bytes: "\\x504b0304" })], []],
      finish: () => ({ data: { ok: false, reason: "lost_lease", status: "running" } }),
    });
    const out = await processUploadJobs(f.sb, { budgetMs: 4000 });
    ok(out.claimed === 1, "one job was claimed", JSON.stringify(out));
    ok(out.done === 0, "nothing was reported done");
    ok(out.lost === 1, "the pass is counted as lost", JSON.stringify(out));
    const successAudits = f.inserts.filter((i) => i.table === "data_sync_audit" && (i.row as { ok?: boolean }).ok !== false);
    ok(successAudits.length === 0, "no success audit was written", JSON.stringify(successAudits.map((a) => a.row.summary)));
  }

  console.log("a claim without a token is refused rather than worked on");
  {
    const f = fake({ claims: [[job({ lease_token: null })], []] });
    const out = await processUploadJobs(f.sb, { budgetMs: 4000 });
    ok(out.lost === 1 && out.done === 0, "a tokenless claim is not staged", JSON.stringify(out));
    ok(!f.calls.some((c) => c.name === "finish_sync_upload_job"), "…and nothing is finalised for it");
  }

  console.log("a failing pass records the failure with its classification");
  {
    const f = fake({
      claims: [[job({ bytes: "\\x0000" })], []],
      finish: (args) => ({ data: { ok: true, status: args.p_failure_kind === "permanent" ? "failed" : "retry_wait", attempts: 1, next_attempt_at: new Date().toISOString() } }),
    });
    const out = await processUploadJobs(f.sb, { budgetMs: 4000 });
    const settle = f.calls.find((c) => c.name === "finish_sync_upload_job");
    ok(!!settle, "the failure was recorded");
    ok(settle?.args.p_ok === false, "…as a failure");
    ok(typeof settle?.args.p_failure_kind === "string", "…with a classification", String(settle?.args.p_failure_kind));
    ok(settle?.args.p_lease_token === "tok-1", "…and the lease token");
    ok(out.done === 0 && (out.failed + out.retrying) === 1, "it is counted as failed or retrying, not done", JSON.stringify(out));
  }

  console.log("the claim's budget and lease");
  {
    const f = fake({ claims: [[], []] });
    await processUploadJobs(f.sb, { budgetMs: 60_000 });
    const claim = f.calls.find((c) => c.name === "claim_sync_upload_job");
    ok(!!claim, "a pass claims");
    ok(Number(claim?.args.p_ttl_seconds) > 60, "the lease outlives the function's own budget", String(claim?.args.p_ttl_seconds));
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
void main();

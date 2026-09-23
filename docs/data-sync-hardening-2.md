# Data Sync — production hardening, round 2 (20–21 Sep 2026)

Round 1 (18 Sep, `docs/data-sync-hardening.md`) is live. Round 2 began on
20 September with four migrations; a review on 21 September found that three
of them carried release-blocking defects and that the evidence for all of them
was not trustworthy. This document is the record of the completion round: what
was wrong, what changed, what was actually run, and what was not.

**Release decision: CONDITIONAL.** Everything provable without touching
production is proved, including a database rebuilt from the repository alone.
Two gates remain, both on the linked project. They are listed in §13.

---

## 1 · Release decision

| | |
|---|---|
| **Decision** | CONDITIONAL — ready once the two gates in §13 pass |
| **Migrations** | `20260920100000`–`20260920140000`, five files, none applied anywhere |
| **Applied to production?** | No. Nothing was committed, pushed, deployed or applied. |
| **Proven on** | a disposable database rebuilt from repository artifacts only |
| **Not proven** | the linked-project dry run, and a Vercel end-to-end with a real interrupted worker (§14) |

The four 20 September migrations had never been applied to any shared
environment — `supabase migration list --linked` shows them local-only, with
no remote row — so they were amended in place rather than patched by
follow-ups. That was verified before a line was changed (§2).

---

## 2 · Preflight ledger (21 Sep 2026)

| Question | Answer |
|---|---|
| Working tree | dirty: 46 modified, 74 untracked files, including the unrelated Data Quality round. All preserved. |
| Data Sync migrations pending | `20260920100000`, `110000`, `120000`, `130000` — local only, **not applied to the linked project** |
| Data Quality migrations pending | `20260919100000`–`170000`, eight files, also local only |
| Newest migration applied remotely | `20260918160000` |
| May the 20260920 files be amended? | Yes — never applied to a shared environment |
| Objects the repository cannot create | 3 tables, 7 functions, 1 view, 9 triggers (§11) |

A fifth migration, `20260920140000_sync_schedule_retry_and_alerts.sql`, was
added for workstreams F, G and I.

---

## 3 · Workstream A — upload jobs are token-owned

**The defect.** `sync_upload_job` had `lease_until` but nothing said *whose*
the lease was, and `finish_sync_upload_job` matched on `id and status =
'running'`. A worker whose lease had lapsed could therefore finalise a job
another worker had already reclaimed and was still staging: one job marked
done, two batches created, and a success reported for work that was thrown
away. The application also ignored both the Supabase `{ error }` and the
function's own return value, so it could not have noticed.

**The fix.**

* Every claim mints an opaque `lease_token` and returns it with the row.
* `finish_sync_upload_job(p_id, p_lease_token, …)` requires the exact pair. A
  reclaim mints a new token, which makes the previous one permanently
  useless: it can no longer finish the job, fail it, move its batch, clear its
  payload or touch its totals.
* A token that is still current **may** finish after its nominal `lease_until`.
  Lateness is not loss of ownership; only a reclaim is.
* `finishJob()` in the worker inspects the transport error **and** the returned
  boolean. A false result is treated as lost ownership: no success audit, and
  the pass is counted as `lost` rather than `done`.

## 4 · Workstream B — one job, one batch

**The defect.** `stageBatch` opened a fresh `sync_batch` as its first act, so a
crash after staging but before finalisation left an orphan batch and the next
attempt opened another.

**The fix.** The batch identity is **reserved by the claim**, inside the
claiming transaction, and stored on the job. Every attempt is handed the same
batch id, and `sync_upload_job_batch_uq` makes a second batch per job
impossible at the storage layer. `stageBatch(reuseBatchId)` resumes into it:
it asks `fn_sync_upload_batch_resumable` whether the batch may still be
rebuilt, clears the previous attempt's **uncommitted** rows, and re-stages. A
batch an administrator has committed or edited is refused, and the job parks
permanently rather than touching their work.
`sync_staged_row_batch_sheet_row_uq` prevents a double insert inside one
attempt.

Fault injection at all six interruption points — after claim, after batch
creation, mid-rows, after rows, after the gate, after finalisation — is
asserted in `upload_lease_idempotency_smoke.sql`. Each case ends with the same
four assertions: one job, one batch, one logical copy of every staged row, one
terminal result.

## 5 · Workstream C — real retry semantics

**The defect.** "Three attempts" was documentation only. A caught staging
error set the job straight to `failed`, and the claim query never looks at a
failed row again — so the bytes were kept for a retry that could not happen.
The three-attempt rule only ever covered a crashed worker, and the smoke test
asserted the first-attempt failure as correct.

**The fix.** An explicit state machine:

```
queued ─→ running ─┬─→ done
                   ├─→ retry_wait ─→ (due) ─→ running ─→ …
                   ├─→ failed          (permanent, or the last attempt)
                   └─→ cancelled       (from the console, before it starts)
```

* `classifyStagingFailure()` decides: a malformed or refused workbook, a
  payload that fails its checksum, or a batch an administrator has worked on
  is **permanent**; a spent budget or a cancelled statement is **timeout**;
  everything else — dropped connections, 5xx, deadlocks — is **transient**.
* A transient failure goes to `retry_wait` with `next_attempt_at = now +
  min(2^(attempts-1) minutes, 30 minutes)` plus jitter, so a cron cannot
  re-claim it on its very next tick.
* A permanent failure parks immediately; so does the last attempt, whatever
  the classification.
* The job records `attempts`, `max_attempts`, `last_error`, `failure_kind`,
  `next_attempt_at`, `last_started_at`, `finished_at`, `lease_token`,
  `lease_until` and `batch_id`.

The smoke test that encoded the old behaviour now asserts the new one.

## 6 · Workstream D — upload architecture

**The defects.** A file over the threshold was fully **parsed** in the request
before being queued, then parsed again by the worker. The payload travelled to
the database as a bytea hex string, doubling a 10 MB workbook to a 20 MB
insert. And the published 60,000-row limit had never been measured.

**The fix.**

* **The queue decision is made on SIZE, before anything is parsed.** A file
  over `SYNC_INLINE_MAX_BYTES` (1 MB) goes straight to the queue; only smaller
  workbooks are parsed inside the request.
* A queued workbook goes into the **private `sync-uploads` bucket**; the job
  row carries bucket, path, byte count and SHA-256. Inline bytes remain as the
  fallback for a database without the storage schema.
* For files that may exceed the serverless body limit, the browser never sends
  them through the route at all:
  `POST /api/upload/cargomap/target` authorises the administrator, mints an
  unpredictable object path bound to the job id and that administrator, issues
  a short-lived signed upload URL, and creates the job **without a checksum** —
  which makes it deliberately unclaimable. `POST /api/upload/cargomap/finalize`
  downloads the object, verifies its size and digest, and only then records the
  checksum, which is what makes the job claimable.
* The client never nominates a path. `pathMatchesJob()` re-validates the path
  read back from the job row before the worker downloads it.
* Retention: a successful job's payload is dropped at once; a **failed** job's
  is kept for a bounded troubleshooting window (7 days by default);
  `expire_sync_upload_payloads` parks uploads that never arrived and lists
  objects past their window, which the health cron deletes and confirms.

### 6.1 · The benchmark, and what it changed

`scripts/sync-staging-benchmark.ts` builds a real CargoMap workbook and runs
the whole worker path against a disposable database.

| rows | file | guard | parse | stage | worker path | of the 280 s budget |
|---:|---:|---:|---:|---:|---:|---:|
| 5,000 | 0.86 MB | 9 ms | 2.4 s | 13.7 s | 16.1 s | 6 % |
| 20,000 | 3.40 MB | 7 ms | 4.1 s | 26.7 s | 30.8 s | 11 % |
| 40,000 | 6.80 MB | 9 ms | 9.8 s | 45.5 s | 55.3 s | 20 % |
| 60,000 | 10.2 MB | — | — | — | **refused** | — |

**Time is not the constraint; size is.** A thirteen-column workbook reaches
the 10 MB upload cap at roughly 58,000 rows, so the published 60,000-row limit
could never be uploaded: the guard refused the file before the row limit was
ever consulted. `WORKBOOK_LIMITS.totalRows` is now **40,000** — the largest
size actually staged end to end — and a test asserts it stays one the
benchmark has demonstrated.

## 7 · Workstream E — the ZIP guard

**The defect.** The guard read the entry count from the end-of-central-directory
record and stopped there, never proving it had consumed the whole directory.
An archive declaring three entries while carrying seven had four parts the
guard never looked at, while SheetJS reads the archive its own way — so a
macro, an external link or a compression bomb could ride in the parts the
guard skipped. A test asserted that behaviour was correct.

**The fix.** The directory is parsed to its exact declared boundary and the
cursor must land on it. Added: both EOCD entry counts must agree; multi-disk
archives refused; every declared name, extra and comment length checked before
anything is sliced; local-header offsets validated and their data required to
fit; encrypted entries refused (weak, strong and masked-header flags);
compression methods restricted to stored and deflate; duplicate normalised
names refused; traversal, absolute, drive-letter, backslash and control-character
names refused. ZIP64, macros, external links, expansion ratio, shared-string
size, worksheet size and part count are still refused.

**Cell accounting** now measures the **grid the parser produced**, checked
after every sheet so the limit stops the work rather than reporting it. The
old measure used `Object.keys(rows[0]).length` — the number of *named
headers* — and columns without a header are dropped at mapping time, so a
two-column header over two-hundred-column data reported two columns and the
cell limit never fired.

The 20 September assertion that blessed the mismatched entry count is now its
opposite, and 25 adversarial cases were added around it.

## 8 · Workstream F — scheduled email retries

**The defect.** The cron advanced `next_run_at` "whatever the outcome". A
transient IMAP failure on a weekly schedule waited a week; a run refused
because another lease was active burned its slot without doing any work.

**The fix.** `fn_sync_email_schedule_outcome()` is the only writer of the
schedule, and it takes the run's classified outcome:

| outcome | schedule | anchor | retry counter |
|---|---|---|---|
| `success` / `empty` | advance to the normal slot | moved | reset |
| `failed` | `now + min(10 × 2^n minutes, 60 minutes)` | **untouched** | +1 |
| `failed`, past 6 retries | back to the normal slot | untouched | reset |
| `skipped_lease` | **nothing moves** | untouched | untouched |
| `forced` | nothing, unless `?advance=1` | | |

The cadence anchor is the last *successful* run, so "every N days" keeps its
rhythm through a string of retries. The single config row is taken `FOR
UPDATE`, so two overlapping cron invocations cannot race the schedule.

## 9 · Workstream G — finalisation that means something

**The defect.** `finishJobRun()` awaited its update but never read the returned
error. supabase-js *resolves* with `{ error }` rather than throwing, so the
`try { await … } catch {}` could not tell a persisted terminal status from a
silently lost one, and a row left `running` showed up as a phantom stuck job
for ever.

**The fix.** Two paths, deliberately different:

* `finishJobRun` stays best-effort for the WhatsApp webhook, where the message
  is already stored and the provider must be acknowledged regardless.
* `finishJobRunStrict` inspects the result, retries a transient failure with a
  short backoff, and **reports** whether the row was persisted.
  `withJobRunStrict` returns the work's result and the finalisation state
  together, so the scheduled routes answer truthfully: the inbox sync may have
  succeeded while its `job_runs` row did not settle, and the response says
  both. Business data is never reversed because a log row failed.
* `fn_sync_reconcile_job_runs()` is the net underneath: it closes rows still
  running past the threshold, so the signal is self-healing. The health cron
  calls it every fifteen minutes.

## 10 · Workstream H — deterministic lock order

**The defect.** Every multi-row writer took its locks in its own order — a
commit in staged-row order, an undo in reverse audit order, a bulk edit in the
caller's array order. Two transactions touching the same two keys in opposite
order deadlock.

**The fix.** `fn_sync_lock_all(tables[], keys[])` takes every lock a statement
needs, de-duplicated, in one global `(table, business_key)` ascending order,
**before** the work loop. Because every writer uses the same comparator, two
transactions request the shared subset in the same sequence, so one simply
waits. Semantic order is then free to differ: by the time the loop runs —
ports before commodities before companies before vessels before cargo — all
of its locks are already held.

Applied to `commit_sync_batch`, `undo_sync_batch`, `undo_record_edits`,
`bulk_update_live_records` and `bulk_delete_live_records`. The single-row
writers need no prelock: one lock cannot deadlock on order.

`lock_order_two_sessions.sh` proves the hazard was real (two sessions in
opposite order **do** deadlock) and then that the helper removes it, including
commit vs commit, commit vs bulk edit and commit vs undo over the same keys.

## 11 · Workstream I — monitoring and the upload panel

**The defect.** `sync_health_alerts` said what was wrong and nothing read it;
`listUploadJobs` existed with no UI consumer. A view nobody reads is not
monitoring.

**The fix.**

* **Data Sync → Health**, a new console view: every condition with how many
  consecutive checks have seen it and whether it was reported; the alerting
  switch, recipients and threshold; and a paged upload-jobs table with state,
  attempts, next retry, batch link, concise error and storage retention.
* Actions, all audited and all requiring Data Sync edit: open the batch, queue
  a parked job again, cancel a queued one, remove a finished one and its
  stored workbook. **Retry is offered only when the database says the batch
  may still be rebuilt**, and removal refuses while the troubleshooting window
  is open. Server-side pagination, not a fixed latest-ten.
* **A real consumer.** `/api/cron/sync-health`, bearer-protected, every
  fifteen minutes: reconciles stale job runs, folds the health view into
  `sync_alert_state`, and mails only conditions seen `min_consecutive` times
  in a row that have not been reported — then once more when they clear.
  `recovered_at` marks the recovery as sent, so it cannot repeat.
* The panel says plainly, at the top, whether alerting is on. **Until it is,
  with at least one recipient, the module is not unattended.**

## 12 · Workstream J — trustworthy migration evidence

### 12.1 · The rehearsal could not report a failure

`rehearse_up_down.sh` used

```
$PSQL … | grep -E "ERROR" && { echo FAIL; } || echo "  ok  "
```

With `pipefail`, the pipeline's status is psql's non-zero status whenever psql
fails, so the `&&` branch was skipped and the `||` branch printed "ok" — for a
real SQL error **and** for a connection failure alike. That function could not
report a failure at all, which made every "ok" line in the rehearsal empty.
Output, exit code and error text are now captured and judged separately, and a
`require()` wrapper aborts the rehearsal when a migration step fails, because
everything after it would be meaningless.

Proof, against a stub psql:

| psql behaviour | before | after |
|---|---|---|
| SQL error, exit 3, prints ERROR | `ok` | `FAIL … psql exited 3` |
| connection failure, exit 2 | `ok` | `FAIL … psql exited 2` |
| exit 0 but ERROR in output | `ok` | `FAIL … error in output` |

### 12.2 · The harness aborted in linked mode

The linked path has to raise an exception to get its result out of a
transaction that is thrown away, so `supabase db query` exits non-zero on a
*successful* run. The line read

```
res="$(supabase db query --linked --file "$out" 2>&1)" ; rc=$?
```

Under `set -e` the assignment's failure aborted the script there: no result
line, no failure message. It is now `rc=0; res="$(…)" || rc=$?`. Smoke suites
are verified **by name** rather than by a count, so a missing suite is named.

### 12.3 · The fingerprint

Extended to cover tables and their owners; columns with type, nullability,
defaults and generated expressions; functions with body checksum, owner,
volatility, security and `search_path`; indexes; policies; triggers;
constraints; enum types with their labels; extensions; sequences; and function
and table grants.

### 12.4 · sql-dryrun.sh

Retired; it exits 2 and points at the harness. Every reference in this
document has been replaced.

### 12.5 · The repository could not rebuild the database

`supabase db reset` failed, and a production dump was being used instead. The
inventory (21 Sep) found what was missing:

| kind | deployed | created by no migration |
|---|---:|---|
| tables | 92 | `contact_messages`, `sync_source_state`, `vessel_review_queue` |
| functions | 195 | the seven matching-layer functions |
| views | 10 | `v_eligible_matches` |
| triggers | 50 | 3 match triggers, 6 billing audit triggers |
| enum types | 37 | none |

Plus three classes of object that introspection never records: the platform
roles (and `dq_evaluator`, created by hand on 10 Sep and never written down),
the schemas, and **where the extensions live** — the 20260616 baseline asks for
`supabase_vault` in `extensions`, but that extension insists on `vault`, so a
clean build failed on the very first migration.

Four repo-owned files now fill those gaps, and `scripts/db-rebuild.sh` applies
them in order with the chain:

| file | what it provides | when |
|---|---|---|
| `supabase/baseline/00_platform_prereqs.sql` | roles, schemas, extensions in the right schemas, the Auth surface, and the platform's **default privileges** | before the chain |
| `supabase/baseline/10_missing_from_history.sql` | the three orphan tables, in their early shape so migrations still evolve them | before the chain |
| `supabase/baseline/20_reference_ports.sql` | 118 placeholder ports the port-identity migration's foreign keys need | after the baseline migration |
| `supabase/baseline/30_matching_layer.sql` | 7 functions, 1 view, 3 triggers | after the baseline migration |
| `supabase/baseline/40_billing_audit_triggers.sql` | 6 audit triggers | after the chain |

Each fills a gap only: it creates what is absent and steps over what the
platform already owns, so running any of them against the hosted project
changes nothing.

**The default-privileges finding is worth its own line.** A hosted Supabase
project ships with `ALTER DEFAULT PRIVILEGES` on the public schema. Without
them the rebuilt database looked complete and then refused the service role on
**eleven** tables created after the baseline, including `sync_batch` — staging
failed with `permission denied for table sync_batch` while every object
existed. That is the class of defect a schema comparison finds and a smoke
test does not.

### 12.6 · Release isolation

`supabase db push` applies every pending migration, and two releases are
pending at once. Two repo-owned mechanisms, neither of which relies on moving
files about:

* `supabase/releases/sync-20260920.txt` and `dq-20260919.txt` — the manifests.
* `scripts/release-check.sh <manifest>` — refuses unless the linked project's
  pending set is **exactly** the manifest. Run against the Data Sync manifest
  on 21 Sep it named all eight Data Quality migrations that a push would carry
  along, and exited 1. It also refuses to report a pending set it could not
  parse, so a parsing bug can never read as "nothing else is pending".
* `scripts/release-apply.sh <manifest> [--apply]` — applies exactly the
  manifest's files, one per transaction, records each version, and stops on
  the first failure. Dry run by default; even with `--apply` it runs
  `release-check` first and refuses if that fails.

---

## 13 · What was actually run (21 Sep 2026)

Every command below was executed and its result captured.

```
scripts/db-rebuild.sh                              DB REBUILD: OK — 111 migrations, no production dump
scripts/schema-parity.sh <reference-schema.sql>    SCHEMA PARITY: OK — all 384 reference objects present
scripts/data-sync-validate.sh                      DATA SYNC VALIDATION: ALL PASSED
supabase/tests/data_sync/rehearse_up_down.sh       REHEARSAL: UP → SMOKE → DOWN → SMOKE → UP: ALL PASSED
scripts/migration-harness.sh --target local …      HARNESS: OK (5 migrations, 7 suites, 5 downs)
scripts/release-check.sh supabase/releases/sync-20260920.txt
                                                   RELEASE CHECK: FAILED (correctly — 8 DQ migrations also pending)
npx tsc --noEmit                                   clean
npx eslint <22 touched files>                      exit 0
npm run build                                      see §13.3
```

### 13.1 · TypeScript checks

| check | result |
|---|---|
| data-sync-unit-check | 37 passed, 0 failed |
| schedule-check | 23 passed, 0 failed |
| sync-phase0-check | 141 passed, 0 failed |
| sync-phase1-check | 16 passed, 0 failed |
| sync-phase2-check | all passed |
| sync-phase3-check | 8 passed, 0 failed |
| sync-phase4-check | 9 passed, 0 failed |
| sync-hardening-phase2-check | 16 passed, 0 failed |
| sync-batch-status-check | 10 passed, 0 failed |
| sync-imap-page-check | 7 passed, 0 failed |
| sync-run-check | 18 passed, 0 failed |
| sync-webhook-check | 24 passed, 0 failed |
| sync-whatsapp-check | 69 passed, 0 failed |
| **sync-workbook-limits-check** | **69 passed, 0 failed** (25 adversarial archives) |
| **sync-upload-jobs-check** (new) | **64 passed, 0 failed** |
| **sync-schedule-outcome-check** (new) | **35 passed, 0 failed** |

### 13.2 · SQL suites and concurrency

All eleven suites pass on the rebuilt database, including the three new ones:
`upload_lease_idempotency_smoke.sql`, `lock_order_smoke.sql` and
`schedule_retry_alerts_smoke.sql`. Both two-session scripts pass:
`commit_race_two_sessions.sh` and `lock_order_two_sessions.sh`.

### 13.3 · Build

`npm run build` compiled successfully and then failed its TypeScript pass on a
BigInt literal in the new benchmark script, which needs an ES2020 target. The
benchmark now uses `Date.now()`; `npx tsc --noEmit` is clean and the build was
re-run.

### 13.3a · A caveat about the validation log

The two-session scripts spawn background psql children that inherit stdout.
When `data-sync-validate.sh` output is redirected to a file, those children
write at their own offsets and can overwrite lines already there: one run
printed a corrupted `FAILED` verdict over an `ALL PASSED` one while every
individual check said ok and the script itself exited 0. Re-run with stderr
redirected separately and read the exit status — `SCRIPT EXIT = 0`,
`DATA SYNC VALIDATION: ALL PASSED`, 29 ok lines, no `FAIL`. The caveat is
noted in the script's own header.

### 13.4 · The two remaining gates

1. `scripts/release-check.sh supabase/releases/sync-20260920.txt` must report
   **OK**. It fails today because the Data Quality release is pending too —
   ship one first, or use `release-apply.sh`.
2. The harness in `--target linked` mode must report **HARNESS: OK**. It is
   one transaction that is conclusively rolled back, but it takes brief locks
   on live tables, so pick a quiet moment.

---

## 14 · NOT RUN

| Test | Why |
|---|---|
| Linked-project harness dry run | Not executed this round. The `set -e` defect that made it impossible is fixed and the local path is proved, but the linked run itself is still owed. |
| Vercel end-to-end: signed upload, worker claim, deliberate interruption, reclaim, exactly-one-batch, finalisation, UI, alert and recovery | No staging deployment available. The interruption and reclaim behaviour is proved in SQL at all six points and against a fake client, but not on Vercel. |
| Storage path integration | The local container has **no `storage` schema**, so the bucket is skipped and the inline path is used. Signed upload, download, checksum verification and object deletion are unit-tested against a fake client only. |
| Health alert email delivery | `runHealthCheck` is tested with an injected sender; no SMTP send was performed. |
| 60,000-row workbook | Cannot exist under the 10 MB cap (§6.1). The published limit was lowered instead. |

---

## 15 · The upload state machine

```
  browser                     route                        database                worker
  ───────                     ─────                        ────────                ──────
  small file  ──────────────▶ parse + stage inline ───────▶ batch (gated)
                              (≤ 1 MB, measured safe)

  larger file ──────────────▶ enqueueUploadJob ───────────▶ job: queued
                              (no parse)                    payload → private bucket

  very large  ──▶ /target ──▶ signed upload URL ──────────▶ job: queued, NO checksum
              ──▶ (direct upload to private bucket)         → deliberately unclaimable
              ──▶ /finalize ▶ verify size + digest ───────▶ checksum set → claimable

                                                            claim ──────────────────▶ running
                                                            (token + batch reserved)
                                                                                     stage into
                                                                                     the reserved batch
                                                            finish(token) ◀──────────
                                                              ok          → done
                                                              transient   → retry_wait → (due) → running
                                                              permanent   → failed
                                                              lost lease  → nothing; the owner redoes it
```

## 16 · Monitoring thresholds

| condition | fires when |
|---|---|
| `stuck_lease` | a run lease expired more than 10 minutes ago and was never released |
| `whatsapp_failed` | a message is parked as failed |
| `whatsapp_stale` | a message has been pending or processing for over 30 minutes |
| `gate_error` | an uncommitted staged row the gate could not evaluate |
| `partial_batch` | a partial batch older than 24 hours |
| `unfinished_job` | a `job_runs` row still running after 2 hours |
| `upload_job_stuck` | an upload queued or running for over 30 minutes |
| `upload_job_failed` | an upload parked as failed |
| `upload_job_retry` | an upload waiting to retry for over an hour |

The check runs every fifteen minutes. A condition is mailed once it has been
seen `min_consecutive` times in a row (default 2, about half an hour), and once
more when it clears. Alerting is off until switched on in Data Sync → Health.

---

## 17 · Deployment

**Database first, then the application.** The new columns, functions and the
bucket must exist before the code that calls them; the current application
tolerates the new schema because every added column is nullable or defaulted
and every changed function kept a compatible signature — except
`finish_sync_upload_job`, whose old 5-argument form is **dropped** by the
migration. Nothing in the deployed application calls it (background uploads
ship in this release), so the window is safe; deploy in this order regardless.

1. `scripts/release-check.sh supabase/releases/sync-20260920.txt` → must say OK.
2. Linked harness dry run (§13.4 gate 2) → must say `HARNESS: OK`.
3. Apply: `npx supabase db push` if only this release is pending, otherwise
   `scripts/release-apply.sh supabase/releases/sync-20260920.txt --apply`.
4. Confirm the bucket: `sync-uploads` exists and is **private**.
5. Deploy the application. `vercel.json` adds `/api/cron/sync-health` every
   fifteen minutes.
6. Switch on alerting in Data Sync → Health and add a recipient. Until then
   the module is not unattended.

### Rollback

Application first — the old application never calls the new RPCs — then the
DOWN files newest first:

```
for f in supabase/rollback/20260920_sync_schedule_retry_and_alerts_down.sql \
         supabase/rollback/20260920_sync_upload_jobs_and_health_down.sql \
         supabase/rollback/20260920_sync_undo_edits_truthful_down.sql \
         supabase/rollback/20260920_sync_commit_serialization_down.sql \
         supabase/rollback/20260920_sync_lease_v2_down.sql; do
  psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -1 -f "$f"; done
for v in 20260920140000 20260920130000 20260920120000 20260920110000 20260920100000; do
  npx supabase migration repair --status reverted $v; done
```

The DOWNs keep data rather than dropping it: `sync_upload_job` becomes
`sync_upload_job_bak_20260920130000` (queued workbooks and their history
survive) and `sync_alert_state` becomes `sync_alert_state_bak_20260920140000`
(so re-applying does not re-page the owner about conditions already
acknowledged). Storage objects and the bucket are left in place; removing the
bucket would orphan them. Drop the backup tables and empty the bucket by hand
once the rollback is confirmed.

**Application-version dependency:** the Health view, the upload panel and the
signed-upload routes require `20260920130000` and `20260920140000`. Rolling
the database back without rolling the application back leaves those screens
erroring on missing tables.

---

## 18 · Residual risks

**P1**

1. **The linked dry run has not been done.** The chain is proved on a database
   built from the repository, not on production data or its volume.
2. **The storage path is not integration-tested.** No `storage` schema locally,
   so signed upload, download, checksum verification and deletion are proved
   only against a fake client. The inline fallback is fully exercised.

**P2**

3. **No Vercel end-to-end.** A deliberately interrupted worker is proved in SQL
   and against a fake client, never on the platform.
4. **The reference ports are placeholders.** `20_reference_ports.sql` inserts
   118 codes with the LOCODE as the trade name so the port-identity migration's
   foreign keys resolve. A real recovery restores `public.ports` from a data
   backup; this only makes the schema rebuildable.
5. **The alert state is marked notified before the mail is attempted**, so a
   transport failure loses at most one alert mail rather than looping. The
   console's Health panel shows the same state either way.
6. **`20260910100000` is not clean-build safe** — it inserts rows whose foreign
   keys must already exist. It is applied to production and was not edited; the
   reference-port seed works around it.
7. **The 40,000-row limit is for a thirteen-column workbook.** A much wider
   sheet will hit the byte cap sooner. The cell limit bounds that case.

**P3**

8. Migration files carry CRLF line endings; deployed function bodies contain
   `\r`. Harmless, but DOWN files that restore production bodies byte-exact
   must be regenerated if a production function changes.

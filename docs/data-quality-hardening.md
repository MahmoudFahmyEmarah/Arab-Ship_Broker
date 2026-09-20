# Data Quality module — production hardening (19–20 Sep 2026)

Eight workstreams (A–H, 19 Sep) hardened the module after the production
audit; a completion round on 20 Sep answered the owner's second audit
(silent key-error exclusion, rule-count coverage, a poller that executed
batches for viewers, markers-before-delivery notifications, hour-granular
scheduling, no rollback proof). This document is the record of both: what
changed, how it is proven, how it ships, how it rolls back, and what is
still open.

**Status (20 Sep 2026): built and validated on a disposable database. Not
committed, not pushed, not applied. The linked (production) dry-run was
not executed — see §12.**

## 0. Release isolation

The eight migrations `20260919100000` … `20260919170000` were never applied
anywhere: `supabase migration list --linked` shows them local-only, together
with the four Data Sync round-2 files (`20260920*`). Because they were never
applied, they were **amended in place** (no follow-up migrations).

`supabase db push` applies every pending file, so the two releases must not
be pending at the same time:

* `supabase/releases/dq-20260919.txt` is this release's manifest.
* `scripts/release-check.sh supabase/releases/dq-20260919.txt` compares the
  manifest with the linked project's pending set and refuses unless they are
  identical (never applies anything). Ship Data Sync round 2 first, or move
  its files out of `supabase/migrations` until this release is applied.

Every migration starts with `set local lock_timeout = '5s'; set local
statement_timeout = '10min';` — a lock that cannot be taken in five seconds
fails the migration cleanly instead of queueing behind traffic.

### The harness (replaces scripts/sql-dryrun.sh)

`scripts/migration-harness.sh` fingerprints the schema (tables, columns,
function bodies by checksum, indexes, policies, triggers, constraints,
grants), applies the forward chain (one transaction per file,
`ON_ERROR_STOP`), runs every smoke suite and requires its
`ALL ASSERTIONS PASSED` marker, applies every DOWN in the order given, and
fingerprints again: the two must be identical apart from lines matching
`--allow-residue` (the backup tables a DOWN deliberately keeps). It fails on
any SQL error, a fatal warning, a missing marker, a non-zero exit, or a
fingerprint difference; exit codes are preserved and temporary files are
removed by a trap. `--target linked` does the same inside ONE transaction on
the linked project and rolls back (nothing persists).

The old script is now a stub that exits 2 and points here.

### Self-contained DOWN files and data preservation

`supabase/rollback/20260919_dq_{a,d,b,c,e,f,g,h}_down.sql` carry the full
previous definition of everything they restore — **byte-exact from the
production schema dump** for every function that exists in production
(same name and parameter count), so the fingerprint after the DOWN chain
equals the baseline. Data a rollback would otherwise destroy is kept:

| DOWN | keeps |
|---|---|
| B | `dq_issues_dedup_backup` (the duplicate findings B folded, copied by column name before deletion) and `dq_issue_events` → `dq_issue_events_bak_20260919120000` |
| A | `dq_evaluator_grants_bak_20260919100000`: the exact SELECT-grant / policy set the evaluator had before A, snapshotted by the forward migration and replayed by the DOWN (a blanket re-grant would have reached tables created since) |
| E | `dq_config_events` → `_bak_20260919140000` |
| F | `dq_ai_reservations` → `_bak_20260919150000` |
| G | `dq_notification_outbox` → `_bak_20260919160000` |

Constraints and their indexes follow the table into the backup name, so
nothing keeps a live name after a rollback.

### Lock-risk review

| Migration | DDL that takes a strong lock | on | exposure |
|---|---|---|---|
| A | `create policy dq_evaluator_read`, `grant select` on each allowlisted table | member tables | brief ACCESS EXCLUSIVE per table; lock_timeout 5 s |
| B | `alter table dq_issues` (columns, check), dedup delete, unique index, trigger | dq_issues | module-internal (only the engine writes it) |
| C | columns on dq_runs / dq_run_batches / dq_health_snapshots, new table | module tables | internal |
| E | `dq_gate_log.correlation_id` + partial index, config-events table | dq_gate_log | internal; the forms trigger inserts into it — a 5 s window |
| F | `dq_settings.ai_max_output_tokens`, reservations table | dq_settings | internal |
| G | outbox table, `dq_runs.schedule_key` + unique partial index | dq_runs | internal |
| H | expression indexes on `ports` and `cargo_listings` (+ ANALYZE), generated `search_text` column on dq_issues (table rewrite) + trigram index | **ports, cargo_listings** | SHARE lock for the index build (blocks member posts and sync commits for seconds; a WhatsApp sweep deadlocked one rehearsal — a deadlocked push rolls back cleanly, rerun it). `create index concurrently` is not possible inside a migration transaction; to avoid the window, pre-create the two indexes concurrently by hand at a quiet moment — the migration's `if not exists` then finds them. |

## 1–7. Workstreams A–G (19 Sep) — what they are

* **A · boundary and auth.** Rule SQL runs as `dq_evaluator`, which reads only
  the allowlist ∪ registered tables (`fn_dq_evaluator_sync_grants`, kept in
  step by triggers); `dq_save_rule` refuses a rule whose plan touches a
  relation outside it; the engine re-kicks itself at the configured origin
  only (`DQ_ENGINE_URL`); registry imports fetch UNECE hosts only, capped.
* **D · fix and undo.** `dq_apply_fix` validates the fixed row strictly and
  is audited; `dq_undo_fix` restores the before-value only while the field
  still holds the fix, otherwise returns the conflict; force needs a reason.
* **B · finding lifecycle.** One identity per finding (unique index, the
  duplicates folded into `dq_issues_dedup_backup`); statuses `rule_disabled`,
  `check_removed`, `record_gone`; suppressions remember the observed value
  and an optional expiry; every status change is an event.
* **C · run integrity.** Keys are snapshotted at prepare; batches page over
  the snapshot; a run's work is the set of **check units** (rule × table ×
  check) and every number is defined on that set.
* **E · policy, permissions, audit.** `lib/dq/policy.ts` names every write
  path and its policy; "run" is its own permission level; settings are
  validated server-side; configuration changes are events.
* **F · performance and AI budget.** Reservations with leases; grouped
  severity counts; sliced retention.
* **G · the console says what is true.** Notifications through a durable
  outbox; one nightly run per slot; compare only same-scope runs.
* **H · scaling.** Self-sizing batches with a persisted limit; the fenced
  evaluator; the missing indexes; one search index.

## 8. The 20 Sep completion round, phase by phase

### Phase 1 — run integrity is unit-based

`fn_dq_check_units(run)` lists the (rule, table, check) units of a run. A
key query that fails at prepare time is a **structured error on the run**
(`dq_runs.prep_errors`: rule, rule_id, table, check_idx, stage `keys`,
error): the unit is not evaluated, counts as failed, lowers coverage, ends
the run `completed_with_errors`, is announced, and is retried by
`fn_dq_retry_run` (batches that errored **and** key queries that failed)
once the rule is repaired. `coverage_pct = 100 × (1 − failed units ÷
expected units)`; `checks_expected / checks_failed` sit beside
`rules_expected / rules_failed / rules_ok`. The console reads
"86 % — 6 of 7 checks failed (4 rules)".

Proved by `dq_c_run_integrity_smoke.sql`: one failing key query, a rule with
two failing checks, one rule failing on two tables (ports and commodities),
retry to completed, and a clean run completed — with the exact expected
counts (5 prep errors; 7 units expected, 6 failed; coverage 14.3 %).

### Phase 2 — the poller reads; the scanner finds writes

* `tickRun` is strictly read-only (gate `view`). A stalled run is reported
  (`stalled: true`, STALL_MS = 90 s); `recoverRun` (gate `run`) processes
  one batch and re-kicks the chain; the hourly cron re-kicks stalled runs too.
* `lib/dq/authz.ts` is the capability matrix (view / run / edit); every
  server action calls `gate(<capability>)`. `scripts/dq-authz-check.ts`
  proves the matrix, that the Broker preset (view) cannot run, resume,
  recover, retry or schedule, that every action gates, that view-gated
  actions perform no write, no batch, no engine RPC, and that the
  member-callable module calls exactly one RPC and writes exactly one line.
* `scripts/dq-write-paths-check.ts` now **discovers**: every file under
  app/, lib/, components/, sdk/ that inserts/updates/upserts/deletes a
  registered table or calls a publication RPC must be declared in
  `DQ_WRITE_PATHS`; every SECURITY DEFINER function in the migrations that
  writes a registered table must set `dq.channel` or be listed in
  `DQ_SQL_WRITERS` with who gates it. The first run found nine undeclared
  application paths and five SQL writers; they are declared now, eight of
  them honestly as **`ungated`** (§11).
* Member forms stay on the pre-check (shadow) and the database trigger
  remains the final authority once `gate_forms_enforce` is on.

### Phase 3 — enable does not reopen

Enabling a rule reopens nothing; the next successful run reopens exactly the
parked findings it observes failing again. A removed check parks its
findings as `check_removed`; suppression (`ignored`, `false_positive`, with
the observed value and optional expiry) survives disable / enable.
`dq_b_lifecycle_smoke.sql` covers disable, enable, removed, restored,
changed value, expiry, and record deletion + recreation.

### Phase 4 — notifications through an outbox; slots at HH:MM

`dq_notification_outbox` (idempotency key, kind, status queued → sending →
sent | failed, claim token, lease, attempts, next_attempt_at, sent_at,
last_error, recipients). The database **enqueues** inside the transaction
that settles a run, fails a run, meters AI usage past 80 %, or the cron's
digest slot. `lib/dq/notify.ts` is the worker: claim (`FOR UPDATE SKIP
LOCKED` with a lease), render, send, settle — `sent` only after SMTP accepted
the message; a failure re-queues with `min(2^attempts, 240)` minutes of
back-off and gives up after 8 attempts (`failed`, requeue from Settings). A
notification the settings do not want is settled `sent` with a note
("skipped: …"). The engine drains the outbox when a run ends; the cron
drains it every hour. `dq_ai_usage.notified_at / budget80_notified_at /
digest_sent_at` are no longer markers of anything.

Scheduling: a nightly run belongs to a **slot** — the most recent
`nightly_time` (HH:MM UTC, to the minute) at or before now. The cron creates
the slot's run unless one exists; `dq_runs.schedule_key` (`nightly/<date>`)
is unique, so a retried cron, a second region or an overlapping invocation
gets `23505` and stops. A missed slot is created by the next invocation as
long as it is the most recent (one catch-up, never a backfill). The wizard's
"Schedule nightly" uses `dq_settings.nightly_time`. The console shows the
next run, the last scheduled and last successful scheduled run, and a
missed / catch-up state.

Proved by `dq_g_notifications_smoke.sql` (idempotent enqueue, claim leases
and reclaims, foreign token cannot settle, back-off ±5 s, failed after 8,
requeue, settlement enqueues, duplicate slot refused), the two-session script
(two workers claim disjoint sets; two crons, one run), and
`scripts/dq-g-check.ts` (02:30 slots, catch-up once, same key inside a slot,
missed / catch-up verdicts, digest slot, and the worker against a fake
database and mailer: SMTP refused → retry, then sent; flags off → skipped;
eighth failure → failed; rows settle independently; claim token travels).

### Phase 5 — adaptive batches, batch-scoped reservations, sliced retention

* `dq_runs.batch_limit` persists the adaptive limit: a 250-row probe, doubled
  under 1.2 s, shrunk over 3 s. `fn_dq_batch_timeout(run, error)` halves it
  in its own transaction (the cancelled batch rolled back, so the cursor
  never moved), down to the 10-row emergency floor; the third timeout at the
  floor fails the run with the batch named. The engine classifies
  `57014` / "canceling statement" as a timeout and never calls
  `fn_dq_finish_run` for one (`scripts/dq-f-check.ts` against a fake
  database; `dq_h_scaling_smoke.sql` for the SQL side).
* AI: one reservation per batch (`ai/<batch id>`), leased for 10 minutes,
  settled with the provider's real usage, released on failure, reclaimed by
  the database when the lease lapses; `dq_settings.ai_max_output_tokens`
  (256–32,000) caps the model's reply.
* Retention deletes one slice per call and answers `more`; the cron loops
  (bounded) until `more = false`.

### Phase 6 — correlation, refusals, console states, keyboard

* `validateMemberDraft` hands the form a `correlation_id`. When the database
  then refuses the post (`DQ_GATE`), the form calls `reportGateRefusal`,
  which writes one `dq_gate_log` line **in its own transaction** tagged with
  that id (`dq_gate_log.correlation_id`, migration E). The trigger's own log
  line is written inside the refused statement and rolls back with it; this
  document does not claim otherwise.
* Settings → Notifications lists every outbox row as pending / retrying /
  sending / sent / failed with attempts, next attempt or sent time, the
  delivery note and a Requeue button; Settings and Overview show the
  schedule state. Runs → "Retry failed checks" calls `fn_dq_retry_run`;
  Progress offers Recover to run-capable admins. Row buttons (Runs, Issues,
  Rules) show a visible keyboard focus (`tr[role=button]:focus-visible`).

## 9. Security acceptance

`dq_security_smoke.sql` runs as `dq_evaluator` and asserts SELECT is refused
on users, profiles, organization_members, llm_credential,
email_ingest_config, dq_settings, dq_config_events; EXECUTE is refused on
the module's SECURITY DEFINER helpers; the allowlist still reads. From the
catalogue: no `fn_dq_*` / `dq_*` function is executable by PUBLIC, anon or
authenticated except the two documented member helpers (`fn_dq_imo_valid`,
`fn_dq_effective_mode`); the evaluator may execute only its `fn_dq_eval_*`
helpers and read-only predicates; `service_role` holds the engine's grants.
Three trigger / helper functions that PostgreSQL had left PUBLIC-executable
(`fn_dq_evaluator_relations_changed`, `fn_dq_issue_status_stamp`,
`fn_dq_rules_version`) are explicitly revoked by A and B — the project's
event trigger strips PUBLIC on creation in production, but the release no
longer depends on it. The engine origin is configuration-only; the registry
import is host-allowlisted and capped.

## 10. Validation record (20 Sep 2026)

| Check | Result |
|---|---|
| `scripts/migration-harness.sh --target local` (baseline = production schema dump + DS 20260920 migrations + DQ reference data) | **HARNESS: OK** — 8 migrations, 9 suites (`dq_a`, `dq_d`, `dq_b`, `dq_c`, `dq_e`, `dq_f`, `dq_g`, `dq_h`, `dq_security`), 8 DOWNs, fingerprint identical apart from the 126 allowed residue lines (backup tables) |
| `dq_concurrency_two_sessions.sh` (real second session) | ALL ASSERTIONS PASSED — outbox workers disjoint (10 + 10 of 20), one of two 600-token reservations under a 1,000 cap, one run per slot, one notification per run under concurrent settlement |
| `dq-authz-check` | 104 passed |
| `dq-g-check` (schedule, outbox worker, states, wording) | 52 passed |
| `dq-f-check` (budget, timeout classifier, stall, engine vs fake database) | 29 passed |
| `dq-c-check`, `dq-e-check`, `dq-write-paths-check` | 11, 21, 164 passed |
| `tsc --noEmit` | clean |
| ESLint on every touched file (24 files) | clean (exit 0) |
| `npm run build` (Next.js 16.2.10, Turbopack) | compiled and type-checked, exit 0 |
| Load test, local, synthetic 1,833 → 18,330 cargo rows, 10 runs before H and 10 after | §10.1 |
| Linked dry-run (`--target linked`), load test against production | **not executed** (§12) |

### 10.1 Load test (local disposable database, synthetic data)

The production-side load test could not be run in this round (§12). The
same `dq_load_test.sql` (copies every listing nine times, drives the real
engine for 40 s, reports through the final exception, rolls back) ran ten
times on the disposable database seeded with 1,833 synthetic listings and
300 ports, once with the chain applied through G (fixed 1,000-row batches,
no H indexes) and ten times after H. Docker on a Windows laptop: the
absolute numbers are not production numbers; the before/after ratio on the
same hardware is the point.

| Measure (18,330 cargo rows, 10 runs each) | Before H — fixed 1,000-row batches | After H — self-sizing, persisted limit |
|---|---|---|
| Batch time p50 / p95 / max | 41.7 s / 80.0 s / 137.5 s (16 batches) | 2.85 s / 6.04 s / 9.21 s (133 batches) |
| First batch | 38.6 s (1,000 rows) | 3.34 s (250-row probe) |
| Throughput p50 (min – max) | 23 rows/s (7.3 – 27.0) | 30 rows/s (19.8 – 33.4) |
| Rows evaluated inside the 40 s budget, p50 | 2,000 — the budget is checked between batches, so two 40 s batches overshoot to 80 s+ | 1,269 in 13–14 batches, all inside the budget |
| Batches over the 8 s API timeout | 16 of 16 | 1 of 133 (9.2 s; the engine now halves the limit instead of failing the run) |
| Prepare (key snapshot) p50 / max | 1.67 s / 6.16 s | 1.19 s / 1.63 s |
| Open-by-severity / trigram search / health snapshot, p50 | 9 / 58 / 88 ms | 7 / 44 / 94 ms |

Raw outputs: `load-before-{1..10}.out`, `load-after-{1..10}.out` in the
session scratchpad; `load-report.py` computes the percentiles.

For reference, the 19 Sep production-side run (18,330 rows, 31 checks):
before H every 1,000-row batch took 9.9–16.5 s against an 8 s API timeout;
after H a 250-row probe took 1.35 s and self-sized batches 3.9–4.6 s.

## 11. Remaining risks

1. **Production dry-run not executed** — the chain is proven on a baseline
   rebuilt from the production schema dump, not on production data; run
   `scripts/migration-harness.sh --target linked …` (§12) before go.
2. **Eight ungated write paths** are on record in `lib/dq/policy.ts`
   (`policy: "ungated"`): Admin → Cargo / Vessel positions status changes
   (set a listing live without the queue's strict gate), Admin → Vessels,
   Admin → Ports, Admin → Commodities, member port creation from Post Cargo /
   Post Position (ports has no gate trigger), and signup's organisation
   insert. The scanner keeps them visible; gating them is follow-up work.
3. **Scheduling granularity** is the hourly cron: a 02:30 slot starts at the
   03:00 tick. Accurate to the slot, not to the minute; change the cron to
   `*/15 * * * *` if minute accuracy matters.
4. **H's index builds** take a SHARE lock on `ports` and `cargo_listings`
   for seconds (pre-create concurrently to avoid it).
5. **Migration files carry CRLF line endings** (Windows); function bodies
   deployed from them contain `\r`. Harmless, but the DOWN files restore
   production bodies byte-exact and must be regenerated if a production
   function changes before the release (`scratchpad/fix_downs3.py` logic).
6. The e2e coverage for roles and states is static + fake-database proof
   (`dq-authz-check`, `dq-g-check`); no browser run.

## 12. Applying to production

**Superseded by `docs/data-quality-production-readiness.md` (21 Sep 2026).**

What this section used to say is no longer correct and has been removed rather
than left to mislead. Three things changed:

- The release is **nine** migrations, not eight. `20260919180000_dq_i_restricted_paths.sql`
  closes the last of the ungated write paths.
- `scripts/release-check.sh` now takes **`--isolated`**, and that is the form
  to use while the Data Sync files are also pending. Without it, the check
  asks a different (stricter) question and correctly refuses.
- **Order matters.** This release goes first, before
  `supabase/releases/sync-20260920.txt`. Applying Data Sync first moves the
  newest applied version past these files and the CLI will then refuse to
  insert them at all.

The current procedure — the checklist with stop/go thresholds, the exact
commands, the migration and rollback order, the environment and flags, and the
residual risks — is in `docs/data-quality-production-readiness.md`. The single
command that runs everything runnable locally:

```
bash scripts/data-quality-validate.sh
```

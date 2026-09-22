# Data Sync hardening — 18 Sep 2026

Six phases answering the technical-lead review of 17 Sep 2026 ("no-go for
production migration or unattended DataSync processing"). Every phase is its
own migration with a down file in `supabase/rollback/`, a smoke test in
`supabase/tests/data_sync/`, and a no-network check script in `scripts/`.

Applied to the live database on 18 Sep 2026 (migrations 20260918100000 to
20260918160000, the last being a same-day fix). All four smoke tests pass
against the linked database through `supabase db query --linked`.

## Apply order

```
supabase migration list                # both columns must match except the six 20260918* rows
supabase db push --dry-run             # expect exactly: 20260918100000 … 20260918150000
supabase db push
# on staging, as the database owner:
psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase7_intake_smoke.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase8_batch_state_smoke.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase9_gate_smoke.sql
psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase10_fidelity_smoke.sql
# then deploy the application (vercel.json gained the WhatsApp sweep cron)
```

`supabase db query --linked --file <smoke test>` runs a smoke test through
the Management API without a database password; an assertion failure
surfaces as an error, success as no output (the file rolls itself back).

Deploy the database first, then the app: the new code calls the new
functions. Rolling back goes the other way round (old app, then the down
files, newest first).

Round 2 (20 Sep 2026, `docs/data-sync-hardening-2.md`) made every DOWN file
in `supabase/rollback/20260918_*` fully executable (verbatim function
bodies, exact index names), added the missing DOWN for 20260918160000, and
rehearsed the whole chain on a disposable database.

## Phase 0 — stop the bleeding (`20260918100000_sync_phase0_failed_status.sql`)

- **Cron auth.** `lib/cron/auth.ts` is the one rule: `Authorization: Bearer
  <CRON_SECRET>`, nothing else. The `x-vercel-cron` header only labels a run
  as cron or manual. All five cron routes and the DQ engine route use it; the
  three routes that used to be *open* when no secret was set are now closed
  in production. Vercel sends the bearer on its own schedules whenever the
  project has `CRON_SECRET` set (it does).
- **Email backlog (interim).** The IMAP fetch takes the *oldest* page and,
  when more mail waits, moves the checkpoint only to the newest message of
  that page (`pickPage`, stretching to include the cutoff second).
- **Checkpoint reads and writes throw** on a Supabase error instead of
  silently re-reading a week of mail.
- **Failed commits are recorded.** `mark_sync_batch_failed()` is called by the
  app in a second statement, because the in-function write rolled back with
  the raise (the batch looked untouched and the error text was lost).
- Check: `scripts/sync-phase0-check.ts` (141 assertions, includes the
  125-mail / limit-50 case).

## Phase 1 — durable intake (`20260918110000_sync_phase1_intake_durability.sql`)

- **Email by UID.** `sync_source_state` gains `uid_validity`, `last_uid`,
  `lease_owner`, `lease_until`. Runs read `last_uid+1:*` oldest first, page
  by page (up to 6 pages inside a 240 s budget), and move the checkpoint only
  after each page is staged (`set_email_checkpoint`, lease-holder only,
  forward only, epoch-aware). A changed UIDVALIDITY falls back to the date
  window once. An explicit "fetch since" on the card never moves the UID.
- **One run per inbox.** `claim_sync_run()` / `release_sync_run()` — the
  cron and the admin card both take the lease; a refused claim is reported
  as a *skipped* run, not a failure.
- **WhatsApp claims.** `whatsapp_message` gains status `processing`,
  `lease_token`, `lease_until`, `attempts`. `claim_whatsapp_messages()` uses
  `FOR UPDATE SKIP LOCKED`; every result write is guarded by the token; a
  lost lease discards its own batch; unprocessed claims are handed back
  (`release_whatsapp_messages`); a message claimed five times without a
  result is parked as failed.
- **Webhook** stores and answers: 503 with `Retry-After` when the upsert
  fails (Meta retries; the failed `job_runs` row is the alert), 200
  otherwise; unexpected errors are recorded, never silent. Its `after()`
  kick claims at most 8 messages with a 40 s budget.
- **Sweep cron** `/api/cron/whatsapp-sweep` every five minutes, 300 s
  budget, 100 messages — the durable path.
- Check: `scripts/sync-phase1-check.ts`; smoke: `phase7_intake_smoke.sql`.

## Phase 2 — batch state machine (`20260918120000_sync_phase2_batch_state_machine.sql`)

- Statuses: `draft | gated | gate_failed | committing | committed | partial |
  undone | failed` (`lib/sync/batch-status.ts` says what each allows).
  Existing drafts with audit rows become `partial`.
- `commit_sync_batch` locks the batch (`FOR UPDATE`), refuses committed /
  undone / gate_failed / committing, ends in `partial` when rows remain.
- One active audit row per staged row (`idx_commit_audit_active_row`);
  undone rows keep their audit with `undone_at` set.
- `trg_sync_batch_discard_guard` refuses to delete a batch with any audit
  row — undone batches are history and stay.
- `undo_sync_batch(id, force, actor)` and `undo_record_edits(…, force)`:
  pass 1 compares every live row with the audit's after-image
  (`fn_sync_row_conflicts`, volatile columns ignored) and returns the
  conflicts without touching anything; the console shows them and asks
  before calling again with force, which records each override on its
  audit row.
- Console: badges use plain labels ("ready", "partly committed"), Undo /
  Discard / Run gate follow the status, Review header included.
- Check: `scripts/sync-hardening-phase2-check.ts`; smoke:
  `phase8_batch_state_smoke.sql`.

## Phase 3 — the gate is mandatory (`20260918130000_sync_phase3_gate_mandatory.sql`)

- `sync_staged_row.gate_status / gate_rules_version / gate_payload_hash /
  gated_at`: `fn_dq_gate_batch` persists its verdict per row. A rule that
  fails to evaluate marks every row of that table `error` — fail closed.
- `commit_sync_batch` refuses (`GATE_STALE`) any row never gated, not `ok`,
  edited since the gate, or gated under older rules (`fn_dq_rules_version`,
  which moves on any rule or channel-mode change).
- `regate_sync_batch()` re-runs the gate, recounts and settles the status;
  the console offers **Run the gate** wherever it applies. Batches staged
  before this phase must be re-gated once before they commit.
- Database Preview edits (`edit_live_record`, `insert_live_record`,
  `bulk_update_live_records`) set `dq.channel = 'admin'`; the 17 Sep gate
  trigger now always enforces and fails closed for an explicit channel. The
  member-forms shadow switch is untouched.
- `20260918160000_sync_regate_reports_failure.sql` (same day): the first
  `regate_sync_batch` set `gate_failed` and then raised, which rolled the
  status write back — the phase-0 flaw again. It now returns `{ok:false,
  error}` after recording the status, and the action reads it.
- Rollout note: re-gating the six pre-existing draft batches through
  PostgREST timed out for the two workbook batches (1,569 and 1,315 rows;
  PostgREST's statement timeout is ~8 s). They were gated through
  `supabase db query --linked`, which has no such limit. One of them
  (UP-2026-08-07, 1,315 rows) has a vessel row with "104,282 cbft" in a
  numeric column; the gate could not evaluate four vessel rules on that
  table, so its vessel rows are `gate_status = 'error'` and stay refused
  until the cell is corrected in Review and the gate re-run — exactly the
  fail-closed behaviour this phase adds.
- Check: `scripts/sync-phase3-check.ts`; smoke: `phase9_gate_smoke.sql`.

## Phase 4 — data fidelity (`20260918140000_sync_phase4_fidelity.sql`)

- Unknown port codes flag the cargo row invalid at staging, naming the
  field (`lib/sync/ports-check.ts`); commit refuses (`PORT_UNKNOWN`) rather
  than silently dropping the code. Ports staged in the same workbook count as
  known.
- Vessels without an IMO: queue-write errors are read and thrown — staging
  fails loudly and the batch is marked failed; they are counted
  (`counts.vessels.queued`) and shown in the run summary.
- The previous-value baseline is scoped to the source
  (`sync_staged_row.source`, defaulted by trigger, backfilled) and read by
  `fn_sync_previous_payloads` — latest committed payload per key, one call.
- Check: `scripts/sync-phase4-check.ts`; smoke: `phase10_fidelity_smoke.sql`.

## Phase 5 — scale (`20260918150000_sync_phase5_scale.sql`)

- Existing rows are read by the compared columns only, not `*`.
- Vessel-queue refreshes go in one upsert.
- Trigram indexes on every Database Preview search column that exists and
  is text (`pg_trgm`, created conditionally).
- Workbook limits before parsing: 40 sheets, 50,000 rows (capped at read
  time), 200 columns, 2,000 characters per cell — refused with the sheet,
  row and column named.
- **Deferred: set-based commit.** The per-row loop stays. The audit needs a
  before-image per row and the cargo path has per-row port and auto-approve
  logic; a set-based rewrite is a separate piece of work with its own
  audit design. At today's volumes (batches in the hundreds) the loop is
  not the bottleneck.

## Phase 6 — interface truthfulness and access

- Discard only where the status allows; partial batches show "partly
  committed" and Undo; gate_failed batches say why and offer Run the gate.
- The Review figure tiles filter on the server (`listStaged` takes a
  classification), so the list matches the batch-wide count.
- History pages older batches from the server ("Show older batches").
- The Queues figure includes the ports queue.
- Run summaries separate "blocked by the gate", "failed parsing or missing
  a required field" and "vessels without IMO → Manual Review".
- Grouped review rows are keyboard-focusable (Tab, Enter, Space) with an
  accessible label.
- The QR-linked worker is labelled a local process; starting it on Vercel
  is refused with the command to run it elsewhere.
- Deferred: table-mode rows in Review are not clickable and were left as
  they are; tooltip text was not reworked beyond the row labels.

## Validation

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `eslint` on every touched file | 0 errors |
| `scripts/sync-phase0-check.ts` | 141 passed |
| `scripts/sync-phase1-check.ts` | 16 passed |
| `scripts/sync-hardening-phase2-check.ts` | 16 passed |
| `scripts/sync-phase3-check.ts` | 8 passed |
| `scripts/sync-phase4-check.ts` | 9 passed |
| pre-existing `data-sync-unit-check`, `sync-phase2-check`, `sync-whatsapp-check`, `schedule-check`, `route-alert-check` | all pass |

The four SQL smoke tests need a database and are for the owner to run on
staging after the push. `scripts/email-cron-check.ts` is an integration
script (needs a running server and env) and was not run.

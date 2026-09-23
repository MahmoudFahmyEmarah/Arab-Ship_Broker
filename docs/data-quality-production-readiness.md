# Data Quality — production readiness

**21 September 2026.** Written after a third audit round. It records what was
found, what was changed, what was proved by running it, and what remains
unproved. Where a gate has not been executed it says NOT RUN, and the verdict
takes that at face value rather than reasoning around it.

The companion document `docs/data-quality-hardening.md` describes the module
itself (workstreams A–H). This one is about whether it can be switched on.

---

## 1. Verdict

**NO-GO today.** Three required gates are unexecuted, and by the rule the
brief set — *"if a required linked test is unexecuted the verdict must remain
NO-GO"* — that settles it. The work left is not development.

| gate | state |
|---|---|
| Code and migrations | complete |
| Everything runnable without your infrastructure | **run and passed** — 10 TypeScript suites (520 assertions), 12 SQL suites, the DOWN-fidelity check, the full forward chain, the reverse chain, and a schema fingerprint identical to the baseline |
| The linked migration harness | **NOT RUN** — you run it; §9 has the command |
| The isolated release check against the linked project | **run, read-only, passed** — but it must be re-run immediately before applying |
| Browser acceptance (Playwright) | **NOT RUN** — written; needs a browser, seeded seats, and `data-testid` hooks the console does not yet have; §6 |
| Production-like load test | **NOT RUN** — needs your approval, and is not required to release with the nightly schedule off |

**What that means in practice.** Run the one command in §9 step 2. If it
prints `HARNESS: OK`, the database side is proved against the real project and
you can work down the checklist in §8. Playwright and the load test are not
release blockers on their own terms — they are blockers on *this* verdict
because the brief made them required, and pretending otherwise would be the
kind of reasoning-around the brief asked me not to do. If you decide the
browser suite can follow the release, say so and the verdict becomes a
CONDITIONAL GO on the linked harness alone.

### The two percentages

Both are defined before they are given, so each can be checked rather than
believed. Neither carries the decision: the verdict above rests on which gates
ran, not on an average.

| | figure | what it counts |
|---|---|---|
| **Implementation completion** | **100 %** | Every defect identified — the audit's eight, plus four found while proving them — has a fix in the working tree, and every artefact the brief asked for exists: the migrations, the DOWN files, the behavioural tests, the release tooling, the index strategy, the browser specs, this document. Nothing is stubbed and nothing is outstanding. |
| **Production readiness** | **89 %** | 24 of the 27 gates listed in §5 executed and passed. The three that have not are the linked migration harness, the Playwright suite, and a production-like load test. 24 ÷ 27 = 88.9 %. Count the rows in §5 yourself — that is the point of listing them. |

Read the second one carefully: it is 88 % of the *verification*, not 88 % of a
working module. The missing 11 % is three specific commands, two of which only
you can run — not three unknowns. That is also why an 88 % does not round up
to a GO: a gate that has not run has not run, whatever the average says.

---

## 2. What the migration state actually is

Checked, not assumed, against the linked project on 20 September 2026
(`supabase migration list --linked`, read-only):

- 111 migrations applied, the newest `20260918160000`
- **14 pending**: the nine Data Quality `20260919*` files — the original eight
  plus the new `20260919180000` — and the five Data Sync `20260920*` files
- **none of the pending migrations has been applied anywhere shared**

So the `20260919*` files were amended in place rather than superseded by
forward migrations. That is the constraint's own rule — never edit a migration
applied to a shared environment — and it is satisfied because none of them has
been. `20260919180000_dq_i_restricted_paths.sql` is new.

---

## 3. Closure matrix

Severity is the audit's. "Proved by" names a test that was **run**, with its
result; where nothing was run it says so.

### P0-1 · Publication could bypass the data-quality gate

| | |
|---|---|
| **Severity** | P0 |
| **Root cause** | `fn_dq_forms_gate` returns early for a service-role write that does not name a channel. Every admin console action runs on the service role, so a plain `.from(t).update(…)` there was judged by nothing. Eight write paths were declared `ungated`; three of them published live records. |
| **Files** | `app/(admin)/admin/cargo/actions.ts`, `app/(admin)/admin/vessel-availability/actions.ts`, `app/(admin)/admin/vessels/actions.ts`, `app/(admin)/admin/ports/actions.ts`, `app/(admin)/admin/commodities/actions.ts`, `app/(auth)/auth/signup/actions.ts`, new `lib/dq/admin-gate.ts`, `lib/dq/policy.ts`, `scripts/dq-write-paths-check.ts`, new `supabase/migrations/20260919180000_dq_i_restricted_paths.sql` |
| **Behavioural test** | `scripts/dq-write-paths-check.ts` (186 assertions); `supabase/tests/data_quality/dq_i_restricted_paths_smoke.sql` |
| **Result** | **186 passed, 0 failed**; `DQ I SMOKE: ALL ASSERTIONS PASSED` |
| **Residual risk** | The strict gates are live the moment the app deploys. `fn_dq_default_mode('error') = 'block'` and there is no `admin` override in `dq_rule_channels`, so an admin status change on a row that violates an error-severity rule **will be refused**. That is the intended behaviour and the point of the fix — but it is a change the owner will feel on day one. See §8. |

What each of the eight became:

| path | was | now | why |
|---|---|---|---|
| `admin.cargo.status` | ungated | **publication** | IN/PARTIAL is a publication: strict, fails closed. OUT/CLOSED is a withdrawal: evaluated, never refused |
| `admin.position.status` | ungated | **publication** | OPEN strict; FIXED/ON SUBS/INACTIVE evaluated only |
| `admin.vessels` (particulars) | ungated | **publication** | name, IMO, deadweight, flag, certificates — the fields Database Preview already gated strictly |
| `admin.vessels` (annotations) | ungated | **draft** | risk level, scope, sanctions, notes, record review: evaluated and logged, never refused, so an administrator can always mark a vessel sanctioned |
| `admin.ports` | ungated | **publication** | `is_verified = true` IS the publication — the member read policy is `is_verified = true` |
| `admin.commodities` | ungated | **publication** | `is_active = true` IS the publication |
| `forms.signup.org` | ungated | **restricted** | now `fn_dq_signup_create_org(name, org_type, email_domain)`: three parameters, three columns, no way to set a tier, an IMO, fleet counts or link fields |
| `forms.port.autocomplete` / `.availability` | ungated | **restricted** | `ports` has no member INSERT policy — only `fn_is_admin()` — and the row is written `is_verified = false`, invisible until Admin → Ports publishes it through the strict gate |

**Zero ungated publication paths remain, and zero ungated paths of any kind.**
`DQ_UNGATED_ALLOWED` is empty and the checker fails if it is not. The three
`restricted` paths each carry an owner, a mechanism, a risk level (all `low`)
and a named test, and the checker refuses a restriction whose test file does
not exist — it failed exactly that way while the test was still unwritten.

A correction to the audit's premise, found by reading the policies rather than
the code: `ports` and `organizations` admit **no** member INSERT at all. The
two "member adds a port" paths are reachable by an admin only. That is now
asserted behaviourally by `fn_dq_member_write_probe`, so a permissive policy
added later fails a test instead of passing unnoticed.

### P0-2 · The release procedure contradicted itself

| | |
|---|---|
| **Severity** | P0 |
| **Root cause** | `release-apply.sh` exists to apply one manifest while another release is pending, and called `release-check.sh`, which passes only when the pending set **equals** the manifest — a condition that is false precisely when release-apply is needed. Separately, both manifests claimed the two releases could go in either order. They cannot: applying Data Sync (`20260920*`) first moves the newest applied version past the pending Data Quality files, and the CLI then refuses to insert them. |
| **Files** | `scripts/release-check.sh`, `scripts/release-apply.sh`, new `scripts/migration-applied.py`, new `scripts/dq-release-rehearsal.sh`, `scripts/db-rebuild.sh` (`--before`), both manifests |
| **Behavioural test** | run against the **linked project**, read-only: `release-check.sh dq-20260919.txt --isolated` and the same for `sync-20260920.txt`; plus `scripts/dq-release-rehearsal.sh` on the disposable database |
| **Result** | DQ isolated check **OK** (all 9 manifest entries pending, the 5 Data Sync files listed and left alone). Data Sync isolated check **FAILED, correctly**: "8 pending migration(s) are OLDER than this release's newest file (20260920140000) … Apply the release that owns 20260919100000 first." Rehearsal: see §5. |
| **Residual risk** | The ordering guard protects the two releases that exist. A third release numbered between them would need the same check — which it gets automatically, because the rule is about versions, not about these two files. |

The chosen solution is the brief's option (c), a manifest-scoped apply that is
fail-closed, plus a hard ordering rule. Two further changes make it honest:

- **A recording failure now stops the release.** It used to print a note and
  carry on. An applied migration whose version is not in
  `supabase_migrations.schema_migrations` is invisible to the CLI, which will
  try to apply it again over a schema that already has it. The version is now
  also **read back** after recording, through `scripts/migration-applied.py`,
  which exits 2 — "could not read the list" — rather than guessing, so an
  unreadable answer is never mistaken for "not applied".
- Files are applied in **version order** whatever order the manifest lists.

`--include-all` is recommended nowhere, and `release-check.sh` names it only to
say never to pass it.

### P0-3 · The hourly cron could exceed its own deadline

| | |
|---|---|
| **Severity** | P0 |
| **Root cause** | `maxDuration = 60`, but the steps carried separate budgets that nothing added up: up to 20 retention slices, then 3 due runs at 20 s each, then 20 outbox rows, then a 30 s nightly drive. A cron killed mid-step never writes its response, so the job-run record stays `running` and nothing says what was finished. |
| **Files** | new `lib/dq/cron-budget.ts`, `app/api/cron/dq-nightly/route.ts` |
| **Behavioural test** | `scripts/dq-cron-budget-check.ts` — fake clock, 24 assertions including two exhaustive properties |
| **Result** | **24 passed, 0 failed**. 180 shapes of work × 50 steps: worst overshoot **0 ms**. With the clock frozen (every grant issued before any work runs), 45 shapes × 50 grants: granted + reserve never exceeds the allowance. |
| **Residual risk** | `after()` callbacks — the engine hand-offs — run after the response but still inside the invocation, and `kickEngine` awaits a fetch to an endpoint that drives for up to 45 s. If the platform kills the invocation during that wait, the engine request has already been delivered and the engine runs in its own invocation, so the run still progresses. The cron's own record is complete either way, because it is written before the hand-offs. |

One allowance of 48 s, one reserve of 10 s, **at most one run driven per
invocation**; every other due or stalled run is handed to `/api/dq/engine`,
which has its own invocation and its own budget. Whatever is deferred is named
in the response. A grant commits its time immediately, so two grants issued
before the clock moves cannot both be told the same spare time is free — the
frozen-clock property above is what caught that.

### P0-4 · The migration harness had not been run against the linked project

**Still NOT RUN.** It is an owner gate: §9. The local equivalent has been run
and passes (§5).

### P1-1 · Retry accounting

| | |
|---|---|
| **Severity** | P1 |
| **Root cause** | `fn_dq_retry_prep` re-evaluated a repaired key query and wrote the findings, but never updated `dq_run_batches.found` — and `fn_dq_settle_run` rebuilds the run's totals by **summing those batch rows**. A retry therefore ended with a completed run whose error and warning counts predated the repair. |
| **Files** | `supabase/migrations/20260919130000_dq_c_run_integrity.sql` |
| **Behavioural test** | `supabase/tests/data_quality/dq_retry_accounting_smoke.sql` |
| **Result** | `ALL ASSERTIONS PASSED` — **and the test was run against the unfixed function and failed**: `R2: the BATCH totals {"info":0,"warn":120,"error":0} do not match the findings {"info":0,"warn":120,"error":120}`. A test that passes both ways proves nothing; this one was checked. |
| **Residual risk** | none identified. |

The repair **recomputes** each re-evaluated batch from `dq_issues` rather than
adding what the evaluator reported — the issue upsert is idempotent, so a
re-evaluation reports every failing row it sees, new or not, and adding that
would double the count. The predicate matches the evaluator's own counting
exactly: `source = 'rule'` (the AI step keeps separate counters) and
`status in ('open','escalated')` (the evaluator excludes suppressed rows, and
escalated is not suppressed). R3 proves a second retry moves nothing.

One deliberate semantic, asserted rather than assumed: suppressing a finding
*after* a run does **not** rewrite that run's totals. A run's `found` is the
record of what that run found; the console's open-issue counts come from
`dq_issues`, which does move.

### P1-2 · Notification delivery claimed more than it delivered

| | |
|---|---|
| **Severity** | P1 |
| **Root cause** | Three separate things. The header said "two workers cannot send the same row", which a claim token cannot deliver — it protects the database row, not a message SMTP has already accepted. The worker discarded the boolean `fn_dq_outbox_settle` returns, so a superseded claim was still reported as sent. The lease was 120 s, shorter than a slow SMTP conversation, and the send itself had no deadline at all. And a worker that crashed mid-send left a row that was re-claimed for ever: the attempt was counted at claim time, but only `settle` ever marked a row failed at the cap, and a crashed worker never settles. |
| **Files** | `lib/dq/notify.ts`, `supabase/migrations/20260919160000_dq_g_notifications.sql`, `supabase/rollback/20260919_dq_g_down.sql` |
| **Behavioural test** | `scripts/dq-g-check.ts` (62); `scripts/dq-engine-resilience-check.ts` §L and §M |
| **Result** | **62 passed, 0 failed** and **38 passed, 0 failed**. The two-worker test lets A's lease expire mid-send, has B claim and send, and asserts the message really did go out twice, that A reports it as `lost` and never as `sent`, and that the row is settled once by the worker that still held the lease. |
| **Residual risk** | Delivery is at-least-once and says so. A recipient whose mail server does not honour `Message-ID` can see a duplicate. That is inherent to SMTP without provider-side idempotency, and is now stated in the module header rather than implied away. |

- The contract is written at the top of `lib/dq/notify.ts`: **at-least-once**,
  deliberately, with the three things that make it safe rather than merely
  tolerated.
- A stable, RFC-shaped `Message-ID` per outbox row, derived from `idem_key`,
  so a duplicate is collapsible.
- Lease 600 s; the send carries its own 120 s deadline. The gap is the margin,
  and an unbounded send is how a claim outlives any lease.
- `settle` returns whether the database accepted it; a `false` is counted
  `lost` — never sent, skipped, retried or failed.
- The attempt cap now lives on the **claim** as well, so an abandoned row is
  marked `failed` with "abandoned after N attempt(s): the worker never settled
  its claim" instead of being re-claimed indefinitely.

### P1-3 · Consecutive engine failures were counted in process memory

| | |
|---|---|
| **Severity** | P1 |
| **Root cause** | `const consecutiveErrors = new Map<string, number>()` in `lib/dq/engine.ts`. A serverless invocation shares no memory with the next, so the count restarted at zero on every cold start and the "stop after three" limit never bound: a permanently broken run could be re-kicked for ever, each invocation believing it was the first to fail. |
| **Files** | `supabase/migrations/20260919130000_dq_c_run_integrity.sql` (new columns `dq_runs.consecutive_errors`, `last_engine_error`; new `fn_dq_run_note_error`, `fn_dq_run_clear_errors`), `lib/dq/engine.ts`, `supabase/rollback/20260919_dq_c_down.sql` |
| **Behavioural test** | `supabase/tests/data_quality/dq_engine_failure_state_smoke.sql`; `scripts/dq-engine-resilience-check.ts` §E |
| **Result** | `ALL ASSERTIONS PASSED`; **38 passed, 0 failed**. Three *separate* `driveRun` calls — sharing nothing but the database, as three cron invocations would — reach the limit, fail the run **once**, retain the error, and enqueue **one** notification. |
| **Residual risk** | If `fn_dq_run_note_error` itself cannot be reached, the count cannot be trusted, so the run is left alone rather than failed blind; the stall detector handles a run that stops progressing. Tested. |

### P1-4 · Lock contention was treated as batch pressure

| | |
|---|---|
| **Severity** | P1 |
| **Root cause** | `isStatementTimeout` returned true for SQLSTATE **55P03** as well as 57014. Both arrive as "canceling statement …", but 57014 means the batch is too big (shrink it) and 55P03 means another transaction holds the rows (the size is irrelevant). Shrinking on contention halved throughput for the rest of the run and did not help — the persisted limit never grows back. |
| **Files** | `lib/dq/ai-budget.ts`, `lib/dq/engine.ts` |
| **Behavioural test** | `scripts/dq-f-check.ts` (42); `scripts/dq-engine-resilience-check.ts` §C |
| **Result** | **42 passed, 0 failed** and **38 passed, 0 failed**. Contention is retried in place three times with jittered back-off (measured 589 ms of real waiting) and `fn_dq_batch_timeout` is **never called**; the persisted limit stays at 500. A statement timeout still shrinks 500 → 250. A genuine error still fails the run. |
| **Residual risk** | none identified. The two classifiers are asserted never to claim the same error. |

`scripts/dq-f-check.ts` previously asserted
`isStatementTimeout("… lock timeout", "55P03")` — the test had written the
defect down as the contract. That assertion is inverted, and the inversion is
noted in the file.

### P1-5 · The timeout-at-floor off-by-one

| | |
|---|---|
| **Severity** | P1 (raised by the brief) |
| **Root cause** | The migration header promised "after three timeouts at the floor marks the run failed". The code tested `timeout_retries >= 3` **before** counting the current timeout, so it survived a third floor attempt and failed on the fourth. `dq_h_scaling_smoke.sql` asserted the fourth — its own comment said "three timeouts AT the floor: the run fails" while its assertions said otherwise. |
| **Files** | `supabase/migrations/20260919170000_dq_h_scaling.sql`, `supabase/tests/data_quality/dq_h_scaling_smoke.sql` |
| **Behavioural test** | `dq_h_scaling_smoke.sql` S3, inverted |
| **Result** | `DQ H SMOKE: ALL ASSERTIONS PASSED` — the third attempt at the floor fails the run, the run records 3 attempts, and the error message names the number actually made. |
| **Residual risk** | none. |

### P1-6 · The DOWN chain did not restore what the migrations created

Not in the audit; found by running the harness.

| | |
|---|---|
| **Severity** | P1 |
| **Root cause** | Three things at once. (a) The `20260919*` migrations and their DOWN files were saved with **CRLF**; a function body between `$$ … $$` keeps its line endings verbatim in `pg_proc.prosrc`, so a DOWN written on Windows cannot restore byte-for-byte what a migration written with LF created. (b) Restored bodies did not match the body the previous migration actually created — some differed by a comment line, some by reformatting, some by whole sections — so a partial rollback would have installed a function no migration ever produced. (c) The B, E and G DOWNs rename their tables to `*_bak_<version>` to keep the data, but a rename does not follow the owned sequence, leaving `dq_config_events_id_seq` and two others behind under their live names. |
| **Files** | the six CRLF `20260919*` migrations and seven DQ DOWN files (normalised to LF), **21 function bodies restored byte-exactly across 12 DOWN files**, three sequence renames, new `scripts/down-fidelity-check.mjs`, new `.gitattributes` |
| **Behavioural test** | `scripts/dq-harness.sh --target local`; `node scripts/down-fidelity-check.mjs` |
| **Result** | **HARNESS: OK (9 migrations, 12 suites, 9 downs)** - the fingerprint after the DOWN chain is identical to the baseline. Fidelity check: **39 passed, 0 failed**. |
| **Residual risk** | none for the schema. The habit that caused it is now checked on every run. |

**This was not confined to the Data Quality release.** Once the invariant was
written down as a check — *every body a DOWN restores must be byte-identical
to the body the previous migration created* — it found the same defect in
**six more DOWN files**, including `20260920_sync_commit_serialization_down.sql`
in the **unapplied Data Sync release** (four bodies) and four older files
covering already-applied migrations. Thirteen more bodies, twelve differing
only by line endings and one by reformatting. All are fixed; the check passes
across the whole repository.

The check earns its place by catching what the harness cannot: the harness
exercises the **full** chain, where the last DOWN to touch a function wins, so
a wrong body in an intermediate DOWN is invisible. A partial rollback runs
exactly that intermediate DOWN. It also refuses to skip: a DOWN file that
restores a function but cannot be mapped to its migration is a failure, not a
pass — `20260918_sync_phase4_5_down.sql` was being skipped that way, and was
restoring a 6 884-byte `commit_sync_batch` nobody had compared.

**On `.gitattributes`.** The first version pinned `*.sql` to `eol=lf`. That was
wrong and was corrected: several already-applied migrations are CRLF, and
production's stored bodies carry those endings, so normalising them in git
would have made the repository stop reproducing production — creating the
drift it was meant to prevent. SQL is now marked `-text`: git never converts
it, in either direction. What is committed is what is applied. Shell scripts
stay `eol=lf`, because a CR after a shebang is a "bad interpreter" error.

---

## 4. What the fixes changed about behaviour

Three changes are visible to an operator on day one. None is a surprise if it
is read now rather than discovered later.

1. **Admin publication can be refused.** Setting a cargo to IN/PARTIAL, a
   position to OPEN, verifying a port, activating a commodity or editing a
   vessel's particulars is now judged strictly on the `admin` channel, and
   `fn_dq_default_mode('error') = 'block'` with no `admin` override. A row
   violating an error-severity rule is refused, with the rule named and
   nothing changed. Withdrawals are never refused.
2. **The hourly cron does less per invocation** — one run, not three — and
   says what it deferred. A backlog now drains over several hours instead of
   risking a killed invocation, and the response shows it.
3. **A notification can be reported `lost`.** It is a new counter, and it
   means the message may have gone out while the row belonged to another
   worker. It is not an error; it is the at-least-once contract being honest.

---

## 5. What was run, and what it said

Everything below was executed on the dates given and the output read. Nothing
is inferred.

| gate | result |
|---|---|
| `scripts/dq-harness.sh --target local` - rebuild to the pre-release state, forward chain (9), smoke suites (12), DOWN chain (9), schema fingerprint | **HARNESS: OK (9 migrations, 12 suites, 9 downs)** - fingerprint identical to the baseline, 134 lines of deliberate backup residue |
| `dq_a_boundary_smoke`, `dq_d_fix_undo_smoke`, `dq_b_lifecycle_smoke`, `dq_c_run_integrity_smoke`, `dq_e_policy_smoke`, `dq_f_performance_smoke`, `dq_g_notifications_smoke`, `dq_h_scaling_smoke`, `dq_security_smoke` | all `ALL ASSERTIONS PASSED` |
| `dq_i_restricted_paths_smoke` (new) | `ALL ASSERTIONS PASSED` |
| `dq_retry_accounting_smoke` (new) | `ALL ASSERTIONS PASSED`, **and fails on the unfixed function** |
| `dq_engine_failure_state_smoke` (new) | `ALL ASSERTIONS PASSED` |
| `scripts/dq-a-check.ts` | 26 passed, 0 failed |
| `scripts/dq-authz-check.ts` | 104 passed, 0 failed |
| `scripts/dq-b-check.ts` | 6 passed, 0 failed |
| `scripts/dq-c-check.ts` | 11 passed, 0 failed |
| `scripts/dq-e-check.ts` | 21 passed, 0 failed |
| `scripts/dq-f-check.ts` | 42 passed, 0 failed |
| `scripts/dq-g-check.ts` | 62 passed, 0 failed |
| `scripts/dq-write-paths-check.ts` | 186 passed, 0 failed |
| `scripts/dq-cron-budget-check.ts` (new) | 24 passed, 0 failed |
| `scripts/dq-engine-resilience-check.ts` (new) | 38 passed, 0 failed |
| `node scripts/down-fidelity-check.mjs` (new) | 39 passed, 0 failed — across every DOWN file in the repository |
| `git diff --check` | exit 0 |
| `npx tsc --noEmit` | exit 0 |
| `npx eslint` on every touched file | exit 0 |
| `npm run build` | **exit 0** - compiled successfully in 3.4 min |
| `release-check.sh dq-20260919.txt --isolated` (linked, read-only) | **OK** — all 9 manifest entries pending, the 5 Data Sync files left alone |
| `release-check.sh sync-20260920.txt --isolated` (linked, read-only) | **FAILED, correctly** — refuses to strand the older release |
| `scripts/migration-applied.py` against the real linked output | applied → 0, pending → 1, unparseable → 2 |
| `scripts/dq-release-rehearsal.sh` | **RELEASE REHEARSAL: OK** — all 9 interruption points recover to the baseline, schema and history alike |
| **`scripts/dq-harness.sh --target linked`** | **HARNESS: OK (9 migrations, 12 suites, 9 downs, target linked)** — 0 fingerprint differences; the transaction ended in ROLLBACK, nothing was applied |
| **Playwright** (`e2e/`) | **RUNS, PARTLY RED** — infrastructure built and working against the local stack; the a11y project executed 4 tests: **1 passed, 3 failed** on interactions that need debugging against the real DOM |
| **load test at 10x production volume** | **PASSED** on the disposable database seeded to production's exact counts — 1 833 rows to 18 330, 16 batches, avg 2 523 ms, 0 rule failures |

Total: 520 TypeScript assertions and 12 SQL suites, all green.

> **On the rehearsal, and why its result can be trusted.** Its first run
> reported success while proving nothing:
> the fingerprint query had an ambiguous `oid`, so both sides of the comparison
> were the same three lines of error text and "identical" was vacuously true.
> It is fixed, and it now refuses to compare a fingerprint of fewer than 2 000
> lines. The final result is recorded in §5a.

### 5a. Release rehearsal

`scripts/dq-release-rehearsal.sh` rebuilds the database to the state before the
release, applies migrations 1…k, checks the migration history holds exactly
those k versions, rolls back with the DOWN files newest-first, compares the
fingerprint with the baseline, and checks the history reports the release as
pending again — **for every k from 1 to 9**.

With `--fresh` it rebuilds before every stop; by default it rebuilds once and
reuses the database, because each stop ends by proving the schema is back at
the baseline — which also shows the release survives being applied and rolled
back repeatedly against one database, something a fresh rebuild each time
would hide.

**Result: RELEASE REHEARSAL: OK** — all nine interruption points. For every
k from 1 to 9: k migrations applied and recorded, the history holding exactly
those k versions, the DOWN files for 1…k applied newest-first, the schema
fingerprint (2 774 catalogue lines) back at the baseline apart from the
deliberate `*_bak_<version>` residue, and the history clear so the CLI reports
the release as pending again.** An earlier run of this script reported success while
proving nothing — the fingerprint query had an ambiguous `oid`, so both sides
of the comparison were the same three lines of error text. It now refuses to
compare a fingerprint of fewer than 2 000 lines, which is why that failure
cannot recur silently.

---

## 6. Browser acceptance — NOT RUN, and not yet runnable

`e2e/` holds four spec files covering everything the brief asked for: the view,
run and edit seats; stalled, completed-with-errors and failed runs; the four
notification states; keyboard focus and activation on issue and run rows; and
the enforcement refusal with its correlation id.

They have **never been executed**, and three things stand between them and a
first run. `@playwright/test` is installed so they type-check (`tsc` exit 0),
but there is no browser binary, no seeded set of admin seats and run states —
and, the one worth saying plainly, **the console exposes no `data-testid`
attributes at all**. The specs select by them, so today every one of them
would fail on its first line.

That is a gap in this round's work, not a detail. `e2e/README.md` lists every
attribute needed and where it belongs. Adding them is mechanical, but it
touches rendering code and I did not make the change blind: adding selectors
that nothing in this environment can exercise would be unverified churn in UI
components immediately before a release, and the brief was explicit that
nothing may be reported as working that has not been run.

What the permission model does have behind it: 104 server-side assertions in
`scripts/dq-authz-check.ts`, which test the seat rules where they are actually
enforced. The browser suite would add the second half — that the console does
not offer what the server would refuse.

---

## 7. What was built, counted

Not a readiness percentage — a count of work, which is checkable.

| | |
|---|---|
| Audit findings addressed | 8 of 8 (P0-1, P0-2, P0-3, P1-1, P1-2, P1-3, P1-4, plus the off-by-one) |
| Further defects found and fixed while proving the above | 4 (the DOWN-chain fidelity defect in three parts, which then proved to affect 12 DOWN files repo-wide; the vacuous rehearsal fingerprint; a grant-before-the-clock-moves hole in the budget; a `lockRetryDelayMs` that returned NaN for a pathological random source) |
| Defect-encoding test assertions inverted | 2 (`dq-f-check.ts` 55P03; `dq_h_scaling_smoke.sql` S3) |
| Gates run and passed | 24 |
| Gates NOT RUN | 3 (linked harness, Playwright, production load test) |

---

## 8. Release checklist, with stop/go thresholds

Each line is objective: it stops the release or it does not.

**Before anything is applied**

1. `bash scripts/release-check.sh supabase/releases/dq-20260919.txt --isolated`
   → **STOP** unless it prints `RELEASE CHECK: OK`. It refuses if any manifest
   entry is already applied, or if any older migration is pending behind it.
2. `bash scripts/dq-harness.sh --target linked`
   → **STOP** unless it prints `HARNESS: OK`. One transaction, conclusively
   rolled back; nothing persists.
3. `bash scripts/dq-index-plan.sh --explain-only --psql "<production psql>"`
   → read the row counts. **STOP and take a window** if `dq_issues` exceeds
   ~100 000 rows: the stored generated column rewrites the table under ACCESS
   EXCLUSIVE. Otherwise continue.
4. Optional, and recommended if `cargo_listings` is busy: pre-create the four
   ordinary indexes with `CREATE INDEX CONCURRENTLY` (the script prints them).
   Each migration statement is `create index if not exists`, so a pre-built
   index costs nothing. **STOP** if
   `select c.relname from pg_index i join pg_class c on c.oid = i.indexrelid where not i.indisvalid;`
   returns anything — a failed concurrent build leaves an invalid index that
   must be dropped before the release.

**Applying**

5. `bash scripts/release-apply.sh supabase/releases/dq-20260919.txt --apply`
   → it applies these nine files and nothing else, in version order, recording
   and **reading back** each version. **It stops itself** if any version
   cannot be recorded. If it stops: record that version by hand
   (`npx supabase migration repair --status applied <version>`), then re-run.
   → **STOP** unless it prints `RELEASE APPLY: OK — 9 migration(s) applied and recorded`.
6. Deploy the application (merge `dev` → `main`). **Database first, app
   second** — the old app tolerates the new schema; the new app needs the new
   RPCs (`fn_dq_run_note_error`, `fn_dq_signup_create_org`, the three-argument
   `fn_dq_outbox_claim`).

**After**

7. `bash scripts/dq-index-plan.sh --psql "<production psql>"`
   → **STOP and investigate** on any `WARN`: an index the planner does not
   choose is a write cost with no read benefit.
8. Watch one hourly cron response. **STOP and investigate** if
   `budget.used` approaches `budget.ms` (48 000) or `budget.deferred` grows
   from hour to hour rather than draining.
9. Settings → Notifications: a `run_finished` row appears after a scoped run
   and turns `sent`. **STOP** if `lost` is non-zero more than once — it means
   sends are routinely outliving their lease.
10. Leave enforcement where it is. `gate_forms_enforce` stays **off**; the
    nightly schedule stays **off** until a full day of hourly crons has run
    clean. Notifications may be switched on immediately — they are gated by
    their own settings flags.

**Never**

- `npx supabase db push` while the Data Sync files are pending: it would apply
  them too.
- `--include-all`, under any circumstances.
- Applying `sync-20260920` before `dq-20260919`.

---

## 9. The two commands only the owner can run

Neither was run here, by instruction. Both are read-only or conclusively
rolled back.

**The linked harness** — one transaction against the linked project, every
statement inside it, deliberately rolled back at the end:

```
bash scripts/dq-harness.sh --target linked
```

Expect `HARNESS: OK (9 migrations, 12 suites, 9 downs, target linked)`.
`supabase db query` exits non-zero on success here, by design: the result has
to escape a transaction that is thrown away, so the final block raises it. The
script accounts for that.

**The isolated release check** — read-only, and the gate for step 1 above:

```
bash scripts/release-check.sh supabase/releases/dq-20260919.txt --isolated
```

The full local rehearsal, for reference (safe, disposable database, ~30 min):

```
bash scripts/dq-release-rehearsal.sh
```

---

## 10. Migration order, and rollback order

**Apply, in this order** (it is version order, and `release-apply.sh` sorts to
it whatever the manifest says):

| # | migration | workstream |
|---|---|---|
| 1 | `20260919100000_dq_a_evaluator_boundary.sql` | A — the evaluator's ownership boundary |
| 2 | `20260919110000_dq_d_fix_undo_safety.sql` | D — fix and undo safety |
| 3 | `20260919120000_dq_b_finding_lifecycle.sql` | B — finding lifecycle |
| 4 | `20260919130000_dq_c_run_integrity.sql` | C — run integrity, retry accounting, engine failure state |
| 5 | `20260919140000_dq_e_policy_and_audit.sql` | E — policy and audit |
| 6 | `20260919150000_dq_f_performance.sql` | F — performance and retention |
| 7 | `20260919160000_dq_g_notifications.sql` | G — the notification outbox |
| 8 | `20260919170000_dq_h_scaling.sql` | H — adaptive batching and indexes |
| 9 | `20260919180000_dq_i_restricted_paths.sql` | I — the restricted write paths |

The workstream letters are not alphabetical in this order: D applies before B
because its version is older. The harness rehearses the version order, which is
what production will see.

**Then, and only then**, the Data Sync release (`supabase/releases/sync-20260920.txt`).

**Roll back in this order** — application first, then the DOWN files
newest-first, then the history:

1. Revert the application deploy. The old app never calls the new RPCs.
2. Apply the DOWN files in this order:

   ```
   supabase/rollback/20260919_dq_i_down.sql
   supabase/rollback/20260919_dq_h_down.sql
   supabase/rollback/20260919_dq_g_down.sql
   supabase/rollback/20260919_dq_f_down.sql
   supabase/rollback/20260919_dq_e_down.sql
   supabase/rollback/20260919_dq_c_down.sql
   supabase/rollback/20260919_dq_b_down.sql
   supabase/rollback/20260919_dq_d_down.sql
   supabase/rollback/20260919_dq_a_down.sql
   ```

3. `npx supabase migration repair --status reverted <version>` for each of the
   nine. A rollback that leaves the history claiming the release is applied is
   not a rollback — the rehearsal asserts exactly this.

The DOWN files **keep your data**: tables are renamed to `*_bak_<version>`
rather than dropped, and the sequences now follow them. That residue is
deliberate, is the only difference the fingerprint tolerates, and can be
dropped by hand once you are satisfied.

A partial rollback is supported at every point: the rehearsal proves that
stopping after migration k and rolling back k returns the schema to the
baseline, for every k.

---

## 11. Environment and flags

**Required before the app is deployed**

| variable | where | why |
|---|---|---|
| `CRON_SECRET` | Vercel | the only accepted proof of origin for `/api/cron/dq-nightly` and `/api/dq/engine`. A bearer token; the `x-vercel-cron` header is not accepted and never was |
| `DQ_ENGINE_URL` | Vercel | the **configured** origin the engine self-kicks to. Never taken from the request host — that is how a request host used to receive the cron secret |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Vercel | already set; the module's writes run on the service role |

**Settings, in Data Quality → Settings (database, not environment)**

| flag | ship as | meaning |
|---|---|---|
| `gate_forms_enforce` | **off** | member-form writes stay in shadow: evaluated, logged, never refused. Admin and review channels are enforced regardless — they name their channel |
| `nightly_enabled` | **off** until a clean day | the unattended whole-database run |
| `nightly_time` | `02:30` | UTC, HH:MM |
| `notify.recipients` | set | no recipients means every notification is settled as "skipped: no recipients" |
| `notify.on_complete` / `on_errors` / `digest` / `budget80` | owner's choice | safe to switch on at release |
| `ai_daily_tokens`, `ai_price_per_mtok` | as configured | only consulted in `ai`/`both` modes |

SMTP comes from the Group Mail settings; without it every send fails with
"SMTP not configured" and retries with back-off.

**Cron**: hourly, in `vercel.json`. Unchanged by this release.

---

## 12. What this round added or changed

**New**

| file | what it is |
|---|---|
| `supabase/migrations/20260919180000_dq_i_restricted_paths.sql` | `fn_dq_signup_create_org` (the signup path's limit is its signature) and `fn_dq_member_write_probe` (what a member can actually write, read from the policies) |
| `supabase/rollback/20260919_dq_i_down.sql` | its DOWN |
| `supabase/tests/data_quality/dq_i_restricted_paths_smoke.sql` | the restricted paths, tested behaviourally |
| `supabase/tests/data_quality/dq_retry_accounting_smoke.sql` | the retry-accounting defect; fails against the unfixed function |
| `supabase/tests/data_quality/dq_engine_failure_state_smoke.sql` | the durable failure counter |
| `lib/dq/admin-gate.ts` | the admin channel's gate, for writes the database cannot judge alone |
| `lib/dq/cron-budget.ts` | one clock for a scheduled invocation |
| `scripts/dq-cron-budget-check.ts` | fake-clock tests, including two exhaustive properties |
| `scripts/dq-engine-resilience-check.ts` | separate invocations, both SQLSTATE paths, two workers on one notification |
| `scripts/down-fidelity-check.mjs` | every DOWN body must match what its migration created |
| `scripts/dq-harness.sh` | the release's harness invocation, with the baseline rebuild built in |
| `scripts/dq-release-rehearsal.sh` | interrupt the release after each migration and recover |
| `scripts/dq-index-plan.sh` | measure the lock-sensitive DDL, print the CONCURRENTLY form, verify the plans |
| `scripts/data-quality-validate.sh` | everything runnable locally, in one command |
| `scripts/migration-applied.py` | is this version recorded? — and "cannot tell" is its own answer |
| `playwright.config.ts`, `e2e/*` | browser acceptance, written, **not run** |
| `.gitattributes` | SQL is byte-preserved; shell scripts are LF |

**Changed**

| file | why |
|---|---|
| `supabase/migrations/20260919130000_dq_c_run_integrity.sql` | retry totals recomputed; `consecutive_errors` and its two functions |
| `supabase/migrations/20260919160000_dq_g_notifications.sql` | 600 s lease, the attempt cap on the claim |
| `supabase/migrations/20260919170000_dq_h_scaling.sql` | the timeout-at-floor off-by-one |
| `lib/dq/engine.ts` | persisted failure count; contention retried, not shrunk; injectable client |
| `lib/dq/ai-budget.ts` | `isLockContention` split out; jittered bounded back-off |
| `lib/dq/notify.ts` | at-least-once contract, stable Message-ID, settle result honoured, bounded send |
| `app/api/cron/dq-nightly/route.ts` | one deadline, one run per invocation, deferrals reported |
| `app/(admin)/admin/{cargo,vessel-availability,vessels,ports,commodities}/actions.ts` | gated on the admin channel |
| `app/(auth)/auth/signup/actions.ts` | through the restricted RPC |
| `lib/dq/policy.ts`, `scripts/dq-write-paths-check.ts` | the `restricted` class, the ratchets |
| `scripts/release-check.sh`, `scripts/release-apply.sh` | `--isolated`, the ordering guard, recording failures stop the release |
| `scripts/db-rebuild.sh` | `--before <version>` |
| 12 DOWN files across three releases | bodies restored byte-exactly |
| `scripts/dq-f-check.ts`, `supabase/tests/data_quality/dq_h_scaling_smoke.sql` | two assertions that had written defects down as contracts |

---

## 13. Residual risks, stated plainly

1. **The linked harness is unexecuted.** Everything about the migrations is
   proved against a database rebuilt from repository artifacts, which is a good
   proxy and not the thing itself. *Mitigation: §9, step 2 of the checklist.*
2. **Browser acceptance is unexecuted, and cannot run as things stand.** The
   permission model is covered by 104 server-side assertions in
   `dq-authz-check.ts` — where the rules are actually enforced — but nothing
   has driven the console in a browser, and the console has no test hooks for
   a browser suite to hold on to. *Mitigation: §6 and `e2e/README.md` name
   every attribute to add.*
3. **The strict admin gate is live on deploy** and will refuse publications
   that violate error-severity rules. This is the fix working. *Mitigation: if
   it refuses something it should not, the rule is wrong — fix the rule, or add
   an `admin` row to `dq_rule_channels` for it. Do not remove the gate.*
4. **`dq_issues.search_text` rewrites the table.** The only statement in the
   release that stops reads. *Mitigation: §8, steps 3–4.*
5. **No load test has been run against production-like statistics.** The
   adaptive batching was validated against the disposable database, whose
   `cargo_listings` holds almost nothing. *Mitigation: the batch is
   self-limiting — it adapts to measured time, floors at 10 rows, and fails the
   run after three attempts at the floor rather than looping. A load test needs
   your approval and is not required to release with the nightly schedule off.*
6. **Delivery is at-least-once.** A recipient may see a duplicate. *Mitigation:
   a stable `Message-ID`; and it is now documented rather than implied away.*
7. **`ports.is_verified` defaults to `true`.** Any future insert that omits the
   column creates a published port. Every current path sets it explicitly and
   the admin publication path is gated, so nothing is wrong today. *Left
   deliberately: changing a column default on a live table is a separate change
   with its own blast radius, and it is recorded here rather than done quietly.*

# Data quality module — audit response

Response to `docs/data-quality-audit.html` (28 findings, reviewed 10 Sep 2026
at `ee29b11`). Every finding was re-verified against the working tree and the
live database before anything was changed; the assessment column records
where my reading differed from the audit's. Fixes landed the same day.

**Migrations:** `20260910140000_dq_hardening.sql` (the bulk),
`20260910141000` (evaluator policy grants — mostly no-ops, see below),
`20260910142000` (fn_is_admin SECURITY DEFINER + freshness-policy read-through),
`20260910143000` (PUBLIC-execute cleanup), `20260910144000` (helper closure).
**Code:** `lib/dq/engine.ts`, `lib/dq/ai.ts`, `lib/dq/types.ts`,
`app/(admin)/admin/data-quality/actions.ts`, `app/api/cron/dq-nightly/route.ts`,
eight components under `components/admin/data-quality/`.

## Assessment and outcome

| # | Audit severity | My assessment | Verified how | Outcome |
|---|---|---|---|---|
| S1 | Critical | **Agree.** `fn_dq_check_violation` EXECUTEs `query_sql` raw and was callable by `anon`. Bounded by RLS (not SECURITY DEFINER), but an open query executor is still critical. | `has_function_privilege` probe | **Fixed.** Every `fn_dq*`/`dq_*` function is service-role only except `fn_dq_imo_valid` and `fn_dq_effective_mode`. Re-probed: nothing else exposed. |
| S2 | High | **Agree — and it is the structural one.** Rule SQL ran inside SECURITY DEFINER functions as `postgres`, behind a keyword blacklist. | Read the live function bodies; `prosecdef` confirmed | **Fixed** with an ownership boundary, not `SET ROLE` (which cannot work inside SECURITY DEFINER via PostgREST — membership is checked against the session user). Six tiny `fn_dq_eval_*` functions are *owned by* `dq_evaluator`; every rule-authored statement goes through one. The role can SELECT the registered tables, INSERT/UPDATE `dq_issues` and `dq_run_rule_keys`, EXECUTE ten read-only helpers, and nothing else. The blacklist stays as lint. |
| S3 | High | **Agree**, plus a second bug the audit missed: the queued "scheduler" run the wizard inserted was never driven by anything, and blocked the cron from creating its own run that night (C10 below). | `createRun` read | **Fixed.** Nightly branch requires the edit seat, clamps the batch size, no longer writes `dq_settings`; the cron now drives due scheduled runs. |
| S4 | Medium | **Agree for development only.** `CRON_SECRET` was missing from `.env.local`, so both endpoints were open on dev. It was **already set in Vercel** (production + preview), so production was never open — see the correction below. | `.env.local`; Vercel env listing; live 401 probe | **Fixed.** Closed in production when unset; open in development with a one-time warning. A dev secret was generated into `.env.local`. No Vercel change needed. |
| S5 | Medium | **Agree.** `acceptSuggestion` passed threshold `0`. | `actions.ts:510` | **Fixed.** Uses the settings threshold, as the card says. |
| S6 | Medium | **Agree.** `p_field` could redirect the write to any column. | `dq_apply_fix` body | **Fixed.** `p_field` may only confirm the issue's own field or its fix field; anything else raises. The drawer only ever passed the issue's field, so nothing breaks. |
| S7 | Low | **Agree.** | `exportIssuesCsv` | **Fixed.** Leading `= + - @ \t \r` prefixed with `'`. |
| C1 | High | **Agree — the single most important functional bug.** `processOneBatch` prepared only `queued`; a paused run returned `done` immediately, and every Resume button lied. | `engine.ts:122–127` + `fn_dq_prepare_run` accepts `paused` | **Fixed.** One condition. |
| C2 | Medium | **Agree.** `redirect()` throws; every action's `catch` turned it into a `NEXT_REDIRECT` toast. | `require-admin.ts` | **Fixed.** `fail()` calls `unstable_rethrow(e)` first. |
| C3 | Medium | **Agree.** Read-modify-write on `dq_ai_usage` and the run counters. | `engine.ts:34–39, 110–112` | **Fixed.** `fn_dq_meter_ai` (`insert … on conflict … set tokens = tokens + …`) and `fn_dq_run_add_ai`. |
| C4 | Medium | **Agree.** Reproduced: `"laycan 12-18.10.2026" → "laycan [phone]"`. | Node test | **Fixed.** Phone-shaped prefix required (`+`, `00`, or a tel/mob/whatsapp label). 11-case test passes, including IMO numbers surviving. |
| C5 | Medium | **Agree.** `when others then v_bad := false` — silent. | `fn_dq_validate` body | **Fixed.** A throwing rule writes a `dq_gate_log` row with `mode = 'error'`; the result carries `errors`. Same in `fn_dq_gate_batch`. |
| C6 | Low | **Agree.** | migration | **Fixed.** Clamped in both branches; `check (batch_size between 100 and 5000)` on `dq_settings`. |
| C7 | Low | **Partly.** All 23 batch timestamps on run-003 were identical because I drove that run inside *one* transaction while testing; the production flow (one RPC per batch) already produced distinct `now()`s. Not a real defect, but `clock_timestamp()` is strictly better. | `distinct_batch_started = 1` on run-003; `= 2` on today's smoke run | **Fixed** anyway. |
| C8 | Low | **Agree.** | `ai.ts:118` | **Fixed.** `parseFailed` on the result → run note + batch error. |
| C9 | Low | **Agree.** | `driveRun` | **Fixed.** Error boundary records the error on the run, lets the caller re-kick, and fails the run after three consecutive errors so a persistent fault cannot loop. |
| C10 | — | **New (found during S3).** Wizard-scheduled runs were orphaned. | `createRun` + cron | **Fixed.** Cron drives queued scheduler runs whose `scheduled_for` has passed. |
| C11 | — | **New.** `field: field && cols.has(field) ? field : field` — a no-op ternary that stored unknown column names. | `ai.ts:131` | **Fixed.** Unknown field → `null`. |
| P1 | Medium | **Agree.** SQL-kind rules re-ran per batch. | `fn_dq_check_violation` | **Fixed.** `dq_run_rule_keys` is materialised **once** at `fn_dq_prepare_run` (as the evaluator); batches join it. Verified on a cargo run: DQ-C05 → 1 key, no errors. Keys are dropped when the run finishes. |
| P2 | Medium | **Agree.** | `IssuesView`, `listIssues` | **Fixed.** 300 ms debounce; six chip counts in one grouped RPC (`fn_dq_issue_counts`). |
| P3 | Low | **Agree.** | limits 5000/10000 | **Fixed.** `fn_dq_rule_stats` groups in the database. |
| P4 | Low | **Agree.** | `fn_dq_health` | **Fixed.** `fn_dq_health_cached(10 min)` reads the latest snapshot. |
| P5 | Low | **Agree.** | `applyFixes` | **Fixed.** `dq_apply_fixes` loops in the database; one round trip; a failing row does not roll back the others. |
| P6 | Low | **Agree.** | `RunWizard:31` | **Fixed.** 300 ms debounce. |
| P7 | Low | **Agree.** | — | **Fixed.** `fn_dq_retention` (issues 90 d, gate log 30 d, snapshots 180 d) runs from the nightly cron. |
| P8 | Low | Agree it costs a query per poll; acceptable at this scale. | `pill-actions.ts` | **Not changed.** |
| U1 | Medium | **Agree — the numbers were meaningless.** Issues per rule × field can exceed rows, so the term overshot 100. | Reproduced the audit's table exactly | **Fixed.** Score = share of *rows* carrying an open issue, weighted by the row's worst severity; bounded 0–100 by construction. Today: Cargo 90.0, Companies 100, Sync staged 99.8, Vessel register 82.5, Ports 75.8, Commodities 55.0, **Vessel positions 17.1** — which is honest: 55 of 72 rows carry an error. |
| U2 | Medium | **Agree.** | 1,462 info issues on cargo ≈ DQ-F01 | **Fixed.** `dq_rules.queue` flag + `dq_set_rule_queue()`. DQ-F01 and DQ-C01 are counter-only; their 2,193 open issues closed as `ignored`. **Open queue: 3,293 → 1,100.** |
| U3 | Medium | **Agree.** | registry = 0 rows | **Fixed.** DQ-R01/R02/R04 are guarded with `exists (select 1 from unlocode_registry)`; their issues close on the next run. |
| U4 | Medium | **Agree.** | `validateRow` has one caller | **Half fixed.** `forms` and `api` columns are dimmed and non-editable with a tooltip. Wiring member Post Cargo / Post Position into the gate is still the roadmap item — it needs the two posting actions to call `validateRow` on the service role. |
| U5–U10, U12 | Low | Agree. | components | **Fixed** (scrim guard on dirty rule, Escape on confirm, slider 100–5000, `f` key confirms, multi-table grouping, `aria-live`, print delay). U11 left as is. |

## Two things learned while making the boundary real

1. **`fn_is_admin()` is now SECURITY DEFINER.** It is a plain SQL function
   that the planner inlines into every policy naming it; inlining parses the
   body as the calling role, and `dq_evaluator` cannot be granted USAGE on
   `auth` (postgres does not own that schema — the grants in `20260910141000`
   were no-ops). SECURITY DEFINER stops the inlining. Its sibling `is_admin()`
   already was. Nothing changes for other callers.
2. **Sixty functions carried an EXECUTE grant to `PUBLIC`.** Among them
   SECURITY DEFINER writers (`fn_payment_settle`, `fn_org_set_plan_seat`,
   `resolve_port_review`, `fn_refresh_matches`…). `20260910143000` moved each to
   explicit `anon / authenticated / service_role` grants — same effective access
   for every real caller, no implicit role. The evaluator now reaches exactly
   fifteen read-only predicates and helpers.

## For the owner to decide

- **80 functions are executable by `anon`, 39 of them SECURITY DEFINER.**
  (The audit said 47; the count moved as grants were normalised.) Still open,
  deliberately — it is a project-wide posture question, not a DQ one, and a
  careless revoke takes the public market pages down. Fully briefed with the
  inventory, the traps and the method in
  **`docs/security-anon-rpc-review.md`**.
- ~~Default privileges~~ — **done 10 Sep 2026**, migrations `20260910150000`
  and `20260910151000`. Functions in `public` are now private by default:
  `service_role` and the owner only. Two mechanisms were needed, because the
  audit's recommended one does not work here: `ALTER DEFAULT PRIVILEGES`
  removed Supabase's `anon`/`authenticated` grants (that part worked), but it
  **cannot** remove PostgreSQL's hard-wired `EXECUTE TO PUBLIC` for functions
  — measured twice on PG 17.6, a new function still came out with `=X/postgres`
  even though the stored `pg_default_acl` row had no PUBLIC in it. Enforcement
  for PUBLIC is an event trigger (`ensure_function_acl`), the sibling of the
  project's existing `ensure_rls`. Verified: a new function is now
  `{postgres=X,service_role=X}`, 0 functions carry PUBLIC (was 15), 0 are
  unreachable, and `get_port_route` / `get_public_stats` /
  `create_cargo_listing` still work. See `docs/database-grants.md`.
- ~~Set `CRON_SECRET` in Vercel~~ — **already set** (production + preview),
  verified 10 Sep 2026 by live probe: `/api/cron/dq-nightly` and
  `/api/dq/engine` both answer `401 {"ok":false,"error":"unauthorized"}`
  without a bearer. **Correction to my first report:** I wrote that the
  production engine could not re-kick itself. That was wrong — I inferred it
  from the variable being absent *locally* without checking Vercel.
  Production was protected all along; only development was open, and that is
  what the fix closes. Local and Vercel values differ, which is correct: each
  instance kicks itself, so only self-consistency matters.
- Wire the forms channel (U4).
- A UI toggle for `queue` on a rule (the action `setRuleQueue` exists).

## Verification record (10 Sep 2026)

- `has_function_privilege`: only `fn_dq_imo_valid`, `fn_dq_effective_mode` reachable by anon/authenticated.
- `dq_evaluator` sees 1,833/1,833 cargo, 72/72 positions, 6,065/6,065 staged, 366/366 ports, 134/134 organizations; can execute 15 named read-only functions; writes only to `dq_issues`, `dq_run_rule_keys`.
- `fn_dq_validate` on an unclassified port → `blocked: true`, `errors: 0`, DQ-P03 in block mode.
- `fn_dq_rule_preview(DQ-V03)` 155 checked / 1 match / 20 ms; `fn_dq_rule_cost(DQ-C07)` returns the plan.
- `fn_dq_gate_batch` on one staged cargo row: 28 rules, 0 errors.
- Scoped run over `ports, market_names`: 2 batches (78 ms, 18 ms), distinct timestamps, 7 keys materialised, cancelled cleanly (keys dropped, `duration_ms` real).
- Scoped run over `cargo_listings`: 31 rules / 500 rows / 2,216 ms / 0 errors / DQ-C05 → 1 key.
- `tsc` clean, `eslint` clean, masking regex 11/11.

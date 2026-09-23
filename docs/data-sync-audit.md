# Data Sync — audit & hardening (12 Sep 2026)

Scope: `/admin/data-sync` end to end — the six-tab UI, the server actions, the
staging/commit RPCs, the three intake channels (workbook, circulation inbox,
WhatsApp), the cron/webhook routes and the Supabase grants/RLS behind them.

Everything below was verified against the **live** project
(`rezfejaxbmdzkslrrefr`, ap-northeast-1). The DB changes shipped as
`supabase/migrations/20260910170000_data_sync_hardening.sql` and are already
applied (revokes + indexes + two columns; all additive/reversible).

## 1 · Design gaps closed

| Design element | What ships | Backing |
|---|---|---|
| Five-step run panel | `RunPanel` under the channels: Connect → Fetch → Classify → Stage → Gate, live log, tokens/cost, result figures, "Open in Review" | New `step` / `usage` SSE events from `runEmailSync` / `runEmailDryRun`; `processPendingWhatsapp` returns `steps` + `usage` |
| "Model · budget today" tile | `vendor · model · NN%`, USD spent, tokens of daily cap | Classifier calls are now metered into `dq_ai_usage` via `fn_dq_meter_ai` (same cap as Data quality: `dq_settings.ai_daily_tokens`, `ai_price_per_mtok`). Runs **refuse** to start when the cap is spent — the watermark stays put |
| "Failed jobs · 7 d" tile | count + last error | `job_runs` (email-sync / whatsapp-webhook) |
| Nightly inbox schedule | Connections → Schedule switch; Intake shows "Nightly 02:00 UTC · nightly" | `/api/cron/email-sync` (vercel.json `0 2 * * *`, CRON_SECRET / x-vercel-cron), `email_ingest_config.schedule_enabled` |
| Take file / Keep database | Per changed field in the row drawer | "Keep database" = `editStagedRow(row, {field: dbValue})` → field leaves the diff; "Take file" is the commit default |
| Duplicate pairs | Cards above the Review list, Merge / Not a duplicate | `findDuplicatePairs` (DQ-U03 same cargo two refs; DQ-U04 IMO row + IMO-less queue twin), `mergeStagedRows` (fills gaps, parks the duplicate as `unchanged` with a `merged into` flag), `restoreMergedRow` |
| Saved views (Database) | Chips per table, "Save current search" | browser-local (`localStorage`) — deliberately no server state |
| Keyboard triage | J/K move · X select · ↵ open (grouped view, no field focused) | client-side |

Still adapted rather than literal: the Queues "confidence ladder" remains an
*identity-completeness* ladder — no model confidence exists in the data.

## 2 · Security findings (fixed)

| # | Finding | Severity | Fix |
|---|---|---|---|
| S1 | `fn_contacts_overview(text,int)` — SECURITY DEFINER, **executable by `authenticated`**, no admin check, returns the whole contacts registry (emails, phones = the GDPR record) via `/rest/v1/rpc` | **Critical** | revoked from public/anon/authenticated; service_role only (its only caller is an admin action) |
| S2 | `fn_port_review_sweep()` — SECURITY DEFINER, **executable by `anon`**, no auth check: any visitor could scan every listing + staged row and write `port_review_queue` | High | revoked; service_role only |
| S3 | `resolve_port_review(...)` executable by anon/authenticated (guarded internally by `fn_is_admin()`, but only the service role calls it) | Low | revoked |
| S4 | `POST /api/upload/cargomap` gated by `requireAdmin()` with **no section/edit check** — a view-only sub-admin could stage batches | Medium | `requireAdmin({section:"datasync", edit:true})`, JSON 403 |
| S5 | `editStagedRow` accepted **any** payload key; `commit_sync_batch` would faithfully write it (e.g. `review_status`, `commodity_id`) | Medium | keys whitelisted to the editor's editable columns (`pickAllowedKeys`) |
| S6 | `testLlmCredential` / `getActiveModel` honour a stored `base_url` override — the **decrypted key goes in the headers to that URL** (SSRF / key exfiltration via a private host or plain http) | Medium | `isSafeBaseUrl`: https only, public host, no credentials — enforced on save and on test |
| S7 | Webhook verify-token compared with `!==` | Low | `secretEquals` (timing-safe) |
| S8 | No body caps on `/api/sync/email` (256 KB) and the webhook (1 MB) | Low | 413 before any work |

RLS was already correct on every Data Sync table (`fn_is_admin()` USING/CHECK);
confirmed live. The drift detector `fn_audit_function_grants()` now reports no
Data Sync RPC executable by anon/authenticated (asserted by the E2E script).

## 3 · Exception-handling findings (fixed)

| # | Finding | Fix |
|---|---|---|
| E1 | Every `email-sync` `job_runs` row in the DB was `failed: "sync ended without a result"` — the SSE `empty` event ("No new circulars") never settled the run, so every quiet run was logged as a failure (and would have lit the new tile) | `settleFor()` in `lib/sync/email/types.ts`: `empty` → succeeded/0 rows; used by the route and the cron |
| E2 | `requireAdmin()` denies by `redirect()`, which throws; every action's `catch` turned that into a toast reading **"NEXT_REDIRECT"** instead of bouncing | `fail()` helper with `unstable_rethrow` across `actions.ts` (45 sites) and `settings-actions.ts` (16); the four `count*` helpers re-throw too |
| E3 | A classifier failure inside `classifyAll` (budget, key, network) propagated as an unhandled throw from `runEmailSync` | caught per stage; emits `step: failed` + `error`; watermark untouched |
| E4 | Intake tiles: four parallel actions, one rejection hid all four | one `getIntakeHealth()`; failure shows placeholders + a note |
| E5 | `RunPanel` / drawer state derived from `Date.now()` in render (React purity lint) | interval-driven tick |

## 4 · Performance findings (fixed)

| # | Finding | Before | After |
|---|---|---|---|
| P1 | `stageBatch` step 2c ("what did this source say last time") seq-scanned `sync_staged_row` per 500-key chunk | **1,074 ms** (EXPLAIN ANALYZE, 6 k rows) | **4.2 ms** — `idx_staged_prev_committed (target_table, business_key, created_at desc) where committed` |
| P2 | No index for `sync_batch (status, created_at)` (Intake list, `latestReviewBatch`) and `(batch_id, classification) where not committed` (Review, commit loop) | seq scans | `idx_sync_batch_status_created`, `idx_staged_batch_class_open` |
| P3 | Advisor-flagged unindexed FKs on queue/audit tables in scope | — | 7 covering indexes |
| P4 | Intake health = 4 actions × `requireAdmin` (4 auth round trips); Queues badge = 4 more | 8 gated calls | 2 (`getIntakeHealth`, `countQueues`) |

Measured cycle (from Egypt → Tokyo, so network-heavy): 300 rows staged in
13.8 s (46 ms/row, ~12 round trips of fixed overhead), committed in 2.0 s,
undone in 0.45 s.

## 5 · Tests

| Script | What it proves | Result |
|---|---|---|
| `npx tsx scripts/data-sync-unit-check.ts` | guards, duplicate detection, `settleFor`, `UsageMeter`, splitter, webhook HMAC/parse, row presenters | **37 / 37** |
| `node --env-file=.env.local --import tsx scripts/data-sync-e2e-check.ts` | anon refused by 10 RPCs + 8 tables; service role intact; drift detector clean; stage → gate (28 rules) → UNMAPPED → queue → selective commit → live row → full commit → audit → re-stage = unchanged → changed field = one-column diff → undo → cascade discard → invalid row never commits; 300-row cycle; self-cleaning | **47 / 47** |
| `BASE=http://localhost:3000 node --env-file=.env.local --import tsx scripts/data-sync-http-check.ts` | upload/sync/cron/webhook/page refuse unauthenticated callers with API-shaped answers; body caps; cron bearer | **11 / 11** |
| `scripts/sync-phase2-check.ts`, `scripts/sync-phase6-graph.ts` | pre-existing pure pipeline checks | unchanged |
| `npx tsc --noEmit`, `npx eslint …`, `next build` | | clean (see session log) |

Optional: `DS_E2E_LLM=1` on the E2E script spends one real classifier call
and asserts the tokens land in `dq_ai_usage`.

## 6 · Not done / follow-ups

- The nightly schedule is **off** by default — arm it in Connections once the
  inbox password is stored.
- `fn_contacts_overview` is also read by `/admin/org-members`; it goes through
  the service role there, so nothing changed for that page.
- The LLM smoke in E2E is opt-in (real spend). Run it once after a key rotation.
- `.next/types/validator.ts` may lag a new route while `next dev` is running;
  `next build` regenerates it.

## 7 · Added 12 Sep 2026 (afternoon) — schedule cadence, audit trail, table alignment

**Recent batches alignment** — the numeric headers (NEW / UPD / BLOCKED) were
left-aligned while their cells were right-aligned: `.ds-table thead th` out-
specified the `.ds-table__num` modifier. One rule fixes it
(`.ds-table thead th.ds-table__num`).

**Inbox schedule** — Connections → Circulation inbox → Schedule: *every day /
every N days (2–30) / every week (weekday)* at an hour picked in the owner's own
time zone (stored as UTC + zone). One computation (`lib/sync/email/schedule.ts`,
23 unit checks) drives the editor preview, `setEmailSchedule()` (stores
`next_run_at`) and `/api/cron/email-sync`, which now wakes **hourly**
(`vercel.json`) and runs only when `next_run_at` has passed, then advances it on
the same rhythm (anchored to the run, so a late cron never restarts the cadence).
Verified live (`scripts/email-cron-check.ts`): future slot → skipped; past slot →
ran, `job_runs` settled, audit row by actor *cron*, `next_run_at` advanced.
Note: an hourly cron needs a Vercel plan that allows sub-daily schedules; on a
daily-only plan set it to the chosen hour and only "every day" resolves exactly.

**Audit trail** — `public.data_sync_audit` (append-only; admins read via RLS,
only the service role writes; 24-month retention via
`fn_data_sync_audit_prune`). Every mutating action and route writes one row
(`lib/admin/data-sync-audit.ts`): who (actor id + name, or cron/webhook), what
(dotted action + plain-English summary + detail JSON), when, target, batch, ok,
ip/user-agent (routes). 44 write sites: batch commit/undo/discard, staged-row
edit/merge/restore, database edit/insert/delete/bulk/undo, all queue
resolutions, uploads, inbox runs (button, dry run, cron), WhatsApp sweeps,
teasers, worker start/stop, every Connections change (keys, inbox, schedule,
watermark, WhatsApp). Read in **History → Audit trail**: filter by family /
actor / text / date, expand a row for the detail, export CSV.

**Operational finding from the live cron test:** the active Gemini key is out
of prepaid credit — the provider answered `429 … prepayment credits are
depleted` on every classification batch. The run failed cleanly (watermark
kept, logged in job_runs + audit), but no circular will classify until the key
is topped up or another key is made active in Connections.


# Data Quality Control module — implementation notes (9 Sep 2026)

Route: `/admin/data-quality` (section id `dataquality`; owner and the IT preset edit, the Broker preset views and runs).
Design source: `ASB Data Quality Module (standalone) - Copy.html` (Claude Design handoff), brief in `docs/data-quality-module-brief.md`.

## What was built

| Layer | Files |
|---|---|
| Schema, engine, gate, seed | `supabase/migrations/20260908130000_data_quality.sql` |
| Server library | `lib/dq/types.ts` (shared types), `lib/dq/engine.ts` (batch driver + AI step), `lib/dq/ai.ts` (LLM review, PII masking), `lib/dq/gate.ts` (validateRow helper for write paths), `lib/dq/registry.ts` (UN/LOCODE CSV import) |
| Routes | `app/api/dq/engine` (self-chaining batch runner), `app/api/cron/dq-nightly` (nightly run, stalled-run resume), `app/api/dq/registry` (registry upload / URL import) |
| Admin page | `app/(admin)/admin/data-quality/{page,actions}.ts(x)`, `components/admin/data-quality/*` (Overview, Rules + editor, Run wizard, Progress, Runs, Issues + drawer, AI suggestions, Gate, Ports registry, Settings), `components/admin/data-quality/DqRunPill.tsx` (topbar) |
| Wiring | `lib/admin/nav.ts`, `lib/admin/sections.ts` (presets: it edit, broker view), `components/admin/shell/icons.tsx` (Check glyph), `app/(admin)/layout.tsx` (badge = open errors, run pill), `vercel.json` (nightly cron 22:00 UTC) |

## Rule model

`dq_rules.checks` is a JSON array, one check per table:

```
{ table, field, violation_sql | query_sql, observed_sql?, expected_sql? | expected_text?,
  fix_sql?, fix_confidence?, fix_rationale?, message? }
```

* `violation_sql` — boolean SQL over alias `r` (the row). Used by batch audits **and** the gate (`fn_dq_validate`).
* `query_sql` (kind `sql`) — a full SELECT over the table; the engine runs it once per batch and pins the key set (never re-evaluated per row).
* `fix_sql` — SQL expression returning the replacement value; the batch stores `{field, value, before, after, rationale, confidence}` on the issue.
* Kind `ai` — `ai_prompt` is sent with the sampled rows in AI mode.
* Rules know their tables (`tables[]` is derived from the checks by trigger), so the wizard, the matrix and the gate select by table.

`dq_save_rule` validates every fragment (read-only keyword guard, `EXPLAIN` compile) and writes a `dq_rule_versions` snapshot. Channel modes (block / warn / audit) live in `dq_rule_channels`; the default follows severity.

Seeded: 51 rules — the ingestion validators (K01, K02, V01–V07, E01, C01–C03, P01, P02), post-commit checks (C05, A01, V06, C06), uniqueness (U01, U02), consistency (C07, C08, A02), the workbook decision tree (X01–X06, C04), the 8 Sep owner rulings (D01–D07), the ports registry (R01–R05), freshness (F01), the six matching gates as documented match-time rules (M01–M06, not batch-evaluated) and two AI checks (AI01, AI02). `fn_dq_seed_rules()` is idempotent ("Import workbook rules" re-adds missing codes only).

## Engine

* `fn_dq_prepare_run` resolves the scope (whole DB · tables · filter: live / open / last sync batch) and counts rows.
* `fn_dq_process_batch` takes the next key range (`batch_size` rows ordered by the table's key, text compare), runs every applicable rule as one `INSERT … SELECT … ON CONFLICT` into `dq_issues`, and marks open issues in the range that no longer fail as `fixed` ("No longer fails on re-check"). Per-rule errors are caught and recorded on the batch (partial failure), the run continues.
* `lib/dq/engine.ts` drives batches within a 45 s budget; `POST /api/dq/engine` re-kicks itself with `after()` until done. `createRun` runs the first batch synchronously then hands over. The progress screen polls `tickRun`, which re-kicks a chain that has been silent for 90 s. The nightly cron also resumes stalled runs.
* AI mode: `fn_dq_sample_rows` returns a random masked sample of the batch range (PII columns from `dq_tables.pii_columns` never leave the database; e-mails/phones are scrubbed again in TS). `runAiReview` sends the applicable rules + general heuristics and parses `{issues, suggested_rules}`. Issues land in `dq_issues` (source `ai`, confidence, evidence), fixes are grouped into a `dq_ai_suggestions` "fix" card, rules into "rule" cards. Tokens are metered per day in `dq_ai_usage`; the daily cap stops AI review (rules continue) with a note on the run.
* A full-database rule run today: 23 batches over 8,550 rows in ≈ 2.5 s of database time.

## Fixes and the gate

* `dq_apply_fix(issue, actor, name, value?, field?)`: reads the row, no-ops if already fixed outside the module, writes through `edit_live_record` for Data Sync tables (so Recent-edits undo covers it) or an equivalent audited update into `record_edit_audit` for the others, then validates the after-row with `fn_dq_validate(…, 'admin')` and **raises if a block rule fires** (transaction rolls back). `dq_undo_fix` reverses either path.
* `fn_dq_validate(table, row, channel, actor, actor_id, log)` evaluates declarative/classification checks on an unsaved row; block-mode hits are logged to `dq_gate_log`. `lib/dq/gate.ts#validateRow` wraps it for server code, `validateDraft` is the server action for forms. **Wiring the gate into the member create/update RPCs, Data Sync commit and the circular pipeline is a follow-up** — the other admin modules were deliberately left unchanged.

## Ports registry

`unlocode_registry` + `dq_port_exceptions`. Import a UNECE CSV (code-list parts, or a headed export) or a https URL from the Ports registry tab; default imports only the countries present in `ports`. `fn_dq_port_drift()` compares live: missing codes, name differences (alias), coordinates > 5 km (action at 25 km), function/status changes, trading ports without seaport function 1 and no approved exception, codes used in live listings but absent from `ports`. Rules R01–R04 read the registry when present and fall back to the one-off enrichment columns.

## Dictionary columns added

`commodities.official_code`, `regime`, `hazard_class (A/B/C)`, `is_mhb`, `is_marine_pollutant` — nullable, backfilled from `market_names` / `imsbc_category` / `is_grain` / `cargo_type`. No check constraints were added; DQ-D02/D06/D07 enforce the pairs through the gate and the audits.

## Environment

* `CRON_SECRET` protects `/api/dq/engine` and `/api/cron/dq-nightly` (same convention as the billing cron; unset = open in dev).
* `DQ_ENGINE_URL` (optional) overrides the base URL the engine uses to re-kick itself; otherwise the request host is used.
* The LLM credential is the Data Sync one (`llm_credential`, Vault). AI mode is disabled in the wizard when none is active.

## Follow-ups

1. Wire `validateRow` into `create_cargo_listing`, `create_vessel_availability`, `register_vessel`, the Data Sync commit and Manual Review sync (block → refuse, warn → store with the row).
2. Notification delivery (recipients and flags are stored in `dq_settings.notify`; no mailer call yet).
3. DQ-R03 (coordinates) fixes only latitude — add a two-field fix once multi-column fixes are supported.
4. Health-score weights: the design formula counts issues, not rows; F01 (7-day freshness, info) dominates old data — tune weights in Settings or lower F01 to audit-only.

## 9 Sep 2026 — dashboard review follow-ups

* `DQ-C09` "Commodity name is one specific commodity" (migration `20260909120000_dq_commodity_names.sql`) flags bundled or category-prefixed names on cargo, commodities and market names.
* The dictionary row "Grain (Corn/Maize)" was renamed to "Corn (Maize)" through the audited path (record_edit_audit; the 131 listings share undo group `aa12d7b5-a78b-42d1-8625-2c6aa9abec83`); the old name stays as a display alias and a GRAIN market-name row.
* Trigger functions `fn_cl_port_autofill` and `fn_submission_route` now pin `search_path = public`; before that, every audited RPC update on cargo_listings / vessel_availability failed with "relation ports does not exist".
* Portal route legs: `lib/portal/route-legs.ts` — name first, reference port for alternatives (estimated), area marker for countries and ranges; used by rows, cards, detail panel, map and calculators.

## 9 Sep 2026 — Data Sync review follow-ups

* Email sync: a run whose LLM classification batches fail no longer advances the watermark (`sync_source_state.email`); the card shows the start point ("Fetch mail since", default = last successful sync) and lets the admin move it back. Root cause of the 7 Sep loss: per-batch failures were swallowed, the run ended "empty" and the watermark jumped past the unread mail.
* Workbook re-upload: `classify()` now takes the source's previous committed payload; a cell the workbook did not change since its last sync never overwrites a database edit (reported as an info flag "kept the database value for …"). Normaliser drift (commodity packaging split, vessel type mapping, LOCODE aliases) still shows as an update once, then goes quiet.
* Manual Review flag field is a searchable combobox over all 192 registers (Gambia included) with spelling normalisation on blur.
* `DQ-U03` (duplicate cargo: commodity · load port · laycan ± 3 d · qty ± 10 %) and `DQ-U04` (duplicate vessel: name · built · DWT ± 2 %) added — migration `20260909130000_dq_duplicates.sql`.
* Manual Review sync now also revalidates `/` and `/dashboard/vessels`. The public Market Insights page is a frozen weekly edition (Monday cron), so a vessel synced today appears there after the next edition or a manual publish.

## 9 Sep 2026 — contacts registry (GDPR)

Migration `20260909140000_contacts_registry.sql`: `contacts` (person or company desk; e-mail, phone, organisation link, role, source, first/last seen, lawful basis, erased_at) and `contact_erasures`. Binding triggers on `cargo_listings` (broker, source_contact/company), `vessel_availability` (source_contact/company) and `vessel_review_queue` (source_email) create or update the contact on every write and store `*_contact_id` next to the text; the existing rows were backfilled. `fn_contact_parse_broker` splits workbook BROKER cells ("Niavigrains (Tasos) 2.5% here" → company Niavigrains, person Tasos). `gdpr_erase_contact` anonymises the record and scrubs listings, positions, the review queue, staged rows, edit-audit images and company desk fields, logging the counts. Admin surface: Companies → "Contacts registry · GDPR" (search, usage counts, Erase… with reason; Companies edit seat or owner). DQ-G01 flags any stored sender or broker without a registry link.

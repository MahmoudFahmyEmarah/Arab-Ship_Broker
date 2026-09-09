# Data quality module — owner's test and validation guide

Written 9 Sep 2026 from the live database. Every "expect" below quotes today's figures so you can tell a genuine result from a stale page. Where a figure is quoted, a SQL line follows that reproduces it in Supabase → SQL editor.

## Before you start

- Sign in as the owner (or an IT preset admin) and open **Admin → Data → Data quality**. The rail badge next to it shows the number of open **error** issues (381 today).
- Broker preset admins see the page read-only with a grey banner; they can run audits and read issues but every edit control is disabled.
- The active LLM key (Data Sync → Settings) is `google · gemini-3.5-flash`. AI mode in the run wizard is only offered when a key is active.

## 1 · Overview

**Do.** Open the tab. Hover a tile. Click the "Error" card. Click a post-commit check bar.

**Expect.**

| What | Today |
|---|---|
| Header line "Last run" | run-003 · 8,550 rows · 23 batches · 3,293 issues |
| Health tiles (score 0–100) | cargo listings 13.7 · vessel positions 0.0 · vessel register 3.8 · companies 100 · ports 11.8 · commodities 0.0 · market names 34.9 · sync staged rows 99.5 |
| "rules cover this table" under each tile | cargo 33 · positions 13 · vessels 16 · companies 0 · ports 8 · commodities 13 · market names 9 · staged rows 3 |
| Open issues by severity | error 381 · warn 1,279 · info 1,633 |
| Post-commit checks | positions without port or zone 53 · commodities to map 63 · live cargo without LOCODE 27 · vessels without IMO in review 47 · unknown flags 2 · sanctioned 0 |
| AI suggestions waiting | 0 rules · 0 fixes (no AI run yet) |

Clicking a tile opens Issues filtered to that table; clicking a severity card opens the matching saved view. Scores are low because the 7-day freshness rule (DQ-F01, info) fires on 1,495 old listings; see Settings → weights.

```sql
select * from jsonb_array_elements(public.fn_dq_health());
select severity, count(*) from dq_issues where status = 'open' group by 1;
```

## 2 · Rules

**Do.** Filter by table chip, category, severity, source. Search "flag". Open DQ-V03. Press "Test on 200 rows". Open the Live preview tab. Toggle a rule off and back on. Duplicate a rule. Create a new rule with a bad expression.

**Expect.**

- 55 rules in total: 35 declarative, 10 classification, 8 SQL, 2 AI-assisted; sources built-in 26 · admin 22 · workbook 7; severities error 28 · warn 23 · info 4. The "All" chip shows 55; "Cargo listings" shows 33.
- Rules are grouped under their first table; the chips filter the groups and the wizard uses the same table list.
- DQ-V03 test: "1 of 153 rows match" with the observed spelling and the normalised expected value; the cost hint shows an EXPLAIN node and cost.
- Toggling shows a toast with **Undo**; the Gate matrix dims a disabled rule immediately.
- Duplicate creates `DQ-V03-copy` as a disabled admin draft and opens it.
- A new rule whose violation expression does not compile is refused with "Check on <table> does not compile: …" and nothing is saved. A forbidden keyword (`update`, `delete`, `;`) is refused before EXPLAIN.
- Version history shows v1 "Seeded from built-in" for the seeded rules and one row per save afterwards; Restore creates a new version.

```sql
select kind, count(*) from dq_rules where deleted_at is null group by 1;
select version, note, changed_by_name, changed_at from dq_rule_versions v join dq_rules r on r.id = v.rule_id where r.code = 'DQ-V03' order by version desc;
```

## 3 · New run (wizard) and progress

**Do.** Choose "Selected tables" → Ports + Commodities. Step 2 shows only the rules that read those tables. Step 3 pick "Rule-based". Step 4 batch size 500, "Run now". Watch the progress screen; leave the page and come back through the topbar pill.

**Expect.**

- Step 1 shows live row counts (ports 345, commodities 131) and the batch count for the chosen size.
- Step 2 lists the rules for those tables only, each with its severity; match-time rules (DQ-M01…M06) say "not batch-evaluated"; AI rules say "AI mode only".
- Step 3 in AI mode shows the sample size (40 rows per batch), a token and cost estimate and the tokens left in today's budget (150,000).
- Progress: a run code `run-004`, batch squares turning green, errors/warnings/info counting up, "rows/s" and ETA. Pause holds the cursor; Resume continues; Cancel keeps the finished batches. Runs never lock member tables (every batch is a SELECT over a key range).
- A whole-database rule run completes in a few seconds of database time (run-003: 8,550 rows, 23 batches).
- The pill in the topbar shows "Run NN% · done/total batches" on every admin page while a run is live.

```sql
select code, status, tables, rows_done, batches_done, found, duration_ms from dq_runs order by created_at desc;
select n, table_name, rows, ms, status, error from dq_run_batches where run_id = (select id from dq_runs order by created_at desc limit 1) order by n;
```

## 4 · Runs

**Do.** Click run-003. Click "Compare" on the newest completed run.

**Expect.** History with status, scope, mode, started by ("Initial audit (build verification)" for run-003), duration, rows, issues as error / warn / info, AI cost. Compare shows the two runs side by side with deltas coloured red for more issues and green for fewer. Cancelled or failed runs show "Resume" (continues from the saved cursor).

## 5 · Issues and the issue drawer

**Do.** Open the "Blocks matching" view. Filter table = Vessel register. Press `j`/`k` to move, open a DQ-V01 issue, press "Apply fix", then "Undo" on the toast. Select several rows → "Mark false positive" with a reason. Export CSV.

**Expect.**

- Views: All 3,293 · Open 3,293 · Blocks matching 381 · Classification conflicts · AI-found only 0 · Fixed 0 (before your first fix).
- Largest rules today: DQ-F01 1,495 · DQ-C01 698 · DQ-C04 154 · DQ-X05 124 · DQ-R04 105 · DQ-V04 88.
- 23 open issues carry a ready fix (DQ-V01 prefix strip, DQ-D03 steel to break-bulk, DQ-X02 grain flag, DQ-C07 quantity swap, DQ-D05).
- Drawer: rule text, "why it fired", the live row snapshot with PII columns removed, before/after, rationale and confidence; Apply is disabled under the 0.85 threshold; "Edit manually" writes your own value.
- Apply fix writes through the audited edit RPC: a row appears in `record_edit_audit`, the issue turns "fixed", the toast offers Undo and Data Sync → Database Preview → Recent edits lists the same edit. A fix that would break a block rule is refused with "Fix refused by the gate: DQ-…".
- If the row was already corrected elsewhere, Apply closes the issue as "Already fixed outside the module" and writes nothing.
- False positive feeds the rule's FP rate (Rules → Statistics tab and the "noisy rules" line on Overview once above 10 %).

```sql
select rule_code, count(*) from dq_issues where status = 'open' group by 1 order by 2 desc limit 10;
select table_name, business_key, op, edited_at, undone from record_edit_audit order by edited_at desc limit 5;
```

## 6 · AI suggestions

**Do.** Run the wizard in "Both" mode on Commodities only (131 rows → 1 batch, about 40 sampled rows). Then open the tab.

**Expect.** After the run: proposed fixes grouped in one card per batch ("N AI-proposed fixes on Commodities (run-00X · batch 1)") with evidence lines, and proposed rules with a natural-language statement plus a SQL draft. "Accept as draft" creates `DQ-AI03…` disabled in Rules; "Approve N fixes" applies through the audited path; "Dismiss…" asks for a reason. The header shows tokens used today against the 150,000 cap. Issues found by AI appear in Issues with source "AI nn %" and an evidence quote. If the vendor refuses the call, the run note says "AI review failed on batch 1 (…)" and the rule-based part still completes.

```sql
select day, tokens, cost, calls from dq_ai_usage;
select kind, status, title, confidence, hits from dq_ai_suggestions order by created_at desc;
```

## 7 · Gate

**Do.** Open the matrix; click DQ-C02 on "Member forms" three times (block → warn → audit → block). Open the Gate log. Open Channel previews.

**Expect.**

- Matrix: 53 rules × 6 channels; SQL-kind rules show "audit" and cannot be changed (they run in batch audits only). Seeded overrides: DQ-V04 blocks on member forms; DQ-C05, A01, C04, D01, R01 warn on Data Sync commit and the circular pipeline; DQ-K02 warns on Manual Review sync. 11 overrides exist before you click anything.
- Every click shows a toast with Undo and writes `dq_rule_channels`.
- Gate log: 14 rows today, all channel "Data Sync commit", from the gate run over the UP-2026-08-07 draft batch (rules DQ-C07, DQ-K02, DQ-V03, DQ-D02). Each row names the rule, the staged row key, the actor and the message; "Tune" opens the rule.

```sql
select channel, rule_code, count(*) from dq_gate_log group by 1,2 order by 3 desc;
select r.code, c.channel, c.mode from dq_rule_channels c join dq_rules r on r.id = c.rule_id order by 1,2;
```

## 8 · Ports registry

**Do.** Read the stats. Open the drift report. Press "+ Exception", request one for a trading port without seaport function, then Approve it. Optionally press "Refresh from release…" and upload a UNECE code-list CSV.

**Expect.** Registry "none imported" until a release is loaded (the one-off enrichment on `ports` stands in). Drift report today: 76 items; the largest group is trading ports without seaport function 1 (DQ-R02 counts 73 open issues). After an exception is approved, DQ-R02 stops firing for that port on the next run and the drift row reads "OK". After a registry import the header shows the release, row and country counts, and DQ-R01/R03/R04 start comparing against the registry.

```sql
select count(*) from unlocode_registry;
select jsonb_array_length(public.fn_dq_port_drift());
select * from dq_port_exceptions;
```

## 9 · Settings

**Do.** Move the error weight from 3 to 1, save, return to Overview. Enable the nightly schedule.

**Expect.** Defaults: batch 1,000 · sample 40 · budget 150,000 tokens · price $3 per Mtok · threshold 0.85 · weights 3 / 1 / 0.2 · nightly off. Saving bumps the version (v2, v3 …) and the Overview scores change at once (the snapshot history keeps the old scores). The "Who may edit rules" table reflects the presets: owner and IT edit, Broker views and runs. The nightly cron fires at 22:00 UTC and creates a run with "Scheduler (nightly)" as actor.

```sql
select version, batch_size, ai_sample, ai_daily_tokens, weights, nightly_enabled from dq_settings;
```

## 10 · Data Sync is gated (verified 9 Sep 2026)

The same rules now run on every Data Sync path. Evidence from the live database:

| Path | Channel | What happens | Evidence |
|---|---|---|---|
| Workbook upload → staging | `sync` | every staged row is checked; block hits make the row **invalid** (commit never writes it) and are logged; warn hits are flags on the row with their DQ code | draft batch UP-2026-08-07: 48 rules applied, 14 rows blocked, 122 warnings; cargo invalid 8 → 12, vessels invalid 0 → 3 |
| Circulars / WhatsApp → staging | `pipeline` | same, with the pipeline modes (bulk-import rules advisory) | draft e-mail batch 2026-08-24: 24 rules, 0 blocked, 11 warnings |
| Review tab → edit a staged row | same as its batch | the row is re-checked after the edit; a fixed row rejoins the commit | `fn_dq_gate_batch(batch, channel, actor, row_id)` |
| Manual Review → Sync vessel | `review` | the vessel row is validated first; a block rule refuses the sync with the rule code | unknown flag "Gambiaa" → refused by DQ-V03; missing DWT/type → allowed with a warning (DQ-K02 is advisory on this channel); clean row → passes |
| Data quality → Apply fix | `admin` | the after-row is validated; a block rule rolls the fix back | `dq_apply_fix` |

Rules blocking in the upload batch today: DQ-C07 quantity range (5 rows), DQ-K02 required columns (5), DQ-V03 unknown flag (3), DQ-D02 regime vs cargo type (1). Most frequent warnings: DQ-U03 possible duplicate cargo (42), DQ-C04 unresolved commodity (39), DQ-C09 vague commodity name (12).

**How to see it yourself.** Upload the workbook again. In the Review tab the header counts include the blocked rows under "invalid"; each blocked row is red with a flag "DQ-… · message" and an info line "blocked by the data-quality gate on channel sync". Fix the cell in the row editor: the flag disappears and the row returns to "new"/"updated". Then open Data quality → Gate → Gate log: one row per block with your batch label as actor.

```sql
select f->>'rule' rule, f->>'mode' mode, count(*) from sync_staged_row s, jsonb_array_elements(s.flags) f
where s.batch_id = (select id from sync_batch where source='upload' order by created_at desc limit 1) and f ? 'rule' group by 1,2 order by 3 desc;
```

Not yet gated (unchanged on purpose): the member forms (Post Cargo, Post Position, Register Vessel) and the partner API. `validateDraft(table, row, 'forms')` is ready for them; wiring is a separate step.

## Undo paths

- A rule change: Rules → Version history → Restore.
- A channel mode: the toast's Undo, or click the cell again.
- A fix: the toast's Undo, or Data Sync → Database Preview → Recent edits → Undo.
- A run: Cancel keeps the finished batches; issues stay until the next run re-checks them.
- A gate block on a staged row: fix the cell (the row rejoins the commit) or set the rule to warn on that channel in the matrix.

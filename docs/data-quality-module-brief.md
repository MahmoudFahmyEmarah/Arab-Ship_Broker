# Arab ShipBroker — Data Quality Control module: design brief for Claude Design

Prepared 8 Sep 2026 from the codebase, the live database and `ArabShipBroker_MASTER_Cargo_Classification_Map_v2 (1).xlsx`.
Paste the section **"The prompt"** into Claude Design as-is; the sections before it are the evidence behind it.

---

## 1 · What already exists (the module must absorb, not duplicate)

### Rules enforced today at ingestion (Data Sync staging, `lib/sync/sheets.ts`, `lib/sync/diff.ts`)

| Code | Table | Rule | Severity |
|---|---|---|---|
| KEY | all synced tables | business key present (REF · IMO · LOCODE · name) | error |
| REQ | all | required columns present on a new row | error |
| DQ-V01 | vessels | strip "MV / M/V / MT" prefix from vessel names | auto-fix |
| DQ-V02 | vessels | "TBN / TBA / to be nominated" is a placeholder, not a vessel | error |
| DQ-V03 | vessels | flag must be a register in `flag_states`; known spellings normalised (`fn_normalize_flag`) | error |
| IMO-7 | vessels | IMO is 7 digits; check digit validated (`lib/sync/imo.ts`) | warn → mandatory on sync |
| VT | vessels | vessel type in enum | error |
| REF | cargo | REF matches `CM-/P-/OUT-nnn` | warn |
| ENUM | cargo | cargo type · status · priority · load terms in enum | error |
| ZONE | cargo · ports · positions | zone in the 14-zone enum | error |
| COMM | cargo | commission within 0–10 % | error |
| NUM | cargo | numeric columns parse as numbers | error |
| PORT | ports | port type in enum; LOCODE is 5 characters | error / warn |
| LOCODE | cargo | port names resolved to UN/LOCODE at staging (`fn_resolve_port_locode`); ranges/countries kept as text | warn |
| CLASS | cargo | commodity resolved through `market_names → commodities`; unknowns go to `commodity_review_queue` (UNMAPPED) | queue |

### Post-commit checks surfaced today (dashboard counters, views, queues)

| Check | Source | Today |
|---|---|---|
| Vessels with an unknown flag | `v_vessel_flag_issues` | 2 |
| Live cargo not resolved to a LOCODE | `cargo_listings.load_port_locode is null` | 27 |
| Open positions without port or zone (cannot match) | `vessel_availability` | 53 |
| Vessels without IMO (Manual Review) | `vessel_review_queue` pending | 26 |
| Commodities to map (Manual Review) | `commodity_review_queue` pending | 51 |
| Sanctioned / high-risk vessels | `vessels.is_sanctioned`, `risk_level` | 0 |
| Sync rows "Needs fixing" grouped by sheet (cargo · vessels · ports · companies · commodities) | `sync_staged_row.flags` | last batch 4 |

### Business rules already encoded elsewhere (candidates to promote to DQ rules)

- Matching gates (`lib/portal/matching.ts`): zone present; DWT within ±10 % (±20 % part cargo) of quantity and ≥ qty min; Dry Bulk needs Bulk Carrier / General Cargo; geared / grain-certified / DG-certified when the cargo requires it; max draft; open date within laycan −21/+14 days.
- Volume fit: `qty × stowage factor ≤ grain cbm` (`computeRequiredCbm`).
- Market freshness: live window 7 days, archive ladder by tier (`market_visibility`).
- Billing ledger invariants: issued invoices immutable, gapless numbering, VAT treatment per customer, EGS code on every line (ETA readiness in `lib/billing/eta.ts`).

### Reference registries the rules validate against

`ports` 278 (LOCODE, zone, coordinates) · `flag_states` 192 · `commodities` 131 · `market_names` 85 · `imsbc_codes` 258 · `grain_list` 12 · `css_categories` 12 · 14-zone enum · vessel type / cargo type / status / load terms enums.

### Reversibility already in place

Every direct edit through Data Sync → Database Preview is audited (`record_edit_audit`, before/after image) and undoable singly or as a bulk group; batch commits undo through `sync_commit_audit`. Fix actions in the new module must reuse this.

## 2 · Rules in the MASTER Cargo Classification Map v2 (workbook)

**Routing decision tree (README_ROUTING)**

1. **Q1 — Bulk or bagged?** Bagged / big-bag / palletised → **CSS** regime (break-bulk), *even bagged grain*. Bulk → Q2.
2. **Q2 — Grain or not?** Grain → **GRAIN** regime; requires grain stability booklet + Document of Authorization, **hard block if absent**. Not grain → **IMSBC** regime, Group A / B / C.
3. **Multi-parcel** — a listing may hold several parcels; each parcel is its own cargo line, classified through Q1 + Q2 with its own regime and code, and matched per parcel.
4. **Vague terms carry defaults** — "Fertilisers" → IMSBC Group C unless a hazardous fertiliser is specified; "Minerals" → IMSBC MINERAL CONCENTRATES (C) but may be Group A if a concentrate (verify); "Agri Products" → GRAIN unless processed (then SEED CAKE). Broker may narrow to override.
5. **Safety rulings** — CEMENT COPPER is a copper concentrate (Group A, liquefies), never construction cement. Meals / cakes / pellets / bran → IMSBC SEED CAKE (Group B, self-heating); "Wheat Bran" is not grain. Bagged salt / urea / cement / sugar → CSS unit load. Metal scrap in bulk → CSS-09; borings / shavings / turnings → IMSBC. GBFS and slag → CSS-10 (big bags).
6. **Open work** — new or confusing market names get one row added to the map; nothing else should be hand-classified.

**Tables in the workbook**

| Sheet | Rows | Content |
|---|---|---|
| 1_MARKET_NAME_RESOLVED | 85 | market name → regime + code + group/category + ruling note (IMSBC 46 · CSS 17 · GRAIN 15 · MULTI-PARCEL 7) |
| 2_GRAIN | 12 | grain names by family (cereal, pulse, oilseed) → GRAIN, requirement text |
| 3_IMSBC | 258 | Bulk Cargo Shipping Names with group (A 58 · B 67 · C 116 · A and B 17) and 25 UN numbers |
| 4_CSS_BREAKBULK | 12 | CSS-01…12 with annex, definition, securing trigger and market aliases |

These tables are already loaded as `market_names`, `grain_list`, `imsbc_codes`, `css_categories`; the decision tree and the rulings are only partly encoded (resolver + review queue). The module should hold them as explicit, editable rules.

## 2b · Owner's data-quality hints (review of 8 Sep 2026)

From the Captain's annotated review of the Manual Review → "Assign regime" screen:

1. **Market names are not official names.** Keep showing the market name brokers type and recognise (Option 2), but every row must be bound in the back end to the **official code** (IMSBC Bulk Cargo Shipping Name, Grain Code entry, or CSS category) and the database must key on the code. Forcing users to type official codes (Option 1) is rejected: it is slow and makes people feel foolish. Design consequence: the name is a display alias; the code is the identity; a row without a code is incomplete.
2. **Regime and cargo type must agree, and the system must refuse impossible pairs.** "Steel" as *Dry Bulk* must not be accepted: finished steel products are always break-bulk (CSS-06 coils, CSS-07 heavy metal products). The **iron-ore family** (raw material) can be dry bulk (IMSBC) but can never be in the **GRAIN** regime. Rules: CSS ⇒ cargo type Break Bulk; GRAIN or IMSBC ⇒ Dry Bulk; GRAIN only for names in the grain list and only in bulk; a processed product (meal, cake, pellets, bran) is never GRAIN. The dialog should derive cargo type from the regime instead of asking for it, and show a red conflict when an edited combination breaks a rule.
3. **IMSBC group semantics on screen:** A = may liquefy, B = chemical hazard, C = neither A nor B (lower risk). "Non-DG" is not an IMSBC group and should not be offered as one.
4. **Terminology: "Dangerous goods" is a container-world (IMDG) term.** In dry and break bulk the equivalent concepts are **IMSBC Group B (chemical hazard)**, **MHB — materials hazardous only in bulk**, and **marine pollutant**. Replace the single "Dangerous goods" checkbox with: hazard class (IMSBC group A / B / C), MHB flag, marine pollutant flag; keep UN number and IMO class only for packaged CSS cargo where IMDG applies. Vessel-side certificates follow the same split (IMSBC Group B fitness vs packaged DG fitness).
5. **Examples to encode as tests:** Rapeseed Meal Pellets → IMSBC SEED CAKE, Group B (processed oilseed, self-heating); Sulphur → IMSBC SULPHUR (group depends on form: crushed lump/coarse grain is Group B, formed solid is Group C, so the market name must resolve to the specific BCSN); Animal Feed → processed → IMSBC SEED CAKE unless declared whole grain; Cement Copper → COPPER CONCENTRATE Group A, never cement.

## 2c · Ports: the UN/LOCODE registry is the source of truth

- The official port and location registry is UNECE **UN/LOCODE** (five-character codes, two releases a year). The EC Interoperable Europe portal republishes it as an RDF export (JSON-LD, Turtle, N-Triples, RDF/XML) at `interoperable-europe.ec.europa.eu/collection/uncefact/solution/unlocode-codes-ports-and-other-locations`; UNECE also publishes CSV. Either can feed a scheduled import.
- The `ports` table already carries `unlocode_status` (AA/AI/AC adopted · RQ requested · NULL absent from the registry) and `unlocode_function` (function digits; leading `1` = seaport) from a one-off enrichment. The module should own this: **registry version** shown, **refresh per release**, and rules: every `ports` row must exist in the registry; a port used for load, discharge or open position must have function `1` (seaport) or an owner-approved exception with a reason; coordinates within a tolerance of the registry's; status must be adopted, else flagged; names shown to members are the registry names with our trade name as alias; a **drift report** lists rows whose registry entry changed or was removed.
- Ranges and countries in circulars ("Reni or Izmail", "Egypt Med") stay text by design and are reported as *unresolved* at info level, not as errors.

## 3b · One rule engine, three surfaces: the module is the gate for every write

The rules must not live only in the batch module. The same rule definitions are evaluated at three points:

| Surface | Where | Behaviour |
|---|---|---|
| **Form-time** | Post Cargo, Post Position, Register Vessel, My Vessels edit, admin Database Preview, Manual Review dialogs | A `validate` RPC returns issues as the user types or before submit; inline field messages; errors disable submit, warnings ask for confirmation |
| **Write-time gate** | the create/update RPCs (`create_cargo_listing`, `create_vessel_availability`, `create_vessel_position`, `register_vessel`, `resolve_cargo_classification`), Data Sync commit, Manual Review "Sync", the email/WhatsApp pipeline stage-and-commit | The database refuses rows that break a *block* rule and stores *warn* results with the row; no client can bypass it |
| **Batch audits** | the module's scheduled and on-demand runs | Finds what slipped through, what changed after entry, and what new rules catch in old data |

Each rule carries an **enforcement mode per channel** (block · warn · audit-only), so a rule can be strict on member forms and advisory on bulk import until the backlog is cleaned. Every rejection at the gate is logged (channel, rule, actor, payload hash) and appears in the module as the **Gate log**, so rule tuning is driven by what the gate actually blocks.

## 3 · Platform facts the design must respect

- Admin console on the ASB design system (navy rail, tokens in `app/design-tokens.css`); owner + sub-admin presets (`it` and a future `dq` preset edit; others view).
- Tables in scope and sizes today: `cargo_listings` 1,613 · `vessel_availability` 69 · `vessels` 153 · `organizations` 89 · `ports` 278 · `commodities` 131 · `market_names` 85 · `sync_staged_row` 6,065; the pipeline is sized for tens of thousands of cargoes a year, so runs must batch (500–1,000 rows per chunk, resumable, cancellable) and must never lock the tables members read.
- LLM: one active Vault-stored credential, vendor-agnostic (Anthropic · OpenAI-compatible · Google Gemini) through `getActiveModel()`. AI must never write to the database; it proposes, humans apply; every AI call is metered (tokens, cost) and logged to `job_runs`.
- PII (contact names, emails, phones) is firewalled at the database and must be masked before any text reaches the model.
- Every fix must be reversible through the existing audit tables.

## 4 · The prompt

> **Design a Data Quality Control module for the Arab ShipBroker admin console** at `/admin/data-quality`. Arab ShipBroker is a dry-cargo chartering marketplace (Gulf, Red Sea, Mediterranean, Black Sea) whose data enters through an AI pipeline that reads broker circulars, through a workbook import, and through member postings. The module lets the owner and the IT admin see, edit and run the data-quality rules that keep that data trustworthy, find issues in batches across a growing database, fix them reversibly, and use the platform's LLM both to discover issues the rules miss and to propose new rules and fixes.
>
> **Design system (mandatory).** ASB tokens: navy `#0D2545`, steel `#2C5F8A`, blue `#24486B`, baby blue `#E6F1FB`, tonnage blue `#7BB8F0`, canvas `#F5F7FA`, ink `#1A1A1A`, line `#DDE5F0`; status ramp green `#2E8B57`, amber `#A66A0C`, red `#A83A3A` with tinted backgrounds; Inter with tabular numerals; terminal cards (2 px ridge edge, 16 px radius, soft navy shadow); 10 px radius buttons and inputs; 11 px/600 uppercase badges. Navy left rail with white labels and a navy topbar. **No orange or yellow** anywhere; amber, red and green carry status meaning only. Density: 13 px body, 11 px labels. Tooltips explain every control (the product educates its users).
>
> **Domain vocabulary the screens must use correctly.** Tables: cargo listings, vessel positions (open port, open date, zone), vessel register (IMO, DWT, flag, gear, certificates), companies, ports (UN/LOCODE, zone), commodities, market names, IMSBC codes, grain list, CSS categories, sync staged rows. Rule categories: completeness, validity (enum, format, range), referential integrity (LOCODE, flag state, IMO, commodity), uniqueness, consistency (cross-field and cross-table), classification (cargo routing regime), business rule (matching gates), freshness, compliance (sanctions, IMO mandatory, ETA readiness). Severities: error (blocks the market), warn (visible but allowed), info.
>
> **Rule set to show as pre-loaded content (real).** Existing ingestion rules: business key present; required columns; DQ-V01 strip MV/MT prefix (auto-fix); DQ-V02 TBN placeholder is not a vessel; DQ-V03 flag must be a known register; IMO 7 digits with check digit, mandatory before a position goes live; vessel type, cargo type, status, priority, load terms, zone and port type in their enums; commission 0–10 %; numeric columns numeric; LOCODE 5 characters; port names resolved to a LOCODE; commodity resolved through the market-name map or queued. Existing post-commit checks: vessels with unknown flag (2 today), live cargo without a LOCODE (27), positions without port or zone which cannot match (53), vessels without IMO in review (26), commodities to map (51), sanctioned or high-risk vessels (0). Business rules to promote: DWT within ±10 % of cargo quantity (±20 % for part cargo); Dry Bulk requires bulk carrier or general cargo; geared, grain-certified and DG-certified vessels when the cargo demands it; draft limit; open date within laycan −21/+14 days; quantity × stowage factor ≤ grain cubic; live window 7 days.
>
> **Classification rules from the MASTER Cargo Classification Map v2 (real, must appear as editable rules).** Q1 bagged / big-bag / palletised → CSS regime, even bagged grain; bulk → Q2. Q2 grain → GRAIN regime, requiring grain stability booklet + Document of Authorization, hard block if absent; not grain → IMSBC Group A/B/C. Multi-parcel listings split into one classified line per parcel. Vague names carry defaults: Fertilisers → IMSBC C unless hazardous specified; Minerals → mineral concentrates C, verify Group A; Agri Products → GRAIN unless processed. Rulings: cement copper is a Group A copper concentrate, never cement; meals, cakes, pellets and bran are IMSBC SEED CAKE Group B, so "wheat bran" is not grain; bagged salt, urea, cement and sugar are CSS unit loads; bulk scrap is CSS-09 but borings and turnings are IMSBC; GBFS and slag are CSS-10. Reference tables behind them: 85 market names (IMSBC 46, CSS 17, GRAIN 15, multi-parcel 7), 12 grains, 258 IMSBC names (A 58, B 67, C 116, A and B 17; 25 with UN numbers), 12 CSS categories with aliases.
>
> **Owner's rules from the 8 Sep review (must be visible as rules and reflected in the dictionary dialog).** Market names are display aliases; the official code (IMSBC name, Grain Code entry or CSS category) is the identity and a row without a code is incomplete. Regime and cargo type must agree: CSS ⇒ Break Bulk, GRAIN or IMSBC ⇒ Dry Bulk; finished steel is always break-bulk (never Dry Bulk); the iron-ore family is IMSBC and never GRAIN; GRAIN only for bulk items on the grain list, never for meals, cakes, pellets or bran. The dictionary dialog derives cargo type from the regime and shows a red conflict when a pair is impossible. IMSBC groups are A (may liquefy), B (chemical hazard), C (neither); "Non-DG" is not a group. Replace the container-world "Dangerous goods" checkbox with hazard class (IMSBC A/B/C), an MHB flag (materials hazardous only in bulk) and a marine-pollutant flag; UN number and IMO class apply only to packaged CSS cargo.
>
> **Ports registry panel.** The UN/LOCODE registry (UNECE; RDF export via the EC Interoperable Europe portal, two releases a year) is the source of truth for ports. Show the registry version in use, a refresh action per release, and a drift report; rules: every port must exist in the registry, ports used for load, discharge or open position must carry seaport function 1 or an approved exception, coordinates within tolerance, status adopted; ranges and countries stay as text at info level.
>
> **The gate.** Design the module as the single validation service for every write into the database, not only a batch auditor. The same rule definitions run at form time (inline field messages on Post Cargo, Post Position, Register Vessel, admin edits and Manual Review dialogs), at write time inside the create/update RPCs and the Data Sync commit (errors refused by the database, warnings stored with the row), and in batch audits. Each rule has an enforcement mode per channel (block · warn · audit-only) shown as a channels × rules matrix, and a Gate log lists every rejection with channel, rule, actor and time so rules are tuned from real blocks. Include a component spec for the inline field message and the pre-submit summary members see, in the member portal's visual language.

> **Rule model (design the editor around it).** Code (DQ-C01…), name, description in plain language, category, severity, scope (one or more tables, columns), kind: *declarative* (not null, enum, regex, range, foreign key, unique, cross-field expression, registry lookup, classification regime), *SQL predicate* (shown and editable, with a "test on 200 rows" button and an explain-plan cost hint), or *AI-assisted* (a natural-language check the model evaluates on sampled rows). Auto-fix type (none, normalise, set from registry, reclassify, suggest only), enabled flag, owner, version history with diff, source (built-in, workbook, admin, AI-suggested), last-run statistics (rows checked, issues, false-positive rate). Rules know their tables, so choosing a table filters the rules and choosing a rule shows its tables.
>
> **Screens.**
> 1. **Overview** — a data-health score per table (0–100 from weighted open issues), a trend sparkline, open issues by severity, rules coverage per table, last run and next scheduled run, a "what changed since last run" strip, and the AI suggestions waiting for review. Every number links to the filtered Issues or Rules view.
> 2. **Rules** — filterable list (table, category, severity, source, enabled), grouped by table with counts; a rule drawer/editor with the fields above, a live preview of matching rows, version history, and a duplicate / disable / delete flow with confirmation; import of the workbook rules and export to JSON.
> 3. **New run** — a four-step wizard: scope (whole database, selected tables, a filter such as live cargo only or last sync batch), rules (all for the scope, or hand-picked; the wizard shows which rules apply to which table), mode (**rule-based**, **AI review**, or **both**; AI mode explains sampling: N rows per batch sent masked of PII with the applicable rules plus general data-quality heuristics, with a token and cost estimate and a hard cap), execution (batch size 500–1,000, run now or schedule nightly, notify on completion). Then a live progress screen: batches done of total, rows per second, issues found so far by severity, pause, resume, cancel, and a note that runs never lock member-facing tables.
> 4. **Runs** — history with status (queued, running, paused, completed, failed, cancelled), scope, mode, duration, rows, issues, cost for AI runs, who started it, and a compare-with-previous view.
> 5. **Issues** — the triage table: rule, table, row (with the human key: REF, IMO, LOCODE, name), field, observed value, expected or suggested value, severity, source (rule or AI with confidence and evidence snippet), status (open, fixed, ignored, false positive, escalated), assignee, age. Filters and saved views ("blocks matching", "classification conflicts", "AI-found only"). Bulk actions: apply suggested fix, ignore with reason, mark false positive (feeds the rule's statistics), export.
> 6. **Issue detail drawer** — the full row snapshot, the rule text, why it fired, the AI fix recommendation with rationale and confidence, a before/after preview of the fix, related issues on the same row, apply (reversible, audited) or edit manually, and a link to the owning admin page (cargo, vessel, port, commodity).
> 7. **AI suggestions** — two queues: *proposed rules* (natural-language rule, the generated declarative or SQL form, evidence rows, estimated hit count; accept as draft, edit, or dismiss with reason) and *proposed fixes* awaiting approval in bulk. Make the human-in-the-loop explicit: the model never writes; every acceptance is an admin action recorded in the audit log.
> 8. **Gate** — the channels × rules enforcement matrix (member forms, admin edits, Data Sync commit, Manual Review sync, circular pipeline, partner API), the Gate log of rejections with filters, and a preview of the inline messages each channel shows.
> 9. **Ports registry** — registry version, last refresh, drift report, exceptions list with reasons.
> 10. **Settings** — default batch size, AI sampling size and daily token budget, the active model (read-only here; managed in Data Sync), schedules, health-score weights per severity, notification recipients, and which admin preset may edit rules versus only view and run.
>
> **Interaction and states.** Rules and issues are dense tables with sticky headers and keyboard triage (j/k, f fix, i ignore). Show empty, loading, running, partial-failure and "AI budget exhausted" states. Long runs survive navigation (a persistent progress pill in the topbar). Every destructive action confirms and names the undo path. Respect reduced motion. Provide a print/export of the overview for the weekly ops review. Phone layout (390 px) for read-only monitoring: overview, issues list, run progress.
>
> **Deliverables.** Desktop 1440, laptop 1280 and phone 390 layouts; component specs for rule card, rule editor, run wizard step, progress panel, issue row, issue drawer, AI suggestion card, health-score tile; empty/stale/error states; and a data-binding table listing, for every widget, its source: existing table or view (`sync_staged_row.flags`, `commodity_review_queue`, `vessel_review_queue`, `v_vessel_flag_issues`, `record_edit_audit`, `job_runs`), the proposed tables (`dq_rules`, `dq_rule_versions`, `dq_rule_channels`, `dq_runs`, `dq_run_batches`, `dq_issues`, `dq_gate_log`, `dq_ai_suggestions`, `unlocode_registry`), or the LLM call.

---

## 5 · Implementation notes for after the design

- Tables: `dq_rules` (+ `dq_rule_versions`), `dq_runs`, `dq_run_batches` (cursor by primary key range, resumable), `dq_issues` (unique on rule + table + row + field while open), `dq_ai_suggestions`. RLS: admin read; writes via service role; every applied fix goes through the existing audited edit RPCs so Recent-edits undo covers it.
- Engine: a Vercel cron or on-demand route processes one batch per invocation (60 s budget) and re-schedules itself until done; declarative rules compile to SQL predicates; SQL rules run `EXPLAIN` before saving; AI rules sample with `TABLESAMPLE` and mask PII columns before prompting.
- Seed `dq_rules` from the ingestion validators, the workbook decision tree and the 8 Sep hints so the module launches with the real rule set, then let admins edit.
- Gate: one `fn_dq_validate(table, row jsonb, channel)` SECURITY DEFINER function evaluates the declarative and SQL rules and returns issues; the create/update RPCs and the Data Sync commit call it and raise on *block* issues; forms call it for inline feedback. `dq_rule_channels` holds the enforcement mode per rule per channel; `dq_gate_log` records rejections.
- Ports: import UN/LOCODE per release into `unlocode_registry` (code, name, function, status, coordinates, subdivision, release); compare with `ports` for the drift report; keep our trade names as aliases.
- Dictionary: `commodities` rows must carry the official code; add check constraints for regime ⇒ cargo type and rename `is_dg` semantics to hazard class + MHB + marine pollutant (migration with backfill from IMSBC group).

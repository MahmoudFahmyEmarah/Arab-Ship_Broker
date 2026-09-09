# Data Sync module — owner's test and validation guide

Written 9 Sep 2026 from the live database. Every "expect" quotes today's figures; the SQL after it reproduces them in Supabase → SQL editor. Data Sync is owner-only (`/admin/data-sync`); the rail badge shows the Manual Review backlog (63 commodities + 45 vessels = 108 today).

## The model in one paragraph

Three sources (workbook upload, the circulation inbox, WhatsApp) feed one pipeline: parse → stage into a **batch** (`sync_batch` + `sync_staged_row`) → diff against the live row → data-quality gate → Review → commit. Commit writes the live tables with a before-image, so every batch can be undone; direct edits in Database Preview are audited the same way. Vessels without an IMO and commodities without a regime do not enter the live tables through the batch: they queue for Manual Review.

Today: 12 batches (upload 2 committed · 2 draft; e-mail 3 committed · 2 draft · 1 undone; WhatsApp 2 draft), 6,065 staged rows of which 807 committed and 119 carry a data-quality flag.

```sql
select source, status, count(*) from sync_batch group by 1,2 order by 1,2;
select count(*) rows, count(*) filter (where committed) committed from sync_staged_row;
```

## 1 · Sync Workspace — workbook upload

**Do.** Drop `ArabShipBroker_UNIFIED_CargoMap_07Sep2026.xlsx` (or choose it). Watch the batch appear under Recent batches, then open it.

**Expect.** A new draft batch labelled `UP-<date>`; the header shows to insert / to update / invalid / flagged per sheet. The last upload of that file (UP-2026-09-07, committed) staged cargo 220 new · 267 updated · 586 unchanged · 10 invalid; ports 19 · 35 · 243 · 2; vessels 0 · 78 · 19 · 0; companies and commodities unchanged. Uploading the same file again now stages far fewer updates: cells the workbook did not change since its last committed sync keep the database value (info flag "kept the database value for …"), so edits made in Manual Review or Preview are no longer flagged as changes. Normaliser drift (packaging split, vessel type mapping, alias LOCODEs) shows once and then goes quiet.

Vessels without an IMO in the workbook go to Manual Review instead of the batch; commodities the resolver cannot bind go to the commodity queue.

```sql
select label, status, file_name, counts from sync_batch where source = 'upload' order by created_at desc limit 3;
select sheet, classification, count(*) from sync_staged_row where batch_id = (select id from sync_batch where source='upload' order by created_at desc limit 1) group by 1,2 order by 1,2;
```

## 2 · Sync Workspace — circulation inbox

**Do.** Read the "Fetch mail since" line, press **Sync now**, watch the log. Then move the date back a week and sync again.

**Expect.**

- Inbox `circ@arabshipbroker.com` on `server353-4.web-hosting.com`, folder INBOX, enabled. The start point defaults to the last **successful** sync (2026-09-07 04:18 UTC today).
- The log lists the connection, "fetching mail newer than …", the classification batches with the active model (`google · gemini-3.5-flash`), then "staging N cargo + M vessel record(s)" and a green "✓ staged" line; the batch opens in Review as `Email sync · <timestamp>`.
- If the model refuses a batch (quota, key, "payment required"), the log shows "✗ batch skipped — …" and the run ends with a red line saying the start point was **not** advanced; the same mail is fetched again next time. The three failed jobs on 7 Sep are visible in `job_runs`.
- Moving the date back re-reads older mail once without moving the stored watermark; a run that finds nothing with a chosen date leaves the watermark alone.
- "Test with a pasted email" classifies without touching the inbox and creates a batch labelled from the paste.

```sql
select source, last_sync_at from sync_source_state;
select started_at, status, rows, left(error, 80), meta from job_runs where job = 'email-sync' order by started_at desc limit 5;
```

## 3 · Sync Workspace — WhatsApp intake

**Do.** Open **Inbox**, then **Process pending**. Send a test message to the linked number or use "Test with a pasted message".

**Expect.** Provider `unofficial` (QR-linked worker), enabled. 10 messages in the inbox today, all already staged into `WA · <sender> · <time>` draft batches; 14 acknowledgement replies in the outbox. Each message becomes its own batch with `WA-` provisional refs; the auto-acknowledgement quotes a redacted extract.

```sql
select status, count(*) from whatsapp_message group by 1;
select label, status, counts from sync_batch where source = 'whatsapp' order by created_at desc;
```

## 4 · Review

**Do.** Open a draft batch. Switch sheets (Cargo listings, Ports, Vessels, Companies, Commodities). Toggle "Changes only". Click the pencil on a row, change a cell, save. Select rows and **Commit selected**; then **Sync all**; then **Undo** on the batch.

**Expect.**

- Row colours: green NEW, amber UPD, grey unchanged, red ERR. Cells that changed show old → new on hover; each flag names the field.
- Data-quality flags read `DQ-XXX · message`: red ones block (the row is invalid and never commits) with an info line "blocked by the data-quality gate on channel sync"; amber ones travel with the row. On the UP-2026-08-07 draft batch the gate blocked 14 rows (quantity range DQ-C07, required columns DQ-K02, unknown flag DQ-V03, regime vs cargo type DQ-D02) and warned on 122 (possible duplicates DQ-U03, unresolved commodity DQ-C04, vague names DQ-C09).
- Editing a blocked row re-runs the gate on that row: fix the cell and it returns to NEW/UPD.
- "Commit Ports first": cargo references ports, so a child sheet cannot be committed before its parent; **Sync all** commits in dependency order.
- Commit returns inserted / updated / skipped; the batch turns COMMITTED, rows grey out, and the live tables change immediately (check Database Preview). Invalid rows are skipped and stay in the batch.
- Undo restores every touched row from its before-image and marks the batch UNDONE (the 1 Sep e-mail batch is in that state today).

```sql
select f->>'rule', f->>'mode', count(*) from sync_staged_row s, jsonb_array_elements(s.flags) f where s.batch_id = '<batch id>' and f ? 'rule' group by 1,2 order by 3 desc;
select * from sync_commit_audit where batch_id = '<batch id>' order by committed_at desc limit 5;
```

## 5 · Database Preview

**Do.** Pick "Cargo listings", search a REF, edit a field, then open **Recent edits** and undo it. Select several rows → "Edit a field on all" → undo the group. Pick "Market names" → Add record. Delete a record and undo the delete.

**Expect.** Ten tables: cargo listings, ports, vessels, flag states, companies, commodities, market names, grain list, IMSBC codes, CSS categories. Server-side paging and search. Every edit, add and delete lands in `record_edit_audit` (134 rows today, 1 undone) and is reversible from Recent edits, singly or as a bulk group; caps of 500 rows per bulk action. Cargo listings cannot be added here (posting flows create them). Errors come back in plain words ("other records still reference this one", "already exists").

The trigger fix of 9 Sep matters here: before it, every audited update on cargo listings or positions failed with "relation ports does not exist".

```sql
select table_name, business_key, op, edited_at, undone from record_edit_audit order by edited_at desc limit 10;
```

## 6 · Manual Review

**Do.** Commodities: pick a pending name → **Assign regime** → choose regime and official code → save. Vessels: open a pending vessel, paste an Equasis block into the paste box, check the flag field, press **Sync with IMO**; then try one with no IMO via "Sync without IMO (temporary)"; then one with an invented flag.

**Expect.**

- Queues today: commodities 63 pending (1 mapped, 17 ignored); vessels 45 pending of which 42 have no IMO hint (23 synced, 32 ignored).
- The commodity dialog derives cargo type from the regime (CSS ⇒ Break Bulk, GRAIN / IMSBC ⇒ Dry Bulk) and writes the dictionary through `resolve_commodity_review`.
- The vessel drawer pre-fills from the circular and from the Equasis paste (IMO, GT, NRT, built, flag, registered owner, commercial manager, ISM manager). The flag field is a searchable box over all 192 registers; "Marshal Islands" normalises when you leave the field.
- **Sync with IMO** writes the register row, links the three companies, posts the OPEN position and refreshes the dashboard, the vessels board and the public home. A synced vessel appears on the dashboard tonnage list at once (VICTORIA, synced 9 Sep 04:30, is there today); Market Insights only picks it up in the next weekly edition.
- **Sync without IMO** works but keeps `resolved_with_imo = false` and the vessel stays flagged in Data quality (DQ-V04 / DQ-V06).
- An invented flag is refused: "Refused by the data-quality gate: DQ-V03 — …". Missing DWT or type only warns on this channel.

```sql
select status, count(*) from commodity_review_queue group by 1;
select status, count(*) filter (where imo_hint is null) no_imo, count(*) from vessel_review_queue group by 1;
select q.vessel_name, q.resolved_at, a.status, a.review_status, a.open_date from vessel_review_queue q join vessel_availability a on a.id = q.resolved_availability_id order by q.resolved_at desc limit 5;
```

## 7 · Settings

**Do.** Add a second LLM key and activate it, then switch back. Press "Test connection" on the inbox. Open the WhatsApp card.

**Expect.** LLM keys: one entry today (Google · gemini-3.5-flash, active); exactly one key can be active; the browser only ever sees a four-character hint, the secret sits in Supabase Vault. Inbox: host, port, user, folder, search query; the password is stored in Vault and "Test connection" logs in over IMAP. The email watermark line shows the last successful sync and a reset control. WhatsApp: provider, QR pairing status for the worker, acknowledgement template.

```sql
select label, vendor, model, is_active, key_hint from llm_credential;
select imap_host, username, folder, is_enabled from email_ingest_config;
```

## 8 · Integration with Data quality

| Path | Channel | Result |
|---|---|---|
| Workbook staging | sync | block → row invalid, logged; warn → flag on the row |
| Circulars / WhatsApp staging | pipeline | same with advisory modes for bulk import |
| Review row edit | as its batch | re-checked |
| Manual Review sync | review | block refuses the sync; DQ-K02 advisory |
| Committed rows | batch audits | every run re-checks them; issues that no longer fail close themselves |

Contacts: every broker cell and sender is bound to the contacts registry on write (Companies → Contacts registry · GDPR).

## Undo paths

- A committed batch: Recent batches → Undo (or Review → Undo batch).
- A Preview edit, add, delete or bulk action: Recent edits → Undo.
- A Manual Review sync: undo the position from Recent edits is not available; ignore the queue row and correct the vessel in Vessel intel.
- A wrong watermark: Settings → inbox → reset, or pick the date on the Sync Workspace card.

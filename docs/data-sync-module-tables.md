# Data Sync module — every table it touches, and what the data is

Report compiled 31 Jul 2026 for the business owner. Two groups: the **live
data tables** you review and edit in the module, and the **pipeline tables**
the module uses internally to make every change reversible.

---

## 1 · Live data tables — Database Preview tab

All nine are browsable, searchable and editable in **Data Sync → Database
Preview**. Every action is audited with a full before-image and undoable from
**Recent edits** (single rows or whole bulk groups in one click).

| Table | Key | What the data is | Add | Edit | Delete |
|---|---|---|---|---|---|
| `cargo_listings` | REF | Every cargo posting on the platform — commodity, lane, laycan, rates, terms, review status. Fed by the workbook 01_CARGO sheet, email/WhatsApp ingestion, and the Post Cargo pages. | — (posting flows only) | ✓ | ✓ |
| `vessels` | IMO | The vessel register — identity, DWT, build year, flag, gear, ownership, risk/sanctions flags. Fed by 02_VESSELS, the Post Vessel page, and Q88 imports. | ✓ | ✓ | ✓ |
| `organizations` | Name | The 88-firm company registry — type, country, fleet counts, desk contacts, IMO company number. Fed by 03_COMPANY_REGISTRY. | ✓ | ✓ | ✓ |
| `ports` | LOCODE | Curated port list (278 active) — name, country, zone, coordinates, UN/LOCODE registry status/function (read-only columns), active/verified flags. Fed by 04_PORTS. | ✓ | ✓ | ✓ |
| `commodities` | Canonical name | The commodity dictionary — cargo type, IMSBC category, grain/DG flags, stowage factor, display aliases (searchable names). | ✓ | ✓ | ✓ |
| `market_names` | Market name | **Lookup.** The trade-name resolver: what brokers call a cargo → which official regime and code it maps to (GRAIN / IMSBC / CSS / UNMAPPED). First stop of every commodity classification. | ✓ | ✓ | ✓ |
| `grain_list` | Grain name | **Lookup.** Grain Code commodities (wheat, corn, barley…) with family and Grain Code requirement notes. | ✓ | ✓ | ✓ |
| `imsbc_codes` | BCSN | **Lookup.** The 258 IMSBC Bulk Cargo Shipping Names with hazard group (A liquefies / B chemical / C inert, combinations allowed), UN number, notes. | ✓ | ✓ | ✓ |
| `css_categories` | Code | **Lookup.** The 12 CSS break-bulk categories (CSS-01…12) — definition, securing trigger, market aliases (comma-separated in the editor). | ✓ | ✓ | ✓ |

Notes on behaviour:

- **Lookup edits are live immediately** — an added market name shows up in the
  Broker Ledger commodity picker on the next keystroke (verified end-to-end).
- **Business keys are fixed** — the key column (REF / IMO / LOCODE / name) is
  read-only on existing rows; to re-key a record, add the new one and retire
  the old.
- **Deletes are FK-protected** — a port or commodity still referenced by
  listings cannot be deleted; the module tells you to retire it instead
  (set *Active* to no), which is how the two dedupe rounds were done.
- **Cargo listings cannot be added here** — they carry ownership and review
  workflow that only the posting flows and the sync pipeline create correctly.

---

## 2 · Pipeline tables — how the module stays reversible

These are internal; you normally see them only as UI (batches, review grids,
Recent edits) — listed so the full footprint is documented.

| Table | Role |
|---|---|
| `sync_batch` | One row per intake (workbook upload / email run / WhatsApp run): label, source, per-sheet counts, status (draft → committed → undone). |
| `sync_staged_row` | The review grid's rows — parsed payload, NEW/UPD/ERR classification, per-field diff vs the live table, validation flags, source message. Nothing touches a live table until you commit. |
| `sync_commit_audit` | Before-image of every row a batch commit changed → powers **Undo batch**. |
| `record_edit_audit` | Before/after image of every direct Preview change — update, delete and now **insert** — single or bulk-grouped → powers **Recent edits** undo. |
| `commodity_review_queue` | UNMAPPED commodity names found during staging; resolved in the Manual Review tab by assigning a regime (writes a `commodities` row). |
| `vessel_review_queue` | Channel-sourced vessels that arrived without a usable IMO; resolved or ignored in Manual Review. |
| `whatsapp_message` | Raw inbound WhatsApp circulars (inbox), with processing status. |
| `whatsapp_config` / `whatsapp_runtime` | WhatsApp bridge settings + session state. |
| `email_ingest_config` | Email ingestion settings (mailbox, folder, LLM extraction toggle). |
| `llm_credential` | Vault-backed managed LLM credentials (the secret itself lives in Supabase Vault, never in a readable column). |
| `app_settings` | Misc module settings (key–value). |
| `vessel_availability` | Written by "Post open positions" on a committed vessels sheet — one open-position posting per STATUS=Open workbook row. |

---

## 3 · Safety & performance model (unchanged principles, now everywhere)

- **Whitelist:** the audited write RPCs refuse any table not in the nine above
  (server-enforced, `SECURITY DEFINER`, service-role only). The browser never
  writes a live table directly.
- **Everything undoable:** batch commits → Undo batch; direct adds/edits/
  deletes → Recent edits. Undo of an add deletes the row; undo of a delete
  re-inserts it with every column intact.
- **Batch operations:** bulk field-edit and bulk delete run as one database
  transaction (atomic — one blocked row aborts the whole group, never a
  partial result), capped at 500 rows per action, and undo as one group.
- **Friendly failures:** duplicate keys, missing required fields, FK-blocked
  deletes and bad values all surface as plain-language messages, not SQL
  errors.
- **Server-side paging:** every grid fetches one page (50–100 rows) with the
  search filter applied in the database, so tables can grow without the
  browser holding them.

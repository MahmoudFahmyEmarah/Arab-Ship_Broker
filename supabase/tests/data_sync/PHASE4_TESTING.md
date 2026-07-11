# Phase 4 — Database Preview & Manual Review · Testing scenarios

Covers the audited direct-edit path (`record_edit_audit` + `edit_live_record` /
`bulk_update_live_records` / `delete_live_record` / `undo_record_edits`), the
commodity review queue (`commodity_review_queue` + `resolve_commodity_review`),
their server actions, and the Preview / Manual-Review UI.

**Automated checks run this phase**
- `tsc --noEmit` — clean
- `eslint` (actions, preview registry, stage, all three views) — clean
- **DB smoke** against real `ports` / `commodities` tables (`phase4_smoke.sql`):
  single edit, single undo, bulk edit, group undo, delete, delete-undo,
  commodity resolve, and both guards — all passed, auto-rolled-back, 0 residue.

---

## Security & authorization

### Scenario 1 — every mutation is gated + audited
```
Given editRecord / bulkEditRecords / deleteRecord / undoEdit / resolveCommodityReview
Then  each calls requireAdmin({ section:"datasync", edit:true }) before touching data
And   each runs through a SECURITY DEFINER RPC granted to service_role only
And   the acting admin's users.id is stamped on every record_edit_audit row
```

### Scenario 2 — table allow-list
```
Given a request naming a table outside the sync allow-list (e.g. "users")
Then  fn_sync_table_allowed rejects it → RPC raises 42501 → action returns an error
And   listRecords/editRecord reject an unknown preview id before hitting the DB
```

## Preview grid

### Scenario 3 — server-paginated browse
```
Given a table with 5,000 rows
When  the tab opens
Then  listRecords returns one PAGE (50) with an exact total; the pager shows
      "1–50 of 5000"; Next/Prev move the window — the browser holds one page
```

### Scenario 4 — search is injection-safe
```
Given a search term containing , ( ) % * \
Then  sanitizeSearch strips them before the term is interpolated into .or(ilike)
And   results filter across the table's configured searchCols
```

## Single edit

### Scenario 5 — partial, audited edit
```
Given an admin edits Commodity + Comm% on a cargo row and saves
Then  only the changed fields are sent (diff of draft vs original)
And   edit_live_record updates just those columns (jsonb_populate_record) —
      untouched columns (e.g. qty) are preserved
And   a record_edit_audit row captures the full before + after image
```
Verified at the DB layer (partial update preserved `country`; before-image correct).

### Scenario 6 — key & system columns are protected
```
Then  the business key, id, created_at, updated_at are never in the patch
      (key shown read-only; fn_edit_set_list excludes them server-side)
And   an empty/no-op patch returns "No changes to save" without a write
```

## Bulk edit

### Scenario 7 — one field across many rows, one undo group
```
Given N rows selected, field = review_status, value = APPROVED
When  "Apply to N" runs
Then  bulk_update_live_records writes N audited rows sharing one group_id
And   Recent edits shows the action as "bulk"; one Undo reverts all N
And   > 500 selected is refused client- and server-side
```
Verified at the DB layer (2-row group edit + single group undo restored both).

## Delete & recovery

### Scenario 8 — audited delete is recoverable
```
Given an admin deletes a record (with confirm)
Then  delete_live_record captures the full before-image, then deletes
And   Recent edits shows a DEL entry; Undo re-inserts the exact row
```
Verified at the DB layer (delete → undo re-inserted identical row).
Note: undo restores the record itself; rows in other tables that were
FK-cascade-deleted are not resurrected — deletes are gated behind a confirm.

## Recent edits / undo

### Scenario 9 — history + idempotent undo
```
Then  Recent edits lists the last 20 direct edits (UPD/DEL, table, key, time)
And   an already-undone entry shows "undone" and offers no button
And   undo_record_edits raises P0002 if there is nothing open to revert
```

## Manual Review queue

### Scenario 10 — UNMAPPED commodities enqueue during staging
```
Given a staged cargo row whose ASB_REGIME resolved to UNMAPPED
Then  stage.ts upserts its commodity_name into commodity_review_queue
      (on_conflict raw_name, ignoreDuplicates — never double-queued)
And   the Manual Review tab badge shows the pending count
And   a queue write failure never fails the batch (best-effort try/catch)
```

### Scenario 11 — resolve assigns a regime
```
Given a pending "Soybean Meal Pellets"
When  the admin sets cargo type + IMSBC + grain/DG and clicks Resolve & add
Then  resolve_commodity_review upserts a commodities row (canonical_name key)
And   the queue entry flips to 'mapped' with mapped_commodity_id set
And   choosing IMSBC = DG defaults the Dangerous-goods flag on
```
Verified at the DB layer (commodity created with is_grain + Cat_C; queue mapped).

### Scenario 12 — ignore
```
When  "Ignore" is clicked
Then  the entry moves to status 'ignored' and leaves the pending list + badge
And   it remains visible under the "ignored" filter
```

## Big data / resilience

### Scenario 13 — no unbounded reads
```
Then  Preview reads are capped (≤200/page); queue reads capped at 500;
      Recent edits capped at 50 — no view materialises a whole table client-side
```

# Phase 3 — Module shell & Review UI · Testing scenarios

Covers nav registration, the Data Sync page + actions (`commitSheet`,
`commitAll`, `undoBatch`, `discardBatch`, `listStaged`, `getBatch`), and the
Sync Workspace / Review client.

**Automated checks run this phase**
- `tsc --noEmit` — clean
- `eslint` (nav, sections, icons, actions, page, client) — clean
- **DB commit-path smoke** against the live `cargo_listings` table (enum/int/bool
  casting, partial update, before-image, undo) — passed, auto-rolled-back, 0 residue.
  Re-runnable via the block in the Phase 3 chat step, or adapt `phase1_smoke.sql`.

---

## Navigation & authorization

### Scenario 1 — Data Sync appears only for the owner
```
Given the "Data" nav group with a superOnly "Data Sync" item
And   datasync registered in ADMIN_SECTIONS + OWNER_ONLY
When  a super (owner) admin loads the console → the item shows, /admin/data-sync opens
When  a sub-admin loads it → the item is hidden AND requireAdmin({section:"datasync"})
      bounces a direct visit to /admin/dashboard
```

### Scenario 2 — Mutations require edit access
```
Given every action calls requireAdmin({ section:"datasync", edit:true })
Then  a view-only seat (were datasync ever granted 'view') cannot commit/undo/discard
```

## Upload → Review

### Scenario 3 — Upload stages a reviewable batch (no live writes)
```
Given a valid CargoMap .xlsx dropped on the workspace
When  it POSTs to /api/upload/cargomap
Then  a toast reports "Staged N changes for review"
And   the view switches to Review with the batch summary populated
And   NO cargo/ports/… row has changed yet (staging only)
```

### Scenario 4 — Upload guards surface as toasts
```
non-.xlsx           → "Upload the unified CargoMap .xlsx workbook."
> 10 MB             → "Workbook is larger than 10 MB."
server parse error  → the API's message shown in the dropzone + a toast
network failure     → "Network error during upload."
```

### Scenario 5 — Review summary & tab strip reflect the batch
```
Then  the summary bar shows to-insert / to-update / invalid / flagged totals
And   each sheet tab shows its committable count (new+updated), red when it has errors
And   "Changes only" hides 'unchanged' rows (server-filtered, not client)
```

### Scenario 6 — Row-level diff
```
updated row → "field: old → new" with the new value emphasized (only changed cols)
new row     → a compact payload summary
invalid row → red row tint; the Flags column shows error/warn/info icons with tooltips
committed row → greyed with a check
```

## Commit (per-tab & global)

### Scenario 7 — Per-tab commit
```
When  "Sync N to <table>" is clicked for the ports tab
Then  commit_sync_batch(batch,'ports') runs; a toast reports inserted/updated
And   the tab shows a green check; its button disables
And   the batch stays 'draft' while other tabs remain uncommitted
```
Verified at the DB layer: cargo enum/int/bool casting + partial update + audit correct.

### Scenario 8 — Global commit
```
When  "Sync all (N)" is clicked
Then  commit_sync_batch(batch, null) commits every sheet in one call
And   the batch flips to 'committed'; all tabs check; the button disables
```

### Scenario 9 — Commit errors don't half-apply
```
Given a staged payload that violates a live constraint
Then  the RPC transaction rolls back (no partial writes, no audit)
And   the action returns { success:false, error } → shown as a toast
And   the batch is marked 'failed' with the error captured
```

## Undo & discard

### Scenario 10 — Undo a committed batch
```
Given a 'committed' batch (in Review or the Recent list)
When  "Undo batch" is confirmed
Then  undo_sync_batch restores updated rows and deletes inserted rows
And   a toast reports "N restored · N removed"; the batch flips to 'undone'
```
Verified at the DB layer (restore + delete + status).

### Scenario 11 — Discard a draft (safe hard delete)
```
Given a 'draft' or 'failed' batch (nothing committed)
When  "Discard" is confirmed
Then  the sync_batch row is deleted (staged rows cascade) and the list refreshes
Given a 'committed'/'committing' batch
Then  discard is refused: "This batch has committed rows — undo it instead."
```

## Big data

### Scenario 12 — Review grid is server-paginated
```
Given a sheet with 5,000 staged rows
When  the tab opens
Then  listStaged returns ≤100 rows with an exact total; the grid shows
      "Showing first 100 of 5,000" — the browser never holds the whole batch
```

## Recent batches

### Scenario 13 — History with contextual actions
```
Then  the workspace lists the 12 most recent batches with source, status, counts, time
And   committed batches offer Undo; drafts/failed offer Discard; all offer Review
```

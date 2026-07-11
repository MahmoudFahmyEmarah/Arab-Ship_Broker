# Phase 2 — Domain core & upload API · Testing scenarios

Covers `lib/sync/*` (normalize, sheet registry, diff/classify, XlsxSource,
stageBatch) and `POST /api/upload/cargomap`.

**Automated checks**

```bash
# Pure pipeline (map → diff → validate) against fixtures — no DB, no file:
npx tsx scripts/sync-phase2-check.ts     # 23 assertions, exits non-zero on failure

# Parser against the REAL workbook — no DB writes:
npx tsx scripts/sync-phase2-parse.ts [path.xlsx]
```

Both are green as of this phase. `sync-phase2-check.ts` is the regression guard
for the rules below; extend it when you add a rule.

---

## Parsing (XlsxSource)

### Scenario 1 — Only the five CargoMap sheets are ingested
```
Given a workbook with 00_INDEX, 01_CARGO … 11_VALIDATION
When  XlsxSource.parse() runs
Then  01_CARGO→cargo, 02_VESSELS→vessels, 03_COMPANIES→companies,
      04_PORTS→ports, 05_CLASS_MARKET_NAME→commodities are returned
And   00_INDEX and the 06–11 reference/spec sheets are ignored
And   sheets come back in a stable order (cargo, vessels, companies, ports, commodities)
```
Verified live: workbook parsed to 786 cargo / 94 vessels / 80 companies / 293 ports / 85 commodities.

### Scenario 2 — Header row is detected, not assumed
```
Given 01_CARGO has a report line on row 1 and column headers on row 2
And   02_VESSELS has its column headers on row 1
When  parse() scores each candidate row against the known headers
Then  cargo reads headers from row 2 (data from row 3)
And   vessels reads headers from row 1 (data from row 2)
```

### Scenario 3 — Columns map by name, not position
```
Given two workbooks with the same headers in a different column order
Then  both map to identical payloads (header→column index, position-independent)
And   unknown columns are ignored, never mis-assigned
```

## Normalizing (CargoMap Step 4/8 rules)

### Scenario 4 — Quantities strip commas → integer
```
"22,500" → 22500 ;  "1,000" → 1000 ;  "12k" → kept as "12k" so the validator errors
```

### Scenario 5 — Laycan SPOT/PPT → null + is_spot
```
"SPOT"/"PPT" → laycan_from=null, is_spot=true
"2026-06-10" → laycan_from="2026-06-10", is_spot=false
Excel serial 46096 → the corresponding ISO date
"whenever" → bad → row flagged
```

## Classification (diff)

### Scenario 6 — new / updated / unchanged
```
Given a port EGALY exists as "Alexandria"
A row with PORT="Alexandria Port" → 'updated', diff={trade_name:{old:'Alexandria',new:'Alexandria Port'}}
A row identical to the live row      → 'unchanged', diff=null
A LOCODE not present live             → 'new'
```

### Scenario 7 — Diff is partial
```
Then  the diff (and the eventual UPDATE) lists ONLY changed columns;
      untouched columns (e.g. country) never appear and are never overwritten
```

## Validation

### Scenario 8 — Errors force 'invalid' (won't commit); warns don't
```
commission 42            → error → 'invalid'
missing COMMODITY (new)  → error 'commodity_name is required' → 'invalid'
unknown zone             → error → 'invalid'
missing REF              → error 'missing ref' + businessKey=null → 'invalid'
REF not CM-/P-/OUT-nnn   → warn (still syncable)
```

### Scenario 9 — UNMAPPED regime is flagged for Manual Review, not blocked
```
Given a cargo row with ASB_REGIME='UNMAPPED'
Then  it carries an info flag ("assign a regime in Manual Review")
And   it still classifies 'new' (Phase 4 surfaces it in the queue)
```

### Scenario 10 — Required only bites new rows
```
Given an 'updated' row missing a NOT NULL column not in its payload
Then  it is NOT invalid — a partial update leaves that column untouched
```

## Staging (stageBatch)

### Scenario 11 — A batch is opened, staged, summarized
```
When  stageBatch(source) runs
Then  a sync_batch row is created (status 'draft')
And   every parsed row becomes a sync_staged_row with classification + diff + flags
And   sync_batch.counts holds per-sheet {new,updated,unchanged,invalid,errors}
And   NO live table is written (staging only)
```

### Scenario 12 — Existing rows are fetched by business key, chunked
```
Given 5,000 cargo rows
Then  live rows are read with `.in(keyColumn, keys)` in ≤500-key chunks
And   staged rows are inserted in ≤500-row chunks (bounded memory / statement size)
```

### Scenario 13 — Failure marks the batch and rethrows
```
Given a read/insert error mid-stage
Then  sync_batch.status='failed' with the error captured, and the error propagates
```

## Upload API (POST /api/upload/cargomap)

### Scenario 14 — Guards
```
Non-admin            → redirected by requireAdmin()
No 'file' field      → 400 "No workbook received"
Not .xlsx            → 415 "upload the unified CargoMap .xlsx"
> 10 MB              → 413 "larger than 10 MB"
Un-parseable file    → 422 with the parser message
```

### Scenario 15 — Happy path returns the review batch
```
Given a valid CargoMap .xlsx
Then  200 { ok:true, batchId, counts, totals, errors[] }
And   the browser never receives write access — only a batch id to review
```

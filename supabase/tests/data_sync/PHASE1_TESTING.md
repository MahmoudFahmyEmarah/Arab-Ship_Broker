# Phase 1 — Schema & write path · Testing scenarios

Covers the migration `20260704090000_data_sync_pipeline.sql`: the staging/audit
tables, the encrypted-credential table, and the `commit_sync_batch` /
`undo_sync_batch` / `save_llm_credential` / `get_llm_secret` functions.

**How to run the automated smoke test**

```bash
# Against a Supabase dev branch or local stack — NOT production.
psql "$SUPABASE_DB_URL" -f supabase/tests/data_sync/phase1_smoke.sql
```

The smoke test wraps everything in `BEGIN … ROLLBACK`, so it writes to `ports`
transiently and leaves the database exactly as it found it. It asserts each
step and prints `PHASE 1 SMOKE: ALL ASSERTIONS PASSED` on success; any failure
raises and aborts.

> The commit/undo functions are `SECURITY DEFINER` with `EXECUTE` granted to
> `service_role` only. Run the smoke test as the database owner (`postgres`) or
> `service_role`; an `anon`/`authenticated` role must get *permission denied*
> (Scenario 7).

---

## Commit

### Scenario 1 — Insert a new row
```
Given a draft batch with one staged 'new' ports row (locode ZZTST) that does not exist live
When  commit_sync_batch(batch) runs
Then  the ports row exists with the payload values
And   the function returns {"inserted":1,"updated":0,"skipped":0}
And   sync_commit_audit has one row: op='insert', before IS NULL, after = the live row
And   the staged row is marked committed=true
And   the batch status becomes 'committed'
```

### Scenario 2 — Update an existing row (partial, typed)
```
Given ports ZZTST exists with trade_name='Test Port'
And   a staged 'updated' row whose payload is {locode:ZZTST, trade_name:'Renamed'}
When  commit_sync_batch(batch2) runs
Then  ports.trade_name = 'Renamed' and every other column is unchanged  (partial upsert)
And   the audit before-image records the prior trade_name='Test Port'
And   the return is {"inserted":0,"updated":1,"skipped":0}
```

### Scenario 3 — Per-sheet vs global commit
```
Given a batch with staged rows on two sheets (01_CARGO, 04_PORTS)
When  commit_sync_batch(batch, '04_PORTS') runs
Then  only the ports rows commit; the cargo rows stay committed=false
And   the batch status stays 'draft' (uncommitted rows remain)
When  commit_sync_batch(batch)  -- no sheet
Then  the remaining rows commit and the batch becomes 'committed'
```

### Scenario 4 — Only new/updated commit; unchanged & invalid are skipped
```
Given staged rows classified 'unchanged' and 'invalid'
When  commit_sync_batch runs
Then  neither is written to the live table and neither appears in the audit
```

## Undo (the free-tier rollback guarantee)

### Scenario 5 — Undo restores updates and deletes inserts
```
Given batch1 inserted ports ZZTST and batch2 updated its trade_name
When  undo_sync_batch(batch2) runs
Then  ports.trade_name is restored to 'Test Port'  (before-image replayed)
And   the return is {"reverted":1,"deleted":0}
When  undo_sync_batch(batch1) runs
Then  ports ZZTST no longer exists
And   the return is {"reverted":0,"deleted":1}
And   both batches are status='undone'; their staged rows are committed=false again
```

### Scenario 6 — Undo order is newest-first
```
Given a batch that inserted then (in a later batch) updated the same key
Then  audit rows are replayed in reverse commit order so the row lands at its
      pre-batch state, never an intermediate one
```

## Security & guards

### Scenario 7 — Only service_role may commit
```
Given a session as 'authenticated'
When  it calls commit_sync_batch / undo_sync_batch / save_llm_credential / get_llm_secret
Then  Postgres raises "permission denied for function"  (EXECUTE not granted)
```

### Scenario 8 — Target table allow-list
```
Given a staged row with target_table='users' (not in the allow-list)
When  commit_sync_batch runs
Then  it raises 'sync target table users is not permitted' and writes nothing
```

### Scenario 9 — Key-column integrity
```
Given a staged row for cargo_listings with key_column='id' (not 'ref')
When  commit_sync_batch runs
Then  it raises a 'key column mismatch' error before any dynamic SQL executes
```

### Scenario 10 — Failure marks the batch, transaction rolls back
```
Given a staged payload that violates a live constraint (e.g. bad enum)
When  commit_sync_batch runs
Then  the whole commit rolls back (no partial writes, no audit rows)
And   the batch is left status='failed' with the error text captured
```

## Encrypted credentials (Vault)

### Scenario 11 — Save stores ciphertext in Vault, not on the row
```
When  save_llm_credential(null,'Prod','anthropic','claude-sonnet-4',null,'sk-ant-xxx',true)
Then  llm_credential has a row with secret_id set and is_active=true
And   the row has NO plaintext key column anywhere
And   get_llm_secret(id) returns 'sk-ant-xxx'
And   vault.decrypted_secrets holds it; the base table vault.secrets stores only ciphertext
```

### Scenario 12 — Exactly one active credential
```
Given credential A is active
When  save_llm_credential(...B..., make_active=true)
Then  B is active and A is not  (idx_llm_one_active enforces a single active row)
```

### Scenario 13 — Update label without resupplying the key
```
Given a credential with a stored secret
When  save_llm_credential(id, newLabel, ..., p_secret => null)
Then  the label updates and secret_id is preserved (key not lost, not re-encrypted)
```

## RLS (defense-in-depth)

### Scenario 14 — Non-admins cannot read staging via the anon/authenticated API
```
Given RLS is enabled with an fn_is_admin() admin-all policy
When  a non-admin selects from sync_staged_row through PostgREST
Then  zero rows are returned (server actions use service_role and bypass RLS by design)
```

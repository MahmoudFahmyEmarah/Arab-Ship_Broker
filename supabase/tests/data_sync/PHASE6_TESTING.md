# Phase 6 — Email + LLM source (LangGraph.js) · Testing scenarios

Covers the circulation-inbox source: IMAP fetch → LangGraph triple-gate
classification (active Vault key) → the SAME `ParsedSheet[]` → `stageBatch` → a
review batch. Plus the SSE route and the workspace card.

**Automated checks run this phase**
- `tsc --noEmit` — clean (incl. LangChain / imapflow / mailparser types)
- `eslint` (email libs, API route, all views) — clean
- **Graph unit test** `scripts/sync-phase6-graph.ts` — drives the real LangGraph
  with a mock classifier (no network/DB): **17/17 passed** — regime mapping,
  irrelevant short-circuit, cargo/vessel/mixed extraction, RawRow header mapping,
  and integration through `buildStagedRow` (new/keyed, derived grain flag,
  UNMAPPED → Manual-Review flag).

---

## Architecture / reuse

### Scenario 1 — one pipeline, two sources
```
Given EmailLlmSource implements SyncSource and returns ParsedSheet[]
Then  stageBatch runs identically to the upload path — diff, validate, laycan
      SPOT/PPT, zone/enum checks, and the UNMAPPED→Manual-Review queue all apply
And   the result is a normal sync_batch (source='email') the Review UI opens
```
Verified: email RawRows flow through buildStagedRow (unit test).

## LangGraph triple-gate

### Scenario 2 — gate 1 (relevance) short-circuits
```
Given an email classified 'irrelevant'
Then  the graph routes straight to END; no extraction runs; 0 records
```
Verified (unit test).

### Scenario 3 — gate 2 (extraction) by category
```
cargo  → extractCargo only
vessel → extractVessels only
mixed  → both
And    each record is one row; fields left null when not stated (no invention)
```
Verified (unit test: cargo=2, vessel=1, mixed=both).

### Scenario 4 — gate 3 (normalize) assigns regime
```
Then  known grains → asb_regime GRAIN; everything else → UNMAPPED
And   UNMAPPED rows carry the info flag that enqueues them for Manual Review
```
Verified (unit test: Wheat→GRAIN, Clinker→UNMAPPED→flag).

### Scenario 5 — structured output
```
Given the LangChain classifier
Then  each gate uses withStructuredOutput(zodSchema) so the model must return
      valid JSON in-shape (or the call retries) — no brittle text parsing
```

## LLM key wiring

### Scenario 6 — active Vault key drives classification
```
Then  getActiveModel reads the single active llm_credential, decrypts via
      get_llm_secret (server-only), and builds ChatAnthropic/ChatOpenAI by vendor
And   base_url is honoured for proxies/self-host
And   no active key → a clear "Add one in Settings" error (not a crash)
```

## IMAP fetch (Namecheap Private Email)

### Scenario 7 — connect & fetch
```
Given host mail.privateemail.com:993, the full mailbox address + Vault password
Then  fetchCirculars connects (secure), reads the last N days from the folder,
      parses MIME (mailparser) to {from,subject,date,text}
And   timeouts fail fast with a message rather than hanging the stream
And   the password is never logged
```
Live run requires the mailbox password entered in Settings (owner action).

## SSE route & UI

### Scenario 8 — streamed progress
```
When  "Sync now" POSTs /api/sync/email
Then  the card streams log lines (connect → N msgs → per-email gates → staged)
And   on 'done' it opens the batch in Review; on 'error' it toasts + logs
And   the route is owner-only (403 otherwise), Node runtime, maxDuration 300s
```

### Scenario 9 — dry run without credentials
```
Given "Test with a pasted email" + pasted circular text
When  "Classify sample" runs (body { sample })
Then  the graph classifies + stages it (no IMAP) → a review batch
This is the credential-free way to validate the classifier end-to-end.
```

## REF-less cargo (provisional keys)

### Scenario 11 — email cargo without a broker REF stays usable
```
Given circular cargo with no CM-/P-/OUT- reference
Then  to-rows.ts mints a deterministic EM-<sha1[:8]> ref from the cargo's
      identifying fields (commodity, qty, load/disch, laycan)
And   the same cargo re-extracted → the same ref → a re-sync UPDATES in place
      (idempotent; no duplicate rows)
And   the row is committable (has a business key) but carries an INFO flag
      "provisional REF — confirm or replace"; no spurious ref-format warn
And   uploads (XLSX) are unaffected — real refs keep their strict CM-/P-/OUT- check
And   a still-incomplete row (e.g. missing cargo_type) is invalid as before
```
Verified (graph test: mint, idempotence, committable, info-not-warn, required-field guard).

## Error handling

### Scenario 10 — resilient failures
```
inbox not configured / disabled / no password → specific error, no crash
one email fails to classify → logged + skipped; the rest continue
nothing extracted → "Nothing to stage" error (no empty batch surprise)
```
Verified in code (per-email try/catch; guarded staging).

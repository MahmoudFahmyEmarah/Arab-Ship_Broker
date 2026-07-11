# WhatsApp source · Testing scenarios

Covers the third Data Sync source: intake (Meta webhook / QR-linked worker),
classification→staging, the auto-ack with the REDACTED extract, the match
engine, and the admin-triggered teaser.

**Automated checks run**
- `scripts/sync-whatsapp-check.ts` — **39/39**: signature verify (valid /
  tampered / malformed → no crash), Meta payload extraction (defensive),
  **redaction guarantees** (commission / freight / broker / rates / notes NEVER
  in any outbound text), template render, teaser identity masking, match scoring
  bands + both directions + draft origin, WA- provisional refs (deterministic,
  recognised, email EM- unchanged).
- DB smoke (rolled back): config Vault round-trip + keep-on-null, wa_message_id
  dedupe, outbox lifecycle, 'whatsapp' accepted as a batch source.
- `tsc` + `eslint` + phase-2 + phase-6 suites + production build.

---

## Providers

### Scenario 1 — provider toggle (test now, Meta later)
```
Given Settings → WhatsApp
Then  "QR-linked number (testing)" and "Meta Cloud API (official)" are selectable
And   unofficial shows a visible ToS/ban warning
And   switching provider later changes ONLY the transport — pipeline unchanged
```

### Scenario 2 — unofficial pairing via the companion worker
```
Given `npm run wa:worker` running (node --env-file=.env.local --import tsx …)
Then  Settings shows the live state: offline (start command) → pairing (QR to
      scan from WhatsApp → Linked devices) → connected (number shown)
And   the QR/heartbeat arrive via whatsapp_runtime (admin-only RLS)
And   a logged-out session clears auth and returns to pairing (no crash loop)
```

### Scenario 3 — Meta webhook security
```
GET  /api/whatsapp/webhook — echoes hub.challenge only when hub.verify_token
     matches the Vault-stored token; else 403
POST — X-Hub-Signature-256 verified (HMAC app secret, constant-time); invalid → 403
And  verified events always answer 200 fast (processing runs after the response)
     so Meta never retry-storms; unexpected errors also 200 (messages re-deliver
     and dedupe by wa_message_id)
```

## Intake → staging

### Scenario 4 — message → review batch (same pipeline)
```
Given an inbound text circulation
Then  it lands in whatsapp_message (deduped), classifies via the SAME LangGraph
      triple-gate, and stages ONE batch per message (label "WA · contact · time")
And   WA-<hash> provisional refs (idempotent), UNMAPPED commodities → Manual
      Review, no-IMO vessels → the vessel queue — all existing machinery
And   nothing reaches live tables without the admin's review/commit
```

### Scenario 5 — irrelevant + failures contained
```
irrelevant chat            → marked irrelevant, no ack, no batch
LLM timeout / no active key → message stays pending/failed; "Process pending" /
                              "Retry failed" sweeps re-run it; sweep never aborts
staging error               → THAT message marked failed; others continue
```

### Scenario 6 — pasted-message dry run
```
Given "Test with a pasted message" on the workspace card
Then  a synthetic inbox message is classified + staged with NO WhatsApp
      connection — the full pipeline is testable before any pairing
```

## Auto-ack (the "powerful parser" reply)

### Scenario 7 — instant acknowledgment
```
Given auto-reply enabled
When  a message stages
Then  the contact receives the admin-editable template with {{name}},
      the formatted extract {{summary}}, and {{url}}
And   REDACTION: commission, freight ideas, rates, broker names and notes are
      never included (unit-guaranteed)
And   an ack failure is recorded (retryable) and NEVER rolls back staging
And   provider routing: meta → direct Graph send · unofficial → outbox → worker
```

## Review integration

### Scenario 8 — contact + original message in the drawer
```
Given a WhatsApp-sourced staged row → View
Then  the left pane shows the contact card (name, number, time) + original text
And   the right pane shows the extracted fields (as for email)
```

## Matches & teaser

### Scenario 9 — match calculation (live + drafts, both directions)
```
Given "Find matches" on a cargo row → vessels scored (qty↔DWT fit + zone)
Given a vessel row → live cargoes (IN/PARTIAL) + drafts scored
Then  results show Strong/Good/Possible bands and a LIVE/DRAFT origin tag
And   candidates include UNCOMMITTED staged drafts (pre-sync visibility)
```

### Scenario 10 — admin-triggered teaser
```
When  "Send summary to contact" (confirm) on a WhatsApp row
Then  the masked one-pager goes out: match count, 🟢/🟡/⚪ bands, DWT/zone/route
      facts — vessel identities masked (MV A•••••), no commercial terms
And   an engaging "scanning the market" message when there are no matches
And   teaser_sent_at recorded; failures surface as toasts, retry-safe
```

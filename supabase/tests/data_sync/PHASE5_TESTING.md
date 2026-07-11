# Phase 5 — Encrypted settings & multi-key LLM manager · Testing scenarios

Covers the Vault-backed LLM credential manager (`llm_credential` + `save_` /
`set_active_` / `delete_llm_credential`, `get_llm_secret`), the circulation email
config (`email_ingest_config` + `save_email_config` / `get_email_password`), their
server actions, the Settings UI, and the legacy plaintext-key migration.

**Automated checks run this phase**
- `tsc --noEmit` — clean · `eslint` (settings actions + Settings view) — clean
- **DB smoke** against live Supabase Vault (`phase5_smoke.sql`): create/encrypt,
  decrypt round-trip, one-active invariant, active-switch, secret rotation,
  null-secret-keeps-key, delete-destroys-ciphertext, email singleton + password
  round-trip — all passed, auto-rolled-back, 0 residue, 0 new advisor lints.

---

## Encryption & secret hygiene (the core ask)

### Scenario 1 — keys are never stored or returned in plaintext
```
Given a key is added
Then  the plaintext goes straight to Vault (vault.create_secret); the row keeps
      only a secret_id pointer + a 4-char key_hint
And   listLlmCredentials returns metadata only — no secret column exists to leak
And   the secret is decrypted (get_llm_secret) only server-side, service_role-only
```

### Scenario 2 — delete destroys the ciphertext
```
When  a key is deleted
Then  delete_llm_credential removes the row AND the vault.secrets ciphertext
```
Verified at the DB layer (vault row gone after delete).

### Scenario 3 — rotate vs keep
```
Given an edit with a new secret → the Vault secret is updated + hint refreshed
Given an edit with a blank secret → the existing Vault secret is preserved
```
Verified at the DB layer (null-secret update did not wipe the key).

## One active key

### Scenario 4 — exactly one active, enforced at the DB
```
Given a second key saved "make active"
Then  the previous active is deactivated (partial unique index idx_llm_one_active)
And   Activate on any key switches the active one atomically
```
Verified at the DB layer (count of active always 1).

## Test key

### Scenario 5 — provider ping
```
When  "Test" is clicked
Then  the key is decrypted server-side and used for a read-only GET /v1/models
      (Anthropic headers for claude/anthropic vendors, Bearer otherwise; base_url honoured)
And   a 200 → success toast; a non-200 → "Provider rejected the key (HTTP n)"
And   a network/timeout error is reported without exposing the key
```

## Legacy migration

### Scenario 6 — import the plaintext platform-settings key
```
Given platform_settings.ai.apiKey holds a plaintext key
Then  the Settings view shows an "Import & encrypt" banner
When  clicked → a credential is created (active) in Vault AND the plaintext
      apiKey is blanked in app_settings
And   re-running reports "No legacy key found" (idempotent)
```

## Email connection

### Scenario 7 — IMAP config with password in Vault
```
When  the circulation inbox form is saved with a password
Then  save_email_config stores host/port/user/folder/query as a singleton row
And   the password goes to Vault (get_email_password decrypts server-side only);
      the UI shows only a 4-char hint
And   saving again with a blank password keeps the stored one
And   only one config row can exist (only_one unique + check)
```
Verified at the DB layer (singleton + password round-trip + keep-on-null).

## Authorization

### Scenario 8 — owner-only, edit-gated, service_role-only
```
Given Data Sync is OWNER_ONLY
Then  every settings action calls requireAdmin({ section:"datasync", edit:true })
And   all secret RPCs are granted to service_role only (revoked from anon/auth)
And   the browser never receives a decrypted secret from any action
```

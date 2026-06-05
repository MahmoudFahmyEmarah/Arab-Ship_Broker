# Contact-firewall proof

Reproducible, self-contained proof that counterparty contact details are
**admin-only (or the listing's own owner)** at the API layer — not merely
hidden in the UI. PostgREST runs queries as Postgres roles (`anon`,
`authenticated`, `service_role`) with `request.jwt.claims` set, so proving
the behaviour at the role/RLS/grant level is equivalent to proving it for
every API response.

It replicates the Supabase auth scaffolding (`auth.uid()`, `is_admin()`,
the role set) and applies the **exact** firewall SQL from:

- `supabase/migrations/20260601000100_feature_columns_and_contact_firewall.sql`
  (cargo: `cargos_access_view` contact → admin/owner only)
- `supabase/migrations/20260601000200_vessel_contact_firewall.sql`
  (vessel: base-table PII column lockdown + masked `v_vessel_detail`)

## Run

```bash
PGBIN=/usr/lib/postgresql/16/bin            # any local Postgres 16+
"$PGBIN/initdb" -D /tmp/fwpg/data -U postgres --auth=trust
"$PGBIN/pg_ctl" -D /tmp/fwpg/data -o "-k /tmp/fwpg/sock -p 55432" -l /tmp/fwpg/server.log start
"$PGBIN/psql" -h /tmp/fwpg/sock -p 55432 -U postgres -d postgres -f setup.sql
bash proof.sh          # expects: 12 passed, 0 failed
```

## What it asserts (12 checks)

Vessel:
- Member, **raw API** select of `owner_company` / `commercial_manager_email`
  / `pic_name` / `tc_charterer_name` → **permission denied**.
- Member can still read specs (`vessel_name`, `dwt_grain`).
- Member via `v_vessel_detail` → all PII `NULL`, specs visible.
- Owner via `v_vessel_detail` → own PII visible.
- Admin via `v_vessel_detail` → PII visible.

Cargo:
- Member sees their **own** cargo's contact.
- Member gets **NULL** on a counterparty cargo's contact.
- Admin sees the counterparty contact.

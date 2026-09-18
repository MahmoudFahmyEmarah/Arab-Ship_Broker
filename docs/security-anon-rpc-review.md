# Open task — review the 80 functions a logged-out visitor can call

Written 10 Sep 2026, after the data-quality audit. This is the remaining item
from that audit (`docs/data-quality-audit.html`, finding S1's wider class).
Everything below was measured on project `rezfejaxbmdzkslrrefr`; re-measure
before acting, because the numbers drift.

## Why this exists

Nobody exposed these deliberately. Until 10 Sep 2026 every function created in
`public` was born executable by `PUBLIC`, `anon` and `authenticated` — see
`docs/database-grants.md`. That default is now off, so the list stops growing.
**It has not shrunk**: 80 functions remain reachable by `anon`, and 39 of them
are `SECURITY DEFINER`, meaning they run as `postgres` and ignore RLS.

Some are correct — the public site genuinely needs them. Several are plainly
not, and a few look serious.

## Read this before you revoke anything

Three rules, learned the hard way on 10 Sep:

1. **RLS policy predicates must stay executable by the roles that query the
   table.** `fn_is_admin()`, `fn_my_org_ids()`, `fn_market_fresh_ok()`,
   `fn_owns_cargo()`, `fn_owns_vessel()`, `fn_app_user_id()`,
   `fn_my_billing_customer_ids()` are named inside policies on
   `cargo_listings`, `vessel_availability`, `vessels`, `matches`, `invoices`
   and more. Revoke `EXECUTE` from `anon`/`authenticated` and **every query on
   those tables fails for that role** — the whole public market page goes
   down. Find them with the query at the bottom before touching any `fn_my_*`,
   `fn_is_*`, `fn_owns_*` or `*_fresh_ok` function.
2. **Trigger functions need no grant at all.** Verified: as `authenticated`,
   an insert into a table whose `BEFORE INSERT` trigger function had every
   grant revoked succeeded. PostgreSQL checks `EXECUTE` at `CREATE TRIGGER`
   time, not at fire time. The 25 trigger functions below are therefore a free
   win — revoking costs nothing and removes them from the RPC surface.
3. **A revoke is only safe if you know the caller.** The app reaches the
   database three ways: the browser client (`anon` / `authenticated`, via
   PostgREST), server actions (`service_role`, unrestricted), and SQL inside
   other functions. Grep `sdk/`, `lib/` and `app/` for `.rpc("<name>"` before
   deciding. A function called only from a server action needs **no**
   `anon`/`authenticated` grant.

## The inventory

### A · Trigger functions — 25, revoke freely (rule 2)

`fn_billing_audit`, `fn_cl_bind_contacts`, `fn_cl_port_autofill`,
`fn_csa_matchmaking_writeback`, `fn_generate_va_ref`, `fn_invoice_guard`,
`fn_invoice_lines_guard`, `fn_lo_close_previous`, `fn_market_insights_freeze`,
`fn_match_auto_cleanup`, `fn_oc_auto_reject_on_close`, `fn_oc_detect_dispute`,
`fn_payment_settle`, `fn_rq_on_review`, `fn_set_updated_at`,
`fn_submission_route`, `fn_users_auto_upgrade`, `fn_va_bind_contacts`,
`fn_va_port_autofill`, `fn_vessel_contact_history_insert`,
`fn_vrq_bind_contacts`, `require_imo_for_new_vessel`,
`trg_refresh_matches_availability`, `trg_refresh_matches_cargo`,
`trg_refresh_matches_vessel`

`fn_payment_settle` and `fn_invoice_guard` being callable by a logged-out
visitor is the sharpest example of why the old default was wrong.

### B · Looks wrong for `anon` — verify, then likely `service_role` only

Each is `SECURITY DEFINER`, so it runs as `postgres`. Check whether it has its
own internal authorisation check (several do — `resolve_port_review` calls
`fn_is_admin()` and raises) before judging severity. An internal check makes
it *defended*, not *correctly exposed*.

| Function | Why it stands out |
|---|---|
| `fn_org_manage_member(uuid,uuid,text)` | changes organisation membership |
| `fn_org_set_plan_seat(uuid,uuid,boolean)` | assigns paid seats — billing impact |
| `fn_billing_bank_details()` | returns bank details |
| `create_account_with_profiles(uuid,text,text,profile_type_enum[])` | creates accounts |
| `get_admin_ops_stats()` | admin telemetry |
| `fn_publish_market_insights_edition(date,date,text,boolean)` | publishes content |
| `fn_set_market_insights_narrative(text,text)` | edits published content |
| `fn_build_market_insights(date,date)` | expensive; content generation |
| `fn_refresh_matches()` | expensive full recompute — a DoS lever |
| `fn_refresh_matches_for_cargo(uuid)` / `..._for_availability(uuid)` | expensive per row |
| `fn_port_review_sweep()` | writes the ports queue |
| `resolve_port_review(uuid,text,…)` | admin action (has `fn_is_admin()` guard) |
| `rls_auto_enable()` | event-trigger function, should never be callable |
| `fn_request_org_membership(uuid)` | check it is meant to be pre-auth |
| `fn_position_checkin(uuid,text,date,time,date)` | check it is meant to be pre-auth |
| `fn_org_seat_summary(uuid)` / `fn_org_team(uuid)` / `fn_my_admin_org_id()` / `fn_my_membership()` / `fn_is_org_admin(uuid)` | org data — likely `authenticated`, not `anon` |
| `fn_search_organizations(text)` | may be a legitimate signup lookup |

### C · Genuinely public — confirm, then leave alone

`get_public_stats()`, `get_public_platform_totals()`,
`get_latest_market_insights()`, `get_market_insights_archive()`,
`get_market_insights_edition(text)`, `get_market_visibility()`,
`fn_market_insights_subscribe(text)`, `get_port_route(text,text)`

### D · Policy predicates and pure helpers — mostly must stay

Predicates (rule 1): `fn_is_admin()`, `is_admin()`, `fn_app_user_id()`,
`fn_my_org_ids()`, `fn_my_billing_customer_ids()`, `fn_market_fresh_ok(…)`,
`fn_owns_cargo(uuid)`, `fn_owns_vessel(uuid)`.

Side-effect-free helpers, low risk either way — decide by whether the browser
calls them: `fn_dq_imo_valid`, `fn_imo_check_digit`, `fn_flag_key`,
`fn_normalize_flag`, `fn_port_key`, `fn_port_options`, `fn_port_strip_notation`,
`fn_resolve_port_area`, `fn_resolve_port_locode`, `fn_resolve_port_side`,
`fn_contact_parse_broker`, `fn_sender_parts`, `fn_sync_key_column`,
`fn_sync_table_allowed`, `fn_match_cleanup`.

Note `fn_resolve_port_*`, `fn_port_*`, `fn_normalize_flag`, `fn_flag_key` and
`fn_dq_imo_valid` are also granted to `dq_evaluator` — that grant is separate
and must survive (`20260910144000`).

## Method

For each function, in this order:

1. `pg_get_functiondef` — read it. Does it write? Does it check the caller?
2. `grep -rn '\.rpc("<name>"' sdk lib app components` — who calls it, and as
   which role? A server-action-only caller needs no browser grant.
3. Decide: `anon` (public site), `authenticated` (members), or neither.
4. Write one migration that revokes in **small, reversible batches**, most
   clearly-wrong first (Group A, then the writers in Group B).
5. After each batch: load the public home page, the market pages logged out
   *and* logged in, post a cargo, and re-run the verification queries.

Prefer several small migrations over one large one; a revoke that breaks a
page should be trivially identifiable and revertible.

## Deliverable

- One or more migrations under `supabase/migrations/`.
- A table in this file recording each function, the decision and the reason.
- `fn_audit_function_grants()` re-run and the counts updated below.
- The public site and member portal verified working after each batch.

## Verification queries

```sql
-- the current picture
select * from public.fn_audit_function_grants() order by reach, signature;

-- everything a logged-out visitor can call, dangerous ones first
select signature, security_definer from public.fn_audit_function_grants()
 where anon and not is_trigger order by security_definer desc, signature;

-- RULE 1 GUARD: functions named inside any RLS policy — do not revoke blindly
select distinct p.polname, c.relname, regexp_matches(
         pg_get_expr(p.polqual, p.polrelid) || ' ' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), ''),
         '([a-z_][a-z0-9_]*)\s*\(', 'g') as fn
from pg_policy p join pg_class c on c.oid = p.polrelid
join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public';

-- nothing should be unreachable, and PUBLIC should always be empty
select * from public.fn_audit_function_grants() where reach like 'nobody%' or public_execute;

-- the pre-change baseline, to diff against
select * from public.db_function_grants_baseline order by signature;
```

## Counts at handover (10 Sep 2026)

| | |
|---|---|
| Functions in `public` | 175 |
| Reachable by `anon` | 80 — of which 39 `SECURITY DEFINER`, 25 trigger functions |
| Reachable by `authenticated` but not `anon` | 18 |
| `service_role` only | 77 |
| Reachable by `PUBLIC` | 0 |
| Reachable by nobody | 0 |

# Database grants — functions are private by default

Since 10 Sep 2026 a function created in schema `public` is reachable by
`service_role` and its owner only. **If the browser must call it, say so.**

```sql
create or replace function public.my_rpc(p_id uuid) returns jsonb ...;

grant execute on function public.my_rpc(uuid) to authenticated;  -- signed-in members
grant execute on function public.my_rpc(uuid) to anon;           -- logged-out visitors too
```

Nothing else changes. Trigger functions, helpers and admin routines need no
grant at all — see "What does *not* need a grant" below.

## Why

A function used to be born with this ACL:

```
{=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, service_role=X/postgres}
```

Two automatic grants, neither of them asked for:

- **`=X/postgres` — EXECUTE to `PUBLIC`.** PostgreSQL's hard-wired default for
  functions. `PUBLIC` means every role that exists *and every role created
  later*. This is how the brand-new, NOLOGIN `dq_evaluator` role — created to
  contain untrusted rule SQL — could execute about sixty functions it was
  never granted, several of them `SECURITY DEFINER` writers. The containment
  boundary had a hole in it the day it was built, and nobody put it there.
- **`anon` / `authenticated` / `service_role`.** Supabase's default ACL.
  Reasonable for a project whose functions are all meant to be RPCs; wrong for
  this one, where most functions are triggers, helpers and admin-only
  routines, and only a handful are genuinely member-facing.

The result was 47 `SECURITY DEFINER` functions reachable by `anon` — not
because anyone exposed them, but because that is what happens if you do
nothing.

## How it is enforced

Two mechanisms, because one was not enough.

**1 · `ALTER DEFAULT PRIVILEGES`** (`20260910150000`) removed Supabase's
`anon` / `authenticated` grants. That part works: new functions no longer
arrive member-callable.

**2 · An event trigger** (`20260910151000`) removes `PUBLIC`. The default
privileges route *cannot* do this, which is worth knowing before someone tries
again. Measured twice on PostgreSQL 17.6: after

```sql
alter default privileges for role postgres in schema public
  revoke execute on functions from public;
```

the stored `pg_default_acl` row is `{postgres=X/postgres,service_role=X/postgres}`
— no `PUBLIC` in it — and yet a freshly created function still came out
`{=X/postgres,postgres=X/postgres,service_role=X/postgres}`. PostgreSQL merges
the hard-wired `acldefault()` (which grants EXECUTE to `PUBLIC` for functions)
with the `pg_default_acl` row, and that row can only *add* privileges. There
was no global schema-less entry masking it and no event trigger re-granting;
this is simply what the mechanism does.

So `ensure_function_acl` (`fn_acl_no_public_execute`) fires on
`ddl_command_end` and strips `PUBLIC` from every new function in `public`. It
is the sibling of `ensure_rls` / `rls_auto_enable`, the trigger this project
already uses to enable RLS on every new table. It skips extension-owned
objects and never raises — a failure is logged, not fatal, so a migration can
never fail because of it.

## What does *not* need a grant

- **Trigger functions.** Verified empirically before the change: as
  `authenticated`, an insert into a table whose `BEFORE INSERT` trigger
  function had *every* grant revoked succeeded. PostgreSQL checks `EXECUTE` on
  a trigger function when the trigger is **created**, not when it fires.
- **Functions called only from other functions** that already run as a
  privileged role (most `fn_*` helpers).
- **Anything called only from a server action**, which uses the service role.

Practically: grant only what PostgREST must expose as an RPC.

## Finding a mistake

A forgotten grant fails closed — PostgREST simply does not expose the
function, so the call 404s in testing rather than doing something unsafe in
production. To find one deliberately:

```sql
-- who can execute what, and anything nobody can reach
select * from public.fn_audit_function_grants() where reach like 'nobody%';

-- everything a logged-out visitor can call
select signature, security_definer from public.fn_audit_function_grants()
 where anon order by security_definer desc, signature;

-- PUBLIC should always be empty
select * from public.fn_audit_function_grants() where public_execute;
```

`public.db_function_grants_baseline` holds the snapshot taken immediately
before the change (174 functions, 10 Sep 2026), so any drift can be diffed
against a known-good "before".

## State on the day this landed

| | |
|---|---|
| Functions in `public` | 175 |
| Reachable by `PUBLIC` | **0** (was 15) |
| Reachable by `anon` | 80 |
| Reachable by `authenticated` only | 18 |
| `service_role` only | 77 |
| Reachable by nobody (forgotten grants) | **0** |

`get_port_route`, `get_public_stats` and `create_cargo_listing` were
re-verified after the change; RLS policies that call `fn_is_admin()` still
evaluate.

**Still open:** the 80 functions reachable by `anon` have not been reviewed
one by one. Many are correct — the public site needs them — but that list is
where the audit's 47 `SECURITY DEFINER` findings live. See
`docs/security-anon-rpc-review.md` for the brief.

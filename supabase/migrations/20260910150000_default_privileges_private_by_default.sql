-- ════════════════════════════════════════════════════════════════════════
-- Functions are private by default (audit follow-up, 10 Sep 2026)
--
-- Measured before this migration: a function created by `postgres` in schema
-- public was born with
--
--   {=X/postgres, postgres=X/postgres, anon=X/postgres,
--    authenticated=X/postgres, service_role=X/postgres}
--
-- Two separate grants, both automatic:
--
--   `=X/postgres`  EXECUTE to PUBLIC — PostgreSQL's built-in default for
--                  functions. PUBLIC means *every* role, including roles that
--                  do not exist yet. This is exactly how the brand-new,
--                  NOLOGIN `dq_evaluator` role could execute ~60 functions it
--                  was never granted (see 20260910143000) — among them
--                  SECURITY DEFINER writers. The containment boundary built
--                  in 20260910140000 had a hole in it on the day it was
--                  written, and nobody wrote that hole: it is the default.
--
--   anon / authenticated / service_role
--                  Supabase's own default ACL. Convenient for a project whose
--                  functions are all meant to be RPCs; wrong for this one,
--                  where most functions are triggers, helpers and admin-only
--                  routines and only a handful are genuinely member-facing.
--
-- After this migration a new function in public is reachable by service_role
-- and its owner only. Anything meant for the browser must say so:
--
--   grant execute on function public.my_rpc(uuid) to authenticated;   -- members
--   grant execute on function public.my_rpc(uuid) to anon;            -- logged out too
--
-- Two things this deliberately does NOT do:
--
--   · It does not touch a single existing function. Default privileges apply
--     only to objects created from now on, so nothing that works today stops
--     working. The 47 SECURITY DEFINER functions currently reachable by anon
--     are a separate review, still open.
--   · `create or replace function` on an existing function keeps its ACL. Only
--     a genuine CREATE (including drop-then-create) starts from the default —
--     which is the case to watch when editing a member-facing RPC.
--
-- Verified beforehand: a trigger function needs NO execute grant at fire time
-- (tested as `authenticated` against a trigger whose function had every grant
-- revoked — the insert succeeded). Trigger functions are the bulk of what
-- loses its automatic grants here, and they are unaffected.
--
-- fn_audit_function_grants() below is the drift detector: it names anything
-- reachable by anon or authenticated, and anything reachable by nobody, which
-- is how a forgotten grant on a new RPC shows up.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the audit view, first, so the baseline can use it ───────────────────
create or replace function public.fn_audit_function_grants()
 returns table (
   signature        text,
   owner            text,
   security_definer boolean,
   is_trigger       boolean,
   public_execute   boolean,
   anon             boolean,
   authenticated    boolean,
   service_role     boolean,
   reach            text
 )
 language sql stable security definer set search_path to ''
as $$
  select
    p.oid::regprocedure::text,
    pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.prorettype = 'pg_catalog.trigger'::regtype,
    coalesce(has_function_privilege('public', p.oid, 'EXECUTE'), false),
    coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false),
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false),
    coalesce(has_function_privilege('service_role', p.oid, 'EXECUTE'), false),
    case
      when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon (logged out)'
      when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'members'
      when has_function_privilege('service_role', p.oid, 'EXECUTE') then 'server only'
      else 'nobody — a new RPC missing its grant?'
    end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  order by 1;
$$;
comment on function public.fn_audit_function_grants() is
  'Who can execute each function in schema public. "nobody" on a non-trigger function usually means a new RPC was created without its grant (functions are private by default since 20260910150000).';
revoke all on function public.fn_audit_function_grants() from public, anon, authenticated;
grant execute on function public.fn_audit_function_grants() to service_role;

-- ── 2 · baseline, so the still-open review has a fixed "before" ─────────────
create table if not exists public.db_function_grants_baseline (
  captured_at      timestamptz not null default now(),
  signature        text not null,
  owner            text,
  security_definer boolean,
  is_trigger       boolean,
  public_execute   boolean,
  anon             boolean,
  authenticated    boolean,
  service_role     boolean,
  reach            text,
  primary key (captured_at, signature)
);
comment on table public.db_function_grants_baseline is
  'Snapshot of function reachability taken 10 Sep 2026, immediately before default privileges were tightened. The input to the open review of SECURITY DEFINER functions reachable by anon.';
alter table public.db_function_grants_baseline enable row level security;
grant select on public.db_function_grants_baseline to service_role;

insert into public.db_function_grants_baseline (signature, owner, security_definer, is_trigger, public_execute, anon, authenticated, service_role, reach)
select signature, owner, security_definer, is_trigger, public_execute, anon, authenticated, service_role, reach
from public.fn_audit_function_grants()
where not exists (select 1 from public.db_function_grants_baseline);

-- ── 3 · the change ─────────────────────────────────────────────────────────
-- PUBLIC first: this is the one that silently covers roles nobody has created
-- yet. Then Supabase's anon / authenticated convenience grants.
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated;

-- Objects created by supabase_admin (extensions, internal) carry their own
-- default ACL. postgres is usually not a member of that role, so this is
-- attempted and skipped rather than assumed.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public, anon, authenticated';
  raise notice 'supabase_admin function defaults tightened too';
exception when insufficient_privilege or others then
  raise notice 'supabase_admin function defaults left as they are (%) — postgres cannot alter them; migrations run as postgres, so this does not affect our own functions', sqlerrm;
end $$;

-- ── 4 · tidy up the probe used to measure the old behaviour ────────────────
drop function if exists public._dpz_probe();

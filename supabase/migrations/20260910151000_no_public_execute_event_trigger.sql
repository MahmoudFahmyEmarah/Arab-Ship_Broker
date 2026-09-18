-- ════════════════════════════════════════════════════════════════════════
-- The other half of "private by default": actually removing PUBLIC
--
-- 20260910150000 revoked the Supabase default grants (anon, authenticated)
-- and they stayed revoked — a new function is no longer born member-callable.
-- The same migration also tried
--
--   alter default privileges for role postgres in schema public
--     revoke execute on functions from public;
--
-- and that part did NOT take effect. Measured twice on PostgreSQL 17.6: the
-- stored pg_default_acl row for (postgres, public, functions) is now
-- {postgres=X/postgres,service_role=X/postgres} — no PUBLIC in it — yet a
-- freshly created function still comes out as
-- {=X/postgres,postgres=X/postgres,service_role=X/postgres}. PostgreSQL
-- merges the hard-wired default (acldefault(), which grants EXECUTE to PUBLIC
-- for functions) with the pg_default_acl row, and that row can only ADD
-- grants. There is no global (schema-less) entry masking it, and no event
-- trigger re-granting it — this is simply what the mechanism does.
--
-- PUBLIC is the grant that matters most here: it covers every role that
-- exists *and every role created later*, which is precisely how the new
-- NOLOGIN dq_evaluator could execute ~60 functions it was never granted.
--
-- So enforcement moves to an event trigger — the pattern this project already
-- uses for `rls_auto_enable`, which enables RLS on every new table. Its
-- sibling below strips PUBLIC EXECUTE from every new function in public.
--
-- Safe to apply now: of 175 functions in public only 15 still carry PUBLIC,
-- 13 of them are ours and every one ALSO holds an explicit anon +
-- authenticated grant (from 20260910143000 / 144000), so nothing loses reach.
-- The other two are throwaway probes, dropped here. No extension owns a
-- function in public, and the trigger skips extension-owned objects anyway.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the enforcement ────────────────────────────────────────────────────
create or replace function public.fn_acl_no_public_execute()
 returns event_trigger
 language plpgsql
 security definer
 set search_path to 'pg_catalog'
as $function$
declare cmd record;
begin
  for cmd in
    select * from pg_event_trigger_ddl_commands()
    where object_type in ('function', 'procedure', 'aggregate')
  loop
    -- only our own schema, and never an object an extension owns
    if cmd.schema_name = 'public'
       and not exists (select 1 from pg_depend d where d.objid = cmd.objid and d.deptype = 'e') then
      begin
        execute format('revoke execute on %s %s from public',
                       case cmd.object_type when 'procedure' then 'procedure' else 'function' end,
                       cmd.object_identity);
        raise log 'fn_acl_no_public_execute: revoked PUBLIC execute on %', cmd.object_identity;
      exception when others then
        -- never fail the DDL over this; the audit function surfaces any miss
        raise log 'fn_acl_no_public_execute: could not revoke on %: %', cmd.object_identity, sqlerrm;
      end;
    end if;
  end loop;
end $function$;
comment on function public.fn_acl_no_public_execute() is
  'Event trigger: strips the hard-wired EXECUTE-to-PUBLIC grant from every new function in schema public. ALTER DEFAULT PRIVILEGES cannot express this (see 20260910151000). Grant anon/authenticated explicitly for anything the browser must call.';

drop event trigger if exists ensure_function_acl;
create event trigger ensure_function_acl on ddl_command_end
  when tag in ('CREATE FUNCTION', 'CREATE PROCEDURE', 'CREATE AGGREGATE', 'ALTER FUNCTION', 'ALTER PROCEDURE')
  execute function public.fn_acl_no_public_execute();

-- ── 2 · bring the existing 15 into line ────────────────────────────────────
drop function if exists public._dpz_after();
drop function if exists public._dpz_after2();

do $$
declare f record; n int := 0;
begin
  for f in
    select p.oid::regprocedure::text sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and coalesce(p.proacl::text, '') ~ '(\{|,)=X/'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke execute on function %s from public', f.sig);
    n := n + 1;
  end loop;
  raise notice 'revoked PUBLIC execute on % existing function(s)', n;
end $$;

-- ── 3 · the audit function reports PUBLIC too ──────────────────────────────
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
    coalesce(p.proacl::text, '') ~ '(\{|,)=X/',
    coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false),
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false),
    coalesce(has_function_privilege('service_role', p.oid, 'EXECUTE'), false),
    case
      when coalesce(p.proacl::text, '') ~ '(\{|,)=X/' then 'PUBLIC — every role, including future ones'
      when has_function_privilege('anon', p.oid, 'EXECUTE') then 'anon (logged out)'
      when has_function_privilege('authenticated', p.oid, 'EXECUTE') then 'members'
      when has_function_privilege('service_role', p.oid, 'EXECUTE') then 'server only'
      else 'nobody — a new RPC missing its grant?'
    end
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
  order by 1;
$$;
revoke all on function public.fn_audit_function_grants() from public, anon, authenticated;
grant execute on function public.fn_audit_function_grants() to service_role;

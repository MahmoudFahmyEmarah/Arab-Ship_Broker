-- ════════════════════════════════════════════════════════════════════════
-- Data Quality · workstream A — the evaluator reads only what rules need
-- (19 Sep 2026, audit blocker 2)
--
-- 20260910140000 gave dq_evaluator SELECT on every public table (100
-- relations live) with a read-through policy on each RLS table (90). A rule
-- author could therefore subquery users, billing or contacts from a
-- "read-only" expression. Rule SQL was also compiled with EXPLAIN as the
-- database owner, which sees everything.
--
-- Now:
--   dq_evaluator_relations    the allowlist: the registered tables
--       (dq_tables) plus the lookups the rules and the granted helper
--       functions actually read — derived from the live rules on 18 Sep:
--       ports, port_areas, port_aliases, flag_states, grain_list,
--       imsbc_codes, market_names, commodities, unlocode_registry,
--       dq_port_exceptions.
--   fn_dq_evaluator_sync_grants()   grants SELECT (and the read-through
--       policy) on exactly the allowlist ∪ dq_tables, revokes it everywhere
--       else. Runs now, and again whenever dq_tables or the allowlist change.
--   fn_dq_plan_relations(plan)      the relations a query plan touches.
--   fn_dq_assert_relations_allowed(sql, what)   compiles a rule fragment AS
--       THE EVALUATOR (EXPLAIN through fn_dq_eval_json) and refuses any
--       relation outside the allowlist, naming it.
--   dq_save_rule              uses that instead of owner-side EXPLAIN.
-- The predicate helpers policies call (fn_is_admin, fn_my_org_ids, …) are
-- SECURITY DEFINER, so planning other policies needs no extra grants.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the allowlist ────────────────────────────────────────────────────────
set local lock_timeout = '5s';
set local statement_timeout = '10min';

create table if not exists public.dq_evaluator_relations (
  relation_name text primary key,
  reason        text not null,
  added_at      timestamptz not null default now(),
  added_by      text
);
comment on table public.dq_evaluator_relations is
  'Relations the data-quality evaluator role may read besides the registered tables (dq_tables). Changing it re-syncs the grants.';

insert into public.dq_evaluator_relations (relation_name, reason, added_by) values
  ('ports',               'port lookups in rules and fn_resolve_port_*',       'migration 20260919100000'),
  ('port_areas',          'area dictionary read by fn_resolve_port_side/area',  'migration 20260919100000'),
  ('port_aliases',        'alias table read by fn_resolve_port_locode',         'migration 20260919100000'),
  ('flag_states',         'flag registry read by rules and fn_normalize_flag',  'migration 20260919100000'),
  ('grain_list',          'grain list rules (DQ-D*)',                           'migration 20260919100000'),
  ('imsbc_codes',         'IMSBC rules (DQ-D*, DQ-X*)',                         'migration 20260919100000'),
  ('market_names',        'market-name map rules (DQ-C04, DQ-X*)',              'migration 20260919100000'),
  ('commodities',         'commodity catalogue (also a registered table)',      'migration 20260919100000'),
  ('unlocode_registry',   'registry rules (DQ-R*)',                             'migration 20260919100000'),
  ('dq_port_exceptions',  'registry exceptions (DQ-R*)',                        'migration 20260919100000'),
  ('dq_run_rule_keys',    'per-run key sets the evaluator materialises',        'migration 20260919100000')
on conflict (relation_name) do nothing;

-- ── 2 · grants follow the allowlist ─────────────────────────────────────────
create or replace function public.fn_dq_evaluator_sync_grants()
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare r record; v_granted int := 0; v_revoked int := 0; v_allowed boolean;
begin
  for r in
    select c.relname, c.relkind, c.relrowsecurity
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    v_allowed := exists (select 1 from public.dq_tables t where t.table_name = r.relname)
              or exists (select 1 from public.dq_evaluator_relations a where a.relation_name = r.relname)
              or r.relname = 'dq_issues';
    if v_allowed then
      execute format('grant select on public.%I to dq_evaluator', r.relname);
      v_granted := v_granted + 1;
      if r.relkind in ('r', 'p') and r.relrowsecurity
         and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.relname and p.policyname = 'dq_evaluator_read') then
        execute format('create policy dq_evaluator_read on public.%I for select to dq_evaluator using (true)', r.relname);
      end if;
    else
      if has_table_privilege('dq_evaluator', format('public.%I', r.relname), 'SELECT') then
        execute format('revoke select on public.%I from dq_evaluator', r.relname);
        v_revoked := v_revoked + 1;
      end if;
      if exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = r.relname and p.policyname = 'dq_evaluator_read') then
        execute format('drop policy dq_evaluator_read on public.%I', r.relname);
      end if;
    end if;
  end loop;
  -- the two writable module tables keep their write grants
  grant insert, update on public.dq_issues to dq_evaluator;
  grant insert on public.dq_run_rule_keys to dq_evaluator;
  return jsonb_build_object('granted', v_granted, 'revoked', v_revoked);
end $$;

create or replace function public.fn_dq_evaluator_relations_changed()
 returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  perform public.fn_dq_evaluator_sync_grants();
  return null;
end $$;

drop trigger if exists trg_dq_evaluator_relations_sync on public.dq_evaluator_relations;
create trigger trg_dq_evaluator_relations_sync
  after insert or delete or update on public.dq_evaluator_relations
  for each statement execute function public.fn_dq_evaluator_relations_changed();
drop trigger if exists trg_dq_tables_evaluator_sync on public.dq_tables;
create trigger trg_dq_tables_evaluator_sync
  after insert or delete or update on public.dq_tables
  for each statement execute function public.fn_dq_evaluator_relations_changed();

-- ── 3 · rules compile as the evaluator and may name only allowed relations ──
-- Every "Relation Name" in a plan tree, recursively.
create or replace function public.fn_dq_plan_relations(p_plan jsonb)
 returns text[] language sql immutable set search_path to ''
as $$
  with recursive nodes as (
    select p as node from jsonb_array_elements(case when jsonb_typeof(p_plan) = 'array' then p_plan else jsonb_build_array(p_plan) end) p
    union all
    select child
      from nodes,
           lateral (select case when nodes.node ? 'Plan' then nodes.node->'Plan' else nodes.node end as plan) x,
           lateral jsonb_array_elements(coalesce(x.plan->'Plans', '[]'::jsonb)) child
    where jsonb_typeof(nodes.node) = 'object'
  )
  select coalesce(array_agg(distinct rel order by rel), '{}'::text[])
    from (
      select case when node ? 'Plan' then node->'Plan'->>'Relation Name' else node->>'Relation Name' end as rel from nodes
    ) s
   where rel is not null;
$$;

-- p_select is a complete SELECT statement over the rule's table alias r.
create or replace function public.fn_dq_assert_relations_allowed(p_select text, p_what text)
 returns text[] language plpgsql security definer set search_path to ''
as $$
declare v_plan jsonb; v_rels text[]; v_bad text[];
begin
  begin
    v_plan := public.fn_dq_eval_json('explain (format json) ' || p_select);
  exception
    when insufficient_privilege then
      raise exception '% reads a relation the data-quality evaluator may not see (%). Rules may read the registered tables and the approved lookups only.', p_what, sqlerrm using errcode = '42501';
    when others then
      raise exception '% does not compile: %', p_what, sqlerrm using errcode = '22023';
  end;
  v_rels := public.fn_dq_plan_relations(v_plan);
  select coalesce(array_agg(x order by x), '{}'::text[]) into v_bad
    from unnest(v_rels) x
   where not exists (select 1 from public.dq_tables t where t.table_name = x)
     and not exists (select 1 from public.dq_evaluator_relations a where a.relation_name = x)
     and x <> 'dq_issues';
  if coalesce(array_length(v_bad, 1), 0) > 0 then
    raise exception '% reads % — not a registered table or an approved lookup. Add it to the evaluator allowlist (dq_evaluator_relations) first.', p_what, array_to_string(v_bad, ', ') using errcode = '42501';
  end if;
  return v_rels;
end $$;

create or replace function public.dq_save_rule(p_rule jsonb, p_actor uuid default null, p_actor_name text default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_id uuid := nullif(p_rule->>'id', '')::uuid; v_row public.dq_rules%rowtype; c jsonb; v_t text; v_checks jsonb := coalesce(p_rule->'checks', '[]'::jsonb);
        v_tables text[]; v_code text; v_key text;
begin
  -- validate every check: only reads, compiles as the evaluator, names only allowed relations
  for c in select x from jsonb_array_elements(v_checks) x loop
    v_t := c->>'table';
    if not exists (select 1 from public.dq_tables where table_name = v_t) then raise exception 'Unknown table "%"', v_t using errcode = '22023'; end if;
    select key_column into v_key from public.dq_tables where table_name = v_t;
    perform public.fn_dq_assert_safe_sql(c->>'violation_sql', 'The violation expression');
    perform public.fn_dq_assert_safe_sql(c->>'query_sql', 'The SQL query');
    perform public.fn_dq_assert_safe_sql(c->>'fix_sql', 'The fix expression');
    perform public.fn_dq_assert_safe_sql(c->>'expected_sql', 'The expected expression');
    perform public.fn_dq_assert_safe_sql(c->>'observed_sql', 'The observed expression');
    if coalesce(c->>'query_sql', '') <> '' then
      perform public.fn_dq_assert_relations_allowed(format('select q.%I::text from (%s) q', v_key, c->>'query_sql'), 'The SQL query');
    elsif coalesce(c->>'violation_sql', '') <> '' then
      perform public.fn_dq_assert_relations_allowed(format('select 1 from public.%I r where (%s)', v_t, c->>'violation_sql'), 'The violation expression');
    end if;
    if coalesce(c->>'fix_sql', '') <> '' then perform public.fn_dq_assert_relations_allowed(format('select (%s)::text from public.%I r', c->>'fix_sql', v_t), 'The fix expression'); end if;
    if coalesce(c->>'expected_sql', '') <> '' then perform public.fn_dq_assert_relations_allowed(format('select (%s)::text from public.%I r', c->>'expected_sql', v_t), 'The expected expression'); end if;
    if coalesce(c->>'observed_sql', '') <> '' then perform public.fn_dq_assert_relations_allowed(format('select (%s)::text from public.%I r', c->>'observed_sql', v_t), 'The observed expression'); end if;
  end loop;
  select coalesce(array_agg(x), '{}') into v_tables from jsonb_array_elements_text(coalesce(p_rule->'tables', '[]'::jsonb)) x;

  if v_id is null then
    v_code := coalesce(nullif(p_rule->>'code', ''), 'DQ-N' || lpad((select count(*) + 1 from public.dq_rules where code like 'DQ-N%')::text, 2, '0'));
    insert into public.dq_rules (code, name, description, category, severity, kind, definition, checks, ai_prompt, tables, autofix, enabled, source, owner, created_by)
    values (v_code, coalesce(p_rule->>'name', 'New rule'), coalesce(p_rule->>'description', ''), coalesce(p_rule->>'category', 'validity'), coalesce(p_rule->>'severity', 'warn'),
            coalesce(p_rule->>'kind', 'declarative'), coalesce(p_rule->>'definition', ''), v_checks, p_rule->>'ai_prompt', v_tables, coalesce(p_rule->>'autofix', 'none'),
            coalesce((p_rule->>'enabled')::boolean, false), coalesce(p_rule->>'source', 'admin'), coalesce(p_rule->>'owner', p_actor_name), p_actor)
    returning * into v_row;
  else
    update public.dq_rules set
      name = coalesce(p_rule->>'name', name), description = coalesce(p_rule->>'description', description), category = coalesce(p_rule->>'category', category),
      severity = coalesce(p_rule->>'severity', severity), kind = coalesce(p_rule->>'kind', kind), definition = coalesce(p_rule->>'definition', definition),
      checks = case when p_rule ? 'checks' then v_checks else checks end, ai_prompt = case when p_rule ? 'ai_prompt' then p_rule->>'ai_prompt' else ai_prompt end,
      tables = case when p_rule ? 'tables' then v_tables else tables end, autofix = coalesce(p_rule->>'autofix', autofix),
      enabled = coalesce((p_rule->>'enabled')::boolean, enabled), owner = coalesce(p_rule->>'owner', owner), version = version + 1, deleted_at = null
    where id = v_id returning * into v_row;
    if not found then raise exception 'rule % not found', v_id; end if;
  end if;
  insert into public.dq_rule_versions (rule_id, version, snapshot, note, changed_by, changed_by_name)
  values (v_row.id, v_row.version, to_jsonb(v_row) - 'created_at' - 'updated_at', p_note, p_actor, p_actor_name);
  return to_jsonb(v_row);
end $$;

-- ── 4 · lock the new functions to the server, apply the grants ──────────────
revoke all on function public.fn_dq_evaluator_sync_grants() from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_evaluator_relations_changed() from public, anon, authenticated, dq_evaluator;   -- a trigger function: nobody calls it
-- fn_dq_rules_version() ships with Data Sync phase 3 and is only read inside definer functions; it is not a member API
do $$ begin if to_regprocedure('public.fn_dq_rules_version()') is not null then revoke all on function public.fn_dq_rules_version() from public, anon, authenticated; end if; end $$;
revoke all on function public.fn_dq_plan_relations(jsonb) from public, anon, authenticated;
revoke all on function public.fn_dq_assert_relations_allowed(text, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_evaluator_sync_grants() to service_role;
grant execute on function public.fn_dq_assert_relations_allowed(text, text) to service_role;
grant execute on function public.dq_save_rule(jsonb, uuid, text, text) to service_role;

-- Before the first sync: remember exactly which relations the evaluator could
-- read and which carried its read-through policy, so the DOWN restores that
-- set and nothing wider (a blanket re-grant would also reach tables created
-- since). Kept as a backup table; the DOWN reads it and leaves it in place.
create table if not exists public.dq_evaluator_grants_bak_20260919100000 as
  select c.relname::text as relname,
         has_table_privilege('dq_evaluator', c.oid, 'select') as had_select,
         exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.policyname = 'dq_evaluator_read') as had_policy
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm');
alter table public.dq_evaluator_grants_bak_20260919100000 enable row level security;
revoke all on public.dq_evaluator_grants_bak_20260919100000 from public, anon, authenticated, dq_evaluator;
do $$
declare r jsonb;
begin
  r := public.fn_dq_evaluator_sync_grants();
  raise notice 'dq_evaluator grants synced: % relations readable, % revoked', r->>'granted', r->>'revoked';
end $$;

-- DOWN for 20260919100000_dq_a_evaluator_boundary.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260919_dq_a_down.sql
--   supabase migration repair --status reverted 20260919100000
-- Restores the blanket read the evaluator had before (the posture the audit
-- rejected) and the owner-side rule compile from 20260908130000.

set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop trigger if exists trg_dq_evaluator_relations_sync on public.dq_evaluator_relations;
drop trigger if exists trg_dq_tables_evaluator_sync on public.dq_tables;
drop function if exists public.fn_dq_evaluator_relations_changed();
drop function if exists public.fn_dq_evaluator_sync_grants();
drop function if exists public.fn_dq_assert_relations_allowed(text, text);
drop function if exists public.fn_dq_plan_relations(jsonb);
drop table if exists public.dq_evaluator_relations;

-- Restore exactly the read set the evaluator had before A (snapshot taken by
-- the forward migration); fall back to the pre-A blanket grant only when the
-- snapshot is missing.
do $$
declare t record;
begin
  if to_regclass('public.dq_evaluator_grants_bak_20260919100000') is null then
    execute 'grant select on all tables in schema public to dq_evaluator';
    for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity loop
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.relname and policyname = 'dq_evaluator_read') then
        execute format('create policy dq_evaluator_read on public.%I for select to dq_evaluator using (true)', t.relname);
      end if;
    end loop;
    return;
  end if;
  for t in
    select c.relname, coalesce(b.had_select, false) as had_select, coalesce(b.had_policy, false) as had_policy
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      left join public.dq_evaluator_grants_bak_20260919100000 b on b.relname = c.relname
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') and c.relname <> 'dq_evaluator_grants_bak_20260919100000'
  loop
    if t.had_select then execute format('grant select on public.%I to dq_evaluator', t.relname);
    else execute format('revoke select on public.%I from dq_evaluator', t.relname); end if;
    if t.had_policy and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.relname and policyname = 'dq_evaluator_read') then
      execute format('create policy dq_evaluator_read on public.%I for select to dq_evaluator using (true)', t.relname);
    elsif not t.had_policy and exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.relname and policyname = 'dq_evaluator_read') then
      execute format('drop policy dq_evaluator_read on public.%I', t.relname);
    end if;
  end loop;
end $$;
-- dq_save_rule as of 20260908130000 (before the relation assertion)
-- dq_save_rule exactly as deployed (production dump of 19 Sep 2026, i.e. the 20260910140000 hardening version)
CREATE OR REPLACE FUNCTION "public"."dq_save_rule"("p_rule" "jsonb", "p_actor" "uuid" DEFAULT NULL::"uuid", "p_actor_name" "text" DEFAULT NULL::"text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_id uuid := nullif(p_rule->>'id', '')::uuid; v_row public.dq_rules%rowtype; c jsonb; v_t text; v_checks jsonb := coalesce(p_rule->'checks', '[]'::jsonb);
        v_tables text[]; v_code text;
begin
  -- validate every check compiles and only reads
  for c in select x from jsonb_array_elements(v_checks) x loop
    v_t := c->>'table';
    if not exists (select 1 from public.dq_tables where table_name = v_t) then raise exception 'Unknown table "%"', v_t using errcode = '22023'; end if;
    perform public.fn_dq_assert_safe_sql(c->>'violation_sql', 'The violation expression');
    perform public.fn_dq_assert_safe_sql(c->>'query_sql', 'The SQL query');
    perform public.fn_dq_assert_safe_sql(c->>'fix_sql', 'The fix expression');
    perform public.fn_dq_assert_safe_sql(c->>'expected_sql', 'The expected expression');
    perform public.fn_dq_assert_safe_sql(c->>'observed_sql', 'The observed expression');
    begin
      if coalesce(c->>'query_sql', '') <> '' then
        execute format('explain select q.%I::text from (%s) q', (select key_column from public.dq_tables where table_name = v_t), c->>'query_sql');
      elsif coalesce(c->>'violation_sql', '') <> '' then
        execute format('explain select 1 from public.%I r where (%s)', v_t, c->>'violation_sql');
      end if;
      if coalesce(c->>'fix_sql', '') <> '' then execute format('explain select (%s)::text from public.%I r', c->>'fix_sql', v_t); end if;
      if coalesce(c->>'expected_sql', '') <> '' then execute format('explain select (%s)::text from public.%I r', c->>'expected_sql', v_t); end if;
      if coalesce(c->>'observed_sql', '') <> '' then execute format('explain select (%s)::text from public.%I r', c->>'observed_sql', v_t); end if;
    exception when others then
      raise exception 'Check on % does not compile: %', v_t, sqlerrm using errcode = '22023';
    end;
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
revoke all on function public.dq_save_rule(jsonb, uuid, text, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.dq_save_rule(jsonb, uuid, text, text) to service_role;

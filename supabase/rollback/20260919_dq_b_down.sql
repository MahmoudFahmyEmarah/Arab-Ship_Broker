-- DOWN for 20260919120000_dq_b_finding_lifecycle.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260919_dq_b_down.sql
--   supabase migration repair --status reverted 20260919120000
-- Self-contained: every function body below is verbatim from the migration that last defined it.
-- History-bearing tables are renamed to *_bak_20260919120000, never dropped.
-- Deploy the pre-B application first. Restores: fn_dq_process_batch, fn_dq_finish_run, fn_dq_validate (20260910140000),
-- dq_save_rule (20260919100000, workstream A). The event trail is renamed, not dropped; the duplicates the
-- forward migration folded are restored from dq_issues_dedup_backup.
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop trigger if exists trg_dq_issue_event on public.dq_issues;
drop trigger if exists trg_dq_issue_status_stamp on public.dq_issues;
drop function if exists public.fn_dq_issue_event();
drop function if exists public.fn_dq_issue_status_stamp();
drop function if exists public.dq_set_issue_status(uuid[], text, text, uuid, text, integer);
drop function if exists public.dq_set_rule_enabled(uuid, boolean, boolean, uuid, text, text);
CREATE OR REPLACE FUNCTION "public"."fn_dq_process_batch"("p_run_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  v_run public.dq_runs%rowtype; v_tables text[]; v_idx int; v_last text; v_table text; v_key text; v_scope text;
  v_keys text[]; v_from text; v_to text; v_n int; v_batch_id uuid; v_batch_n int; v_t0 timestamptz := now(); v_clock timestamptz := clock_timestamp();
  r record; c record; v_viol text; v_obs text; v_exp text; v_fix text; v_sql text; v_cnt bigint; v_errs text[] := '{}';
  v_pii text[]; v_label text; v_found jsonb := '{"error":0,"warn":0,"info":0}'::jsonb; v_field text; v_rules int := 0; v_keyerr text[];
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status <> 'running' then return jsonb_build_object('done', true, 'status', v_run.status); end if;
  v_keyerr := coalesce((select array_agg(x) from jsonb_array_elements_text(v_run.scope->'key_errors') x), '{}'::text[]);

  v_tables := v_run.tables; v_idx := coalesce((v_run.cursor->>'idx')::int, 0); v_last := v_run.cursor->>'last';
  loop
    if v_idx >= coalesce(array_length(v_tables, 1), 0) then
      perform public.fn_dq_finish_run(p_run_id, 'completed', null);
      return jsonb_build_object('done', true, 'status', 'completed');
    end if;
    v_table := v_tables[v_idx + 1];
    select key_column, label_sql, pii_columns into v_key, v_label, v_pii from public.dq_tables where table_name = v_table;
    v_scope := public.fn_dq_scope_where(v_table, v_run.scope);
    execute format('select array_agg(k) from (select r.%I::text k from public.%I r where (%s) and ($1 is null or r.%I::text > $1) order by r.%I::text limit %s) s',
                   v_key, v_table, v_scope, v_key, v_key, v_run.batch_size) into v_keys using v_last;
    if v_keys is null or array_length(v_keys, 1) = 0 then v_idx := v_idx + 1; v_last := null; continue; end if;
    exit;
  end loop;

  v_from := v_keys[1]; v_to := v_keys[array_length(v_keys, 1)]; v_n := array_length(v_keys, 1);
  v_batch_n := v_run.batches_done + 1;
  insert into public.dq_run_batches (run_id, n, table_name, key_from, key_to, rows, status, started_at)
  values (p_run_id, v_batch_n, v_table, v_from, v_to, v_n, 'running', clock_timestamp()) returning id into v_batch_id;

  for r in
    select ru.* from public.dq_rules ru
    where ru.enabled and ru.deleted_at is null and ru.queue and ru.kind in ('declarative', 'sql', 'classification')
      and (v_run.rule_ids is null or ru.id = any (v_run.rule_ids)) and ru.tables @> array[v_table]
      and not (ru.id::text = any (v_keyerr))
    order by ru.code
  loop
    for c in select x, (o - 1)::int as idx from jsonb_array_elements(r.checks) with ordinality as t(x, o) where x->>'table' = v_table loop
      v_viol := public.fn_dq_check_violation(c.x, v_key, p_run_id, r.id, c.idx);
      if v_viol is null then continue; end if;
      v_rules := v_rules + 1;
      v_field := c.x->>'field';
      v_obs := coalesce(c.x->>'observed_sql', case when v_field is not null and public.fn_dq_has_column(v_table, v_field) then format('r.%I::text', v_field) else 'null::text' end);
      v_exp := case when coalesce(c.x->>'expected_sql', '') <> '' then '(' || (c.x->>'expected_sql') || ')::text' else format('%L::text', c.x->>'expected_text') end;
      v_fix := case when coalesce(c.x->>'fix_sql', '') <> '' then
        format('case when (%1$s) is not null and (%1$s)::text is distinct from (%2$s) then jsonb_build_object(''field'', %3$L, ''value'', (%1$s)::text, ''before'', (%2$s), ''after'', (%1$s)::text, ''kind'', %4$L, ''confidence'', %5$s, ''rationale'', %6$L) else null::jsonb end',
               c.x->>'fix_sql', v_obs, coalesce(c.x->>'fix_field', v_field), r.autofix, coalesce((c.x->>'fix_confidence')::numeric, 1), coalesce(c.x->>'fix_rationale', 'Derived by the rule''s fix expression.'))
        else 'null::jsonb' end;
      begin
        v_sql := format($q$
          with ins as (
            insert into public.dq_issues as di (rule_id, rule_code, run_id, table_name, row_key, row_label, field, observed, expected, severity, category, source, why, snapshot, fix)
            select %L::uuid, %L, %L::uuid, %L, r.%I::text, (%s)::text, %L, (%s)::text, %s, %L, %L, 'rule', %L, (to_jsonb(r) - %L::text[]), %s
            from public.%I r
            where (%s) and r.%I::text >= $1 and r.%I::text <= $2 and (%s)
            on conflict (rule_code, table_name, row_key, coalesce(field, '')) where status = 'open'
            do update set last_seen = now(), run_id = excluded.run_id, observed = excluded.observed, expected = excluded.expected,
                          snapshot = excluded.snapshot, fix = coalesce(excluded.fix, di.fix), row_label = excluded.row_label,
                          severity = excluded.severity, rule_id = excluded.rule_id
            returning 1)
          select count(*) from ins $q$,
          r.id, r.code, p_run_id, v_table, v_key, v_label, v_field, v_obs, v_exp, r.severity, r.category,
          coalesce(c.x->>'message', r.description), coalesce(v_pii, '{}'::text[]), v_fix,
          v_table, v_scope, v_key, v_key, v_viol);
        -- the rule's own SQL runs as dq_evaluator, never as the owner
        v_cnt := public.fn_dq_eval_count(v_sql, v_from, v_to);
        v_found := jsonb_set(v_found, array[r.severity], to_jsonb(coalesce((v_found->>r.severity)::int, 0) + coalesce(v_cnt, 0)));
        update public.dq_issues i set status = 'fixed', reason = 'No longer fails on re-check', resolved_at = now()
        where i.rule_code = r.code and i.table_name = v_table and i.status = 'open' and i.source = 'rule'
          and coalesce(i.field, '') = coalesce(v_field, '') and i.row_key >= v_from and i.row_key <= v_to and i.last_seen < v_t0;
      exception when others then
        v_errs := v_errs || format('%s on %s: %s', r.code, v_table, sqlerrm);
      end;
    end loop;
  end loop;

  update public.dq_run_batches set status = case when array_length(v_errs, 1) > 0 then 'failed' else 'done' end, found = v_found,
    ms = (extract(epoch from (clock_timestamp() - v_clock)) * 1000)::int,
    error = nullif(array_to_string(v_errs, ' · '), ''), finished_at = clock_timestamp()
  where id = v_batch_id;

  update public.dq_runs set rows_done = rows_done + v_n, batches_done = batches_done + 1, last_batch_at = clock_timestamp(),
    cursor = jsonb_build_object('idx', v_idx, 'last', v_to),
    found = jsonb_build_object('error', (dq_runs.found->>'error')::int + (v_found->>'error')::int, 'warn', (dq_runs.found->>'warn')::int + (v_found->>'warn')::int, 'info', (dq_runs.found->>'info')::int + (v_found->>'info')::int),
    note = case when array_length(v_errs, 1) > 0 then left(coalesce(note || ' · ', '') || format('batch %s: %s', v_batch_n, array_to_string(v_errs, ' · ')), 2000) else note end
  where id = p_run_id;

  return jsonb_build_object('done', false, 'batch_id', v_batch_id, 'n', v_batch_n, 'table', v_table, 'key_from', v_from, 'key_to', v_to,
                            'rows', v_n, 'rules', v_rules, 'found', v_found, 'errors', to_jsonb(v_errs));
end $_$;
revoke all on function public.fn_dq_process_batch(uuid) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_process_batch(uuid) to service_role;

CREATE OR REPLACE FUNCTION "public"."fn_dq_finish_run"("p_run_id" "uuid", "p_status" "text", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  update public.dq_runs set status = p_status, finished_at = clock_timestamp(), error = coalesce(p_error, error),
    duration_ms = extract(epoch from (clock_timestamp() - coalesce(started_at, created_at))) * 1000
  where id = p_run_id;
  if p_status in ('completed', 'failed', 'cancelled') then
    delete from public.dq_run_rule_keys where run_id = p_run_id;
  end if;
  if p_status = 'completed' then perform public.fn_dq_snapshot_health(); end if;
end $$;
revoke all on function public.fn_dq_finish_run(uuid, text, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_finish_run(uuid, text, text) to service_role;

CREATE OR REPLACE FUNCTION "public"."fn_dq_validate"("p_table" "text", "p_row" "jsonb", "p_channel" "text" DEFAULT 'admin'::"text", "p_actor" "text" DEFAULT NULL::"text", "p_actor_id" "uuid" DEFAULT NULL::"uuid", "p_log" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare r record; c jsonb; v_bad boolean; v_mode text; v_issues jsonb := '[]'::jsonb; v_blocked boolean := false; v_key text; v_row_key text; v_errors int := 0;
begin
  if not exists (select 1 from public.dq_tables where table_name = p_table) then return jsonb_build_object('ok', true, 'blocked', false, 'issues', '[]'::jsonb, 'errors', 0); end if;
  select key_column into v_key from public.dq_tables where table_name = p_table;
  v_row_key := p_row->>v_key;
  for r in
    select ru.* from public.dq_rules ru where ru.enabled and ru.deleted_at is null and ru.kind in ('declarative', 'classification') and ru.tables @> array[p_table] order by ru.severity, ru.code
  loop
    v_mode := public.fn_dq_effective_mode(r.id, p_channel);
    if v_mode = 'audit' then continue; end if;
    for c in select x from jsonb_array_elements(r.checks) x where x->>'table' = p_table and coalesce(x->>'violation_sql', '') <> '' loop
      begin
        v_bad := public.fn_dq_eval_bool(
          format('select coalesce((%s), false) from (select (jsonb_populate_record(null::public.%I, $1)).*) r', c->>'violation_sql', p_table), p_row);
      exception when others then
        -- fail open, but never silently: the rule did not evaluate, and the Gate tab shows it
        v_bad := false; v_errors := v_errors + 1;
        if p_log then
          insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, actor_id, mode, message)
          values (p_channel, r.code, p_table, v_row_key, p_actor, p_actor_id, 'error', left('rule did not evaluate: ' || sqlerrm, 500));
        end if;
      end;
      if v_bad then
        v_issues := v_issues || jsonb_build_object('rule_code', r.code, 'name', r.name, 'severity', r.severity, 'field', c->>'field', 'mode', v_mode, 'message', coalesce(c->>'message', r.description));
        if v_mode = 'block' then
          v_blocked := true;
          if p_log then
            insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, actor_id, mode, message, payload_hash)
            values (p_channel, r.code, p_table, v_row_key, p_actor, p_actor_id, v_mode, coalesce(c->>'message', r.description), encode(sha256(convert_to(p_row::text, 'UTF8')), 'hex'));
          end if;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('ok', not v_blocked, 'blocked', v_blocked, 'issues', v_issues, 'errors', v_errors);
end $_$;
revoke all on function public.fn_dq_validate(text, jsonb, text, text, uuid, boolean) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_validate(text, jsonb, text, text, uuid, boolean) to service_role;

CREATE OR REPLACE FUNCTION "public"."dq_save_rule"("p_rule" "jsonb", "p_actor" "uuid" DEFAULT NULL::"uuid", "p_actor_name" "text" DEFAULT NULL::"text", "p_note" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
revoke all on function public.dq_save_rule(jsonb, uuid, text, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.dq_save_rule(jsonb, uuid, text, text) to service_role;

-- the folded duplicates come back, then the identity index gives way to the open-only index
drop index if exists public.dq_issues_identity_uq;
do $$ begin
  if to_regclass('public.dq_issues_dedup_backup') is not null then
    insert into public.dq_issues select * from public.dq_issues_dedup_backup on conflict (id) do nothing;
    drop table public.dq_issues_dedup_backup;
  end if;
end $$;
-- Before the old index can come back, the rows the NEW index allowed have to
-- be folded. dq_issues_identity_uq includes `source`, so a rule finding and an
-- AI finding may share a row and field; dq_issues_open_uq cannot hold both,
-- and recreating it over such a pair fails on a duplicate key. That is a
-- rollback blocked by data the release itself made legal, so it is dealt with
-- here rather than left for whoever is trying to roll back at the time.
--
-- The rule finding is kept: rules are authoritative and AI findings advisory.
-- The others are resolved with a reason, never deleted.
with ranked as (
  select id,
         row_number() over (
           partition by rule_code, table_name, row_key, coalesce(field, '')
           order by case when source = 'rule' then 0 else 1 end, last_seen desc nulls last, id
         ) as rn
    from public.dq_issues
   where status = 'open'
)
update public.dq_issues i
   set status = 'fixed',
       reason = 'Folded by the workstream B rollback: the open-issue index cannot hold two findings that differ only by source',
       resolved_at = now()
  from ranked r
 where r.id = i.id and r.rn > 1;

create unique index if not exists dq_issues_open_uq on public.dq_issues (rule_code, table_name, row_key, coalesce(field, '')) where status = 'open';
update public.dq_issues set status = 'open' where status in ('rule_disabled', 'check_removed', 'record_gone');
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.dq_issues'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.dq_issues drop constraint %I', c.conname);
  end loop;
  alter table public.dq_issues add constraint dq_issues_status_check check (status in ('open', 'fixed', 'ignored', 'false_positive', 'escalated'));
end $$;
alter table public.dq_issues drop column if exists suppressed_observed, drop column if exists suppress_until, drop column if exists status_changed_at;
drop policy if exists dq_issue_events_admin_read on public.dq_issue_events;
drop index if exists public.dq_issue_events_issue_idx;
do $$ begin
  if to_regclass('public.dq_issue_events') is not null then
    execute 'alter table public.dq_issue_events rename to dq_issue_events_bak_20260919120000';
    -- the bigserial's sequence is OWNED by the table but does not follow a
    -- rename: leave it and the live name stays taken, and the schema
    -- fingerprint sees a sequence the baseline never had
    execute 'alter sequence if exists public.dq_issue_events_id_seq rename to dq_issue_events_id_seq_bak_20260919120000';
-- the constraints (and their indexes) follow the table into the backup name, so nothing keeps the live name
alter table public.dq_issue_events_bak_20260919120000 rename constraint dq_issue_events_pkey to dq_issue_events_pkey_bak_20260919120000;
alter table public.dq_issue_events_bak_20260919120000 rename constraint dq_issue_events_issue_id_fkey to dq_issue_events_issue_id_fkey_bak_20260919120000;
    execute 'alter table public.dq_issue_events_bak_20260919120000 disable row level security';
    execute 'revoke all on public.dq_issue_events_bak_20260919120000 from service_role';
  end if;
end $$;
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.dq_ai_suggestions'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.dq_ai_suggestions drop constraint %I', c.conname);
  end loop;
  update public.dq_ai_suggestions set status = 'accepted' where status = 'applied_nothing';
  alter table public.dq_ai_suggestions add constraint dq_ai_suggestions_status_check check (status in ('pending', 'accepted', 'dismissed'));
end $$;

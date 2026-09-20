-- DOWN for 20260919130000_dq_c_run_integrity.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260919_dq_c_down.sql
--   supabase migration repair --status reverted 20260919130000
-- Self-contained: every function body below is verbatim from the migration that last defined it.
-- History-bearing tables are renamed to *_bak_20260919130000, never dropped.
-- Deploy the pre-C application first. Restores: fn_dq_prepare_run, fn_dq_health_cached, fn_dq_retention (20260910140000),
-- fn_dq_process_batch, fn_dq_finish_run (20260919120000, workstream B), fn_dq_snapshot_health() (20260908130000).
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop function if exists public.fn_dq_retry_run(uuid);
drop function if exists public.fn_dq_retry_prep(uuid);
drop function if exists public.fn_dq_retry_batch(uuid, integer);
drop function if exists public.fn_dq_settle_run(uuid);
drop function if exists public.fn_dq_evaluate_range(uuid, text, text, text, uuid[]);
drop function if exists public.fn_dq_run_note_error(uuid, text, integer);
drop function if exists public.fn_dq_run_clear_errors(uuid);
drop function if exists public.fn_dq_check_units(uuid);
drop function if exists public.fn_dq_snapshot_health(boolean);
drop function if exists public.fn_dq_retention(integer, integer, integer);
-- fn_dq_snapshot_health exactly as deployed (production dump of 19 Sep 2026)
CREATE OR REPLACE FUNCTION "public"."fn_dq_snapshot_health"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare x jsonb; v_at timestamptz := now();
begin
  for x in select jsonb_array_elements(public.fn_dq_health()) loop
    insert into public.dq_health_snapshots (table_name, at, rows, open_error, open_warn, open_info, score)
    values (x->>'table', v_at, (x->>'rows')::int, (x->>'open_error')::int, (x->>'open_warn')::int, (x->>'open_info')::int, (x->>'score')::numeric)
    on conflict do nothing;
  end loop;
end $$;
revoke all on function public.fn_dq_snapshot_health() from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_snapshot_health() to service_role;

CREATE OR REPLACE FUNCTION "public"."fn_dq_prepare_run"("p_run_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_run public.dq_runs%rowtype; v_est jsonb; v_tables text[]; r record; c record; v_key text; v_keyerr text[] := '{}'::text[];
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status not in ('queued', 'paused') then return jsonb_build_object('status', v_run.status); end if;
  if v_run.started_at is null then
    v_est := public.fn_dq_estimate_scope(v_run.scope, v_run.batch_size);
    select coalesce(array_agg(x), '{}') into v_tables from jsonb_array_elements_text(v_est->'table_names') x;
    if coalesce(array_length(v_tables, 1), 0) = 0 then
      update public.dq_runs set status = 'failed', error = 'The scope resolves to no tables.', finished_at = clock_timestamp() where id = p_run_id;
      return jsonb_build_object('status', 'failed');
    end if;

    -- P1 · materialise every SQL-kind rule's key set once, as the evaluator
    delete from public.dq_run_rule_keys where run_id = p_run_id;
    for r in
      select ru.* from public.dq_rules ru
      where ru.enabled and ru.deleted_at is null and ru.queue and ru.kind in ('declarative', 'sql', 'classification')
        and (v_run.rule_ids is null or ru.id = any (v_run.rule_ids)) and ru.tables && v_tables
    loop
      for c in
        select x, (o - 1)::int as idx from jsonb_array_elements(r.checks) with ordinality as t(x, o)
        where coalesce(x->>'query_sql', '') <> '' and (x->>'table') = any (v_tables)
      loop
        select key_column into v_key from public.dq_tables where table_name = c.x->>'table';
        begin
          perform public.fn_dq_eval_exec(format(
            'insert into public.dq_run_rule_keys (run_id, rule_id, check_idx, key) select %L::uuid, %L::uuid, %s, q.%I::text from (%s) q on conflict do nothing',
            p_run_id, r.id, c.idx, v_key, c.x->>'query_sql'));
        exception when others then
          v_keyerr := v_keyerr || r.id::text;
          update public.dq_runs set note = left(coalesce(note || ' · ', '') || format('%s keys: %s', r.code, sqlerrm), 2000) where id = p_run_id;
        end;
      end loop;
    end loop;

    update public.dq_runs set status = 'running', started_at = clock_timestamp(), tables = v_tables,
      total_rows = (v_est->>'total_rows')::int, total_batches = (v_est->>'batches')::int,
      scope = (v_est->'scope') || jsonb_build_object('counts', v_est->'tables', 'key_errors', to_jsonb(v_keyerr)),
      cursor = '{"idx":0,"last":null}'::jsonb
    where id = p_run_id;
  else
    update public.dq_runs set status = 'running' where id = p_run_id;
  end if;
  return jsonb_build_object('status', 'running');
end $$;
revoke all on function public.fn_dq_prepare_run(uuid) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_prepare_run(uuid) to service_role;

CREATE OR REPLACE FUNCTION "public"."fn_dq_health_cached"("p_max_age" interval DEFAULT '00:10:00'::interval) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_at timestamptz; v_out jsonb;
begin
  select max(at) into v_at from public.dq_health_snapshots;
  if v_at is not null and v_at > now() - p_max_age then
    select coalesce(jsonb_agg(jsonb_build_object('table', s.table_name, 'label', t.label, 'rows', s.rows, 'open_error', s.open_error, 'open_warn', s.open_warn, 'open_info', s.open_info,
             'open', s.open_error + s.open_warn + s.open_info, 'score', s.score, 'href', t.admin_href, 'cached_at', s.at,
             'coverage', (select count(*) from public.dq_rules r where r.enabled and r.deleted_at is null and r.tables @> array[s.table_name])) order by t.sort_order), '[]'::jsonb)
      into v_out
      from public.dq_health_snapshots s join public.dq_tables t on t.table_name = s.table_name where s.at = v_at;
    return v_out;
  end if;
  v_out := public.fn_dq_health();
  perform public.fn_dq_snapshot_health();
  return v_out;
end $$;
revoke all on function public.fn_dq_health_cached(interval) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_health_cached(interval) to service_role;

CREATE OR REPLACE FUNCTION "public"."fn_dq_retention"("p_issue_days" integer DEFAULT 90, "p_gate_days" integer DEFAULT 30, "p_snapshot_days" integer DEFAULT 180) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare a int; b int; c int; d int;
begin
  delete from public.dq_issues where status <> 'open' and coalesce(resolved_at, last_seen) < now() - make_interval(days => p_issue_days);
  get diagnostics a = row_count;
  delete from public.dq_gate_log where at < now() - make_interval(days => p_gate_days);
  get diagnostics b = row_count;
  delete from public.dq_health_snapshots where at < now() - make_interval(days => p_snapshot_days);
  get diagnostics c = row_count;
  delete from public.dq_run_rule_keys k using public.dq_runs r where r.id = k.run_id and r.status not in ('queued', 'running', 'paused');
  get diagnostics d = row_count;
  return jsonb_build_object('issues', a, 'gate_log', b, 'snapshots', c, 'run_keys', d);
end $$;
revoke all on function public.fn_dq_retention(integer, integer, integer) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_retention(integer, integer, integer) to service_role;

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
        -- One row per identity. A suppressed finding (ignored / false positive)
        -- stays suppressed while its observed value is unchanged and the
        -- suppression has not expired; every other non-open state reopens.
        -- Suppressed rows are not counted as found.
        v_sql := format($q$
          with ins as (
            insert into public.dq_issues as di (rule_id, rule_code, run_id, table_name, row_key, row_label, field, observed, expected, severity, category, source, why, snapshot, fix)
            select %L::uuid, %L, %L::uuid, %L, r.%I::text, (%s)::text, %L, (%s)::text, %s, %L, %L, 'rule', %L, (to_jsonb(r) - %L::text[]), %s
            from public.%I r
            where (%s) and r.%I::text >= $1 and r.%I::text <= $2 and (%s)
            on conflict (source, rule_code, table_name, row_key, coalesce(field, ''))
            do update set last_seen = now(), run_id = excluded.run_id, observed = excluded.observed, expected = excluded.expected,
                          snapshot = excluded.snapshot, fix = coalesce(excluded.fix, di.fix), row_label = excluded.row_label,
                          severity = excluded.severity, rule_id = excluded.rule_id,
                          status = case
                            when di.status in ('ignored', 'false_positive') and (di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed then di.status
                            when di.status = 'escalated' then 'escalated'
                            else 'open' end,
                          reason = case
                            when di.status in ('ignored', 'false_positive') and (di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed then di.reason
                            when di.status in ('ignored', 'false_positive') then 'Reopened — the value changed since it was ' || replace(di.status, '_', ' ')
                            when di.status = 'fixed' then 'Reopened — fails again after being fixed'
                            when di.status = 'rule_disabled' then 'Reopened — the rule is enabled again and the record still fails'
                            when di.status = 'check_removed' then 'Reopened — the check is back and the record still fails'
                            when di.status = 'record_gone' then 'Reopened — the record exists again'
                            else di.reason end,
                          resolved_at = case
                            when di.status in ('ignored', 'false_positive') and (di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed then di.resolved_at
                            when di.status = 'escalated' then di.resolved_at
                            else null end,
                          resolved_by = case
                            when di.status in ('ignored', 'false_positive', 'escalated') and (di.status = 'escalated' or ((di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed)) then di.resolved_by
                            else null end,
                          resolved_by_name = case
                            when di.status in ('ignored', 'false_positive', 'escalated') and (di.status = 'escalated' or ((di.suppress_until is null or di.suppress_until > now())
                                 and di.suppressed_observed is not distinct from excluded.observed)) then di.resolved_by_name
                            else null end
            returning case when di.status in ('ignored', 'false_positive') then 0 else 1 end as counted)
          select coalesce(sum(counted), 0) from ins $q$,
          r.id, r.code, p_run_id, v_table, v_key, v_label, v_field, v_obs, v_exp, r.severity, r.category,
          coalesce(c.x->>'message', r.description), coalesce(v_pii, '{}'::text[]), v_fix,
          v_table, v_scope, v_key, v_key, v_viol);
        v_cnt := public.fn_dq_eval_count(v_sql, v_from, v_to);
        v_found := jsonb_set(v_found, array[r.severity], to_jsonb(coalesce((v_found->>r.severity)::int, 0) + coalesce(v_cnt, 0)));
        -- rows in this range that used to fail and were not raised again are fixed outside the module
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
declare v_run public.dq_runs%rowtype; t text; v_key text; n int;
begin
  update public.dq_runs set status = p_status, finished_at = clock_timestamp(), error = coalesce(p_error, error),
    duration_ms = extract(epoch from (clock_timestamp() - coalesce(started_at, created_at))) * 1000
  where id = p_run_id returning * into v_run;
  if p_status in ('completed', 'failed', 'cancelled') then
    delete from public.dq_run_rule_keys where run_id = p_run_id;
  end if;
  if p_status = 'completed' and coalesce(v_run.scope->>'kind', 'db') in ('db', 'tables') then
    -- the run saw every row of these tables: an open issue whose row is missing is about a record that is gone
    foreach t in array coalesce(v_run.tables, '{}'::text[]) loop
      select key_column into v_key from public.dq_tables where table_name = t;
      if v_key is null then continue; end if;
      execute format($q$
        update public.dq_issues i set status = 'record_gone', reason = 'Record no longer exists', resolved_at = now()
         where i.table_name = %L and i.status in ('open', 'escalated')
           and not exists (select 1 from public.%I r where r.%I::text = i.row_key) $q$, t, t, v_key);
      get diagnostics n = row_count;
      if n > 0 then
        update public.dq_runs set note = left(coalesce(note || ' · ', '') || format('%s: %s issue(s) closed — record gone', t, n), 2000) where id = p_run_id;
      end if;
    end loop;
  end if;
  if p_status = 'completed' then perform public.fn_dq_snapshot_health(); end if;
end $$;
revoke all on function public.fn_dq_finish_run(uuid, text, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_finish_run(uuid, text, text) to service_role;

delete from public.dq_evaluator_relations where relation_name = 'dq_run_keys';
drop table if exists public.dq_run_keys;
alter table public.dq_health_snapshots drop column if exists partial;
alter table public.dq_run_batches drop column if exists rule_errors;
alter table public.dq_runs drop column if exists rules_expected, drop column if exists rules_ok, drop column if exists rules_failed,
  drop column if exists checks_expected, drop column if exists checks_failed, drop column if exists coverage_pct, drop column if exists rule_errors, drop column if exists prep_errors;
update public.dq_runs set status = 'completed' where status = 'completed_with_errors';
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.dq_runs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.dq_runs drop constraint %I', c.conname);
  end loop;
  alter table public.dq_runs add constraint dq_runs_status_check check (status in ('queued', 'running', 'paused', 'completed', 'failed', 'cancelled'));
end $$;
alter table public.dq_runs drop column if exists consecutive_errors;
alter table public.dq_runs drop column if exists last_engine_error;

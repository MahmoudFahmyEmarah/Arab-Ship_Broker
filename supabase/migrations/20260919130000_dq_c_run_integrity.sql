-- ════════════════════════════════════════════════════════════════════════
-- Data Quality · workstream C — run integrity (19 Sep 2026, amended 20 Sep)
-- (audit blocker 4; finding 11, cursor part; re-audit blocker 1)
--
-- Before: a rule that threw marked its batch failed and the run carried on
-- to "completed" and published a health snapshot as if every rule had seen
-- every row. Batches paged over the live table by mutable text keys, so a
-- key edited mid-run could be skipped or seen twice. And a SQL-kind rule
-- whose key query failed at prepare time was dropped into scope.key_errors
-- and silently skipped: the run still ended "completed, 100 %".
--
-- Now:
--   dq_run_keys        the key set of every table in scope, materialised at
--                      prepare time; batches page over it, never over the
--                      live table. total_rows is the snapshot's size.
--   check units        a run's work is the set of (rule, table, check) units
--                      (fn_dq_check_units). Every number below is defined on
--                      that set — never a rule count minus a rule-table count.
--   prep_errors        a check whose key query failed at prepare time is a
--                      structured error on the run (stage 'keys'); the check is
--                      not evaluated, but the run says so: it counts as a
--                      failed unit, lowers coverage, ends the run
--                      completed_with_errors, and is retried by
--                      fn_dq_retry_prep once the rule is repaired.
--   fn_dq_evaluate_range   the rule loop over one key range, fenced to the
--                      run's key snapshot (OFFSET 0 + `key = any(array(…))`:
--                      the evaluator reads through a row-security policy and
--                      only leakproof equality may become an index probe).
--                      Optionally restricted to a set of rules (retry).
--   fn_dq_settle_run   checks_expected / checks_failed / coverage_pct =
--                      100 × (1 − failed units ÷ expected units);
--                      rules_expected / rules_failed / rules_ok are the
--                      distinct rules behind those units; rule_errors merges
--                      batch errors and prep errors. A run with any failed
--                      unit ends completed_with_errors; its health snapshot
--                      is flagged partial.
--   fn_dq_retry_batch / fn_dq_retry_prep / fn_dq_retry_run   re-evaluate a
--                      failed batch, re-materialise failed key queries and
--                      evaluate them over every batch range, or both; keys
--                      are kept until retention so retries work.
-- Idempotent. DOWN: supabase/rollback/20260919_dq_c_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- ── 1 · schema ──────────────────────────────────────────────────────────────
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.dq_runs'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%status%' loop
    execute format('alter table public.dq_runs drop constraint %I', c.conname);
  end loop;
  alter table public.dq_runs add constraint dq_runs_status_check
    check (status in ('queued', 'running', 'paused', 'completed', 'completed_with_errors', 'failed', 'cancelled'));
end $$;
alter table public.dq_runs
  add column if not exists rules_expected  integer not null default 0,
  add column if not exists rules_ok        integer not null default 0,
  add column if not exists rules_failed    integer not null default 0,
  add column if not exists checks_expected integer not null default 0,
  add column if not exists checks_failed   integer not null default 0,
  add column if not exists coverage_pct    numeric(5,1),
  add column if not exists rule_errors     jsonb not null default '[]'::jsonb,
  add column if not exists prep_errors     jsonb not null default '[]'::jsonb,
  -- 21 Sep 2026: the engine used to count consecutive failures in a
  -- process-local Map. Serverless invocations do not share memory, so a
  -- permanently broken run could stall and restart for ever without the
  -- counter ever reaching its limit. It is a column now, incremented
  -- atomically by fn_dq_run_note_error.
  add column if not exists consecutive_errors integer not null default 0,
  add column if not exists last_engine_error  text;
alter table public.dq_run_batches add column if not exists rule_errors jsonb not null default '[]'::jsonb;
alter table public.dq_health_snapshots add column if not exists partial boolean not null default false;
comment on column public.dq_runs.coverage_pct    is '100 × (1 − failed check units ÷ expected check units). A unit is one (rule, table, check); a unit that errored in any batch, or whose key query failed at prepare, is failed.';
comment on column public.dq_runs.checks_expected is 'Check units (rule, table, check) applicable to the run.';
comment on column public.dq_runs.checks_failed   is 'Check units that errored in a batch or failed key preparation.';
comment on column public.dq_runs.prep_errors     is 'Key-query failures at prepare time: [{rule, rule_id, table, check_idx, stage: "keys", error}]. Retried by fn_dq_retry_prep.';
comment on column public.dq_runs.consecutive_errors is 'Engine failures in a row for this run, counted in the DATABASE so the limit survives a serverless cold start. Reset by any batch that succeeds.';
comment on column public.dq_health_snapshots.partial is 'Taken after a run with failed check units: the scores may under-count.';

create table if not exists public.dq_run_keys (
  run_id     uuid not null references public.dq_runs(id) on delete cascade,
  table_name text not null,
  key        text not null,
  primary key (run_id, table_name, key)
);
alter table public.dq_run_keys enable row level security;
grant select, insert, delete on public.dq_run_keys to service_role;
comment on table public.dq_run_keys is 'The key set of each table in a run, taken at prepare time: batches page over this snapshot, not the live table.';

-- ── 1b · the engine's own failure counter (21 Sep 2026) ────────────────────
-- Records one engine failure against the run and returns the new count, so the
-- caller can decide to give up. Atomic: two invocations that both fail cannot
-- read the same number and each think it is the first.
create or replace function public.fn_dq_run_note_error(p_run_id uuid, p_error text, p_max integer default 3)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare v_n int; v_status text;
begin
  if p_run_id is null then raise exception 'fn_dq_run_note_error: p_run_id is required' using errcode = '22023'; end if;
  update public.dq_runs
     set consecutive_errors = consecutive_errors + 1,
         last_engine_error = left(p_error, 500),
         note = left(coalesce(note || ' · ', '') || format('engine error (%s/%s): %s', consecutive_errors + 1, greatest(1, coalesce(p_max, 3)), left(coalesce(p_error, 'unknown'), 200)), 2000)
   where id = p_run_id
  returning consecutive_errors, status into v_n, v_status;
  if v_n is null then return jsonb_build_object('ok', false, 'reason', 'no_such_run'); end if;
  return jsonb_build_object('ok', true, 'consecutive_errors', v_n, 'give_up', v_n >= greatest(1, coalesce(p_max, 3)), 'status', v_status);
end $$;
revoke all on function public.fn_dq_run_note_error(uuid, text, integer) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_run_note_error(uuid, text, integer) to service_role;

-- A batch that succeeded clears the streak.
create or replace function public.fn_dq_run_clear_errors(p_run_id uuid)
 returns void language sql volatile security definer set search_path to ''
as $$
  update public.dq_runs set consecutive_errors = 0, last_engine_error = null
   where id = p_run_id and consecutive_errors <> 0;
$$;
revoke all on function public.fn_dq_run_clear_errors(uuid) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_run_clear_errors(uuid) to service_role;

-- ── 2 · the units of work ───────────────────────────────────────────────────
-- Every (rule, table, check) with an evaluable expression, for the run's
-- tables and rule filter. Order is stable (rule code, table, check index).
create or replace function public.fn_dq_check_units(p_run_id uuid)
 returns table (rule_id uuid, rule_code text, table_name text, check_idx integer, chk jsonb)
 language sql stable security definer set search_path to ''
as $$
  select ru.id, ru.code, x->>'table', (o - 1)::int, x
    from public.dq_runs run
    join public.dq_rules ru
      on ru.enabled and ru.deleted_at is null and ru.queue and ru.kind in ('declarative', 'sql', 'classification')
     and (run.rule_ids is null or ru.id = any (run.rule_ids))
    cross join lateral jsonb_array_elements(ru.checks) with ordinality as t(x, o)
   where run.id = p_run_id
     and (x->>'table') = any (run.tables)
     and (coalesce(x->>'violation_sql', '') <> '' or coalesce(x->>'query_sql', '') <> '')
   order by ru.code, x->>'table', o;
$$;

-- ── 3 · prepare: snapshot the keys, materialise the SQL-kind key sets ───────
create or replace function public.fn_dq_prepare_run(p_run_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_run public.dq_runs%rowtype; v_est jsonb; v_tables text[]; u record; v_key text; t text; v_scope text; v_rows bigint := 0; n bigint;
        v_prep jsonb := '[]'::jsonb;
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

    -- the key snapshot: what this run will look at, fixed now
    delete from public.dq_run_keys where run_id = p_run_id;
    foreach t in array v_tables loop
      select key_column into v_key from public.dq_tables where table_name = t;
      v_scope := public.fn_dq_scope_where(t, v_run.scope);
      execute format('insert into public.dq_run_keys (run_id, table_name, key) select %L::uuid, %L, r.%I::text from public.%I r where (%s) on conflict do nothing',
                     p_run_id, t, v_key, t, v_scope);
      get diagnostics n = row_count;
      v_rows := v_rows + n;
    end loop;
    update public.dq_runs set tables = v_tables where id = p_run_id;   -- fn_dq_check_units reads them

    -- the SQL-kind checks' key sets, once, as the evaluator. A failure is a
    -- structured prep error on the run — never a silent exclusion.
    delete from public.dq_run_rule_keys where run_id = p_run_id;
    for u in select * from public.fn_dq_check_units(p_run_id) where coalesce(chk->>'query_sql', '') <> '' loop
      select key_column into v_key from public.dq_tables where table_name = u.table_name;
      begin
        perform public.fn_dq_eval_exec(format(
          'insert into public.dq_run_rule_keys (run_id, rule_id, check_idx, key) select %L::uuid, %L::uuid, %s, q.%I::text from (%s) q on conflict do nothing',
          p_run_id, u.rule_id, u.check_idx, v_key, u.chk->>'query_sql'));
      exception when others then
        v_prep := v_prep || jsonb_build_object('rule', u.rule_code, 'rule_id', u.rule_id, 'table', u.table_name, 'check_idx', u.check_idx, 'stage', 'keys', 'error', left(sqlerrm, 300));
      end;
    end loop;

    update public.dq_runs set status = 'running', started_at = clock_timestamp(), tables = v_tables,
      total_rows = v_rows, total_batches = greatest(1, ceil(v_rows::numeric / greatest(v_run.batch_size, 1)))::int,
      scope = (v_est->'scope') || jsonb_build_object('counts', v_est->'tables'),
      prep_errors = v_prep,
      note = case when jsonb_array_length(v_prep) > 0
                  then left(coalesce(note || ' · ', '') || format('%s check(s) could not materialise their keys: %s', jsonb_array_length(v_prep),
                       (select string_agg(e->>'rule' || ' on ' || (e->>'table'), ', ') from jsonb_array_elements(v_prep) e)), 2000)
                  else note end,
      cursor = '{"idx":0,"last":null}'::jsonb
    where id = p_run_id;
  else
    update public.dq_runs set status = 'running' where id = p_run_id;
  end if;
  return jsonb_build_object('status', 'running', 'prep_errors', v_prep);
end $function$;

-- ── 4 · the rule loop over one key range ────────────────────────────────────
create or replace function public.fn_dq_evaluate_range(p_run_id uuid, p_table text, p_from text, p_to text, p_rule_ids uuid[] default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_run public.dq_runs%rowtype; v_key text; v_scope text; v_t0 timestamptz := now();
  r record; u record; v_viol text; v_obs text; v_exp text; v_fix text; v_sql text; v_cnt bigint; v_errs text[] := '{}'; v_rule_errs jsonb := '[]'::jsonb;
  v_pii text[]; v_label text; v_found jsonb := '{"error":0,"warn":0,"info":0}'::jsonb; v_field text; v_units int := 0;
  v_ktype text; v_keyrestrict text;
begin
  select * into v_run from public.dq_runs where id = p_run_id;
  if not found then raise exception 'run % not found', p_run_id; end if;
  select key_column, label_sql, pii_columns into v_key, v_label, v_pii from public.dq_tables where table_name = p_table;
  v_scope := public.fn_dq_scope_where(p_table, v_run.scope);
  -- the rows of the batch come from the key snapshot through a fenced subquery
  select format_type(a.atttypid, a.atttypmod) into v_ktype
    from pg_attribute a where a.attrelid = format('public.%I', p_table)::regclass and a.attname = v_key and not a.attisdropped;
  if v_ktype = 'uuid' or v_ktype = 'text' or v_ktype like 'character varying%' or v_ktype = 'citext' then
    v_keyrestrict := format('r0.%I = any (array(select k.key::%s from public.dq_run_keys k where k.run_id = %L::uuid and k.table_name = %L and k.key >= $1 and k.key <= $2))', v_key, v_ktype, p_run_id, p_table);
  else
    v_keyrestrict := format('r0.%I::text >= $1 and r0.%I::text <= $2', v_key, v_key);
  end if;

  for u in
    select cu.*, ru.severity, ru.category, ru.description, ru.autofix
      from public.fn_dq_check_units(p_run_id) cu join public.dq_rules ru on ru.id = cu.rule_id
     where cu.table_name = p_table and (p_rule_ids is null or cu.rule_id = any (p_rule_ids))
       -- a check whose key query failed at prepare is a recorded failure, not evaluated here
       and not exists (select 1 from jsonb_array_elements(v_run.prep_errors) e
                        where (e->>'rule_id')::uuid = cu.rule_id and (e->>'check_idx')::int = cu.check_idx and e->>'table' = cu.table_name)
  loop
    v_viol := public.fn_dq_check_violation(u.chk, v_key, p_run_id, u.rule_id, u.check_idx);
    if v_viol is null then continue; end if;
    v_units := v_units + 1;
    v_field := u.chk->>'field';
    v_obs := coalesce(u.chk->>'observed_sql', case when v_field is not null and public.fn_dq_has_column(p_table, v_field) then format('r.%I::text', v_field) else 'null::text' end);
    v_exp := case when coalesce(u.chk->>'expected_sql', '') <> '' then '(' || (u.chk->>'expected_sql') || ')::text' else format('%L::text', u.chk->>'expected_text') end;
    v_fix := case when coalesce(u.chk->>'fix_sql', '') <> '' then
      format('case when (%1$s) is not null and (%1$s)::text is distinct from (%2$s) then jsonb_build_object(''field'', %3$L, ''value'', (%1$s)::text, ''before'', (%2$s), ''after'', (%1$s)::text, ''kind'', %4$L, ''confidence'', %5$s, ''rationale'', %6$L) else null end',
             u.chk->>'fix_sql', v_obs, coalesce(u.chk->>'fix_field', v_field), u.autofix, coalesce((u.chk->>'fix_confidence')::numeric, 1), coalesce(u.chk->>'fix_rationale', 'Derived by the rule''s fix expression.'))
      else 'null::jsonb' end;
    begin
      v_sql := format($q$
        with ins as (
          insert into public.dq_issues as di (rule_id, rule_code, run_id, table_name, row_key, row_label, field, observed, expected, severity, category, source, why, snapshot, fix)
          select %L::uuid, %L, %L::uuid, %L, r.%I::text, (%s)::text, %L, (%s)::text, %s, %L, %L, 'rule', %L, (to_jsonb(r) - %L::text[]), %s
          from (select * from public.%I r0 where %s offset 0) r
          where (%s) and (%s)
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
                          when di.status in ('ignored', 'false_positive') and di.suppress_until is not null and di.suppress_until <= now() then 'Reopened — the suppression expired and the record still fails'
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
        u.rule_id, u.rule_code, p_run_id, p_table, v_key, v_label, v_field, v_obs, v_exp, u.severity, u.category,
        coalesce(u.chk->>'message', u.description), coalesce(v_pii, '{}'::text[]), v_fix,
        p_table, v_keyrestrict, v_scope, v_viol);
      v_cnt := public.fn_dq_eval_count(v_sql, p_from, p_to);
      v_found := jsonb_set(v_found, array[u.severity], to_jsonb(coalesce((v_found->>u.severity)::int, 0) + coalesce(v_cnt, 0)));
      update public.dq_issues i set status = 'fixed', reason = 'No longer fails on re-check', resolved_at = now()
      where i.rule_code = u.rule_code and i.table_name = p_table and i.status = 'open' and i.source = 'rule'
        and coalesce(i.field, '') = coalesce(v_field, '') and i.row_key >= p_from and i.row_key <= p_to and i.last_seen < v_t0;
    exception when others then
      v_errs := v_errs || format('%s on %s: %s', u.rule_code, p_table, sqlerrm);
      v_rule_errs := v_rule_errs || jsonb_build_object('rule', u.rule_code, 'rule_id', u.rule_id, 'table', p_table, 'check_idx', u.check_idx, 'stage', 'eval', 'error', left(sqlerrm, 300));
    end;
  end loop;
  return jsonb_build_object('found', v_found, 'rules', v_units, 'errors', to_jsonb(v_errs), 'rule_errors', v_rule_errs);
end $function$;

-- ── 5 · the batch pages over the snapshot ───────────────────────────────────
create or replace function public.fn_dq_process_batch(p_run_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_run public.dq_runs%rowtype; v_tables text[]; v_idx int; v_last text; v_table text;
  v_keys text[]; v_from text; v_to text; v_n int; v_batch_id uuid; v_batch_n int; v_clock timestamptz := clock_timestamp();
  v_res jsonb; v_errs text[]; v_found jsonb;
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status <> 'running' then return jsonb_build_object('done', true, 'status', v_run.status); end if;

  v_tables := v_run.tables; v_idx := coalesce((v_run.cursor->>'idx')::int, 0); v_last := v_run.cursor->>'last';
  loop
    if v_idx >= coalesce(array_length(v_tables, 1), 0) then
      perform public.fn_dq_finish_run(p_run_id, 'completed', null);
      return jsonb_build_object('done', true, 'status', (select status from public.dq_runs where id = p_run_id));
    end if;
    v_table := v_tables[v_idx + 1];
    select array_agg(k order by k) into v_keys
      from (select key k from public.dq_run_keys where run_id = p_run_id and table_name = v_table and (v_last is null or key > v_last) order by key limit v_run.batch_size) s;
    if v_keys is null or array_length(v_keys, 1) = 0 then v_idx := v_idx + 1; v_last := null; continue; end if;
    exit;
  end loop;

  v_from := v_keys[1]; v_to := v_keys[array_length(v_keys, 1)]; v_n := array_length(v_keys, 1);
  v_batch_n := v_run.batches_done + 1;
  insert into public.dq_run_batches (run_id, n, table_name, key_from, key_to, rows, status, started_at)
  values (p_run_id, v_batch_n, v_table, v_from, v_to, v_n, 'running', clock_timestamp()) returning id into v_batch_id;

  v_res := public.fn_dq_evaluate_range(p_run_id, v_table, v_from, v_to);
  v_errs := coalesce((select array_agg(x) from jsonb_array_elements_text(v_res->'errors') x), '{}'::text[]);
  v_found := v_res->'found';

  update public.dq_run_batches set status = case when array_length(v_errs, 1) > 0 then 'failed' else 'done' end, found = v_found,
    ms = (extract(epoch from (clock_timestamp() - v_clock)) * 1000)::int,
    error = nullif(array_to_string(v_errs, ' · '), ''), rule_errors = coalesce(v_res->'rule_errors', '[]'::jsonb), finished_at = clock_timestamp()
  where id = v_batch_id;

  update public.dq_runs set rows_done = rows_done + v_n, batches_done = batches_done + 1, last_batch_at = clock_timestamp(),
    cursor = jsonb_build_object('idx', v_idx, 'last', v_to),
    found = jsonb_build_object('error', (dq_runs.found->>'error')::int + (v_found->>'error')::int, 'warn', (dq_runs.found->>'warn')::int + (v_found->>'warn')::int, 'info', (dq_runs.found->>'info')::int + (v_found->>'info')::int),
    note = case when array_length(v_errs, 1) > 0 then left(coalesce(note || ' · ', '') || format('batch %s: %s', v_batch_n, array_to_string(v_errs, ' · ')), 2000) else note end
  where id = p_run_id;

  return jsonb_build_object('done', false, 'batch_id', v_batch_id, 'n', v_batch_n, 'table', v_table, 'key_from', v_from, 'key_to', v_to,
                            'rows', v_n, 'rules', (v_res->>'rules')::int, 'found', v_found, 'errors', v_res->'errors');
end $function$;

-- ── 6 · health snapshots know whether they are partial ──────────────────────
drop function if exists public.fn_dq_snapshot_health();
create or replace function public.fn_dq_snapshot_health(p_partial boolean default false) returns void
language plpgsql security definer set search_path to '' as $$
declare x jsonb; v_at timestamptz := clock_timestamp();   -- two settles in one transaction get distinct snapshots
begin
  for x in select jsonb_array_elements(public.fn_dq_health()) loop
    insert into public.dq_health_snapshots (table_name, at, rows, open_error, open_warn, open_info, score, partial)
    values (x->>'table', v_at, (x->>'rows')::int, (x->>'open_error')::int, (x->>'open_warn')::int, (x->>'open_info')::int, (x->>'score')::numeric, p_partial)
    on conflict (table_name, at) do update set rows = excluded.rows, open_error = excluded.open_error, open_warn = excluded.open_warn, open_info = excluded.open_info, score = excluded.score, partial = excluded.partial;
  end loop;
end $$;

create or replace function public.fn_dq_health_cached(p_max_age interval default interval '10 minutes')
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_at timestamptz; v_out jsonb;
begin
  select max(at) into v_at from public.dq_health_snapshots;
  if v_at is not null and v_at > now() - p_max_age then
    select coalesce(jsonb_agg(jsonb_build_object('table', s.table_name, 'label', t.label, 'rows', s.rows, 'open_error', s.open_error, 'open_warn', s.open_warn, 'open_info', s.open_info,
             'open', s.open_error + s.open_warn + s.open_info, 'score', s.score, 'href', t.admin_href, 'cached_at', s.at, 'partial', s.partial,
             'coverage', (select count(*) from public.dq_rules r where r.enabled and r.deleted_at is null and r.tables @> array[s.table_name])) order by t.sort_order), '[]'::jsonb)
      into v_out
      from public.dq_health_snapshots s join public.dq_tables t on t.table_name = s.table_name where s.at = v_at;
    return v_out;
  end if;
  v_out := public.fn_dq_health();
  perform public.fn_dq_snapshot_health(false);
  return v_out;
end $function$;

-- ── 7 · settle: units, coverage, status, snapshot, record-gone sweep ────────
create or replace function public.fn_dq_settle_run(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_run public.dq_runs%rowtype; v_units int; v_failed_units int; v_rules int; v_failed_rules int; v_errs jsonb; v_status text; t text; v_key text; n int;
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;

  -- every unit the run was expected to evaluate
  select count(*), count(distinct cu.rule_id) into v_units, v_rules from public.fn_dq_check_units(p_run_id) cu;

  -- every failed unit: an evaluation error in any batch, or a key query that
  -- failed at prepare — merged into one structured list
  with batch_errs as (
    select e from public.dq_run_batches b, jsonb_array_elements(b.rule_errors) e where b.run_id = p_run_id and b.status = 'failed'
  ), all_errs as (
    select e from batch_errs union all select e from jsonb_array_elements(v_run.prep_errors) e
  )
  select coalesce(jsonb_agg(distinct e), '[]'::jsonb),
         count(distinct (e->>'rule_id', e->>'table', coalesce(e->>'check_idx', '0'))),
         count(distinct e->>'rule_id')
    into v_errs, v_failed_units, v_failed_rules
    from all_errs;

  v_status := case when v_failed_units > 0 then 'completed_with_errors' else 'completed' end;
  update public.dq_runs
     set status = v_status,
         checks_expected = v_units, checks_failed = least(v_failed_units, v_units),
         rules_expected = v_rules, rules_failed = least(v_failed_rules, v_rules), rules_ok = greatest(v_rules - v_failed_rules, 0),
         coverage_pct = case when v_units = 0 then 100 else round(100 * (1 - least(v_failed_units, v_units)::numeric / v_units), 1) end,
         rule_errors = v_errs,
         found = coalesce((select jsonb_build_object('error', sum((bt.found->>'error')::int), 'warn', sum((bt.found->>'warn')::int), 'info', sum((bt.found->>'info')::int)) from public.dq_run_batches bt where bt.run_id = p_run_id), dq_runs.found),
         finished_at = coalesce(finished_at, clock_timestamp()),
         duration_ms = coalesce(duration_ms, extract(epoch from (clock_timestamp() - coalesce(started_at, created_at))) * 1000),
         error = null
   where id = p_run_id;
  if v_status = 'completed' and coalesce(v_run.scope->>'kind', 'db') in ('db', 'tables') then
    -- the run saw every row of these tables: an open issue whose row is missing is about a record that is gone
    foreach t in array coalesce(v_run.tables, '{}'::text[]) loop
      select key_column into v_key from public.dq_tables where table_name = t;
      if v_key is null then continue; end if;
      execute format($q$
        update public.dq_issues i set status = 'record_gone', reason = 'Record no longer exists', resolved_at = now()
         where i.table_name = %L and i.status in ('open', 'escalated')
           and not exists (select 1 from public.%I r where r.%I::text = i.row_key) $q$, t, t, v_key);
      get diagnostics n = row_count;
      if n > 0 then update public.dq_runs set note = left(coalesce(note || ' · ', '') || format('%s: %s issue(s) closed — record gone', t, n), 2000) where id = p_run_id; end if;
    end loop;
  end if;
  perform public.fn_dq_snapshot_health(v_status <> 'completed');
  -- the notification outbox (workstream G) is filled here, inside the same
  -- transaction as the settlement, so a finished run is always announced
  if to_regclass('public.dq_notification_outbox') is not null then
    perform public.fn_dq_outbox_enqueue('run_finished', 'run/' || p_run_id::text, jsonb_build_object('run_id', p_run_id, 'status', v_status));
  end if;
  return jsonb_build_object('status', v_status, 'checks_expected', v_units, 'checks_failed', v_failed_units, 'rules_expected', v_rules, 'rules_failed', v_failed_rules,
                            'coverage_pct', (select coverage_pct from public.dq_runs where id = p_run_id));
end $$;

create or replace function public.fn_dq_finish_run(p_run_id uuid, p_status text, p_error text default null)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if p_status = 'completed' then
    perform public.fn_dq_settle_run(p_run_id);
    return;
  end if;
  update public.dq_runs set status = p_status, finished_at = clock_timestamp(), error = coalesce(p_error, error),
    duration_ms = extract(epoch from (clock_timestamp() - coalesce(started_at, created_at))) * 1000
  where id = p_run_id;
  if p_status = 'failed' and to_regclass('public.dq_notification_outbox') is not null then
    perform public.fn_dq_outbox_enqueue('run_finished', 'run/' || p_run_id::text, jsonb_build_object('run_id', p_run_id, 'status', p_status));
  end if;
  -- keys stay until retention so a failed run can be retried
end $function$;

-- ── 8 · retries ─────────────────────────────────────────────────────────────
create or replace function public.fn_dq_retry_batch(p_run_id uuid, p_n integer) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_run public.dq_runs%rowtype; b public.dq_run_batches%rowtype; v_res jsonb; v_errs text[]; v_clock timestamptz := clock_timestamp();
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status not in ('completed_with_errors', 'failed') then
    raise exception 'only a run that completed with errors (or failed) can be retried; this one is %', v_run.status using errcode = '55000';
  end if;
  select * into b from public.dq_run_batches where run_id = p_run_id and n = p_n;
  if not found then raise exception 'batch % not found', p_n using errcode = 'P0002'; end if;
  if b.status <> 'failed' then return jsonb_build_object('skipped', true, 'status', b.status); end if;
  if not exists (select 1 from public.dq_run_keys where run_id = p_run_id) then
    raise exception 'this run''s key snapshot has been retired; start a new run instead' using errcode = '55000';
  end if;
  v_res := public.fn_dq_evaluate_range(p_run_id, b.table_name, b.key_from, b.key_to);
  v_errs := coalesce((select array_agg(x) from jsonb_array_elements_text(v_res->'errors') x), '{}'::text[]);
  update public.dq_run_batches set status = case when array_length(v_errs, 1) > 0 then 'failed' else 'done' end, found = v_res->'found',
    ms = (extract(epoch from (clock_timestamp() - v_clock)) * 1000)::int,
    error = nullif(array_to_string(v_errs, ' · '), ''), rule_errors = coalesce(v_res->'rule_errors', '[]'::jsonb), finished_at = clock_timestamp()
  where id = b.id;
  return public.fn_dq_settle_run(p_run_id) || jsonb_build_object('batch', p_n, 'batch_status', case when array_length(v_errs, 1) > 0 then 'failed' else 'done' end);
end $$;

-- Re-materialise the key queries that failed at prepare; every check that now
-- succeeds is evaluated over every batch range the run covered.
create or replace function public.fn_dq_retry_prep(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_run public.dq_runs%rowtype; e jsonb; v_key text; v_still jsonb := '[]'::jsonb; v_fixed uuid[] := '{}'; v_fixed_n int := 0; b record; v_res jsonb; v_errs text[]; v_chk jsonb;
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status not in ('completed_with_errors', 'failed') then
    raise exception 'only a run that completed with errors (or failed) can be retried; this one is %', v_run.status using errcode = '55000';
  end if;
  if jsonb_array_length(v_run.prep_errors) = 0 then return jsonb_build_object('retried', 0, 'still_failed', 0); end if;
  if not exists (select 1 from public.dq_run_keys where run_id = p_run_id) then
    raise exception 'this run''s key snapshot has been retired; start a new run instead' using errcode = '55000';
  end if;
  for e in select x from jsonb_array_elements(v_run.prep_errors) x loop
    select key_column into v_key from public.dq_tables where table_name = e->>'table';
    select x into v_chk from public.dq_rules ru, jsonb_array_elements(ru.checks) with ordinality as t(x, o)
     where ru.id = (e->>'rule_id')::uuid and (o - 1) = (e->>'check_idx')::int;
    if v_chk is null or coalesce(v_chk->>'query_sql', '') = '' then
      -- the check no longer exists or is no longer a key query: nothing left to retry
      v_fixed := v_fixed || (e->>'rule_id')::uuid; v_fixed_n := v_fixed_n + 1; continue;
    end if;
    begin
      delete from public.dq_run_rule_keys where run_id = p_run_id and rule_id = (e->>'rule_id')::uuid and check_idx = (e->>'check_idx')::int;
      perform public.fn_dq_eval_exec(format(
        'insert into public.dq_run_rule_keys (run_id, rule_id, check_idx, key) select %L::uuid, %L::uuid, %s, q.%I::text from (%s) q on conflict do nothing',
        p_run_id, e->>'rule_id', e->>'check_idx', v_key, v_chk->>'query_sql'));
      v_fixed := v_fixed || (e->>'rule_id')::uuid; v_fixed_n := v_fixed_n + 1;
    exception when others then
      v_still := v_still || (e || jsonb_build_object('error', left(sqlerrm, 300)));
    end;
  end loop;
  update public.dq_runs set prep_errors = v_still where id = p_run_id;
  -- the repaired rules over every batch range the run covered (their other
  -- checks are re-evaluated too: the upsert is idempotent)
  if v_fixed_n > 0 then
    for b in select * from public.dq_run_batches where run_id = p_run_id and status in ('done', 'failed') order by n loop
      v_res := public.fn_dq_evaluate_range(p_run_id, b.table_name, b.key_from, b.key_to, v_fixed);
      v_errs := coalesce((select array_agg(x) from jsonb_array_elements_text(v_res->'errors') x), '{}'::text[]);
      if array_length(v_errs, 1) > 0 then
        update public.dq_run_batches set status = 'failed', error = left(coalesce(error || ' · ', '') || array_to_string(v_errs, ' · '), 2000),
               rule_errors = rule_errors || coalesce(v_res->'rule_errors', '[]'::jsonb) where id = b.id;
      end if;
    end loop;
    -- 21 Sep 2026: the repaired checks have just raised findings, but the
    -- BATCH totals still hold the numbers from before the repair — and
    -- fn_dq_settle_run rebuilds the run's `found` by summing those batches. A
    -- retry therefore used to end with a completed run whose error and warning
    -- counts were understated.
    --
    -- Recompute each re-evaluated batch's totals from the findings themselves,
    -- rather than adding what fn_dq_evaluate_range reported: the issue upsert
    -- is idempotent, so a re-evaluation reports every failing row it saw, new
    -- or not, and adding that would double-count the rows the batch had
    -- already recorded.
    --
    -- The predicate matches what a batch counts as it evaluates, exactly, or
    -- the two numbers would disagree in a new way:
    --   source = 'rule'                the AI step keeps its own counters
    --                                  (dq_run_batches.ai_issues); `found` is
    --                                  the rule evaluation's number alone
    --   status in ('open','escalated') the evaluator's RETURNING clause counts
    --                                  every failing row except one left
    --                                  suppressed (ignored / false_positive),
    --                                  and escalated is not suppressed. The
    --                                  resolved states ('fixed',
    --                                  'record_gone', 'rule_disabled',
    --                                  'check_removed') are rows that no
    --                                  longer fail, and are not findings.
    --   run_id = p_run_id              the upsert reassigns run_id to the
    --                                  current run, so this is every row this
    --                                  run judged, not only the new ones
    update public.dq_run_batches bt
       set found = coalesce((
             select jsonb_build_object(
                      'error', count(*) filter (where i.severity = 'error'),
                      'warn',  count(*) filter (where i.severity = 'warn'),
                      'info',  count(*) filter (where i.severity = 'info'))
               from public.dq_issues i
              where i.run_id = p_run_id
                and i.source = 'rule'
                and i.table_name = bt.table_name
                and i.row_key >= bt.key_from and i.row_key <= bt.key_to
                and i.status in ('open', 'escalated')), '{"error":0,"warn":0,"info":0}'::jsonb)
     where bt.run_id = p_run_id and bt.status in ('done', 'failed');
  end if;
  return public.fn_dq_settle_run(p_run_id) || jsonb_build_object('retried', v_fixed_n, 'still_failed', jsonb_array_length(v_still));
end $$;

-- Everything at once: repaired key queries, then every failed batch.
create or replace function public.fn_dq_retry_run(p_run_id uuid) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare v_prep jsonb; b record; v_batches int := 0; v_still int := 0; v_res jsonb;
begin
  v_prep := public.fn_dq_retry_prep(p_run_id);
  for b in select n from public.dq_run_batches where run_id = p_run_id and status = 'failed' order by n loop
    v_res := public.fn_dq_retry_batch(p_run_id, b.n);
    v_batches := v_batches + 1;
    if v_res->>'batch_status' = 'failed' then v_still := v_still + 1; end if;
  end loop;
  return public.fn_dq_settle_run(p_run_id) || jsonb_build_object('prep_retried', v_prep->'retried', 'prep_still_failed', v_prep->'still_failed', 'batches_retried', v_batches, 'batches_still_failed', v_still);
end $$;

-- ── 9 · retention retires key snapshots of old runs ─────────────────────────
create or replace function public.fn_dq_retention(p_issue_days integer default 90, p_gate_days integer default 30, p_snapshot_days integer default 180)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare a int; b int; c int; d int; e int;
begin
  delete from public.dq_issues where status <> 'open' and coalesce(resolved_at, last_seen) < now() - make_interval(days => p_issue_days);
  get diagnostics a = row_count;
  delete from public.dq_gate_log where at < now() - make_interval(days => p_gate_days);
  get diagnostics b = row_count;
  delete from public.dq_health_snapshots where at < now() - make_interval(days => p_snapshot_days);
  get diagnostics c = row_count;
  delete from public.dq_run_rule_keys k using public.dq_runs r where r.id = k.run_id and r.status not in ('queued', 'running', 'paused') and coalesce(r.finished_at, r.created_at) < now() - interval '7 days';
  get diagnostics d = row_count;
  delete from public.dq_run_keys k using public.dq_runs r where r.id = k.run_id and r.status not in ('queued', 'running', 'paused') and coalesce(r.finished_at, r.created_at) < now() - interval '7 days';
  get diagnostics e = row_count;
  return jsonb_build_object('issues', a, 'gate_log', b, 'snapshots', c, 'run_keys', d + e);
end $function$;

-- ── 10 · grants ─────────────────────────────────────────────────────────────
revoke all on function public.fn_dq_check_units(uuid) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_evaluate_range(uuid, text, text, text, uuid[]) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_settle_run(uuid) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_retry_batch(uuid, integer) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_retry_prep(uuid) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_retry_run(uuid) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_snapshot_health(boolean) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_prepare_run(uuid), public.fn_dq_process_batch(uuid), public.fn_dq_finish_run(uuid, text, text), public.fn_dq_health_cached(interval), public.fn_dq_retention(integer, integer, integer) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_check_units(uuid) to service_role;
grant execute on function public.fn_dq_evaluate_range(uuid, text, text, text, uuid[]) to service_role;
grant execute on function public.fn_dq_settle_run(uuid) to service_role;
grant execute on function public.fn_dq_retry_batch(uuid, integer) to service_role;
grant execute on function public.fn_dq_retry_prep(uuid) to service_role;
grant execute on function public.fn_dq_retry_run(uuid) to service_role;
grant execute on function public.fn_dq_snapshot_health(boolean) to service_role;
grant execute on function public.fn_dq_prepare_run(uuid), public.fn_dq_process_batch(uuid), public.fn_dq_finish_run(uuid, text, text), public.fn_dq_health_cached(interval), public.fn_dq_retention(integer, integer, integer) to service_role;
-- the evaluator reads the key snapshot through the fence (workstream A allowlist)
insert into public.dq_evaluator_relations (relation_name, reason, added_by) values
  ('dq_run_keys', 'the batch''s rows come from the run key snapshot (fn_dq_evaluate_range)', 'migration 20260919130000')
on conflict (relation_name) do nothing;

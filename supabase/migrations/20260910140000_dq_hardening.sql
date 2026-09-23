-- ════════════════════════════════════════════════════════════════════════
-- Data quality — hardening after the 10 Sep 2026 audit
--
-- Findings addressed here (codes from docs/data-quality-audit.html):
--   S1  helper functions executable by anon / authenticated → revoked (§8)
--   S2  rule SQL ran as the postgres owner behind a keyword blacklist →
--       rule SQL now runs as an unprivileged role, dq_evaluator (§1–§2)
--   S6  dq_apply_fix accepted any column from the client (§5)
--   C3  AI token metering was read-modify-write (§6)
--   C5  a rule whose SQL throws stopped blocking silently (§4)
--   C6  dq_settings.batch_size had no bounds (§6)
--   C7  run / batch timestamps used now() (§3)
--   U1  health score counted issues, not rows, and saturated at 0 (§7)
--   U2  DQ-F01 / DQ-C01 flooded the queue (counter-only rules) (§7)
--   U3  three registry rules fired against an empty registry (§7)
--   P1  SQL-kind rules re-scanned the table on every batch (§3)
--   P2/P3/P4/P5/P7 grouped counts, rule stats, cached health, set-based
--       apply, retention (§6–§7)
--
-- The boundary (S2). SET ROLE cannot be used for this inside a SECURITY
-- DEFINER function called through PostgREST — membership is checked against
-- the session user, and RESET ROLE would hand the rest of the function to
-- that session user. So the boundary is ownership instead: a handful of tiny
-- SECURITY DEFINER "evaluator" functions are OWNED BY dq_evaluator, and every
-- piece of rule-authored SQL is executed through one of them. Inside them the
-- current user IS dq_evaluator: SELECT on the registered tables (with a
-- read-through RLS policy), INSERT/UPDATE on dq_issues and dq_run_rule_keys
-- only, EXECUTE on the nine read-only helpers rules legitimately call, and
-- nothing else. The keyword blacklist stays as a first-line lint.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · the evaluator role ──────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dq_evaluator') then
    create role dq_evaluator nologin;
  end if;
end $$;
grant dq_evaluator to postgres;                       -- so postgres may make it own functions
grant usage on schema public to dq_evaluator;
grant select on all tables in schema public to dq_evaluator;
grant insert, update on public.dq_issues to dq_evaluator;

-- Rules may call these — and only these — helpers.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'fn_dq_imo_valid', 'fn_normalize_flag', 'fn_resolve_port_locode', 'fn_resolve_port_side',
      'fn_resolve_port_area', 'fn_port_key', 'fn_port_strip_notation', 'fn_port_options', 'fn_dq_has_column')
  loop
    execute format('grant execute on function %s to dq_evaluator', f.sig);
  end loop;
end $$;

-- Read-through RLS for the evaluator on every RLS-enabled table (rules read
-- the registered tables plus their lookups; the role can write nowhere).
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    begin
      if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.relname and policyname = 'dq_evaluator_read') then
        execute format('create policy dq_evaluator_read on public.%I for select to dq_evaluator using (true)', t.relname);
      end if;
    exception when others then
      raise notice 'dq_evaluator_read on %: %', t.relname, sqlerrm;
    end;
  end loop;
end $$;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'dq_issues' and policyname = 'dq_evaluator_write') then
    create policy dq_evaluator_write on public.dq_issues for insert to dq_evaluator with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dq_issues' and policyname = 'dq_evaluator_update') then
    create policy dq_evaluator_update on public.dq_issues for update to dq_evaluator using (true) with check (true);
  end if;
end $$;

-- ── 2 · the evaluator functions (owned by dq_evaluator) ─────────────────────
-- Each executes exactly one statement it is handed. Owned by dq_evaluator, so
-- inside them current_user is dq_evaluator whatever called them.
create or replace function public.fn_dq_eval_bool(p_sql text, p_row jsonb)
 returns boolean language plpgsql security definer set search_path to ''
as $$ declare v boolean; begin execute p_sql using p_row into v; return coalesce(v, false); end $$;

create or replace function public.fn_dq_eval_keys(p_sql text)
 returns text[] language plpgsql security definer set search_path to ''
as $$ declare v text[]; begin execute p_sql into v; return coalesce(v, '{}'::text[]); end $$;

create or replace function public.fn_dq_eval_count(p_sql text, p_a text default null, p_b text default null)
 returns bigint language plpgsql security definer set search_path to ''
as $$ declare v bigint; begin execute p_sql using p_a, p_b into v; return coalesce(v, 0); end $$;

create or replace function public.fn_dq_eval_json(p_sql text, p_a text default null, p_b text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $$ declare v jsonb; begin execute p_sql using p_a, p_b into v; return v; end $$;

create or replace function public.fn_dq_eval_hits(p_sql text, p_batch uuid, p_row uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $$ declare v jsonb; begin execute p_sql using p_batch, p_row into v; return coalesce(v, '[]'::jsonb); end $$;

create or replace function public.fn_dq_eval_exec(p_sql text)
 returns integer language plpgsql security definer set search_path to ''
as $$ declare n integer; begin execute p_sql; get diagnostics n = row_count; return n; end $$;

-- Hand them to the evaluator. Ownership transfer needs CREATE on the schema
-- for a moment; it is taken back straight after.
grant create on schema public to dq_evaluator;
alter function public.fn_dq_eval_bool(text, jsonb)        owner to dq_evaluator;
alter function public.fn_dq_eval_keys(text)               owner to dq_evaluator;
alter function public.fn_dq_eval_count(text, text, text)  owner to dq_evaluator;
alter function public.fn_dq_eval_json(text, text, text)   owner to dq_evaluator;
alter function public.fn_dq_eval_hits(text, uuid, uuid)   owner to dq_evaluator;
alter function public.fn_dq_eval_exec(text)               owner to dq_evaluator;
revoke create on schema public from dq_evaluator;
-- postgres (owner of the callers) must still be allowed to call them
grant execute on function public.fn_dq_eval_bool(text, jsonb), public.fn_dq_eval_keys(text),
  public.fn_dq_eval_count(text, text, text), public.fn_dq_eval_json(text, text, text),
  public.fn_dq_eval_hits(text, uuid, uuid), public.fn_dq_eval_exec(text) to postgres;

-- ── 3 · per-run key sets for SQL-kind rules (P1) + honest timestamps (C7) ──
create table if not exists public.dq_run_rule_keys (
  run_id    uuid not null references public.dq_runs(id) on delete cascade,
  rule_id   uuid not null,
  check_idx integer not null,
  key       text not null,
  primary key (run_id, rule_id, check_idx, key)
);
comment on table public.dq_run_rule_keys is
  'Keys matched by each SQL-kind rule check, materialised ONCE at run start (fn_dq_prepare_run). Batches join against this instead of re-running the query.';
alter table public.dq_run_rule_keys enable row level security;
grant select, insert on public.dq_run_rule_keys to dq_evaluator;
do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'dq_run_rule_keys' and policyname = 'dq_evaluator_read') then
    create policy dq_evaluator_read on public.dq_run_rule_keys for select to dq_evaluator using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'dq_run_rule_keys' and policyname = 'dq_evaluator_write') then
    create policy dq_evaluator_write on public.dq_run_rule_keys for insert to dq_evaluator with check (true);
  end if;
end $$;

-- Counter-only rules (U2): scored, never queued.
alter table public.dq_rules add column if not exists queue boolean not null default true;
comment on column public.dq_rules.queue is
  'false = the rule is a counter: batch runs skip filing issues for it. Freshness and house-format rules belong on a dashboard strip, not in a triage queue.';

-- Preview / cost path: keys are evaluated as dq_evaluator.
create or replace function public.fn_dq_check_violation(p_check jsonb, p_key text)
 returns text language plpgsql stable set search_path to ''
as $function$
declare v_keys text[];
begin
  if coalesce(p_check->>'query_sql', '') <> '' then
    v_keys := public.fn_dq_eval_keys(format('select coalesce(array_agg(q.%I::text), ''{}''::text[]) from (%s) q', p_key, p_check->>'query_sql'));
    return format('r.%I::text = any (%L::text[])', p_key, v_keys);
  elsif coalesce(p_check->>'violation_sql', '') <> '' then
    return p_check->>'violation_sql';
  end if;
  return null;
end $function$;

-- Run path: the key set was materialised at prepare time; join it.
create or replace function public.fn_dq_check_violation(p_check jsonb, p_key text, p_run_id uuid, p_rule_id uuid, p_idx integer)
 returns text language sql immutable set search_path to ''
as $$
  select case
    when coalesce(p_check->>'query_sql', '') <> '' then
      format('r.%I::text in (select k.key from public.dq_run_rule_keys k where k.run_id = %L and k.rule_id = %L and k.check_idx = %s)', p_key, p_run_id, p_rule_id, p_idx)
    when coalesce(p_check->>'violation_sql', '') <> '' then p_check->>'violation_sql'
    else null end;
$$;

create or replace function public.fn_dq_prepare_run(p_run_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
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
end $function$;

create or replace function public.fn_dq_finish_run(p_run_id uuid, p_status text, p_error text default null)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  update public.dq_runs set status = p_status, finished_at = clock_timestamp(), error = coalesce(p_error, error),
    duration_ms = extract(epoch from (clock_timestamp() - coalesce(started_at, created_at))) * 1000
  where id = p_run_id;
  if p_status in ('completed', 'failed', 'cancelled') then
    delete from public.dq_run_rule_keys where run_id = p_run_id;
  end if;
  if p_status = 'completed' then perform public.fn_dq_snapshot_health(); end if;
end $function$;

create or replace function public.fn_dq_process_batch(p_run_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
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
end $function$;

-- ── 4 · the gate: evaluator boundary + visible failures (C5) ────────────────
create or replace function public.fn_dq_validate(p_table text, p_row jsonb, p_channel text default 'admin', p_actor text default null, p_actor_id uuid default null, p_log boolean default true)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
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
end $function$;

-- Staging gate: the predicate is evaluated as dq_evaluator (read-only), then
-- the owner applies the flags. The evaluator never touches sync_staged_row.
create or replace function public.fn_dq_gate_batch(p_batch_id uuid, p_channel text default 'sync', p_actor text default null, p_row_id uuid default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r record; c jsonb; t text; v_tables text[]; v_key text; v_mode text; v_sql text; v_hits jsonb; n int;
        v_blocked int := 0; v_warned int := 0; v_rules int := 0; v_errs text[] := '{}';
begin
  -- 1 · undo a previous pass on the rows in scope
  update public.sync_staged_row s
     set classification = coalesce((select f->>'prev' from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f ? 'prev' limit 1), s.classification)
   where s.batch_id = p_batch_id and (p_row_id is null or s.id = p_row_id) and not s.committed and s.classification = 'invalid'
     and exists (select 1 from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f ? 'prev');
  update public.sync_staged_row s
     set flags = coalesce((select jsonb_agg(f) from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where not (f ? 'rule')), '[]'::jsonb)
   where s.batch_id = p_batch_id and (p_row_id is null or s.id = p_row_id) and not s.committed;

  select array_agg(distinct target_table) into v_tables
  from public.sync_staged_row where batch_id = p_batch_id and (p_row_id is null or id = p_row_id) and not committed;

  -- 2 · every rule with a check on the table, on this channel, over the merged image (live row || staged payload)
  foreach t in array coalesce(v_tables, '{}'::text[]) loop
    v_key := public.fn_sync_key_column(t);
    for r in
      select ru.* from public.dq_rules ru
      where ru.enabled and ru.deleted_at is null and ru.kind in ('declarative', 'classification') and ru.tables @> array[t]
      order by ru.severity, ru.code
    loop
      v_mode := public.fn_dq_effective_mode(r.id, p_channel);
      if v_mode = 'audit' then continue; end if;
      for c in select x from jsonb_array_elements(r.checks) x where x->>'table' = t and coalesce(x->>'violation_sql', '') <> '' loop
        v_rules := v_rules + 1;
        begin
          v_sql := format($q$
            select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'bk', s.business_key)), '[]'::jsonb)
              from public.sync_staged_row s
             where s.batch_id = $1 and s.target_table = %L and not s.committed and s.classification in ('new', 'updated', 'invalid')
               and ($2::uuid is null or s.id = $2::uuid)
               and (select coalesce((%s), false)
                    from (select (jsonb_populate_record(null::public.%I,
                                    coalesce((select to_jsonb(e) from public.%I e where %s), '{}'::jsonb) || s.payload)).*) r) $q$,
            t, c->>'violation_sql', t, t,
            case when v_key is null then 'false' else format('e.%I::text = s.business_key', v_key) end);
          v_hits := public.fn_dq_eval_hits(v_sql, p_batch_id, p_row_id);
          n := jsonb_array_length(v_hits);
          if n > 0 then
            update public.sync_staged_row s
               set flags = coalesce(s.flags, '[]'::jsonb) || jsonb_build_object('level', case when v_mode = 'block' then 'error' else 'warn' end, 'field', c->>'field',
                                                                                   'msg', r.code || ' · ' || coalesce(c->>'message', r.description), 'rule', r.code, 'mode', v_mode)
             where s.id in (select (h->>'id')::uuid from jsonb_array_elements(v_hits) h);
            if v_mode = 'block' then
              insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, mode, message)
              select p_channel, r.code, t, h->>'bk', p_actor, 'block', coalesce(c->>'message', r.description) from jsonb_array_elements(v_hits) h;
              v_blocked := v_blocked + n;
            else
              v_warned := v_warned + n;
            end if;
          end if;
        exception when others then
          v_errs := v_errs || format('%s on %s: %s', r.code, t, sqlerrm);
          insert into public.dq_gate_log (channel, rule_code, table_name, row_key, actor, mode, message)
          values (p_channel, r.code, t, null, p_actor, 'error', left('rule did not evaluate: ' || sqlerrm, 500));
        end;
      end loop;
    end loop;
  end loop;

  -- 3 · block-level hits stop the commit: the row becomes invalid, remembering its class for a re-run
  update public.sync_staged_row s
     set flags = coalesce(s.flags, '[]'::jsonb) || jsonb_build_object('level', 'info', 'rule', 'GATE', 'prev', s.classification, 'msg', 'blocked by the data-quality gate on channel ' || p_channel || ' — fix the flagged cells and the row rejoins the commit'),
         classification = 'invalid'
   where s.batch_id = p_batch_id and (p_row_id is null or s.id = p_row_id) and not s.committed and s.classification in ('new', 'updated')
     and exists (select 1 from jsonb_array_elements(coalesce(s.flags, '[]'::jsonb)) f where f->>'level' = 'error' and f ? 'rule');

  return jsonb_build_object('blocked', v_blocked, 'warned', v_warned, 'rules', v_rules, 'tables', to_jsonb(coalesce(v_tables, '{}'::text[])), 'errors', to_jsonb(v_errs));
end $function$;

-- Rule editor: preview and cost, both through the evaluator.
create or replace function public.fn_dq_rule_preview(p_rule_id uuid, p_table text default null, p_limit integer default 200)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r public.dq_rules%rowtype; c jsonb; v_key text; v_label text; v_viol text; v_obs text; v_exp text; v_res jsonb; v_out jsonb := '[]'::jsonb; v_t0 timestamptz := clock_timestamp(); v_total int := 0; v_checked bigint := 0; v_t text;
begin
  select * into r from public.dq_rules where id = p_rule_id;
  if not found then raise exception 'rule not found'; end if;
  for c in select x from jsonb_array_elements(r.checks) x where p_table is null or x->>'table' = p_table loop
    v_t := c->>'table';
    select key_column, label_sql into v_key, v_label from public.dq_tables where table_name = v_t;
    v_viol := public.fn_dq_check_violation(c, v_key);
    if v_viol is null then continue; end if;
    v_obs := coalesce(c->>'observed_sql', case when c->>'field' is not null and public.fn_dq_has_column(v_t, c->>'field') then format('r.%I::text', c->>'field') else 'null::text' end);
    v_exp := case when coalesce(c->>'expected_sql', '') <> '' then '(' || (c->>'expected_sql') || ')::text' else format('%L::text', c->>'expected_text') end;
    v_checked := v_checked + public.fn_dq_eval_count(format('select count(*) from public.%I r', v_t));
    v_res := public.fn_dq_eval_json(format(
      'select jsonb_build_object(''rows'', coalesce(jsonb_agg(x), ''[]''::jsonb), ''n'', count(*)) from (select jsonb_build_object(''table'', %L, ''key'', r.%I::text, ''label'', (%s)::text, ''field'', %L, ''observed'', (%s)::text, ''expected'', %s) x from public.%I r where (%s) limit %s) s',
      v_t, v_key, v_label, c->>'field', v_obs, v_exp, v_t, v_viol, greatest(1, least(p_limit, 500))));
    v_total := v_total + coalesce((v_res->>'n')::int, 0); v_out := v_out || coalesce(v_res->'rows', '[]'::jsonb);
  end loop;
  return jsonb_build_object('rows', v_out, 'matches', v_total, 'checked', v_checked, 'ms', round(extract(epoch from (clock_timestamp() - v_t0)) * 1000));
end $function$;

create or replace function public.fn_dq_rule_cost(p_rule_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r public.dq_rules%rowtype; c jsonb; v_key text; v_viol text; v_plan jsonb; v_out jsonb := '[]'::jsonb; v_t text;
begin
  select * into r from public.dq_rules where id = p_rule_id;
  for c in select x from jsonb_array_elements(r.checks) x loop
    v_t := c->>'table';
    select key_column into v_key from public.dq_tables where table_name = v_t;
    if coalesce(c->>'query_sql', '') <> '' then v_viol := format('r.%I::text in (select q.%I::text from (%s) q)', v_key, v_key, c->>'query_sql');
    else v_viol := c->>'violation_sql'; end if;
    if coalesce(v_viol, '') = '' then continue; end if;
    begin
      v_plan := public.fn_dq_eval_json(format('explain (format json) select 1 from public.%I r where (%s)', v_t, v_viol));
      v_out := v_out || jsonb_build_object('table', v_t, 'total_cost', v_plan->0->'Plan'->>'Total Cost', 'node', v_plan->0->'Plan'->>'Node Type', 'rows', v_plan->0->'Plan'->>'Plan Rows');
    exception when others then
      v_out := v_out || jsonb_build_object('table', v_t, 'error', sqlerrm);
    end;
  end loop;
  return v_out;
end $function$;

-- ── 5 · dq_apply_fix: the fix targets the issue's field, full stop (S6) ────
create or replace function public.dq_apply_fix(p_issue_id uuid, p_actor uuid default null, p_actor_name text default null, p_value text default null, p_field text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare i public.dq_issues%rowtype; v_key text; v_field text; v_val text; v_before jsonb; v_after jsonb; v_patch jsonb; v_audit uuid; v_res jsonb; v_gate jsonb; v_sync_key text; v_sync_val text;
begin
  select * into i from public.dq_issues where id = p_issue_id for update;
  if not found then raise exception 'issue not found' using errcode = 'P0002'; end if;
  if i.status <> 'open' then raise exception 'issue is %, only open issues can be fixed', i.status using errcode = '22023'; end if;
  v_field := coalesce(i.fix->>'field', i.field);
  -- A caller may name the field only to confirm it; it cannot redirect the
  -- write to another column.
  if p_field is not null and p_field <> v_field and p_field is distinct from i.field and p_field is distinct from (i.fix->>'field') then
    raise exception 'this issue''s fix targets %, not %', v_field, p_field using errcode = '22023';
  end if;
  v_field := coalesce(p_field, v_field);
  v_val := coalesce(p_value, i.fix->>'value');
  if v_field is null or v_val is null then raise exception 'nothing to apply — no suggested value' using errcode = '22023'; end if;
  if not public.fn_dq_has_column(i.table_name, v_field) then raise exception 'column % does not exist on %', v_field, i.table_name using errcode = '22023'; end if;
  select key_column into v_key from public.dq_tables where table_name = i.table_name;

  execute format('select to_jsonb(r) from public.%I r where r.%I::text = $1', i.table_name, v_key) using i.row_key into v_before;
  if v_before is null then raise exception 'row % no longer exists in %', i.row_key, i.table_name using errcode = 'P0002'; end if;
  v_patch := jsonb_build_object(v_field, case when lower(v_val) in ('null', '—', '') then null else v_val end);
  if coalesce(v_before->>v_field, '') = coalesce(v_patch->>v_field, '') then
    update public.dq_issues set status = 'fixed', reason = 'Already fixed outside the module', resolved_at = now(), resolved_by = p_actor, resolved_by_name = p_actor_name where id = p_issue_id;
    return jsonb_build_object('audit_id', null, 'field', v_field, 'value', v_val, 'noop', true);
  end if;

  v_sync_key := public.fn_sync_key_column(i.table_name);
  v_sync_val := case when v_sync_key is not null then v_before->>v_sync_key end;
  if public.fn_sync_table_allowed(i.table_name) and v_sync_val is not null and v_field <> v_sync_key then
    v_res := public.edit_live_record(i.table_name, v_sync_val, v_patch, p_actor);
    v_audit := (v_res->>'audit_id')::uuid;
  else
    execute format('update public.%I t set %I = s.%I from jsonb_populate_record(null::public.%I, $1) s where t.%I::text = $2', i.table_name, v_field, v_field, i.table_name, v_key) using v_patch, i.row_key;
    execute format('select to_jsonb(r) from public.%I r where r.%I::text = $1', i.table_name, v_key) using i.row_key into v_after;
    insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by)
    values (i.table_name, i.row_key, 'update', v_before, v_after, p_actor) returning id into v_audit;
  end if;
  execute format('select to_jsonb(r) from public.%I r where r.%I::text = $1', i.table_name, v_key) using i.row_key into v_after;

  v_gate := public.fn_dq_validate(i.table_name, v_after, 'admin', p_actor_name, p_actor, true);
  if (v_gate->>'blocked')::boolean then
    raise exception 'Fix refused by the gate: %', (select string_agg(x->>'rule_code' || ' — ' || (x->>'message'), '; ') from jsonb_array_elements(v_gate->'issues') x where x->>'mode' = 'block') using errcode = '23514';
  end if;

  update public.dq_issues set status = 'fixed', reason = coalesce(reason, 'Fix applied'), fixed_audit_id = v_audit, resolved_at = now(), resolved_by = p_actor, resolved_by_name = p_actor_name,
    fix = coalesce(fix, '{}'::jsonb) || jsonb_build_object('field', v_field, 'value', v_val, 'applied_at', now())
  where id = p_issue_id;
  return jsonb_build_object('audit_id', v_audit, 'field', v_field, 'value', v_val, 'gate', v_gate);
end $function$;

-- Set-based bulk apply (P5): one round trip, one failure never rolls back the rest.
create or replace function public.dq_apply_fixes(p_issue_ids uuid[], p_actor uuid default null, p_actor_name text default null, p_threshold numeric default 0.85)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; i record; v_applied int := 0; v_skipped int := 0; v_errs text[] := '{}';
begin
  foreach v_id in array p_issue_ids[1:500] loop
    select id, status, fix, row_label into i from public.dq_issues where id = v_id;
    if not found or i.status <> 'open' or i.fix is null or (i.fix->>'value') is null or coalesce((i.fix->>'confidence')::numeric, 1) < p_threshold then
      v_skipped := v_skipped + 1; continue;
    end if;
    begin
      perform public.dq_apply_fix(v_id, p_actor, p_actor_name, null, null);
      v_applied := v_applied + 1;
    exception when others then
      v_errs := v_errs || (coalesce(i.row_label, v_id::text) || ': ' || sqlerrm);
    end;
  end loop;
  return jsonb_build_object('applied', v_applied, 'skipped', v_skipped, 'errors', to_jsonb(v_errs));
end $function$;

-- ── 6 · atomic counters (C3), bounded settings (C6), grouped reads (P2–P4) ─
create or replace function public.fn_dq_meter_ai(p_tokens integer, p_cost numeric)
 returns jsonb language sql security definer set search_path to ''
as $$
  insert into public.dq_ai_usage (day, tokens, cost, calls)
  values (current_date, p_tokens, p_cost, 1)
  on conflict (day) do update
    set tokens = public.dq_ai_usage.tokens + excluded.tokens,
        cost   = public.dq_ai_usage.cost + excluded.cost,
        calls  = public.dq_ai_usage.calls + 1
  returning jsonb_build_object('day', day, 'tokens', tokens, 'cost', cost, 'calls', calls);
$$;

create or replace function public.fn_dq_run_add_ai(p_run_id uuid, p_tokens integer, p_cost numeric, p_issues integer)
 returns void language sql security definer set search_path to ''
as $$
  update public.dq_runs
     set tokens = coalesce(tokens, 0) + p_tokens, cost = coalesce(cost, 0) + p_cost, ai_issues = coalesce(ai_issues, 0) + p_issues
   where id = p_run_id;
$$;

do $$
begin
  update public.dq_settings set batch_size = greatest(100, least(5000, batch_size)) where id = 1;
  if not exists (select 1 from pg_constraint where conname = 'dq_settings_batch_size_ck') then
    alter table public.dq_settings add constraint dq_settings_batch_size_ck check (batch_size between 100 and 5000);
  end if;
end $$;

-- Issue view chips in one grouped query (P2).
create or replace function public.fn_dq_issue_counts(p_table text default null)
 returns jsonb language sql stable security definer set search_path to ''
as $$
  select jsonb_build_object(
    'all',    count(*),
    'open',   count(*) filter (where status = 'open'),
    'blocks', count(*) filter (where status = 'open' and severity = 'error'),
    'class',  count(*) filter (where status = 'open' and category = 'classification'),
    'ai',     count(*) filter (where source = 'ai'),
    'fixed',  count(*) filter (where status = 'fixed'))
  from public.dq_issues where p_table is null or p_table = 'all' or table_name = p_table;
$$;

-- Per-rule raised / open / false-positive, computed in the database (P3).
create or replace function public.fn_dq_rule_stats()
 returns jsonb language sql stable security definer set search_path to ''
as $$
  select coalesce(jsonb_object_agg(rule_code, jsonb_build_object('raised', raised, 'open', open, 'fp', fp)), '{}'::jsonb)
  from (select rule_code, count(*) raised, count(*) filter (where status = 'open') open, count(*) filter (where status = 'false_positive') fp
          from public.dq_issues group by rule_code) s;
$$;

-- ── 7 · health that means something (U1), counter rules (U2), registry (U3) ─
-- Score = share of ROWS carrying an open issue, weighted by the worst severity
-- on the row. Bounded 0–100 by construction; the weights drive the mix.
create or replace function public.fn_dq_health()
 returns jsonb language plpgsql stable set search_path to ''
as $function$
declare d record; n bigint; e int; w int; i int; er int; wr int; ir int; s numeric; wt jsonb; we numeric; ww numeric; wi numeric; v_out jsonb := '[]'::jsonb; cov int;
begin
  select weights into wt from public.dq_settings where id = 1;
  we := greatest(coalesce((wt->>'error')::numeric, 3), 0.01); ww := coalesce((wt->>'warn')::numeric, 1); wi := coalesce((wt->>'info')::numeric, 0.2);
  for d in select * from public.dq_tables order by sort_order loop
    execute format('select count(*) from public.%I', d.table_name) into n;
    select count(*) filter (where severity = 'error'), count(*) filter (where severity = 'warn'), count(*) filter (where severity = 'info')
      into e, w, i from public.dq_issues where table_name = d.table_name and status = 'open';
    select count(*) filter (where worst = 1), count(*) filter (where worst = 2), count(*) filter (where worst = 3)
      into er, wr, ir
      from (select row_key, min(case severity when 'error' then 1 when 'warn' then 2 else 3 end) worst
              from public.dq_issues where table_name = d.table_name and status = 'open' group by row_key) x;
    select count(*) into cov from public.dq_rules r where r.enabled and r.deleted_at is null and r.tables @> array[d.table_name];
    s := case when n = 0 then 100
              else greatest(0, least(100, 100 * (1 - (er * we + wr * ww + ir * wi) / (n * we)))) end;
    v_out := v_out || jsonb_build_object('table', d.table_name, 'label', d.label, 'rows', n, 'open_error', e, 'open_warn', w, 'open_info', i, 'open', e + w + i,
                                         'rows_error', er, 'rows_warn', wr, 'rows_info', ir, 'score', round(s, 1), 'coverage', cov, 'href', d.admin_href);
  end loop;
  return v_out;
end $function$;

-- Overview reads the latest snapshot when it is fresh (P4); computes otherwise.
create or replace function public.fn_dq_health_cached(p_max_age interval default interval '10 minutes')
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
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
end $function$;

-- Counter-only switch, versioned like every other rule change.
create or replace function public.dq_set_rule_queue(p_rule_id uuid, p_queue boolean, p_actor uuid default null, p_actor_name text default null)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare v_ver int;
begin
  update public.dq_rules set queue = p_queue, version = version + 1, updated_at = now() where id = p_rule_id returning version into v_ver;
  if not found then raise exception 'rule not found'; end if;
  insert into public.dq_rule_versions (rule_id, version, snapshot, note, changed_by_name)
  select id, v_ver, to_jsonb(r) - 'created_at' - 'updated_at', case when p_queue then 'Queued again' else 'Counter only — no longer queued' end, coalesce(p_actor_name, 'admin')
    from public.dq_rules r where id = p_rule_id;
  if not p_queue then
    update public.dq_issues set status = 'ignored', reason = 'Counter-only rule — read it on the Overview strip', resolved_at = now(), resolved_by = p_actor, resolved_by_name = p_actor_name
     where rule_id = p_rule_id and status = 'open';
  end if;
end $function$;

-- Freshness and house-format are counters, not defects to triage (U2).
do $$
declare v_id uuid;
begin
  for v_id in select id from public.dq_rules where code in ('DQ-F01', 'DQ-C01') and queue loop
    perform public.dq_set_rule_queue(v_id, false, null, 'Migration 20260910140000');
  end loop;
end $$;

-- Registry rules are no-ops until a UN/LOCODE release is imported (U3).
do $$
declare r record; v_checks jsonb; c jsonb; v_new jsonb; v_sql text;
begin
  for r in select id, code, checks from public.dq_rules where code in ('DQ-R01', 'DQ-R02', 'DQ-R04') and deleted_at is null loop
    v_new := '[]'::jsonb;
    for c in select x from jsonb_array_elements(r.checks) x loop
      v_sql := c->>'violation_sql';
      if v_sql is not null and v_sql not like 'exists (select 1 from public.unlocode_registry)%' then
        c := jsonb_set(c, '{violation_sql}', to_jsonb('exists (select 1 from public.unlocode_registry) and (' || v_sql || ')'));
      end if;
      v_new := v_new || c;
    end loop;
    update public.dq_rules set checks = v_new, updated_at = now() where id = r.id;
  end loop;
end $$;

-- Retention (P7): resolved issues, gate-log lines and snapshots age out.
create or replace function public.fn_dq_retention(p_issue_days integer default 90, p_gate_days integer default 30, p_snapshot_days integer default 180)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
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
end $function$;

-- ── 8 · nothing in this module is callable from the browser (S1) ────────────
-- Every fn_dq* / dq_* function — including the ones created above, which the
-- project's default privileges would otherwise hand to anon — is service-role
-- only. The two exceptions are the pure IMO check (used by forms) and the
-- mode lookup (used by member-facing inline messages).
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text sig, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'fn_dq%' or p.proname like 'dq_%')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
grant execute on function public.fn_dq_imo_valid(text) to anon, authenticated;
grant execute on function public.fn_dq_effective_mode(uuid, text) to authenticated;
-- the evaluator must not be able to reach any of the module's own functions
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'fn_dq%' or p.proname like 'dq_%') and p.proname not in ('fn_dq_imo_valid', 'fn_dq_has_column')
      and pg_get_userbyid(p.proowner) <> 'dq_evaluator'
  loop
    execute format('revoke all on function %s from dq_evaluator', f.sig);
  end loop;
end $$;

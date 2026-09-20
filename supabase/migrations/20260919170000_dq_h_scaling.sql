-- ════════════════════════════════════════════════════════════════════════
-- Data Quality · workstream H — what the 10× load test found (19 Sep 2026,
-- amended 20 Sep; re-audit: a batch that times out never taught the sizer)
--
-- A transactional load test (supabase/tests/data_quality/dq_load_test.sql)
-- ran the real engine over cargo_listings at ten times today's volume. Each
-- 1,000-row batch took 10–16.5 s, and the engine calls every batch through
-- PostgREST as the API role, whose statement timeout is 8 s.
--
--   1. DQ-U03 (duplicate listings) compares every row with every other row:
--      O(rows²). An expression index on the load-port key it compares on
--      makes it a lookup.
--   1b. The port-identity rules call fn_resolve_port_side for every row;
--      inside, fn_resolve_port_locode scans ports evaluating three regexes
--      per port row. Expression indexes turn those into index lookups.
--   2. The batch limit is PERSISTED on the run (dq_runs.batch_limit). The
--      first batch is a 250-row probe; each batch then sizes the next from
--      its measured time (target 3 s, floor 10 rows, ceiling the setting).
--      A batch that times out never records a time — the engine calls
--      fn_dq_batch_timeout in a SEPARATE transaction: it halves the limit
--      (emergency floor 10), counts the retry, and after three timeouts at
--      the floor marks the run failed naming the cursor. The cursor never
--      advances on a timeout, so the retry re-reads the same rows.
--   3. Five trigram indexes are replaced by one over a generated search
--      column (6× faster searches, less write amplification).
-- fn_dq_evaluate_range (the fenced evaluator) lives in workstream C.
-- Idempotent. DOWN: supabase/rollback/20260919_dq_h_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- ── 1 · the port resolver's lookups become index lookups ────────────────────
create index if not exists idx_ports_port_key on public.ports (public.fn_port_key(trade_name)) where is_active;
create index if not exists idx_ports_locode_compact on public.ports (lower(replace(locode, ' ', ''))) where is_active;
create index if not exists idx_ports_locode_upper_compact on public.ports (replace(upper(locode), ' ', ''));
comment on index public.idx_ports_port_key is 'fn_resolve_port_locode: name → port without scanning every port (DQ load test, 19 Sep 2026).';
create index if not exists idx_cl_dup_load_key on public.cargo_listings (coalesce(load_port_locode, lower(btrim(load_port_name))));
comment on index public.idx_cl_dup_load_key is 'DQ-U03 duplicate-listing check: listings sharing a load port (DQ load test, 19 Sep 2026).';
-- expression indexes carry their own statistics; without an ANALYZE the planner keeps scanning
analyze public.ports;
analyze public.cargo_listings;

-- ── 2 · the batch sizes itself, and the size survives a timeout ─────────────
alter table public.dq_runs
  add column if not exists batch_limit     integer,
  add column if not exists timeout_retries integer not null default 0;
comment on column public.dq_runs.batch_limit is 'Rows the next batch takes: 250-row probe, then adapted from the previous batch''s time; halved by fn_dq_batch_timeout (floor 10).';

-- Called by the engine, in its own transaction, when fn_dq_process_batch
-- timed out: the batch's transaction rolled back, so nothing else recorded
-- it. Returns the new limit, or marks the run failed.
create or replace function public.fn_dq_batch_timeout(p_run_id uuid, p_error text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $$
declare
  v_run public.dq_runs%rowtype; v_cur int; v_new int; v_retries int;
  v_floor constant int := 10;
  -- Attempts AT THE FLOOR before the run is given up. The header says three
  -- and this says three (21 Sep 2026): the condition used to read
  -- `timeout_retries >= 3` BEFORE counting the current timeout, so the run
  -- survived a third floor timeout and failed on the fourth — one more
  -- ten-row attempt than the contract promised, and one more statement
  -- timeout charged to the database each time a run was genuinely stuck.
  v_max_floor_attempts constant int := 3;
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status <> 'running' then return jsonb_build_object('status', v_run.status, 'batch_limit', v_run.batch_limit); end if;
  v_cur := coalesce(v_run.batch_limit, least(v_run.batch_size, 250));
  -- count THIS timeout first, then decide: the number in the error message is
  -- then the number of attempts actually made, which is what an operator
  -- reads it as
  v_retries := v_run.timeout_retries + case when v_cur <= v_floor then 1 else 0 end;
  if v_cur <= v_floor and v_retries >= v_max_floor_attempts then
    update public.dq_runs
       set timeout_retries = v_retries,
           error = format('a batch of %s row(s) at %s (after key %s) still exceeds the execution time after %s attempt(s) at the %s-row floor: %s',
                          v_cur, coalesce(v_run.tables[coalesce((v_run.cursor->>'idx')::int, 0) + 1], '?'), coalesce(v_run.cursor->>'last', 'start'), v_retries, v_floor, coalesce(p_error, 'statement timeout'))
     where id = p_run_id;
    perform public.fn_dq_finish_run(p_run_id, 'failed', null);
    return jsonb_build_object('status', 'failed', 'batch_limit', v_cur, 'timeout_retries', v_retries, 'floor_attempts', v_max_floor_attempts);
  end if;
  v_new := greatest(v_floor, v_cur / 2);
  update public.dq_runs
     set batch_limit = v_new,
         timeout_retries = v_retries,
         note = left(coalesce(note || ' · ', '') || format('batch of %s rows timed out — retrying with %s', v_cur, v_new), 2000)
   where id = p_run_id;
  return jsonb_build_object('status', 'running', 'batch_limit', v_new, 'was', v_cur, 'timeout_retries', v_retries, 'floor_attempts', v_max_floor_attempts);
end $$;

create or replace function public.fn_dq_process_batch(p_run_id uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_run public.dq_runs%rowtype; v_tables text[]; v_idx int; v_last text; v_table text;
  v_keys text[]; v_from text; v_to text; v_n int; v_batch_id uuid; v_batch_n int; v_clock timestamptz := clock_timestamp();
  v_res jsonb; v_errs text[]; v_found jsonb;
  v_limit int; v_ms int; v_next int;
begin
  select * into v_run from public.dq_runs where id = p_run_id for update;
  if not found then raise exception 'run % not found', p_run_id; end if;
  if v_run.status <> 'running' then return jsonb_build_object('done', true, 'status', v_run.status); end if;

  -- the persisted limit: a 250-row probe first, then whatever the previous
  -- batch (or a timeout) left behind
  v_limit := greatest(10, least(v_run.batch_size, coalesce(v_run.batch_limit, least(v_run.batch_size, 250))));

  v_tables := v_run.tables; v_idx := coalesce((v_run.cursor->>'idx')::int, 0); v_last := v_run.cursor->>'last';
  loop
    if v_idx >= coalesce(array_length(v_tables, 1), 0) then
      perform public.fn_dq_finish_run(p_run_id, 'completed', null);
      return jsonb_build_object('done', true, 'status', (select status from public.dq_runs where id = p_run_id));
    end if;
    v_table := v_tables[v_idx + 1];
    select array_agg(k order by k) into v_keys
      from (select key k from public.dq_run_keys where run_id = p_run_id and table_name = v_table and (v_last is null or key > v_last) order by key limit v_limit) s;
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
  v_ms := (extract(epoch from (clock_timestamp() - v_clock)) * 1000)::int;

  update public.dq_run_batches set status = case when array_length(v_errs, 1) > 0 then 'failed' else 'done' end, found = v_found,
    ms = v_ms, error = nullif(array_to_string(v_errs, ' · '), ''), rule_errors = coalesce(v_res->'rule_errors', '[]'::jsonb), finished_at = clock_timestamp()
  where id = v_batch_id;

  -- size the next batch from this one: target 3 s (the API role's statement
  -- timeout is 8 s and a busy server is slower than the load test)
  v_next := case
              when v_ms > 3000 then greatest(10, least(v_run.batch_size, floor(v_n * 3000.0 / greatest(v_ms, 1))::int))
              when v_ms < 1200 then least(v_run.batch_size, greatest(v_n * 2, 10))
              else least(v_run.batch_size, greatest(v_n, 10)) end;

  update public.dq_runs set rows_done = rows_done + v_n, batches_done = batches_done + 1, last_batch_at = clock_timestamp(),
    cursor = jsonb_build_object('idx', v_idx, 'last', v_to), batch_limit = v_next,
    found = jsonb_build_object('error', (dq_runs.found->>'error')::int + (v_found->>'error')::int, 'warn', (dq_runs.found->>'warn')::int + (v_found->>'warn')::int, 'info', (dq_runs.found->>'info')::int + (v_found->>'info')::int),
    note = case when array_length(v_errs, 1) > 0 then left(coalesce(note || ' · ', '') || format('batch %s: %s', v_batch_n, array_to_string(v_errs, ' · ')), 2000) else note end
  where id = p_run_id;

  return jsonb_build_object('done', false, 'batch_id', v_batch_id, 'n', v_batch_n, 'table', v_table, 'key_from', v_from, 'key_to', v_to,
                            'rows', v_n, 'limit', v_limit, 'next_limit', v_next, 'ms', v_ms, 'rules', (v_res->>'rules')::int, 'found', v_found, 'errors', v_res->'errors');
end $function$;

-- ── 3 · one search column, one index ────────────────────────────────────────
alter table public.dq_issues add column if not exists search_text text
  generated always as (coalesce(row_label, '') || ' ' || row_key || ' ' || coalesce(observed, '') || ' ' || rule_code || ' ' || coalesce(field, '')) stored;
create index if not exists idx_trgm_dq_issues_search on public.dq_issues using gin (search_text extensions.gin_trgm_ops);
drop index if exists public.idx_trgm_dq_issues_row_label, public.idx_trgm_dq_issues_row_key, public.idx_trgm_dq_issues_rule_code,
                     public.idx_trgm_dq_issues_field, public.idx_trgm_dq_issues_observed;
comment on column public.dq_issues.search_text is 'Label, key, observed value, rule and field in one searchable text (workstream H).';

revoke all on function public.fn_dq_batch_timeout(uuid, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_batch_timeout(uuid, text) to service_role;

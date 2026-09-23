-- Data Quality · workstream H load test (19 Sep 2026)
--
-- Drives the real rule engine over cargo_listings at ~10× today's volume
-- inside ONE transaction that is always rolled back. Copies of the live rows
-- are inserted with triggers off (replica role, so no match refresh, no route
-- or forms gate on data that already passed them), triggers are switched back
-- on, a scoped run is prepared and driven batch by batch, and the numbers come
-- back in the final RAISE EXCEPTION message — the only channel that survives
-- a rollback:
--
--   supabase db query --linked --file supabase/tests/data_quality/dq_load_test.sql
--
-- Nothing persists. The multiplier and the time budget are the two settings
-- at the top of the block; the run stops driving batches at the budget and
-- reports how far it got (the Management API has its own request limit).

begin;
set local session_replication_role = replica;
select set_config('dq.channel', 'admin', true);

do $$
declare
  v_mult int := 9;            -- copies per live row → 10× volume
  v_budget_ms int := 40000;   -- stop driving batches after this much wall clock
  v_batch int := 1000;
  v_cols text; v_vals text; v_base int; v_after int; v_run uuid; v_res jsonb; v_row public.dq_runs%rowtype;
  t0 timestamptz; t1 timestamptz; v_prep_ms int; v_ins_ms int; v_ms int[] := '{}'; v_n int := 0; v_done boolean := false;
  v_sev jsonb; v_sev_ms int; v_search bigint; v_search_ms int; v_issues bigint; v_snap_ms int; v_summary text;
begin
  select count(*) into v_base from public.cargo_listings;
  create temp table load_base on commit drop as select id, ref from public.cargo_listings;
  select string_agg(quote_ident(attname), ', ' order by attnum),
         string_agg(case when attname = 'id' then 'gen_random_uuid()'
                         when attname = 'ref' then $q$'LOAD-' || g::text || '-' || coalesce(c.ref, left(c.id::text, 8))$q$
                         else 'c.' || quote_ident(attname) end, ', ' order by attnum)
    into v_cols, v_vals
  from pg_attribute where attrelid = 'public.cargo_listings'::regclass and attnum > 0 and not attisdropped and attgenerated = '';

  t0 := clock_timestamp();
  execute format('insert into public.cargo_listings (%s) select %s from public.cargo_listings c join load_base b on b.id = c.id cross join generate_series(1, %s) g', v_cols, v_vals, v_mult);
  v_ins_ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  select count(*) into v_after from public.cargo_listings;
  analyze public.cargo_listings;   -- production has statistics for its real volume; the copies need them too

  -- triggers back on: the engine itself must run exactly as in production
  execute 'set local session_replication_role = origin';

  insert into public.dq_runs (scope, mode, batch_size, trigger, started_by_name, status)
    values (jsonb_build_object('kind', 'tables', 'tables', jsonb_build_array('cargo_listings')), 'rules', v_batch, 'admin', 'load test (rolled back)', 'queued')
    returning id into v_run;

  t0 := clock_timestamp();
  perform public.fn_dq_prepare_run(v_run);
  v_prep_ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;

  t1 := clock_timestamp();
  loop
    t0 := clock_timestamp();
    v_res := public.fn_dq_process_batch(v_run);
    v_ms := v_ms || (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
    v_n := v_n + 1;
    v_done := coalesce((v_res->>'done')::boolean, false);
    exit when v_done or (extract(epoch from (clock_timestamp() - t1)) * 1000) > v_budget_ms or v_n > 200;
  end loop;

  select * into v_row from public.dq_runs where id = v_run;
  select count(*) into v_issues from public.dq_issues where table_name = 'cargo_listings' and status = 'open';

  t0 := clock_timestamp(); v_sev := public.fn_dq_open_by_severity('cargo_listings');
  v_sev_ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  t0 := clock_timestamp();
  select count(*) into v_search from public.dq_issues where row_label ilike '%LOAD-3%' or row_key ilike '%LOAD-3%' or observed ilike '%LOAD-3%';
  v_search_ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  t0 := clock_timestamp(); perform public.fn_dq_snapshot_health(true);
  v_snap_ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;

  v_summary := jsonb_pretty(jsonb_build_object(
    'rows_before', v_base, 'rows_after', v_after, 'insert_ms', v_ins_ms, 'prepare_ms', v_prep_ms,
    'total_rows', v_row.total_rows, 'rows_done', v_row.rows_done, 'batches_done', v_row.batches_done, 'batch_size', v_batch,
    'batches_driven', v_n, 'finished', v_done, 'status', v_row.status,
    'rules_expected', v_row.rules_expected, 'rules_failed', v_row.rules_failed, 'coverage_pct', v_row.coverage_pct,
    'found', v_row.found, 'open_issues_after', v_issues, 'open_by_severity', v_sev,
    'batch_ms', to_jsonb(v_ms), 'batch_ms_max', (select max(x) from unnest(v_ms) x), 'batch_ms_avg', (select round(avg(x)) from unnest(v_ms) x),
    'drive_ms_total', (select sum(x) from unnest(v_ms) x),
    'open_by_severity_ms', v_sev_ms, 'trgm_search_ms', v_search_ms, 'trgm_search_hits', v_search, 'health_snapshot_ms', v_snap_ms));
  raise exception using message = 'DQ LOAD TEST (rolled back): ' || v_summary, errcode = 'P0001';
end $$;

rollback;

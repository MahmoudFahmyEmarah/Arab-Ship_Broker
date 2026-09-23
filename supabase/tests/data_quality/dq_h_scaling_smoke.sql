-- Data Quality · workstream H smoke test (19 Sep 2026, amended 20 Sep)
-- for 20260919170000_dq_h_scaling.sql. BEGIN … ROLLBACK. Uses a real scoped
-- run over ports (small, fast).
--   S1  the resolver's and the duplicate check's lookups use the new indexes
--   S2  the first batch is a 250-row probe; a fast batch doubles the persisted limit
--   S3  fn_dq_batch_timeout halves the persisted limit down to the 10-row floor,
--       leaves the cursor where it was, and fails the run after three timeouts at the floor
--   S4  the next batch honours the persisted limit; the run completes
--   S5  the search column is filled and indexed

begin;

do $$
declare v_run uuid; v_res jsonb; v_plan text; v_cnt int; v_line record; v_cursor jsonb; r public.dq_runs%rowtype;
begin
  -- the probe needs at least 260 ports; the disposable database may hold none
  insert into public.ports (locode, trade_name, country, zone)
  select 'ZH' || chr(65 + (g / 676) % 26) || chr(65 + (g / 26) % 26) || chr(65 + g % 26), 'Smoke H ' || g, 'Testland', 'E.MED'
    from generate_series(1, 300) g on conflict (locode) do nothing;
  analyze public.ports;
  -- the disposable database is small: prove the indexes are usable, not that a tiny table prefers them
  set local enable_seqscan = off;

  -- ── S1 ────────────────────────────────────────────────────────────────────
  v_plan := '';
  for v_line in execute $q$explain select locode from public.ports p where p.is_active and public.fn_port_key(p.trade_name) = 'piraeus'$q$ loop v_plan := v_plan || ' ' || v_line."QUERY PLAN"; end loop;
  if v_plan !~* 'index' then raise exception 'S1: the port-key lookup still scans (%)', v_plan; end if;
  v_plan := '';
  for v_line in execute $q$explain select 1 from public.cargo_listings o where coalesce(o.load_port_locode, lower(btrim(o.load_port_name))) = 'egalu'$q$ loop v_plan := v_plan || ' ' || v_line."QUERY PLAN"; end loop;
  if v_plan !~* 'index' then raise exception 'S1: the duplicate-listing lookup still scans (%)', v_plan; end if;

  set local enable_seqscan = on;

  -- ── S2 · probe, then grow ─────────────────────────────────────────────────
  insert into public.dq_runs (scope, mode, batch_size, trigger, started_by_name, status)
    values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, 'admin', 'smoke H', 'queued') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  v_res := public.fn_dq_process_batch(v_run);
  if (v_res->>'rows')::int <> 250 or (v_res->>'limit')::int <> 250 then raise exception 'S2: probe batch was % rows (limit %)', v_res->>'rows', v_res->>'limit'; end if;
  select * into r from public.dq_runs where id = v_run;
  if r.batch_limit <> (v_res->>'next_limit')::int then raise exception 'S2: the next limit was not persisted (% vs %)', r.batch_limit, v_res->>'next_limit'; end if;
  if (v_res->>'ms')::int < 1200 and r.batch_limit <> 500 then raise exception 'S2: a fast probe should double the limit to 500, got %', r.batch_limit; end if;

  -- ── S3 · a timeout halves the persisted limit and never moves the cursor ─
  v_cursor := r.cursor;
  v_res := public.fn_dq_batch_timeout(v_run, 'canceling statement due to statement timeout');
  select * into r from public.dq_runs where id = v_run;
  if (v_res->>'batch_limit')::int <> 250 or r.batch_limit <> 250 or r.status <> 'running' then raise exception 'S3: expected the limit halved 500 → 250, got % (%)', v_res, r.batch_limit; end if;
  if r.cursor <> v_cursor then raise exception 'S3: a timeout moved the cursor'; end if;
  if r.note not like '%timed out — retrying with 250%' then raise exception 'S3: the timeout is not on the run''s note: %', r.note; end if;
  for v_cnt in 1..5 loop perform public.fn_dq_batch_timeout(v_run, 'timeout'); end loop;
  select * into r from public.dq_runs where id = v_run;
  if r.batch_limit <> 10 then raise exception 'S3: expected the 10-row emergency floor, got %', r.batch_limit; end if;
  if r.status <> 'running' then raise exception 'S3: reaching the floor must not fail the run yet (%)', r.status; end if;
  -- Reaching the floor is not itself an attempt at the floor: the halving
  -- steps were all taken above 10 rows.
  if r.timeout_retries <> 0 then raise exception 'S3: reaching the floor counted % attempt(s) at it', r.timeout_retries; end if;
  -- THREE attempts at the floor, and the third gives up. This assertion used
  -- to say the fourth did — the implementation tested `timeout_retries >= 3`
  -- before counting the current timeout, so the run took one more ten-row
  -- attempt than the migration header promised, and the test wrote that
  -- down as if it were the contract (corrected 21 Sep 2026).
  v_res := public.fn_dq_batch_timeout(v_run, 'timeout');   -- attempt 1
  if v_res->>'status' <> 'running' or (v_res->>'timeout_retries')::int <> 1 then raise exception 'S3: first floor attempt: %', v_res; end if;
  v_res := public.fn_dq_batch_timeout(v_run, 'timeout');   -- attempt 2
  if v_res->>'status' <> 'running' or (v_res->>'timeout_retries')::int <> 2 then raise exception 'S3: second floor attempt: %', v_res; end if;
  v_res := public.fn_dq_batch_timeout(v_run, 'timeout');   -- attempt 3: give up
  if v_res->>'status' <> 'failed' then raise exception 'S3: the third attempt at the floor must fail the run, got %', v_res; end if;
  select * into r from public.dq_runs where id = v_run;
  if r.status <> 'failed' or r.error not like 'a batch of 10 row(s) at ports%' then raise exception 'S3: the run should fail with a clear reason, got % / %', r.status, r.error; end if;
  if r.timeout_retries <> 3 then raise exception 'S3: the run should record 3 floor attempts, got %', r.timeout_retries; end if;
  -- the message states the number of attempts actually made, so the operator
  -- reads the same number the contract promises
  if r.error not like '%3 attempt(s) at the 10-row floor%' then raise exception 'S3: the reason does not name the attempts: %', r.error; end if;
  if to_regclass('public.dq_notification_outbox') is not null and not exists (select 1 from public.dq_notification_outbox where idem_key = 'run/' || v_run::text) then
    raise exception 'S3: the failed run was not enqueued for notification';
  end if;

  -- ── S4 · the next batch honours the persisted limit ──────────────────────
  insert into public.dq_runs (scope, mode, batch_size, trigger, started_by_name, status)
    values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, 'admin', 'smoke H2', 'queued') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  update public.dq_runs set batch_limit = 50 where id = v_run;
  v_res := public.fn_dq_process_batch(v_run);
  if (v_res->>'rows')::int <> 50 or (v_res->>'limit')::int <> 50 then raise exception 'S4: expected a 50-row batch, got % (limit %)', v_res->>'rows', v_res->>'limit'; end if;
  update public.dq_runs set batch_limit = 3 where id = v_run;   -- below the floor: clamped to 10
  v_res := public.fn_dq_process_batch(v_run);
  if (v_res->>'limit')::int <> 10 then raise exception 'S4: a limit below the floor must clamp to 10, got %', v_res->>'limit'; end if;
  loop v_res := public.fn_dq_process_batch(v_run); exit when (v_res->>'done')::boolean; end loop;
  select * into r from public.dq_runs where id = v_run;
  if r.status not in ('completed', 'completed_with_errors') then raise exception 'S4: status %', r.status; end if;
  if r.rows_done <> (select count(*) from public.dq_run_keys where run_id = v_run) then raise exception 'S4: rows_done % ≠ snapshot', r.rows_done; end if;

  -- ── S5 · the search column ────────────────────────────────────────────────
  select count(*) into v_cnt from public.dq_issues where search_text is null;
  if v_cnt > 0 then raise exception 'S5: % issues without search text', v_cnt; end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_trgm_dq_issues_search') then raise exception 'S5: search index missing'; end if;
  if exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_trgm_dq_issues_row_label') then raise exception 'S5: old per-column index still present'; end if;

  raise notice 'DQ H SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;

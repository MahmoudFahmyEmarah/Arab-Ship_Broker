-- Data Quality · retry accounting (21 Sep 2026)
-- for the fn_dq_retry_prep repair in 20260919130000_dq_c_run_integrity.sql.
-- BEGIN … ROLLBACK.
--
-- The defect: fn_dq_retry_prep re-evaluated a repaired key query, so the
-- findings were written, but it never updated dq_run_batches.found — and
-- fn_dq_settle_run rebuilds the run's totals by SUMMING those batch rows. A
-- retry therefore finished with a completed run whose error and warning counts
-- were the ones from before the repair.
--
--   R1  a run with one working check and two broken key queries: the totals
--       reflect the working check alone, and the run is completed_with_errors
--   R2  repair one: the batch totals, the run total and the persisted
--       findings all agree, to the row
--   R3  retry again with nothing changed: the totals do not move. A
--       re-evaluation reports every failing row it sees, new or not, so
--       ADDING what it reports would double the count — the repair has to
--       recompute, not accumulate
--   R4  a suppressed finding is not counted, exactly as a batch does not
--       count one while evaluating
--   R5  repair the rest: the run completes and every batch's own total still
--       matches the findings inside that batch's own key range
--
-- Every assertion compares the STORED numbers against the STORED findings.
-- None of them reads the migration's text.

begin;

do $$
declare
  v_work    uuid;
  v_broken1 uuid;
  v_broken2 uuid;
  v_run     uuid;
  v_step    jsonb;
  v_res     jsonb;
  r         public.dq_runs%rowtype;
  v_bf      jsonb;   -- batch totals, summed the way fn_dq_settle_run sums them
  v_if      jsonb;   -- the findings themselves, counted
  n         int;
  v_ports   int := 120;
  v_before  jsonb;
begin
  -- ── fixture ──────────────────────────────────────────────────────────────
  -- The smallest batch_size the schema allows is 100 (dq_runs_batch_size_check),
  -- so the fixture has to be larger than that for the run to span more than one
  -- batch — and spanning more than one batch is the point: the defect was that
  -- fn_dq_settle_run SUMS the batch rows, so a repair that updates only some of
  -- them is indistinguishable from one that updates none until you look.
  if exists (select 1 from public.ports where locode like 'ZZRA%') then raise exception 'ports ZZRA* exist — pick another key'; end if;
  insert into public.ports (locode, trade_name, country, zone)
  select 'ZZRA' || lpad(g::text, 3, '0'), 'retry acct ' || g, 'Testland', 'E.MED'
    from generate_series(1, v_ports) g;

  -- a check that works: one WARN on every ZZRA port
  v_work := (public.dq_save_rule(jsonb_build_object(
    'code', 'DQ-SMKRA1', 'name', 'retry acct working', 'severity', 'warn', 'kind', 'declarative', 'enabled', true,
    'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'violation_sql', 'r.locode like ''ZZRA%''', 'message', 'retry acct warn'))
  ), null, 'smoke', 'smoke')->>'id')::uuid;

  -- two key queries that compile but fail when materialised, at two
  -- severities the working check never touches. One is repaired in R2, the
  -- other in R5 — so the run is still retryable while R3 proves idempotence.
  v_broken1 := (public.dq_save_rule(jsonb_build_object(
    'code', 'DQ-SMKRA2', 'name', 'retry acct broken key (error)', 'severity', 'error', 'kind', 'sql', 'enabled', true,
    'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'country', 'query_sql', 'select * from public.ports where (trade_name)::numeric > 0', 'message', 'retry acct error'))
  ), null, 'smoke', 'smoke')->>'id')::uuid;

  v_broken2 := (public.dq_save_rule(jsonb_build_object(
    'code', 'DQ-SMKRA3', 'name', 'retry acct broken key (info)', 'severity', 'info', 'kind', 'sql', 'enabled', true,
    'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'notes', 'query_sql', 'select * from public.ports where (country)::numeric > 0', 'message', 'retry acct info'))
  ), null, 'smoke', 'smoke')->>'id')::uuid;

  -- ── R1 · the broken key queries contribute nothing, and are recorded ─────
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name)
  values ('{"kind":"tables","tables":["ports"]}', 'rules', 100, array[v_work, v_broken1, v_broken2], 'smoke')
  returning id into v_run;
  v_res := public.fn_dq_prepare_run(v_run);
  -- coalesce, not a bare comparison: jsonb_array_length(null) is null, and
  -- `null <> 2` is null, so an absent key would make this assertion pass while
  -- proving nothing. A test that cannot fail is worse than no test.
  if coalesce(jsonb_array_length(v_res->'prep_errors'), -1) <> 2 then
    raise exception 'R1: expected two key-preparation errors, prepare returned %', v_res;
  end if;
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;

  select * into r from public.dq_runs where id = v_run;
  if r.status <> 'completed_with_errors' then raise exception 'R1: expected completed_with_errors, got %', r.status; end if;
  if (r.found->>'error')::int <> 0 or (r.found->>'info')::int <> 0 then raise exception 'R1: only the working check should have fired, found %', r.found; end if;
  if (r.found->>'warn')::int <> v_ports then raise exception 'R1: the working check should have raised % warnings, found %', v_ports, r.found; end if;
  select count(*) into n from public.dq_run_batches where run_id = v_run;
  if n < 2 then raise exception 'R1: the fixture must produce several batches, got %', n; end if;
  v_before := r.found;

  -- ── R2 · repair one, retry, and the three numbers agree ──────────────────
  update public.dq_rules
     set checks = jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'country', 'query_sql', 'select * from public.ports where locode like ''ZZRA%''', 'message', 'retry acct error'))
   where id = v_broken1;
  v_res := public.fn_dq_retry_run(v_run);

  select * into r from public.dq_runs where id = v_run;
  -- the findings, counted from the table itself, on this run's own terms:
  -- rule findings that are not suppressed — which is what a batch counts
  select jsonb_build_object(
           'error', count(*) filter (where severity = 'error'),
           'warn',  count(*) filter (where severity = 'warn'),
           'info',  count(*) filter (where severity = 'info'))
    into v_if
    from public.dq_issues
   where run_id = v_run and source = 'rule' and status in ('open', 'escalated');
  select jsonb_build_object(
           -- qualified: FOUND is a PL/pgSQL built-in, so a bare `found`
           -- inside a DO block is ambiguous
           'error', coalesce(sum((bt.found->>'error')::int), 0),
           'warn',  coalesce(sum((bt.found->>'warn')::int), 0),
           'info',  coalesce(sum((bt.found->>'info')::int), 0))
    into v_bf
    from public.dq_run_batches bt
   where bt.run_id = v_run;

  if (v_if->>'error')::int <> v_ports then raise exception 'R2: the repaired rule should have raised % errors, the table holds %', v_ports, v_if; end if;
  if v_bf is distinct from v_if then
    raise exception 'R2: the BATCH totals % do not match the findings % — fn_dq_retry_prep left them stale', v_bf, v_if;
  end if;
  if jsonb_build_object('error', (r.found->>'error')::int, 'warn', (r.found->>'warn')::int, 'info', (r.found->>'info')::int) is distinct from v_if then
    raise exception 'R2: the RUN total % does not match the findings %', r.found, v_if;
  end if;
  if r.found = v_before then raise exception 'R2: the run total did not move at all after the repair: %', r.found; end if;
  if r.status <> 'completed_with_errors' then raise exception 'R2: one check is still broken, so the run should stay completed_with_errors, got %', r.status; end if;

  -- ── R3 · a second retry, with nothing changed, moves nothing ─────────────
  v_before := r.found;
  v_res := public.fn_dq_retry_run(v_run);
  select * into r from public.dq_runs where id = v_run;
  if r.found is distinct from v_before then
    raise exception 'R3: retrying again changed the totals from % to % — the repair is accumulating, not recomputing', v_before, r.found;
  end if;
  select jsonb_build_object(
           'error', coalesce(sum((bt.found->>'error')::int), 0),
           'warn',  coalesce(sum((bt.found->>'warn')::int), 0),
           'info',  coalesce(sum((bt.found->>'info')::int), 0))
    into v_bf from public.dq_run_batches bt where bt.run_id = v_run;
  if (v_bf->>'error')::int <> v_ports or (v_bf->>'warn')::int <> v_ports then
    raise exception 'R3: the batch totals drifted on a second retry: %', v_bf;
  end if;

  -- ── R4 · a suppression alone does not rewrite a finished run's history ───
  -- An administrator marks one error a false positive. Nothing is
  -- re-evaluated by that, and the run's totals are the record of what that
  -- run found — so they must NOT move. (The console's open-issue counts come
  -- from dq_issues, which does move.)
  v_before := r.found;
  update public.dq_issues
     set status = 'false_positive', reason = 'smoke: suppressed', suppress_until = now() + interval '1 day',
         suppressed_observed = observed
   where run_id = v_run and rule_code = 'DQ-SMKRA2' and row_key = 'ZZRA001';
  select count(*) into n from public.dq_issues
   where run_id = v_run and source = 'rule' and status in ('open', 'escalated') and severity = 'error';
  if n <> v_ports - 1 then raise exception 'R4: the suppression did not take: % unsuppressed errors', n; end if;
  select * into r from public.dq_runs where id = v_run;
  if r.found is distinct from v_before then
    raise exception 'R4: suppressing a finding rewrote the run history from % to %', v_before, r.found;
  end if;

  -- ── R5 · repair the rest: the recomputation counts what a batch counts ───
  -- Now something IS re-evaluated, so the totals are rebuilt — and the
  -- suppressed row must be excluded, exactly as the evaluator's own RETURNING
  -- clause excludes ignored and false_positive while a batch runs.
  update public.dq_rules
     set checks = jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'notes', 'query_sql', 'select * from public.ports where locode like ''ZZRA%''', 'message', 'retry acct info'))
   where id = v_broken2;
  v_res := public.fn_dq_retry_run(v_run);
  select count(*) into n from public.dq_issues
   where run_id = v_run and source = 'rule' and status in ('open', 'escalated') and severity = 'error';
  select * into r from public.dq_runs where id = v_run;
  if n <> v_ports - 1 then raise exception 'R5: expected % counted errors, got %', v_ports - 1, n; end if;
  if (r.found->>'error')::int <> n then
    raise exception 'R5: the run holds % errors but only % findings are unsuppressed — a suppressed row was counted', r.found->>'error', n;
  end if;
  select * into r from public.dq_runs where id = v_run;
  if r.status <> 'completed' then raise exception 'R5: with every check repaired the run should be completed, got %', r.status; end if;
  if (r.found->>'info')::int <> v_ports then raise exception 'R5: the second repair should have raised % info findings, run holds %', v_ports, r.found; end if;

  select count(*) into n
    from public.dq_run_batches bt
   where bt.run_id = v_run
     and (select count(*) from public.dq_issues i
           where i.run_id = v_run and i.source = 'rule' and i.status in ('open', 'escalated')
             and i.table_name = bt.table_name and i.row_key >= bt.key_from and i.row_key <= bt.key_to)
         is distinct from ((bt.found->>'error')::int + (bt.found->>'warn')::int + (bt.found->>'info')::int);
  if n <> 0 then raise exception 'R5: % batch(es) hold a total that disagrees with the findings in their own key range', n; end if;

  -- and the run total is exactly the sum of the batches, which is exactly the
  -- findings: the whole chain the defect broke
  select jsonb_build_object(
           'error', coalesce(sum((bt.found->>'error')::int), 0),
           'warn',  coalesce(sum((bt.found->>'warn')::int), 0),
           'info',  coalesce(sum((bt.found->>'info')::int), 0))
    into v_bf from public.dq_run_batches bt where bt.run_id = v_run;
  select jsonb_build_object(
           'error', count(*) filter (where severity = 'error'),
           'warn',  count(*) filter (where severity = 'warn'),
           'info',  count(*) filter (where severity = 'info'))
    into v_if from public.dq_issues
   where run_id = v_run and source = 'rule' and status in ('open', 'escalated');
  if v_bf is distinct from v_if then raise exception 'R5: batches % vs findings %', v_bf, v_if; end if;
  if jsonb_build_object('error', (r.found->>'error')::int, 'warn', (r.found->>'warn')::int, 'info', (r.found->>'info')::int) is distinct from v_if then
    raise exception 'R5: run % vs findings %', r.found, v_if;
  end if;

  raise notice 'DQ RETRY ACCOUNTING SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;

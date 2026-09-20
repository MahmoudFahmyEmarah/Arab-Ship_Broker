-- Data Quality · workstream C smoke test (19 Sep 2026, amended 20 Sep)
-- for 20260919130000_dq_c_run_integrity.sql. BEGIN … ROLLBACK.
--   S1  keys are snapshotted at prepare; a row added mid-run is not seen
--   S2  a failed key query, two failed checks in one rule, one rule failing
--       on two tables, and an evaluation error: every one is a failed check
--       unit — completed_with_errors, rules_failed, checks_failed, coverage
--       and rule_errors all agree, nothing is silently excluded
--   S3  retrying while still broken changes nothing
--   S4  repairing one rule and retrying evaluates it over every batch
--   S5  repairing the rest turns completed_with_errors into completed
--   S6  a clean run stays completed at 100 %
--   S7  retry is refused on a clean run and once retention retired the keys

begin;

do $$
declare v_good uuid; v_bad uuid; v_key1 uuid; v_key2 uuid; v_key3 uuid; v_run uuid; v_step jsonb; r public.dq_runs%rowtype; n int; v_snap boolean; v_res jsonb; v_keys int; v_rows int;
begin
  if exists (select 1 from public.ports where locode in ('ZZSMC', 'ZZSMC2')) then raise exception 'ports ZZSMC* exist — pick another key'; end if;
  insert into public.ports (locode, trade_name, country, zone) values ('ZZSMC', 'smoke coverage', 'Testland', 'E.MED');
  v_good := (public.dq_save_rule(jsonb_build_object('code', 'DQ-SMKC1', 'name', 'smoke good', 'severity', 'warn', 'kind', 'declarative', 'enabled', true, 'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'violation_sql', 'r.locode = ''ZZSMC''', 'message', 'smoke'))), null, 'smoke', 'smoke')->>'id')::uuid;
  -- a violation that compiles (the column exists) but fails at run time: an evaluation error in every batch
  v_bad := (public.dq_save_rule(jsonb_build_object('code', 'DQ-SMKC2', 'name', 'smoke broken', 'severity', 'warn', 'kind', 'declarative', 'enabled', true, 'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'violation_sql', '(r.trade_name)::numeric > 0', 'message', 'smoke'))), null, 'smoke', 'smoke')->>'id')::uuid;
  -- a SQL-kind check whose KEY QUERY compiles but fails when materialised
  v_key1 := (public.dq_save_rule(jsonb_build_object('code', 'DQ-SMKC3', 'name', 'smoke key fails', 'severity', 'warn', 'kind', 'sql', 'enabled', true, 'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'query_sql', 'select * from public.ports where (trade_name)::numeric > 0', 'message', 'smoke'))), null, 'smoke', 'smoke')->>'id')::uuid;
  -- two failing key queries in ONE rule
  v_key2 := (public.dq_save_rule(jsonb_build_object('code', 'DQ-SMKC4', 'name', 'smoke two keys fail', 'severity', 'warn', 'kind', 'sql', 'enabled', true, 'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(
      jsonb_build_object('table', 'ports', 'field', 'trade_name', 'query_sql', 'select * from public.ports where (trade_name)::numeric > 1', 'message', 'smoke a'),
      jsonb_build_object('table', 'ports', 'field', 'country', 'query_sql', 'select * from public.ports where (country)::numeric > 1', 'message', 'smoke b'))), null, 'smoke', 'smoke')->>'id')::uuid;
  -- one rule failing on TWO tables
  v_key3 := (public.dq_save_rule(jsonb_build_object('code', 'DQ-SMKC5', 'name', 'smoke two tables fail', 'severity', 'warn', 'kind', 'sql', 'enabled', true, 'tables', jsonb_build_array('ports', 'commodities'),
    'checks', jsonb_build_array(
      jsonb_build_object('table', 'ports', 'field', 'trade_name', 'query_sql', 'select * from public.ports where (trade_name)::numeric > 2', 'message', 'smoke p'),
      jsonb_build_object('table', 'commodities', 'field', 'canonical_name', 'query_sql', 'select * from public.commodities where (canonical_name)::numeric > 2', 'message', 'smoke c'))), null, 'smoke', 'smoke')->>'id')::uuid;

  -- the disposable database may hold no commodities: a failing cast only fails against a row
  insert into public.commodities (canonical_name, cargo_type, imsbc_category) values ('smoke coverage c', 'Dry Bulk', 'Non_DG') on conflict do nothing;

  -- ── S1 · keys are snapshotted at prepare; a row added mid-run is not seen ─
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports","commodities"]}', 'rules', 100, array[v_good, v_bad, v_key1, v_key2, v_key3], 'smoke') returning id into v_run;
  v_res := public.fn_dq_prepare_run(v_run);
  if jsonb_array_length(v_res->'prep_errors') <> 5 then raise exception 'S1: expected 5 key-preparation errors (1 + 2 + 2), got %', v_res->'prep_errors'; end if;
  select count(*) into v_keys from public.dq_run_keys where run_id = v_run and table_name = 'ports';
  select count(*) into v_rows from public.ports;
  if v_keys <> v_rows then raise exception 'S1: snapshot has % keys for % ports', v_keys, v_rows; end if;
  insert into public.ports (locode, trade_name, country, zone) values ('ZZSMC2', 'added mid-run', 'Testland', 'E.MED');
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select * into r from public.dq_runs where id = v_run;
  select count(*) into v_keys from public.dq_run_keys where run_id = v_run;
  if r.rows_done <> v_keys then raise exception 'S1: rows_done % should equal the snapshot %', r.rows_done, v_keys; end if;

  -- ── S2 · every failure is a failed unit and nothing is silent ─────────────
  if r.status <> 'completed_with_errors' then raise exception 'S2: expected completed_with_errors, got %', r.status; end if;
  -- units: good 1 + bad 1 + key1 1 + key2 2 + key3 2 = 7; failed: bad 1 + key1 1 + key2 2 + key3 2 = 6
  if r.checks_expected <> 7 or r.checks_failed <> 6 then raise exception 'S2: check units wrong: expected % failed %', r.checks_expected, r.checks_failed; end if;
  if r.rules_expected <> 5 or r.rules_failed <> 4 or r.rules_ok <> 1 then raise exception 'S2: rule counts wrong: expected % ok % failed %', r.rules_expected, r.rules_ok, r.rules_failed; end if;
  if r.coverage_pct <> round(100 * (1 - 6.0 / 7), 1) then raise exception 'S2: coverage should be %, got %', round(100 * (1 - 6.0 / 7), 1), r.coverage_pct; end if;
  if jsonb_array_length(r.prep_errors) <> 5 then raise exception 'S2: prep_errors lost: %', r.prep_errors; end if;
  select count(*) into n from jsonb_array_elements(r.rule_errors) e where e->>'stage' = 'keys';
  if n <> 5 then raise exception 'S2: rule_errors carries % key errors, expected 5: %', n, r.rule_errors; end if;
  select count(*) into n from jsonb_array_elements(r.rule_errors) e where e->>'stage' = 'eval' and e->>'rule' = 'DQ-SMKC2';
  if n = 0 then raise exception 'S2: the evaluation error is missing from rule_errors: %', r.rule_errors; end if;
  select count(distinct e->>'check_idx') into n from jsonb_array_elements(r.rule_errors) e where e->>'rule' = 'DQ-SMKC4';
  if n <> 2 then raise exception 'S2: two failed checks of one rule should be two units, got %', n; end if;
  select count(distinct e->>'table') into n from jsonb_array_elements(r.rule_errors) e where e->>'rule' = 'DQ-SMKC5';
  if n <> 2 then raise exception 'S2: one rule failing on two tables should be two units, got %', n; end if;
  select partial into v_snap from public.dq_health_snapshots order by at desc limit 1;
  if not v_snap then raise exception 'S2: the snapshot after a run with errors must be partial'; end if;
  if not exists (select 1 from public.dq_issues where rule_code = 'DQ-SMKC1' and row_key = 'ZZSMC' and status = 'open') then raise exception 'S2: the good rule did not raise its finding'; end if;
  if to_regclass('public.dq_notification_outbox') is not null and not exists (select 1 from public.dq_notification_outbox where idem_key = 'run/' || v_run::text) then
    raise exception 'S2: the finished run was not enqueued for notification';
  end if;

  -- ── S3 · retrying while everything is still broken changes nothing ───────
  v_res := public.fn_dq_retry_run(v_run);
  if v_res->>'status' <> 'completed_with_errors' or (v_res->>'prep_still_failed')::int <> 5 then raise exception 'S3: unexpected retry result %', v_res; end if;

  -- ── S4 · repair one key query: it is evaluated over every batch ──────────
  update public.dq_rules set checks = jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'query_sql', 'select * from public.ports where locode = ''ZZSMC''', 'message', 'smoke')) where id = v_key1;
  v_res := public.fn_dq_retry_run(v_run);
  select * into r from public.dq_runs where id = v_run;
  if r.status <> 'completed_with_errors' or jsonb_array_length(r.prep_errors) <> 4 or r.checks_failed <> 5 then raise exception 'S4: after one repair expected 4 prep errors and 5 failed units, got % / % / %', r.status, r.prep_errors, r.checks_failed; end if;
  if not exists (select 1 from public.dq_issues where rule_code = 'DQ-SMKC3' and row_key = 'ZZSMC' and status = 'open') then raise exception 'S4: the repaired rule did not raise its finding on retry'; end if;

  -- ── S5 · repair everything: completed_with_errors → completed ────────────
  update public.dq_rules set checks = jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'violation_sql', 'r.trade_name = ''never''', 'message', 'smoke')) where id = v_bad;
  update public.dq_rules set checks = jsonb_build_array(
      jsonb_build_object('table', 'ports', 'field', 'trade_name', 'query_sql', 'select * from public.ports where locode = ''never''', 'message', 'smoke a'),
      jsonb_build_object('table', 'ports', 'field', 'country', 'query_sql', 'select * from public.ports where locode = ''never''', 'message', 'smoke b')) where id = v_key2;
  update public.dq_rules set checks = jsonb_build_array(
      jsonb_build_object('table', 'ports', 'field', 'trade_name', 'query_sql', 'select * from public.ports where locode = ''never''', 'message', 'smoke p'),
      jsonb_build_object('table', 'commodities', 'field', 'canonical_name', 'query_sql', 'select * from public.commodities where canonical_name = ''never''', 'message', 'smoke c')) where id = v_key3;
  v_res := public.fn_dq_retry_run(v_run);
  select * into r from public.dq_runs where id = v_run;
  if r.status <> 'completed' or r.rules_failed <> 0 or r.checks_failed <> 0 or r.coverage_pct <> 100 or jsonb_array_length(r.prep_errors) <> 0 then
    raise exception 'S5: run not settled clean: % failed % coverage % prep %', r.status, r.rules_failed, r.coverage_pct, r.prep_errors;
  end if;
  select partial into v_snap from public.dq_health_snapshots order by at desc limit 1;
  if v_snap then raise exception 'S5: the snapshot after a clean settle must not be partial'; end if;
  if exists (select 1 from public.dq_run_batches where run_id = v_run and status = 'failed') then raise exception 'S5: failed batches remain'; end if;

  -- ── S6 · a clean run stays completed ─────────────────────────────────────
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_good], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select * into r from public.dq_runs where id = v_run;
  if r.status <> 'completed' or r.coverage_pct <> 100 or r.checks_expected <> 1 or r.checks_failed <> 0 then raise exception 'S6: clean run wrong: % % %', r.status, r.coverage_pct, r.checks_expected; end if;

  -- ── S7 · retry is refused on a clean run, and after retention ────────────
  begin
    perform public.fn_dq_retry_run(v_run);
    raise exception 'S7: retry of a clean run was accepted';
  exception when others then if sqlerrm not like '%completed with errors%' then raise; end if;
  end;
  update public.dq_runs set status = 'completed_with_errors', finished_at = now() - interval '30 days' where id = v_run;
  update public.dq_run_batches bt set status = 'failed' where bt.run_id = v_run and bt.n = 1;
  loop v_res := public.fn_dq_retention(90, 30, 180, 5000); exit when not (v_res->>'more')::boolean; end loop;
  if exists (select 1 from public.dq_run_keys where run_id = v_run) then raise exception 'S7: retention kept a month-old run''s keys'; end if;
  begin
    perform public.fn_dq_retry_batch(v_run, 1);
    raise exception 'S7: retry without a key snapshot was accepted';
  exception when others then if sqlerrm not like '%key snapshot has been retired%' then raise; end if;
  end;

  raise notice 'DQ C SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;

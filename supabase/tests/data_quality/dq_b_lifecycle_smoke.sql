-- Data Quality · workstream B smoke test (19 Sep 2026, amended 20 Sep)
-- for 20260919120000_dq_b_finding_lifecycle.sql. End to end through real
-- scoped runs over the ports table with a throw-away rule. BEGIN … ROLLBACK.
--   S1 a run raises the finding            S6 removed check → check_removed; disable + enable leaves it;
--   S2 ignoring needs a reason                restored check + run reopens it
--   S3 same value: stays ignored           S7 an expired suppression reopens on the next observation
--   S4 changed value: reopens              S8 deleted record → record_gone; recreated + run → open
--   S5 disable parks; ENABLE DOES NOT      S9 unregistered table is a configuration error
--      reopen; the next run does          S10 an AI finding never touches a rule finding

begin;

do $$
declare v_rule uuid; v_run uuid; v_issue uuid; v_status text; v_reason text; v_step jsonb; v_res jsonb; n int; v_events int;
begin
  if exists (select 1 from public.ports where locode = 'ZZSMB') then raise exception 'port ZZSMB exists — pick another key'; end if;
  insert into public.ports (locode, trade_name, country, zone) values ('ZZSMB', 'smoke lifecycle', 'Testland', 'E.MED');
  v_rule := (public.dq_save_rule(jsonb_build_object(
    'code', 'DQ-SMKB', 'name', 'smoke lifecycle rule', 'severity', 'warn', 'kind', 'declarative', 'enabled', true, 'tables', jsonb_build_array('ports'),
    'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'violation_sql', 'r.locode = ''ZZSMB'' and r.trade_name like ''smoke%''', 'message', 'smoke'))), null, 'smoke', 'smoke')->>'id')::uuid;

  -- ── S1 · a run raises the finding ────────────────────────────────────────
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select id, status into v_issue, v_status from public.dq_issues where rule_code = 'DQ-SMKB' and row_key = 'ZZSMB';
  if v_issue is null or v_status <> 'open' then raise exception 'S1: finding not raised (%)', v_status; end if;
  select count(*) into v_events from public.dq_issue_events where issue_id = v_issue;
  if v_events <> 1 then raise exception 'S1: expected 1 event (opened), got %', v_events; end if;

  -- ── S2 · ignoring needs a reason, remembers the value ────────────────────
  begin
    perform public.dq_set_issue_status(array[v_issue], 'ignored', '  ', null, 'smoke');
    raise exception 'S2: ignore without a reason was accepted';
  exception when others then if sqlerrm not like '%reason is required%' then raise; end if;
  end;
  n := public.dq_set_issue_status(array[v_issue], 'ignored', 'known test port', null, 'smoke');
  if n <> 1 then raise exception 'S2: expected 1 updated, got %', n; end if;
  select status, suppressed_observed into v_status, v_reason from public.dq_issues where id = v_issue;
  if v_status <> 'ignored' or v_reason <> 'smoke lifecycle' then raise exception 'S2: suppression not recorded (% / %)', v_status, v_reason; end if;

  -- ── S3 · a re-run with the same value keeps it ignored, no new open issue ─
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select count(*) into n from public.dq_issues where rule_code = 'DQ-SMKB' and row_key = 'ZZSMB';
  if n <> 1 then raise exception 'S3: expected one finding row, got %', n; end if;
  select status into v_status from public.dq_issues where id = v_issue;
  if v_status <> 'ignored' then raise exception 'S3: suppression not honoured (%)', v_status; end if;
  if (select x.found->>'warn' from public.dq_runs x where x.id = v_run)::int <> 0 then raise exception 'S3: a suppressed finding was counted as found'; end if;

  -- ── S4 · the value changes: it reopens with a reason and an event ────────
  update public.ports set trade_name = 'smoke lifecycle v2' where locode = 'ZZSMB';
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select status, reason into v_status, v_reason from public.dq_issues where id = v_issue;
  if v_status <> 'open' or v_reason not like 'Reopened — the value changed%' then raise exception 'S4: not reopened (% / %)', v_status, v_reason; end if;
  select count(*) into v_events from public.dq_issue_events where issue_id = v_issue and to_status = 'open' and from_status = 'ignored';
  if v_events <> 1 then raise exception 'S4: reopen event missing'; end if;

  -- ── S5 · disabling parks; enabling does NOT reopen; the next run does ────
  v_res := public.dq_set_rule_enabled(v_rule, false, null, null, 'smoke', null);
  select status into v_status from public.dq_issues where id = v_issue;
  if v_status <> 'rule_disabled' or (v_res->>'parked')::int <> 1 then raise exception 'S5: not parked (% / %)', v_status, v_res; end if;
  if (select count(*) from public.dq_rule_versions where rule_id = v_rule and note = 'Disabled') <> 1 then raise exception 'S5: no version row for the disable'; end if;
  v_res := public.dq_set_rule_enabled(v_rule, true, null, null, 'smoke', null);
  select status into v_status from public.dq_issues where id = v_issue;
  if v_status <> 'rule_disabled' or (v_res->>'reopened')::int <> 0 then raise exception 'S5: enabling must not reopen (% / %)', v_status, v_res; end if;
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select status, reason into v_status, v_reason from public.dq_issues where id = v_issue;
  if v_status <> 'open' or v_reason not like 'Reopened — the rule is enabled again%' then raise exception 'S5: the run did not reopen the parked finding (% / %)', v_status, v_reason; end if;
  select count(*) into v_events from public.dq_issue_events where issue_id = v_issue and from_status = 'rule_disabled' and to_status = 'open';
  if v_events <> 1 then raise exception 'S5: reopen event missing'; end if;

  -- ── S6 · a removed check parks with its own cause; enable/disable leave it ─
  perform public.dq_save_rule(jsonb_build_object('id', v_rule, 'checks', jsonb_build_array()), null, 'smoke', 'smoke');
  select status, reason into v_status, v_reason from public.dq_issues where id = v_issue;
  if v_status <> 'check_removed' or v_reason <> 'Check removed from the rule' then raise exception 'S6: issue not parked as check_removed (% / %)', v_status, v_reason; end if;
  perform public.dq_set_rule_enabled(v_rule, false, null, null, 'smoke', null);
  perform public.dq_set_rule_enabled(v_rule, true, null, null, 'smoke', null);
  select status into v_status from public.dq_issues where id = v_issue;
  if v_status <> 'check_removed' then raise exception 'S6: disabling and enabling the rule touched a check_removed finding (%)', v_status; end if;
  -- a run without the check cannot reopen it either
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select status into v_status from public.dq_issues where id = v_issue;
  if v_status <> 'check_removed' then raise exception 'S6: a run without the check reopened it (%)', v_status; end if;
  -- the check is restored: the next run that sees the record failing reopens it
  perform public.dq_save_rule(jsonb_build_object('id', v_rule, 'checks', jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'violation_sql', 'r.locode = ''ZZSMB'' and r.trade_name like ''smoke%''', 'message', 'smoke'))), null, 'smoke', 'smoke');
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select status, reason into v_status, v_reason from public.dq_issues where id = v_issue;
  if v_status <> 'open' or v_reason not like 'Reopened — the check is back%' then raise exception 'S6: restored check did not reopen (% / %)', v_status, v_reason; end if;

  -- ── S7 · an expired suppression reopens on the next observation ──────────
  n := public.dq_set_issue_status(array[v_issue], 'ignored', 'ignore for a day', null, 'smoke', 1);
  if (select suppress_until from public.dq_issues where id = v_issue) is null then raise exception 'S7: suppress_until not set'; end if;
  update public.dq_issues set suppress_until = now() - interval '1 second' where id = v_issue;
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select status, reason into v_status, v_reason from public.dq_issues where id = v_issue;
  if v_status <> 'open' or v_reason not like 'Reopened — the suppression expired%' then raise exception 'S7: expired suppression did not reopen (% / %)', v_status, v_reason; end if;
  -- and an unexpired one with the same value stays
  n := public.dq_set_issue_status(array[v_issue], 'false_positive', 'not a defect', null, 'smoke', 30);
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select status into v_status from public.dq_issues where id = v_issue;
  if v_status <> 'false_positive' then raise exception 'S7: an unexpired suppression with the same value was not preserved (%)', v_status; end if;
  n := public.dq_set_issue_status(array[v_issue], 'open', 'smoke reopen', null, 'smoke');

  -- ── S8 · the record disappears, then comes back ──────────────────────────
  delete from public.ports where locode = 'ZZSMB';
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select status, reason into v_status, v_reason from public.dq_issues where id = v_issue;
  if v_status <> 'record_gone' then raise exception 'S8: issue of a deleted record not closed (% / %)', v_status, v_reason; end if;
  insert into public.ports (locode, trade_name, country, zone) values ('ZZSMB', 'smoke lifecycle v3', 'Testland', 'E.MED');
  insert into public.dq_runs (scope, mode, batch_size, rule_ids, started_by_name) values ('{"kind":"tables","tables":["ports"]}', 'rules', 1000, array[v_rule], 'smoke') returning id into v_run;
  perform public.fn_dq_prepare_run(v_run);
  loop v_step := public.fn_dq_process_batch(v_run); exit when (v_step->>'done')::boolean; end loop;
  select status, reason into v_status, v_reason from public.dq_issues where id = v_issue;
  if v_status <> 'open' or v_reason not like 'Reopened — the record exists again%' then raise exception 'S8: recreated record did not reopen (% / %)', v_status, v_reason; end if;

  -- ── S9 · the gate refuses an unregistered table ──────────────────────────
  begin
    perform public.fn_dq_validate('users', '{}'::jsonb, 'admin', 'smoke', null, false);
    raise exception 'S9: validate answered for an unregistered table';
  exception when others then if sqlerrm not like 'DQ_CONFIG:%' then raise; end if;
  end;

  -- ── S10 · an AI finding never touches a rule finding of the same identity ─
  insert into public.dq_issues (rule_code, table_name, row_key, field, observed, severity, source, status) values ('DQ-SMKB', 'ports', 'ZZSMB', 'trade_name', 'x', 'warn', 'ai', 'open');
  select count(*) into n from public.dq_issues where rule_code = 'DQ-SMKB' and row_key = 'ZZSMB';
  if n <> 2 then raise exception 'S10: expected rule and AI findings side by side, got %', n; end if;

  raise notice 'DQ B SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;

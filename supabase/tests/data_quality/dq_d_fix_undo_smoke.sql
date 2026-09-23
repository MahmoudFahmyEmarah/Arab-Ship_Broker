-- Data Quality · workstream D smoke test (19 Sep 2026)
-- for 20260919110000_dq_d_fix_undo_safety.sql. BEGIN … ROLLBACK; writes to
-- ports and dq_* transiently. Run as the database owner.

begin;

do $$
declare v_issue uuid; v_res jsonb; v_name text; v_status text; v_err text; v_rule uuid; v_ok boolean;
begin
  if exists (select 1 from public.ports where locode = 'ZZSMD') then raise exception 'port ZZSMD exists — pick another key'; end if;
  insert into public.ports (locode, trade_name, country, zone) values ('ZZSMD', 'Smoke Fix', 'Testland', 'E.MED');
  insert into public.dq_issues (rule_code, table_name, row_key, row_label, field, observed, expected, severity, source, status, fix)
  values ('DQ-SMK', 'ports', 'ZZSMD', 'Smoke Fix', 'trade_name', 'Smoke Fix', 'Smoke Fixed', 'warn', 'rule', 'open',
          jsonb_build_object('field', 'trade_name', 'value', 'Smoke Fixed'))
  returning id into v_issue;

  -- ── S1 · the fix applies and records before/after ────────────────────────
  v_res := public.dq_apply_fix(v_issue, null, 'smoke', null, null);
  select trade_name into v_name from public.ports where locode = 'ZZSMD';
  if v_name <> 'Smoke Fixed' then raise exception 'S1: fix not applied (%)', v_name; end if;
  select status into v_status from public.dq_issues where id = v_issue;
  if v_status <> 'fixed' then raise exception 'S1: issue not fixed (%)', v_status; end if;
  if (select fix->>'after' from public.dq_issues where id = v_issue) <> 'Smoke Fixed' then raise exception 'S1: after value not recorded'; end if;

  -- ── S2 · a later edit makes undo report a conflict and touch nothing ─────
  update public.ports set trade_name = 'Edited later' where locode = 'ZZSMD';
  v_res := public.dq_undo_fix(v_issue, null, false, null);
  if (v_res->>'ok')::boolean then raise exception 'S2: undo should have reported a conflict: %', v_res; end if;
  if v_res->>'current' <> 'Edited later' or v_res->>'expected' <> 'Smoke Fixed' then raise exception 'S2: conflict detail wrong: %', v_res; end if;
  select trade_name into v_name from public.ports where locode = 'ZZSMD';
  if v_name <> 'Edited later' then raise exception 'S2: undo touched the row'; end if;
  select status into v_status from public.dq_issues where id = v_issue;
  if v_status <> 'fixed' then raise exception 'S2: issue reopened without a restore (%)', v_status; end if;

  -- ── S3 · force needs a reason ────────────────────────────────────────────
  v_ok := false;
  begin
    perform public.dq_undo_fix(v_issue, null, true, '   ');
  exception when others then v_ok := sqlerrm like '%reason is required%';
  end;
  if not v_ok then raise exception 'S3: force without a reason was accepted'; end if;

  -- ── S4 · force restores the one field and records the override ──────────
  v_res := public.dq_undo_fix(v_issue, null, true, 'smoke: the later edit was wrong');
  if not (v_res->>'ok')::boolean or not (v_res->>'forced')::boolean then raise exception 'S4: unexpected result %', v_res; end if;
  select trade_name into v_name from public.ports where locode = 'ZZSMD';
  if v_name <> 'Smoke Fix' then raise exception 'S4: field not restored (%)', v_name; end if;
  if (select country from public.ports where locode = 'ZZSMD') <> 'Testland' then raise exception 'S4: other fields must not change'; end if;
  select status, reason into v_status, v_err from public.dq_issues where id = v_issue;
  if v_status <> 'open' or v_err not like 'Fix undone — forced past a later edit:%' then raise exception 'S4: issue state wrong: % / %', v_status, v_err; end if;
  if not (select undone from public.record_edit_audit where id = (select fixed_audit_id from public.dq_issues where id = v_issue)) then raise exception 'S4: audit not marked undone'; end if;

  -- ── S5 · a clean undo (no later edit) needs no force ─────────────────────
  update public.dq_issues set status = 'open', fixed_audit_id = null, reason = null where id = v_issue;
  v_res := public.dq_apply_fix(v_issue, null, 'smoke', null, null);
  v_res := public.dq_undo_fix(v_issue, null, false, null);
  if not (v_res->>'ok')::boolean or (v_res->>'forced')::boolean then raise exception 'S5: clean undo failed: %', v_res; end if;
  select trade_name into v_name from public.ports where locode = 'ZZSMD';
  if v_name <> 'Smoke Fix' then raise exception 'S5: not restored (%)', v_name; end if;

  -- ── S6 · a rule that cannot evaluate refuses the fix (fail closed) ────────
  update public.dq_issues set status = 'open', fixed_audit_id = null where id = v_issue;
  insert into public.dq_rules (code, name, description, category, severity, kind, definition, checks, tables, enabled, source)
  values ('DQ-SMKX', 'smoke broken rule', 'evaluates a column that does not exist', 'validity', 'error', 'declarative', 'x',
          jsonb_build_array(jsonb_build_object('table', 'ports', 'field', 'trade_name', 'violation_sql', 'r.no_such_column is null', 'message', 'broken')),
          array['ports'], true, 'admin')
  returning id into v_rule;
  v_ok := false;
  begin
    perform public.dq_apply_fix(v_issue, null, 'smoke', null, null);
  exception when others then v_ok := sqlerrm like '%could not be evaluated%';
  end;
  if not v_ok then raise exception 'S6: a fix went through while a rule could not evaluate'; end if;
  select trade_name into v_name from public.ports where locode = 'ZZSMD';
  if v_name <> 'Smoke Fix' then raise exception 'S6: the refused fix left its write behind (%)', v_name; end if;

  raise notice 'DQ D SMOKE: ALL ASSERTIONS PASSED';
end $$;

rollback;

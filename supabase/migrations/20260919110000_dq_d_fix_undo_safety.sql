-- ════════════════════════════════════════════════════════════════════════
-- Data Quality · workstream D — fixes fail closed, undo is conflict-aware
-- (19 Sep 2026, audit blocker 6)
--
--   dq_apply_fix   used to refuse only when the gate BLOCKED; a rule that
--       failed to evaluate (errors counter) let the fix through. Now that is
--       a refusal too — the same rule the approval path, the forms trigger
--       and the Data Sync commit apply.
--   dq_undo_fix    used to restore the whole before-image without looking at
--       the row, overwriting anything edited since; and since 18 Sep, when
--       it delegated to undo_record_edits, it ignored that function's new
--       conflict answer and reopened the issue with nothing restored. Now it
--       restores the ONE field the fix changed, only when that field still
--       holds the fix's after-value; otherwise it returns the conflict and
--       touches nothing. p_force restores anyway, requires a reason, and
--       records the override on the issue.
-- Idempotent.
-- ════════════════════════════════════════════════════════════════════════

set local lock_timeout = '5s';
set local statement_timeout = '10min';

create or replace function public.dq_apply_fix(p_issue_id uuid, p_actor uuid default null, p_actor_name text default null, p_value text default null, p_field text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare i public.dq_issues%rowtype; v_key text; v_field text; v_val text; v_before jsonb; v_after jsonb; v_patch jsonb; v_audit uuid; v_res jsonb; v_gate jsonb; v_sync_key text; v_sync_val text;
begin
  select * into i from public.dq_issues where id = p_issue_id for update;
  if not found then raise exception 'issue not found' using errcode = 'P0002'; end if;
  if i.status <> 'open' then raise exception 'issue is %, only open issues can be fixed', i.status using errcode = '22023'; end if;
  v_field := coalesce(i.fix->>'field', i.field);
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

  -- the gate judges the row as it now stands; a block OR a rule that could
  -- not evaluate refuses the fix (the raise rolls the write back)
  v_gate := public.fn_dq_validate(i.table_name, v_after, 'admin', p_actor_name, p_actor, true);
  if (v_gate->>'blocked')::boolean then
    raise exception 'Fix refused by the gate: %', (select string_agg(x->>'rule_code' || ' — ' || (x->>'message'), '; ') from jsonb_array_elements(v_gate->'issues') x where x->>'mode' = 'block') using errcode = '23514';
  end if;
  if coalesce((v_gate->>'errors')::int, 0) > 0 then
    raise exception 'Fix refused: % data-quality rule(s) could not be evaluated on this row, so the gate cannot vouch for it. See Data quality → Gate → log for the rule that failed.', (v_gate->>'errors')::int using errcode = '23514';
  end if;

  update public.dq_issues set status = 'fixed', reason = coalesce(reason, 'Fix applied'), fixed_audit_id = v_audit, resolved_at = now(), resolved_by = p_actor, resolved_by_name = p_actor_name,
    fix = coalesce(fix, '{}'::jsonb) || jsonb_build_object('field', v_field, 'value', v_val, 'applied_at', now(), 'before', v_before->>v_field, 'after', v_after->>v_field)
  where id = p_issue_id;
  return jsonb_build_object('audit_id', v_audit, 'field', v_field, 'value', v_val, 'gate', v_gate);
end $function$;

drop function if exists public.dq_undo_fix(uuid, uuid);
create or replace function public.dq_undo_fix(p_issue_id uuid, p_actor uuid default null, p_force boolean default false, p_reason text default null) returns jsonb
language plpgsql security definer set search_path to '' as $$
declare i public.dq_issues%rowtype; a public.record_edit_audit%rowtype; v_key text; v_field text; v_current jsonb; v_cur text; v_after text; v_before text; v_conflict boolean;
begin
  select * into i from public.dq_issues where id = p_issue_id for update;
  if not found or i.fixed_audit_id is null then raise exception 'nothing to undo' using errcode = 'P0002'; end if;
  select * into a from public.record_edit_audit where id = i.fixed_audit_id;
  if not found then raise exception 'audit row missing' using errcode = 'P0002'; end if;
  if a.undone then raise exception 'already undone' using errcode = '22023'; end if;
  v_field := coalesce(i.fix->>'field', i.field);
  if v_field is null then raise exception 'the fix did not record its field' using errcode = '22023'; end if;
  select key_column into v_key from public.dq_tables where table_name = a.table_name;

  execute format('select to_jsonb(r) from public.%I r where r.%I::text = $1', a.table_name, v_key) using a.business_key into v_current;
  if v_current is null then
    raise exception 'row % no longer exists in %', a.business_key, a.table_name using errcode = 'P0002';
  end if;
  v_cur := v_current->>v_field; v_after := a.after->>v_field; v_before := a.before->>v_field;
  v_conflict := v_cur is distinct from v_after;

  if v_conflict and not p_force then
    return jsonb_build_object('ok', false, 'field', v_field, 'expected', v_after, 'current', v_cur, 'before', v_before,
      'message', format('%s was changed after the fix (now "%s", the fix set "%s"); undo would overwrite that later edit', v_field, coalesce(v_cur, '—'), coalesce(v_after, '—')));
  end if;
  if v_conflict and coalesce(btrim(p_reason), '') = '' then
    raise exception 'a reason is required to force an undo past a later edit' using errcode = '22023';
  end if;

  -- restore the one field the fix changed, typed through the table's row type
  execute format('update public.%I t set %I = s.%I from jsonb_populate_record(null::public.%I, $1) s where t.%I::text = $2',
                 a.table_name, v_field, v_field, a.table_name, v_key)
    using jsonb_build_object(v_field, a.before -> v_field), a.business_key;
  update public.record_edit_audit set undone = true, undone_at = now(), undone_by = p_actor where id = a.id;
  update public.dq_issues
     set status = 'open', reason = case when v_conflict then 'Fix undone — forced past a later edit: ' || btrim(p_reason) else 'Fix undone' end,
         resolved_at = null, resolved_by = null, resolved_by_name = null,
         fix = coalesce(fix, '{}'::jsonb) || jsonb_build_object('undone_at', now(), 'forced', v_conflict, 'overwrote', case when v_conflict then v_cur end)
   where id = p_issue_id;
  return jsonb_build_object('ok', true, 'field', v_field, 'restored_to', v_before, 'forced', v_conflict);
end $$;

revoke all on function public.dq_apply_fix(uuid, uuid, text, text, text) from public, anon, authenticated, dq_evaluator;
revoke all on function public.dq_undo_fix(uuid, uuid, boolean, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.dq_apply_fix(uuid, uuid, text, text, text) to service_role;
grant execute on function public.dq_undo_fix(uuid, uuid, boolean, text) to service_role;

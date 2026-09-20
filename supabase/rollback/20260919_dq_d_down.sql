-- DOWN for 20260919110000_dq_d_fix_undo_safety.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260919_dq_d_down.sql
--   supabase migration repair --status reverted 20260919110000
-- Self-contained: every function body below is verbatim from the migration that last defined it.
-- History-bearing tables are renamed to *_bak_20260919110000, never dropped.
-- Deploy the pre-D application first (it calls the new undo signature). Restores dq_apply_fix (20260910140000)
-- and dq_undo_fix (20260908130000).
set local lock_timeout = '5s';
set local statement_timeout = '10min';

drop function if exists public.dq_undo_fix(uuid, uuid, boolean, text);
CREATE OR REPLACE FUNCTION "public"."dq_apply_fix"("p_issue_id" "uuid", "p_actor" "uuid" DEFAULT NULL::"uuid", "p_actor_name" "text" DEFAULT NULL::"text", "p_value" "text" DEFAULT NULL::"text", "p_field" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
end $_$;
revoke all on function public.dq_apply_fix(uuid, uuid, text, text, text) from public, anon, authenticated, dq_evaluator;
grant execute on function public.dq_apply_fix(uuid, uuid, text, text, text) to service_role;

-- dq_undo_fix exactly as deployed (production dump of 19 Sep 2026)
CREATE OR REPLACE FUNCTION "public"."dq_undo_fix"("p_issue_id" "uuid", "p_actor" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare i public.dq_issues%rowtype; a public.record_edit_audit%rowtype; v_key text; v_set text;
begin
  select * into i from public.dq_issues where id = p_issue_id for update;
  if not found or i.fixed_audit_id is null then raise exception 'nothing to undo' using errcode = 'P0002'; end if;
  select * into a from public.record_edit_audit where id = i.fixed_audit_id;
  if not found then raise exception 'audit row missing' using errcode = 'P0002'; end if;
  if a.undone then raise exception 'already undone' using errcode = '22023'; end if;
  if public.fn_sync_table_allowed(a.table_name) and public.fn_sync_key_column(a.table_name) is not null and a.business_key = (a.before->>public.fn_sync_key_column(a.table_name)) then
    perform public.undo_record_edits(a.id, null, p_actor);
  else
    select key_column into v_key from public.dq_tables where table_name = a.table_name;
    select string_agg(format('%I = s.%I', column_name, column_name), ', ') into v_set
    from information_schema.columns where table_schema = 'public' and table_name = a.table_name and is_generated = 'NEVER';
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) s where t.%I::text = $2', a.table_name, v_set, a.table_name, v_key) using a.before, a.business_key;
    update public.record_edit_audit set undone = true, undone_at = now(), undone_by = p_actor where id = a.id;
  end if;
  update public.dq_issues set status = 'open', reason = 'Fix undone', resolved_at = null, resolved_by = null, resolved_by_name = null where id = p_issue_id;
  return jsonb_build_object('ok', true);
end $_$;
revoke all on function public.dq_undo_fix(uuid, uuid) from public, anon, authenticated, dq_evaluator;
grant execute on function public.dq_undo_fix(uuid, uuid) to service_role;

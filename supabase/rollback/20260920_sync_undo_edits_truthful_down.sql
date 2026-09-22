-- DOWN for 20260920120000_sync_undo_edits_truthful.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260920_sync_undo_edits_truthful_down.sql
--   supabase migration repair --status reverted 20260920120000
-- Restores undo_record_edits exactly as 20260918120000 (phase 2) defined it.
-- Note: the phase-2 body does not take fn_sync_row_lock; roll 20260920110000 back after this one, never before.

create or replace function public.undo_record_edits(
  p_audit_id uuid default null, p_group_id uuid default null, p_actor uuid default null, p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  r            record;
  v_key_col    text;
  v_all_set    text;
  v_current    jsonb;
  v_changed    text[];
  v_conflicts  jsonb := '[]'::jsonb;
  v_restored   int := 0;
  v_reinserted int := 0;
  v_removed    int := 0;
begin
  if p_audit_id is null and p_group_id is null then
    raise exception 'need audit_id or group_id';
  end if;

  -- pass 1 · conflicts
  for r in
    select * from public.record_edit_audit
    where undone = false
      and ((p_audit_id is not null and id = p_audit_id)
        or (p_group_id is not null and group_id = p_group_id))
    order by edited_at desc
  loop
    v_key_col := public.fn_sync_key_column(r.table_name);
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', r.table_name, v_key_col)
      into v_current using r.business_key;
    if r.op = 'update' then
      if v_current is null then v_changed := array['(row deleted since the edit)'];
      else v_changed := public.fn_sync_row_conflicts(r.after, v_current); end if;
    elsif r.op = 'delete' then
      v_changed := case when v_current is not null then array['(row re-created since the delete)'] else '{}'::text[] end;
    else -- insert
      if v_current is null then continue; end if;
      v_changed := public.fn_sync_row_conflicts(r.after, v_current);
    end if;
    if coalesce(array_length(v_changed, 1), 0) > 0 then
      v_conflicts := v_conflicts || jsonb_build_object(
        'audit_id', r.id, 'table', r.table_name, 'key', r.business_key, 'op', r.op, 'changed', to_jsonb(v_changed));
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 and not p_force then
    return jsonb_build_object('ok', false, 'restored', 0, 'reinserted', 0, 'removed', 0, 'forced', 0, 'conflicts', v_conflicts);
  end if;

  -- pass 2 · apply
  for r in
    select * from public.record_edit_audit
    where undone = false
      and ((p_audit_id is not null and id = p_audit_id)
        or (p_group_id is not null and group_id = p_group_id))
    order by edited_at desc
  loop
    v_key_col := public.fn_sync_key_column(r.table_name);
    if r.op = 'update' then
      -- restore every column from the before-image (UPDATE, so no FK cascade)
      select string_agg(format('%I = s.%I', column_name, column_name), ', ')
        into v_all_set
      from information_schema.columns
      where table_schema = 'public' and table_name = r.table_name and is_generated = 'NEVER';
      execute format(
        'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) as s where t.%I::text = $2',
        r.table_name, v_all_set, r.table_name, v_key_col
      ) using r.before, r.business_key;
      v_restored := v_restored + 1;
    elsif r.op = 'delete' then
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)',
                     r.table_name, r.table_name) using r.before;
      v_reinserted := v_reinserted + 1;
    elsif r.op = 'insert' then
      execute format('delete from public.%I t where t.%I::text = $1', r.table_name, v_key_col)
        using r.business_key;
      v_removed := v_removed + 1;
    end if;
    update public.record_edit_audit
      set undone = true, undone_at = now(), undone_by = p_actor
    where id = r.id;
  end loop;

  if v_restored + v_reinserted + v_removed = 0 then
    raise exception 'nothing to undo' using errcode = 'P0002';
  end if;
  return jsonb_build_object('ok', true, 'restored', v_restored, 'reinserted', v_reinserted, 'removed', v_removed,
                            'forced', jsonb_array_length(v_conflicts), 'conflicts', v_conflicts);
end $$;
revoke all on function public.undo_record_edits(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.undo_record_edits(uuid, uuid, uuid, boolean) to service_role;

alter table public.record_edit_audit drop column if exists undo_conflict;

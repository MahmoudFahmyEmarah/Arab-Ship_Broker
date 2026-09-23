-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · a forced direct-edit undo tells the truth (20 Sep 2026)
--
-- Defect (P0-4): undo_record_edits counted and marked an audit row undone
-- whether or not anything changed. A forced undo of an update whose row had
-- been deleted since updated zero rows and still reported "restored"; a
-- forced undo of a delete whose key had been re-created raised a duplicate
-- key or silently left the re-created row in place.
--
-- Now, per audit row, newest first, under the row lock of
-- 20260920110000 (fn_sync_row_lock + FOR UPDATE):
--   update  row present   → every column of the before-image is written back
--           row deleted   → the complete before-image is re-created
--   delete  key absent    → the before-image is re-created
--           key re-created→ the before-image overwrites the re-created row
--   insert  row present   → removed
--           row absent    → nothing to remove; the desired state already holds
-- After each action the row is read again and compared with the desired
-- final state (before-image present and equal, or absent); a mismatch raises
-- UNDO_VERIFY and the whole undo rolls back. Counters move only after a
-- verified restoration / re-creation / removal, and the audit row is marked
-- undone only then. Pass 1 (report conflicts, change nothing) is unchanged;
-- a forced override is recorded on the audit row (undo_conflict).
--
-- Idempotent. Service-role only. DOWN: supabase/rollback/20260920_sync_undo_edits_truthful_down.sql
-- ════════════════════════════════════════════════════════════════════════

alter table public.record_edit_audit add column if not exists undo_conflict jsonb;
comment on column public.record_edit_audit.undo_conflict is 'When the undo was forced past a later change: {changed:[columns…]} at the time of the undo.';

create or replace function public.undo_record_edits(
  p_audit_id uuid default null, p_group_id uuid default null, p_actor uuid default null, p_force boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_lock_tables text[];
  v_lock_keys   text[];
  r            record;
  v_key_col    text;
  v_cols       text;
  v_set_upd    text;
  v_current    jsonb;
  v_changed    text[];
  v_left       text[];
  v_conflicts  jsonb := '[]'::jsonb;
  v_matched    int := 0;
  v_restored   int := 0;
  v_reinserted int := 0;
  v_removed    int := 0;
  v_skipped    int := 0;
begin
  if p_audit_id is null and p_group_id is null then
    raise exception 'need audit_id or group_id';
  end if;

  -- H (21 Sep 2026): take every lock first, in the global (table, key) order,
  -- so an undo cannot deadlock against a commit or a bulk edit that touches
  -- the same rows in a different order.
  select coalesce(array_agg(x.table_name   order by x.table_name, x.business_key), '{}'::text[]),
         coalesce(array_agg(x.business_key order by x.table_name, x.business_key), '{}'::text[])
    into v_lock_tables, v_lock_keys
    from (select distinct a.table_name, a.business_key from public.record_edit_audit a
           where a.undone = false and a.business_key is not null
             and ((p_audit_id is not null and a.id = p_audit_id)
               or (p_group_id is not null and a.group_id = p_group_id))) x;
  perform public.fn_sync_lock_all(v_lock_tables, v_lock_keys);

  -- pass 1 · conflicts. Nothing is written; the rows are locked so what is
  -- reported here is still true when pass 2 acts.
  for r in
    select * from public.record_edit_audit
    where undone = false
      and ((p_audit_id is not null and id = p_audit_id)
        or (p_group_id is not null and group_id = p_group_id))
    order by edited_at desc, id desc
  loop
    v_matched := v_matched + 1;
    if not public.fn_sync_table_allowed(r.table_name) then
      raise exception 'undo target table % is not permitted', r.table_name;
    end if;
    v_key_col := public.fn_sync_key_column(r.table_name);
    if v_key_col is null then raise exception 'no business key for %', r.table_name; end if;
    perform public.fn_sync_row_lock(r.table_name, r.business_key);
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', r.table_name, v_key_col)
      into v_current using r.business_key;
    if r.op = 'update' then
      if v_current is null then v_changed := array['(row deleted since the edit)'];
      else v_changed := public.fn_sync_row_conflicts(r.after, v_current); end if;
    elsif r.op = 'delete' then
      v_changed := case when v_current is not null then array['(row re-created since the delete)'] else '{}'::text[] end;
    else -- insert
      if v_current is null then continue; end if;   -- already gone: the desired final state holds
      v_changed := public.fn_sync_row_conflicts(r.after, v_current);
    end if;
    if coalesce(array_length(v_changed, 1), 0) > 0 then
      v_conflicts := v_conflicts || jsonb_build_object(
        'audit_id', r.id, 'table', r.table_name, 'key', r.business_key, 'op', r.op, 'changed', to_jsonb(v_changed));
    end if;
  end loop;

  if v_matched = 0 then
    raise exception 'nothing to undo' using errcode = 'P0002';
  end if;
  if jsonb_array_length(v_conflicts) > 0 and not p_force then
    return jsonb_build_object('ok', false, 'restored', 0, 'reinserted', 0, 'removed', 0, 'skipped', 0, 'forced', 0, 'conflicts', v_conflicts);
  end if;

  -- pass 2 · apply, verify, then mark
  for r in
    select * from public.record_edit_audit
    where undone = false
      and ((p_audit_id is not null and id = p_audit_id)
        or (p_group_id is not null and group_id = p_group_id))
    order by edited_at desc, id desc
  loop
    v_key_col := public.fn_sync_key_column(r.table_name);
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', r.table_name, v_key_col)
      into v_current using r.business_key;

    if r.op = 'insert' then
      if v_current is not null then
        execute format('delete from public.%I t where t.%I::text = $1', r.table_name, v_key_col) using r.business_key;
        v_removed := v_removed + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
      execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', r.table_name, v_key_col)
        into v_current using r.business_key;
      if v_current is not null then
        raise exception 'UNDO_VERIFY: % % is still present after the undo of its insert', r.table_name, r.business_key using errcode = '55000';
      end if;
    else
      -- update or delete: the before-image is the desired final state, whether
      -- the row is still there (write every column back), gone (re-create
      -- it) or re-created by someone else (overwrite it). Only columns the
      -- before-image knows are written; columns added since keep their value.
      select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position),
             string_agg(format('%I = s.%I', c.column_name, c.column_name), ', ' order by c.ordinal_position) filter (where c.column_name <> v_key_col)
        into v_cols, v_set_upd
        from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = r.table_name
         and c.is_generated = 'NEVER' and (r.before ? c.column_name);
      if v_cols is null then
        raise exception 'UNDO_VERIFY: the before-image of % % has no restorable column', r.table_name, r.business_key using errcode = '55000';
      end if;
      if v_current is not null then
        if v_set_upd is not null then
          execute format(
            'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) as s where t.%I::text = $2',
            r.table_name, v_set_upd, r.table_name, v_key_col
          ) using r.before, r.business_key;
        end if;
        if r.op = 'update' then v_restored := v_restored + 1; else v_reinserted := v_reinserted + 1; end if;
      else
        execute format(
          'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)',
          r.table_name, v_cols, v_cols, r.table_name
        ) using r.before;
        v_reinserted := v_reinserted + 1;
      end if;
      -- verify: the row exists and matches the before-image (volatile columns ignored)
      execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', r.table_name, v_key_col)
        into v_current using r.business_key;
      if v_current is null then
        raise exception 'UNDO_VERIFY: % % is absent after the undo', r.table_name, r.business_key using errcode = '55000';
      end if;
      v_left := public.fn_sync_row_conflicts(r.before, v_current);
      if coalesce(array_length(v_left, 1), 0) > 0 then
        raise exception 'UNDO_VERIFY: % % differs from its before-image after the undo (%)', r.table_name, r.business_key, array_to_string(v_left, ', ') using errcode = '55000';
      end if;
    end if;

    update public.record_edit_audit
       set undone = true, undone_at = now(), undone_by = p_actor,
           undo_conflict = (select c from jsonb_array_elements(v_conflicts) c where (c->>'audit_id')::uuid = r.id)
     where id = r.id;
  end loop;

  return jsonb_build_object('ok', true, 'restored', v_restored, 'reinserted', v_reinserted, 'removed', v_removed, 'skipped', v_skipped,
                            'forced', jsonb_array_length(v_conflicts), 'conflicts', v_conflicts);
end $$;

revoke all on function public.undo_record_edits(uuid, uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.undo_record_edits(uuid, uuid, uuid, boolean) to service_role;

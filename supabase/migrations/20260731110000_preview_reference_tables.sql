-- Data Sync · Database Preview — reference tables + full CRUD (31 Jul 2026)
--
-- The owner reviews lookup data inside the module, so:
--   1. The classification reference tables (market_names, grain_list,
--      imsbc_codes, css_categories) join the audited-edit whitelist.
--   2. insert_live_record — audited ADD with the same one-click undo the
--      edit/delete paths already have (undo deletes the inserted row).
--   3. bulk_delete_live_records — delete many selected rows as one audit
--      group (single-click undo re-inserts them all). Atomic: one FK-blocked
--      row aborts the whole group, nothing partial.
--   4. undo_record_edits learns op='insert'.
--
-- Rollback: re-run the Phase 1/4 definitions of fn_sync_key_column,
-- fn_sync_table_allowed and undo_record_edits (20260704090000 /
-- 20260704120000), drop the two new functions, and restore the audit
-- constraints:
--   alter table record_edit_audit alter column before set not null;
--   ...op check back to ('update','delete').

-- ── 1 · whitelist the classification reference tables ───────────────────────
create or replace function public.fn_sync_key_column(p_table text)
 returns text
 language sql
 immutable
 set search_path to ''
as $function$
  select case p_table
    when 'cargo_listings' then 'ref'
    when 'vessels'        then 'imo_number'
    when 'organizations'  then 'name'
    when 'ports'          then 'locode'
    when 'commodities'    then 'canonical_name'
    when 'market_names'   then 'market_name'
    when 'grain_list'     then 'market_name'
    when 'imsbc_codes'    then 'bcsn'
    when 'css_categories' then 'code'
    else null
  end;
$function$;

create or replace function public.fn_sync_table_allowed(p_table text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select p_table in (
    'cargo_listings','vessels','organizations','ports','commodities',
    'market_names','grain_list','imsbc_codes','css_categories'
  );
$function$;

-- ── 2 · audit table accepts inserts (before-image is null for op=insert) ────
alter table public.record_edit_audit alter column before drop not null;
alter table public.record_edit_audit drop constraint if exists record_edit_audit_op_check;
alter table public.record_edit_audit
  add constraint record_edit_audit_op_check check (op in ('insert', 'update', 'delete'));
alter table public.record_edit_audit drop constraint if exists record_edit_audit_before_check;
alter table public.record_edit_audit
  add constraint record_edit_audit_before_check check (op = 'insert' or before is not null);

-- ── 3 · insert one live record (audited; undo deletes it again) ─────────────
create or replace function public.insert_live_record(
  p_table text, p_row jsonb, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_key_col text;
  v_key     text;
  v_cols    text;
  v_sel     text;
  v_exists  jsonb;
  v_after   jsonb;
  v_audit_id uuid;
begin
  if not public.fn_sync_table_allowed(p_table) then
    raise exception 'table % is not editable', p_table using errcode = '42501';
  end if;
  v_key_col := public.fn_sync_key_column(p_table);
  if v_key_col is null then raise exception 'no business key for %', p_table; end if;

  v_key := btrim(coalesce(p_row ->> v_key_col, ''));
  if v_key = '' then
    raise exception '% is required', v_key_col using errcode = '22023';
  end if;

  -- duplicate business key → clean error before any dynamic insert runs
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_exists using v_key;
  if v_exists is not null then
    raise exception '"%" already exists in %', v_key, p_table using errcode = '23505';
  end if;

  -- real, non-generated columns present in the row; id/timestamps keep defaults
  select string_agg(quote_ident(c.column_name), ', '),
         string_agg(format('s.%I', c.column_name), ', ')
    into v_cols, v_sel
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and c.is_generated = 'NEVER'
    and c.column_name = any (select jsonb_object_keys(p_row))
    and c.column_name not in ('id', 'created_at', 'updated_at');
  if v_cols is null then raise exception 'no insertable fields' using errcode = '22023'; end if;

  execute format(
    'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) as s',
    p_table, v_cols, v_sel, p_table
  ) using p_row;

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_after using v_key;

  insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by)
  values (p_table, v_key, 'insert', null, v_after, p_actor)
  returning id into v_audit_id;

  return jsonb_build_object('audit_id', v_audit_id, 'after', v_after);
end $$;

-- ── 4 · delete many records as one undoable group ───────────────────────────
create or replace function public.bulk_delete_live_records(
  p_table text, p_keys text[], p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_key_col text;
  v_group   uuid := gen_random_uuid();
  v_key     text;
  v_before  jsonb;
  v_n       int := 0;
begin
  if not public.fn_sync_table_allowed(p_table) then
    raise exception 'table % is not editable', p_table using errcode = '42501';
  end if;
  v_key_col := public.fn_sync_key_column(p_table);

  foreach v_key in array p_keys loop
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
      into v_before using v_key;
    if v_before is null then continue; end if;
    insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by, group_id)
    values (p_table, v_key, 'delete', v_before, null, p_actor, v_group);
    execute format('delete from public.%I t where t.%I::text = $1', p_table, v_key_col) using v_key;
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'no matching records to delete' using errcode = 'P0002';
  end if;
  return jsonb_build_object('deleted', v_n, 'group_id', v_group);
end $$;

-- ── 5 · undo learns inserts (delete the row that was added) ─────────────────
create or replace function public.undo_record_edits(
  p_audit_id uuid default null, p_group_id uuid default null, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  r            record;
  v_key_col    text;
  v_all_set    text;
  v_restored   int := 0;
  v_reinserted int := 0;
  v_removed    int := 0;
begin
  if p_audit_id is null and p_group_id is null then
    raise exception 'need audit_id or group_id';
  end if;

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
  return jsonb_build_object('restored', v_restored, 'reinserted', v_reinserted, 'removed', v_removed);
end $$;

-- ── 6 · lock the new helpers to service_role ────────────────────────────────
revoke all on function public.insert_live_record(text, jsonb, uuid)        from public, anon, authenticated;
revoke all on function public.bulk_delete_live_records(text, text[], uuid) from public, anon, authenticated;
grant execute on function public.insert_live_record(text, jsonb, uuid)        to service_role;
grant execute on function public.bulk_delete_live_records(text, text[], uuid) to service_role;

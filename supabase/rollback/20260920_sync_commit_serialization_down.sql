-- DOWN for 20260920110000_sync_commit_serialization.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260920_sync_commit_serialization_down.sql
--   supabase migration repair --status reverted 20260920110000
-- Deploy the pre-serialisation application first (it reads commit_sync_batch's status/remaining fields).
-- Restores: commit_sync_batch (20260918140000, phase 4), undo_sync_batch (20260918120000, phase 2),
-- edit_live_record / insert_live_record / bulk_update_live_records (20260918130000, phase 3),
-- delete_live_record (20260704120000), bulk_delete_live_records (20260731110000); drops the lock helper.

create or replace function public.commit_sync_batch(
  p_batch_id uuid, p_sheet text default null, p_row_ids uuid[] default null
) returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare
  b          public.sync_batch%rowtype;
  r          record;
  v_tbl      text;
  v_keycol   text;
  v_before   jsonb;
  v_after    jsonb;
  v_cols     text;
  v_setclause text;
  v_op       text;
  v_inserted int := 0;
  v_updated  int := 0;
  v_skipped  int := 0;
  v_batch_ports text[];
  v_unknown  text[];
  v_remaining boolean;
  v_any_audit boolean;
  v_resting   text;
  v_stale     int;
  v_stale_why text;
begin
  select * into b from public.sync_batch where id = p_batch_id for update;
  if not found then
    raise exception 'sync batch % not found', p_batch_id;
  end if;
  if b.status = 'committed' then
    raise exception 'BATCH_STATE: this batch is already committed' using errcode = '55000';
  end if;
  if b.status = 'undone' then
    raise exception 'BATCH_STATE: an undone batch cannot be committed again — stage it afresh' using errcode = '55000';
  end if;
  if b.status = 'gate_failed' then
    raise exception 'BATCH_STATE: the data-quality gate did not run on this batch — run the gate first' using errcode = '55000';
  end if;
  if b.status = 'committing' then
    raise exception 'BATCH_STATE: another commit of this batch is in progress' using errcode = '55000';
  end if;
  v_resting := case when b.status = 'failed' then 'gated' else b.status end;

  select count(*), string_agg(distinct reason, '; ')
    into v_stale, v_stale_why
    from public.fn_sync_gate_stale(p_batch_id, p_sheet, p_row_ids);
  if v_stale > 0 then
    raise exception 'GATE_STALE: % row(s) must pass the data-quality gate before they can be committed (%) — run the gate on this batch and try again', v_stale, v_stale_why
      using errcode = '55000';
  end if;

  update public.sync_batch set status = 'committing' where id = p_batch_id;

  select coalesce(array_agg(upper(payload->>'locode')) filter (where nullif(payload->>'locode','') is not null), '{}')
    into v_batch_ports
  from public.sync_staged_row where batch_id = p_batch_id and sheet = 'ports';

  for r in
    select * from public.sync_staged_row
    where batch_id = p_batch_id
      and (p_sheet is null or sheet = p_sheet)
      and (p_row_ids is null or id = any (p_row_ids))
      and committed = false
      and classification in ('new','updated')
    order by case sheet
               when 'ports' then 1 when 'commodities' then 2
               when 'companies' then 3 when 'vessels' then 4
               when 'cargo' then 5 else 6 end,
             row_index nulls last, created_at
  loop
    v_tbl    := r.target_table;
    v_keycol := r.key_column;

    if not fn_sync_table_allowed(v_tbl) then
      raise exception 'sync target table % is not permitted', v_tbl;
    end if;
    if v_keycol is distinct from fn_sync_key_column(v_tbl) then
      raise exception 'key column mismatch for %: staged=% expected=%',
        v_tbl, v_keycol, fn_sync_key_column(v_tbl);
    end if;

    -- phase 4: a port code the registry does not know is refused, never
    -- silently removed — the committed record must be what the reviewer saw
    if v_tbl = 'cargo_listings' then
      v_unknown := fn_sync_unknown_ports(r.payload, v_batch_ports);
      if coalesce(array_length(v_unknown, 1), 0) > 0 then
        raise exception 'PORT_UNKNOWN: row % (%) names port code(s) not in the registry: % — place them in Admin → Ports or correct the row, then run the gate again',
          coalesce(r.business_key, r.id::text), r.sheet, array_to_string(v_unknown, ', ')
          using errcode = '55000';
      end if;
    end if;

    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', v_tbl, v_keycol)
      into v_before using r.business_key;

    v_op := case when v_before is null then 'insert' else 'update' end;

    select string_agg(quote_ident(k), ', ') into v_cols
    from jsonb_object_keys(r.payload) k
    where jsonb_typeof(r.payload -> k) <> 'null';

    if v_cols is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_op = 'insert' then
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)
           on conflict (%I) do nothing
         returning to_jsonb(public.%I.*)',
        v_tbl, v_cols, v_cols, v_tbl, v_keycol, v_tbl
      ) into v_after using r.payload;
    else
      select string_agg(format('%I = s.%I', k, k), ', ') into v_setclause
      from jsonb_object_keys(r.payload) k
      where k <> v_keycol
        and jsonb_typeof(r.payload -> k) <> 'null';

      if v_setclause is null then
        v_after := v_before;
      else
        execute format(
          'update public.%I as t set %s
             from jsonb_populate_record(null::public.%I, $1) as s
            where t.%I::text = $2
           returning to_jsonb(t)',
          v_tbl, v_setclause, v_tbl, v_keycol
        ) into v_after using r.payload, r.business_key;
      end if;
    end if;

    if v_after is null then
      execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', v_tbl, v_keycol)
        into v_after using r.business_key;
    end if;

    if v_tbl in ('cargo_listings','vessel_availability') then
      execute format(
        'update public.%I set review_status = ''APPROVED'',
           goes_live_at = coalesce(goes_live_at, now())
         where %I::text = $1', v_tbl, v_keycol)
        using r.business_key;
      execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', v_tbl, v_keycol)
        into v_after using r.business_key;
    end if;

    insert into public.sync_commit_audit
      (batch_id, staged_row_id, table_name, key_column, business_key, op, before, after)
    values
      (p_batch_id, r.id, v_tbl, v_keycol, r.business_key, v_op, v_before, v_after);

    update public.sync_staged_row set committed = true where id = r.id;

    if v_op = 'insert' then v_inserted := v_inserted + 1;
    else v_updated := v_updated + 1;
    end if;
  end loop;

  v_remaining := exists (
    select 1 from public.sync_staged_row
    where batch_id = p_batch_id and committed = false and classification in ('new','updated'));
  v_any_audit := exists (
    select 1 from public.sync_commit_audit where batch_id = p_batch_id and undone_at is null);

  update public.sync_batch
    set status = case
          when not v_remaining then 'committed'
          when v_any_audit then 'partial'
          else v_resting end,
        committed_at = case when v_any_audit then coalesce(committed_at, now()) else committed_at end,
        error = null
  where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
exception when others then
  -- rolls back with the raise; the application records failure separately
  update public.sync_batch set status = 'failed', error = SQLERRM where id = p_batch_id;
  raise;
end;
$function$;
revoke all on function public.commit_sync_batch(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.commit_sync_batch(uuid, text, uuid[]) to service_role;

create or replace function public.undo_sync_batch(p_batch_id uuid, p_force boolean default false, p_actor text default null)
 returns jsonb
 language plpgsql volatile security definer set search_path to 'public'
as $function$
declare
  b           public.sync_batch%rowtype;
  a           record;
  v_current   jsonb;
  v_changed   text[];
  v_conflicts jsonb := '[]'::jsonb;
  v_cols      text;
  v_setclause text;
  v_reverted  int := 0;
  v_deleted   int := 0;
  v_n         int;
begin
  select * into b from public.sync_batch where id = p_batch_id for update;
  if not found then
    raise exception 'sync batch % not found', p_batch_id;
  end if;
  if not exists (select 1 from public.sync_commit_audit where batch_id = p_batch_id and undone_at is null) then
    raise exception 'BATCH_STATE: nothing to undo — this batch has no committed rows' using errcode = '55000';
  end if;

  -- pass 1 · what changed since the commit? Nothing is written here.
  for a in
    select * from public.sync_commit_audit
    where batch_id = p_batch_id and undone_at is null
    order by created_at desc, id desc
  loop
    if not fn_sync_table_allowed(a.table_name) then
      raise exception 'undo target table % is not permitted', a.table_name;
    end if;
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', a.table_name, a.key_column)
      into v_current using a.business_key;
    if a.op = 'insert' then
      if v_current is null then continue; end if;          -- already gone: nothing to remove
      v_changed := fn_sync_row_conflicts(a.after, v_current);
    else
      if v_current is null then v_changed := array['(row deleted since the commit)'];
      else v_changed := fn_sync_row_conflicts(a.after, v_current); end if;
    end if;
    if coalesce(array_length(v_changed, 1), 0) > 0 then
      v_conflicts := v_conflicts || jsonb_build_object(
        'audit_id', a.id, 'table', a.table_name, 'key', a.business_key, 'op', a.op, 'changed', to_jsonb(v_changed));
    end if;
  end loop;

  if jsonb_array_length(v_conflicts) > 0 and not p_force then
    return jsonb_build_object('ok', false, 'reverted', 0, 'deleted', 0, 'forced', 0, 'conflicts', v_conflicts);
  end if;

  -- pass 2 · apply, newest first
  for a in
    select * from public.sync_commit_audit
    where batch_id = p_batch_id and undone_at is null
    order by created_at desc, id desc
  loop
    if a.op = 'insert' then
      execute format('delete from public.%I where %I::text = $1', a.table_name, a.key_column) using a.business_key;
      get diagnostics v_n = row_count;
      v_deleted := v_deleted + v_n;
    else
      select string_agg(quote_ident(k), ', '),
             string_agg(format('%I = excluded.%I', k, k), ', ') filter (where k <> a.key_column)
        into v_cols, v_setclause
      from jsonb_object_keys(a.before) k;
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)
           on conflict (%I) do update set %s',
        a.table_name, v_cols, v_cols, a.table_name, a.key_column, v_setclause
      ) using a.before;
      v_reverted := v_reverted + 1;
    end if;
    update public.sync_commit_audit
       set undone_at = now(), undone_by = p_actor,
           undo_conflict = (select c from jsonb_array_elements(v_conflicts) c where (c->>'audit_id')::uuid = a.id)
     where id = a.id;
  end loop;

  update public.sync_staged_row set committed = false where batch_id = p_batch_id;
  update public.sync_batch
     set status = 'undone', undone_at = now()
   where id = p_batch_id;

  return jsonb_build_object('ok', true, 'reverted', v_reverted, 'deleted', v_deleted,
                            'forced', jsonb_array_length(v_conflicts), 'conflicts', v_conflicts);
end;
$function$;
revoke all on function public.undo_sync_batch(uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.undo_sync_batch(uuid, boolean, text) to service_role;

create or replace function public.edit_live_record(
  p_table text, p_key text, p_patch jsonb, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_key_col  text;
  v_set      text;
  v_before   jsonb;
  v_after    jsonb;
  v_audit_id uuid;
begin
  perform set_config('dq.channel', 'admin', true);   -- phase 3: the gate judges this write on the admin channel
  if not public.fn_sync_table_allowed(p_table) then
    raise exception 'table % is not editable', p_table using errcode = '42501';
  end if;
  v_key_col := public.fn_sync_key_column(p_table);
  if v_key_col is null then raise exception 'no business key for %', p_table; end if;

  v_set := public.fn_edit_set_list(p_table, p_patch, v_key_col);
  if v_set is null then raise exception 'no editable fields in patch' using errcode = '22023'; end if;

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_before using p_key;
  if v_before is null then
    raise exception 'record % not found in %', p_key, p_table using errcode = 'P0002';
  end if;

  execute format(
    'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) as s where t.%I::text = $2',
    p_table, v_set, p_table, v_key_col
  ) using p_patch, p_key;

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_after using p_key;

  insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by)
  values (p_table, p_key, 'update', v_before, v_after, p_actor)
  returning id into v_audit_id;

  return jsonb_build_object('audit_id', v_audit_id, 'after', v_after);
end $$;
revoke all on function public.edit_live_record(text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.edit_live_record(text, text, jsonb, uuid) to service_role;

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
  perform set_config('dq.channel', 'admin', true);   -- phase 3: the gate judges this write on the admin channel
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
revoke all on function public.insert_live_record(text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.insert_live_record(text, jsonb, uuid) to service_role;

create or replace function public.bulk_update_live_records(
  p_table text, p_keys text[], p_patch jsonb, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_key_col text;
  v_set     text;
  v_group   uuid := gen_random_uuid();
  v_key     text;
  v_before  jsonb;
  v_after   jsonb;
  v_n       int := 0;
begin
  perform set_config('dq.channel', 'admin', true);   -- phase 3: the gate judges these writes on the admin channel
  if not public.fn_sync_table_allowed(p_table) then
    raise exception 'table % is not editable', p_table using errcode = '42501';
  end if;
  v_key_col := public.fn_sync_key_column(p_table);
  v_set := public.fn_edit_set_list(p_table, p_patch, v_key_col);
  if v_set is null then raise exception 'no editable fields in patch' using errcode = '22023'; end if;

  foreach v_key in array p_keys loop
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
      into v_before using v_key;
    if v_before is null then continue; end if;
    execute format(
      'update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) as s where t.%I::text = $2',
      p_table, v_set, p_table, v_key_col
    ) using p_patch, v_key;
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
      into v_after using v_key;
    insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by, group_id)
    values (p_table, v_key, 'update', v_before, v_after, p_actor, v_group);
    v_n := v_n + 1;
  end loop;

  return jsonb_build_object('updated', v_n, 'group_id', v_group);
end $$;
revoke all on function public.bulk_update_live_records(text, text[], jsonb, uuid) from public, anon, authenticated;
grant execute on function public.bulk_update_live_records(text, text[], jsonb, uuid) to service_role;

create or replace function public.delete_live_record(
  p_table text, p_key text, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_key_col text;
  v_before  jsonb;
begin
  if not public.fn_sync_table_allowed(p_table) then
    raise exception 'table % is not editable', p_table using errcode = '42501';
  end if;
  v_key_col := public.fn_sync_key_column(p_table);

  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1', p_table, v_key_col)
    into v_before using p_key;
  if v_before is null then
    raise exception 'record % not found in %', p_key, p_table using errcode = 'P0002';
  end if;

  insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by)
  values (p_table, p_key, 'delete', v_before, null, p_actor);

  execute format('delete from public.%I t where t.%I::text = $1', p_table, v_key_col) using p_key;
  return jsonb_build_object('deleted', 1);
end $$;
revoke all on function public.delete_live_record(text, text, uuid) from public, anon, authenticated;
grant execute on function public.delete_live_record(text, text, uuid) to service_role;

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
revoke all on function public.bulk_delete_live_records(text, text[], uuid) from public, anon, authenticated;
grant execute on function public.bulk_delete_live_records(text, text[], uuid) to service_role;

drop function if exists public.fn_sync_lock_all(text[], text[]);
drop function if exists public.fn_sync_row_lock(text, text);

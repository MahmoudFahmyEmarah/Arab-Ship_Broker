-- DOWN for 20260918120000_sync_phase2_batch_state_machine.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260918_sync_phase2_down.sql
--   supabase migration repair --status reverted 20260918120000
-- Deploy the pre-phase-2 application first (it calls the old undo signatures).
-- Restores the function bodies of 20260714110801 (commit), 20260704090000
-- (undo_sync_batch) and 20260731110000 (undo_record_edits) below, verbatim.

drop trigger if exists trg_sync_batch_discard_guard on public.sync_batch;
drop function if exists public.fn_sync_batch_discard_guard();

drop function if exists public.undo_sync_batch(uuid, boolean, text);
drop function if exists public.undo_record_edits(uuid, uuid, uuid, boolean);
drop function if exists public.fn_sync_row_conflicts(jsonb, jsonb);

drop index if exists public.idx_commit_audit_active_row;
alter table public.sync_commit_audit
  drop column if exists undone_at,
  drop column if exists undone_by,
  drop column if exists undo_conflict;

update public.sync_batch set status = 'draft' where status in ('gated', 'gate_failed', 'partial');
alter table public.sync_batch drop constraint if exists sync_batch_status_chk;
alter table public.sync_batch add constraint sync_batch_status_chk
  check (status in ('draft', 'committing', 'committed', 'undone', 'failed'));

-- mark_sync_batch_failed: back to the phase-0 body
create or replace function public.mark_sync_batch_failed(p_batch_id uuid, p_error text)
 returns void language sql volatile security definer set search_path to ''
as $$
  update public.sync_batch
     set status = 'failed',
         error  = left(coalesce(p_error, 'commit failed'), 2000)
   where id = p_batch_id
     and status not in ('committed', 'undone');
$$;

-- the pre-phase-2 function bodies, verbatim
create or replace function public.commit_sync_batch(
  p_batch_id uuid, p_sheet text default null, p_row_ids uuid[] default null
) returns jsonb
 language plpgsql security definer set search_path to 'public'
as $function$
declare
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
  v_pc       text;
  v_portcols text[] := array['load_port_locode','disch_port_locode',
    'load_port_2_locode','load_port_3_locode','load_port_4_locode',
    'disch_port_2_locode','disch_port_3_locode','disch_port_4_locode'];
  v_batch_ports text[];
begin
  if not exists (select 1 from public.sync_batch where id = p_batch_id) then
    raise exception 'sync batch % not found', p_batch_id;
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

    if v_tbl = 'cargo_listings' then
      foreach v_pc in array v_portcols loop
        if (r.payload ? v_pc)
           and not exists (select 1 from public.ports p where upper(p.locode) = upper(r.payload ->> v_pc))
           and not (upper(r.payload ->> v_pc) = any (v_batch_ports)) then
          r.payload := r.payload - v_pc;
        end if;
      end loop;
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

    -- Auto-approve admin-synced marketplace listings so they are immediately
    -- live on the public boards/counts. Re-read v_after so the reversible-commit
    -- audit captures the approved state (Undo restores the pre-commit row).
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

  update public.sync_batch
    set status = case
          when exists (
            select 1 from public.sync_staged_row
            where batch_id = p_batch_id and committed = false
              and classification in ('new','updated')
          ) then 'draft' else 'committed' end,
        committed_at = coalesce(committed_at, now())
  where id = p_batch_id;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped);
exception when others then
  update public.sync_batch set status = 'failed', error = SQLERRM where id = p_batch_id;
  raise;
end;
$function$;
revoke all on function public.commit_sync_batch(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.commit_sync_batch(uuid, text, uuid[]) to service_role;

create or replace function public.undo_sync_batch(p_batch_id uuid)
 returns jsonb
 language plpgsql
 volatile
 security definer
 set search_path to 'public'
as $function$
declare
  a         record;
  v_cols    text;
  v_setclause text;
  v_reverted int := 0;
  v_deleted  int := 0;
begin
  if not exists (select 1 from public.sync_batch where id = p_batch_id) then
    raise exception 'sync batch % not found', p_batch_id;
  end if;

  for a in
    select * from public.sync_commit_audit
    where batch_id = p_batch_id
    order by created_at desc, id desc
  loop
    if not fn_sync_table_allowed(a.table_name) then
      raise exception 'undo target table % is not permitted', a.table_name;
    end if;

    if a.op = 'insert' then
      execute format(
        'delete from public.%I where %I::text = $1',
        a.table_name, a.key_column
      ) using a.business_key;
      v_deleted := v_deleted + 1;

    else  -- 'update' → restore the full before-image
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
  end loop;

  update public.sync_staged_row set committed = false where batch_id = p_batch_id;
  update public.sync_batch
    set status = 'undone', undone_at = now()
  where id = p_batch_id;

  return jsonb_build_object('reverted', v_reverted, 'deleted', v_deleted);
end;
$function$;
revoke all on function public.undo_sync_batch(uuid) from public, anon, authenticated;
grant execute on function public.undo_sync_batch(uuid) to service_role;

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
revoke all on function public.undo_record_edits(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.undo_record_edits(uuid, uuid, uuid) to service_role;

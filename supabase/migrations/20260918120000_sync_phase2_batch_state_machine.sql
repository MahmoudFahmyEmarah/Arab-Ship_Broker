-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · phase 2 — batch state machine, locking, conflict-
-- aware undo (18 Sep 2026)
--
-- Before: a partial commit fell back to 'draft', so the console offered
-- Discard on it and the delete cascaded the commit audit while the live rows
-- stayed; commit_sync_batch took no lock and no status precondition; undo
-- restored before-images blindly even though the audit already held the
-- after-image needed to see a later edit.
--
-- Now:
--   status      draft | gated | gate_failed | committing | committed |
--               partial | undone | failed  (lib/sync/batch-status.ts)
--   commit      SELECT … FOR UPDATE on the batch, explicit status
--               precondition, 'partial' when rows remain. A second commit of
--               the same batch waits for the first and finds nothing left.
--   audit       one ACTIVE audit row per staged row (partial unique index);
--               undone rows keep their audit with undone_at set.
--   discard     trg_sync_batch_discard_guard refuses to delete a batch that
--               has any audit row or committed staged row — the undo trail
--               must stay. Discard is for batches nothing was written from.
--   undo        pass 1 compares every live row with the audit's after-image
--               (volatile columns ignored) and returns the conflicts without
--               touching anything; pass 2 applies only when there are none,
--               or when p_force is set — then each override is recorded on
--               its audit row. Same rule for undo_record_edits.
-- Live audit 18 Sep: 822 audit rows, 0 duplicated staged_row_ids, 0 draft
-- batches with audit rows, 1 undone batch. Idempotent.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · statuses ─────────────────────────────────────────────────────────────
alter table public.sync_batch drop constraint if exists sync_batch_status_chk;
alter table public.sync_batch add constraint sync_batch_status_chk
  check (status in ('draft', 'gated', 'gate_failed', 'committing', 'committed', 'partial', 'undone', 'failed'));

-- a draft that already wrote rows is a partial batch
update public.sync_batch b
   set status = 'partial'
 where b.status = 'draft'
   and exists (select 1 from public.sync_commit_audit a where a.batch_id = b.id);

-- ── 2 · audit rows remember their undo ──────────────────────────────────────
alter table public.sync_commit_audit
  add column if not exists undone_at     timestamptz,
  add column if not exists undone_by     text,
  add column if not exists undo_conflict jsonb;

comment on column public.sync_commit_audit.undone_at     is 'Set when undo restored / removed this row. Cleared never: an undone batch keeps its history.';
comment on column public.sync_commit_audit.undo_conflict is 'When the undo was forced past a later edit: {changed:[columns…]} at the time of the undo.';

-- batches already undone: their audit rows are history, not active
update public.sync_commit_audit a
   set undone_at = coalesce(b.undone_at, now())
  from public.sync_batch b
 where a.batch_id = b.id and b.status = 'undone' and a.undone_at is null;

create unique index if not exists idx_commit_audit_active_row
  on public.sync_commit_audit (staged_row_id)
  where staged_row_id is not null and undone_at is null;

-- ── 3 · the discard guard ────────────────────────────────────────────────────
create or replace function public.fn_sync_batch_discard_guard()
 returns trigger language plpgsql set search_path to ''
as $$
begin
  if exists (select 1 from public.sync_commit_audit a where a.batch_id = old.id)
     or exists (select 1 from public.sync_staged_row s where s.batch_id = old.id and s.committed) then
    raise exception 'DISCARD_GUARD: batch % has committed rows — undo it instead of discarding, its audit trail must stay', old.id
      using errcode = '55000';
  end if;
  return old;
end $$;

drop trigger if exists trg_sync_batch_discard_guard on public.sync_batch;
create trigger trg_sync_batch_discard_guard
  before delete on public.sync_batch
  for each row execute function public.fn_sync_batch_discard_guard();

-- ── 4 · what changed since the commit ───────────────────────────────────────
-- Keys of the after-image whose live value differs now. Bookkeeping columns
-- that move on their own are ignored; columns added to the table since the
-- commit are absent from the after-image and therefore ignored too.
create or replace function public.fn_sync_row_conflicts(p_after jsonb, p_current jsonb)
 returns text[] language sql immutable set search_path to ''
as $$
  select coalesce(array_agg(e.key order by e.key), '{}'::text[])
    from jsonb_each(coalesce(p_after, '{}'::jsonb) - array['updated_at', 'refreshed_at', 'last_seen_at', 'matched_at', 'search_tsv']) e
   where (coalesce(p_current, '{}'::jsonb) -> e.key) is distinct from e.value;
$$;

-- ── 5 · commit: lock, precondition, partial ─────────────────────────────────
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
  v_pc       text;
  v_portcols text[] := array['load_port_locode','disch_port_locode',
    'load_port_2_locode','load_port_3_locode','load_port_4_locode',
    'disch_port_2_locode','disch_port_3_locode','disch_port_4_locode'];
  v_batch_ports text[];
  v_remaining boolean;
  v_any_audit boolean;
  v_resting   text;
begin
  -- One commit of a batch at a time: a concurrent caller waits here and then
  -- finds nothing left to commit.
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
    raise exception 'BATCH_STATE: the data-quality gate did not run on this batch — re-run the gate first' using errcode = '55000';
  end if;
  if b.status = 'committing' then
    raise exception 'BATCH_STATE: another commit of this batch is in progress' using errcode = '55000';
  end if;
  -- draft (staged before phase 2), gated, partial, failed → proceed
  v_resting := case when b.status = 'failed' then 'gated' else b.status end;

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

    -- idx_commit_audit_active_row refuses a second active audit row for the
    -- same staged row — a duplicate commit can never slip through here
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
  -- This write rolls back with the raise (the transaction is aborted); it
  -- stays as documentation. The application records the failure through
  -- mark_sync_batch_failed in a second statement.
  update public.sync_batch set status = 'failed', error = SQLERRM where id = p_batch_id;
  raise;
end;
$function$;

revoke all on function public.commit_sync_batch(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.commit_sync_batch(uuid, text, uuid[]) to service_role;

-- a failed commit on a batch that already wrote rows stays 'partial'
create or replace function public.mark_sync_batch_failed(p_batch_id uuid, p_error text)
 returns void language sql volatile security definer set search_path to ''
as $$
  update public.sync_batch b
     set status = case
           when exists (select 1 from public.sync_commit_audit a where a.batch_id = b.id and a.undone_at is null) then 'partial'
           else 'failed' end,
         error  = left(coalesce(p_error, 'commit failed'), 2000)
   where b.id = p_batch_id
     and b.status not in ('committed', 'undone');
$$;

-- ── 6 · undo: conflicts first, then apply ───────────────────────────────────
drop function if exists public.undo_sync_batch(uuid);
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

-- ── 7 · the same rule for Database Preview edits ────────────────────────────
drop function if exists public.undo_record_edits(uuid, uuid, uuid);
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

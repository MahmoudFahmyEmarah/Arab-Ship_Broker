-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · commits serialise per live row, and a batch is
-- "committed" only when nothing is left unresolved (20 Sep 2026)
--
-- Defect 1 (P0-2): commit_sync_batch read the before-image, then INSERT …
-- ON CONFLICT DO NOTHING. Two batches committing the same absent key at the
-- same time both saw "no row", both recorded op = 'insert', and undoing the
-- loser deleted the winner's row.
--   fn_sync_row_lock(table, key)   one transaction-level advisory lock per
--       live row, taken by every writer of that row — commit, undo,
--       Database Preview edit / insert / delete / bulk — BEFORE the
--       before-image is read; the existing row is then read FOR UPDATE.
--   An insert that still loses to a writer outside the convention re-reads
--       the row under lock, records the real before-image, classifies the
--       operation as an update and applies the staged payload. An 'insert'
--       audit is written only when THIS transaction inserted the row.
--
-- Defect 2 (P0-3): the gate turns blocked rows into classification =
-- 'invalid', but the final "anything left?" query only counted new/updated
-- rows, so a batch became 'committed' with blocked rows stranded inside it.
--   A batch is 'committed' only when no uncommitted new / updated / invalid
--   row remains; with audit rows and unresolved rows left it is 'partial'
--   (editable, re-gateable, committable again); committed stays terminal.
--   The function returns the resulting status and the remaining counts.
--
-- Idempotent. Service-role only. DOWN: supabase/rollback/20260920_sync_commit_serialization_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── 0 · the lock convention ─────────────────────────────────────────────────
create or replace function public.fn_sync_row_lock(p_table text, p_key text)
 returns void language sql volatile set search_path to ''
as $$
  select pg_advisory_xact_lock(hashtext('sync:' || coalesce(p_table, '')), hashtext(coalesce(p_key, '')));
$$;
comment on function public.fn_sync_row_lock(text, text) is 'Transaction-level advisory lock on one live row (table + business key). Every Data Sync writer takes it before reading the before-image.';
revoke all on function public.fn_sync_row_lock(text, text) from public, anon, authenticated;
grant execute on function public.fn_sync_row_lock(text, text) to service_role;

-- Defect 3 (21 Sep 2026): holding one lock per row is not enough on its own.
-- Every multi-row writer used to take its locks in ITS OWN order — a commit in
-- staged-row order, an undo in reverse audit order, a bulk edit in the caller's
-- array order. Two transactions touching the same two keys in opposite order
-- deadlock; PostgreSQL aborts one, so the data stayed correct but a commit
-- could fail for no reason the operator could act on.
--
-- fn_sync_lock_all takes EVERY lock a statement will need, up front, in one
-- global order: (table_name, business_key) ascending, de-duplicated. Because
-- every writer uses the same comparator, two transactions always request the
-- shared subset in the same sequence, so one simply waits. Semantic order
-- (ports before cargo) is then free to differ: by the time the work loop runs,
-- all of its locks are already held.
create or replace function public.fn_sync_lock_all(p_tables text[], p_keys text[])
 returns integer language plpgsql volatile set search_path to ''
as $$
declare k record; n int := 0; v_len int;
begin
  if p_tables is null or p_keys is null then return 0; end if;
  v_len := coalesce(array_length(p_tables, 1), 0);
  if v_len is distinct from coalesce(array_length(p_keys, 1), 0) then
    raise exception 'fn_sync_lock_all: p_tables and p_keys must be the same length (% vs %)',
      v_len, coalesce(array_length(p_keys, 1), 0) using errcode = '22023';
  end if;
  if v_len = 0 then return 0; end if;
  for k in
    select distinct z.tbl, z.bkey
      from (select p_tables[i] as tbl, p_keys[i] as bkey from generate_subscripts(p_tables, 1) i) z
     where z.tbl is not null and z.bkey is not null
     order by z.tbl, z.bkey            -- THE global order; do not change it in one caller only
  loop
    perform public.fn_sync_row_lock(k.tbl, k.bkey);
    n := n + 1;
  end loop;
  return n;
end $$;
comment on function public.fn_sync_lock_all(text[], text[]) is 'Takes every (table, business key) advisory lock a statement needs, de-duplicated, in one global ascending order. Every multi-row Data Sync writer calls this BEFORE its work loop so two transactions cannot deadlock by locking the same keys in different orders.';
revoke all on function public.fn_sync_lock_all(text[], text[]) from public, anon, authenticated;
grant execute on function public.fn_sync_lock_all(text[], text[]) to service_role;

-- ── 1 · commit ──────────────────────────────────────────────────────────────
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
  v_raced    int := 0;
  v_batch_ports text[];
  v_unknown  text[];
  v_any_audit boolean;
  v_resting   text;
  v_stale     int;
  v_stale_why text;
  v_unresolved int;
  v_pending    int;
  v_invalid    int;
  v_blocked    int;
  v_gate_error int;
  v_status     text;
  v_lock_tables text[];
  v_lock_keys   text[];
  v_locks       int;
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

  -- H (21 Sep 2026): every lock this commit needs, taken now, in the global
  -- (table, key) order. The loop below then runs in SEMANTIC order — ports
  -- before commodities before companies before vessels before cargo — with
  -- all of its locks already held, so its order can never deadlock against
  -- another writer's.
  select coalesce(array_agg(x.target_table order by x.target_table, x.business_key), '{}'::text[]),
         coalesce(array_agg(x.business_key  order by x.target_table, x.business_key), '{}'::text[])
    into v_lock_tables, v_lock_keys
    from (select distinct s.target_table, s.business_key
            from public.sync_staged_row s
           where s.batch_id = p_batch_id
             and (p_sheet is null or s.sheet = p_sheet)
             and (p_row_ids is null or s.id = any (p_row_ids))
             and s.committed = false
             and s.classification in ('new','updated')
             and s.business_key is not null) x;
  v_locks := public.fn_sync_lock_all(v_lock_tables, v_lock_keys);

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

    -- one writer per live row at a time (commit, undo, Database Preview alike),
    -- taken BEFORE the before-image so two commits of the same absent key
    -- cannot both see "no row"
    perform fn_sync_row_lock(v_tbl, r.business_key);
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', v_tbl, v_keycol)
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
      if v_after is null then
        -- lost a race with a writer outside the lock convention: the row
        -- exists now. Record ITS image as the before-image and update it —
        -- never an 'insert' audit for a row this transaction did not insert.
        execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', v_tbl, v_keycol)
          into v_before using r.business_key;
        if v_before is null then
          raise exception 'COMMIT_RACE: row % of % could not be inserted and does not exist — commit the batch again',
            r.business_key, v_tbl using errcode = '40001';
        end if;
        v_op := 'update';
        v_raced := v_raced + 1;
      end if;
    end if;

    if v_op = 'update' then
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

  -- what is left: every uncommitted row that still needs a decision —
  -- committable (new / updated), or invalid (parse errors, blocked by the
  -- gate, or the gate could not evaluate it). Unchanged rows need nothing.
  select count(*) filter (where classification in ('new', 'updated', 'invalid')),
         count(*) filter (where classification in ('new', 'updated')),
         count(*) filter (where classification = 'invalid'),
         count(*) filter (where gate_status = 'blocked'),
         count(*) filter (where gate_status = 'error')
    into v_unresolved, v_pending, v_invalid, v_blocked, v_gate_error
    from public.sync_staged_row
   where batch_id = p_batch_id and committed = false;
  v_any_audit := exists (
    select 1 from public.sync_commit_audit where batch_id = p_batch_id and undone_at is null);

  v_status := case
                when v_unresolved = 0 then 'committed'
                when v_any_audit then 'partial'
                else v_resting end;

  update public.sync_batch
    set status = v_status,
        committed_at = case when v_any_audit then coalesce(committed_at, now()) else committed_at end,
        counts = public.fn_sync_batch_recount(p_batch_id),
        error = null
  where id = p_batch_id;

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped, 'raced', v_raced,
    'status', v_status,
    'remaining', jsonb_build_object('unresolved', v_unresolved, 'pending', v_pending, 'invalid', v_invalid,
                                    'blocked', v_blocked, 'error', v_gate_error));
exception when others then
  -- rolls back with the raise; the application records failure separately
  update public.sync_batch set status = 'failed', error = SQLERRM where id = p_batch_id;
  raise;
end;
$function$;

revoke all on function public.commit_sync_batch(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.commit_sync_batch(uuid, text, uuid[]) to service_role;

-- ── 2 · undo takes the same locks ───────────────────────────────────────────
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
  v_lock_tables text[];
  v_lock_keys   text[];
begin
  select * into b from public.sync_batch where id = p_batch_id for update;
  if not found then
    raise exception 'sync batch % not found', p_batch_id;
  end if;
  if not exists (select 1 from public.sync_commit_audit where batch_id = p_batch_id and undone_at is null) then
    raise exception 'BATCH_STATE: nothing to undo — this batch has no committed rows' using errcode = '55000';
  end if;

  -- H: all locks first, in the global order, so an undo and a commit that
  -- touch the same keys queue instead of deadlocking.
  select coalesce(array_agg(x.table_name order by x.table_name, x.business_key), '{}'::text[]),
         coalesce(array_agg(x.business_key order by x.table_name, x.business_key), '{}'::text[])
    into v_lock_tables, v_lock_keys
    from (select distinct c.table_name, c.business_key from public.sync_commit_audit c
           where c.batch_id = p_batch_id and c.undone_at is null and c.business_key is not null) x;
  perform public.fn_sync_lock_all(v_lock_tables, v_lock_keys);

  -- pass 1 · what changed since the commit? Nothing is written here. The
  -- rows are locked (advisory + FOR UPDATE) so the answer stays true in pass 2.
  for a in
    select * from public.sync_commit_audit
    where batch_id = p_batch_id and undone_at is null
    order by created_at desc, id desc
  loop
    if not fn_sync_table_allowed(a.table_name) then
      raise exception 'undo target table % is not permitted', a.table_name;
    end if;
    perform fn_sync_row_lock(a.table_name, a.business_key);
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', a.table_name, a.key_column)
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

-- ── 3 · Database Preview writers take the same lock ─────────────────────────
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

  perform public.fn_sync_row_lock(p_table, p_key);
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', p_table, v_key_col)
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

  -- the lock serialises this insert against a concurrent commit / undo of the same key
  perform public.fn_sync_row_lock(p_table, v_key);
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', p_table, v_key_col)
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

  perform public.fn_sync_row_lock(p_table, p_key);
  execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', p_table, v_key_col)
    into v_before using p_key;
  if v_before is null then
    raise exception 'record % not found in %', p_key, p_table using errcode = 'P0002';
  end if;

  insert into public.record_edit_audit (table_name, business_key, op, before, after, edited_by)
  values (p_table, p_key, 'delete', v_before, null, p_actor);

  execute format('delete from public.%I t where t.%I::text = $1', p_table, v_key_col) using p_key;
  return jsonb_build_object('deleted', 1);
end $$;

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

  -- H: the caller hands us keys in whatever order the console selected them.
  -- Lock them in the global order first; the loop below may then run in any order.
  perform public.fn_sync_lock_all(array_fill(p_table, array[coalesce(array_length(p_keys, 1), 0)]), p_keys);

  foreach v_key in array p_keys loop
    perform public.fn_sync_row_lock(p_table, v_key);
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', p_table, v_key_col)
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

  -- H: as bulk_update_live_records — the global lock order before the work loop.
  perform public.fn_sync_lock_all(array_fill(p_table, array[coalesce(array_length(p_keys, 1), 0)]), p_keys);

  foreach v_key in array p_keys loop
    perform public.fn_sync_row_lock(p_table, v_key);
    execute format('select to_jsonb(t) from public.%I t where t.%I::text = $1 for update', p_table, v_key_col)
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

revoke all on function public.edit_live_record(text, text, jsonb, uuid)          from public, anon, authenticated;
revoke all on function public.insert_live_record(text, jsonb, uuid)               from public, anon, authenticated;
revoke all on function public.delete_live_record(text, text, uuid)                from public, anon, authenticated;
revoke all on function public.bulk_update_live_records(text, text[], jsonb, uuid) from public, anon, authenticated;
revoke all on function public.bulk_delete_live_records(text, text[], uuid)        from public, anon, authenticated;
grant execute on function public.edit_live_record(text, text, jsonb, uuid)          to service_role;
grant execute on function public.insert_live_record(text, jsonb, uuid)               to service_role;
grant execute on function public.delete_live_record(text, text, uuid)                to service_role;
grant execute on function public.bulk_update_live_records(text, text[], jsonb, uuid) to service_role;
grant execute on function public.bulk_delete_live_records(text, text[], uuid)        to service_role;

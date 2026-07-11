-- Phase 4 — Database Preview & Manual Review queue
--
-- Extends the Data Sync module past the batch pipeline with:
--   • record_edit_audit  — every direct edit/delete keeps a full before-image so
--                          single and bulk edits made in the Preview grid are
--                          reversible (the same recoverability guarantee the
--                          batch commit path already has via sync_commit_audit).
--   • commodity_review_queue — UNMAPPED commodity names surfaced during staging,
--                          resolved by assigning an ASB regime (→ a commodities row).
--
-- All write helpers are SECURITY DEFINER, service_role-only, and reuse the
-- Phase 1 guards fn_sync_table_allowed() / fn_sync_key_column(). Partial updates
-- go through jsonb_populate_record so only the columns in the patch are touched.

-- ── audit table for direct edits ────────────────────────────────────────────
create table if not exists public.record_edit_audit (
  id           uuid primary key default gen_random_uuid(),
  table_name   text not null,
  business_key text not null,
  op           text not null check (op in ('update', 'delete')),
  before       jsonb not null,          -- full row before the change (restore source)
  after        jsonb,                   -- full row after (null for delete)
  group_id     uuid,                    -- shared by rows changed in one bulk action
  edited_by    uuid,                    -- public.users.id of the acting admin
  edited_at    timestamptz not null default now(),
  undone       boolean not null default false,
  undone_at    timestamptz,
  undone_by    uuid
);
create index if not exists idx_edit_audit_recent on public.record_edit_audit (edited_at desc);
create index if not exists idx_edit_audit_group  on public.record_edit_audit (group_id) where group_id is not null;
create index if not exists idx_edit_audit_open   on public.record_edit_audit (edited_at desc) where undone = false;

-- ── manual-review queue for UNMAPPED commodities ────────────────────────────
create table if not exists public.commodity_review_queue (
  id                  uuid primary key default gen_random_uuid(),
  raw_name            text not null unique,        -- the market name that didn't resolve
  sample_ref          text,                        -- a cargo ref where it was seen
  source              text not null default 'upload',
  first_batch_id      uuid references public.sync_batch(id) on delete set null,
  status              text not null default 'pending' check (status in ('pending', 'mapped', 'ignored')),
  mapped_commodity_id uuid references public.commodities(id) on delete set null,
  suggested_regime    text,
  resolved_by         uuid,
  resolved_at         timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists idx_commodity_queue_status on public.commodity_review_queue (status);

-- ── RLS: admins only (service_role bypasses; anon/auth blocked) ──────────────
alter table public.record_edit_audit      enable row level security;
alter table public.commodity_review_queue enable row level security;

drop policy if exists admin_all on public.record_edit_audit;
create policy admin_all on public.record_edit_audit
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

drop policy if exists admin_all on public.commodity_review_queue;
create policy admin_all on public.commodity_review_queue
  for all to authenticated using (public.fn_is_admin()) with check (public.fn_is_admin());

revoke all on public.record_edit_audit      from anon;
revoke all on public.commodity_review_queue from anon;
grant  select, insert, update, delete on public.record_edit_audit      to service_role;
grant  select, insert, update, delete on public.commodity_review_queue to service_role;

-- ── helper: the "SET col = s.col" list for the patch keys that are real,
--    non-protected columns of p_table (protected = id / timestamps / key). ────
create or replace function public.fn_edit_set_list(p_table text, p_patch jsonb, p_key_col text)
returns text
language sql
stable
set search_path to ''
as $$
  select string_agg(format('%I = s.%I', c.column_name, c.column_name), ', ')
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = p_table
    and c.is_generated = 'NEVER'
    and c.column_name = any (select jsonb_object_keys(p_patch))
    and c.column_name not in ('id', 'created_at', 'updated_at', p_key_col);
$$;

-- ── edit one live record (audited partial update) ───────────────────────────
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

-- ── apply one patch to many records (audited, grouped for one-click undo) ────
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

-- ── delete one live record (audited) ────────────────────────────────────────
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

-- ── undo one edit or a whole bulk group (reverse-order replay) ───────────────
create or replace function public.undo_record_edits(
  p_audit_id uuid default null, p_group_id uuid default null, p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  r           record;
  v_key_col   text;
  v_all_set   text;
  v_restored  int := 0;
  v_reinserted int := 0;
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
    end if;
    update public.record_edit_audit
      set undone = true, undone_at = now(), undone_by = p_actor
    where id = r.id;
  end loop;

  if v_restored + v_reinserted = 0 then
    raise exception 'nothing to undo' using errcode = 'P0002';
  end if;
  return jsonb_build_object('restored', v_restored, 'reinserted', v_reinserted);
end $$;

-- ── resolve a queued commodity: upsert the dictionary row, mark it mapped ────
create or replace function public.resolve_commodity_review(
  p_id uuid,
  p_canonical text,
  p_cargo_type text,
  p_imsbc text,
  p_category text default null,
  p_is_grain boolean default false,
  p_is_dg boolean default false,
  p_notes text default null,
  p_actor uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare v_commodity_id uuid;
begin
  if coalesce(trim(p_canonical), '') = '' then
    raise exception 'canonical name is required' using errcode = '22023';
  end if;

  insert into public.commodities (canonical_name, cargo_type, imsbc_category, category_label, is_grain, is_dg, notes)
  values (p_canonical, p_cargo_type::public.cargo_type_enum, p_imsbc::public.imsbc_category_enum,
          p_category, coalesce(p_is_grain, false), coalesce(p_is_dg, false), p_notes)
  on conflict (canonical_name) do update
    set cargo_type      = excluded.cargo_type,
        imsbc_category  = excluded.imsbc_category,
        category_label  = coalesce(excluded.category_label, public.commodities.category_label),
        is_grain        = excluded.is_grain,
        is_dg           = excluded.is_dg,
        notes           = coalesce(excluded.notes, public.commodities.notes),
        updated_at      = now()
  returning id into v_commodity_id;

  update public.commodity_review_queue
    set status = 'mapped', mapped_commodity_id = v_commodity_id, resolved_by = p_actor, resolved_at = now()
  where id = p_id;

  return jsonb_build_object('commodity_id', v_commodity_id);
end $$;

-- ── lock the write helpers to service_role ──────────────────────────────────
revoke all on function public.fn_edit_set_list(text, jsonb, text)                       from public, anon, authenticated;
revoke all on function public.edit_live_record(text, text, jsonb, uuid)                 from public, anon, authenticated;
revoke all on function public.bulk_update_live_records(text, text[], jsonb, uuid)        from public, anon, authenticated;
revoke all on function public.delete_live_record(text, text, uuid)                       from public, anon, authenticated;
revoke all on function public.undo_record_edits(uuid, uuid, uuid)                        from public, anon, authenticated;
revoke all on function public.resolve_commodity_review(uuid, text, text, text, text, boolean, boolean, text, uuid) from public, anon, authenticated;

grant execute on function public.edit_live_record(text, text, jsonb, uuid)               to service_role;
grant execute on function public.bulk_update_live_records(text, text[], jsonb, uuid)      to service_role;
grant execute on function public.delete_live_record(text, text, uuid)                     to service_role;
grant execute on function public.undo_record_edits(uuid, uuid, uuid)                      to service_role;
grant execute on function public.resolve_commodity_review(uuid, text, text, text, text, boolean, boolean, text, uuid) to service_role;

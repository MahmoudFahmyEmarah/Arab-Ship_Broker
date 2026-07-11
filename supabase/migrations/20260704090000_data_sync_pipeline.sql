-- ---------------------------------------------------------------------------
-- Data Synchronization module — Phase 1: staging & commit pipeline.
--
-- The one rule of this module: nothing reaches a live table (cargo_listings,
-- vessels, organizations, ports, commodities) except through commit_sync_batch,
-- a transactional function that upserts by business key AND records a
-- before-image in sync_commit_audit in the same transaction. That before-image
-- is what makes undo_sync_batch a real, precise rollback on any Supabase tier.
--
-- Four tables:
--   sync_batch         one sync run (upload or email)         status: draft→committed→undone
--   sync_staged_row    every parsed row, pre-commit           new/updated/unchanged/invalid + diff
--   sync_commit_audit  before-image of each committed row     the undo source
--   llm_credential     encrypted provider keys (Vault)        secret ciphertext never leaves the DB
--
-- Security: the mutating RPCs are SECURITY DEFINER but EXECUTE is granted to
-- service_role only — they are reachable exclusively from admin server actions
-- that have already passed requireAdmin(). Live-table RLS (fn_is_admin admin-all)
-- is left intact as defense-in-depth. See supabase/tests/data_sync/ for scenarios.
-- ---------------------------------------------------------------------------

-- ── 1 · staging & audit tables ─────────────────────────────────────────────

create table if not exists public."sync_batch" (
  "id" uuid default gen_random_uuid() not null,
  "source" text not null,                          -- 'upload' | 'email'
  "status" text default 'draft' not null,          -- draft|committing|committed|undone|failed
  "label" text,                                    -- human batch label, e.g. 'B-014'
  "file_name" text,                                -- upload source filename (null for email)
  "started_by" uuid,                               -- public.users.id of the admin who ran it
  "counts" jsonb default '{}'::jsonb not null,     -- {"cargo":{"new":7,"updated":2}, ...}
  "error" text,
  "created_at" timestamp with time zone default now() not null,
  "committed_at" timestamp with time zone,
  "undone_at" timestamp with time zone,
  constraint "sync_batch_pkey" primary key ("id"),
  constraint "sync_batch_source_chk" check ("source" in ('upload','email')),
  constraint "sync_batch_status_chk"
    check ("status" in ('draft','committing','committed','undone','failed'))
);

create table if not exists public."sync_staged_row" (
  "id" uuid default gen_random_uuid() not null,
  "batch_id" uuid not null,
  "sheet" text not null,                           -- '01_CARGO', '02_VESSELS', ...
  "target_table" text not null,                    -- 'cargo_listings', 'vessels', ...
  "key_column" text not null,                      -- conflict target: 'ref','imo_number','locode',...
  "business_key" text,                             -- value of key_column (null when unresolved)
  "classification" text not null,                  -- new|updated|unchanged|invalid
  "payload" jsonb not null,                        -- normalized row to upsert (only keys we set)
  "raw" jsonb,                                     -- original parsed cells (audit/debug)
  "diff" jsonb,                                    -- {"col":{"old":..,"new":..}} for 'updated'
  "flags" jsonb default '[]'::jsonb not null,      -- [{"level":"error","field":"ref","msg":"..."}]
  "source_email_id" text,                          -- links cargo rows back to the circular
  "row_index" integer,                             -- position within the sheet (1-based data row)
  "committed" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  constraint "sync_staged_row_pkey" primary key ("id"),
  constraint "sync_staged_row_batch_fkey"
    foreign key ("batch_id") references public."sync_batch"("id") on delete cascade,
  constraint "sync_staged_row_class_chk"
    check ("classification" in ('new','updated','unchanged','invalid'))
);

create index if not exists "idx_staged_batch_sheet"
  on public."sync_staged_row" ("batch_id","sheet");
create index if not exists "idx_staged_batch_key"
  on public."sync_staged_row" ("batch_id","business_key");

create table if not exists public."sync_commit_audit" (
  "id" uuid default gen_random_uuid() not null,
  "batch_id" uuid not null,
  "staged_row_id" uuid,
  "table_name" text not null,
  "key_column" text not null,
  "business_key" text,
  "op" text not null,                              -- 'insert' | 'update'
  "before" jsonb,                                  -- null for insert; full prior row for update
  "after" jsonb not null,                          -- full row as committed
  "created_at" timestamp with time zone default now() not null,
  constraint "sync_commit_audit_pkey" primary key ("id"),
  constraint "sync_commit_audit_batch_fkey"
    foreign key ("batch_id") references public."sync_batch"("id") on delete cascade,
  constraint "sync_commit_audit_staged_fkey"
    foreign key ("staged_row_id") references public."sync_staged_row"("id") on delete set null,
  constraint "sync_commit_audit_op_chk" check ("op" in ('insert','update'))
);

create index if not exists "idx_audit_batch" on public."sync_commit_audit" ("batch_id");

-- ── 2 · encrypted LLM credentials ──────────────────────────────────────────
-- The row holds only metadata + a pointer (secret_id) into Supabase Vault
-- (pgsodium). The plaintext key never lives in this table and is never returned
-- to the browser. At most one credential is active at a time.

create table if not exists public."llm_credential" (
  "id" uuid default gen_random_uuid() not null,
  "label" text not null,
  "vendor" text not null,                          -- 'anthropic' | 'openai' | ...
  "model" text not null,
  "base_url" text,
  "secret_id" uuid,                                -- vault.secrets.id (ciphertext lives there)
  "is_active" boolean default false not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  constraint "llm_credential_pkey" primary key ("id")
);

-- Only one active credential, enforced at the database.
create unique index if not exists "idx_llm_one_active"
  on public."llm_credential" ("is_active") where ("is_active");

-- ── 3 · RLS (defense-in-depth; admin server actions use service_role) ───────
alter table public."sync_batch"        enable row level security;
alter table public."sync_staged_row"   enable row level security;
alter table public."sync_commit_audit" enable row level security;
alter table public."llm_credential"    enable row level security;

drop policy if exists "sb: admin all"  on public."sync_batch";
create policy "sb: admin all"  on public."sync_batch"
  as permissive for all to public using (public.fn_is_admin()) with check (public.fn_is_admin());

drop policy if exists "ssr: admin all" on public."sync_staged_row";
create policy "ssr: admin all" on public."sync_staged_row"
  as permissive for all to public using (public.fn_is_admin()) with check (public.fn_is_admin());

drop policy if exists "sca: admin all" on public."sync_commit_audit";
create policy "sca: admin all" on public."sync_commit_audit"
  as permissive for all to public using (public.fn_is_admin()) with check (public.fn_is_admin());

-- llm_credential: admins may read metadata (never the secret — it isn't a column).
drop policy if exists "lc: admin all" on public."llm_credential";
create policy "lc: admin all" on public."llm_credential"
  as permissive for all to public using (public.fn_is_admin()) with check (public.fn_is_admin());

-- ── 4 · helpers ────────────────────────────────────────────────────────────

-- Single source of truth for each live table's conflict/business-key column.
-- Used by both commit and undo so the mapping can never drift between them.
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
    else null
  end;
$function$;

-- Tables this module is allowed to write. Anything else is rejected before any
-- dynamic SQL runs — the module can never be pointed at an arbitrary table.
create or replace function public.fn_sync_table_allowed(p_table text)
 returns boolean
 language sql
 immutable
 set search_path to ''
as $function$
  select p_table in ('cargo_listings','vessels','organizations','ports','commodities');
$function$;

-- ── 5 · commit_sync_batch ──────────────────────────────────────────────────
-- Upserts the batch's staged rows (optionally one sheet) by business key,
-- writing a before-image to sync_commit_audit for every row it touches, all in
-- the caller's transaction. Returns {"inserted":N,"updated":N,"skipped":N}.
create or replace function public.commit_sync_batch(
  p_batch_id uuid,
  p_sheet text default null
)
 returns jsonb
 language plpgsql
 volatile
 security definer
 set search_path to 'public'
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
begin
  if not exists (select 1 from public.sync_batch where id = p_batch_id) then
    raise exception 'sync batch % not found', p_batch_id;
  end if;

  update public.sync_batch set status = 'committing' where id = p_batch_id;

  for r in
    select * from public.sync_staged_row
    where batch_id = p_batch_id
      and (p_sheet is null or sheet = p_sheet)
      and committed = false
      and classification in ('new','updated')
    order by row_index nulls last, created_at
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

    -- before-image (null when the row does not yet exist → insert)
    execute format(
      'select to_jsonb(t) from public.%I t where t.%I::text = $1',
      v_tbl, v_keycol
    ) into v_before using r.business_key;

    v_op := case when v_before is null then 'insert' else 'update' end;

    -- columns present in the payload
    select string_agg(quote_ident(k), ', ')
      into v_cols
    from jsonb_object_keys(r.payload) k;

    if v_cols is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if v_op = 'insert' then
      -- New row: the parser guarantees a complete payload (all NOT NULL cols).
      execute format(
        'insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)
           on conflict (%I) do nothing
         returning to_jsonb(public.%I.*)',
        v_tbl, v_cols, v_cols, v_tbl, v_keycol, v_tbl
      ) into v_after using r.payload;
    else
      -- Existing row: PARTIAL update of only the payload columns. A plain UPDATE
      -- (not INSERT…ON CONFLICT) so NOT NULL columns we don't touch stay intact —
      -- an upsert would build a full insert tuple and fail its NOT NULL checks first.
      select string_agg(format('%I = s.%I', k, k), ', ')
        into v_setclause
      from jsonb_object_keys(r.payload) k
      where k <> v_keycol;

      if v_setclause is null then
        v_after := v_before;                 -- payload was key-only: nothing to change
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

    -- v_after is null only when an insert hit ON CONFLICT DO NOTHING; re-read so
    -- the audit "after" is always the live row.
    if v_after is null then
      execute format(
        'select to_jsonb(t) from public.%I t where t.%I::text = $1',
        v_tbl, v_keycol
      ) into v_after using r.business_key;
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

  -- batch is "committed" once nothing uncommitted remains; otherwise stays draft
  update public.sync_batch
    set status = case
          when exists (
            select 1 from public.sync_staged_row
            where batch_id = p_batch_id and committed = false
              and classification in ('new','updated')
          ) then 'draft' else 'committed' end,
        committed_at = coalesce(committed_at, now())
  where id = p_batch_id;

  return jsonb_build_object(
    'inserted', v_inserted, 'updated', v_updated, 'skipped', v_skipped
  );
exception when others then
  update public.sync_batch set status = 'failed', error = SQLERRM where id = p_batch_id;
  raise;
end;
$function$;

-- ── 6 · undo_sync_batch ────────────────────────────────────────────────────
-- Reverses a committed batch precisely: restores the before-image of every
-- updated row and deletes rows the batch inserted, newest first, in one
-- transaction. Returns {"reverted":N,"deleted":N}.
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

-- ── 7 · encrypted credential helpers (Vault) ───────────────────────────────
-- save_llm_credential stores/updates a key: the plaintext goes straight into
-- Vault via vault.create_secret and only the returned secret_id is kept on the
-- row. get_llm_secret decrypts for server-side use (classifier / "Test key")
-- and is service_role-only. Neither ever exposes the key to the browser.
create or replace function public.save_llm_credential(
  p_id uuid,
  p_label text,
  p_vendor text,
  p_model text,
  p_base_url text,
  p_secret text,            -- null = keep existing secret
  p_make_active boolean default false
)
 returns uuid
 language plpgsql
 volatile
 security definer
 set search_path to 'public','vault'
as $function$
declare
  v_id        uuid := coalesce(p_id, gen_random_uuid());
  v_secret_id uuid;
begin
  select secret_id into v_secret_id from public.llm_credential where id = v_id;

  if p_secret is not null and length(trim(p_secret)) > 0 then
    if v_secret_id is null then
      v_secret_id := vault.create_secret(p_secret, 'llm_credential:' || v_id::text,
                                         'ASB Data Sync LLM key');
    else
      perform vault.update_secret(v_secret_id, p_secret);
    end if;
  end if;

  insert into public.llm_credential (id, label, vendor, model, base_url, secret_id, is_active, updated_at)
  values (v_id, p_label, p_vendor, p_model, p_base_url, v_secret_id, false, now())
  on conflict (id) do update set
    label = excluded.label, vendor = excluded.vendor, model = excluded.model,
    base_url = excluded.base_url,
    secret_id = coalesce(excluded.secret_id, public.llm_credential.secret_id),
    updated_at = now();

  if p_make_active then
    update public.llm_credential set is_active = false where is_active and id <> v_id;
    update public.llm_credential set is_active = true, updated_at = now() where id = v_id;
  end if;

  return v_id;
end;
$function$;

create or replace function public.get_llm_secret(p_id uuid)
 returns text
 language plpgsql
 stable
 security definer
 set search_path to 'public','vault'
as $function$
declare
  v_secret_id uuid;
  v_secret    text;
begin
  select secret_id into v_secret_id from public.llm_credential where id = p_id;
  if v_secret_id is null then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_secret_id;
  return v_secret;
end;
$function$;

-- ── 8 · grants: reachable only from admin server actions (service_role) ─────
revoke all on function public.commit_sync_batch(uuid, text) from public, anon, authenticated;
revoke all on function public.undo_sync_batch(uuid)         from public, anon, authenticated;
revoke all on function public.save_llm_credential(uuid, text, text, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.get_llm_secret(uuid)          from public, anon, authenticated;

grant execute on function public.commit_sync_batch(uuid, text) to service_role;
grant execute on function public.undo_sync_batch(uuid)         to service_role;
grant execute on function public.save_llm_credential(uuid, text, text, text, text, text, boolean)
  to service_role;
grant execute on function public.get_llm_secret(uuid)          to service_role;

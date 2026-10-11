-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · the stored recap PDF (owner decisions O2ALL-005 / O2ALL-006; C2O-101 corrections, 9 Oct 2026)
--
-- When a recap version is published the server renders the PDF (lib/fixture-room/recap-pdf.ts — deterministic, with
-- embedded Unicode fonts: the same recap always gives the same bytes), BINDS its digest here before anything is
-- uploaded, stores the exact bytes in the private fixture-recaps bucket (20261008051000; no member storage policy),
-- verifies what the bucket holds, and only then marks the record stored. Parties download THAT file through a
-- 60-second signed URL issued after this module confirms room access.
--
--   fixture_recap_pdfs                       — one row per recap version: path, SHA-256, size, renderer, status
--                                              (pending → stored | failed; failed → stored on a verified retry).
--                                              Never deleted, never re-bound; only the status may move forward.
--   fixture_recap_pdf_source(version)        — service only: the published, already-masked recap the PDF is built from
--   bind_fixture_recap_pdf(...)              — service only: set-once binding of version → path/digest/renderer
--   finalize_fixture_recap_pdf(...)          — service only: stored (after the bytes were verified) or failed
--   get_fixture_recap_pdf(room, version)     — members: the record, only for a room the caller may access; an
--                                              admin read is written to fixture_access_log
--
-- The PDF shows only what the published recap shows (names withheld unless both principals disclosed; a TBN vessel
-- stays unnamed) plus the publisher's side label.
-- DOWN: supabase/rollback/20261009300000_fixture_recap_pdf_down.sql (refuses while any record or bucket object exists)
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

-- ── 0 · the canonical recap text: a released defect, found by scripts/fixture-recap-parity.ts (C2O-101 P1-3) ──
-- 20260923201000 wrote coalesce(c->'brokerageTerms'->>'text', c->'brokerageTerms'::text). The cast binds to the key
-- literal, so the second argument is jsonb and PostgreSQL refuses the coalesce: publishing a recap in a room that
-- carries brokerage terms (app_settings.fixture_brokerage_terms at creation) raised an error. The intended text is
-- the whole value's text form. Only the parenthesis changes; rooms without brokerage terms render exactly as before.
create or replace function public.fn_fixture_recap_text(c jsonb)
 returns text language plpgsql immutable set search_path to ''
as $$
declare l text[] := '{}'; t jsonb; s jsonb; p jsonb; v text;
begin
  l := array_append(l, format('FIXTURE RECAP · %s / %s', c->'cargo'->>'commodity', c->'vessel'->>'name'));
  l := array_append(l, format('Ref %s · room v%s · %s', c->>'ref', c->>'roomVersion', to_char((c->>'generatedAt')::timestamptz, 'DD Mon YYYY HH24:MI "UTC"')));
  l := array_append(l, format('Status: %s', upper(replace(c->>'status', '_', ' '))));
  l := array_append(l, '');
  l := array_append(l, format('Cargo:  %s · %s–%s MT · %s → %s', c->'cargo'->>'commodity', c->'cargo'->>'qtyMin', c->'cargo'->>'qtyMax', c->'cargo'->>'loadPort', c->'cargo'->>'dischPort'));
  l := array_append(l, format('Vessel: %s (%s · %s DWT)', c->'vessel'->>'name', c->'vessel'->>'type', c->'vessel'->>'dwt'));
  l := array_append(l, '');
  l := array_append(l, 'PARTIES');
  for p in select * from jsonb_array_elements(c->'parties') loop
    l := array_append(l, format('- %s%s', p->>'label', case when p->>'name' is not null then ' · ' || (p->>'name') else '' end));
  end loop;
  l := array_append(l, '');
  l := array_append(l, 'MAIN TERMS');
  for t in select * from jsonb_array_elements(c->'terms') loop
    v := case when t->>'status' = 'agreed' then format('%s  [AGREED]', t->>'agreedValue')
              when t->>'status' = 'withdrawn' then '[WITHDRAWN]'
              else format('cargo %s · vessel %s  [OPEN]', coalesce(t->>'cargoPosition', '—'), coalesce(t->>'vesselPosition', '—')) end;
    l := array_append(l, format('%s. %s: %s', t->>'sortOrder', t->>'label', v));
  end loop;
  l := array_append(l, '');
  l := array_append(l, 'SUBJECTS');
  if jsonb_array_length(coalesce(c->'subjects', '[]'::jsonb)) = 0 then
    l := array_append(l, '- none recorded');
  end if;
  for s in select * from jsonb_array_elements(c->'subjects') loop
    l := array_append(l, format('- %s [%s]%s', s->>'title', upper(s->>'status'), case when s->>'deadlineAt' is not null then ' · by ' || to_char((s->>'deadlineAt')::timestamptz, 'DD Mon YYYY HH24:MI "UTC"') else '' end));
  end loop;
  l := array_append(l, '');
  l := array_append(l, format('Counterparty identity: %s', case when (c->>'counterpartyDisclosed')::boolean then 'disclosed' else 'withheld · via Arab ShipBroker' end));
  if c->'brokerageTerms' is not null and jsonb_typeof(c->'brokerageTerms') <> 'null' then
    l := array_append(l, format('Brokerage: %s', coalesce(c->'brokerageTerms'->>'text', (c->'brokerageTerms')::text)));
  end if;
  l := array_append(l, 'Sub all terms / details of C/P otherwise as per owners'' proforma.');
  return array_to_string(l, E'\n');
end $$;
revoke all on function public.fn_fixture_recap_text(jsonb) from public, anon, authenticated;

create table if not exists public.fixture_recap_pdfs (
  recap_version_id uuid primary key references public.fixture_recap_versions(id) on delete cascade,
  room_id          uuid not null references public.fixture_rooms(id) on delete cascade,
  storage_path     text not null unique,
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes            integer not null check (bytes > 0 and bytes <= 5242880),
  renderer         text not null check (renderer ~ '^[a-z-]+/[0-9]+$'),
  status           text not null default 'pending' check (status in ('pending', 'stored', 'failed')),
  last_error       text check (last_error is null or char_length(last_error) <= 300),
  bound_at         timestamptz not null default now(),
  finalized_at     timestamptz,
  check ((status = 'pending') = (finalized_at is null) or status = 'failed')
);
comment on table public.fixture_recap_pdfs is
  'Fixture Room (O2ALL-005/006): the stored PDF of each published recap version — path, SHA-256, renderer and status. Bound before upload; stored only after the bucket bytes were verified. Never deleted or re-bound. Private: no API grants, no policies.';
alter table public.fixture_recap_pdfs enable row level security;
revoke all on table public.fixture_recap_pdfs from public, anon, authenticated, service_role;

-- append-only: no DELETE; an UPDATE may only move the status forward (pending/failed → stored | failed) with its
-- error text and time — the binding itself (path, digest, size, renderer) never changes
create or replace function public.fn_fixture_recap_pdf_append_only()
 returns trigger language plpgsql set search_path to ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'FX_IMMUTABLE: a stored recap PDF record is never deleted' using errcode = '55000';
  end if;
  if (new.recap_version_id, new.room_id, new.storage_path, new.sha256, new.bytes, new.renderer, new.bound_at)
       is distinct from (old.recap_version_id, old.room_id, old.storage_path, old.sha256, old.bytes, old.renderer, old.bound_at)
     or old.status = 'stored' and new.status <> 'stored' then
    raise exception 'FX_IMMUTABLE: a stored recap PDF binding never changes; only its status moves forward' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.fn_fixture_recap_pdf_append_only() from public, anon, authenticated, service_role;
drop trigger if exists fixture_recap_pdfs_append_only on public.fixture_recap_pdfs;
create trigger fixture_recap_pdfs_append_only before update or delete on public.fixture_recap_pdfs
  for each row execute function public.fn_fixture_recap_pdf_append_only();

-- the published recap the PDF is built from (service only)
create or replace function public.fixture_recap_pdf_source(p_recap_version_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare rv public.fixture_recap_versions; r public.fixture_rooms; v_label text;
begin
  select * into rv from public.fixture_recap_versions x where x.id = p_recap_version_id;
  if rv.id is null then raise exception 'FX_NOT_FOUND: recap version % not found', p_recap_version_id using errcode = 'P0002'; end if;
  select * into r from public.fixture_rooms x where x.id = rv.room_id;
  -- the publisher by side only (never a person or an organisation)
  select case when p.is_platform or p.side = 'mediator' then 'Arab ShipBroker' when p.side = 'cargo' then 'Charterer side'
              when p.side = 'vessel' then 'Owner side' else 'Arab ShipBroker' end
    into v_label from public.fixture_parties p where p.id = rv.published_by_party_id;
  return jsonb_build_object('recapVersionId', rv.id, 'roomId', rv.room_id, 'ref', r.ref, 'versionNo', rv.version_no,
    'roomVersion', rv.room_version, 'publishedAt', rv.published_at, 'publisherLabel', coalesce(v_label, 'Arab ShipBroker'),
    'contentHash', rv.content_hash, 'content', rv.content);
end $$;
revoke all on function public.fixture_recap_pdf_source(uuid) from public, anon, authenticated;
grant execute on function public.fixture_recap_pdf_source(uuid) to service_role;

-- set-once binding, before any upload (service only)
create or replace function public.bind_fixture_recap_pdf(
  p_recap_version_id uuid, p_storage_path text, p_sha256 text, p_bytes integer, p_renderer text)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare rv public.fixture_recap_versions; x public.fixture_recap_pdfs;
begin
  select * into rv from public.fixture_recap_versions y where y.id = p_recap_version_id for share;
  if rv.id is null then raise exception 'FX_NOT_FOUND: recap version % not found', p_recap_version_id using errcode = 'P0002'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'FX_VALIDATION: sha256 must be 64 lowercase hex characters' using errcode = '22023'; end if;
  if p_storage_path is distinct from (rv.room_id::text || '/recap-v' || rv.version_no::text || '-' || p_sha256 || '.pdf') then
    raise exception 'FX_VALIDATION: the storage path must be <room>/recap-v<version>-<sha256>.pdf' using errcode = '22023';
  end if;
  insert into public.fixture_recap_pdfs (recap_version_id, room_id, storage_path, sha256, bytes, renderer)
  values (rv.id, rv.room_id, p_storage_path, p_sha256, p_bytes, p_renderer)
  on conflict (recap_version_id) do nothing;
  select * into x from public.fixture_recap_pdfs y where y.recap_version_id = rv.id;
  if x.sha256 <> p_sha256 or x.renderer <> p_renderer or x.bytes <> p_bytes then
    raise exception 'FX_CONFLICT: recap v% is already bound to another file (% via %)', rv.version_no, left(x.sha256, 12), x.renderer using errcode = '55000';
  end if;
  return jsonb_build_object('recapVersionId', x.recap_version_id, 'path', x.storage_path, 'sha256', x.sha256, 'bytes', x.bytes,
                            'renderer', x.renderer, 'status', x.status, 'boundAt', x.bound_at);
end $$;
revoke all on function public.bind_fixture_recap_pdf(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.bind_fixture_recap_pdf(uuid, text, text, integer, text) to service_role;

-- the outcome of storing the bound bytes (service only); a stored record is final
create or replace function public.finalize_fixture_recap_pdf(p_recap_version_id uuid, p_sha256 text, p_stored boolean, p_error text default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare x public.fixture_recap_pdfs;
begin
  select * into x from public.fixture_recap_pdfs y where y.recap_version_id = p_recap_version_id for update;
  if x.recap_version_id is null then raise exception 'FX_NOT_FOUND: no file is bound to this recap version' using errcode = 'P0002'; end if;
  if x.sha256 is distinct from p_sha256 then raise exception 'FX_CONFLICT: the finalized digest is not the bound one' using errcode = '55000'; end if;
  if x.status <> 'stored' then
    update public.fixture_recap_pdfs
       set status = case when p_stored then 'stored' else 'failed' end,
           last_error = case when p_stored then null else left(coalesce(p_error, 'storage failed'), 300) end,
           finalized_at = now()
     where recap_version_id = x.recap_version_id
    returning * into x;
  end if;
  return jsonb_build_object('recapVersionId', x.recap_version_id, 'status', x.status, 'sha256', x.sha256, 'path', x.storage_path);
end $$;
revoke all on function public.finalize_fixture_recap_pdf(uuid, text, boolean, text) from public, anon, authenticated;
grant execute on function public.finalize_fixture_recap_pdf(uuid, text, boolean, text) to service_role;

-- the paths bound in a room (service only): the store's orphan reconcile keeps exactly these
create or replace function public.fixture_recap_pdf_bound_paths(p_room_id uuid)
 returns text[] language sql stable security definer set search_path to 'public'
as $$ select coalesce(array_agg(x.storage_path order by x.storage_path), '{}'::text[]) from public.fixture_recap_pdfs x where x.room_id = p_room_id; $$;
revoke all on function public.fixture_recap_pdf_bound_paths(uuid) from public, anon, authenticated;
grant execute on function public.fixture_recap_pdf_bound_paths(uuid) to service_role;

-- what a member may know about the stored PDF of a recap version in a room they can access; admin reads are logged
create or replace function public.get_fixture_recap_pdf(p_room_id uuid, p_version_no integer)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; rv public.fixture_recap_versions; x public.fixture_recap_pdfs;
begin
  v_actor := public.fn_fixture_actor();   -- signed in, active
  if p_room_id is null or not public.fn_can_access_fixture(p_room_id) then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  select * into rv from public.fixture_recap_versions y where y.room_id = p_room_id and y.version_no = p_version_no;
  if rv.id is null then raise exception 'FX_NOT_FOUND: recap v% not found', p_version_no using errcode = 'P0002'; end if;
  if public.fn_is_admin() then
    insert into public.fixture_access_log (room_id, user_id, is_admin, reason) values (p_room_id, v_actor, true, 'recap-pdf');
  end if;
  select * into x from public.fixture_recap_pdfs y where y.recap_version_id = rv.id;
  return jsonb_build_object('recapVersionId', rv.id, 'versionNo', rv.version_no, 'ref', (select ref from public.fixture_rooms where id = p_room_id),
    'status', coalesce(x.status, 'none'), 'path', x.storage_path, 'sha256', x.sha256, 'bytes', x.bytes, 'renderer', x.renderer);
end $$;
revoke all on function public.get_fixture_recap_pdf(uuid, integer) from public, anon;
grant execute on function public.get_fixture_recap_pdf(uuid, integer) to authenticated, service_role;

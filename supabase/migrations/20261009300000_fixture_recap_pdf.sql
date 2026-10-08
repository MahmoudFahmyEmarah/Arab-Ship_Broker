-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · the stored recap PDF (owner decision O2ALL-005, 9 Oct 2026)
--
-- When a recap version is published the server renders the PDF once (lib/fixture-room/recap-pdf.ts — deterministic:
-- the same published recap always gives the same bytes), stores it in the private fixture-recaps bucket
-- (20261008051000; no member storage policy) and records it here with its SHA-256. Parties download THAT file through
-- a short-lived signed URL the server issues after this module confirms room access.
--
--   fixture_recap_pdfs                     — one row per recap version; insert-once (no UPDATE path at all)
--   fixture_recap_pdf_source(version)      — service only: the published, already-masked recap the PDF is built from
--   record_fixture_recap_pdf(...)          — service only: set-once; a replay with the same digest returns the row,
--                                            a different digest for the same version is refused
--   get_fixture_recap_pdf(room, version)   — members: the record, only for a room the caller may access
--
-- The PDF shows only what the published recap shows (names withheld unless both principals disclosed; a TBN
-- vessel stays unnamed) plus the publisher's side label. DOWN refuses while PDFs are recorded (they are history).
-- DOWN: supabase/rollback/20261009300000_fixture_recap_pdf_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create table if not exists public.fixture_recap_pdfs (
  recap_version_id uuid primary key references public.fixture_recap_versions(id) on delete cascade,
  room_id          uuid not null references public.fixture_rooms(id) on delete cascade,
  storage_path     text not null unique,
  sha256           text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  bytes            integer not null check (bytes > 0 and bytes <= 5242880),
  renderer         text not null check (renderer ~ '^[a-z-]+/[0-9]+$'),
  stored_at        timestamptz not null default now()
);
comment on table public.fixture_recap_pdfs is
  'Fixture Room (O2ALL-005): the stored PDF of each published recap version — bucket path and SHA-256. Insert-once through record_fixture_recap_pdf; no update path. Private: no API grants, no policies.';
alter table public.fixture_recap_pdfs enable row level security;
revoke all on table public.fixture_recap_pdfs from public, anon, authenticated, service_role;

-- insert-once: a row is never rewritten (deletes only cascade from its room or recap version)
create or replace function public.fn_fixture_recap_pdf_no_update()
 returns trigger language plpgsql set search_path to ''
as $$
begin
  raise exception 'FX_IMMUTABLE: a stored recap PDF record cannot be changed' using errcode = '55000';
end $$;
revoke all on function public.fn_fixture_recap_pdf_no_update() from public, anon, authenticated, service_role;
drop trigger if exists fixture_recap_pdfs_no_update on public.fixture_recap_pdfs;
create trigger fixture_recap_pdfs_no_update before update on public.fixture_recap_pdfs
  for each row execute function public.fn_fixture_recap_pdf_no_update();

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

-- set-once record (service only)
create or replace function public.record_fixture_recap_pdf(
  p_recap_version_id uuid, p_storage_path text, p_sha256 text, p_bytes integer, p_renderer text)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare rv public.fixture_recap_versions; x public.fixture_recap_pdfs;
begin
  select * into rv from public.fixture_recap_versions y where y.id = p_recap_version_id for share;
  if rv.id is null then raise exception 'FX_NOT_FOUND: recap version % not found', p_recap_version_id using errcode = 'P0002'; end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'FX_VALIDATION: sha256 must be 64 lowercase hex characters' using errcode = '22023'; end if;
  if p_storage_path is distinct from (rv.room_id::text || '/recap-v' || rv.version_no::text || '-' || left(p_sha256, 16) || '.pdf') then
    raise exception 'FX_VALIDATION: the storage path must be <room>/recap-v<version>-<digest prefix>.pdf' using errcode = '22023';
  end if;
  insert into public.fixture_recap_pdfs (recap_version_id, room_id, storage_path, sha256, bytes, renderer)
  values (rv.id, rv.room_id, p_storage_path, p_sha256, p_bytes, p_renderer)
  on conflict (recap_version_id) do nothing;
  select * into x from public.fixture_recap_pdfs y where y.recap_version_id = rv.id;
  if x.sha256 <> p_sha256 then
    raise exception 'FX_CONFLICT: recap v% already has a stored PDF with a different digest', rv.version_no using errcode = '55000';
  end if;
  return jsonb_build_object('recapVersionId', x.recap_version_id, 'path', x.storage_path, 'sha256', x.sha256, 'bytes', x.bytes,
                            'renderer', x.renderer, 'storedAt', x.stored_at);
end $$;
revoke all on function public.record_fixture_recap_pdf(uuid, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.record_fixture_recap_pdf(uuid, text, text, integer, text) to service_role;

-- what a member may know about the stored PDF of a recap version in a room they can access
create or replace function public.get_fixture_recap_pdf(p_room_id uuid, p_version_no integer)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare rv public.fixture_recap_versions; x public.fixture_recap_pdfs;
begin
  perform public.fn_fixture_actor();   -- signed in, active
  if p_room_id is null or not public.fn_can_access_fixture(p_room_id) then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  select * into rv from public.fixture_recap_versions y where y.room_id = p_room_id and y.version_no = p_version_no;
  if rv.id is null then raise exception 'FX_NOT_FOUND: recap v% not found', p_version_no using errcode = 'P0002'; end if;
  select * into x from public.fixture_recap_pdfs y where y.recap_version_id = rv.id;
  return jsonb_build_object('recapVersionId', rv.id, 'versionNo', rv.version_no, 'ref', (select ref from public.fixture_rooms where id = p_room_id),
    'stored', x.recap_version_id is not null, 'path', x.storage_path, 'sha256', x.sha256, 'bytes', x.bytes, 'storedAt', x.stored_at);
end $$;
revoke all on function public.get_fixture_recap_pdf(uuid, integer) from public, anon;
grant execute on function public.get_fixture_recap_pdf(uuid, integer) to authenticated, service_role;

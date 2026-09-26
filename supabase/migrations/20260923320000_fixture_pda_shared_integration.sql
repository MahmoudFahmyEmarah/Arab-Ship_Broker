-- Fixture Room + PDA Estimator shared integration.
--
-- This migration deliberately follows both module ranges.  It never makes a
-- Fixture table readable through PostgREST and it does not add a foreign key
-- to pda_estimates: the Fixture module can remain independently deployable,
-- while runtime access is governed by fn_can_read_pda_estimate().

-- The Fixture event ledger is closed to arbitrary event names.  Add the two
-- integration events explicitly, retaining every v1 event type.
alter table public.fixture_events
  drop constraint if exists fixture_events_type_check,
  add constraint fixture_events_type_check check (type in (
    'room.created','party.invited','party.accepted','party.declined','party.removed',
    'party.disclosure_agreed','room.counterparty_disclosed',
    'proposal.submitted','proposal.withdrawn','proposal.lapsed','proposal.accepted',
    'term.agreed','term.reopened','term.held','term.resumed','term.referred','term.referral_cleared',
    'subject.added','subject.lifted','subject.failed','subject.extended',
    'room.fixed_on_subjects','room.fixed','room.returned_to_negotiation',
    'recap.published','recap.acknowledged','recap.invalidated',
    'message.posted','message.redacted',
    'listing_sync.required','listing_sync.applied','pda.linked','room.closed'
  ));

-- ── Decision D4: one authorised listing-sync action ────────────────────────
-- A participant may update only the live listing their current ownership row
-- authorises.  It never changes the other side's listing.  The action is a
-- Fixture command so it uses the room lock, optimistic version and replay key.
create or replace function public.sync_fixture_listing_status(
  p_room_id uuid,
  p_expected_version integer,
  p_idempotency_key text
)
returns jsonb
language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_actor uuid;
  r public.fixture_rooms;
  v_hash text;
  v_replay jsonb;
  v_acting public.fixture_parties;
  v_cargo_owner jsonb;
  v_vessel_owner jsonb;
  v_cargo_updated boolean := false;
  v_vessel_updated boolean := false;
  v_cargo_target text;
  v_vessel_target text;
  v_outstanding boolean;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'sync_fixture_listing_status')::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);

  if r.listing_sync_target is null then
    raise exception 'FX_STATE: this room has no marketplace listing status to sync' using errcode = '55000';
  end if;
  if r.status not in ('on_subjects', 'fixed') then
    raise exception 'FX_STATE: listing status can be synced only while on subjects or fixed' using errcode = '55000';
  end if;
  v_acting := public.fn_fixture_acting_party(r.id, null);
  if v_acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot sync marketplace listings' using errcode = '42501';
  end if;

  v_cargo_target := r.listing_sync_target->>'cargo_status';
  v_vessel_target := r.listing_sync_target->>'vessel_status';
  if v_cargo_target not in ('OUT') or v_vessel_target not in ('ON SUBS', 'FIXED') then
    raise exception 'FX_STATE: the room carries an invalid listing sync target' using errcode = '55000';
  end if;

  v_cargo_owner := public.fn_fixture_owns_listing('cargo', r.cargo_listing_id);
  if v_cargo_owner is not null then
    update public.cargo_listings set status = v_cargo_target::public.cargo_status_enum where id = r.cargo_listing_id;
    v_cargo_updated := found;
  end if;

  v_vessel_owner := public.fn_fixture_owns_listing('vessel_availability', r.vessel_availability_id);
  if v_vessel_owner is not null then
    update public.vessel_availability set status = v_vessel_target::public.vessel_status_enum where id = r.vessel_availability_id;
    v_vessel_updated := found;
  end if;

  if not v_cargo_updated and not v_vessel_updated then
    raise exception 'FX_AUTH: you do not own a listing that this room may sync' using errcode = '42501';
  end if;

  select coalesce((public.fn_fixture_listing_sync(r, false)->>'outstanding')::boolean, false) into v_outstanding;
  return public.fn_fixture_event(
    r.id, 'listing_sync.applied', v_actor, v_acting.id, null, false,
    'sync_fixture_listing_status', p_idempotency_key, v_hash,
    jsonb_build_object('cargoUpdated', v_cargo_updated, 'vesselUpdated', v_vessel_updated),
    jsonb_build_object('cargoUpdated', v_cargo_updated, 'vesselUpdated', v_vessel_updated, 'outstanding', v_outstanding)
  );
end;
$$;
revoke all on function public.sync_fixture_listing_status(uuid, integer, text) from public, anon;
grant execute on function public.sync_fixture_listing_status(uuid, integer, text) to authenticated, service_role;

-- ── PDA links ───────────────────────────────────────────────────────────────
-- Header data is copied at link time and is deliberately allow-listed.  In
-- particular no vessel id, user id, organisation id, contact information,
-- line items, source evidence or free-form PDA inputs enter the room.
create table if not exists public.fixture_pda_links (
  id                    uuid primary key,
  room_id               uuid not null references public.fixture_rooms(id) on delete cascade,
  pda_estimate_id       uuid not null,
  purpose               text not null check (purpose in ('load','discharge','other')),
  port_locode           text,
  terminal_name         text,
  tariff_version_id     uuid,
  coverage              text check (coverage in ('published','partial','manual_required')),
  native_currency       text,
  native_total          numeric(18,6),
  converted_currency    text,
  converted_total       numeric(18,6),
  generated_at          timestamptz,
  linked_by_party_id    uuid not null references public.fixture_parties(id) on delete restrict,
  linked_by_user_id     uuid not null references public.users(id) on delete restrict,
  linked_event_id       bigint not null unique references public.fixture_events(id) on delete restrict,
  supersedes_link_id    uuid references public.fixture_pda_links(id) on delete restrict,
  created_at            timestamptz not null default now(),
  unique (room_id, pda_estimate_id, purpose),
  constraint fixture_pda_links_currency_ck check (
    (native_currency is null or native_currency ~ '^[A-Z]{3}$') and
    (converted_currency is null or converted_currency ~ '^[A-Z]{3}$')
  ),
  constraint fixture_pda_links_total_ck check (
    (native_total is null or native_total >= 0) and
    (converted_total is null or converted_total >= 0)
  )
);
-- Safe PDA-header expansion agreed with Fixture Room.  It is kept in this
-- idempotent integration migration because neither module has been deployed;
-- importantly, vessel_id is still validation-only and never has a column here.
alter table public.fixture_pda_links
  add column if not exists terminal_id uuid,
  add column if not exists call_date date,
  add column if not exists fx_rate numeric,
  add column if not exists fx_source text,
  add column if not exists is_superseded boolean,
  add column if not exists line_count integer,
  add column if not exists manual_line_count integer,
  add column if not exists warning_count integer;
comment on table public.fixture_pda_links is 'Append-only, allow-listed PDA headers shared into a Fixture Room. pda_estimate_id intentionally has no foreign key so the Fixture module remains independently deployable; link creation calls fn_can_read_pda_estimate instead.';
create index if not exists fixture_pda_links_room_idx on public.fixture_pda_links(room_id, created_at desc);
create index if not exists fixture_pda_links_estimate_idx on public.fixture_pda_links(pda_estimate_id);
alter table public.fixture_pda_links enable row level security;
revoke all on table public.fixture_pda_links from public, anon, authenticated;
grant all on table public.fixture_pda_links to service_role;

create or replace function public.fn_fixture_pda_link_json(l public.fixture_pda_links)
returns jsonb
language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'id', l.id,
    'purpose', l.purpose,
    'pdaEstimateId', l.pda_estimate_id,
    'portLocode', l.port_locode,
    'terminalId', l.terminal_id,
    'terminalName', l.terminal_name,
    'tariffVersionId', l.tariff_version_id,
    'coverage', l.coverage,
    'callDate', l.call_date,
    'nativeCurrency', l.native_currency,
    'nativeTotal', l.native_total,
    'convertedCurrency', l.converted_currency,
    'convertedTotal', l.converted_total,
    'fxRate', l.fx_rate,
    'fxSource', l.fx_source,
    'generatedAt', l.generated_at,
    'isSuperseded', l.is_superseded,
    'lineCount', l.line_count,
    'manualLineCount', l.manual_line_count,
    'warningCount', l.warning_count,
    'linkedByLabel', p.display_label,
    'supersededByLinkId', (
      select n.id from public.fixture_pda_links n where n.supersedes_link_id = l.id order by n.created_at desc limit 1
    )
  )
  from public.fixture_parties p where p.id = l.linked_by_party_id;
$$;
revoke all on function public.fn_fixture_pda_link_json(public.fixture_pda_links) from public, anon, authenticated;

create or replace function public.list_fixture_pda_links(p_room_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_result jsonb;
begin
  perform public.fn_fixture_actor();
  if not public.fn_can_access_fixture(p_room_id) or (
    not public.fn_is_admin() and not exists (
      select 1 from public.fn_fixture_actor_parties(p_room_id) p where p.status = 'active'
    )
  ) then
    raise exception 'FX_AUTH: you are not a participant in this room' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(public.fn_fixture_pda_link_json(l) order by l.created_at desc), '[]'::jsonb)
    into v_result from public.fixture_pda_links l where l.room_id = p_room_id;
  return v_result;
end;
$$;
revoke all on function public.list_fixture_pda_links(uuid) from public, anon;
grant execute on function public.list_fixture_pda_links(uuid) to authenticated, service_role;

create or replace function public.link_fixture_pda_estimate(
  p_room_id uuid,
  p_pda_estimate_id uuid,
  p_purpose text,
  p_expected_version integer,
  p_idempotency_key text,
  p_as_party_id uuid default null
)
returns jsonb
language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_actor uuid;
  r public.fixture_rooms;
  v_hash text;
  v_replay jsonb;
  v_acting public.fixture_parties;
  v_header jsonb;
  v_link_id uuid := gen_random_uuid();
  v_event jsonb;
  v_previous uuid;
  v_purpose text := lower(btrim(coalesce(p_purpose, '')));
  v_safe jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'link_fixture_pda_estimate', 'estimate', p_pda_estimate_id, 'purpose', v_purpose, 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('negotiating', 'on_subjects', 'fixed') then
    raise exception 'FX_STATE: PDA estimates can be linked only while negotiating, on subjects or fixed' using errcode = '55000';
  end if;
  if v_purpose not in ('load', 'discharge', 'other') then
    raise exception 'FX_VALIDATION: purpose must be load, discharge or other' using errcode = '22023';
  end if;
  v_acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if v_acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot link a PDA estimate' using errcode = '42501';
  end if;
  if not public.fn_can_read_pda_estimate(p_pda_estimate_id) then
    raise exception 'FX_AUTH: you cannot read that PDA estimate' using errcode = '42501';
  end if;
  v_header := public.fn_pda_estimate_header(p_pda_estimate_id);
  if v_header is null then
    raise exception 'FX_NOT_FOUND: PDA estimate not found' using errcode = 'P0002';
  end if;
  -- The vessel id is validation-only. It is never persisted here or returned.
  if nullif(v_header->>'vesselId', '') is not null and (v_header->>'vesselId')::uuid <> r.vessel_id then
    raise exception 'FX_VALIDATION: the PDA estimate belongs to a different vessel' using errcode = '22023';
  end if;
  if exists (select 1 from public.fixture_pda_links l where l.room_id = r.id and l.pda_estimate_id = p_pda_estimate_id and l.purpose = v_purpose) then
    raise exception 'FX_CONFLICT: this PDA estimate is already linked for that purpose' using errcode = '23505';
  end if;
  select l.id into v_previous from public.fixture_pda_links l
   where l.room_id = r.id and l.purpose = v_purpose
   order by l.created_at desc limit 1;

  v_safe := jsonb_build_object(
    'id', v_link_id, 'purpose', v_purpose, 'pdaEstimateId', p_pda_estimate_id,
    'portLocode', v_header->>'portLocode', 'terminalId', v_header->>'terminalId', 'terminalName', v_header->>'terminalName',
    'tariffVersionId', v_header->>'tariffVersionId', 'coverage', v_header->>'coverage',
    'callDate', v_header->>'callDate',
    'nativeCurrency', v_header->>'nativeCurrency', 'nativeTotal', v_header->'nativeTotal',
    'convertedCurrency', v_header->>'convertedCurrency', 'convertedTotal', v_header->'convertedTotal',
    'fxRate', v_header->'fxRate', 'fxSource', v_header->>'fxSource',
    'generatedAt', v_header->>'generatedAt', 'isSuperseded', v_header->'isSuperseded',
    'lineCount', v_header->'lineCount', 'manualLineCount', v_header->'manualLineCount', 'warningCount', v_header->'warningCount',
    'linkedByLabel', v_acting.display_label,
    'supersededByLinkId', null
  );
  v_event := public.fn_fixture_event(
    r.id, 'pda.linked', v_actor, v_acting.id, null, false,
    'link_fixture_pda_estimate', p_idempotency_key, v_hash,
    jsonb_build_object('linkId', v_link_id, 'purpose', v_purpose, 'portLocode', v_header->>'portLocode'),
    jsonb_build_object('pdaLink', v_safe)
  );
  insert into public.fixture_pda_links (
    id, room_id, pda_estimate_id, purpose, port_locode, terminal_id, terminal_name, tariff_version_id, coverage, call_date,
    native_currency, native_total, converted_currency, converted_total, fx_rate, fx_source, generated_at,
    is_superseded, line_count, manual_line_count, warning_count,
    linked_by_party_id, linked_by_user_id, linked_event_id, supersedes_link_id
  ) values (
    v_link_id, r.id, p_pda_estimate_id, v_purpose, v_header->>'portLocode', nullif(v_header->>'terminalId', '')::uuid, v_header->>'terminalName',
    nullif(v_header->>'tariffVersionId', '')::uuid, v_header->>'coverage', nullif(v_header->>'callDate', '')::date,
    v_header->>'nativeCurrency', nullif(v_header->>'nativeTotal', '')::numeric,
    v_header->>'convertedCurrency', nullif(v_header->>'convertedTotal', '')::numeric,
    nullif(v_header->>'fxRate', '')::numeric, nullif(v_header->>'fxSource', ''), nullif(v_header->>'generatedAt', '')::timestamptz,
    nullif(v_header->>'isSuperseded', '')::boolean, nullif(v_header->>'lineCount', '')::integer,
    nullif(v_header->>'manualLineCount', '')::integer, nullif(v_header->>'warningCount', '')::integer,
    v_acting.id, v_actor, (v_event->>'eventId')::bigint, v_previous
  );
  return v_event;
end;
$$;
revoke all on function public.link_fixture_pda_estimate(uuid, uuid, text, integer, text, uuid) from public, anon;
grant execute on function public.link_fixture_pda_estimate(uuid, uuid, text, integer, text, uuid) to authenticated, service_role;

comment on function public.link_fixture_pda_estimate(uuid, uuid, text, integer, text, uuid) is 'Links a PDA header only after the caller can read the estimate and is an active Fixture party. vesselId is validation-only and never enters the Fixture ledger or read model.';

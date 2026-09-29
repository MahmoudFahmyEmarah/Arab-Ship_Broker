-- Fixture Room · private selection handles (C2O-013, corrected for C2O-014, 29 Sep 2026)
-- Migration 20260923208000, inside the reserved Fixture range 2026092320xxxx–2026092324xxxx.
--
-- Codex's re-audit (C2O-011 item 2) found that a raw availability id in the
-- browser is itself a vessel identifier: other member reads join it to the
-- hull. Defence in depth (C2O-013): Codex closes the global read path; this
-- file makes the Fixture boundary safe on its own.
--
--   * list_fixture_match_candidates returns, per candidate, an opaque random
--     candidateKey and the listing figures for the term hints; never a raw
--     cargo, availability or vessel id. Keys live in fixture_private.match_handles
--     (no API or member access), bound to the resolved public.users.id actor, the
--     owned source listing and kind, the exact pair, creation time and a
--     15-minute expiry. One row per (actor, source, pair): listing again renews
--     the same key instead of piling up rows; rows a day past expiry are purged.
--   * create_fixture_room_from_candidate(key, …) is the member's only way to
--     open a room. Order: replay by the existing (creator, idempotency key)
--     with create_fixture_room's full request hash (pair, terms incl. hints,
--     options) BEFORE expiry, so an identical retry replays after the key has
--     expired and any changed term, hint or option is FX_IDEMPOTENCY_MISMATCH;
--     then actor binding; expiry; the cargo, availability, vessel and ownership
--     rows are locked (FOR SHARE, held to commit) so no listing update can slip
--     between validation and the snapshot; live ownership; the current governed
--     match predicate; then the existing create_fixture_room rules. A true
--     unique race returns the governed FX_CONFLICT naming the winning room.
--   * recreate_fixture_room(room, …) starts a new room on a terminal room's
--     pairing from the room row, so the browser never replays raw ids.
--   * get_fixture_room returns, to every viewer the TBN hull is masked from,
--     no availability or vessel uuid anywhere: a JSON-safe recursive scrub
--     replaces the ids wherever they occur inside any string (exact value →
--     null; embedded in free text, any case, with or without hyphens →
--     "[withheld]").
--   * authenticated loses EXECUTE on the raw-id create_fixture_room: no
--     callable bypass remains (service_role and the commands above keep it).

create schema if not exists fixture_private;
revoke all on schema fixture_private from public, anon, authenticated;

create table if not exists fixture_private.match_handles (
  key                    uuid primary key default gen_random_uuid(),
  actor_user_id          uuid not null references public.users(id) on delete cascade,
  own_kind               text not null check (own_kind in ('cargo', 'vessel')),
  own_listing_id         uuid not null,
  cargo_listing_id       uuid not null,
  vessel_availability_id uuid not null,
  created_at             timestamptz not null default now(),
  expires_at             timestamptz not null
);
-- one handle per actor, source and pair (listing again renews it); expiry drives retention.
-- Upgrade-safe: an earlier build of this file allowed several keys per pair; keep the newest.
delete from fixture_private.match_handles a
 using fixture_private.match_handles b
 where a.actor_user_id = b.actor_user_id and a.own_kind = b.own_kind and a.own_listing_id = b.own_listing_id
   and a.cargo_listing_id = b.cargo_listing_id and a.vessel_availability_id = b.vessel_availability_id
   and (a.created_at, a.key) < (b.created_at, b.key);
create unique index if not exists match_handles_actor_pair_uq
  on fixture_private.match_handles (actor_user_id, own_kind, own_listing_id, cargo_listing_id, vessel_availability_id);
create index if not exists match_handles_expiry_idx on fixture_private.match_handles (expires_at);
drop index if exists fixture_private.match_handles_actor_idx;
alter table fixture_private.match_handles enable row level security;
revoke all on table fixture_private.match_handles from public, anon, authenticated;
comment on table fixture_private.match_handles is
  'Fixture Room (C2O-013): opaque match-candidate handles, one per actor/source/pair. Private: no API exposure, no member policy; read and written only by the Fixture SECURITY DEFINER functions. Purged a day after expiry.';

-- hints are now part of the candidate list (C2O-014 item 3): no separate read by key
drop function if exists public.get_fixture_candidate_hints(uuid);

-- the listing figures the term hints are built from (no identifier)
create or replace function public.fn_fixture_hint_figures(p_cargo_id uuid, p_availability_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object(
    'commodity', c.commodity_name, 'cargoType', c.cargo_type::text, 'qtyMin', c.qty_min_mt, 'qtyMax', c.qty_max_mt, 'stowageFactor', c.stowage_factor,
    'loadPortCode', c.load_port_locode, 'loadPortName', c.load_port_name, 'dischPortCode', c.disch_port_locode, 'dischPortName', c.disch_port_name,
    'laycanFrom', c.laycan_from, 'laycanTo', c.laycan_to, 'isSpot', c.is_spot,
    'loadRate', case when c.load_rate ~ '^[0-9]+(\.[0-9]+)?$' then c.load_rate::numeric end,
    'dischRate', case when c.disch_rate ~ '^[0-9]+(\.[0-9]+)?$' then c.disch_rate::numeric end,
    'loadTerms', c.load_terms::text, 'freightIdea', c.freight_idea_usd_mt, 'commission', c.commission_pct, 'demurrage', c.demurrage_rate,
    'vesselFreightIdea', (select va.freight_idea_usd_mt from public.vessel_availability va where va.id = p_availability_id))
  from public.cargo_listings c where c.id = p_cargo_id;
$$;
revoke all on function public.fn_fixture_hint_figures(uuid, uuid) from public, anon, authenticated;

-- ── candidates: an opaque key per candidate, never a raw id ─────────────────
create or replace function public.list_fixture_match_candidates(p_kind text, p_listing_id uuid)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_actor uuid := public.fn_fixture_actor();
  v_out jsonb;
  v_expires timestamptz := now() + interval '15 minutes';
begin
  if p_kind is null or p_kind not in ('cargo', 'vessel') or p_listing_id is null then
    raise exception 'FX_VALIDATION: kind must be cargo or vessel and a listing is required' using errcode = '22023';
  end if;
  if public.fn_fixture_owns_listing(case p_kind when 'cargo' then 'cargo' else 'vessel_availability' end, p_listing_id) is null then
    raise exception 'FX_AUTH: you can only match your own listings' using errcode = '42501';
  end if;
  -- retention: every handle a day past its expiry goes (the create replay never needs it)
  delete from fixture_private.match_handles h where h.expires_at < now() - interval '1 day';

  if p_kind = 'cargo' then
    with m as (
      select m.*, coalesce(v.is_tbn, false) as is_tbn,
             public.fn_fixture_owns_listing('vessel_availability', m.availability_id) is not null as mine
        from public.get_matches_for_cargo(p_listing_id) m
        left join public.vessels v on v.id = m.vessel_id
    ), h as (
      insert into fixture_private.match_handles (actor_user_id, own_kind, own_listing_id, cargo_listing_id, vessel_availability_id, expires_at)
      select v_actor, 'cargo', p_listing_id, p_listing_id, m.availability_id, v_expires from m
      on conflict (actor_user_id, own_kind, own_listing_id, cargo_listing_id, vessel_availability_id)
        do update set expires_at = excluded.expires_at
      returning key, vessel_availability_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'candidateKey', h.key,
             'name', case when m.is_tbn and not m.mine then 'TBN' else m.vessel_name end,
             'isTbn', m.is_tbn,
             'type', m.vessel_type, 'dwt', m.dwt_grain, 'buildYear', m.build_year,
             'openPort', m.open_port_name, 'openZone', m.open_zone, 'openDate', m.open_date,
             'freightIdea', m.freight_idea_usd_mt, 'rateAligned', m.is_rate_aligned, 'geared', m.is_geared,
             'mine', m.mine, 'expiresAt', v_expires,
             'hints', public.fn_fixture_hint_figures(p_listing_id, m.availability_id),
             'fit', jsonb_build_object(
               'zone', case when m.open_zone = cl.load_zone::text then 'load' else 'discharge' end,
               'laycan', case when cl.is_spot then 'spot' else 'window' end,
               'grain', cl.is_grain_cargo, 'dg', cl.is_dg_cargo,
               'gearRequired', coalesce(cl.requires_geared, false),
               'partCargo', m.accepts_part_cargo, 'dwtDelta', m.dwt_delta))
           order by m.is_rate_aligned desc, m.dwt_delta asc), '[]'::jsonb)
      into v_out
      from m join h on h.vessel_availability_id = m.availability_id
      join public.cargo_listings cl on cl.id = p_listing_id;
  else
    with m as (
      select m.*, public.fn_fixture_owns_listing('cargo', m.cargo_id) is not null as mine
        from public.get_matches_for_availability(p_listing_id) m
    ), h as (
      insert into fixture_private.match_handles (actor_user_id, own_kind, own_listing_id, cargo_listing_id, vessel_availability_id, expires_at)
      select v_actor, 'vessel', p_listing_id, m.cargo_id, p_listing_id, v_expires from m
      on conflict (actor_user_id, own_kind, own_listing_id, cargo_listing_id, vessel_availability_id)
        do update set expires_at = excluded.expires_at
      returning key, cargo_listing_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'candidateKey', h.key,
             'ref', m.ref, 'commodity', m.commodity_name, 'type', m.cargo_type,
             'qtyMin', m.qty_min_mt, 'qtyMax', m.qty_max_mt, 'loadPort', m.load_port_name, 'dischPort', m.disch_port_name,
             'laycanFrom', m.laycan_from, 'laycanTo', m.laycan_to, 'isSpot', m.is_spot,
             'freightIdea', m.freight_idea_usd_mt, 'rateAligned', m.is_rate_aligned,
             'mine', m.mine, 'expiresAt', v_expires,
             'hints', public.fn_fixture_hint_figures(m.cargo_id, p_listing_id),
             'fit', jsonb_build_object(
               'zone', case when va.open_zone::text = m.load_zone then 'load' else 'discharge' end,
               'laycan', case when m.is_spot then 'spot' else 'window' end,
               'grain', m.is_grain_cargo, 'dg', m.is_dg_cargo,
               'gearRequired', coalesce(m.requires_geared, false),
               'partCargo', va.accepts_part_cargo, 'dwtDelta', m.dwt_delta))
           order by m.is_rate_aligned desc, m.dwt_delta asc), '[]'::jsonb)
      into v_out
      from m join h on h.cargo_listing_id = m.cargo_id
      join public.vessel_availability va on va.id = p_listing_id;
  end if;
  return v_out;
end $$;
revoke all on function public.list_fixture_match_candidates(text, uuid) from public, anon;
grant execute on function public.list_fixture_match_candidates(text, uuid) to authenticated, service_role;

-- ── replay of a create by (creator, key), with create_fixture_room's full request hash ──
-- Returns the replay envelope, raises FX_IDEMPOTENCY_MISMATCH, or returns null (no such room).
create or replace function public.fn_fixture_create_replay(p_actor uuid, p_idempotency_key text, p_terms jsonb, p_options jsonb)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare r public.fixture_rooms; v_hash text;
begin
  select * into r from public.fixture_rooms x where x.created_by_user_id = p_actor and x.create_idempotency_key = p_idempotency_key;
  if r.id is null then return null; end if;
  -- exactly the hash create_fixture_room recorded: pair, terms (hints included), options
  v_hash := md5(jsonb_build_object('cmd', 'create_fixture_room', 'cargo', r.cargo_listing_id, 'vessel', r.vessel_availability_id,
                                   'terms', p_terms, 'options', coalesce(p_options, '{}'::jsonb))::text);
  if exists (select 1 from public.fixture_events e where e.room_id = r.id and e.idempotency_key = p_idempotency_key and e.request_hash is distinct from v_hash) then
    raise exception 'FX_IDEMPOTENCY_MISMATCH: idempotency key % was already used with different arguments', p_idempotency_key using errcode = 'P0001';
  end if;
  return jsonb_build_object('ok', true, 'version', r.version, 'eventId', null, 'replayed', true,
                            'data', jsonb_build_object('roomId', r.id, 'ref', r.ref, 'status', r.status));
end $$;
revoke all on function public.fn_fixture_create_replay(uuid, text, jsonb, jsonb) from public, anon, authenticated;

-- ── open a room from a handle ───────────────────────────────────────────────
create or replace function public.create_fixture_room_from_candidate(
  p_candidate_key uuid, p_terms jsonb, p_idempotency_key text, p_options jsonb default '{}'::jsonb)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid := public.fn_fixture_actor(); h fixture_private.match_handles; v jsonb; v_room public.fixture_rooms; v_vessel uuid; w public.fixture_rooms;
begin
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' or length(p_idempotency_key) > 200 then
    raise exception 'FX_VALIDATION: idempotency_key is required (1–200 characters)' using errcode = '22023';
  end if;
  if p_candidate_key is null then
    raise exception 'FX_VALIDATION: a candidate key is required' using errcode = '22023';
  end if;

  -- 1 · replay first, with the full request hash: an identical retry replays even after the key expired
  v := public.fn_fixture_create_replay(v_actor, p_idempotency_key, p_terms, p_options);
  if v is not null then
    select * into h from fixture_private.match_handles x where x.key = p_candidate_key;
    select * into w from public.fixture_rooms x where x.id = (v->'data'->>'roomId')::uuid;
    if h.key is not null and (h.actor_user_id <> v_actor or h.cargo_listing_id <> w.cargo_listing_id or h.vessel_availability_id <> w.vessel_availability_id) then
      raise exception 'FX_IDEMPOTENCY_MISMATCH: idempotency key % was already used for a different pairing', p_idempotency_key using errcode = 'P0001';
    end if;
    return v;
  end if;

  -- 2 · the handle is the actor's own (a foreign or unknown key is simply not found)
  select * into h from fixture_private.match_handles x where x.key = p_candidate_key and x.actor_user_id = v_actor;
  if h.key is null then
    raise exception 'FX_NOT_FOUND: this match is not available; reload the match list' using errcode = 'P0002';
  end if;
  -- 3 · still fresh
  if h.expires_at <= now() then
    raise exception 'FX_STATE: this match has expired; reload the match list' using errcode = '55000';
  end if;
  -- 4 · lock the governed inputs to commit: a listing, position, vessel or ownership update
  --     either happened before (and is seen below) or waits until the room exists
  perform 1 from public.cargo_listings x where x.id = h.cargo_listing_id for share;
  select x.vessel_id into v_vessel from public.vessel_availability x where x.id = h.vessel_availability_id for share;
  perform 1 from public.vessels x where x.id = v_vessel for share;
  perform 1 from public.listing_ownership x
   where x.listing_id in (h.cargo_listing_id, h.vessel_availability_id) and x.is_current for share;
  -- 5 · the actor still owns or represents the source listing
  if public.fn_fixture_owns_listing(case h.own_kind when 'cargo' then 'cargo' else 'vessel_availability' end, h.own_listing_id) is null then
    raise exception 'FX_AUTH: you no longer own or represent this listing' using errcode = '42501';
  end if;
  -- 6 · the pair still satisfies the governed match predicate
  if h.own_kind = 'cargo' then
    if not exists (select 1 from public.get_matches_for_cargo(h.own_listing_id) m where m.availability_id = h.vessel_availability_id) then
      raise exception 'FX_STATE: this pairing no longer matches; reload the match list' using errcode = '55000';
    end if;
  else
    if not exists (select 1 from public.get_matches_for_availability(h.own_listing_id) m where m.cargo_id = h.cargo_listing_id) then
      raise exception 'FX_STATE: this pairing no longer matches; reload the match list' using errcode = '55000';
    end if;
  end if;

  -- 7 · the existing governed create (tier, sanctions, live listings, same-pair live-room rule)
  begin
    v := public.create_fixture_room(h.cargo_listing_id, h.vessel_availability_id, p_terms, p_idempotency_key, p_options);
  exception when unique_violation then
    -- a true race: the same key committed first → replay; another room won the pair → name it
    v := public.fn_fixture_create_replay(v_actor, p_idempotency_key, p_terms, p_options);
    if v is not null then return v; end if;
    select * into w from public.fixture_rooms x
     where x.cargo_listing_id = h.cargo_listing_id and x.vessel_availability_id = h.vessel_availability_id
       and not public.fn_fixture_terminal(x.status)
     order by x.created_at limit 1;
    if w.id is not null then
      raise exception 'FX_CONFLICT: room % (%) already covers this pairing', w.id, w.ref using errcode = '23505';
    end if;
    raise;
  end;
  select * into v_room from public.fixture_rooms x where x.id = (v->'data'->>'roomId')::uuid;
  -- the response carries the room only: no listing, availability or vessel id
  return jsonb_build_object('ok', true, 'version', v->'version', 'eventId', v->'eventId', 'replayed', coalesce((v->>'replayed')::boolean, false),
                            'data', jsonb_build_object('roomId', v_room.id, 'ref', v_room.ref, 'status', v_room.status));
end $$;
revoke all on function public.create_fixture_room_from_candidate(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.create_fixture_room_from_candidate(uuid, jsonb, text, jsonb) to authenticated, service_role;

-- ── a new room on a terminal room's pairing, from the room row ──────────────
create or replace function public.recreate_fixture_room(
  p_room_id uuid, p_terms jsonb, p_idempotency_key text, p_options jsonb default '{}'::jsonb)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid := public.fn_fixture_actor(); r public.fixture_rooms; v jsonb; v_room public.fixture_rooms;
begin
  select * into r from public.fixture_rooms x where x.id = p_room_id;
  if r.id is null or not public.fn_can_access_fixture(r.id) then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  -- a retry of an earlier recreate replays through create_fixture_room's own rule; a first
  -- call needs the old negotiation to be over
  if not public.fn_fixture_terminal(r.status)
     and not exists (select 1 from public.fixture_rooms x where x.created_by_user_id = v_actor and x.create_idempotency_key = p_idempotency_key) then
    raise exception 'FX_STATE: only a closed negotiation can be started again (this one is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  v := public.create_fixture_room(r.cargo_listing_id, r.vessel_availability_id, p_terms, p_idempotency_key, p_options);
  select * into v_room from public.fixture_rooms x where x.id = (v->'data'->>'roomId')::uuid;
  return jsonb_build_object('ok', true, 'version', v->'version', 'eventId', v->'eventId', 'replayed', coalesce((v->>'replayed')::boolean, false),
                            'data', jsonb_build_object('roomId', v_room.id, 'ref', v_room.ref, 'status', v_room.status));
end $$;
revoke all on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) to authenticated, service_role;

-- ── no callable raw-id bypass ───────────────────────────────────────────────
revoke execute on function public.create_fixture_room(uuid, uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_fixture_room(uuid, uuid, jsonb, text, jsonb) to service_role;

-- ── a JSON-safe recursive scrub (C2O-014 item 1) ────────────────────────────
-- Walks objects and arrays; in every string, each forbidden identifier is found
-- case-insensitively, with or without hyphens. A string that IS the identifier
-- becomes JSON null (an id field); an identifier inside free text is replaced
-- with "[withheld]". Keys, numbers and structure are never touched.
create or replace function public.fn_fixture_scrub_ids(j jsonb, p_ids uuid[])
 returns jsonb language plpgsql immutable set search_path to 'public'
as $$
declare out jsonb; t text; n text; v_needles text[] := '{}';
begin
  if j is null or p_ids is null or cardinality(p_ids) = 0 then return j; end if;
  select coalesce(array_agg(x), '{}') into v_needles
    from (select lower(i::text) as x from unnest(p_ids) i where i is not null
          union select replace(lower(i::text), '-', '') from unnest(p_ids) i where i is not null) s;
  case jsonb_typeof(j)
    when 'object' then
      select coalesce(jsonb_object_agg(e.key, public.fn_fixture_scrub_ids(e.value, p_ids)), '{}'::jsonb) into out from jsonb_each(j) e;
      return out;
    when 'array' then
      select coalesce(jsonb_agg(public.fn_fixture_scrub_ids(e.value, p_ids) order by e.ord), '[]'::jsonb) into out
        from jsonb_array_elements(j) with ordinality e(value, ord);
      return out;
    when 'string' then
      t := j #>> '{}';
      foreach n in array v_needles loop
        if strpos(lower(t), n) > 0 then
          if lower(t) = n then return 'null'::jsonb; end if;
          t := regexp_replace(t, n, '[withheld]', 'gi');   -- n is hex and hyphens only: a safe literal pattern
        end if;
      end loop;
      return to_jsonb(t);
    else
      return j;
  end case;
end $$;
revoke all on function public.fn_fixture_scrub_ids(jsonb, uuid[]) from public, anon, authenticated;

-- ── the room read: no availability or vessel uuid for a masked viewer ───────
-- The 202000 read is kept, renamed, as the inner builder; get_fixture_room
-- wraps it. The rename runs only when get_fixture_room is still the original
-- (a re-applied 202000 restores it), so this file re-applies cleanly.
do $$
begin
  if exists (select 1 from pg_proc p where p.oid = to_regprocedure('public.get_fixture_room(uuid, integer)')
                                    and p.prosrc not like '%fn_fixture_room_read_unscrubbed%') then
    drop function if exists public.fn_fixture_room_read_unscrubbed(uuid, integer);
    alter function public.get_fixture_room(uuid, integer) rename to fn_fixture_room_read_unscrubbed;
  end if;
end $$;
revoke all on function public.fn_fixture_room_read_unscrubbed(uuid, integer) from public, anon, authenticated;

create or replace function public.get_fixture_room(p_room_id uuid, p_events_after integer default 0)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v jsonb; v_avail uuid; v_vessel uuid;
begin
  v := public.fn_fixture_room_read_unscrubbed(p_room_id, p_events_after);
  if coalesce((v->'snapshot'->>'vesselIdentityMasked')::boolean, false) then
    select x.vessel_availability_id, x.vessel_id into v_avail, v_vessel from public.fixture_rooms x where x.id = p_room_id;
    -- every occurrence, in every string (ids, messages, comments, titles, notes, event payloads)
    v := public.fn_fixture_scrub_ids(v, array[v_avail, v_vessel]);
  end if;
  return v;
end $$;
revoke all on function public.get_fixture_room(uuid, integer) from public, anon;
grant execute on function public.get_fixture_room(uuid, integer) to authenticated, service_role;

comment on function public.get_fixture_room(uuid, integer) is
  'Fixture Room read (C2O-013/014): the 202000 read model, with every availability and vessel uuid removed (JSON-safe, recursive, substring and case-insensitive) for a viewer the TBN hull is masked from.';
comment on function public.create_fixture_room_from_candidate(uuid, jsonb, text, jsonb) is
  'Fixture Room (C2O-013/014): opens a room from an opaque match handle; replay with the full request hash first, then actor, expiry, locked inputs, live ownership and the governed match predicate; a lost race names the winning room.';
comment on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) is
  'Fixture Room (C2O-013): a new room on a terminal room''s pairing, taken from the room row.';

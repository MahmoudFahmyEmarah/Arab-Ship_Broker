-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · Phase 1 · governed commands (23 Sep 2026, architecture 1.0)
--
-- Every command:
--   1. resolves the actor (public.users.id via fn_app_user_id()) and its parties;
--   2. locks the room (SELECT … FOR UPDATE), so commands on one room serialise;
--   3. replays a repeated idempotency_key (same arguments → the original
--      result; different arguments → FX_IDEMPOTENCY_MISMATCH);
--   4. checks expected_version against the locked row (FX_VERSION_CONFLICT);
--   5. checks state and capability;
--   6. writes its domain rows and one or more immutable events, each carrying
--      the idempotency key; the first event carries the result;
--   7. returns {ok, version, eventId, replayed, data}.
-- Errors raise with standard SQLSTATEs and stable FX_*: prefixes (D6).
--
-- Decision D4: no command writes cargo_listings or vessel_availability.
-- Entering / leaving on_subjects and fixed records listing_sync_target on
-- the room and a listing_sync.required event; the read model shows whether
-- the listing has caught up.
--
-- Idempotent. DOWN: supabase/rollback/20260923_fixture_room_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── shared internals ────────────────────────────────────────────────────────
create or replace function public.fn_fixture_terminal(p_status text)
 returns boolean language sql immutable set search_path to ''
as $$ select p_status in ('withdrawn', 'failed', 'expired'); $$;
revoke all on function public.fn_fixture_terminal(text) from public, anon, authenticated;

-- The party a command is attributed to. The mediator may act as itself
-- (coordination commands) or on behalf of a relayed party (commercial
-- commands); a strict caller passes p_strict = true so a mediator without a
-- represented party is refused.
create or replace function public.fn_fixture_rep(p_acting public.fixture_parties, p_on_behalf uuid, p_strict boolean)
 returns public.fixture_parties language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if p_on_behalf is null and not p_strict and p_acting.side = 'mediator' and p_acting.capacity = 'broker' then
    return p_acting;
  end if;
  return public.fn_fixture_represented_party(p_acting, p_on_behalf);
end $$;
revoke all on function public.fn_fixture_rep(public.fixture_parties, uuid, boolean) from public, anon, authenticated;

-- Invalidate the latest recap version after a commercial change.
create or replace function public.fn_fixture_invalidate_recap(p_room_id uuid, p_actor uuid, p_actor_party uuid, p_reason text, p_key text, p_hash text)
 returns void language plpgsql volatile security definer set search_path to 'public'
as $$
declare rv public.fixture_recap_versions; e jsonb;
begin
  select * into rv from public.fixture_recap_versions x where x.room_id = p_room_id and x.invalidated_at is null order by x.version_no desc limit 1;
  if rv.id is null then return; end if;
  e := public.fn_fixture_event(p_room_id, 'recap.invalidated', p_actor, p_actor_party, null, false, null, p_key, p_hash,
         jsonb_build_object('recapVersionId', rv.id, 'versionNo', rv.version_no, 'reason', p_reason), null);
  update public.fixture_recap_versions set invalidated_at = now(), invalidated_event_id = (e->>'eventId')::bigint where id = rv.id;
end $$;
revoke all on function public.fn_fixture_invalidate_recap(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;

-- Record the listing statuses the marketplace should now show (D4).
create or replace function public.fn_fixture_listing_sync_require(p_room_id uuid, p_target jsonb, p_reason text, p_actor uuid, p_actor_party uuid, p_key text, p_hash text)
 returns void language plpgsql volatile security definer set search_path to 'public'
as $$
begin
  update public.fixture_rooms set listing_sync_target = p_target, listing_sync_required_at = now() where id = p_room_id;
  perform public.fn_fixture_event(p_room_id, 'listing_sync.required', p_actor, p_actor_party, null, false, null, p_key, p_hash,
    jsonb_build_object('target', p_target, 'reason', p_reason), null);
end $$;
revoke all on function public.fn_fixture_listing_sync_require(uuid, jsonb, text, uuid, uuid, text, text) from public, anon, authenticated;

create or replace function public.fn_fixture_party_payload(p public.fixture_parties)
 returns jsonb language sql immutable set search_path to ''
as $$
  select jsonb_build_object('partyId', p.id, 'side', p.side, 'capacity', p.capacity, 'participationMode', p.participation_mode,
                            'label', p.display_label, 'status', p.status, 'isPlatform', p.is_platform);
$$;
revoke all on function public.fn_fixture_party_payload(public.fixture_parties) from public, anon, authenticated;

-- ── create_fixture_room ─────────────────────────────────────────────────────
create or replace function public.create_fixture_room(
  p_cargo_listing_id uuid, p_vessel_availability_id uuid, p_terms jsonb, p_idempotency_key text, p_options jsonb default '{}'::jsonb)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_actor uuid; v_admin boolean; v_existing public.fixture_rooms; v_room public.fixture_rooms;
  v_own_cargo jsonb; v_own_vessel jsonb; v_own jsonb; v_owns_cargo boolean; v_owns_vessel boolean;
  v_cargo jsonb; v_vessel jsonb; v_vessel_id uuid;
  v_ref text; v_creator_org uuid; v_creator_user uuid; v_platform public.fixture_parties; v_creator public.fixture_parties; v_p public.fixture_parties;
  v_cp jsonb; v_side text; v_codes text[] := '{}'; v_code text;
  v_version text; v_cat jsonb; v_def jsonb; v_supplied jsonb;
  v_brokerage jsonb; v_hash text; v_parties_payload jsonb := '[]'::jsonb; v_invites public.fixture_parties[] := '{}';
  v_first jsonb; v_last jsonb; v_n int := 0; v_label text;
begin
  v_actor := public.fn_fixture_actor();
  v_admin := public.fn_is_admin();
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' or length(p_idempotency_key) > 200 then
    raise exception 'FX_VALIDATION: idempotency_key is required (1–200 characters)' using errcode = '22023';
  end if;
  v_hash := md5(jsonb_build_object('cmd', 'create_fixture_room', 'cargo', p_cargo_listing_id, 'vessel', p_vessel_availability_id, 'terms', p_terms, 'options', coalesce(p_options, '{}'::jsonb))::text);

  -- replay: the key is scoped to the creator
  select * into v_existing from public.fixture_rooms x where x.created_by_user_id = v_actor and x.create_idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    if exists (select 1 from public.fixture_events e where e.room_id = v_existing.id and e.idempotency_key = p_idempotency_key and e.request_hash is distinct from v_hash) then
      raise exception 'FX_IDEMPOTENCY_MISMATCH: idempotency key % was already used with different arguments', p_idempotency_key using errcode = 'P0001';
    end if;
    return jsonb_build_object('ok', true, 'version', v_existing.version, 'eventId', null, 'replayed', true,
                              'data', jsonb_build_object('roomId', v_existing.id, 'ref', v_existing.ref, 'status', v_existing.status));
  end if;

  if not public.fn_fixture_tier_ok() then
    raise exception 'FX_GATE: the Fixture Room is available from Subscriber tier (T3+)' using errcode = '42501';
  end if;
  if p_cargo_listing_id is null or p_vessel_availability_id is null then
    raise exception 'FX_VALIDATION: a cargo listing and a vessel availability are both required' using errcode = '22023';
  end if;
  v_cargo := public.fn_fixture_snapshot_cargo(p_cargo_listing_id);
  if v_cargo is null then
    raise exception 'FX_NOT_FOUND: cargo listing % not found', p_cargo_listing_id using errcode = 'P0002';
  end if;
  v_vessel := public.fn_fixture_snapshot_vessel(p_vessel_availability_id);
  if v_vessel is null then
    raise exception 'FX_NOT_FOUND: vessel availability % not found', p_vessel_availability_id using errcode = 'P0002';
  end if;
  v_vessel_id := (v_vessel->'availability'->>'vessel_id')::uuid;
  if coalesce((v_vessel->'vessel'->>'is_sanctioned')::boolean, false) then
    raise exception 'FX_STATE: this vessel is sanctioned and cannot be fixed on the platform' using errcode = '55000';
  end if;

  -- the identity the actor represents each listing as, from its ownership row (FR-H1)
  v_own_cargo  := public.fn_fixture_owns_listing('cargo', p_cargo_listing_id);
  v_own_vessel := public.fn_fixture_owns_listing('vessel_availability', p_vessel_availability_id);
  v_owns_cargo := v_own_cargo is not null; v_owns_vessel := v_own_vessel is not null;
  if not (v_owns_cargo or v_owns_vessel or v_admin) then
    raise exception 'FX_AUTH: you must own or represent one side of the fixture' using errcode = '42501';
  end if;
  if v_owns_cargo and v_owns_vessel then
    raise exception 'FX_STATE: you own both sides of this pairing; a room needs a counterparty' using errcode = '55000';
  end if;
  if not v_owns_cargo and not v_admin and not public.fn_fixture_listing_live('cargo', p_cargo_listing_id) then
    raise exception 'FX_STATE: the cargo listing is not live on the market' using errcode = '55000';
  end if;
  if not v_owns_vessel and not v_admin and not public.fn_fixture_listing_live('vessel_availability', p_vessel_availability_id) then
    raise exception 'FX_STATE: the vessel position is not live on the market' using errcode = '55000';
  end if;

  select * into v_existing from public.fixture_rooms x
   where x.cargo_listing_id = p_cargo_listing_id and x.vessel_availability_id = p_vessel_availability_id
     and not public.fn_fixture_terminal(x.status);
  if v_existing.id is not null then
    raise exception 'FX_CONFLICT: room % (%) already covers this pairing', v_existing.id, v_existing.ref using errcode = '23505';
  end if;

  -- the term catalogue (decision D5, audit FR-H2): TypeScript owns it and the
  -- database holds the same versioned definitions; the caller's copy must
  -- match the version it names term for term — codes, labels, categories,
  -- sort order, value kinds, units and required — with only the
  -- listing-derived hint free to vary. Anything else is refused.
  v_version := coalesce(nullif(btrim(coalesce(p_options->>'catalogueVersion', '')), ''), '2026-09-23.v1');
  v_cat := public.fn_fixture_term_catalogue(v_version);
  if v_cat is null then
    raise exception 'FX_VALIDATION: unknown term catalogue version "%"', v_version using errcode = '22023';
  end if;
  if p_terms is null or jsonb_typeof(p_terms) <> 'array' or jsonb_array_length(p_terms) <> jsonb_array_length(v_cat) then
    raise exception 'FX_VALIDATION: term catalogue % holds exactly % terms', v_version, jsonb_array_length(v_cat) using errcode = '22023';
  end if;
  for v_def in select * from jsonb_array_elements(v_cat) loop
    v_code := v_def->>'code';
    select count(*) into v_n from jsonb_array_elements(p_terms) x where x->>'code' = v_code;
    if v_n <> 1 then
      raise exception 'FX_VALIDATION: term "%" of catalogue % must appear exactly once', v_code, v_version using errcode = '22023';
    end if;
    select x into v_supplied from jsonb_array_elements(p_terms) x where x->>'code' = v_code;
    if btrim(coalesce(v_supplied->>'label', '')) is distinct from (v_def->>'label')
       or nullif(btrim(coalesce(v_supplied->>'category', '')), '') is distinct from (v_def->>'category')
       or (v_supplied->>'sortOrder') is distinct from (v_def->>'sortOrder')
       or (v_supplied->>'valueKind') is distinct from (v_def->>'valueKind')
       or nullif(btrim(coalesce(v_supplied->>'unit', '')), '') is distinct from (v_def->>'unit')
       or (v_supplied->>'required') is distinct from 'true' then
      raise exception 'FX_VALIDATION: term "%" does not match catalogue % (label, category, sort order, value kind, unit and required are fixed)', v_code, v_version using errcode = '22023';
    end if;
    if coalesce(length(v_supplied->>'hint'), 0) > 300 then
      raise exception 'FX_VALIDATION: term "%" has an over-long hint', v_code using errcode = '22023';
    end if;
    v_codes := v_codes || v_code;
  end loop;

  select s.value into v_brokerage from public.app_settings s where s.key = 'fixture_brokerage_terms';
  v_ref := 'FX-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.fixture_room_ref_seq')::text, 5, '0');

  begin
    insert into public.fixture_rooms (ref, cargo_listing_id, vessel_availability_id, vessel_id, status, mediation, created_by_user_id,
                                      create_idempotency_key, cargo_snapshot, vessel_snapshot, snapshot_hash, brokerage_terms_snapshot, term_catalogue_version)
    values (v_ref, p_cargo_listing_id, p_vessel_availability_id, v_vessel_id, 'draft', 'platform', v_actor,
            p_idempotency_key, v_cargo, v_vessel, md5(v_cargo::text || v_vessel::text), v_brokerage, v_version)
    returning * into v_room;
  exception when unique_violation then
    raise exception 'FX_CONFLICT: a room for this pairing was created concurrently' using errcode = '23505';
  end;

  -- the platform party: explicit, mediator capacity (decision D1)
  insert into public.fixture_parties (room_id, side, capacity, participation_mode, is_platform, display_label, status, accepted_at)
  values (v_room.id, 'mediator', 'broker', 'direct', true, 'Arab ShipBroker', 'active', now())
  returning * into v_platform;
  v_parties_payload := v_parties_payload || public.fn_fixture_party_payload(v_platform);

  -- the creator's own side: exactly the identity the ownership row names
  -- (FR-H1) — the owning organisation the actor holds a seat in, or the actor
  -- personally; never a seat guessed from the actor's memberships
  v_own := case when v_owns_cargo then v_own_cargo else v_own_vessel end;
  v_creator_org := (v_own->>'org_id')::uuid; v_creator_user := (v_own->>'user_id')::uuid;
  foreach v_side in array array['cargo', 'vessel'] loop
    if (v_side = 'cargo' and v_owns_cargo) or (v_side = 'vessel' and v_owns_vessel) then
      insert into public.fixture_parties (room_id, side, capacity, participation_mode, org_id, user_id, display_label, status,
                                          invited_by_user_id, invited_at, accepted_at)
      values (v_room.id, v_side, 'principal', 'direct', v_creator_org, v_creator_user,
              case v_side when 'cargo' then 'Charterer side' else 'Owner side' end, 'active', v_actor, now(), now())
      returning * into v_creator;
      v_parties_payload := v_parties_payload || public.fn_fixture_party_payload(v_creator);
    end if;
  end loop;

  -- the counterparty (amendment A1): direct when a registered org / member is
  -- behind the listing, relayed (contact, org without a seat, or an unresolved
  -- party anchored to the listing) otherwise
  foreach v_side in array array['cargo', 'vessel'] loop
    if (v_side = 'cargo' and v_owns_cargo) or (v_side = 'vessel' and v_owns_vessel) then continue; end if;
    v_cp := public.fn_fixture_resolve_counterparty(case v_side when 'cargo' then 'cargo' else 'vessel_availability' end,
                                                   case v_side when 'cargo' then p_cargo_listing_id else p_vessel_availability_id end);
    v_label := case v_side when 'cargo' then 'Charterer side' else 'Owner side' end;
    if v_creator_org is not null and (v_cp->>'org_id')::uuid = v_creator_org then
      raise exception 'FX_STATE: your organisation is behind both sides of this pairing' using errcode = '55000';
    end if;
    if (v_cp->>'user_id')::uuid = v_actor then
      raise exception 'FX_STATE: you are behind both sides of this pairing' using errcode = '55000';
    end if;
    if v_cp->>'mode' = 'direct' then
      insert into public.fixture_parties (room_id, side, capacity, participation_mode, org_id, user_id, display_label, status, invited_by_user_id, invited_at)
      values (v_room.id, v_side, 'principal', 'direct', (v_cp->>'org_id')::uuid, (v_cp->>'user_id')::uuid, v_label, 'invited', v_actor, now())
      returning * into v_p;
      v_invites := v_invites || v_p;
    else
      insert into public.fixture_parties (room_id, side, capacity, participation_mode, org_id, user_id, contact_id,
                                          anchor_listing_type, anchor_listing_id, display_label, status)
      values (v_room.id, v_side, 'principal', 'relayed', (v_cp->>'org_id')::uuid, (v_cp->>'user_id')::uuid, (v_cp->>'contact_id')::uuid,
              case when coalesce((v_cp->>'anchor')::boolean, false) then (case v_side when 'cargo' then 'cargo' else 'vessel_availability' end) end,
              case when coalesce((v_cp->>'anchor')::boolean, false) then (case v_side when 'cargo' then p_cargo_listing_id else p_vessel_availability_id end) end,
              v_label, 'active')
      returning * into v_p;
    end if;
    v_parties_payload := v_parties_payload || public.fn_fixture_party_payload(v_p);
  end loop;

  -- the terms are copied from the catalogue definitions (never from the
  -- caller's copy); only the hint comes from the caller
  for v_def in select * from jsonb_array_elements(v_cat) loop
    select x into v_supplied from jsonb_array_elements(p_terms) x where x->>'code' = v_def->>'code';
    insert into public.fixture_terms (room_id, code, label, category, sort_order, value_kind, unit, required, hint)
    values (v_room.id, v_def->>'code', v_def->>'label', v_def->>'category', (v_def->>'sortOrder')::int, v_def->>'valueKind',
            v_def->>'unit', true, nullif(btrim(coalesce(v_supplied->>'hint', '')), ''));
  end loop;

  update public.fixture_rooms set status = 'invited', created_by_party_id = coalesce(v_creator.id, v_platform.id) where id = v_room.id;

  -- the payload names the listings but not the vessel: event payloads reach
  -- every party, and a TBN vessel's id is counterparty identity (FR-H3)
  v_first := public.fn_fixture_event(v_room.id, 'room.created', v_actor, coalesce(v_creator.id, v_platform.id), null, false,
    'create_fixture_room', p_idempotency_key, v_hash,
    jsonb_build_object('ref', v_ref, 'cargoListingId', p_cargo_listing_id, 'vesselAvailabilityId', p_vessel_availability_id,
                       'snapshotHash', md5(v_cargo::text || v_vessel::text), 'termCatalogueVersion', v_version, 'termCodes', to_jsonb(v_codes),
                       'parties', v_parties_payload, 'roomStatus', 'invited'),
    jsonb_build_object('roomId', v_room.id, 'ref', v_ref, 'status', 'invited'));
  v_last := v_first;
  foreach v_p in array v_invites loop
    v_last := public.fn_fixture_event(v_room.id, 'party.invited', v_actor, coalesce(v_creator.id, v_platform.id), null, false,
      'create_fixture_room', p_idempotency_key, v_hash, public.fn_fixture_party_payload(v_p), null);
  end loop;
  return v_first || jsonb_build_object('version', (v_last->>'version')::int);
end $$;
revoke all on function public.create_fixture_room(uuid, uuid, jsonb, text, jsonb) from public, anon, authenticated;
grant execute on function public.create_fixture_room(uuid, uuid, jsonb, text, jsonb) to authenticated, service_role;

-- ── invite_fixture_party ────────────────────────────────────────────────────
create or replace function public.invite_fixture_party(
  p_room_id uuid, p_side text, p_capacity text, p_org_id uuid, p_user_id uuid,
  p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; v_p public.fixture_parties; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'invite_fixture_party', 'side', p_side, 'capacity', p_capacity, 'org', p_org_id, 'user', p_user_id, 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if public.fn_fixture_terminal(r.status) then
    raise exception 'FX_STATE: the room is %', r.status using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot invite parties' using errcode = '42501';
  end if;
  if p_side not in ('cargo', 'vessel') or p_capacity not in ('principal', 'broker', 'viewer') then
    raise exception 'FX_VALIDATION: side must be cargo or vessel and capacity principal, broker or viewer' using errcode = '22023';
  end if;
  if acting.side <> 'mediator' and acting.side <> p_side then
    raise exception 'FX_AUTH: you may invite onto your own side only' using errcode = '42501';
  end if;
  if (p_org_id is null) = (p_user_id is null) then
    raise exception 'FX_VALIDATION: name exactly one of an organisation or a member' using errcode = '22023';
  end if;
  if p_org_id is not null and not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'FX_NOT_FOUND: organisation not found' using errcode = 'P0002';
  end if;
  if p_user_id is not null and not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'FX_NOT_FOUND: member not found' using errcode = 'P0002';
  end if;
  if p_capacity = 'principal' and exists (select 1 from public.fixture_parties p where p.room_id = r.id and p.side = p_side and p.capacity = 'principal' and p.status in ('invited', 'active')) then
    raise exception 'FX_STATE: the % side already has a principal', p_side using errcode = '55000';
  end if;
  begin
    insert into public.fixture_parties (room_id, side, capacity, participation_mode, org_id, user_id, display_label, status, invited_by_user_id, invited_at)
    values (r.id, p_side, p_capacity, 'direct', p_org_id, p_user_id,
            case p_capacity when 'principal' then (case p_side when 'cargo' then 'Charterer side' else 'Owner side' end)
                            when 'broker' then (case p_side when 'cargo' then 'Cargo-side broker' else 'Vessel-side broker' end)
                            else (case p_side when 'cargo' then 'Cargo-side viewer' else 'Vessel-side viewer' end) end,
            'invited', v_actor, now())
    returning * into v_p;
  exception when unique_violation then
    raise exception 'FX_CONFLICT: that organisation or member is already a party of this room' using errcode = '23505';
  end;
  if r.status = 'draft' then update public.fixture_rooms set status = 'invited' where id = r.id; end if;
  v_first := public.fn_fixture_event(r.id, 'party.invited', v_actor, acting.id, null, false, 'invite_fixture_party', p_idempotency_key, v_hash,
    public.fn_fixture_party_payload(v_p), jsonb_build_object('partyId', v_p.id, 'status', v_p.status));
  return v_first;
end $$;
revoke all on function public.invite_fixture_party(uuid, text, text, uuid, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.invite_fixture_party(uuid, text, text, uuid, uuid, integer, text, uuid) to authenticated, service_role;

-- ── respond_fixture_invitation ──────────────────────────────────────────────
-- A member may hold more than one invitation in a room (an organisation
-- seat and a personal one, say). With one, the answer is unambiguous; with
-- several the caller names the party (audit FR-M3). The 4-argument signature
-- of the first commit is dropped so a re-apply never leaves two overloads.
drop function if exists public.respond_fixture_invitation(uuid, boolean, integer, text);
create or replace function public.respond_fixture_invitation(
  p_room_id uuid, p_accept boolean, p_expected_version integer, p_idempotency_key text, p_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; v_p public.fixture_parties; v_n int;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'respond_fixture_invitation', 'accept', p_accept, 'party', p_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if public.fn_fixture_terminal(r.status) then
    raise exception 'FX_STATE: the room is %', r.status using errcode = '55000';
  end if;
  select count(*) into v_n from public.fn_fixture_actor_parties(r.id) p where p.status = 'invited';
  if v_n = 0 then
    raise exception 'FX_STATE: you have no pending invitation in this room' using errcode = '55000';
  end if;
  if p_party_id is not null then
    select p.* into v_p from public.fn_fixture_actor_parties(r.id) p where p.status = 'invited' and p.id = p_party_id;
    if v_p.id is null then
      raise exception 'FX_AUTH: that invitation is not yours to answer' using errcode = '42501';
    end if;
  elsif v_n > 1 then
    raise exception 'FX_VALIDATION: you hold % invitations in this room — name the party you are answering for', v_n using errcode = '22023';
  else
    select p.* into v_p from public.fn_fixture_actor_parties(r.id) p where p.status = 'invited';
  end if;
  if coalesce(p_accept, false) then
    update public.fixture_parties set status = 'active', accepted_at = now() where id = v_p.id returning * into v_p;
  else
    update public.fixture_parties set status = 'declined', declined_at = now() where id = v_p.id returning * into v_p;
  end if;
  return public.fn_fixture_event(r.id, case when p_accept then 'party.accepted' else 'party.declined' end, v_actor, v_p.id, null, false,
    'respond_fixture_invitation', p_idempotency_key, v_hash, public.fn_fixture_party_payload(v_p),
    jsonb_build_object('partyId', v_p.id, 'status', v_p.status));
end $$;
revoke all on function public.respond_fixture_invitation(uuid, boolean, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.respond_fixture_invitation(uuid, boolean, integer, text, uuid) to authenticated, service_role;

-- ── submit_fixture_proposal ─────────────────────────────────────────────────
create or replace function public.submit_fixture_proposal(
  p_room_id uuid, p_term_id uuid, p_value jsonb, p_comment text, p_is_final boolean, p_expires_in_minutes integer,
  p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
  t public.fixture_terms; v_norm jsonb; v_display text; v_prev public.fixture_proposals; v_prev_id uuid; v_expires timestamptz;
  v_pid uuid; v_round int; v_first jsonb; v_last jsonb; v_new_status text; v_prev_status text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'submit_fixture_proposal', 'term', p_term_id, 'value', p_value, 'comment', p_comment,
                                   'final', coalesce(p_is_final, false), 'expires', p_expires_in_minutes, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: proposals are not accepted while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);

  select * into t from public.fixture_terms x where x.id = p_term_id and x.room_id = r.id for update;
  if t.id is null then
    raise exception 'FX_NOT_FOUND: term not found in this room' using errcode = 'P0002';
  end if;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is agreed — reopen it before proposing again', t.label using errcode = '55000';
  end if;
  if t.status = 'withdrawn' then
    raise exception 'FX_STATE: "%" was withdrawn from the term sheet', t.label using errcode = '55000';
  end if;
  v_norm := public.fn_fixture_validate_value(t.value_kind, p_value);
  v_display := public.fn_fixture_display_value(t.value_kind, v_norm, t.unit);
  if coalesce(length(p_comment), 0) > 1000 then
    raise exception 'FX_VALIDATION: comment must be at most 1000 characters' using errcode = '22023';
  end if;
  if p_expires_in_minutes is not null then
    if p_expires_in_minutes < 1 or p_expires_in_minutes > 10080 then
      raise exception 'FX_VALIDATION: validity must be between 1 minute and 7 days' using errcode = '22023';
    end if;
    v_expires := now() + make_interval(mins => p_expires_in_minutes);
  end if;

  v_prev_id := case rep.side when 'cargo' then t.cargo_proposal_id else t.vessel_proposal_id end;
  if v_prev_id is not null then
    select * into v_prev from public.fixture_proposals x where x.id = v_prev_id;
    -- observe the lapse once: the sweep (20260923204000) may already have written it
    if v_prev.expires_at is not null and v_prev.expires_at < now()
       and not exists (select 1 from public.fixture_events e where e.room_id = r.id and e.type = 'proposal.lapsed'
                          and e.payload->>'proposalId' = v_prev.id::text) then
      v_last := public.fn_fixture_event(r.id, 'proposal.lapsed', v_actor, acting.id, null, false, 'submit_fixture_proposal', p_idempotency_key, v_hash,
        jsonb_build_object('proposalId', v_prev.id, 'termId', t.id, 'termCode', t.code, 'side', rep.side, 'displayValue', v_prev.display_value, 'expiredAt', v_prev.expires_at), null);
    end if;
  end if;

  v_prev_status := r.status;
  v_new_status := case when r.status = 'invited' then 'negotiating' else r.status end;
  v_pid := gen_random_uuid();
  select count(*) + 1 into v_round from public.fixture_proposals x where x.term_id = t.id;

  v_first := public.fn_fixture_event(r.id, 'proposal.submitted', v_actor, acting.id,
    case when rep.id <> acting.id then rep.id end, rep.id <> acting.id, 'submit_fixture_proposal', p_idempotency_key, v_hash,
    jsonb_build_object('proposalId', v_pid, 'termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'side', rep.side,
                       'kind', case rep.side when 'cargo' then 'bid' else 'offer' end, 'displayValue', v_display, 'value', v_norm,
                       'comment', nullif(btrim(coalesce(p_comment, '')), ''), 'isFinal', coalesce(p_is_final, false), 'expiresAt', v_expires,
                       'round', v_round, 'supersedesProposalId', v_prev_id, 'previousRoomStatus', v_prev_status, 'roomStatus', v_new_status),
    jsonb_build_object('proposalId', v_pid, 'termId', t.id, 'termStatus', 'countered', 'roomStatus', v_new_status, 'displayValue', v_display));

  insert into public.fixture_proposals (id, room_id, term_id, party_id, recorded_by_user_id, relayed, kind, value_kind, value, display_value, comment,
                                        is_final, expires_at, supersedes_proposal_id, round, event_id)
  values (v_pid, r.id, t.id, rep.id, v_actor, rep.id <> acting.id, case rep.side when 'cargo' then 'bid' else 'offer' end, t.value_kind, v_norm, v_display,
          nullif(btrim(coalesce(p_comment, '')), ''), coalesce(p_is_final, false), v_expires, v_prev_id, v_round, (v_first->>'eventId')::bigint);

  update public.fixture_terms
     set cargo_proposal_id  = case when rep.side = 'cargo'  then v_pid else cargo_proposal_id end,
         vessel_proposal_id = case when rep.side = 'vessel' then v_pid else vessel_proposal_id end,
         last_proposal_id = v_pid, status = 'countered', updated_at = now()
   where id = t.id;
  if v_new_status <> v_prev_status then
    update public.fixture_rooms set status = v_new_status where id = r.id;
  end if;
  -- the first event (proposal.submitted) carries the result; a lapse observation may precede it
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.submit_fixture_proposal(uuid, uuid, jsonb, text, boolean, integer, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_fixture_proposal(uuid, uuid, jsonb, text, boolean, integer, integer, text, uuid, uuid) to authenticated, service_role;

-- ── withdraw_fixture_proposal ───────────────────────────────────────────────
create or replace function public.withdraw_fixture_proposal(
  p_room_id uuid, p_proposal_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        pr public.fixture_proposals; t public.fixture_terms; v_other uuid; v_status text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'withdraw_fixture_proposal', 'proposal', p_proposal_id, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: proposals cannot change while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);
  select * into pr from public.fixture_proposals x where x.id = p_proposal_id and x.room_id = r.id;
  if pr.id is null then
    raise exception 'FX_NOT_FOUND: proposal not found in this room' using errcode = 'P0002';
  end if;
  if pr.party_id <> rep.id then
    raise exception 'FX_AUTH: you can withdraw your own side''s proposal only' using errcode = '42501';
  end if;
  select * into t from public.fixture_terms x where x.id = pr.term_id for update;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is agreed — reopen it instead', t.label using errcode = '55000';
  end if;
  if (rep.side = 'cargo' and t.cargo_proposal_id is distinct from pr.id) or (rep.side = 'vessel' and t.vessel_proposal_id is distinct from pr.id) then
    raise exception 'FX_STATE: this proposal is no longer live' using errcode = '55000';
  end if;
  v_other := case rep.side when 'cargo' then t.vessel_proposal_id else t.cargo_proposal_id end;
  v_status := case when v_other is null then 'open' else 'countered' end;
  update public.fixture_terms
     set cargo_proposal_id  = case when rep.side = 'cargo'  then null else cargo_proposal_id end,
         vessel_proposal_id = case when rep.side = 'vessel' then null else vessel_proposal_id end,
         last_proposal_id = case when last_proposal_id = pr.id then v_other else last_proposal_id end,
         status = v_status, updated_at = now()
   where id = t.id;
  return public.fn_fixture_event(r.id, 'proposal.withdrawn', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'withdraw_fixture_proposal', p_idempotency_key, v_hash,
    jsonb_build_object('proposalId', pr.id, 'termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'side', rep.side, 'displayValue', pr.display_value, 'termStatus', v_status),
    jsonb_build_object('proposalId', pr.id, 'termId', t.id, 'termStatus', v_status));
end $$;
revoke all on function public.withdraw_fixture_proposal(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.withdraw_fixture_proposal(uuid, uuid, integer, text, uuid, uuid) to authenticated, service_role;

-- ── accept_fixture_proposal ─────────────────────────────────────────────────
create or replace function public.accept_fixture_proposal(
  p_room_id uuid, p_proposal_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        pr public.fixture_proposals; pp public.fixture_parties; t public.fixture_terms; v_first jsonb; v_prev_status text; v_new_status text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'accept_fixture_proposal', 'proposal', p_proposal_id, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: proposals cannot be accepted while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);
  select * into pr from public.fixture_proposals x where x.id = p_proposal_id and x.room_id = r.id;
  if pr.id is null then
    raise exception 'FX_NOT_FOUND: proposal not found in this room' using errcode = 'P0002';
  end if;
  select * into pp from public.fixture_parties x where x.id = pr.party_id;
  if pp.side = rep.side then
    raise exception 'FX_STATE: you can only accept the other side''s proposal' using errcode = '55000';
  end if;
  select * into t from public.fixture_terms x where x.id = pr.term_id for update;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is already agreed', t.label using errcode = '55000';
  end if;
  if (pp.side = 'cargo' and t.cargo_proposal_id is distinct from pr.id) or (pp.side = 'vessel' and t.vessel_proposal_id is distinct from pr.id) then
    raise exception 'FX_STATE: this proposal is no longer live' using errcode = '55000';
  end if;
  if pr.expires_at is not null and pr.expires_at < now() then
    raise exception 'FX_STATE: this proposal lapsed at % — ask for a fresh one', to_char(pr.expires_at, 'DD Mon HH24:MI "UTC"') using errcode = '55000';
  end if;
  v_prev_status := r.status;
  v_new_status := case when r.status = 'invited' then 'negotiating' else r.status end;

  v_first := public.fn_fixture_event(r.id, 'term.agreed', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'accept_fixture_proposal', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'proposalId', pr.id, 'displayValue', pr.display_value,
                       'proposalSide', pp.side, 'acceptedBySide', rep.side, 'previousRoomStatus', v_prev_status, 'roomStatus', v_new_status),
    jsonb_build_object('termId', t.id, 'proposalId', pr.id, 'termStatus', 'agreed', 'roomStatus', v_new_status, 'displayValue', pr.display_value));
  update public.fixture_terms
     set status = 'agreed', agreed_proposal_id = pr.id, agreed_at = now(), agreed_by_party_id = rep.id, agreed_event_id = (v_first->>'eventId')::bigint,
         last_proposal_id = pr.id, held_by_party_id = null, held_at = null, referred_at = null, referred_by_party_id = null, updated_at = now()
   where id = t.id;
  if v_new_status <> v_prev_status then
    update public.fixture_rooms set status = v_new_status where id = r.id;
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'term agreed: ' || t.label, p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.accept_fixture_proposal(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_fixture_proposal(uuid, uuid, integer, text, uuid, uuid) to authenticated, service_role;

-- ── reopen_fixture_term ─────────────────────────────────────────────────────
create or replace function public.reopen_fixture_term(
  p_room_id uuid, p_term_id uuid, p_reason text, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        t public.fixture_terms; ap public.fixture_proposals; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'reopen_fixture_term', 'term', p_term_id, 'reason', p_reason, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('negotiating', 'on_subjects') then
    raise exception 'FX_STATE: terms cannot be reopened while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  if rep.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot reopen terms' using errcode = '42501';
  end if;
  select * into t from public.fixture_terms x where x.id = p_term_id and x.room_id = r.id for update;
  if t.id is null then
    raise exception 'FX_NOT_FOUND: term not found in this room' using errcode = 'P0002';
  end if;
  if t.status <> 'agreed' then
    raise exception 'FX_STATE: "%" is not agreed, so there is nothing to reopen', t.label using errcode = '55000';
  end if;
  if coalesce(length(p_reason), 0) > 500 then
    raise exception 'FX_VALIDATION: reason must be at most 500 characters' using errcode = '22023';
  end if;
  select * into ap from public.fixture_proposals x where x.id = t.agreed_proposal_id;

  v_first := public.fn_fixture_event(r.id, 'term.reopened', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'reopen_fixture_term', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'reason', nullif(btrim(coalesce(p_reason, '')), ''),
                       'previousProposalId', ap.id, 'previousAgreedValue', ap.display_value, 'reopenCount', t.reopen_count + 1,
                       'previousRoomStatus', r.status, 'roomStatus', 'negotiating'),
    jsonb_build_object('termId', t.id, 'termStatus', 'open', 'roomStatus', 'negotiating'));
  update public.fixture_terms
     set status = 'open', agreed_proposal_id = null, agreed_at = null, agreed_by_party_id = null, agreed_event_id = null,
         cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, reopen_count = reopen_count + 1, updated_at = now()
   where id = t.id;
  if r.status = 'on_subjects' then
    update public.fixture_rooms set status = 'negotiating' where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.returned_to_negotiation', v_actor, acting.id, null, false, 'reopen_fixture_term', p_idempotency_key, v_hash,
      jsonb_build_object('reason', 'term reopened', 'termId', t.id, 'termLabel', t.label), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'IN', 'vessel_status', 'OPEN'),
      'returned to negotiation', v_actor, acting.id, p_idempotency_key, v_hash);
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'term reopened: ' || t.label, p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.reopen_fixture_term(uuid, uuid, text, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reopen_fixture_term(uuid, uuid, text, integer, text, uuid, uuid) to authenticated, service_role;

-- ── set_fixture_term_flag (hold / resume / refer / clear_referral) ──────────
create or replace function public.set_fixture_term_flag(
  p_room_id uuid, p_term_id uuid, p_flag text, p_note text, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties; t public.fixture_terms; v_type text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'set_fixture_term_flag', 'term', p_term_id, 'flag', p_flag, 'note', p_note, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: term flags cannot change while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  if p_flag not in ('hold', 'resume', 'refer', 'clear_referral') then
    raise exception 'FX_VALIDATION: flag must be hold, resume, refer or clear_referral' using errcode = '22023';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  if rep.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot flag terms' using errcode = '42501';
  end if;
  select * into t from public.fixture_terms x where x.id = p_term_id and x.room_id = r.id for update;
  if t.id is null then
    raise exception 'FX_NOT_FOUND: term not found in this room' using errcode = 'P0002';
  end if;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is agreed', t.label using errcode = '55000';
  end if;
  case p_flag
    when 'hold' then
      if t.held_by_party_id is not null then raise exception 'FX_STATE: "%" is already on hold', t.label using errcode = '55000'; end if;
      update public.fixture_terms set held_by_party_id = rep.id, held_at = now(), updated_at = now() where id = t.id; v_type := 'term.held';
    when 'resume' then
      if t.held_by_party_id is null then raise exception 'FX_STATE: "%" is not on hold', t.label using errcode = '55000'; end if;
      if t.held_by_party_id <> rep.id and acting.side <> 'mediator' then raise exception 'FX_AUTH: only the party that put "%" on hold can resume it', t.label using errcode = '42501'; end if;
      update public.fixture_terms set held_by_party_id = null, held_at = null, updated_at = now() where id = t.id; v_type := 'term.resumed';
    when 'refer' then
      if t.referred_at is not null then raise exception 'FX_STATE: "%" is already referred', t.label using errcode = '55000'; end if;
      update public.fixture_terms set referred_at = now(), referred_by_party_id = rep.id, updated_at = now() where id = t.id; v_type := 'term.referred';
    else
      if t.referred_at is null then raise exception 'FX_STATE: "%" is not referred', t.label using errcode = '55000'; end if;
      update public.fixture_terms set referred_at = null, referred_by_party_id = null, updated_at = now() where id = t.id; v_type := 'term.referral_cleared';
  end case;
  return public.fn_fixture_event(r.id, v_type, v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'set_fixture_term_flag', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'flag', p_flag, 'note', nullif(btrim(coalesce(p_note, '')), ''), 'side', rep.side),
    jsonb_build_object('termId', t.id, 'flag', p_flag));
end $$;
revoke all on function public.set_fixture_term_flag(uuid, uuid, text, text, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_fixture_term_flag(uuid, uuid, text, text, integer, text, uuid, uuid) to authenticated, service_role;

-- ── add_fixture_subject ─────────────────────────────────────────────────────
create or replace function public.add_fixture_subject(
  p_room_id uuid, p_title text, p_description text, p_responsible_side text, p_deadline_at timestamptz,
  p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; v_sid uuid; v_seq int; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'add_fixture_subject', 'title', p_title, 'description', p_description, 'side', p_responsible_side, 'deadline', p_deadline_at, 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('negotiating', 'on_subjects') then
    raise exception 'FX_STATE: subjects can be added while negotiating or on subjects, not while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot add subjects' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_title)), 0) not between 1 and 200 then
    raise exception 'FX_VALIDATION: subject title must be 1–200 characters' using errcode = '22023';
  end if;
  if coalesce(length(p_description), 0) > 1000 then
    raise exception 'FX_VALIDATION: subject description must be at most 1000 characters' using errcode = '22023';
  end if;
  if p_responsible_side is not null and p_responsible_side not in ('cargo', 'vessel', 'mediator') then
    raise exception 'FX_VALIDATION: responsible side must be cargo, vessel or mediator' using errcode = '22023';
  end if;
  select coalesce(max(s.seq), 0) + 1 into v_seq from public.fixture_subjects s where s.room_id = r.id;
  v_sid := gen_random_uuid();
  v_first := public.fn_fixture_event(r.id, 'subject.added', v_actor, acting.id, null, false, 'add_fixture_subject', p_idempotency_key, v_hash,
    jsonb_build_object('subjectId', v_sid, 'seq', v_seq, 'title', btrim(p_title), 'responsibleSide', p_responsible_side, 'deadlineAt', p_deadline_at),
    jsonb_build_object('subjectId', v_sid, 'seq', v_seq));
  insert into public.fixture_subjects (id, room_id, seq, title, description, responsible_side, deadline_at, added_by_party_id, added_event_id)
  values (v_sid, r.id, v_seq, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_responsible_side, p_deadline_at, acting.id, (v_first->>'eventId')::bigint);
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'subject added', p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.add_fixture_subject(uuid, text, text, text, timestamptz, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.add_fixture_subject(uuid, text, text, text, timestamptz, integer, text, uuid) to authenticated, service_role;

-- ── lift_fixture_subject (the last lift fixes the room atomically) ──────────
create or replace function public.lift_fixture_subject(
  p_room_id uuid, p_subject_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        s public.fixture_subjects; v_first jsonb; v_open int; v_fixed boolean := false;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'lift_fixture_subject', 'subject', p_subject_id, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status <> 'on_subjects' then
    raise exception 'FX_STATE: subjects can be lifted only while the room is on subjects (it is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  if rep.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot lift subjects' using errcode = '42501';
  end if;
  select * into s from public.fixture_subjects x where x.id = p_subject_id and x.room_id = r.id for update;
  if s.id is null then
    raise exception 'FX_NOT_FOUND: subject not found in this room' using errcode = 'P0002';
  end if;
  if s.status <> 'open' then
    raise exception 'FX_STATE: subject "%" is already %', s.title, s.status using errcode = '55000';
  end if;
  if s.responsible_side is not null and s.responsible_side <> rep.side then
    raise exception 'FX_AUTH: the % side must lift "%"', s.responsible_side, s.title using errcode = '42501';
  end if;
  v_first := public.fn_fixture_event(r.id, 'subject.lifted', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'lift_fixture_subject', p_idempotency_key, v_hash,
    jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'title', s.title, 'liftedBySide', rep.side),
    jsonb_build_object('subjectId', s.id, 'subjectStatus', 'lifted'));
  update public.fixture_subjects set status = 'lifted', resolved_at = now(), resolved_by_party_id = rep.id, resolved_event_id = (v_first->>'eventId')::bigint where id = s.id;
  select count(*) into v_open from public.fixture_subjects x where x.room_id = r.id and x.status = 'open';
  if v_open = 0 then
    update public.fixture_rooms set status = 'fixed', fixed_at = now() where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.fixed', v_actor, acting.id, null, false, 'lift_fixture_subject', p_idempotency_key, v_hash,
      jsonb_build_object('fixedAt', now(), 'lastSubjectId', s.id, 'lastSubjectTitle', s.title), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'FIXED'), 'fixed', v_actor, acting.id, p_idempotency_key, v_hash);
    v_fixed := true;
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'subject lifted', p_idempotency_key, v_hash);
  return (v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id)))
         || jsonb_build_object('data', (v_first->'data') || jsonb_build_object('roomStatus', case when v_fixed then 'fixed' else 'on_subjects' end, 'openSubjects', v_open));
end $$;
revoke all on function public.lift_fixture_subject(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.lift_fixture_subject(uuid, uuid, integer, text, uuid, uuid) to authenticated, service_role;

-- ── fail_fixture_subject (fails the fixture) ────────────────────────────────
create or replace function public.fail_fixture_subject(
  p_room_id uuid, p_subject_id uuid, p_reason text, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties; s public.fixture_subjects; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'fail_fixture_subject', 'subject', p_subject_id, 'reason', p_reason, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status <> 'on_subjects' then
    raise exception 'FX_STATE: subjects can fail only while the room is on subjects (it is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  if rep.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot fail subjects' using errcode = '42501';
  end if;
  select * into s from public.fixture_subjects x where x.id = p_subject_id and x.room_id = r.id for update;
  if s.id is null then
    raise exception 'FX_NOT_FOUND: subject not found in this room' using errcode = 'P0002';
  end if;
  if s.status <> 'open' then
    raise exception 'FX_STATE: subject "%" is already %', s.title, s.status using errcode = '55000';
  end if;
  if s.responsible_side is not null and s.responsible_side <> rep.side and acting.side <> 'mediator' then
    raise exception 'FX_AUTH: the % side (or the mediator) must fail "%"', s.responsible_side, s.title using errcode = '42501';
  end if;
  if coalesce(length(p_reason), 0) > 500 then
    raise exception 'FX_VALIDATION: reason must be at most 500 characters' using errcode = '22023';
  end if;
  v_first := public.fn_fixture_event(r.id, 'subject.failed', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'fail_fixture_subject', p_idempotency_key, v_hash,
    jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'title', s.title, 'reason', nullif(btrim(coalesce(p_reason, '')), ''), 'failedBySide', rep.side),
    jsonb_build_object('subjectId', s.id, 'subjectStatus', 'failed', 'roomStatus', 'failed'));
  update public.fixture_subjects set status = 'failed', resolved_at = now(), resolved_by_party_id = rep.id, resolved_event_id = (v_first->>'eventId')::bigint where id = s.id;
  update public.fixture_rooms
     set status = 'failed', closed_at = now(), closed_reason = 'failed', closed_by_user_id = v_actor,
         closed_note = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'subject failed: ' || s.title)
   where id = r.id;
  perform public.fn_fixture_event(r.id, 'room.closed', v_actor, acting.id, null, false, 'fail_fixture_subject', p_idempotency_key, v_hash,
    jsonb_build_object('reason', 'failed', 'previousStatus', r.status, 'note', 'subject failed: ' || s.title, 'subjectId', s.id), null);
  perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'IN', 'vessel_status', 'OPEN'), 'fixture failed', v_actor, acting.id, p_idempotency_key, v_hash);
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'fixture failed', p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.fail_fixture_subject(uuid, uuid, text, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fail_fixture_subject(uuid, uuid, text, integer, text, uuid, uuid) to authenticated, service_role;

-- ── extend_fixture_subject ──────────────────────────────────────────────────
create or replace function public.extend_fixture_subject(
  p_room_id uuid, p_subject_id uuid, p_deadline_at timestamptz, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; s public.fixture_subjects;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'extend_fixture_subject', 'subject', p_subject_id, 'deadline', p_deadline_at, 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status <> 'on_subjects' then
    raise exception 'FX_STATE: subject deadlines can change only while the room is on subjects' using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot extend subjects' using errcode = '42501';
  end if;
  if p_deadline_at is null then
    raise exception 'FX_VALIDATION: a new deadline is required' using errcode = '22023';
  end if;
  select * into s from public.fixture_subjects x where x.id = p_subject_id and x.room_id = r.id for update;
  if s.id is null then
    raise exception 'FX_NOT_FOUND: subject not found in this room' using errcode = 'P0002';
  end if;
  if s.status <> 'open' then
    raise exception 'FX_STATE: subject "%" is already %', s.title, s.status using errcode = '55000';
  end if;
  update public.fixture_subjects set deadline_at = p_deadline_at, extended_count = extended_count + 1 where id = s.id;
  return public.fn_fixture_event(r.id, 'subject.extended', v_actor, acting.id, null, false, 'extend_fixture_subject', p_idempotency_key, v_hash,
    jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'title', s.title, 'previousDeadlineAt', s.deadline_at, 'deadlineAt', p_deadline_at, 'extendedCount', s.extended_count + 1),
    jsonb_build_object('subjectId', s.id, 'deadlineAt', p_deadline_at));
end $$;
revoke all on function public.extend_fixture_subject(uuid, uuid, timestamptz, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.extend_fixture_subject(uuid, uuid, timestamptz, integer, text, uuid) to authenticated, service_role;

-- ── fix_fixture_on_subjects ─────────────────────────────────────────────────
create or replace function public.fix_fixture_on_subjects(p_room_id uuid, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; v_open_terms text; v_missing text;
        v_agreed jsonb; v_open_subjects int; v_first jsonb; v_status text := 'on_subjects';
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'fix_fixture_on_subjects', 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status <> 'negotiating' then
    raise exception 'FX_STATE: a room can be fixed on subjects only while negotiating (it is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot fix a room' using errcode = '42501';
  end if;
  select string_agg(t.label, ', ' order by t.sort_order) into v_open_terms from public.fixture_terms t where t.room_id = r.id and t.required and t.status <> 'agreed';
  if v_open_terms is not null then
    raise exception 'FX_STATE: every required term must be agreed first — still open: %', v_open_terms using errcode = '55000';
  end if;
  select string_agg(s, ' and ') into v_missing from (
    select case x when 'cargo' then 'the charterer side' else 'the owner side' end as s
      from unnest(array['cargo', 'vessel']) x
     where not exists (select 1 from public.fixture_parties p where p.room_id = r.id and p.side = x and p.capacity = 'principal' and p.status = 'active')) m;
  if v_missing is not null then
    raise exception 'FX_STATE: % has not joined the room', v_missing using errcode = '55000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'label', t.label, 'value', ap.display_value) order by t.sort_order), '[]'::jsonb)
    into v_agreed from public.fixture_terms t join public.fixture_proposals ap on ap.id = t.agreed_proposal_id where t.room_id = r.id and t.status = 'agreed';
  select count(*) into v_open_subjects from public.fixture_subjects s where s.room_id = r.id and s.status = 'open';

  update public.fixture_rooms set status = 'on_subjects', fixed_on_subs_at = now() where id = r.id;
  v_first := public.fn_fixture_event(r.id, 'room.fixed_on_subjects', v_actor, acting.id, null, false, 'fix_fixture_on_subjects', p_idempotency_key, v_hash,
    jsonb_build_object('fixedOnSubsAt', now(), 'agreedTerms', v_agreed, 'openSubjects', v_open_subjects),
    jsonb_build_object('roomStatus', 'on_subjects', 'openSubjects', v_open_subjects));
  perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'ON SUBS'), 'on_subjects', v_actor, acting.id, p_idempotency_key, v_hash);
  if v_open_subjects = 0 then
    update public.fixture_rooms set status = 'fixed', fixed_at = now() where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.fixed', v_actor, acting.id, null, false, 'fix_fixture_on_subjects', p_idempotency_key, v_hash,
      jsonb_build_object('fixedAt', now(), 'note', 'no subjects were recorded, so the fixture is clean'), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'FIXED'), 'fixed', v_actor, acting.id, p_idempotency_key, v_hash);
    v_status := 'fixed';
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'fixed on subjects', p_idempotency_key, v_hash);
  return (v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id)))
         || jsonb_build_object('data', jsonb_build_object('roomStatus', v_status, 'openSubjects', v_open_subjects));
end $$;
revoke all on function public.fix_fixture_on_subjects(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.fix_fixture_on_subjects(uuid, integer, text, uuid) to authenticated, service_role;

-- ── publish_fixture_recap ───────────────────────────────────────────────────
create or replace function public.publish_fixture_recap(p_room_id uuid, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; v_content jsonb; v_text text; v_no int; v_id uuid; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'publish_fixture_recap', 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('negotiating', 'on_subjects', 'fixed') then
    raise exception 'FX_STATE: a recap can be published while negotiating, on subjects or fixed (the room is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot publish a recap' using errcode = '42501';
  end if;
  v_content := public.fn_fixture_recap_build(r);
  v_text := public.fn_fixture_recap_text(v_content);
  select coalesce(max(v.version_no), 0) + 1 into v_no from public.fixture_recap_versions v where v.room_id = r.id;
  v_id := gen_random_uuid();
  v_first := public.fn_fixture_event(r.id, 'recap.published', v_actor, acting.id, null, false, 'publish_fixture_recap', p_idempotency_key, v_hash,
    jsonb_build_object('recapVersionId', v_id, 'versionNo', v_no, 'roomVersion', r.version, 'contentHash', md5(v_text)),
    jsonb_build_object('recapVersionId', v_id, 'versionNo', v_no));
  insert into public.fixture_recap_versions (id, room_id, version_no, room_version, content, content_text, content_hash, published_by_party_id, published_by_user_id, published_event_id)
  values (v_id, r.id, v_no, r.version, v_content, v_text, md5(v_text), acting.id, v_actor, (v_first->>'eventId')::bigint);
  return v_first;
end $$;
revoke all on function public.publish_fixture_recap(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.publish_fixture_recap(uuid, integer, text, uuid) to authenticated, service_role;

-- ── acknowledge_fixture_recap ───────────────────────────────────────────────
create or replace function public.acknowledge_fixture_recap(
  p_room_id uuid, p_recap_version_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties; rv public.fixture_recap_versions;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'acknowledge_fixture_recap', 'recap', p_recap_version_id, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('negotiating', 'on_subjects', 'fixed') then
    raise exception 'FX_STATE: recaps cannot be acknowledged while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);
  select * into rv from public.fixture_recap_versions x where x.id = p_recap_version_id and x.room_id = r.id;
  if rv.id is null then
    raise exception 'FX_NOT_FOUND: recap version not found in this room' using errcode = 'P0002';
  end if;
  if rv.invalidated_at is not null then
    raise exception 'FX_STATE: recap v% was superseded by a later change — acknowledge the current version', rv.version_no using errcode = '55000';
  end if;
  if exists (select 1 from public.fixture_events e where e.room_id = r.id and e.type = 'recap.acknowledged'
              and e.payload->>'recapVersionId' = rv.id::text and coalesce(e.on_behalf_of_party_id, e.actor_party_id) = rep.id) then
    raise exception 'FX_STATE: your side already acknowledged recap v%', rv.version_no using errcode = '55000';
  end if;
  return public.fn_fixture_event(r.id, 'recap.acknowledged', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'acknowledge_fixture_recap', p_idempotency_key, v_hash,
    jsonb_build_object('recapVersionId', rv.id, 'versionNo', rv.version_no, 'side', rep.side, 'label', rep.display_label),
    jsonb_build_object('recapVersionId', rv.id, 'versionNo', rv.version_no));
end $$;
revoke all on function public.acknowledge_fixture_recap(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.acknowledge_fixture_recap(uuid, uuid, integer, text, uuid, uuid) to authenticated, service_role;

-- ── post_fixture_message ────────────────────────────────────────────────────
create or replace function public.post_fixture_message(
  p_room_id uuid, p_body text, p_kind text, p_visibility text, p_term_id uuid, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; v_mid uuid; v_first jsonb; v_kind text; v_vis text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'post_fixture_message', 'body', p_body, 'kind', p_kind, 'visibility', p_visibility, 'term', p_term_id, 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if public.fn_fixture_terminal(r.status) then
    raise exception 'FX_STATE: the room is %', r.status using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  v_kind := coalesce(p_kind, 'note'); v_vis := coalesce(p_visibility, 'room');
  if v_kind not in ('note', 'nudge', 'ack') then
    raise exception 'FX_VALIDATION: kind must be note, nudge or ack' using errcode = '22023';
  end if;
  if v_vis not in ('room', 'side', 'mediator') then
    raise exception 'FX_VALIDATION: visibility must be room, side or mediator' using errcode = '22023';
  end if;
  if v_vis = 'side' and acting.side not in ('cargo', 'vessel') then
    raise exception 'FX_AUTH: side-private messages belong to a side' using errcode = '42501';
  end if;
  if v_vis = 'mediator' and not (acting.side = 'mediator' or public.fn_is_admin()) then
    raise exception 'FX_AUTH: mediator-private messages are for the mediator' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_body)), 0) not between 1 and 4000 then
    raise exception 'FX_VALIDATION: message must be 1–4000 characters' using errcode = '22023';
  end if;
  if p_term_id is not null and not exists (select 1 from public.fixture_terms t where t.id = p_term_id and t.room_id = r.id) then
    raise exception 'FX_NOT_FOUND: term not found in this room' using errcode = 'P0002';
  end if;
  v_mid := gen_random_uuid();
  v_first := public.fn_fixture_event(r.id, 'message.posted', v_actor, acting.id, null, false, 'post_fixture_message', p_idempotency_key, v_hash,
    jsonb_build_object('messageId', v_mid, 'kind', v_kind, 'visibility', v_vis, 'termId', p_term_id, 'side', acting.side),
    jsonb_build_object('messageId', v_mid));
  insert into public.fixture_messages (id, room_id, party_id, author_user_id, kind, visibility, term_id, body, event_id)
  values (v_mid, r.id, acting.id, v_actor, v_kind, v_vis, p_term_id, btrim(p_body), (v_first->>'eventId')::bigint);
  return v_first;
end $$;
revoke all on function public.post_fixture_message(uuid, text, text, text, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.post_fixture_message(uuid, text, text, text, uuid, integer, text, uuid) to authenticated, service_role;

-- ── agree_fixture_disclosure (decision D2) ──────────────────────────────────
create or replace function public.agree_fixture_disclosure(
  p_room_id uuid, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties; v_first jsonb; v_all boolean;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'agree_fixture_disclosure', 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if public.fn_fixture_terminal(r.status) then
    raise exception 'FX_STATE: the room is %', r.status using errcode = '55000';
  end if;
  if r.counterparty_disclosed_at is not null then
    raise exception 'FX_STATE: the counterparty is already disclosed' using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);
  if rep.capacity <> 'principal' then
    raise exception 'FX_AUTH: only a principal can agree to disclosure' using errcode = '42501';
  end if;
  if rep.disclosure_agreed_at is not null then
    raise exception 'FX_STATE: your side already agreed to disclosure' using errcode = '55000';
  end if;
  update public.fixture_parties set disclosure_agreed_at = now(), disclosure_agreed_by_user_id = v_actor where id = rep.id;
  v_first := public.fn_fixture_event(r.id, 'party.disclosure_agreed', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'agree_fixture_disclosure', p_idempotency_key, v_hash,
    jsonb_build_object('partyId', rep.id, 'side', rep.side, 'label', rep.display_label),
    jsonb_build_object('partyId', rep.id, 'disclosed', false));
  select not exists (
    select 1 from unnest(array['cargo', 'vessel']) x
     where not exists (select 1 from public.fixture_parties p where p.room_id = r.id and p.side = x and p.capacity = 'principal' and p.status = 'active' and p.disclosure_agreed_at is not null))
    into v_all;
  if v_all then
    update public.fixture_rooms set counterparty_disclosed_at = now() where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.counterparty_disclosed', v_actor, acting.id, null, false, 'agree_fixture_disclosure', p_idempotency_key, v_hash,
      jsonb_build_object('disclosedAt', now()), null);
  end if;
  return (v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id)))
         || jsonb_build_object('data', jsonb_build_object('partyId', rep.id, 'disclosed', v_all));
end $$;
revoke all on function public.agree_fixture_disclosure(uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.agree_fixture_disclosure(uuid, integer, text, uuid, uuid) to authenticated, service_role;

-- ── close_fixture_room ──────────────────────────────────────────────────────
create or replace function public.close_fixture_room(
  p_room_id uuid, p_reason text, p_note text, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties; v_first jsonb; v_admin boolean;
begin
  v_actor := public.fn_fixture_actor();
  v_admin := public.fn_is_admin();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'close_fixture_room', 'reason', p_reason, 'note', p_note, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if public.fn_fixture_terminal(r.status) then
    raise exception 'FX_STATE: the room is already %', r.status using errcode = '55000';
  end if;
  if r.status = 'fixed' then
    raise exception 'FX_STATE: a fixed room cannot be closed' using errcode = '55000';
  end if;
  if p_reason not in ('withdrawn', 'failed', 'expired') then
    raise exception 'FX_VALIDATION: reason must be withdrawn, failed or expired' using errcode = '22023';
  end if;
  if coalesce(length(p_note), 0) > 500 then
    raise exception 'FX_VALIDATION: note must be at most 500 characters' using errcode = '22023';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if p_reason = 'withdrawn' then
    rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);   -- a side withdraws (the mediator only on behalf of a relayed side)
  else
    rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
    if not (acting.side = 'mediator' or v_admin) then
      raise exception 'FX_AUTH: only the mediator can mark a room failed or expired' using errcode = '42501';
    end if;
  end if;
  if rep.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot close a room' using errcode = '42501';
  end if;
  update public.fixture_rooms
     set status = p_reason, closed_at = now(), closed_reason = p_reason, closed_by_user_id = v_actor, closed_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = r.id;
  v_first := public.fn_fixture_event(r.id, 'room.closed', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'close_fixture_room', p_idempotency_key, v_hash,
    jsonb_build_object('reason', p_reason, 'note', nullif(btrim(coalesce(p_note, '')), ''), 'previousStatus', r.status, 'bySide', rep.side),
    jsonb_build_object('roomStatus', p_reason));
  if r.status = 'on_subjects' then
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'IN', 'vessel_status', 'OPEN'), 'room ' || p_reason, v_actor, acting.id, p_idempotency_key, v_hash);
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'room ' || p_reason, p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.close_fixture_room(uuid, text, text, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.close_fixture_room(uuid, text, text, integer, text, uuid, uuid) to authenticated, service_role;

-- ── redact_fixture_message (admin policy) ───────────────────────────────────
create or replace function public.redact_fixture_message(p_room_id uuid, p_message_id uuid, p_reason text, p_expected_version integer, p_idempotency_key text)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; m public.fixture_messages; v_platform uuid; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  if not public.fn_is_admin() then
    raise exception 'FX_AUTH: redaction is an administrator action' using errcode = '42501';
  end if;
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'redact_fixture_message', 'message', p_message_id, 'reason', p_reason)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if coalesce(length(btrim(p_reason)), 0) not between 4 and 500 then
    raise exception 'FX_VALIDATION: a reason of 4–500 characters is required' using errcode = '22023';
  end if;
  select * into m from public.fixture_messages x where x.id = p_message_id and x.room_id = r.id;
  if m.id is null then
    raise exception 'FX_NOT_FOUND: message not found in this room' using errcode = 'P0002';
  end if;
  if m.redacted_at is not null then
    raise exception 'FX_STATE: the message is already redacted' using errcode = '55000';
  end if;
  select p.id into v_platform from public.fixture_parties p where p.room_id = r.id and p.is_platform;
  v_first := public.fn_fixture_event(r.id, 'message.redacted', v_actor, v_platform, null, false, 'redact_fixture_message', p_idempotency_key, v_hash,
    jsonb_build_object('messageId', m.id, 'reason', btrim(p_reason)), jsonb_build_object('messageId', m.id));
  update public.fixture_messages set redacted_at = now(), redacted_by_user_id = v_actor, redacted_event_id = (v_first->>'eventId')::bigint where id = m.id;
  return v_first;
end $$;
revoke all on function public.redact_fixture_message(uuid, uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.redact_fixture_message(uuid, uuid, text, integer, text) to authenticated, service_role;

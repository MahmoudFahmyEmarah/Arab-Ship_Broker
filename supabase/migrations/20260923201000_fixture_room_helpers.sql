-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · Phase 1 · helpers (23 Sep 2026, architecture version 1.0)
--
-- Internal functions the governed RPCs (20260923202000 reads, 20260923203000
-- commands) are built from. None of them is granted to members: they run
-- only from the RPCs, which are SECURITY DEFINER and owned by postgres.
--
--   identity     fn_fixture_actor · fn_fixture_user_from_auth · fn_fixture_member_org_ids
--   entitlement  fn_fixture_tier_ok · fn_fixture_listing_owner · fn_fixture_owns_listing ·
--                fn_fixture_listing_live
--   catalogue    fn_fixture_term_catalogue (the versioned term sheet, audit FR-H2)
--   parties      fn_fixture_actor_parties · fn_can_access_fixture ·
--                fn_fixture_acting_party · fn_fixture_represented_party ·
--                fn_fixture_resolve_counterparty
--   snapshots    fn_fixture_snapshot_cargo · fn_fixture_snapshot_vessel (no PII)
--   ledger       fn_fixture_lock · fn_fixture_check_version · fn_fixture_replay ·
--                fn_fixture_event
--   values       fn_fixture_validate_value · fn_fixture_display_value
--   masking      fn_fixture_party_name · fn_fixture_party_desk · fn_fixture_party_json ·
--                fn_fixture_event_json · fn_fixture_capabilities
--   recap        fn_fixture_recap_build · fn_fixture_recap_text · fn_fixture_listing_sync
--
-- Error convention (decision D6): standard SQLSTATE classes with stable
-- FX_*: message prefixes —
--   FX_AUTH 42501 · FX_STATE 55000 · FX_VERSION_CONFLICT 55000 (never 40001: PostgREST retries it) ·
--   FX_IDEMPOTENCY_MISMATCH P0001 · FX_VALIDATION 22023 · FX_NOT_FOUND P0002 ·
--   FX_CONFLICT 23505 · FX_GATE 42501 · FX_IMMUTABLE 55000 (trigger)
--
-- Idempotent. DOWN: supabase/rollback/20260923_fixture_room_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── identity ────────────────────────────────────────────────────────────────
create or replace function public.fn_fixture_actor()
 returns uuid language plpgsql stable security definer set search_path to 'public'
as $$
declare v uuid; v_active boolean;
begin
  v := public.fn_app_user_id();
  if v is null then
    raise exception 'FX_AUTH: sign in to use the Fixture Room' using errcode = '42501';
  end if;
  -- An inactive account is no actor. Account erasure (integration INT-H1)
  -- keeps the users row as an anonymous tombstone with is_active = false so
  -- the ledgers' foreign keys hold; whatever token that account still holds
  -- must not read, poll, answer or create as its former party.
  select u.is_active into v_active from public.users u where u.id = v;
  if coalesce(v_active, false) is not true then
    raise exception 'FX_AUTH: this account is not active' using errcode = '42501';
  end if;
  return v;
end $$;
revoke all on function public.fn_fixture_actor() from public, anon, authenticated;

create or replace function public.fn_fixture_user_from_auth(p_auth uuid)
 returns uuid language sql stable security definer set search_path to 'public'
as $$
  select u.id from public.users u
   where p_auth is not null and (u.supabase_user_id = p_auth or u.id = p_auth)
   order by (u.supabase_user_id = p_auth) desc limit 1;
$$;
revoke all on function public.fn_fixture_user_from_auth(uuid) from public, anon, authenticated;

-- The organisations a member acts for: a CURRENT and ACTIVE seat, both (the
-- Phase 0 review requires both; the shared fn_my_org_ids() checks is_current
-- only — audit FR-M1). Defaults to the signed-in member.
create or replace function public.fn_fixture_member_org_ids(p_user uuid default null)
 returns uuid[] language sql stable security definer set search_path to 'public'
as $$
  select coalesce(array_agg(m.org_id), '{}'::uuid[]) from public.organization_members m
   where m.user_id = coalesce(p_user, public.fn_app_user_id()) and m.is_current and m.status = 'active';
$$;
revoke all on function public.fn_fixture_member_org_ids(uuid) from public, anon, authenticated;
-- (fn_fixture_active_org, which guessed an organisation from the member's
-- first seat, is gone: audit FR-H1. Identity comes from the ownership row.)
drop function if exists public.fn_fixture_active_org(uuid);

-- ── entitlement ─────────────────────────────────────────────────────────────
-- Decision D3: creation needs T3+, market-partner status or admin. The
-- market-partner flag is read through to_jsonb so a database without that
-- column (the baseline has none) simply answers false instead of failing.
create or replace function public.fn_fixture_tier_ok()
 returns boolean language plpgsql stable security definer set search_path to 'public'
as $$
declare j jsonb;
begin
  if public.fn_is_admin() then return true; end if;
  select to_jsonb(u) into j from public.users u where u.id = public.fn_app_user_id();
  if j is null then return false; end if;
  return coalesce(j->>'subscription_tier', '') in ('T3', 'T4')
      or coalesce(j->>'is_market_partner', 'false') = 'true';
end $$;
revoke all on function public.fn_fixture_tier_ok() from public, anon, authenticated;

-- The exact current primary ownership row of a listing: the organisation it is
-- owned through (if any) and the member behind it as public.users.id.
create or replace function public.fn_fixture_listing_owner(p_type text, p_listing_id uuid)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select jsonb_build_object('org_id', lo.owner_org_id, 'user_id', public.fn_fixture_user_from_auth(lo.owner_user_id))
    from public.listing_ownership lo
   where lo.listing_type = p_type::public.listing_type_enum and lo.listing_id = p_listing_id
     and lo.is_current and lo.role = 'primary'
   order by lo.owned_from desc limit 1;
$$;
revoke all on function public.fn_fixture_listing_owner(text, uuid) from public, anon, authenticated;

-- The identity the actor represents a listing AS, derived from that ownership
-- row and nothing else (audit FR-H1): the owning organisation when the actor
-- holds a current active seat in that exact organisation; the actor personally
-- when the listing is owned personally by the actor. Null when the actor does
-- not own it. An organisation is never inferred from the owner's other seats.
-- (The return type changed from boolean; the old signature is dropped first so
-- a re-apply never fails on it.)
drop function if exists public.fn_fixture_owns_listing(text, uuid);
create or replace function public.fn_fixture_owns_listing(p_type text, p_listing_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare o jsonb; v_actor uuid := public.fn_app_user_id();
begin
  if v_actor is null then return null; end if;
  o := public.fn_fixture_listing_owner(p_type, p_listing_id);
  if o is null then return null; end if;
  if (o->>'org_id') is not null then
    if (o->>'org_id')::uuid = any (public.fn_fixture_member_org_ids(v_actor)) then
      return jsonb_build_object('org_id', (o->>'org_id')::uuid);
    end if;
    return null;
  end if;
  if (o->>'user_id')::uuid = v_actor then
    return jsonb_build_object('user_id', v_actor);
  end if;
  return null;
end $$;
revoke all on function public.fn_fixture_owns_listing(text, uuid) from public, anon, authenticated;

create or replace function public.fn_fixture_listing_live(p_type text, p_listing_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select case p_type
    when 'cargo' then exists (select 1 from public.cargo_listings c where c.id = p_listing_id
                               and c.review_status = 'APPROVED' and c.status in ('IN', 'PARTIAL'))
    when 'vessel_availability' then exists (select 1 from public.vessel_availability va where va.id = p_listing_id
                               and va.review_status = 'APPROVED' and va.status = 'OPEN')
    else false end;
$$;
revoke all on function public.fn_fixture_listing_live(text, uuid) from public, anon, authenticated;

-- ── the term catalogue, version by version (decision D5, audit FR-H2) ───────
-- TypeScript owns the product catalogue (lib/fixture-room/terms.ts); the
-- database holds the same definitions per version so create_fixture_room can
-- refuse anything else. scripts/fixture-room-check.ts proves the two agree
-- (it reads the JSON between the two marker lines below). Unknown → null.
create or replace function public.fn_fixture_term_catalogue(p_version text)
 returns jsonb language sql immutable set search_path to ''
as $$
  select case p_version
    when '2026-09-23.v1' then
      -- FIXTURE_TERM_CATALOGUE_JSON_BEGIN 2026-09-23.v1
      $j$[
        {"code":"cargo_grade","label":"Cargo & grade","category":"cargo","sortOrder":1,"valueKind":"text","required":true},
        {"code":"quantity","label":"Quantity","category":"cargo","sortOrder":2,"valueKind":"number","unit":"MT","required":true},
        {"code":"ports","label":"Load / discharge ports","category":"route","sortOrder":3,"valueKind":"port_pair","required":true},
        {"code":"laycan","label":"Laycan","category":"timing","sortOrder":4,"valueKind":"date_range","required":true},
        {"code":"ld_rates","label":"Load / discharge rates","category":"operations","sortOrder":5,"valueKind":"rate_pair","unit":"MT/day","required":true},
        {"code":"freight","label":"Freight & terms","category":"money","sortOrder":6,"valueKind":"money_per_mt","unit":"USD/MT","required":true}
      ]$j$::jsonb
      -- FIXTURE_TERM_CATALOGUE_JSON_END
    else null end;
$$;
revoke all on function public.fn_fixture_term_catalogue(text) from public, anon, authenticated;

-- ── snapshots (allow-listed columns only; never contact PII) ────────────────
create or replace function public.fn_fixture_snapshot_cargo(p_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare j jsonb;
begin
  select to_jsonb(c) into j from public.cargo_listings c where c.id = p_id;
  if j is null then return null; end if;
  return jsonb_build_object(
    'id', j->'id', 'ref', j->'ref', 'status', j->'status', 'review_status', j->'review_status',
    'cargo_type', j->'cargo_type', 'commodity_id', j->'commodity_id', 'commodity_name', j->'commodity_name',
    'commodity_category', j->'commodity_category', 'is_dg_cargo', j->'is_dg_cargo', 'is_grain_cargo', j->'is_grain_cargo',
    'qty_min_mt', j->'qty_min_mt', 'qty_max_mt', j->'qty_max_mt', 'stowage_factor', j->'stowage_factor',
    'volume_cbm', j->'volume_cbm', 'volume_m3', j->'volume_m3',
    'load_port_locode', j->'load_port_locode', 'load_port_name', j->'load_port_name', 'load_zone', j->'load_zone',
    'load_country', j->'load_country', 'load_ports', j->'load_ports', 'load_port_scope', j->'load_port_scope', 'load_ref_locode', j->'load_ref_locode',
    'disch_port_locode', j->'disch_port_locode', 'disch_port_name', j->'disch_port_name', 'disch_zone', j->'disch_zone',
    'disch_country', j->'disch_country', 'disch_ports', j->'disch_ports', 'disch_port_scope', j->'disch_port_scope', 'disch_ref_locode', j->'disch_ref_locode',
    'laycan_from', j->'laycan_from', 'laycan_to', j->'laycan_to', 'is_spot', j->'is_spot')
  -- (jsonb_build_object takes at most 100 arguments; the row is split in two)
  || jsonb_build_object(
    'load_rate', j->'load_rate', 'disch_rate', j->'disch_rate', 'load_terms', j->'load_terms',
    'laytime_basis', j->'laytime_basis', 'laytime_structure', j->'laytime_structure', 'laytime_qualifier', j->'laytime_qualifier',
    'nor_clause', j->'nor_clause', 'freight_idea_usd_mt', j->'freight_idea_usd_mt', 'freight_basis', j->'freight_basis',
    'commission_pct', j->'commission_pct', 'commission_ttl_pct', j->'commission_ttl_pct',
    'demurrage_rate', j->'demurrage_rate', 'despatch_rate', j->'despatch_rate', 'despatch_basis', j->'despatch_basis',
    'tolerance_pct', j->'tolerance_pct', 'tolerance_holder', j->'tolerance_holder',
    'requires_geared', j->'requires_geared', 'max_vessel_age_yr', j->'max_vessel_age_yr',
    'max_loa_m', j->'max_loa_m', 'max_draft_m', j->'max_draft_m',
    'packaging_type', j->'packaging_type', 'bag_weight_kg', j->'bag_weight_kg', 'is_wog', j->'is_wog',
    'created_at', j->'created_at', 'updated_at', j->'updated_at');
end $$;
revoke all on function public.fn_fixture_snapshot_cargo(uuid) from public, anon, authenticated;

create or replace function public.fn_fixture_snapshot_vessel(p_availability_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare a jsonb; v jsonb;
begin
  select to_jsonb(va) into a from public.vessel_availability va where va.id = p_availability_id;
  if a is null then return null; end if;
  select to_jsonb(ve) into v from public.vessels ve where ve.id = (a->>'vessel_id')::uuid;
  return jsonb_build_object(
    'availability', jsonb_build_object(
      'id', a->'id', 'ref', a->'ref', 'vessel_id', a->'vessel_id', 'status', a->'status', 'review_status', a->'review_status',
      'open_port_locode', a->'open_port_locode', 'open_port_name', a->'open_port_name', 'open_zone', a->'open_zone',
      'open_date', a->'open_date', 'open_date_range_days', a->'open_date_range_days',
      'ballast_port_locode', a->'ballast_port_locode', 'ballast_port_name', a->'ballast_port_name',
      'last_cargo', a->'last_cargo', 'service_speed_kn', a->'service_speed_kn',
      'me_consumption_mt_day', a->'me_consumption_mt_day', 'aux_consumption_mt_day', a->'aux_consumption_mt_day',
      'me_consumption_port_mt_day', a->'me_consumption_port_mt_day', 'aux_consumption_port_mt_day', a->'aux_consumption_port_mt_day',
      'vlsfo_sea_mt_day', a->'vlsfo_sea_mt_day', 'lsmgo_sea_mt_day', a->'lsmgo_sea_mt_day',
      'vlsfo_port_mt_day', a->'vlsfo_port_mt_day', 'lsmgo_port_mt_day', a->'lsmgo_port_mt_day',
      'fuel_type', a->'fuel_type', 'freight_idea_usd_mt', a->'freight_idea_usd_mt', 'commission_pct', a->'commission_pct',
      'accepts_part_cargo', a->'accepts_part_cargo', 'grab_type', a->'grab_type', 'grab_capacity_mt', a->'grab_capacity_mt',
      'num_grabs', a->'num_grabs', 'brob_mt', a->'brob_mt', 'charter_type', a->'charter_type', 'is_wog', a->'is_wog',
      'next_direction', a->'next_direction', 'trading_zones', a->'trading_zones',
      'scrubber_fitted', a->'scrubber_fitted', 'eca_compliant', a->'eca_compliant',
      'eta_port_locode', a->'eta_port_locode', 'eta_date', a->'eta_date',
      'created_at', a->'created_at', 'updated_at', a->'updated_at'),
    'vessel', jsonb_build_object(
      'id', v->'id', 'vessel_name', v->'vessel_name', 'imo_number', v->'imo_number', 'vessel_type', v->'vessel_type',
      'dwt_grain', v->'dwt_grain', 'dwt_bale', v->'dwt_bale', 'dwcc', v->'dwcc', 'grain_cbm', v->'grain_cbm', 'bale_cbm', v->'bale_cbm',
      'gross_tonnage', v->'gross_tonnage', 'scnrt', v->'scnrt', 'build_year', v->'build_year', 'flag', v->'flag',
      'flag_category', v->'flag_category', 'scope', v->'scope', 'risk_level', v->'risk_level', 'preferred_zones', v->'preferred_zones',
      'is_geared', v->'is_geared', 'crane_count', v->'crane_count', 'crane_swl_mt', v->'crane_swl_mt',
      'grain_certified', v->'grain_certified', 'dg_certified', v->'dg_certified',
      'max_loa_m', v->'max_loa_m', 'max_draft_m', v->'max_draft_m', 'beam_m', v->'beam_m',
      'num_holds', v->'num_holds', 'num_hatches', v->'num_hatches', 'box_shaped', v->'box_shaped', 'hatch_type', v->'hatch_type',
      'strengthened_heavy', v->'strengthened_heavy', 'class_society', v->'class_society', 'vessel_config', v->'vessel_config',
      'is_sanctioned', v->'is_sanctioned', 'is_tbn', v->'is_tbn', 'is_verified', v->'is_verified'));
end $$;
revoke all on function public.fn_fixture_snapshot_vessel(uuid) from public, anon, authenticated;

-- ── counterparty resolution (amendment A1) ──────────────────────────────────
-- Who is behind the OTHER listing: a registered organisation with a seat
-- (direct), a registered member (direct), an organisation without any seat
-- (relayed), the listing's contact record (relayed), or nothing resolvable —
-- an unresolved party anchored to the listing (relayed). A listing owned by a
-- platform admin is platform-synced: the platform relays it. The organisation
-- is the one on the ownership row, never a seat the owner happens to hold
-- (audit FR-H1): a personally owned listing is represented by the member.
create or replace function public.fn_fixture_resolve_counterparty(p_type text, p_listing_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_auth uuid; v_user uuid; v_org uuid; v_contact uuid; v_role text;
begin
  select lo.owner_user_id, lo.owner_org_id into v_auth, v_org
    from public.listing_ownership lo
   where lo.listing_type = p_type::public.listing_type_enum and lo.listing_id = p_listing_id
     and lo.is_current and lo.role = 'primary'
   order by lo.owned_from desc limit 1;
  if v_auth is not null then
    v_user := public.fn_fixture_user_from_auth(v_auth);
    if v_user is not null then
      select lower(coalesce(u.role, '')) into v_role from public.users u where u.id = v_user;
      if v_role like '%admin%' then v_user := null; v_org := null; end if;   -- platform-synced listing
    end if;
  end if;
  if v_org is not null then
    if exists (select 1 from public.organization_members m where m.org_id = v_org and m.is_current and m.status = 'active') then
      return jsonb_build_object('mode', 'direct', 'org_id', v_org);
    end if;
    return jsonb_build_object('mode', 'relayed', 'org_id', v_org);
  end if;
  if v_user is not null then
    return jsonb_build_object('mode', 'direct', 'user_id', v_user);
  end if;
  if p_type = 'cargo' then
    select coalesce(c.broker_contact_id, c.source_contact_id) into v_contact from public.cargo_listings c where c.id = p_listing_id;
  else
    select va.source_contact_id into v_contact from public.vessel_availability va where va.id = p_listing_id;
  end if;
  if v_contact is not null and exists (select 1 from public.contacts k where k.id = v_contact and k.erased_at is null) then
    return jsonb_build_object('mode', 'relayed', 'contact_id', v_contact);
  end if;
  return jsonb_build_object('mode', 'relayed', 'anchor', true);
end $$;
revoke all on function public.fn_fixture_resolve_counterparty(text, uuid) from public, anon, authenticated;

-- ── parties the actor may act as ────────────────────────────────────────────
create or replace function public.fn_fixture_actor_parties(p_room_id uuid)
 returns setof public.fixture_parties language plpgsql stable security definer set search_path to 'public'
as $$
declare v_actor uuid := public.fn_app_user_id(); v_admin boolean := public.fn_is_admin(); v_orgs uuid[] := public.fn_fixture_member_org_ids();
begin
  return query
    select p.* from public.fixture_parties p
     where p.room_id = p_room_id
       and p.status in ('invited', 'active')
       and p.participation_mode = 'direct'
       and ((p.org_id is not null and p.org_id = any (v_orgs))
            or (p.user_id is not null and p.user_id = v_actor)
            or (p.is_platform and v_admin))
     order by (p.capacity = 'principal') desc, (p.capacity = 'broker') desc, p.is_platform, p.created_at;
end $$;
revoke all on function public.fn_fixture_actor_parties(uuid) from public, anon, authenticated;

create or replace function public.fn_can_access_fixture(p_room_id uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $$
  select public.fn_is_admin() or exists (select 1 from public.fn_fixture_actor_parties(p_room_id));
$$;
revoke all on function public.fn_can_access_fixture(uuid) from public, anon, authenticated;

create or replace function public.fn_fixture_acting_party(p_room_id uuid, p_as_party_id uuid)
 returns public.fixture_parties language plpgsql stable security definer set search_path to 'public'
as $$
declare v_parties public.fixture_parties[]; v_p public.fixture_parties; v_chosen public.fixture_parties;
begin
  select array_agg(p order by (p.capacity = 'principal') desc, (p.capacity = 'broker') desc, p.is_platform, p.created_at)
    into v_parties from public.fn_fixture_actor_parties(p_room_id) p;
  if v_parties is null or array_length(v_parties, 1) = 0 then
    raise exception 'FX_AUTH: you are not a participant in this room' using errcode = '42501';
  end if;
  if p_as_party_id is not null then
    foreach v_p in array v_parties loop
      if v_p.id = p_as_party_id then v_chosen := v_p; end if;
    end loop;
    if v_chosen.id is null then
      raise exception 'FX_AUTH: you cannot act as that party' using errcode = '42501';
    end if;
  else
    foreach v_p in array v_parties loop
      if v_chosen.id is null and v_p.status = 'active' then v_chosen := v_p; end if;
    end loop;
    if v_chosen.id is null then v_chosen := v_parties[1]; end if;
  end if;
  if v_chosen.status <> 'active' then
    raise exception 'FX_STATE: accept the invitation before acting in this room' using errcode = '55000';
  end if;
  return v_chosen;
end $$;
revoke all on function public.fn_fixture_acting_party(uuid, uuid) from public, anon, authenticated;

create or replace function public.fn_fixture_represented_party(p_acting public.fixture_parties, p_on_behalf_of_party_id uuid)
 returns public.fixture_parties language plpgsql stable security definer set search_path to 'public'
as $$
declare t public.fixture_parties;
begin
  if p_on_behalf_of_party_id is null then
    if p_acting.side = 'mediator' then
      raise exception 'FX_VALIDATION: the mediator must name the party it is acting for' using errcode = '22023';
    end if;
    if p_acting.capacity = 'viewer' then
      raise exception 'FX_AUTH: viewers cannot make commercial commands' using errcode = '42501';
    end if;
    return p_acting;
  end if;
  if not (p_acting.side = 'mediator' and p_acting.capacity = 'broker') then
    raise exception 'FX_AUTH: only the mediator may act on behalf of a relayed party' using errcode = '42501';
  end if;
  select * into t from public.fixture_parties p where p.id = p_on_behalf_of_party_id and p.room_id = p_acting.room_id;
  if t.id is null or t.status <> 'active' or t.participation_mode <> 'relayed' or t.side not in ('cargo', 'vessel') then
    raise exception 'FX_AUTH: that party is not a relayed party of this room' using errcode = '42501';
  end if;
  return t;
end $$;
revoke all on function public.fn_fixture_represented_party(public.fixture_parties, uuid) from public, anon, authenticated;

-- ── ledger primitives ───────────────────────────────────────────────────────
create or replace function public.fn_fixture_lock(p_room_id uuid)
 returns public.fixture_rooms language plpgsql volatile security definer set search_path to 'public'
as $$
declare r public.fixture_rooms;
begin
  if p_room_id is null then
    raise exception 'FX_VALIDATION: room id is required' using errcode = '22023';
  end if;
  select * into r from public.fixture_rooms where id = p_room_id for update;
  if r.id is null then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  return r;
end $$;
revoke all on function public.fn_fixture_lock(uuid) from public, anon, authenticated;

create or replace function public.fn_fixture_check_version(p_room public.fixture_rooms, p_expected integer)
 returns void language plpgsql immutable set search_path to ''
as $$
begin
  if p_expected is null then
    raise exception 'FX_VALIDATION: expected_version is required' using errcode = '22023';
  end if;
  if p_room.version <> p_expected then
    -- 55000, deliberately not 40001: PostgREST retries a request that fails with a
    -- serialization failure (40001 / 40P01), so a version conflict raised with
    -- 40001 spins until the gateway times out instead of reaching the client.
    raise exception 'FX_VERSION_CONFLICT: the room is at version % (you sent %) — refresh and try again', p_room.version, p_expected
      using errcode = '55000';
  end if;
end $$;
revoke all on function public.fn_fixture_check_version(public.fixture_rooms, integer) from public, anon, authenticated;

create or replace function public.fn_fixture_replay(p_room_id uuid, p_key text, p_hash text)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare e public.fixture_events; v_seq integer; v_n integer;
begin
  if p_key is null or btrim(p_key) = '' or length(p_key) > 200 then
    raise exception 'FX_VALIDATION: idempotency_key is required (1–200 characters)' using errcode = '22023';
  end if;
  -- The command's events share the key. Every one of them must carry the
  -- request hash; the RESULT-bearing event carries the envelope (an
  -- observation such as proposal.lapsed may precede it — audit FR-M2); the
  -- last carries the final version.
  select count(*), max(x.seq) into v_n, v_seq from public.fixture_events x where x.room_id = p_room_id and x.idempotency_key = p_key;
  if coalesce(v_n, 0) = 0 then return null; end if;
  if exists (select 1 from public.fixture_events x where x.room_id = p_room_id and x.idempotency_key = p_key and x.request_hash is distinct from p_hash) then
    raise exception 'FX_IDEMPOTENCY_MISMATCH: idempotency key % was already used with different arguments', p_key using errcode = 'P0001';
  end if;
  select * into e from public.fixture_events x where x.room_id = p_room_id and x.idempotency_key = p_key
   order by (x.result is not null) desc, x.seq limit 1;
  return jsonb_build_object('ok', true, 'version', v_seq, 'eventId', e.id, 'replayed', true, 'data', coalesce(e.result, '{}'::jsonb));
end $$;
revoke all on function public.fn_fixture_replay(uuid, text, text) from public, anon, authenticated;

-- Appends one event under the caller's room lock, bumps the version and
-- returns the result envelope. Every event a command writes carries the
-- command's idempotency key and request hash; exactly one carries the
-- result (fn_fixture_replay reads the result from that one and the final
-- version from the last).
create or replace function public.fn_fixture_event(
  p_room_id uuid, p_type text, p_actor_user uuid, p_actor_party uuid, p_on_behalf uuid, p_relayed boolean,
  p_command text, p_key text, p_hash text, p_payload jsonb, p_result jsonb)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_seq integer; v_id bigint;
begin
  update public.fixture_rooms set version = version + 1, updated_at = now() where id = p_room_id returning version into v_seq;
  if v_seq is null then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  insert into public.fixture_events (room_id, seq, type, actor_user_id, actor_party_id, on_behalf_of_party_id, relayed, command, idempotency_key, request_hash, payload, result)
  values (p_room_id, v_seq, p_type, p_actor_user, p_actor_party, p_on_behalf, coalesce(p_relayed, false), p_command, p_key, p_hash, coalesce(p_payload, '{}'::jsonb), p_result)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'version', v_seq, 'eventId', v_id, 'replayed', false, 'data', coalesce(p_result, '{}'::jsonb));
end $$;
revoke all on function public.fn_fixture_event(uuid, text, uuid, uuid, uuid, boolean, text, text, text, jsonb, jsonb) from public, anon, authenticated;

-- ── term values ─────────────────────────────────────────────────────────────
create or replace function public.fn_fixture_validate_value(p_kind text, p_value jsonb)
 returns jsonb language plpgsql immutable set search_path to ''
as $$
declare v jsonb := coalesce(p_value, '{}'::jsonb); n numeric; a numeric; b numeric; d1 date; d2 date; t text; cur text;
begin
  if jsonb_typeof(v) <> 'object' then
    raise exception 'FX_VALIDATION: a term value must be an object' using errcode = '22023';
  end if;
  case p_kind
    when 'text' then
      t := btrim(coalesce(v->>'text', ''));
      if t = '' or length(t) > 500 then raise exception 'FX_VALIDATION: text value must be 1–500 characters' using errcode = '22023'; end if;
      return jsonb_build_object('text', t);
    when 'number' then
      begin n := (v->>'num')::numeric; exception when others then n := null; end;
      if n is null then raise exception 'FX_VALIDATION: number value must carry "num"' using errcode = '22023'; end if;
      return jsonb_build_object('num', n);
    when 'money_per_mt' then
      begin n := (v->>'num')::numeric; exception when others then n := null; end;
      if n is null or n < 0 then raise exception 'FX_VALIDATION: money value must carry a non-negative "num"' using errcode = '22023'; end if;
      cur := upper(coalesce(nullif(btrim(v->>'currency'), ''), 'USD'));
      if cur !~ '^[A-Z]{3}$' then raise exception 'FX_VALIDATION: currency must be a 3-letter code' using errcode = '22023'; end if;
      return jsonb_build_object('num', n, 'currency', cur);
    when 'rate_pair' then
      begin a := (v->>'load')::numeric; b := (v->>'disch')::numeric; exception when others then a := null; end;
      if a is null or b is null or a <= 0 or b <= 0 then raise exception 'FX_VALIDATION: rate pair must carry positive "load" and "disch"' using errcode = '22023'; end if;
      return jsonb_build_object('load', a, 'disch', b);
    when 'date_range' then
      if coalesce(v->>'spot', 'false') = 'true' then return jsonb_build_object('spot', true); end if;
      begin d1 := (v->>'from')::date; d2 := (v->>'to')::date; exception when others then d1 := null; end;
      if d1 is null or d2 is null or d2 < d1 then raise exception 'FX_VALIDATION: date range must carry "from" and "to" (to on or after from), or "spot": true' using errcode = '22023'; end if;
      return jsonb_build_object('from', d1, 'to', d2);
    when 'port_pair' then
      if btrim(coalesce(v->>'load', '')) = '' or btrim(coalesce(v->>'disch', '')) = '' then
        raise exception 'FX_VALIDATION: port pair must carry "load" and "disch"' using errcode = '22023';
      end if;
      return jsonb_build_object('load', upper(btrim(v->>'load')), 'disch', upper(btrim(v->>'disch')),
                                'load_name', nullif(btrim(coalesce(v->>'load_name', '')), ''), 'disch_name', nullif(btrim(coalesce(v->>'disch_name', '')), ''));
    else
      raise exception 'FX_VALIDATION: unknown value kind %', p_kind using errcode = '22023';
  end case;
end $$;
revoke all on function public.fn_fixture_validate_value(text, jsonb) from public, anon, authenticated;

create or replace function public.fn_fixture_display_value(p_kind text, p_value jsonb, p_unit text)
 returns text language plpgsql immutable set search_path to ''
as $$
declare v jsonb := coalesce(p_value, '{}'::jsonb);
begin
  case p_kind
    when 'text' then return v->>'text';
    when 'number' then return trim(to_char((v->>'num')::numeric, 'FM999,999,999,990.##')) || coalesce(' ' || nullif(p_unit, ''), '');
    when 'money_per_mt' then
      return case when coalesce(v->>'currency', 'USD') = 'USD' then '$' else coalesce(v->>'currency', 'USD') || ' ' end
             || trim(to_char((v->>'num')::numeric, 'FM999,999,990.00')) || '/MT';
    when 'rate_pair' then
      return trim(to_char((v->>'load')::numeric, 'FM999,999,990')) || ' / ' || trim(to_char((v->>'disch')::numeric, 'FM999,999,990')) || ' MT/day';
    when 'date_range' then
      if coalesce(v->>'spot', 'false') = 'true' then return 'SPOT'; end if;
      return to_char((v->>'from')::date, 'DD Mon') || ' – ' || to_char((v->>'to')::date, 'DD Mon YYYY');
    when 'port_pair' then
      return coalesce(v->>'load_name', v->>'load') || ' → ' || coalesce(v->>'disch_name', v->>'disch');
    else return v::text;
  end case;
end $$;
revoke all on function public.fn_fixture_display_value(text, jsonb, text) from public, anon, authenticated;

-- ── masking ─────────────────────────────────────────────────────────────────
-- The disclosed name is the trade / organisation name or a desk label. A
-- person's name, email or phone is never returned (decision D2).
create or replace function public.fn_fixture_party_name(p public.fixture_parties)
 returns text language plpgsql stable security definer set search_path to 'public'
as $$
declare v text; k public.contacts;
begin
  if p.is_platform then return 'Arab ShipBroker'; end if;
  if p.org_id is not null then
    select o.name into v from public.organizations o where o.id = p.org_id; return v;
  end if;
  if p.user_id is not null then
    select coalesce(nullif(btrim(u.company), ''), 'Registered member') into v from public.users u where u.id = p.user_id; return v;
  end if;
  if p.contact_id is not null then
    select * into k from public.contacts c where c.id = p.contact_id;
    if k.id is null or k.erased_at is not null then return 'Erased contact'; end if;
    if k.kind = 'desk' then return k.display_name; end if;
    if k.org_id is not null then select o.name into v from public.organizations o where o.id = k.org_id; return coalesce(v, 'External contact'); end if;
    return 'External contact';
  end if;
  return null;
end $$;
revoke all on function public.fn_fixture_party_name(public.fixture_parties) from public, anon, authenticated;

create or replace function public.fn_fixture_party_desk(p public.fixture_parties)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select o.desk_contact_name from public.organizations o
   where o.id = coalesce(p.org_id, (select k.org_id from public.contacts k where k.id = p.contact_id));
$$;
revoke all on function public.fn_fixture_party_desk(public.fixture_parties) from public, anon, authenticated;

create or replace function public.fn_fixture_party_json(
  p public.fixture_parties, p_viewer_party_ids uuid[], p_viewer_side text, p_disclosed boolean, p_unmasked boolean)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_reveal boolean; j jsonb;
begin
  v_reveal := coalesce(p_unmasked, false) or p.is_platform or p.id = any (coalesce(p_viewer_party_ids, '{}'::uuid[]))
              or (p_viewer_side is not null and p.side = p_viewer_side) or coalesce(p_disclosed, false);
  j := jsonb_build_object(
    'id', p.id, 'side', p.side, 'capacity', p.capacity, 'participationMode', p.participation_mode,
    'status', p.status, 'isPlatform', p.is_platform, 'label', p.display_label,
    'isViewer', p.id = any (coalesce(p_viewer_party_ids, '{}'::uuid[])),
    'disclosureAgreed', p.disclosure_agreed_at is not null,
    'invitedAt', p.invited_at, 'acceptedAt', p.accepted_at,
    'resolved', (p.is_platform or p.org_id is not null or p.user_id is not null or p.contact_id is not null),
    'name', case when v_reveal then public.fn_fixture_party_name(p) end,
    'deskLabel', case when v_reveal then public.fn_fixture_party_desk(p) end);
  if coalesce(p_unmasked, false) then
    j := j || jsonb_build_object('orgId', p.org_id, 'userId', p.user_id, 'contactId', p.contact_id,
                                 'anchorListingType', p.anchor_listing_type, 'anchorListingId', p.anchor_listing_id,
                                 'invitedByUserId', p.invited_by_user_id, 'disclosureAgreedAt', p.disclosure_agreed_at);
  end if;
  return j;
end $$;
revoke all on function public.fn_fixture_party_json(public.fixture_parties, uuid[], text, boolean, boolean) from public, anon, authenticated;

create or replace function public.fn_fixture_event_json(e public.fixture_events, p_labels jsonb, p_unmasked boolean)
 returns jsonb language plpgsql immutable set search_path to ''
as $$
declare j jsonb;
begin
  j := jsonb_build_object(
    'id', e.id, 'seq', e.seq, 'type', e.type, 'at', e.created_at, 'command', e.command, 'relayed', e.relayed,
    'actorPartyId', e.actor_party_id, 'onBehalfOfPartyId', e.on_behalf_of_party_id,
    'actorLabel', coalesce(p_labels->>(e.actor_party_id::text), case when e.actor_user_id is null then 'System' else 'Arab ShipBroker' end),
    'onBehalfOfLabel', p_labels->>(e.on_behalf_of_party_id::text),
    'payload', e.payload);
  if coalesce(p_unmasked, false) then
    j := j || jsonb_build_object('actorUserId', e.actor_user_id, 'idempotencyKey', e.idempotency_key);
  end if;
  return j;
end $$;
revoke all on function public.fn_fixture_event_json(public.fixture_events, jsonb, boolean) from public, anon, authenticated;

-- What the viewer may do, computed with the same predicates the commands
-- use. lib/fixture-room/permissions.ts mirrors this table for the UI tests.
create or replace function public.fn_fixture_capabilities(r public.fixture_rooms, p_parties public.fixture_parties[], p_admin boolean, p_relayed_ids uuid[])
 returns jsonb language plpgsql stable set search_path to ''
as $$
declare p public.fixture_parties; v_side text; v_mediator boolean := false; v_commercial boolean := false; v_any boolean := false;
        v_invited boolean := false; v_can_disclose boolean := false; v_terminal boolean; v_open boolean;
begin
  v_terminal := r.status in ('withdrawn', 'failed', 'expired');
  foreach p in array coalesce(p_parties, '{}'::public.fixture_parties[]) loop
    if p.status = 'invited' then v_invited := true; end if;
    if p.status <> 'active' then continue; end if;
    v_any := true;
    if p.side in ('cargo', 'vessel') and v_side is null then v_side := p.side; end if;
    if p.side = 'mediator' and p.capacity = 'broker' then v_mediator := true; end if;
    if p.side in ('cargo', 'vessel') and p.capacity in ('principal', 'broker') then v_commercial := true; end if;
    if p.side in ('cargo', 'vessel') and p.capacity = 'principal' and p.disclosure_agreed_at is null then v_can_disclose := true; end if;
  end loop;
  if v_mediator and coalesce(array_length(p_relayed_ids, 1), 0) > 0 then v_commercial := true; end if;
  if v_side is null and v_mediator then v_side := 'mediator'; end if;
  v_open := r.status in ('invited', 'negotiating');
  return jsonb_build_object(
    'viewerSide', v_side,
    'isMediator', v_mediator,
    'isAdmin', coalesce(p_admin, false),
    'canPropose', v_open and v_commercial,
    'canAccept', v_open and v_commercial,
    'canWithdrawProposal', v_open and v_commercial,
    'canReopen', r.status in ('negotiating', 'on_subjects') and v_commercial,
    'canFlagTerm', v_open and (v_commercial or v_mediator),
    'canAddSubject', r.status in ('negotiating', 'on_subjects') and (v_commercial or v_mediator),
    'canLiftSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canFailSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canExtendSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canFixOnSubjects', r.status = 'negotiating' and (v_commercial or v_mediator),
    'canPublishRecap', r.status in ('negotiating', 'on_subjects', 'fixed') and (v_commercial or v_mediator),
    'canAcknowledgeRecap', r.status in ('negotiating', 'on_subjects', 'fixed') and v_commercial,
    'canMessage', v_any and not v_terminal,
    'canWithdraw', not v_terminal and r.status <> 'fixed' and v_commercial and not (v_mediator and not exists (select 1 from unnest(coalesce(p_parties, '{}'::public.fixture_parties[])) q where q.status = 'active' and q.side in ('cargo','vessel') and q.capacity in ('principal','broker'))),
    'canFail', not v_terminal and r.status <> 'fixed' and (v_mediator or coalesce(p_admin, false)),
    'canExpire', not v_terminal and r.status <> 'fixed' and (v_mediator or coalesce(p_admin, false)),
    'canAgreeDisclosure', not v_terminal and (v_can_disclose or (v_mediator and coalesce(array_length(p_relayed_ids, 1), 0) > 0)),
    'canInvite', not v_terminal and (v_commercial or v_mediator),
    'canRespondInvitation', v_invited,
    'canRedact', coalesce(p_admin, false),
    'actForPartyIds', to_jsonb(case when v_mediator then coalesce(p_relayed_ids, '{}'::uuid[]) else '{}'::uuid[] end));
end $$;
revoke all on function public.fn_fixture_capabilities(public.fixture_rooms, public.fixture_parties[], boolean, uuid[]) from public, anon, authenticated;

-- ── listing status sync (decision D4) ───────────────────────────────────────
-- p_mask_vessel: the viewer must not learn the vessel's stable identifier (a
-- TBN vessel seen from the cargo side before disclosure — audit FR-H3).
drop function if exists public.fn_fixture_listing_sync(public.fixture_rooms);
create or replace function public.fn_fixture_listing_sync(r public.fixture_rooms, p_mask_vessel boolean default false)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_cargo text; v_vessel text; t jsonb := r.listing_sync_target;
begin
  if t is null then return null; end if;
  select c.status::text into v_cargo from public.cargo_listings c where c.id = r.cargo_listing_id;
  select va.status::text into v_vessel from public.vessel_availability va where va.id = r.vessel_availability_id;
  return jsonb_build_object(
    'requiredAt', r.listing_sync_required_at,
    'cargo', jsonb_build_object('listingId', r.cargo_listing_id, 'target', t->>'cargo_status', 'current', v_cargo,
                                'outstanding', (t->>'cargo_status') is distinct from v_cargo),
    'vessel', jsonb_build_object('availabilityId', r.vessel_availability_id,
                                 'vesselId', case when coalesce(p_mask_vessel, false) then null else r.vessel_id end,
                                 'target', t->>'vessel_status', 'current', v_vessel,
                                 'outstanding', (t->>'vessel_status') is distinct from v_vessel),
    'outstanding', ((t->>'cargo_status') is distinct from v_cargo) or ((t->>'vessel_status') is distinct from v_vessel));
end $$;
revoke all on function public.fn_fixture_listing_sync(public.fixture_rooms, boolean) from public, anon, authenticated;

-- ── recap ───────────────────────────────────────────────────────────────────
create or replace function public.fn_fixture_recap_build(r public.fixture_rooms)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_disclosed boolean := r.counterparty_disclosed_at is not null; v_tbn boolean; v_vessel_name text; v_terms jsonb; v_subjects jsonb; v_parties jsonb;
begin
  v_tbn := coalesce((r.vessel_snapshot->'vessel'->>'is_tbn')::boolean, false);
  v_vessel_name := case when v_tbn and not v_disclosed then 'TBN' else r.vessel_snapshot->'vessel'->>'vessel_name' end;
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', t.code, 'label', t.label, 'sortOrder', t.sort_order, 'status', t.status, 'required', t.required,
           'agreedValue', ap.display_value, 'agreedAt', t.agreed_at,
           'cargoPosition', cp.display_value, 'vesselPosition', vp.display_value) order by t.sort_order), '[]'::jsonb)
    into v_terms
    from public.fixture_terms t
    left join public.fixture_proposals ap on ap.id = t.agreed_proposal_id
    left join public.fixture_proposals cp on cp.id = t.cargo_proposal_id
    left join public.fixture_proposals vp on vp.id = t.vessel_proposal_id
   where t.room_id = r.id;
  select coalesce(jsonb_agg(jsonb_build_object('seq', s.seq, 'title', s.title, 'status', s.status, 'responsibleSide', s.responsible_side, 'deadlineAt', s.deadline_at) order by s.seq), '[]'::jsonb)
    into v_subjects from public.fixture_subjects s where s.room_id = r.id;
  select coalesce(jsonb_agg(jsonb_build_object('side', p.side, 'capacity', p.capacity, 'label', p.display_label,
           'name', case when v_disclosed or p.is_platform then public.fn_fixture_party_name(p) end) order by p.side, p.capacity), '[]'::jsonb)
    into v_parties from public.fixture_parties p where p.room_id = r.id and p.status = 'active';
  return jsonb_build_object(
    'ref', r.ref, 'status', r.status, 'roomVersion', r.version, 'generatedAt', now(),
    'cargo', jsonb_build_object('ref', r.cargo_snapshot->>'ref', 'commodity', r.cargo_snapshot->>'commodity_name',
                                'qtyMin', r.cargo_snapshot->'qty_min_mt', 'qtyMax', r.cargo_snapshot->'qty_max_mt',
                                'loadPort', r.cargo_snapshot->>'load_port_name', 'dischPort', r.cargo_snapshot->>'disch_port_name'),
    'vessel', jsonb_build_object('name', v_vessel_name, 'type', r.vessel_snapshot->'vessel'->>'vessel_type', 'dwt', r.vessel_snapshot->'vessel'->'dwt_grain'),
    'counterpartyDisclosed', v_disclosed,
    'parties', v_parties, 'terms', v_terms, 'subjects', v_subjects,
    'brokerageTerms', r.brokerage_terms_snapshot,
    'listingSyncTarget', r.listing_sync_target);
end $$;
revoke all on function public.fn_fixture_recap_build(public.fixture_rooms) from public, anon, authenticated;

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
    l := array_append(l, format('Brokerage: %s', coalesce(c->'brokerageTerms'->>'text', c->'brokerageTerms'::text)));
  end if;
  l := array_append(l, 'Sub all terms / details of C/P otherwise as per owners'' proforma.');
  return array_to_string(l, E'\n');
end $$;
revoke all on function public.fn_fixture_recap_text(jsonb) from public, anon, authenticated;

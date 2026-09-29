-- Fixture Room · governed match candidates (C2O-011, 28 Sep 2026)
-- Migration 20260923206000, inside the reserved Fixture range 2026092320xxxx–2026092324xxxx.
--
-- The match builder used to call the legacy matchers (get_matches_for_cargo /
-- get_matches_for_availability) straight from a server action with any
-- listing id the browser sent, and mapped their raw rows into member cards.
-- Those SECURITY DEFINER matchers are not TBN-aware: they return the hull's
-- name, its vessels.id and (as vessel_ref) its IMO number. Two defects:
--   * a cargo-side member learnt a TBN vessel's name and stable identifiers
--     before the Fixture disclosure rule allows it;
--   * any signed-in member could list the matches of another member's listing.
--
-- list_fixture_match_candidates(kind, listing) is the only candidate read the
-- Fixture Room uses now:
--   * the listing must be one the actor owns or represents, decided by the same
--     fn_fixture_owns_listing that create_fixture_room applies (FR-H1);
--   * no candidate carries a vessels.id or an IMO number, ever: the browser
--     needs only the availability id, which create_fixture_room takes;
--   * a TBN vessel the actor does not own is named 'TBN' (the room's masked
--     label); its particulars (type, DWT, build year, open port and date) stay,
--     exactly as the room's masked snapshot shows them;
--   * every candidate carries the facts of the governed rule that matched it
--     (zone, laycan window, grain / DG certification, gear, capacity band), so
--     the card's explanation can never contradict a valid match.
-- The legacy matchers are unchanged for the modules that still use them.

create or replace function public.list_fixture_match_candidates(p_kind text, p_listing_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_actor uuid := public.fn_fixture_actor();
  v_out jsonb;
begin
  -- a null kind is refused too (NULL NOT IN (...) is not true; re-audit C2O-011 item 4)
  if p_kind is null or p_kind not in ('cargo', 'vessel') or p_listing_id is null then
    raise exception 'FX_VALIDATION: kind must be cargo or vessel and a listing is required' using errcode = '22023';
  end if;
  if public.fn_fixture_owns_listing(case p_kind when 'cargo' then 'cargo' else 'vessel_availability' end, p_listing_id) is null then
    raise exception 'FX_AUTH: you can only match your own listings' using errcode = '42501';
  end if;

  if p_kind = 'cargo' then
    -- vessel candidates for my cargo
    select coalesce(jsonb_agg(x.j order by x.rate_aligned desc, x.dwt_delta asc), '[]'::jsonb) into v_out from (
      select m.is_rate_aligned as rate_aligned, m.dwt_delta,
             jsonb_build_object(
               'availabilityId', m.availability_id,
               'name', case when coalesce(v.is_tbn, false)
                                 and public.fn_fixture_owns_listing('vessel_availability', m.availability_id) is null
                            then 'TBN' else m.vessel_name end,
               'isTbn', coalesce(v.is_tbn, false),
               'type', m.vessel_type, 'dwt', m.dwt_grain, 'buildYear', m.build_year,
               'openPort', m.open_port_name, 'openZone', m.open_zone, 'openDate', m.open_date,
               'freightIdea', m.freight_idea_usd_mt, 'rateAligned', m.is_rate_aligned, 'geared', m.is_geared,
               'mine', public.fn_fixture_owns_listing('vessel_availability', m.availability_id) is not null,
               'fit', jsonb_build_object(
                 'zone', case when m.open_zone = cl.load_zone::text then 'load' else 'discharge' end,
                 'laycan', case when cl.is_spot then 'spot' else 'window' end,
                 'grain', cl.is_grain_cargo, 'dg', cl.is_dg_cargo,
                 'gearRequired', coalesce(cl.requires_geared, false),
                 'partCargo', m.accepts_part_cargo, 'dwtDelta', m.dwt_delta)) as j
        from public.get_matches_for_cargo(p_listing_id) m
        join public.cargo_listings cl on cl.id = p_listing_id
        left join public.vessels v on v.id = m.vessel_id
    ) x;
  else
    -- cargo candidates for my vessel position
    select coalesce(jsonb_agg(x.j order by x.rate_aligned desc, x.dwt_delta asc), '[]'::jsonb) into v_out from (
      select m.is_rate_aligned as rate_aligned, m.dwt_delta,
             jsonb_build_object(
               'id', m.cargo_id, 'ref', m.ref, 'commodity', m.commodity_name, 'type', m.cargo_type,
               'qtyMin', m.qty_min_mt, 'qtyMax', m.qty_max_mt, 'loadPort', m.load_port_name, 'dischPort', m.disch_port_name,
               'laycanFrom', m.laycan_from, 'laycanTo', m.laycan_to, 'isSpot', m.is_spot,
               'freightIdea', m.freight_idea_usd_mt, 'rateAligned', m.is_rate_aligned,
               'mine', public.fn_fixture_owns_listing('cargo', m.cargo_id) is not null,
               'fit', jsonb_build_object(
                 'zone', case when va.open_zone::text = m.load_zone then 'load' else 'discharge' end,
                 'laycan', case when m.is_spot then 'spot' else 'window' end,
                 'grain', m.is_grain_cargo, 'dg', m.is_dg_cargo,
                 'gearRequired', coalesce(m.requires_geared, false),
                 'partCargo', va.accepts_part_cargo, 'dwtDelta', m.dwt_delta)) as j
        from public.get_matches_for_availability(p_listing_id) m
        join public.vessel_availability va on va.id = p_listing_id
    ) x;
  end if;
  return v_out;
end $$;
revoke all on function public.list_fixture_match_candidates(text, uuid) from public, anon;
grant execute on function public.list_fixture_match_candidates(text, uuid) to authenticated, service_role;

comment on function public.list_fixture_match_candidates(text, uuid) is
  'Fixture Room (C2O-011): ranked counterparts for a listing the actor owns or represents. Never returns a vessels.id or IMO; a TBN vessel the actor does not own is named TBN. Each candidate carries the governed match facts (zone, laycan rule, grain/DG, gear, capacity).';

-- The match builder's first step: the live listings the actor owns or represents
-- (re-audit C2O-011 item 3). The portal's "my listings" queries match the
-- listing's owner_user_id to the signed-in account only, so a second active
-- seat of the owning organisation could not pick an organisation listing the
-- database would let it open. This read uses exactly the rule create_fixture_room
-- applies (fn_fixture_owns_listing) and only listings a room can open on
-- (fn_fixture_listing_live). They are the actor's own listings, so its own
-- vessel is named; still no vessels.id or IMO is returned.
create or replace function public.list_fixture_my_listings()
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_actor uuid := public.fn_fixture_actor(); v_cargo jsonb; v_vessels jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'ref', c.ref, 'commodity', c.commodity_name, 'type', c.cargo_type::text,
           'qtyMin', c.qty_min_mt, 'qtyMax', c.qty_max_mt,
           'loadPort', coalesce(c.load_port_name, c.load_port_locode), 'dischPort', coalesce(c.disch_port_name, c.disch_port_locode),
           'laycanFrom', c.laycan_from, 'laycanTo', c.laycan_to, 'isSpot', coalesce(c.is_spot, false),
           'freightIdea', c.freight_idea_usd_mt) order by c.created_at desc), '[]'::jsonb)
    into v_cargo
    from public.cargo_listings c
   where exists (select 1 from public.listing_ownership lo
                  where lo.listing_type = 'cargo' and lo.listing_id = c.id and lo.is_current and lo.role = 'primary')
     and public.fn_fixture_listing_live('cargo', c.id)
     and public.fn_fixture_owns_listing('cargo', c.id) is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'availabilityId', va.id, 'name', v.vessel_name, 'type', v.vessel_type::text, 'dwt', v.dwt_grain,
           'openPort', coalesce(va.open_port_name, va.open_port_locode), 'openZone', va.open_zone::text, 'openDate', va.open_date,
           'freightIdea', va.freight_idea_usd_mt, 'geared', v.is_geared) order by va.created_at desc), '[]'::jsonb)
    into v_vessels
    from public.vessel_availability va
    join public.vessels v on v.id = va.vessel_id
   where exists (select 1 from public.listing_ownership lo
                  where lo.listing_type = 'vessel_availability' and lo.listing_id = va.id and lo.is_current and lo.role = 'primary')
     and public.fn_fixture_listing_live('vessel_availability', va.id)
     and public.fn_fixture_owns_listing('vessel_availability', va.id) is not null;

  return jsonb_build_object('cargo', v_cargo, 'vessels', v_vessels);
end $$;
revoke all on function public.list_fixture_my_listings() from public, anon;
grant execute on function public.list_fixture_my_listings() to authenticated, service_role;

comment on function public.list_fixture_my_listings() is
  'Fixture Room (re-audit C2O-011 item 3): the live cargo and positions the actor owns or represents, by the create_fixture_room ownership rule; no vessels.id or IMO.';


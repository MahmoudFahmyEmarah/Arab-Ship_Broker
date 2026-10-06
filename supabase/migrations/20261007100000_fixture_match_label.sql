-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · the Match Builder shows the governed Rules label (7 Oct 2026)
-- Release plan B2C-033 Wave 2 / owner ruling B2O-021 (R-B consumer).
--
-- list_fixture_match_candidates (last defined in 20260923208000) gains, per
-- candidate, `matchLabel`: the active rule version's score_label for the pair,
-- read from public.matches (Stream R's published cache). Members see the word
-- only, never a score (R-C); the Fixture Room is T3+ so the word is allowed.
-- Candidates sort by label (Strong, Good, Possible, then anything else), then
-- as before. The zone fact distinguishes load / discharge / other, so its text
-- stays true when R-B pairs on adjacent zones. Everything else — ownership
-- check, handle issue and retention, TBN masking, hints, grants — is the
-- released body unchanged. Requires Stream R (20261003300000) in the chain.
--
-- Idempotent. DOWN: supabase/rollback/20261007_fixture_match_label_down.sql
-- ════════════════════════════════════════════════════════════════════════

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
             -- the governed Rules label for this pair (active version), the only fit tier members see
             'matchLabel', (select mm.score_label from public.matches mm where mm.cargo_id = p_listing_id and mm.vessel_avail_id = m.availability_id),
             'hints', public.fn_fixture_hint_figures(p_listing_id, m.availability_id),
             'fit', jsonb_build_object(
               'zone', case when m.open_zone = cl.load_zone::text then 'load' when m.open_zone = cl.disch_zone::text then 'discharge' else 'other' end,
               'openZone', m.open_zone,
               'laycan', case when cl.is_spot then 'spot' else 'window' end,
               'grain', cl.is_grain_cargo, 'dg', cl.is_dg_cargo,
               'gearRequired', coalesce(cl.requires_geared, false),
               'partCargo', m.accepts_part_cargo, 'dwtDelta', m.dwt_delta))
           order by case (select mm.score_label from public.matches mm where mm.cargo_id = p_listing_id and mm.vessel_avail_id = m.availability_id) when 'Strong' then 0 when 'Good' then 1 when 'Possible' then 2 else 3 end, m.is_rate_aligned desc, m.dwt_delta asc), '[]'::jsonb)
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
             'matchLabel', (select mm.score_label from public.matches mm where mm.cargo_id = m.cargo_id and mm.vessel_avail_id = p_listing_id),
             'hints', public.fn_fixture_hint_figures(m.cargo_id, p_listing_id),
             'fit', jsonb_build_object(
               'zone', case when va.open_zone::text = m.load_zone then 'load' when va.open_zone::text = m.disch_zone then 'discharge' else 'other' end,
               'openZone', va.open_zone::text,
               'laycan', case when m.is_spot then 'spot' else 'window' end,
               'grain', m.is_grain_cargo, 'dg', m.is_dg_cargo,
               'gearRequired', coalesce(m.requires_geared, false),
               'partCargo', va.accepts_part_cargo, 'dwtDelta', m.dwt_delta))
           order by case (select mm.score_label from public.matches mm where mm.cargo_id = m.cargo_id and mm.vessel_avail_id = p_listing_id) when 'Strong' then 0 when 'Good' then 1 when 'Possible' then 2 else 3 end, m.is_rate_aligned desc, m.dwt_delta asc), '[]'::jsonb)
      into v_out
      from m join h on h.cargo_listing_id = m.cargo_id
      join public.vessel_availability va on va.id = p_listing_id;
  end if;
  return v_out;
end $$;
revoke all on function public.list_fixture_match_candidates(text, uuid) from public, anon;
grant execute on function public.list_fixture_match_candidates(text, uuid) to authenticated, service_role;

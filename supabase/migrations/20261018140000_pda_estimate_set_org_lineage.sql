-- ════════════════════════════════════════════════════════════════════════
-- PDA · a superseding estimate set keeps its predecessor's organisation (Codex C2O-159 P1-5)
--
-- A member with several active organisation seats could save a new version of a set into another organisation and
-- so change which colleagues read it. pda_save_estimate_set now derives the organisation of a superseding version
-- from the set it supersedes (including none) and ignores the caller's value; a first version still takes the
-- caller's organisation, which pda_save_estimate checks is a current seat. The body is the 20261018120000 one with
-- that single change (generated, not hand-edited). Plain SQL.
-- DOWN: supabase/rollback/20261018140000_pda_estimate_set_org_lineage_down.sql restores the 20261018120000 body.
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create or replace function public.pda_save_estimate_set(
  p_actor uuid,
  p_owner_org_id uuid,
  p_load_request jsonb,
  p_load_result jsonb,
  p_discharge_request jsonb,
  p_discharge_result jsonb,
  p_route jsonb,
  p_supersedes_id uuid default null
)
returns jsonb
language plpgsql volatile security definer set search_path to ''
as $$
declare
  v_hash text;
  v_existing public.pda_estimate_sets;
  v_prev public.pda_estimate_sets;
  v_load uuid;
  v_discharge uuid;
  v_id uuid;
  v_canonical jsonb := p_route->'canonical';
  -- C2O-159 P1-5: a new version stays in its predecessor's organisation (including none); never the caller's choice
  v_org uuid := p_owner_org_id;
begin
  if p_supersedes_id is not null then
    select s.owner_org_id into v_org from public.pda_estimate_sets s where s.id = p_supersedes_id;
  end if;
  if p_route is null or jsonb_typeof(p_route) <> 'object' or jsonb_typeof(v_canonical) <> 'object'
     or jsonb_typeof(p_route->'routeInput') <> 'object' or jsonb_typeof(p_route->'timeline') <> 'object'
     or jsonb_typeof(p_route->'transits') <> 'array' or jsonb_typeof(p_route->'totals') <> 'object'
     or jsonb_typeof(p_route->'notSourced') <> 'array' then
    raise exception 'PDA_INPUT: the route snapshot is incomplete' using errcode = '22023';
  end if;
  if upper(trim(p_load_request->>'portLocode')) is distinct from upper(trim(p_route#>>'{routeInput,load,portLocode}'))
     or upper(trim(p_discharge_request->>'portLocode')) is distinct from upper(trim(p_route#>>'{routeInput,discharge,portLocode}')) then
    raise exception 'PDA_INPUT: the leg requests do not match the route' using errcode = '22023';
  end if;

  -- the hash of what was estimated (generation instants excluded, so the same content always has the same hash)
  v_hash := encode(sha256(convert_to(jsonb_build_object(
    'load', jsonb_build_object('request', p_load_request, 'result', p_load_result - 'generatedAt'),
    'discharge', jsonb_build_object('request', p_discharge_request, 'result', p_discharge_result - 'generatedAt'),
    'route', jsonb_build_object('canonical', v_canonical, 'routeInput', p_route->'routeInput', 'timeline', p_route->'timeline',
                                'transits', p_route->'transits', 'totals', p_route->'totals', 'notSourced', p_route->'notSourced',
                                'allocation', p_route->'allocation', 'displayCurrency', p_route->'displayCurrency')
  )::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtext('pda_estimate_set_owner:' || p_actor::text));

  -- the actor is re-checked before ANY answer, the replay included (B2O-044 P2-5): active, T3+/partner/admin
  if not exists (select 1 from public.users u where u.id = p_actor and u.is_active
                 and (lower(coalesce(u.role, '')) = 'admin' or u.subscription_tier::text in ('T3','T4')
                      or coalesce((to_jsonb(u)->>'is_market_partner')::boolean, false))) then
    raise exception 'PDA_TIER: actor requires an active Subscriber (T3+) account' using errcode = '42501';
  end if;

  -- idempotent: the same content again, while it is still the owner's latest version of it, returns that set
  select s.* into v_existing from public.pda_estimate_sets s
   where s.owner_user_id = p_actor and s.content_hash = v_hash
     and not exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = s.id)
   order by s.created_at desc limit 1;
  if v_existing.id is not null and v_existing.owner_org_id is not distinct from v_org
     and (p_supersedes_id is null or p_supersedes_id = v_existing.id or p_supersedes_id = v_existing.supersedes_id) then
    return jsonb_build_object('id', v_existing.id, 'contentHash', v_existing.content_hash, 'createdAt', v_existing.created_at,
                              'loadEstimateId', v_existing.load_estimate_id, 'dischargeEstimateId', v_existing.discharge_estimate_id,
                              'replayed', true);
  end if;

  if p_supersedes_id is not null then
    select s.* into v_prev from public.pda_estimate_sets s where s.id = p_supersedes_id;
    if v_prev.id is null or v_prev.owner_user_id <> p_actor then
      raise exception 'PDA_AUTH: only the owner of a saved set can supersede it' using errcode = '42501';
    end if;
    if v_prev.vessel_availability_id <> (v_canonical->>'vesselAvailabilityId')::uuid or v_prev.cargo_id <> (v_canonical->>'cargoId')::uuid then
      raise exception 'PDA_CONFLICT: a new version must be for the same vessel and cargo; save a different route as a new estimate' using errcode = '40001';
    end if;
    if exists (select 1 from public.pda_estimate_sets n where n.supersedes_id = v_prev.id) then
      raise exception 'PDA_CONFLICT: this saved set has already been superseded; open the latest version' using errcode = '40001';
    end if;
  end if;

  -- both legs through the existing governed save (tier, seat, version, sums, evidence), in this same transaction
  v_load := public.pda_save_estimate(p_actor, v_org, p_load_request, p_load_result,
                                     case when v_prev.id is not null then v_prev.load_estimate_id end);
  v_discharge := public.pda_save_estimate(p_actor, v_org, p_discharge_request, p_discharge_result,
                                          case when v_prev.id is not null then v_prev.discharge_estimate_id end);

  insert into public.pda_estimate_sets (
    owner_user_id, owner_org_id, load_estimate_id, discharge_estimate_id,
    load_tariff_version_id, discharge_tariff_version_id,
    vessel_availability_id, vessel_id, cargo_id, quantity_mt, allocation, display_currency, title,
    route_input, timeline, transits, totals, not_sourced, content_hash, supersedes_id
  ) values (
    p_actor, v_org, v_load, v_discharge,
    nullif(p_load_result->>'tariffVersionId','')::uuid, nullif(p_discharge_result->>'tariffVersionId','')::uuid,
    (v_canonical->>'vesselAvailabilityId')::uuid, nullif(v_canonical->>'vesselId','')::uuid, (v_canonical->>'cargoId')::uuid,
    (v_canonical->>'quantityMt')::numeric, p_route->>'allocation', upper(p_route->>'displayCurrency'), p_route->>'title',
    p_route->'routeInput', p_route->'timeline', p_route->'transits', p_route->'totals', p_route->'notSourced', v_hash, v_prev.id
  ) returning id into v_id;

  return jsonb_build_object('id', v_id, 'contentHash', v_hash, 'createdAt', now(),
                            'loadEstimateId', v_load, 'dischargeEstimateId', v_discharge, 'replayed', false);
end;
$$;
revoke all on function public.pda_save_estimate_set(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.pda_save_estimate_set(uuid, uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) to service_role;

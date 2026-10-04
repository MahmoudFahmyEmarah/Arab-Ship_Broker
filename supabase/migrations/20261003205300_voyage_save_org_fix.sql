-- 20261003205300_voyage_save_org_fix.sql — Stream S (4 Oct 2026), additive on 20261003204000.
--
-- Found by the browser proof: save_voyage_estimate ordered the actor's memberships by a
-- created_at column that public.organization_members does not have (it carries added_at),
-- so every save failed with "column … does not exist". Same function, one column name, nothing else.

create or replace function public.save_voyage_estimate(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $save$
declare
  v_id uuid;
  v_line jsonb;
  v_seq integer := 0;
  v_org uuid;
begin
  if p_actor is null or not exists (select 1 from public.users u where u.id = p_actor) then
    raise exception 'VOYAGE_INVALID: unknown actor' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload) <> 'object' or jsonb_typeof(p_payload -> 'input') <> 'object'
     or jsonb_typeof(p_payload -> 'result') <> 'object' or jsonb_typeof(p_payload -> 'totals') <> 'object' then
    raise exception 'VOYAGE_INVALID: payload needs input, result and totals objects' using errcode = '22023';
  end if;
  -- The actor's current org, if any, so colleagues can read the estimate (earliest active membership).
  select om.org_id into v_org
    from public.organization_members om
   where om.user_id = p_actor and om.is_current and om.status = 'active'
   order by om.added_at asc nulls last limit 1;

  insert into public.voyage_estimate_runs (
    actor_user_id, owner_org_id, vessel_id, availability_id, cargo_listing_id, label,
    algorithm_version, settings_hash, input_snapshot, result_snapshot,
    fuel_index_snapshot, route_eca_snapshot, suez_cost_snapshot, port_cost_snapshot, totals, warnings)
  values (
    p_actor, v_org,
    nullif(p_payload ->> 'vesselId', '')::uuid,
    nullif(p_payload ->> 'availabilityId', '')::uuid,
    nullif(p_payload ->> 'cargoListingId', '')::uuid,
    nullif(p_payload ->> 'label', ''),
    coalesce(p_payload ->> 'algorithmVersion', 'voyage-engine/1'),
    p_payload ->> 'settingsHash',
    p_payload -> 'input', p_payload -> 'result',
    p_payload -> 'fuelIndexSnapshot', p_payload -> 'routeEcaSnapshot',
    p_payload -> 'suezCostSnapshot', p_payload -> 'portCostSnapshot',
    p_payload -> 'totals', coalesce(p_payload -> 'warnings', '[]'::jsonb))
  returning id into v_id;

  for v_line in select * from jsonb_array_elements(coalesce(p_payload -> 'lines', '[]'::jsonb)) loop
    insert into public.voyage_estimate_lines (run_id, seq, kind, code, label, quantity, unit, rate, amount_usd, explanation)
    values (v_id, v_seq, v_line ->> 'kind', v_line ->> 'code', coalesce(v_line ->> 'label', v_line ->> 'code'),
            nullif(v_line ->> 'quantity', '')::numeric, v_line ->> 'unit', nullif(v_line ->> 'rate', '')::numeric,
            nullif(v_line ->> 'amountUsd', '')::numeric, v_line ->> 'explanation');
    v_seq := v_seq + 1;
  end loop;
  return v_id;
end;
$save$;
revoke all on function public.save_voyage_estimate(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.save_voyage_estimate(uuid, jsonb) to service_role;

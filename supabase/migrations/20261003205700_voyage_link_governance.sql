-- ════════════════════════════════════════════════════════════════════════
-- Stream S · governed estimator links (6 Oct 2026) — answers C2O-058 #1 and #7
--
--   #1  resolve_voyage_vessel_link(key): the match card links the estimator with a
--       market listing key (actor-bound, purpose-bound, expiring). The page resolves
--       it here, as the member, to a vessel_availability id ONLY when this member may
--       reference that position (fn_voyage_may_reference: admin, or owner of the
--       listing). Anything else — unknown, expired, foreign, someone else's — is the
--       same null, so a key never reveals a raw id the member could not already see.
--   #7  voyage_link_facts(cargo, availability): the save authorises every linked id
--       BEFORE any privileged read and returns only the facts the reconciliation
--       needs. A link the member may not reference is one generic refusal; the
--       service-role reads of caller UUIDs are gone from the action.
--
-- Additive; idempotent. DOWN: supabase/rollback/20261003_suez_voyage_down.sql
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.resolve_voyage_vessel_link(p_key uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $resolve$
declare v_actor uuid := public.fn_market_actor(); v_type text; v_id uuid;
begin
  if v_actor is null or p_key is null then return null; end if;
  begin
    select h.listing_type, h.listing_id into v_type, v_id from public.fn_market_resolve_handle(v_actor, p_key) h;
  exception when others then
    return null;   -- unknown, expired and foreign keys are indistinguishable
  end;
  if v_type is distinct from 'vessel_availability' or not public.fn_voyage_may_reference(v_actor, 'availability', v_id) then
    return null;
  end if;
  return v_id;
end;
$resolve$;
revoke all on function public.resolve_voyage_vessel_link(uuid) from public, anon, service_role;  -- member session only (C2O-061 #3)
grant execute on function public.resolve_voyage_vessel_link(uuid) to authenticated;
comment on function public.resolve_voyage_vessel_link(uuid) is
  'Voyage estimator: resolves a market listing key to a vessel_availability id only when the calling member may reference that position; otherwise null (C2O-058 #1).';

create or replace function public.voyage_link_facts(p_cargo_listing_id uuid, p_availability_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $facts$
declare v_actor uuid := public.fn_market_actor(); v_cargo jsonb := null; v_pos jsonb := null;
begin
  if v_actor is null then
    raise exception 'VOYAGE_FORBIDDEN: sign in to save an estimate' using errcode = '42501';
  end if;
  -- authorise first: a link the member may not reference is refused before anything is read
  if (p_cargo_listing_id is not null and not public.fn_voyage_may_reference(v_actor, 'cargo', p_cargo_listing_id))
     or (p_availability_id is not null and not public.fn_voyage_may_reference(v_actor, 'availability', p_availability_id)) then
    raise exception 'VOYAGE_FORBIDDEN: a linked listing is not available to you' using errcode = '42501';
  end if;
  if p_cargo_listing_id is not null then
    select jsonb_build_object('loadPort', c.load_port_locode, 'dischPort', c.disch_port_locode, 'laycanFrom', c.laycan_from,
                              'loadRate', c.load_rate, 'dischRate', c.disch_rate, 'qtyMin', c.qty_min_mt, 'qtyMax', c.qty_max_mt)
      into v_cargo from public.cargo_listings c where c.id = p_cargo_listing_id;
  end if;
  if p_availability_id is not null then
    select jsonb_build_object('vesselId', a.vessel_id, 'openPort', a.open_port_locode)
      into v_pos from public.vessel_availability a where a.id = p_availability_id;
  end if;
  return jsonb_build_object('cargo', v_cargo, 'position', v_pos);
end;
$facts$;
revoke all on function public.voyage_link_facts(uuid, uuid) from public, anon, service_role;  -- member session only (C2O-061 #3)
grant execute on function public.voyage_link_facts(uuid, uuid) to authenticated;
comment on function public.voyage_link_facts(uuid, uuid) is
  'Voyage estimator save: authorises the linked cargo / position for the calling member, then returns only the facts the save reconciles (C2O-058 #7).';

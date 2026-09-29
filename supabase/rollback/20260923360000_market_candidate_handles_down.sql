-- DOWN for 20260923360000_market_candidate_handles.sql.
-- 20260923361000 must be rolled back first because its owner policies call
-- fn_market_actor/fn_market_owns_listing.

drop function if exists public.get_market_listing_detail(uuid);
drop function if exists public.list_market_matches(uuid);
drop function if exists public.list_market_vessels(date, date);
drop function if exists public.list_market_cargo(date, date);
drop function if exists public.set_market_vessel_availability_status(uuid, public.vessel_status_enum);
drop function if exists public.get_managed_vessel(uuid);
drop function if exists public.list_my_vessels();
drop function if exists public.list_my_cargo();
drop function if exists public.fn_market_vessel_payload(uuid, text, uuid, uuid, jsonb);
drop function if exists public.fn_market_cargo_payload(uuid, text, uuid, uuid, jsonb);
drop function if exists market_private.vessel_payload_preissued(
  uuid, text, uuid, uuid, uuid, timestamptz, jsonb
);
drop function if exists market_private.cargo_payload_preissued(
  uuid, text, uuid, uuid, uuid, timestamptz, jsonb
);
drop function if exists market_private.render_vessel_payload(
  public.vessel_availability, public.vessels, text, uuid, uuid,
  timestamptz, boolean, boolean, integer, jsonb, jsonb, jsonb
);
drop function if exists market_private.render_cargo_payload(
  public.cargo_listings, text, uuid, uuid, timestamptz,
  boolean, boolean, integer, jsonb, jsonb
);
drop function if exists market_private.market_match_counts(
  text, uuid[], timestamptz, boolean, date, date
);
drop function if exists market_private.market_listing_metadata(
  uuid, text, uuid[], boolean
);
drop function if exists market_private.vessel_ownership(uuid);
drop function if exists public.fn_market_poster(text, uuid);

-- Restore the three pre-existing management helpers exactly as they stood
-- before Stage 1. They are replaced, not introduced, by the forward migration.
CREATE OR REPLACE FUNCTION public.fn_owns_cargo(p_cargo_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
      SELECT EXISTS (
        SELECT 1
        FROM public.listing_ownership lo
        WHERE lo.listing_id = p_cargo_id
          AND lo.listing_type = 'cargo'
          AND lo.is_current = true
          AND lo.role = 'primary'
          AND (
            lo.owner_user_id = auth.uid()
            OR (lo.owner_org_id IS NOT NULL AND lo.owner_org_id = ANY (public.fn_my_org_ids()))
          )
      );
    $function$;

CREATE OR REPLACE FUNCTION public.fn_owns_vessel(p_vessel_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
        SELECT EXISTS (
          SELECT 1
          FROM public.listing_ownership lo
          JOIN public.vessel_availability va ON va.id = lo.listing_id
          WHERE va.vessel_id = p_vessel_id
            AND lo.listing_type = 'vessel_availability'
            AND lo.is_current = true
            AND lo.role = 'primary'
            AND (
              lo.owner_user_id = auth.uid()
              OR (lo.owner_org_id IS NOT NULL AND lo.owner_org_id = ANY (public.fn_my_org_ids()))
            )
        );
      $function$;

CREATE OR REPLACE FUNCTION public.fn_position_checkin(p_availability_id uuid, p_eta_port_locode text DEFAULT NULL::text, p_eta_date date DEFAULT NULL::date, p_eta_time time without time zone DEFAULT NULL::time without time zone, p_open_date date DEFAULT NULL::date)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owned boolean;
  v_now   timestamptz := now();
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.listing_ownership lo
    WHERE lo.listing_id = p_availability_id
      AND lo.listing_type = 'vessel_availability'
      AND lo.is_current = true
      AND lo.role = 'primary'
      AND (
        lo.owner_user_id = auth.uid()
        OR (lo.owner_org_id IS NOT NULL AND lo.owner_org_id = ANY (public.fn_my_org_ids()))
      )
  ) INTO v_owned;

  IF NOT (v_owned OR public.fn_is_admin()) THEN
    RAISE EXCEPTION 'Not the owner of this position';
  END IF;

  -- Confirm path: no ETA args → just stamp freshness.
  -- Update path: write the supplied fields, then stamp.
  UPDATE public.vessel_availability
  SET eta_port_locode       = COALESCE(p_eta_port_locode, eta_port_locode),
      eta_date              = COALESCE(p_eta_date, eta_date),
      eta_time              = COALESCE(p_eta_time, eta_time),
      open_date             = COALESCE(p_open_date, open_date),
      position_confirmed_at = v_now
  WHERE id = p_availability_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Position not found';
  END IF;

  RETURN v_now;
END;
$function$;

revoke all on function public.fn_owns_cargo(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_owns_vessel(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_position_checkin(uuid, text, date, time without time zone, date)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_owns_cargo(uuid)
  to anon, authenticated, service_role;
grant execute on function public.fn_owns_vessel(uuid)
  to anon, authenticated, service_role;
grant execute on function public.fn_position_checkin(uuid, text, date, time without time zone, date)
  to anon, authenticated, service_role;

-- Restore the pre-Stage-1 freshness implementation. Stage 2 DOWN has already
-- put its historical RLS policies back before this function is restored.
create or replace function public.fn_market_fresh_ok(
  p_listing_id uuid,
  p_type public.listing_type_enum,
  p_refreshed timestamptz,
  p_future date
) returns boolean
language plpgsql stable security definer set search_path to ''
as $$
declare cfg jsonb; v_tier text; cap int; fresh int; lex boolean;
begin
  if public.fn_is_admin() then return true; end if;

  -- owners always see their own listings, any age
  if auth.uid() is not null and exists (
    select 1 from public.listing_ownership lo
    where lo.listing_id = p_listing_id
      and lo.listing_type = p_type
      and lo.owner_user_id = auth.uid()
  ) then return true; end if;

  select value into cfg from public.app_settings where key = 'market_visibility';
  fresh := coalesce((cfg->>'freshDays')::int, 7);
  lex   := coalesce((cfg->>'laycanException')::boolean, true);
  select u.subscription_tier::text into v_tier from public.users u where u.id = auth.uid();
  cap := greatest(fresh, coalesce((cfg->'archiveDaysByTier'->>coalesce(v_tier, 'T1'))::int, 0));

  if p_refreshed >= now() - make_interval(days => cap) then return true; end if;
  if lex and p_future is not null and p_future >= current_date then return true; end if;
  return false;
end $$;

drop function if exists market_private.vessel_is_market_live(uuid);
drop function if exists market_private.cargo_is_market_live(uuid);
drop function if exists market_private.discovery_fresh_ok(timestamptz, date);
drop function if exists market_private.market_request_context(uuid, date, date);
drop function if exists market_private.active_window_cutoff(text, date);
drop function if exists market_private.purge_listing_handles(integer);
drop function if exists market_private.peek_listing_handle(uuid, uuid);
drop function if exists public.fn_market_resolve_handle(uuid, uuid);
drop function if exists public.fn_market_issue_handle(uuid, text, text, uuid);
drop function if exists market_private.issue_listing_handles_bulk(
  uuid, text[], text[], uuid[]
);
drop function if exists public.fn_market_owns_listing(text, uuid);
drop function if exists public.fn_market_owns_listing(uuid, text, uuid);
drop function if exists public.fn_market_actor();

drop table if exists market_private.listing_handles;
drop schema if exists market_private;

drop index if exists public.market_vrq_availability_poster_idx;
drop index if exists public.market_sync_cargo_poster_idx;
drop index if exists public.market_matches_vessel_cargo_idx;
drop index if exists public.market_vessel_board_scan_idx;
drop index if exists public.market_cargo_board_scan_idx;

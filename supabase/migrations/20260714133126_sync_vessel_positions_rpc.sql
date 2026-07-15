-- Ingest 02_VESSELS open positions into vessel_availability (Phase c).
-- Takes a pre-parsed positions array (parsing done in the server action with the
-- sync normalize helpers) and, per vessel (resolved by IMO):
--   • STATUS=Open + open port → upsert ONE active OPEN posting (refresh in place
--     if one exists, else insert), mark others INACTIVE, APPROVED + goes_live.
--   • STATUS Fixed/Off-hire/Ballast/On Subs/Inactive → close the open posting.
-- Admin-synced market positions carry no listing_ownership (public board/count
-- filter on status+review_status only). ref + open port name/zone are filled by
-- the existing vessel_availability triggers.
create or replace function public.sync_vessel_positions(p_positions jsonb)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  pos       jsonb;
  v_vid     uuid;
  v_aid     uuid;
  v_status  text;
  v_target  public.vessel_status_enum;
  v_posted  int := 0;
  v_closed  int := 0;
  v_skipped int := 0;
begin
  for pos in select value from jsonb_array_elements(coalesce(p_positions, '[]'::jsonb))
  loop
    select id into v_vid from public.vessels
      where imo_number = nullif(trim(pos->>'imo'), '');
    if v_vid is null then v_skipped := v_skipped + 1; continue; end if;

    v_status := upper(coalesce(pos->>'status', ''));

    if v_status = 'OPEN' and nullif(pos->>'open_port_locode', '') is not null then
      select id into v_aid from public.vessel_availability
        where vessel_id = v_vid and status = 'OPEN'
        order by created_at desc limit 1;

      if v_aid is not null then
        update public.vessel_availability set
          open_port_locode            = pos->>'open_port_locode',
          open_zone                   = coalesce(nullif(pos->>'open_zone','')::public.zone_enum, open_zone),
          open_date                   = nullif(pos->>'open_date','')::date,
          open_date_range_days        = coalesce((pos->>'open_date_range_days')::smallint, open_date_range_days),
          service_speed_kn            = (pos->>'service_speed_kn')::numeric,
          me_consumption_mt_day       = (pos->>'me_consumption_mt_day')::numeric,
          me_consumption_port_mt_day  = (pos->>'me_consumption_port_mt_day')::numeric,
          aux_consumption_port_mt_day = (pos->>'aux_consumption_port_mt_day')::numeric,
          fuel_type                   = nullif(pos->>'fuel_type',''),
          brob_mt                     = (pos->>'brob_mt')::numeric,
          num_grabs                   = (pos->>'num_grabs')::smallint,
          grab_capacity_mt            = (pos->>'grab_capacity_mt')::numeric,
          review_status               = 'APPROVED',
          goes_live_at                = coalesce(goes_live_at, now()),
          updated_at                  = now()
        where id = v_aid;
      else
        insert into public.vessel_availability (
          vessel_id, open_port_locode, open_zone, open_date, open_date_range_days,
          service_speed_kn, me_consumption_mt_day, me_consumption_port_mt_day, aux_consumption_port_mt_day,
          fuel_type, brob_mt, num_grabs, grab_capacity_mt, status, review_status, goes_live_at
        ) values (
          v_vid, pos->>'open_port_locode', nullif(pos->>'open_zone','')::public.zone_enum,
          nullif(pos->>'open_date','')::date, coalesce((pos->>'open_date_range_days')::smallint, 7),
          (pos->>'service_speed_kn')::numeric, (pos->>'me_consumption_mt_day')::numeric,
          (pos->>'me_consumption_port_mt_day')::numeric, (pos->>'aux_consumption_port_mt_day')::numeric,
          nullif(pos->>'fuel_type',''), (pos->>'brob_mt')::numeric,
          (pos->>'num_grabs')::smallint, (pos->>'grab_capacity_mt')::numeric,
          'OPEN', 'APPROVED', now()
        ) returning id into v_aid;
      end if;

      -- one active OPEN posting per vessel
      update public.vessel_availability set status = 'INACTIVE', updated_at = now()
        where vessel_id = v_vid and status = 'OPEN' and id <> v_aid;

      v_posted := v_posted + 1;

    elsif v_status in ('FIXED','OFF-HIRE','BALLAST','ON SUBS','INACTIVE') then
      v_target := (case v_status
                     when 'FIXED'    then 'FIXED'
                     when 'OFF-HIRE' then 'OFF-HIRE'
                     when 'BALLAST'  then 'BALLAST'
                     when 'ON SUBS'  then 'ON SUBS'
                     else 'INACTIVE' end)::public.vessel_status_enum;
      update public.vessel_availability set status = v_target, updated_at = now()
        where vessel_id = v_vid and status = 'OPEN';
      if found then v_closed := v_closed + 1; else v_skipped := v_skipped + 1; end if;
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;

  return jsonb_build_object('posted', v_posted, 'closed', v_closed, 'skipped', v_skipped);
end $$;

revoke all on function public.sync_vessel_positions(jsonb) from public, anon, authenticated;
grant execute on function public.sync_vessel_positions(jsonb) to service_role;

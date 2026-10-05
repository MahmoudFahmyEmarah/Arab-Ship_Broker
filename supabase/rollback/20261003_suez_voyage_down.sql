-- DOWN for Stream S (Voyage Economics): 20261003200000 … 205500.
-- Run it as ONE transaction (psql -1, or inside the migration harness): the first statement refuses otherwise,
-- so a failure can never leave a partially removed module.
-- Returns the schema to 677613e. Order: dependents first.
--
-- Used-state policy (C2O-039 P1-12). This DOWN destroys governed records: tariff versions, sources, SDR rates,
-- the event trail, vessel economics profiles, ECA geometry versions and saved voyage estimates. On a database
-- where any of them was created by a person (not by the seed migrations), it REFUSES to run unless the
-- operator first exported those tables and confirms it in the same session:
--     select set_config('asb.stream_s_down', 'export-taken:<where the export is>', false);
-- An admin-edited voyage_settings row (it no longer carries the seed marker) is owner data and is PRESERVED
-- (stamped seedMarker = owner-edited);
-- the 677613e application never reads it. Only the untouched seeded row is removed.
savepoint stream_s_down_requires_a_transaction;
release savepoint stream_s_down_requires_a_transaction;

do $used$
declare v_used text[] := '{}'; v_confirmed boolean; v_ref text;
begin
  -- The confirmation names the export it rests on (e.g. export-taken:asb-backups/prod-20261005b); it is logged and spent.
  v_ref := nullif(substring(coalesce(current_setting('asb.stream_s_down', true), '') from '^export-taken:(.{3,200})$'), '');
  v_confirmed := v_ref is not null;
  perform set_config('asb.stream_s_down', '', false); -- the confirmation is spent here; it never carries to a later statement
  if to_regclass('public.voyage_estimate_runs') is not null and exists (select 1 from public.voyage_estimate_runs) then v_used := v_used || 'saved voyage estimates'::text; end if;
  if to_regclass('public.sdr_rates') is not null and exists (select 1 from public.sdr_rates) then v_used := v_used || 'SDR rates'::text; end if;
  if to_regclass('public.suez_tariff_events') is not null and exists (select 1 from public.suez_tariff_events where origin = 'command') then v_used := v_used || 'admin tariff events'::text; end if;
  if to_regclass('public.vessel_economics_profiles') is not null and exists (select 1 from public.vessel_economics_profiles) then v_used := v_used || 'vessel economics profiles'::text; end if;
  if exists (select 1 from public.app_settings where key = 'voyage_settings' and coalesce(value ->> 'seedMarker', '') <> 'stream-s-20261003') then v_used := v_used || 'admin-edited voyage settings (preserved)'::text; end if;
  if cardinality(v_used) > 0 and not v_confirmed then
    raise exception 'STREAM_S_DOWN_REFUSED: this database holds governed records (%). Export them, then set asb.stream_s_down = ''export-taken:<where the export is>'' in this session and rerun.', array_to_string(v_used, ', ')
      using errcode = '55000';
  end if;
  if cardinality(v_used) > 0 then raise notice 'Stream S DOWN on a used database by % at %; export confirmed: %; removed: %', session_user, now(), v_ref, array_to_string(v_used, ', '); end if;
end
$used$;

-- 20261003205500 (review fixes)
drop function if exists public.fn_point_eca_zones(numeric, numeric, date);
drop trigger if exists trg_suez_event_origin on public.suez_tariff_events;
drop function if exists public.fn_suez_event_origin();

-- 20261003205400 (audit remediation): admin RPCs, ECA versions, helpers
drop function if exists public.admin_suez_create_version(uuid, jsonb, uuid);
drop function if exists public.admin_suez_publish(uuid, uuid, text);
drop function if exists public.admin_suez_save_item(uuid, uuid, uuid, jsonb);
drop function if exists public.admin_suez_delete_item(uuid, uuid, uuid);
drop function if exists public.admin_suez_replace_tiers(uuid, uuid, jsonb, text);
drop function if exists public.admin_suez_register_source(uuid, jsonb, uuid);
drop function if exists public.admin_suez_cite_source(uuid, uuid, uuid, boolean);
drop function if exists public.admin_voyage_save_settings(uuid, jsonb);
drop function if exists public.admin_eca_save_zone(uuid, jsonb);
drop function if exists public.admin_eca_set_active(uuid, text, boolean);
drop function if exists public.fn_suez_lock_draft(uuid);
drop function if exists public.fn_suez_validate_tiers(uuid);
drop function if exists public.fn_suez_event(text, uuid, uuid, text, jsonb);
drop function if exists public.fn_suez_require_admin(uuid);
drop function if exists public.fn_voyage_may_reference(uuid, text, uuid);
-- fn_is_anonymisation is used by guards of tables dropped below; it goes last (see the end of this file).
drop trigger if exists trg_eca_zone_record_version on public.eca_zones;
drop function if exists public.fn_eca_zone_record_version();
drop trigger if exists trg_eca_zone_versions_append_only on public.eca_zone_versions;
drop table if exists public.eca_zone_versions;
drop function if exists public.fn_eca_zone_versions_append_only();

-- 205000 / 205100 governance
drop trigger if exists trg_vep_events_append_only on public.vessel_economics_profile_events;
drop table if exists public.vessel_economics_profile_events;
-- 20261003205200 (governance fixes): admin RPCs and the service-role-safe actor resolver
drop function if exists public.admin_suez_set_window(uuid, uuid, date, text);
drop function if exists public.admin_suez_set_status(uuid, uuid, text);
drop function if exists public.admin_suez_delete_draft(uuid, uuid);
drop function if exists public.fn_suez_require_actor(uuid);
drop function if exists public.fn_suez_actor();
drop function if exists public.list_eca_zones(date);
drop function if exists public.fn_route_eca_split(text, text, date);
drop trigger if exists trg_sdr_rates_events on public.sdr_rates;
drop trigger if exists trg_sdr_rates_guard on public.sdr_rates;
drop function if exists public.fn_sdr_rates_events();
drop function if exists public.fn_sdr_rates_guard();
drop trigger if exists trg_suez_version_events on public.suez_tariff_versions;
drop function if exists public.fn_suez_version_events();
drop function if exists public.fn_suez_validate_version(uuid);
drop trigger if exists trg_suez_events_append_only on public.suez_tariff_events;
drop function if exists public.fn_suez_events_append_only();
drop table if exists public.suez_tariff_version_sources;
drop table if exists public.suez_tariff_events;
drop table if exists public.suez_tariff_sources;

drop function if exists public.list_my_voyage_estimates(integer);
drop function if exists public.get_voyage_estimate(uuid);
drop function if exists public.save_voyage_estimate(uuid, jsonb);
drop function if exists public.fn_can_read_voyage_run(uuid);
drop trigger if exists trg_voyage_lines_immutable on public.voyage_estimate_lines;
drop trigger if exists trg_voyage_run_immutable on public.voyage_estimate_runs;
drop function if exists public.fn_voyage_run_immutable();
drop table if exists public.voyage_estimate_lines;
drop table if exists public.voyage_estimate_runs;

drop function if exists public.fn_route_eca_split(text, text);
drop function if exists public.fn_point_in_ring(numeric, numeric, jsonb);
drop policy if exists "eca: members read active" on public.eca_zones;
drop table if exists public.eca_zones;

drop function if exists public.upsert_vessel_economics_profile(uuid, jsonb);
drop function if exists public.get_vessel_economics_profile(uuid);
drop function if exists public.fn_vessel_economics_allowed(uuid);
drop table if exists public.vessel_economics_profiles;

drop function if exists public.admin_list_suez_tariff_versions();
drop function if exists public.get_suez_tariff_context(date);
drop trigger if exists trg_suez_tiers_guard on public.suez_toll_tiers;
drop trigger if exists trg_suez_items_guard on public.suez_tariff_items;
drop trigger if exists trg_suez_version_guard on public.suez_tariff_versions;
drop trigger if exists trg_suez_version_no_overlap on public.suez_tariff_versions;
drop function if exists public.fn_suez_children_guard();
drop function if exists public.fn_suez_version_guard();
drop function if exists public.fn_suez_version_no_overlap();
drop table if exists public.suez_toll_tiers;
drop table if exists public.suez_tariff_items;
drop table if exists public.suez_tariff_versions;
drop table if exists public.sdr_rates;

-- Only the seeded row goes; an admin-edited row (the save drops the marker) stays, marked as owner data so a
-- later re-apply of 20261003205000 (which stamps unmarked rows as seed) can never turn it back into a seed row.
delete from public.app_settings where key = 'voyage_settings' and value ->> 'seedMarker' = 'stream-s-20261003';
update public.app_settings set value = value || '{"seedMarker": "owner-edited"}'::jsonb
 where key = 'voyage_settings' and not (value ? 'seedMarker');

-- 205400 helper used by the guards above (their tables are gone now)
drop function if exists public.fn_is_anonymisation(jsonb, jsonb, text[]);

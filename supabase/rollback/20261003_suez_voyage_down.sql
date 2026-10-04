-- DOWN for Stream S (Voyage Economics): 20261003200000, 200100, 201000, 202000, 203000, 204000, 205000, 205100.
-- Returns the schema to 677613e. Order: dependents first.

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

-- Only the seeded row goes; an admin-edited row (the save drops the marker) stays.
delete from public.app_settings where key = 'voyage_settings' and value ->> 'seedMarker' = 'stream-s-20261003';

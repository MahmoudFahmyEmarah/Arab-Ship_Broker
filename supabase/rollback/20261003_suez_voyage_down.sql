-- DOWN for Stream S (Voyage Economics): 20261003200000, 200100, 201000, 202000, 203000.
-- Returns the schema to 677613e. Order: dependents first.

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

delete from public.app_settings where key = 'voyage_settings';

-- ════════════════════════════════════════════════════════════════════
-- matches cache: shared eligibility view + full/incremental refresh +
-- triggers for IMMEDIATE updates on any cargo / availability / vessel change.
--
-- One gate definition (v_eligible_matches) feeds everything, so the cron full
-- refresh, the per-listing incremental refresh, and the triggers can never
-- drift from each other or from the get_matches_for_* RPCs.
--
-- Run this once in the Supabase SQL editor. Supersedes refresh_matches_function.sql.
-- ════════════════════════════════════════════════════════════════════

-- ── 1 · Shared eligibility view (same gates as the matching RPCs) ──────
create or replace view public.v_eligible_matches as
select
  s.cargo_id,
  s.vessel_avail_id,
  case when s.score >= 4 then 'Strong'
       when s.score >= 3 then 'Good'
       else 'Possible' end as score_label
from (
  select
    cl.id as cargo_id,
    va.id as vessel_avail_id,
    (case when (cl.qty_max_mt::numeric / nullif(v.dwt_grain, 0)) between 0.9 and 1.0 then 2
          when (cl.qty_max_mt::numeric / nullif(v.dwt_grain, 0)) between 0.8 and 1.1 then 1
          else 0 end)
    + (case when va.open_zone::text = cl.load_zone::text then 2
            when va.open_zone::text = cl.disch_zone::text then 1
            else 0 end)
    + (case when (cl.requires_geared is not true) or coalesce(v.is_geared, false) then 1 else 0 end)
      as score
  from public.cargo_listings cl
  join public.vessel_availability va
    on va.open_zone is not null
   and (va.open_zone::text = cl.load_zone::text or va.open_zone::text = cl.disch_zone::text)
  join public.vessels v on v.id = va.vessel_id
  where cl.review_status::text = 'APPROVED'
    and cl.status::text in ('IN', 'PARTIAL')
    and va.status::text = 'OPEN'
    and va.review_status::text = 'APPROVED'
    and v.is_sanctioned = false
    and v.dwt_grain is not null
    and (case
           when va.accepts_part_cargo then
             v.dwt_grain >= cl.qty_min_mt and v.dwt_grain <= cl.qty_max_mt * 1.20 and v.dwt_grain >= cl.qty_max_mt * 0.80
           else
             v.dwt_grain >= cl.qty_min_mt and v.dwt_grain <= cl.qty_max_mt * 1.10 and v.dwt_grain >= cl.qty_max_mt * 0.90
         end)
    and (cl.cargo_type::text = 'Break Bulk' or v.vessel_type::text in ('Bulk Carrier', 'General Cargo'))
    and (
      cl.is_spot = true
      or (va.open_date is not null and cl.laycan_from is not null
          and va.open_date between (cl.laycan_from - interval '21 days')::date
                               and (cl.laycan_from + interval '14 days')::date)
    )
    and (cl.requires_geared is null or cl.requires_geared = false or v.is_geared = true)
    and (cl.is_grain_cargo = false or coalesce(v.grain_certified, false) = true)
    and (cl.is_dg_cargo = false or coalesce(v.dg_certified, false) = true)
    and (cl.max_vessel_age_yr is null or v.build_year is null
         or (extract(year from now())::int - v.build_year) <= cl.max_vessel_age_yr)
    and (cl.max_draft_m is null or v.max_draft_m is null or v.max_draft_m <= cl.max_draft_m)
    and (cl.max_loa_m is null or v.max_loa_m is null or v.max_loa_m <= cl.max_loa_m)
) s;

-- ── 2 · Full refresh (cron) ────────────────────────────────────────────
create or replace function public.fn_refresh_matches()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.matches;
  insert into public.matches (cargo_id, vessel_avail_id, score_label, computed_at)
  select cargo_id, vessel_avail_id, score_label, now() from public.v_eligible_matches;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ── 3 · Incremental refresh (one cargo / one availability) ─────────────
create or replace function public.fn_refresh_matches_for_cargo(p_cargo_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.matches where cargo_id = p_cargo_id;
  insert into public.matches (cargo_id, vessel_avail_id, score_label, computed_at)
  select cargo_id, vessel_avail_id, score_label, now()
  from public.v_eligible_matches where cargo_id = p_cargo_id;
end;
$$;

create or replace function public.fn_refresh_matches_for_availability(p_availability_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.matches where vessel_avail_id = p_availability_id;
  insert into public.matches (cargo_id, vessel_avail_id, score_label, computed_at)
  select cargo_id, vessel_avail_id, score_label, now()
  from public.v_eligible_matches where vessel_avail_id = p_availability_id;
end;
$$;

-- ── 4 · Trigger functions (SECURITY DEFINER → bypass matches RLS) ──────
create or replace function public.trg_refresh_matches_cargo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.matches where cargo_id = old.id;
    return old;
  end if;
  perform public.fn_refresh_matches_for_cargo(new.id);
  return new;
end;
$$;

create or replace function public.trg_refresh_matches_availability()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    delete from public.matches where vessel_avail_id = old.id;
    return old;
  end if;
  perform public.fn_refresh_matches_for_availability(new.id);
  return new;
end;
$$;

-- A vessel spec change (dwt / type / certs / sanctioned …) affects every one
-- of its open positions, so recompute each.
create or replace function public.trg_refresh_matches_vessel()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from public.vessel_availability where vessel_id = new.id loop
    perform public.fn_refresh_matches_for_availability(r.id);
  end loop;
  return new;
end;
$$;

-- ── 5 · Triggers ───────────────────────────────────────────────────────
drop trigger if exists trg_matches_on_cargo on public.cargo_listings;
create trigger trg_matches_on_cargo
  after insert or update or delete on public.cargo_listings
  for each row execute function public.trg_refresh_matches_cargo();

drop trigger if exists trg_matches_on_availability on public.vessel_availability;
create trigger trg_matches_on_availability
  after insert or update or delete on public.vessel_availability
  for each row execute function public.trg_refresh_matches_availability();

drop trigger if exists trg_matches_on_vessel on public.vessels;
create trigger trg_matches_on_vessel
  after update on public.vessels
  for each row execute function public.trg_refresh_matches_vessel();

-- ── 6 · Grants + initial backfill ──────────────────────────────────────
grant execute on function public.fn_refresh_matches() to service_role;
grant execute on function public.fn_refresh_matches_for_cargo(uuid) to service_role;
grant execute on function public.fn_refresh_matches_for_availability(uuid) to service_role;

-- Recompute once now so the table matches this logic immediately.
select public.fn_refresh_matches();

notify pgrst, 'reload schema';

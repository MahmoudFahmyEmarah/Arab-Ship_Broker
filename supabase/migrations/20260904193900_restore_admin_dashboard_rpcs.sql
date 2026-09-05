-- ════════════════════════════════════════════════════════════════════════
-- Restore the admin dashboard's data objects (04 Sep 2026)
--
-- The console home calls get_admin_stats(), get_admin_activity(30) and reads
-- v_admin_queue_detail. All three were defined in the archived pre-baseline
-- migration 20260412000101 and never re-created after the database rebuild,
-- so every tile showed 0 and the queue/activity panels were empty.
-- Re-created here against today's schema: review_queue has submitted_at (no
-- created_at/updated_at) and admin identity is fn_is_admin().
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.get_admin_stats()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public.fn_is_admin() then raise exception 'Access denied'; end if;
  select jsonb_build_object(
    'queue_pending',        (select count(*) from public.review_queue where status = 'PENDING'),
    'queue_oldest_minutes', (select extract(epoch from (now() - min(submitted_at))) / 60 from public.review_queue where status = 'PENDING'),
    'cargo_live',           (select count(*) from public.cargo_listings where status in ('IN','PARTIAL') and review_status = 'APPROVED'),
    'cargo_pending',        (select count(*) from public.cargo_listings where review_status = 'PENDING'),
    'cargo_total_30d',      (select count(*) from public.cargo_listings where created_at >= now() - interval '30 days'),
    'vessel_open',          (select count(*) from public.vessel_availability where status = 'OPEN' and review_status = 'APPROVED'),
    'vessel_pending',       (select count(*) from public.vessel_availability where review_status = 'PENDING'),
    'users_total',          (select count(*) from public.users where role <> 'admin'),
    'users_active',         (select count(*) from public.users where is_active and role <> 'admin'),
    'users_new_tier',       (select count(*) from public.users where trust_tier = 'NEW' and role <> 'admin'),
    'users_verified_tier',  (select count(*) from public.users where trust_tier = 'VERIFIED' and role <> 'admin'),
    'users_flagged_tier',   (select count(*) from public.users where trust_tier = 'FLAGGED' and role <> 'admin'),
    'users_new_30d',        (select count(*) from public.users where created_at >= now() - interval '30 days' and role <> 'admin'),
    'vessels_total',        (select count(*) from public.vessels),
    'vessels_sanctioned',   (select count(*) from public.vessels where is_sanctioned),
    'vessels_high_risk',    (select count(*) from public.vessels where risk_level = 'HIGH'),
    'ports_unverified',     (select count(*) from public.ports where is_verified = false),
    'messages_unread',      (select count(*) from public.contact_messages where is_read = false)
  ) into v;
  return v;
end $$;
revoke all on function public.get_admin_stats() from public, anon;
grant execute on function public.get_admin_stats() to authenticated, service_role;

create or replace function public.get_admin_activity(p_days integer default 30)
returns table (day date, cargo_submitted bigint, vessel_submitted bigint, approved bigint, rejected bigint)
language plpgsql
stable security definer
set search_path to 'public'
as $$
begin
  if not public.fn_is_admin() then raise exception 'Access denied'; end if;
  return query
  with ds as (
    select generate_series((now() - (p_days - 1) * interval '1 day')::date, now()::date, interval '1 day')::date as day
  ),
  cd as (select created_at::date as day, count(*) as cnt from public.cargo_listings where created_at >= now() - p_days * interval '1 day' group by 1),
  vd as (select created_at::date as day, count(*) as cnt from public.vessel_availability where created_at >= now() - p_days * interval '1 day' group by 1),
  ad as (select reviewed_at::date as day, count(*) as cnt from public.review_queue where status = 'APPROVED' and reviewed_at >= now() - p_days * interval '1 day' group by 1),
  rd as (select reviewed_at::date as day, count(*) as cnt from public.review_queue where status in ('REJECTED','FLAGGED') and reviewed_at >= now() - p_days * interval '1 day' group by 1)
  select ds.day, coalesce(cd.cnt, 0), coalesce(vd.cnt, 0), coalesce(ad.cnt, 0), coalesce(rd.cnt, 0)
  from ds
  left join cd on cd.day = ds.day
  left join vd on vd.day = ds.day
  left join ad on ad.day = ds.day
  left join rd on rd.day = ds.day
  order by ds.day;
end $$;
revoke all on function public.get_admin_activity(integer) from public, anon;
grant execute on function public.get_admin_activity(integer) to authenticated, service_role;

-- Queue rows with listing previews (created_at kept as an alias of
-- submitted_at so the existing pages keep working unchanged).
create or replace view public.v_admin_queue_detail
with (security_invoker = true) as
select
  rq.id, rq.listing_type, rq.listing_id, rq.submitted_by, rq.trust_tier_at_submit, rq.is_random_sample,
  rq.review_reason, rq.status, rq.action_taken, rq.amendment_detail, rq.reviewed_by, rq.reviewed_at,
  rq.submitted_at as created_at, coalesce(rq.reviewed_at, rq.submitted_at) as updated_at,
  u.full_name as submitter_name, u.email as submitter_email, u.trust_tier as submitter_trust_tier,
  u.clean_posts as submitter_clean_posts, u.strike_count as submitter_strike_count,
  cl.ref as cargo_ref, cl.commodity_name, cl.cargo_type, cl.qty_min_mt, cl.qty_max_mt,
  cl.load_port_name, cl.load_zone, cl.disch_port_name, cl.disch_zone, cl.laycan_from, cl.laycan_to, cl.is_spot,
  cl.status as cargo_status, cl.review_status as cargo_review_status,
  va.vessel_id, v.vessel_name, v.vessel_type, v.dwt_grain, v.risk_level, v.is_sanctioned,
  va.open_port_name, va.open_zone, va.open_date, va.status as vessel_status, va.review_status as vessel_review_status
from public.review_queue rq
left join public.users u on u.supabase_user_id = rq.submitted_by or u.id = rq.submitted_by
left join public.cargo_listings cl on cl.id = rq.listing_id and rq.listing_type = 'cargo'
left join public.vessel_availability va on va.id = rq.listing_id and rq.listing_type = 'vessel_availability'
left join public.vessels v on v.id = va.vessel_id;
grant select on public.v_admin_queue_detail to authenticated, service_role;

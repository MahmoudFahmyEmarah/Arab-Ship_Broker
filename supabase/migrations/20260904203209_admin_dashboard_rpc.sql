-- ════════════════════════════════════════════════════════════════════════
-- Admin console dashboard feed (04 Sep 2026)
--
-- One admin-only RPC that returns everything the redesigned console home
-- needs in a single round trip: platform health (database, pg_cron, match
-- cache, Market Insights, email/WhatsApp ingest, LLM credential, security
-- posture computed from pg_catalog), the "needs your action" counters, the
-- market pulse, user figures, ingestion batches + data-quality counters and
-- a per-bucket time series for the selected range. Mirrors get_admin_stats()
-- (kept for the sidebar badge and older pages) but is range-aware.
--
-- p_days ≤ 1 buckets by hour (24 h view); otherwise by day.
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.get_admin_dashboard(p_days integer default 7)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare
  v_days     integer := greatest(1, least(coalesce(p_days, 7), 365));
  v_since    timestamptz;
  v_hourly   boolean;
  v_out      jsonb;
  v_series   jsonb;
begin
  if not public.fn_is_admin() then raise exception 'Access denied'; end if;

  v_hourly := v_days <= 1;
  v_since  := case when v_hourly then now() - interval '24 hours' else now() - (v_days * interval '1 day') end;

  -- ── time series (posted cargo / vessels / sign-ups per bucket) ──────────
  with b as (
    select t from generate_series(
      case when v_hourly then date_trunc('hour', now()) - interval '23 hours' else (now()::date - (v_days - 1))::timestamptz end,
      case when v_hourly then date_trunc('hour', now()) else now()::date::timestamptz end,
      case when v_hourly then interval '1 hour' else interval '1 day' end
    ) as t
  ),
  c as (
    select case when v_hourly then date_trunc('hour', created_at) else date_trunc('day', created_at) end as t,
           count(*) as n, count(*) filter (where batch_id is not null) as nb
    from public.cargo_listings where created_at >= v_since group by 1
  ),
  v as (
    select case when v_hourly then date_trunc('hour', created_at) else date_trunc('day', created_at) end as t, count(*) as n
    from public.vessel_availability where created_at >= v_since group by 1
  ),
  u as (
    select case when v_hourly then date_trunc('hour', created_at) else date_trunc('day', created_at) end as t, count(*) as n
    from public.users where role <> 'admin' and created_at >= v_since group by 1
  )
  select jsonb_agg(jsonb_build_object(
           't', b.t, 'cargo', coalesce(c.n, 0), 'cargo_batch', coalesce(c.nb, 0),
           'vessels', coalesce(v.n, 0), 'signups', coalesce(u.n, 0)) order by b.t)
    into v_series
  from b left join c on c.t = b.t left join v on v.t = b.t left join u on u.t = b.t;

  select jsonb_build_object(
    'generated_at', now(),
    'range_days', v_days,
    'hourly', v_hourly,

    'db', jsonb_build_object(
      'size_mb',        round(pg_database_size(current_database()) / 1048576.0, 1),
      'connections',    (select count(*) from pg_stat_activity),
      'max_connections', current_setting('max_connections')::int,
      'functions',      (select count(*) from information_schema.routines where routine_schema = 'public'),
      'views',          (select count(*) from information_schema.views where table_schema = 'public'),
      'tables',         (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')
    ),

    'cron_groupmail', (
      select jsonb_build_object(
        'active',      j.active,
        'schedule',    j.schedule,
        'last_start',  (select max(start_time) from cron.job_run_details d where d.jobid = j.jobid),
        'last_status', (select status from cron.job_run_details d where d.jobid = j.jobid order by start_time desc limit 1),
        'last_msg',    (select left(return_message, 120) from cron.job_run_details d where d.jobid = j.jobid order by start_time desc limit 1),
        'runs_24h',    (select count(*) from cron.job_run_details d where d.jobid = j.jobid and start_time > now() - interval '24 hours'),
        'failed_24h',  (select count(*) from cron.job_run_details d where d.jobid = j.jobid and start_time > now() - interval '24 hours' and status <> 'succeeded')
      ) from cron.job j where j.jobname = 'groupmail-dispatch' limit 1
    ),

    'groupmail', (
      select jsonb_build_object(
        'campaigns',  count(*),
        'recipients', coalesce(sum(recipients_total), 0),
        'sent_ok',    coalesce(sum(sent_ok), 0),
        'sent_fail',  coalesce(sum(sent_fail), 0),
        'last_at',    max(created_at),
        'queued',     count(*) filter (where status not in ('done', 'failed', 'cancelled')),
        'in_range',   count(*) filter (where created_at >= v_since)
      ) from public.groupmail_campaign
    ),

    'matches', jsonb_build_object(
      'n',             (select count(*) from public.matches),
      'computed_at',   (select max(computed_at) from public.matches),
      'cargo_matched', (select count(distinct cargo_id) from public.matches)
    ),

    'insights', jsonb_build_object(
      'editions',          (select count(*) from public.market_insights_editions),
      'last_week',         (select week_id from public.market_insights_editions order by published_at desc nulls last limit 1),
      'last_published_at', (select max(published_at) from public.market_insights_editions),
      'subscribers',       (select count(*) from public.market_insights_subscribers)
    ),

    'email', jsonb_build_object(
      'enabled',           (select is_enabled from public.email_ingest_config limit 1),
      'config_updated_at', (select updated_at from public.email_ingest_config limit 1),
      'last_sync_at',      (select last_sync_at from public.sync_source_state where source = 'email'),
      'last_batch_at',     (select max(created_at) from public.sync_batch where source = 'email'),
      'last_batch_status', (select status from public.sync_batch where source = 'email' order by created_at desc limit 1)
    ),
    'upload', jsonb_build_object(
      'last_sync_at',  (select last_sync_at from public.sync_source_state where source = 'upload'),
      'last_batch_at', (select max(created_at) from public.sync_batch where source = 'upload')
    ),

    'whatsapp', (
      select jsonb_build_object(
        'state',       r.state,
        'worker_seen', r.worker_seen,
        'linked_as',   r.linked_as,
        'updated_at',  r.updated_at,
        'messages',    (select count(*) from public.whatsapp_message),
        'last_message_at', (select max(received_at) from public.whatsapp_message),
        'in_range',    (select count(*) from public.whatsapp_message where received_at >= v_since)
      ) from public.whatsapp_runtime r limit 1
    ),

    'llm', (
      select jsonb_build_object('vendor', vendor, 'model', model, 'key_hint', key_hint, 'is_active', is_active, 'updated_at', updated_at)
      from public.llm_credential where is_active order by updated_at desc limit 1
    ),

    'security', jsonb_build_object(
      'definer_views', (
        select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'v'
          and not coalesce((select bool_or(o like 'security_invoker=%true%' or o like 'security_invoker=%on%') from unnest(coalesce(c.reloptions, '{}'::text[])) o), false)
      ),
      'definer_fn_anon', (
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
      ),
      'mutable_search_path', (
        select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) c where c like 'search_path=%')
      ),
      'rls_off_tables', (
        select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
      )
    ),

    'market', jsonb_build_object(
      'cargo_live',      (select count(*) from public.cargo_listings where status in ('IN','PARTIAL') and review_status = 'APPROVED'),
      'cargo_total',     (select count(*) from public.cargo_listings),
      'cargo_in_range',  (select count(*) from public.cargo_listings where created_at >= v_since),
      'cargo_batch_in_range',  (select count(*) from public.cargo_listings where created_at >= v_since and batch_id is not null),
      'cargo_member_in_range', (select count(*) from public.cargo_listings where created_at >= v_since and batch_id is null),
      'vessel_open',     (select count(*) from public.vessel_availability where status = 'OPEN' and review_status = 'APPROVED'),
      'vessel_total',    (select count(*) from public.vessel_availability),
      'vessel_in_range', (select count(*) from public.vessel_availability where created_at >= v_since),
      'vessel_from_review', (select count(*) from public.vessel_review_queue where status = 'synced'),
      'whatsapp_in_range', (select count(*) from public.whatsapp_message where received_at >= v_since),
      'zones', (
        select coalesce(jsonb_agg(jsonb_build_object('zone', z, 'n', n) order by n desc), '[]'::jsonb)
        from (select load_zone::text as z, count(*) as n from public.cargo_listings
              where status in ('IN','PARTIAL') and review_status = 'APPROVED' and load_zone is not null
              group by 1 order by 2 desc limit 6) s
      ),
      'laycan', (
        select jsonb_build_object(
          'past',  count(*) filter (where laycan_from < current_date),
          'week',  count(*) filter (where laycan_from >= current_date and laycan_from < current_date + 7),
          'next',  count(*) filter (where laycan_from >= current_date + 7 and laycan_from < current_date + 14),
          'later', count(*) filter (where laycan_from >= current_date + 14),
          'none',  count(*) filter (where laycan_from is null))
        from public.cargo_listings where status in ('IN','PARTIAL') and review_status = 'APPROVED'
      ),
      'bands', (
        select jsonb_build_object(
          'handy',   count(*) filter (where v.dwt_grain < 40000),
          'supra',   count(*) filter (where v.dwt_grain >= 40000 and v.dwt_grain < 60000),
          'ultra',   count(*) filter (where v.dwt_grain >= 60000 and v.dwt_grain < 70000),
          'pmax',    count(*) filter (where v.dwt_grain >= 70000 and v.dwt_grain < 100000),
          'cape',    count(*) filter (where v.dwt_grain >= 100000),
          'unknown', count(*) filter (where v.dwt_grain is null))
        from public.vessel_availability va left join public.vessels v on v.id = va.vessel_id
        where va.status = 'OPEN' and va.review_status = 'APPROVED'
      ),
      'commodities', (
        select coalesce(jsonb_agg(jsonb_build_object('name', commodity_name, 'n', n) order by n desc), '[]'::jsonb)
        from (select commodity_name, count(*) as n from public.cargo_listings
              where status in ('IN','PARTIAL') and review_status = 'APPROVED' and commodity_name is not null
              group by 1 order by 2 desc limit 5) s
      ),
      'routes', (
        select jsonb_build_object(
          'routes', count(*),
          'suez',   count(*) filter (where 'SUEZ' = any(r.chokepoints)),
          'risk',   count(*) filter (where r.chokepoints && array['BAB_EL_MANDEB','HORMUZ']),
          'risk_areas', (select count(*) from public.risk_areas where is_active))
        from (select distinct load_port_locode, disch_port_locode from public.cargo_listings
              where status in ('IN','PARTIAL') and review_status = 'APPROVED'
                and load_port_locode is not null and disch_port_locode is not null) c
        join public.port_routes r
          on (r.pol_locode = c.load_port_locode and r.pod_locode = c.disch_port_locode)
          or (r.pol_locode = c.disch_port_locode and r.pod_locode = c.load_port_locode)
      )
    ),

    'users', jsonb_build_object(
      'total',         (select count(*) from public.users where role <> 'admin'),
      'active',        (select count(*) from public.users where is_active and role <> 'admin'),
      'admins',        (select count(*) from public.users where role = 'admin'),
      'new_tier',      (select count(*) from public.users where trust_tier = 'NEW' and role <> 'admin'),
      'verified_tier', (select count(*) from public.users where trust_tier = 'VERIFIED' and role <> 'admin'),
      'flagged_tier',  (select count(*) from public.users where trust_tier = 'FLAGGED' and role <> 'admin'),
      'tiers',         (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select coalesce(subscription_tier::text, '—') k, count(*) n from public.users where role <> 'admin' group by 1) s),
      'roles',         (select coalesce(jsonb_object_agg(k, n), '{}'::jsonb) from (select role k, count(*) n from public.users where role <> 'admin' group by 1) s),
      'signups_range', (select count(*) from public.users where role <> 'admin' and created_at >= v_since),
      'auth_total',    (select count(*) from auth.users),
      'active_d1',     (select count(*) from auth.users where last_sign_in_at > now() - interval '1 day'),
      'active_d7',     (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days'),
      'active_d30',    (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days'),
      'active_range',  (select count(*) from auth.users where last_sign_in_at >= v_since),
      'companies',     (select count(*) from public.organizations),
      'seats',         (select count(*) from public.organization_members where is_current and coalesce(status, 'active') = 'active'),
      'membership_pending', (select count(*) from public.organization_members where coalesce(status, 'active') not in ('active', 'rejected', 'declined')),
      'membership_oldest',  (select min(added_at) from public.organization_members where coalesce(status, 'active') not in ('active', 'rejected', 'declined')),
      'posters_range', (select count(distinct owner_user_id) from public.listing_ownership where is_current and owned_from >= v_since),
      'estimates_range', (select count(*) from public.voyage_estimates where created_at >= v_since)
    ),

    'ingest', jsonb_build_object(
      'batches', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', id, 'source', source, 'status', status, 'label', label, 'file_name', file_name,
          'created_at', created_at, 'committed_at', committed_at, 'undone_at', undone_at, 'has_error', error is not null,
          'new',     coalesce((counts->'cargo'->>'new')::int, 0)     + coalesce((counts->'vessels'->>'new')::int, 0),
          'updated', coalesce((counts->'cargo'->>'updated')::int, 0) + coalesce((counts->'vessels'->>'updated')::int, 0),
          'invalid', coalesce((counts->'cargo'->>'invalid')::int, 0) + coalesce((counts->'vessels'->>'invalid')::int, 0),
          'errors',  coalesce((counts->'cargo'->>'errors')::int, 0)  + coalesce((counts->'vessels'->>'errors')::int, 0)
        ) order by created_at desc), '[]'::jsonb)
        from (select * from public.sync_batch order by created_at desc limit 6) b
      ),
      'batches_total',   (select count(*) from public.sync_batch),
      'draft_batches',   (select count(*) from public.sync_batch where status = 'draft'),
      'draft_oldest',    (select min(created_at) from public.sync_batch where status = 'draft'),
      'staged_total',    (select count(*) from public.sync_staged_row),
      'staged_invalid',  (select count(*) from public.sync_staged_row where classification = 'invalid'),
      'staged_unchanged',(select count(*) from public.sync_staged_row where classification = 'unchanged'),
      'staged_new',      (select count(*) from public.sync_staged_row where classification = 'new'),
      'staged_updated',  (select count(*) from public.sync_staged_row where classification = 'updated'),
      'crq_pending',     (select count(*) from public.commodity_review_queue where status = 'pending'),
      'crq_oldest',      (select min(created_at) from public.commodity_review_queue where status = 'pending'),
      'crq_ignored',     (select count(*) from public.commodity_review_queue where status = 'ignored'),
      'crq_resolved_range', (select count(*) from public.commodity_review_queue where resolved_at >= v_since),
      'vrq_pending',     (select count(*) from public.vessel_review_queue where status = 'pending'),
      'vrq_oldest',      (select min(created_at) from public.vessel_review_queue where status = 'pending'),
      'vrq_ignored',     (select count(*) from public.vessel_review_queue where status = 'ignored'),
      'vrq_synced',      (select count(*) from public.vessel_review_queue where status = 'synced'),
      'vrq_resolved_range', (select count(*) from public.vessel_review_queue where resolved_at >= v_since),
      'unresolved_ports', (select count(*) from public.cargo_listings where status in ('IN','PARTIAL') and review_status = 'APPROVED' and load_port_locode is null),
      'blank_positions', (select count(*) from public.vessel_availability where status = 'OPEN' and review_status = 'APPROVED' and open_port_locode is null and open_zone is null),
      'blank_oldest',    (select min(created_at) from public.vessel_availability where status = 'OPEN' and review_status = 'APPROVED' and open_port_locode is null and open_zone is null),
      'flag_issues',     (select count(*) from public.v_vessel_flag_issues),
      'last_batch_fix',  (select coalesce((counts->'cargo'->>'invalid')::int, 0) + coalesce((counts->'cargo'->>'errors')::int, 0)
                                 + coalesce((counts->'vessels'->>'invalid')::int, 0) + coalesce((counts->'vessels'->>'errors')::int, 0)
                          from public.sync_batch where status = 'committed' order by created_at desc limit 1),
      'last_batch_at',   (select created_at from public.sync_batch where status = 'committed' order by created_at desc limit 1)
    ),

    'tasks', jsonb_build_object(
      'queue_pending',    (select count(*) from public.review_queue where status = 'PENDING'),
      'queue_oldest',     (select min(submitted_at) from public.review_queue where status = 'PENDING'),
      'messages_unread',  (select count(*) from public.contact_messages where is_read = false),
      'messages_oldest',  (select min(created_at) from public.contact_messages where is_read = false),
      'expiring_3d',      (select count(*) from public.cargo_listings where status in ('IN','PARTIAL') and review_status = 'APPROVED' and laycan_to between current_date and current_date + 3),
      'first_expiry',     (select min(laycan_to) from public.cargo_listings where status in ('IN','PARTIAL') and review_status = 'APPROVED' and laycan_to between current_date and current_date + 3),
      'ports_unverified', (select count(*) from public.ports where is_verified = false),
      'ports_unverified_oldest', (select min(created_at) from public.ports where is_verified = false),
      'high_risk_7d',     (select count(*) from public.vessels where (is_sanctioned or risk_level = 'HIGH') and updated_at > now() - interval '7 days'),
      'sanctioned',       (select count(*) from public.vessels where is_sanctioned),
      'high_risk',        (select count(*) from public.vessels where risk_level = 'HIGH')
    ),

    'series', coalesce(v_series, '[]'::jsonb),
    'thresholds', (select value from public.app_settings where key = 'admin_alert_thresholds')
  ) into v_out;

  return v_out;
end $$;

revoke all on function public.get_admin_dashboard(integer) from public, anon;
grant execute on function public.get_admin_dashboard(integer) to authenticated, service_role;

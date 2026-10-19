-- ════════════════════════════════════════════════════════════════════════
-- PDA · the Ports workspace read (owner ruling O2ALL-008, 18 Oct 2026; increment C)
--
-- One governed, read-only RPC behind the Ports tab of /dashboard/ports-da. It replaces the reference prototype's
-- browser-stored "record arms" with facts the database already holds, so a port can never look covered when it is not:
--   * every active, verified port (locode, name, country, zone, coordinates for the map);
--   * its active, verified terminals (names only);
--   * every tariff PUBLISHED and in force on the call date (port-wide or terminal scope): the frozen member-facing
--     edition label (20261013300000), currency, effective dates, published time, the publisher's name and type, the
--     primary source's authority, the number of charge lines, and WHICH of the nine route services it prices.
--
-- "Prices a service" uses the estimator's own rule (lib/pda/calculate.ts governedServiceCodes): a rule's code, or its
-- applicability.requestedServices when that list has exactly one entry; only the nine codes of
-- lib/pda/route-types.ts PDA_ROUTE_SERVICE_CODES count. No internal id (version, set, terminal, publisher, source) is
-- returned (C2O-126: members see the edition, never an internal id).
--
-- Same gate as list_pda_coverage: signed in and fn_pda_member_entitled() (T3+, partner or admin). Read only, STABLE,
-- SECURITY DEFINER with an empty search_path; authenticated + service_role only. Plain SQL (no psql meta-commands).
-- DOWN: supabase/rollback/20261018100000_pda_ports_workspace_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';

create or replace function public.list_pda_ports_workspace(p_call_date date default current_date)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_services constant text[] := array['port_dues','pilotage','towage','mooring','cargo_handling','agency','waste','security','launch'];
  v_result jsonb;
begin
  if public.fn_app_user_id() is null then
    raise exception 'PDA_AUTH: sign in required' using errcode = '42501';
  end if;
  if not public.fn_pda_member_entitled() then
    raise exception 'PDA_TIER: PDA Estimator requires Subscriber tier (T3+)' using errcode = '42501';
  end if;
  if p_call_date is null then
    raise exception 'PDA_VALIDATION: a call date is required' using errcode = '22023';
  end if;

  with effective as (
    -- the version in force on the call date for each tariff set (latest effective_from, then latest version)
    select distinct on (s.id)
      s.id as set_id, s.port_locode, s.terminal_id, s.scope, s.publisher_id,
      v.id as version_id, v.edition_label, v.currency, v.effective_from, v.effective_to, v.published_at, v.primary_source_id
    from public.port_tariff_sets s
    join public.port_tariff_versions v on v.tariff_set_id = s.id and v.status = 'published'
    where s.is_active
      and v.effective_from <= p_call_date
      and (v.effective_to is null or v.effective_to >= p_call_date)
    order by s.id, v.effective_from desc, v.version_no desc
  ),
  priced as (
    select e.version_id,
           count(distinct r.id) as rule_count,
           coalesce(array_agg(distinct c.code order by c.code) filter (where c.code = any (v_services)), '{}') as services
    from effective e
    left join public.port_tariff_rules r on r.tariff_version_id = e.version_id
    left join lateral (
      select lower(r.code) as code
      union
      select lower(r.applicability->'requestedServices'->>0)
       where jsonb_typeof(r.applicability->'requestedServices') = 'array'
         and jsonb_array_length(r.applicability->'requestedServices') = 1
    ) c on r.id is not null
    group by e.version_id
  ),
  tariffs as (
    select e.port_locode,
           jsonb_agg(jsonb_build_object(
             'scope', e.scope,
             'terminalName', t.name,
             'editionLabel', e.edition_label,
             'currency', e.currency,
             'effectiveFrom', e.effective_from,
             'effectiveTo', e.effective_to,
             'publishedAt', e.published_at,
             'publisherName', pub.name,
             'publisherType', pub.publisher_type,
             'sourceAuthority', src.authority,
             'ruleCount', coalesce(pr.rule_count, 0),
             'services', to_jsonb(coalesce(pr.services, '{}'::text[]))
           ) order by t.name nulls first, e.scope, e.edition_label) as items
    from effective e
    left join public.port_terminals t on t.id = e.terminal_id and t.is_active and t.is_verified
    left join public.tariff_publishers pub on pub.id = e.publisher_id
    left join public.tariff_sources src on src.id = e.primary_source_id
    left join priced pr on pr.version_id = e.version_id
    -- a terminal-scoped tariff whose terminal is no longer active and verified is not shown
    where e.terminal_id is null or t.id is not null
    group by e.port_locode
  ),
  terminals as (
    select t.port_locode, jsonb_agg(t.name order by t.name) as names
    from public.port_terminals t
    where t.is_active and t.is_verified
    group by t.port_locode
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'locode', p.locode,
           'name', p.trade_name,
           'country', p.country,
           'zone', p.zone,
           'latitude', p.latitude,
           'longitude', p.longitude,
           'terminals', coalesce(tm.names, '[]'::jsonb),
           'tariffs', coalesce(tf.items, '[]'::jsonb)
         ) order by p.trade_name, p.locode), '[]'::jsonb)
    into v_result
  from public.ports p
  left join terminals tm on tm.port_locode = p.locode
  left join tariffs tf on tf.port_locode = p.locode
  where p.is_active and p.is_verified;

  return jsonb_build_object('callDate', p_call_date, 'ports', v_result);
end;
$$;
revoke all on function public.list_pda_ports_workspace(date) from public, anon;
grant execute on function public.list_pda_ports_workspace(date) to authenticated, service_role;

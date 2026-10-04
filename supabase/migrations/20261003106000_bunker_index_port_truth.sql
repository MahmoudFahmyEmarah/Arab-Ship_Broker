-- Fuel Bar: fuel price index corrections from Codex's audit C2B-002 #4 and
-- hardening, following the recommendation in C2O-033 (PENDING the architect's
-- ruling; amend here if Fable rules otherwise).
--
--  * `port` is the port actually used: set only for scope 'port'. A region or
--    global answer returns port = null, the requested port in `requestedPort`,
--    the zone in `region` (region scope only) and the sorted ports whose quotes
--    were counted in `contributingPorts` (never a supplier identity).
--  * An empty product list is refused (22023); null still means the default slots.
-- Everything else is unchanged from 20261003102000.

create or replace function public.get_fuel_price_index(
  p_port_locode  text default null,
  p_product_keys text[] default null,
  p_as_of        timestamptz default now(),
  p_stem_mt      numeric default 500
) returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_as_of     timestamptz := coalesce(p_as_of, now());
  v_port      text := nullif(upper(btrim(coalesce(p_port_locode, ''))), '');
  v_zone      text;
  v_eca       boolean := false;
  v_bad       text;
  v_requested text[];
  v_expected  text[];
  v_scope     text;
  v_products  jsonb;
  v_avg       jsonb;
  v_ports     jsonb;
  -- Members are the only callers whose JWT role is 'authenticated' (anon has
  -- no grant); admins, the service role and direct connections see full stats.
  v_full      boolean := public.fn_is_admin()
                         or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated';
begin
  if p_stem_mt is null or p_stem_mt <= 0 or p_stem_mt > 100000 then
    raise exception 'BUNKER_STEM: stem must be between 0 and 100000 MT' using errcode = '22023';
  end if;
  if p_product_keys is not null and cardinality(p_product_keys) = 0 then
    raise exception 'BUNKER_PRODUCT: the product list is empty; pass null for the default products'
      using errcode = '22023';
  end if;
  if p_product_keys is not null then
    select k into v_bad
      from unnest(p_product_keys) k
     where not exists (select 1 from public.fuel_products f where f.key = k and f.is_active)
     limit 1;
    if v_bad is not null then
      raise exception 'BUNKER_PRODUCT: unknown fuel product %', v_bad using errcode = '22023';
    end if;
  end if;

  if v_port is not null then
    select p.zone::text into v_zone from public.ports p where p.locode = v_port;
    if not found then
      raise exception 'BUNKER_PORT: unknown port %', v_port using errcode = '22023';
    end if;
    select coalesce(bool_or(f.eca_zone is not null), false) into v_eca
      from public.bunker_port_flags f where f.port_locode = v_port;
  end if;

  -- Requested products are quoted; expected products are reported in noOffer.
  if p_product_keys is not null then
    v_requested := p_product_keys;
    v_expected  := p_product_keys;
  else
    select array_agg(f.key order by f.sort_order),
           array_agg(f.key order by f.sort_order) filter (where f.core_slot or (f.eca_slot and v_eca))
      into v_requested, v_expected
      from public.fuel_products f where f.is_active;
  end if;

  -- Fall back as a whole request: the first scope holding any live quote for
  -- a requested product wins; products it lacks go to noOffer.
  if v_port is not null and exists (
       select 1 from public.fn_bunker_live_quotes(v_as_of, p_stem_mt) l
        where l.port_locode = v_port and l.product_key = any (v_requested)) then
    v_scope := 'port';
  elsif v_zone is not null and v_zone <> 'Unknown' and exists (
       select 1 from public.fn_bunker_live_quotes(v_as_of, p_stem_mt) l
        where l.zone = v_zone and l.product_key = any (v_requested)) then
    v_scope := 'region';
  else
    v_scope := 'global';
  end if;

  with in_scope as (
    select l.*
      from public.fn_bunker_live_quotes(v_as_of, p_stem_mt) l
     where l.product_key = any (v_requested)
       and case v_scope
             when 'port'   then l.port_locode = v_port
             when 'region' then l.zone = v_zone
             else true
           end
  ), one_per_supplier as (
    select distinct on (l.supplier_id, l.product_key) l.*
      from in_scope l
     order by l.supplier_id, l.product_key, l.submitted_at desc, l.port_locode
  ), agg as (
    select o.product_key,
           round(avg(o.normalised_usd_mt), 2) as avg_p,
           round(min(o.normalised_usd_mt), 2) as min_p,
           round((percentile_cont(0.5) within group (order by o.normalised_usd_mt))::numeric, 2) as med_p,
           round(max(o.normalised_usd_mt), 2) as max_p,
           count(*) as n,
           max(o.submitted_at) as latest
      from one_per_supplier o
     group by o.product_key
  )
  , contributors as (
    select coalesce(jsonb_agg(distinct o.port_locode order by o.port_locode), '[]'::jsonb) as ports
      from one_per_supplier o
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', f.key, 'label', f.market_label, 'family', f.family, 'sulphurClass', f.sulphur_class,
           'averageUsdMt', a.avg_p,
           'minUsdMt',    case when v_full or a.n >= 3 then a.min_p end,
           'medianUsdMt', case when v_full or a.n >= 3 then a.med_p end,
           'maxUsdMt',    case when v_full or a.n >= 3 then a.max_p end,
           'quoteCount', a.n,
           'cohortSuppressed', not (v_full or a.n >= 3),
           'freshness', case when v_as_of - a.latest <= interval '7 days' then 'current' else 'stale' end,
           'latestQuoteAt', to_char(date_trunc('hour', a.latest at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
           'normalised', true
         ) order by f.sort_order), '[]'::jsonb),
         coalesce(jsonb_object_agg(f.key, a.avg_p), '{}'::jsonb),
         (select ports from contributors)
    into v_products, v_avg, v_ports
    from agg a join public.fuel_products f on f.key = a.product_key
   where a.avg_p > 0;

  return jsonb_build_object(
    'asOf', to_char(v_as_of at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    -- port = the port actually used: only a port-scope answer names one.
    'port', case when v_scope = 'port' then v_port end,
    'requestedPort', v_port,
    'scope', v_scope,
    'region', case when v_scope = 'region' then v_zone end,
    'contributingPorts', coalesce(v_ports, '[]'::jsonb),
    'stemMt', p_stem_mt,
    'products', v_products,
    'spreads', jsonb_build_object(
      'hsfoVlsfo',  round((v_avg->>'HSFO380')::numeric - (v_avg->>'VLSFO')::numeric, 2),
      'vlsfoLsmgo', round((v_avg->>'LSMGO')::numeric - (v_avg->>'VLSFO')::numeric, 2)),
    'noOffer', coalesce((
      select jsonb_agg(k order by f.sort_order)
        from unnest(v_expected) k join public.fuel_products f on f.key = k
       where not (v_avg ? k)), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_fuel_price_index(text, text[], timestamptz, numeric) from public, anon;
grant execute on function public.get_fuel_price_index(text, text[], timestamptz, numeric) to authenticated, service_role;

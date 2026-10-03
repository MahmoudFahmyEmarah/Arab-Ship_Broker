-- Fuel Bar member reads: the fuel price index (plan r2 §4.1, the cross-stream
-- contract) and the ticker strip. lib/bunker/{freshness,index}.ts mirror the
-- arithmetic here; scripts/bunker-check.ts and supabase/tests/bunker_suite.sql
-- hold the same fixtures so the two cannot drift apart unnoticed.
--
-- Rules:
--   * a quote counts in the index when approved, valid at as_of (valid_from
--     <= as_of <= valid_until), submitted within 14 days before as_of, not
--     superseded by as_of, applicable to the requested stem (min_qty_mt <=
--     stem), and its supplier is enabled; one quote per supplier and product
--     (the latest submitted wins). as_of evaluates freshness and validity; it
--     is not a replay of past approval decisions;
--   * normalised price = price + (barge fee + mandatory charges) / stem, the
--     fees being fixed per delivery (plan r2.1 §3; stem default 500 MT);
--   * averageUsdMt (what the voyage estimator consumes) is the arithmetic mean
--     of the normalised prices; min/median/max/count are for review;
--   * never zero: a product without a live quote goes to noOffer;
--   * fallback port -> same trading zone (ports.zone) -> global, reported in
--     scope; the index never names a supplier;
--   * small cohorts (O2B-003): for members, a product quoted by fewer than 3
--     suppliers returns only average/count/freshness; min/median/max are null
--     and cohortSuppressed is true. Admins and the service role see all;
--   * latestQuoteAt is bucketed to the hour (plan r2.1 §2).
--   Ticker freshness by age of the newest quote: <= 7 d current, 8-14 d stale,
--   15-21 d expired ("Outdated"), > 21 d hidden.

create or replace function public.fn_bunker_normalised_price(
  p_price numeric, p_barge_fee numeric, p_mandatory numeric, p_stem_mt numeric
) returns numeric
language sql immutable parallel safe set search_path to ''
as $$
  select p_price + (coalesce(p_barge_fee, 0) + coalesce(p_mandatory, 0)) / p_stem_mt
$$;
revoke all on function public.fn_bunker_normalised_price(numeric, numeric, numeric, numeric)
  from public, anon, authenticated;

create or replace function public.fn_bunker_freshness(p_age interval)
returns text
language sql immutable parallel safe set search_path to ''
as $$
  select case
    when p_age <= interval '7 days'  then 'current'
    when p_age <= interval '14 days' then 'stale'
    when p_age <= interval '21 days' then 'expired'
    else 'hidden'
  end
$$;
revoke all on function public.fn_bunker_freshness(interval) from public, anon, authenticated;

-- Quotes that count in the index at p_as_of for a p_stem_mt stem, one per
-- (supplier, port, product).
create or replace function public.fn_bunker_live_quotes(p_as_of timestamptz, p_stem_mt numeric)
returns table (
  supplier_id uuid, port_locode text, zone text, product_key text,
  normalised_usd_mt numeric, submitted_at timestamptz
)
language sql stable security definer set search_path to ''
as $$
  select distinct on (q.supplier_id, q.port_locode, q.product_key)
         q.supplier_id, q.port_locode, p.zone::text, q.product_key,
         public.fn_bunker_normalised_price(q.price, q.barge_fee_usd, q.mandatory_charges_usd,
                                           p_stem_mt),
         q.submitted_at
    from public.bunker_quotes q
    join public.bunker_suppliers s on s.id = q.supplier_id and s.status = 'enabled'
    join public.ports p on p.locode = q.port_locode
    join public.fuel_products f on f.key = q.product_key and f.is_active
   where q.status = 'approved'
     and q.submitted_at <= p_as_of
     and q.submitted_at >= p_as_of - interval '14 days'
     and q.valid_from <= p_as_of
     and q.valid_until >= p_as_of
     and (q.superseded_at is null or q.superseded_at > p_as_of)
     and coalesce(q.min_qty_mt, 0) <= p_stem_mt
   order by q.supplier_id, q.port_locode, q.product_key, q.submitted_at desc, q.id
$$;
revoke all on function public.fn_bunker_live_quotes(timestamptz, numeric) from public, anon, authenticated;

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
  -- Members are the only callers whose JWT role is 'authenticated' (anon has
  -- no grant); admins, the service role and direct connections see full stats.
  v_full      boolean := public.fn_is_admin()
                         or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated';
begin
  if p_stem_mt is null or p_stem_mt <= 0 or p_stem_mt > 100000 then
    raise exception 'BUNKER_STEM: stem must be between 0 and 100000 MT' using errcode = '22023';
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
         coalesce(jsonb_object_agg(f.key, a.avg_p), '{}'::jsonb)
    into v_products, v_avg
    from agg a join public.fuel_products f on f.key = a.product_key
   where a.avg_p > 0;

  return jsonb_build_object(
    'asOf', to_char(v_as_of at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'port', case when v_scope = 'global' then null else v_port end,
    'scope', v_scope,
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

-- Ticker strip: one row per (sponsor, port), each sponsor's own current
-- prices. Sponsors are enabled, non-platform suppliers; their name is the
-- exposure they publish for. No ids and no contact details are returned.
create or replace function public.get_bunker_ticker()
returns jsonb
language sql stable security definer set search_path to ''
as $$
  with live as (
    select q.supplier_id, q.port_locode, q.product_key, q.price, q.submitted_at, q.valid_until,
           (select prev.price
              from public.bunker_quotes prev
             where prev.supplier_id = q.supplier_id and prev.port_locode = q.port_locode
               and prev.product_key = q.product_key
               and prev.superseded_at is not null  -- only a once-live quote is a previous price
               and prev.submitted_at < q.submitted_at
             order by prev.submitted_at desc limit 1) as prev_price
      from public.bunker_quotes q
      join public.bunker_suppliers s
        on s.id = q.supplier_id and s.status = 'enabled' and not s.is_platform
      join public.fuel_products f on f.key = q.product_key and f.is_active
     where q.status = 'approved'
       and q.superseded_at is null
       and q.submitted_at <= now()
       and now() - q.submitted_at <= interval '21 days'
  ), rows as (
    select l.supplier_id, l.port_locode,
           max(l.submitted_at) as latest,
           bool_or(l.valid_until >= now()) as any_valid
      from live l
     group by l.supplier_id, l.port_locode
  ), shaped as (
    select r.*, s.name, s.url, coalesce(p.trade_name, r.port_locode) as port_name,
           case
             when not r.any_valid then 'expired'
             else public.fn_bunker_freshness(now() - r.latest)
           end as freshness,
           floor(extract(epoch from now() - r.latest) / 86400)::int as age_days
      from rows r
      join public.bunker_suppliers s on s.id = r.supplier_id
      join public.ports p on p.locode = r.port_locode
  )
  select jsonb_build_object(
    'asOf', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'sponsors', coalesce(jsonb_agg(jsonb_build_object(
        'name', sh.name,
        'url', sh.url,
        'port', sh.port_name,
        'portLocode', sh.port_locode,
        'freshness', sh.freshness,
        'ageDays', sh.age_days,
        'latestQuoteAt', to_char(date_trunc('hour', sh.latest at time zone 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'prices', (
          select jsonb_agg(jsonb_build_object(
                   'productKey', l.product_key,
                   'label', f.market_label,
                   'usdMt', l.price,
                   'direction', case
                     when l.prev_price is null or l.prev_price = l.price then 'flat'
                     when l.price > l.prev_price then 'up' else 'down' end
                 ) order by f.sort_order)
            from live l join public.fuel_products f on f.key = l.product_key
           where l.supplier_id = sh.supplier_id and l.port_locode = sh.port_locode)
      ) order by case sh.freshness when 'current' then 0 when 'stale' then 1 else 2 end,
                 sh.name, sh.port_name), '[]'::jsonb))
    from shaped sh
$$;
revoke all on function public.get_bunker_ticker() from public, anon;
grant execute on function public.get_bunker_ticker() to authenticated, service_role;

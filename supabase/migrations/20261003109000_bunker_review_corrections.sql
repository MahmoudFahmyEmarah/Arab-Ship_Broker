-- Fuel Bar: corrections from the owner's program review (B2O-012, 5 Oct 2026).
--
--  1. A price is live only while its supplier still serves the port: the live
--     quotes and the ticker join bunker_supplier_ports, so removing a port
--     takes its prices out of the index and the ticker at once. (The platform
--     supplier registers its port on every staff input, 105000.)
--  2. A future-dated replacement no longer opens a gap:
--     * approval schedules the previous quote's supersession for the moment the
--       new one takes effect (greatest(now, valid_from)) instead of now;
--     * a supersession that has not taken effect yet may be rescheduled or
--       cleared (history, i.e. a supersession in the past, stays immutable), and
--       withdrawing an approved quote before it starts restores the previous one;
--     * age is counted from when a price takes effect, greatest(submitted_at,
--       valid_from), in the index window, its freshness and the ticker;
--     * a quote whose validity has already lapsed cannot be approved;
--     * the ticker takes one quote per supplier x port x product and counts only
--       a quote that was actually live as the previous price.
--  3. Members cannot probe the suppressed statistics: the index logic moves to
--     the service-only fn_bunker_fuel_index; get_fuel_price_index computes the
--     view and, for members, answers as of now at the nearest standard stem
--     (100, 250, 500, 1000, 2000, 3000, 5000, 10000 MT). The response reports the
--     asOf and stemMt actually used. Admins and the service role are unchanged.

-- 2: a scheduled supersession may change until it takes effect.
create or replace function public.fn_bunker_quote_append_only()
returns trigger
language plpgsql set search_path to ''
as $$
declare
  v_state  text[] := array['status', 'decided_by', 'decided_at', 'decision_reason', 'superseded_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'BUNKER_IMMUTABLE: quotes are append-only' using errcode = '55000';
  end if;
  if (to_jsonb(new) - v_state) <> (to_jsonb(old) - v_state) then
    raise exception 'BUNKER_IMMUTABLE: quote content cannot change' using errcode = '55000';
  end if;
  if old.superseded_at is not null and old.superseded_at <= now()
     and new.superseded_at is distinct from old.superseded_at then
    raise exception 'BUNKER_IMMUTABLE: a quote can only be superseded once' using errcode = '55000';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'submitted' and new.status in ('approved', 'rejected', 'withdrawn'))
    or (old.status = 'approved'  and new.status = 'withdrawn')) then
    raise exception 'BUNKER_STATUS: % -> % is not allowed', old.status, new.status using errcode = '55000';
  end if;
  if new.status = old.status and (new.decided_by, new.decided_at, new.decision_reason)
       is distinct from (old.decided_by, old.decided_at, old.decision_reason) then
    raise exception 'BUNKER_IMMUTABLE: a decision is recorded once' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_bunker_quote_append_only() from public, anon, authenticated;

-- 2: approval schedules the supersession; a lapsed quote is refused.
create or replace function public.fn_bunker_approve_quote(p_quote_id uuid, p_actor uuid, p_reason text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  q    public.bunker_quotes;
  prev public.bunker_quotes;
begin
  select * into q from public.bunker_quotes where id = p_quote_id for update;
  if not found or q.status <> 'submitted' then
    raise exception 'BUNKER_STATUS: only a submitted quote can be approved' using errcode = '55000';
  end if;
  if q.valid_until < now() then
    raise exception 'BUNKER_VALIDITY: the quote''s validity has already lapsed' using errcode = '22023';
  end if;
  select * into prev from public.bunker_quotes
   where supplier_id = q.supplier_id and port_locode = q.port_locode and product_key = q.product_key
     and status = 'approved' and superseded_at is null
   for update;
  if found then
    -- The previous price stays live until the new one takes effect.
    update public.bunker_quotes set superseded_at = greatest(now(), q.valid_from) where id = prev.id;
  end if;
  update public.bunker_quotes
     set status = 'approved', decided_by = p_actor, decided_at = now(), decision_reason = p_reason
   where id = q.id;
  insert into public.bunker_quote_events
    (quote_id, supplier_id, port_locode, product_key, action, old_price, new_price, valid_until, actor, reason)
  values (q.id, q.supplier_id, q.port_locode, q.product_key, 'approve', prev.price, q.price, q.valid_until,
          p_actor, p_reason);
end;
$$;
revoke all on function public.fn_bunker_approve_quote(uuid, uuid, text) from public, anon, authenticated;

-- 2: withdrawing an approved quote before it starts restores the price it was to replace.
create or replace function public.fn_bunker_restore_on_unstarted_withdraw()
returns trigger
language plpgsql security definer set search_path to ''
as $$
begin
  if old.status = 'approved' and new.status = 'withdrawn' and new.valid_from > now() then
    update public.bunker_quotes p
       set superseded_at = null
     where p.supplier_id = new.supplier_id and p.port_locode = new.port_locode
       and p.product_key = new.product_key and p.id <> new.id
       and p.status = 'approved' and p.superseded_at = new.valid_from and p.superseded_at > now();
  end if;
  return null;
end;
$$;
revoke all on function public.fn_bunker_restore_on_unstarted_withdraw() from public, anon, authenticated;

drop trigger if exists trg_bunker_quote_restore on public.bunker_quotes;
create trigger trg_bunker_quote_restore
after update of status on public.bunker_quotes
for each row execute function public.fn_bunker_restore_on_unstarted_withdraw();

-- 1 + 2: live prices need a served port; age runs from the effective time.
-- A new function carries effective_at; fn_bunker_live_quotes keeps its 102000
-- signature (so re-applying older migrations stays idempotent) and now reads it.
create or replace function public.fn_bunker_live_prices(p_as_of timestamptz, p_stem_mt numeric)
returns table (
  supplier_id uuid, port_locode text, zone text, product_key text,
  normalised_usd_mt numeric, submitted_at timestamptz, effective_at timestamptz
)
language sql stable security definer set search_path to ''
as $$
  select distinct on (q.supplier_id, q.port_locode, q.product_key)
         q.supplier_id, q.port_locode, p.zone::text, q.product_key,
         public.fn_bunker_normalised_price(q.price, q.barge_fee_usd, q.mandatory_charges_usd,
                                           p_stem_mt),
         q.submitted_at,
         greatest(q.submitted_at, q.valid_from)
    from public.bunker_quotes q
    join public.bunker_suppliers s on s.id = q.supplier_id and s.status = 'enabled'
    join public.bunker_supplier_ports sp on sp.supplier_id = q.supplier_id and sp.port_locode = q.port_locode
    join public.ports p on p.locode = q.port_locode
    join public.fuel_products f on f.key = q.product_key and f.is_active
   where q.status = 'approved'
     and q.submitted_at <= p_as_of
     and greatest(q.submitted_at, q.valid_from) >= p_as_of - interval '14 days'
     and q.valid_from <= p_as_of
     and q.valid_until >= p_as_of
     and (q.superseded_at is null or q.superseded_at > p_as_of)
     and coalesce(q.min_qty_mt, 0) <= p_stem_mt
   order by q.supplier_id, q.port_locode, q.product_key, q.submitted_at desc, q.id
$$;
revoke all on function public.fn_bunker_live_prices(timestamptz, numeric) from public, anon, authenticated;

create or replace function public.fn_bunker_live_quotes(p_as_of timestamptz, p_stem_mt numeric)
returns table (
  supplier_id uuid, port_locode text, zone text, product_key text,
  normalised_usd_mt numeric, submitted_at timestamptz
)
language sql stable security definer set search_path to ''
as $$
  select l.supplier_id, l.port_locode, l.zone, l.product_key, l.normalised_usd_mt, l.submitted_at
    from public.fn_bunker_live_prices(p_as_of, p_stem_mt) l
$$;
revoke all on function public.fn_bunker_live_quotes(timestamptz, numeric) from public, anon, authenticated;

-- 3: the index itself, service-only; p_full = admin/service view.
create or replace function public.fn_bunker_fuel_index(
  p_port_locode  text,
  p_product_keys text[],
  p_as_of        timestamptz,
  p_stem_mt      numeric,
  p_full         boolean
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
  v_full      boolean := coalesce(p_full, false);
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
       select 1 from public.fn_bunker_live_prices(v_as_of, p_stem_mt) l
        where l.port_locode = v_port and l.product_key = any (v_requested)) then
    v_scope := 'port';
  elsif v_zone is not null and v_zone <> 'Unknown' and exists (
       select 1 from public.fn_bunker_live_prices(v_as_of, p_stem_mt) l
        where l.zone = v_zone and l.product_key = any (v_requested)) then
    v_scope := 'region';
  else
    v_scope := 'global';
  end if;

  with in_scope as (
    select l.*
      from public.fn_bunker_live_prices(v_as_of, p_stem_mt) l
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
           max(o.effective_at) as latest
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
revoke all on function public.fn_bunker_fuel_index(text, text[], timestamptz, numeric, boolean) from public, anon, authenticated;
grant execute on function public.fn_bunker_fuel_index(text, text[], timestamptz, numeric, boolean) to service_role;

-- 3: the public RPC decides the view; members answer as of now at a standard stem.
create or replace function public.get_fuel_price_index(
  p_port_locode  text default null,
  p_product_keys text[] default null,
  p_as_of        timestamptz default now(),
  p_stem_mt      numeric default 500
) returns jsonb
language plpgsql stable security definer set search_path to ''
as $$
declare
  -- Members are the only callers whose JWT role is 'authenticated' (anon has
  -- no grant); admins, the service role and direct connections see full stats.
  v_full boolean := public.fn_is_admin()
                    or coalesce(auth.jwt() ->> 'role', '') <> 'authenticated';
  v_stem numeric;
begin
  if p_stem_mt is null or p_stem_mt <= 0 or p_stem_mt > 100000 then
    raise exception 'BUNKER_STEM: stem must be between 0 and 100000 MT' using errcode = '22023';
  end if;
  if v_full then
    return public.fn_bunker_fuel_index(p_port_locode, p_product_keys, p_as_of, p_stem_mt, true);
  end if;
  -- Nearest standard stem; a tie goes to the larger stem.
  select s into v_stem
    from unnest(array[100, 250, 500, 1000, 2000, 3000, 5000, 10000]::numeric[]) s
   order by abs(s - p_stem_mt), s desc
   limit 1;
  return public.fn_bunker_fuel_index(p_port_locode, p_product_keys, now(), v_stem, false);
end;
$$;
revoke all on function public.get_fuel_price_index(text, text[], timestamptz, numeric) from public, anon;
grant execute on function public.get_fuel_price_index(text, text[], timestamptz, numeric) to authenticated, service_role;

-- 1 + 2: the ticker.
create or replace function public.get_bunker_ticker()
returns jsonb
language sql stable security definer set search_path to ''
as $$
  with live as (
    select distinct on (q.supplier_id, q.port_locode, q.product_key)
           q.supplier_id, q.port_locode, q.product_key, q.price, q.submitted_at,
           greatest(q.submitted_at, q.valid_from) as effective_at,
           (select prev.price
              from public.bunker_quotes prev
             where prev.supplier_id = q.supplier_id and prev.port_locode = q.port_locode
               and prev.product_key = q.product_key
               and prev.status in ('approved', 'withdrawn')
               and prev.superseded_at is not null and prev.superseded_at <= now()
               and prev.valid_from < prev.superseded_at  -- only a quote that was live is a previous price
               and prev.submitted_at < q.submitted_at
             order by prev.submitted_at desc limit 1) as prev_price
      from public.bunker_quotes q
      join public.bunker_suppliers s
        on s.id = q.supplier_id and s.status = 'enabled' and not s.is_platform
      join public.bunker_supplier_ports sp on sp.supplier_id = q.supplier_id and sp.port_locode = q.port_locode
      join public.fuel_products f on f.key = q.product_key and f.is_active
     where q.status = 'approved'
       and (q.superseded_at is null or q.superseded_at > now())
       and q.submitted_at <= now()
       and q.valid_from <= now()
       and q.valid_until >= now()
       and now() - greatest(q.submitted_at, q.valid_from) <= interval '21 days'
     order by q.supplier_id, q.port_locode, q.product_key, q.submitted_at desc, q.id
  ), rows as (
    select l.supplier_id, l.port_locode, max(l.effective_at) as latest
      from live l
     group by l.supplier_id, l.port_locode
  ), shaped as (
    select r.*, s.name, s.url, coalesce(p.trade_name, r.port_locode) as port_name,
           public.fn_bunker_freshness(now() - r.latest) as freshness,
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

-- Fuel Bar: carry the legacy public.fuel_prices rows into bunker_quotes as
-- admin input under the internal "Platform (manual)" supplier (plan r2 §3.2).
-- public.fuel_prices is kept untouched (dropped in a later release); the app
-- stops reading it in the same release.
--
-- Mapping: ifo380 -> HSFO380, vlsfo -> VLSFO, lsmgo -> LSMGO, mgo -> MGO05
-- (the legacy "MGO" column carried no sulphur grade; 0.50 % DMA is the
-- conservative reading). port_area is matched to a port by LOCODE or trade
-- name; rows that match no port are reported and skipped. Validity is the
-- legacy updated_at + 14 days, so old rows arrive already expired and never
-- reach the index: stale data is worse than none. Only prices above zero move.
-- Re-running is a no-op (client_ref per legacy row and product).

do $$
declare
  v_platform uuid;
  v_moved    int;
  r          record;
begin
  insert into public.bunker_suppliers (name, verified, status, trust_score, is_platform, notes)
  values ('Platform (manual)', true, 'enabled', 50, true,
          'Internal supplier for prices entered by Arab ShipBroker staff. Never shown as a sponsor.')
  on conflict do nothing;
  select id into v_platform from public.bunker_suppliers where is_platform;

  for r in
    select fp.id, fp.port_area from public.fuel_prices fp
     where not exists (
       select 1 from public.ports p
        where p.locode = upper(btrim(fp.port_area)) or lower(p.trade_name) = lower(btrim(fp.port_area)))
  loop
    raise notice 'fuel_prices % skipped: port "%" matches no port', r.id, r.port_area;
  end loop;

  drop table if exists pg_temp.bunker_legacy;
  create temp table bunker_legacy on commit drop as
  select distinct on (port_locode, product_key) *
    from (
      select fp.id as legacy_id, fp.updated_at,
             (select p.locode from public.ports p
               where p.locode = upper(btrim(fp.port_area)) or lower(p.trade_name) = lower(btrim(fp.port_area))
               order by (p.locode = upper(btrim(fp.port_area))) desc limit 1) as port_locode,
             v.product_key, v.price
        from public.fuel_prices fp
        cross join lateral (values
          ('HSFO380', fp.ifo380_usd_mt), ('VLSFO', fp.vlsfo_usd_mt),
          ('LSMGO', fp.lsmgo_usd_mt), ('MGO05', fp.mgo_usd_mt)) as v(product_key, price)
       where v.price > 0 and v.price < 10000 and fp.updated_at is not null
    ) x
   where port_locode is not null
   order by port_locode, product_key, updated_at desc;

  insert into public.bunker_supplier_ports (supplier_id, port_locode)
  select distinct v_platform, l.port_locode from bunker_legacy l
  on conflict do nothing;

  with ins as (
    insert into public.bunker_quotes
      (supplier_id, port_locode, product_key, price, valid_from, valid_until, source, status,
       client_ref, reason, submitted_at, decided_at, decision_reason)
    select v_platform, l.port_locode, l.product_key, l.price, l.updated_at, l.updated_at + interval '14 days',
           'admin_input', 'approved', 'fuel_prices:' || l.legacy_id || ':' || l.product_key,
           'migrated from fuel_prices', l.updated_at, now(), 'migrated from fuel_prices'
      from bunker_legacy l
     where not exists (select 1 from public.bunker_quotes q
                        where q.supplier_id = v_platform
                          and q.client_ref = 'fuel_prices:' || l.legacy_id || ':' || l.product_key)
       and not exists (select 1 from public.bunker_quotes q
                        where q.supplier_id = v_platform and q.port_locode = l.port_locode
                          and q.product_key = l.product_key and q.status = 'approved'
                          and q.superseded_at is null)
    returning *
  )
  insert into public.bunker_quote_events
    (quote_id, supplier_id, port_locode, product_key, action, new_price, valid_until, reason, created_at)
  select id, supplier_id, port_locode, product_key, 'import', price, valid_until, 'migrated from fuel_prices', now()
    from ins;
  get diagnostics v_moved = row_count;
  raise notice 'fuel_prices: % price(s) moved into bunker_quotes', v_moved;
end;
$$;

comment on table public.fuel_prices is
  'LEGACY (read by nothing since 20261003104000): rows copied into bunker_quotes under "Platform (manual)". Drop in a later release.';

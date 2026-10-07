-- PDA FX ECB feed (20261007320000): service_role only, ECB source only, idempotent per pair and day, never
-- overwrites, and the resolver uses the feed's rate. Rolled back.
begin;

do $$
declare id1 uuid; id2 uuid; denied boolean; fx jsonb;
begin
  id1 := public.pda_record_fx_rate_system(jsonb_build_object('baseCurrency','EUR','quoteCurrency','USD','rate',1.105,
    'effectiveOn', current_date, 'sourceKind','ecb',
    'sourceRef', 'ECB euro foreign exchange reference rates, ' || current_date::text || ' (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)'));
  -- E1 · idempotent: the same pair, day and rate returns the same row
  id2 := public.pda_record_fx_rate_system(jsonb_build_object('baseCurrency','EUR','quoteCurrency','USD','rate',1.105,
    'effectiveOn', current_date, 'sourceKind','ecb',
    'sourceRef', 'ECB euro foreign exchange reference rates, ' || current_date::text || ' (replay)'));
  if id1 is distinct from id2 then raise exception 'E1: a replay created a second row'; end if;
  if (select count(*) from public.pda_fx_rates where base_currency='EUR' and quote_currency='USD' and effective_on=current_date) <> 1 then
    raise exception 'E1: expected exactly one EUR/USD row for today'; end if;
  if (select created_by from public.pda_fx_rates where id = id1) is not null then raise exception 'E1: a feed row carries an actor'; end if;

  -- E2 · a different rate for a recorded day is refused, never overwritten
  denied := false;
  begin perform public.pda_record_fx_rate_system(jsonb_build_object('baseCurrency','EUR','quoteCurrency','USD','rate',1.2,
    'effectiveOn', current_date, 'sourceKind','ecb', 'sourceRef', 'ECB euro foreign exchange reference rates, ' || current_date::text));
  exception when others then if sqlerrm like 'PDA_FX:%never overwritten%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'E2: a recorded rate was overwritten'; end if;

  -- E3 · only ECB, only EUR as base, only a dated ECB reference, only a recent date
  foreach fx in array array[
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date,'sourceKind','manual','sourceRef','ECB euro foreign exchange reference rates, 2026-10-07'),
    jsonb_build_object('baseCurrency','USD','quoteCurrency','RON','rate',4.5,'effectiveOn',current_date,'sourceKind','ecb','sourceRef','ECB euro foreign exchange reference rates, 2026-10-07'),
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date,'sourceKind','ecb','sourceRef','some website'),
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date - 60,'sourceKind','ecb','sourceRef','ECB euro foreign exchange reference rates, 2026-08-01')
  ] loop
    denied := false;
    begin perform public.pda_record_fx_rate_system(fx);
    exception when others then if sqlerrm like 'PDA_FX:%' then denied := true; else raise; end if; end;
    if not denied then raise exception 'E3: an invalid feed payload was accepted: %', fx; end if;
  end loop;

  -- E4 · the resolver answers with the feed's rate, and the USD → EUR inverse
  fx := public.fn_pda_fx_rate('EUR', 'USD', current_date);
  if (fx->>'rate')::numeric <> 1.105 or fx->>'sourceKind' <> 'ecb' then raise exception 'E4: resolver did not use the feed rate: %', fx; end if;

  -- E5 · grants: only service_role executes the feed function
  if has_function_privilege('authenticated', 'public.pda_record_fx_rate_system(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.pda_record_fx_rate_system(jsonb)', 'execute') then
    raise exception 'E5: the feed function is executable by members'; end if;
  if not has_function_privilege('service_role', 'public.pda_record_fx_rate_system(jsonb)', 'execute') then
    raise exception 'E5: service_role cannot run the feed'; end if;
end $$;

do $m$ begin raise notice 'PDA FX ECB FEED: ALL ASSERTIONS PASSED'; end $m$;
rollback;

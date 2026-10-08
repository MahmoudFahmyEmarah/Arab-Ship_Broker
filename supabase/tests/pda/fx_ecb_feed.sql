-- PDA FX ECB feed (20261007320000, hardened by 20261008200000): service_role only, ECB source only, exact
-- publication binding, never in the future, atomic and idempotent per pair and day, never overwrites or relabels,
-- and the resolver uses the feed's rate. Rolled back.
begin;

do $$
declare r1 jsonb; r2 jsonb; denied boolean; fx jsonb; v_ref text; v_old text;
begin
  v_ref := 'ECB euro foreign exchange reference rates, ' || current_date::text || ' (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)';
  r1 := public.pda_record_fx_rate_system(jsonb_build_object('baseCurrency','EUR','quoteCurrency','USD','rate',1.105,
    'effectiveOn', current_date, 'sourceKind','ecb', 'sourceRef', v_ref));
  if not (r1->>'inserted')::boolean then raise exception 'E1: the first record was not reported as inserted: %', r1; end if;
  -- E1 · idempotent: the same publication, pair, day and rate returns the same row, reported as a replay
  r2 := public.pda_record_fx_rate_system(jsonb_build_object('baseCurrency','EUR','quoteCurrency','USD','rate',1.105,
    'effectiveOn', current_date, 'sourceKind','ecb', 'sourceRef', v_ref));
  if r1->>'id' is distinct from r2->>'id' or (r2->>'inserted')::boolean then raise exception 'E1: a replay was not the same row: % / %', r1, r2; end if;
  if (select count(*) from public.pda_fx_rates where base_currency='EUR' and quote_currency='USD' and effective_on=current_date) <> 1 then
    raise exception 'E1: expected exactly one EUR/USD row for today'; end if;
  if (select created_by from public.pda_fx_rates where id = (r1->>'id')::uuid) is not null then raise exception 'E1: a feed row carries an actor'; end if;

  -- E2 · a different rate for a recorded day is refused, never overwritten
  denied := false;
  begin perform public.pda_record_fx_rate_system(jsonb_build_object('baseCurrency','EUR','quoteCurrency','USD','rate',1.2,
    'effectiveOn', current_date, 'sourceKind','ecb', 'sourceRef', v_ref));
  exception when others then if sqlerrm like 'PDA_FX:%never overwritten%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'E2: a recorded rate was overwritten'; end if;

  -- E3 · only ECB, only EUR as base, only the exact ECB publication of that date, never the future, only recent
  v_old := 'ECB euro foreign exchange reference rates, ' || (current_date - 60)::text || ' (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)';
  foreach fx in array array[
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date,'sourceKind','manual','sourceRef',v_ref),
    jsonb_build_object('baseCurrency','USD','quoteCurrency','RON','rate',4.5,'effectiveOn',current_date,'sourceKind','ecb','sourceRef',v_ref),
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date,'sourceKind','ecb','sourceRef','some website'),
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date,'sourceKind','ecb',
      'sourceRef','ECB euro foreign exchange reference rates, ' || (current_date - 1)::text || ' (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)'),
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date,'sourceKind','ecb','sourceRef',v_ref || ' (replay)'),
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date + 1,'sourceKind','ecb',
      'sourceRef','ECB euro foreign exchange reference rates, ' || (current_date + 1)::text || ' (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)'),
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn',current_date - 60,'sourceKind','ecb','sourceRef',v_old),
    jsonb_build_object('baseCurrency','EUR','quoteCurrency','RON','rate',4.97,'effectiveOn','not a date','sourceKind','ecb','sourceRef',v_ref)
  ] loop
    denied := false;
    begin perform public.pda_record_fx_rate_system(fx);
    exception when others then if sqlerrm like 'PDA_FX:%' then denied := true; else raise; end if; end;
    if not denied then raise exception 'E3: an invalid feed payload was accepted: %', fx; end if;
  end loop;

  -- E4 · a day already recorded from another source is never relabelled as ECB, even at the same rate
  insert into public.pda_fx_rates (base_currency, quote_currency, rate, effective_on, source_kind, source_ref, created_by)
  values ('EUR', 'TRY', 55.4, current_date, 'agent', 'Agent quote', null);
  denied := false;
  begin perform public.pda_record_fx_rate_system(jsonb_build_object('baseCurrency','EUR','quoteCurrency','TRY','rate',55.4,
    'effectiveOn', current_date, 'sourceKind','ecb', 'sourceRef', v_ref));
  exception when others then if sqlerrm like 'PDA_FX:%another source%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'E4: a non-ECB row was presented as ECB'; end if;

  -- E5 · the resolver answers with the feed's rate
  fx := public.fn_pda_fx_rate('EUR', 'USD', current_date);
  if (fx->>'rate')::numeric <> 1.105 or fx->>'sourceKind' <> 'ecb' then raise exception 'E5: resolver did not use the feed rate: %', fx; end if;

  -- E6 · grants: only service_role executes the feed function
  if has_function_privilege('authenticated', 'public.pda_record_fx_rate_system(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.pda_record_fx_rate_system(jsonb)', 'execute') then
    raise exception 'E6: the feed function is executable by members'; end if;
  if not has_function_privilege('service_role', 'public.pda_record_fx_rate_system(jsonb)', 'execute') then
    raise exception 'E6: service_role cannot run the feed'; end if;
end $$;

do $m$ begin raise notice 'PDA FX ECB FEED: ALL ASSERTIONS PASSED'; end $m$;
rollback;

-- PDA FX rates (20261007310000): governed, append-only, admin-recorded; members get one
-- resolved rate through fn_pda_fx_rate and never read the table. Rolled back. Dates are in 2024 so the suite never
-- collides with real rates on a hosted database (rates are append-only and never overwritten).
begin;

do $$
declare
  admin uuid := gen_random_uuid();
  member uuid := gen_random_uuid();
  fx jsonb;
  denied boolean;
begin
  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  select '00000000-0000-0000-0000-000000000000'::uuid, f.id, 'authenticated', 'authenticated', f.email,
         crypt('PdaFx1!', gen_salt('bf')), now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    from (values (admin, 'pda-fx-admin@example.test'), (member, 'pda-fx-member@example.test')) f(id, email);
  insert into public.users (id, supabase_user_id, email, full_name, role, is_active, admin_tier, subscription_tier) values
    (admin, admin, 'pda-fx-admin@example.test', 'PDA FX Admin', 'admin', true, null, 'T4'),
    (member, member, 'pda-fx-member@example.test', 'PDA FX Member', 'cargo_owner', true, null, 'T3');

  -- FX1 · only an owner-tier admin records a rate, with a named source
  denied := false;
  begin perform public.pda_record_fx_rate(member, '{"baseCurrency":"EUR","quoteCurrency":"USD","rate":1.08,"effectiveOn":"2024-10-01","sourceKind":"ecb","sourceRef":"ECB ref"}');
  exception when others then if sqlerrm like 'PDA_AUTH:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'FX1: a member recorded an FX rate'; end if;
  perform public.pda_record_fx_rate(admin, '{"baseCurrency":"eur","quoteCurrency":"usd","rate":1.08,"effectiveOn":"2024-10-01","sourceKind":"ecb","sourceRef":"ECB euro reference rate 1 Oct 2024"}');
  perform public.pda_record_fx_rate(admin, '{"baseCurrency":"EUR","quoteCurrency":"USD","rate":1.10,"effectiveOn":"2024-10-06","sourceKind":"ecb","sourceRef":"ECB euro reference rate 6 Oct 2024"}');
  perform public.pda_record_fx_rate(admin, '{"baseCurrency":"USD","quoteCurrency":"RON","rate":4.5,"effectiveOn":"2024-10-05","sourceKind":"central_bank","sourceRef":"BNR 5 Oct 2024"}');

  -- FX2 · input validation
  foreach fx in array array[
    '{"baseCurrency":"EUR","quoteCurrency":"EUR","rate":1,"effectiveOn":"2024-10-01","sourceKind":"ecb","sourceRef":"same pair"}'::jsonb,
    '{"baseCurrency":"EUR","quoteCurrency":"USD","rate":0,"effectiveOn":"2024-10-02","sourceKind":"ecb","sourceRef":"zero"}'::jsonb,
    '{"baseCurrency":"EUR","quoteCurrency":"USD","rate":"1.1","effectiveOn":"2024-10-02","sourceKind":"ecb","sourceRef":"text rate"}'::jsonb,
    '{"baseCurrency":"EUR","quoteCurrency":"USD","rate":1.1,"effectiveOn":"2099-01-01","sourceKind":"ecb","sourceRef":"far future"}'::jsonb,
    '{"baseCurrency":"EUR","quoteCurrency":"USD","rate":1.1,"effectiveOn":"2024-10-02","sourceKind":"rumour","sourceRef":"bad kind"}'::jsonb,
    '{"baseCurrency":"EUR","quoteCurrency":"USD","rate":1.1,"effectiveOn":"2024-10-02","sourceKind":"ecb","sourceRef":"x"}'::jsonb,
    '{"baseCurrency":"EUR","quoteCurrency":"USD","rate":1.2,"effectiveOn":"2024-10-06","sourceKind":"ecb","sourceRef":"duplicate day"}'::jsonb
  ] loop
    denied := false;
    begin perform public.pda_record_fx_rate(admin, fx);
    exception when others then if sqlerrm like 'PDA_FX:%' then denied := true; else raise; end if; end;
    if not denied then raise exception 'FX2: an invalid FX payload was accepted: %', fx; end if;
  end loop;

  -- FX3 · append-only
  denied := false;
  begin update public.pda_fx_rates set rate = 2 where base_currency = 'EUR';
  exception when others then if sqlerrm like 'PDA_FX:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'FX3: an FX rate was edited'; end if;
  denied := false;
  begin delete from public.pda_fx_rates;
  exception when others then if sqlerrm like 'PDA_FX:%' then denied := true; else raise; end if; end;
  if not denied then raise exception 'FX3: an FX rate was deleted'; end if;

  -- FX4 · resolution: latest on or before the date; inverse pair; 31-day window
  fx := public.fn_pda_fx_rate('EUR', 'USD', '2024-10-05');
  if (fx->>'rate')::numeric <> 1.08 or fx->>'effectiveOn' <> '2024-10-01' or (fx->>'inverse')::boolean then raise exception 'FX4: wrong rate before the newer one: %', fx; end if;
  fx := public.fn_pda_fx_rate('eur', 'usd', '2024-10-07');
  if (fx->>'rate')::numeric <> 1.10 or fx->>'sourceRef' not like 'ECB%6 Oct%' then raise exception 'FX4: the newest rate was not used: %', fx; end if;
  fx := public.fn_pda_fx_rate('RON', 'USD', '2024-10-07');
  if not (fx->>'inverse')::boolean or abs((fx->>'rate')::numeric - 0.22222222) > 0.00000001 then raise exception 'FX4: inverse pair wrong: %', fx; end if;
  if public.fn_pda_fx_rate('EUR', 'USD', '2024-09-30') is not null then raise exception 'FX4: a rate effective later was used'; end if;
  if public.fn_pda_fx_rate('EUR', 'USD', '2024-11-07') is not null then raise exception 'FX4: a rate older than 31 days was used'; end if;
  if public.fn_pda_fx_rate('EGP', 'USD', '2024-10-07') is not null then raise exception 'FX4: an unknown pair resolved'; end if;

  -- FX5 · grants: members resolve a rate but never read the table or record one
  if has_table_privilege('authenticated', 'public.pda_fx_rates', 'select') or has_table_privilege('anon', 'public.pda_fx_rates', 'select') then
    raise exception 'FX5: members can read the FX table'; end if;
  if has_function_privilege('authenticated', 'public.pda_record_fx_rate(uuid, jsonb)', 'execute') then raise exception 'FX5: members can record rates'; end if;
  if not has_function_privilege('authenticated', 'public.fn_pda_fx_rate(text, text, date)', 'execute') then raise exception 'FX5: members cannot resolve a rate'; end if;
  if has_function_privilege('anon', 'public.fn_pda_fx_rate(text, text, date)', 'execute') then raise exception 'FX5: anon can resolve a rate'; end if;

  -- FX6 · direct first (20261008100000): an older direct row beats a newer reciprocal row, in both directions
  perform public.pda_record_fx_rate(admin, '{"baseCurrency":"USD","quoteCurrency":"EUR","rate":0.8,"effectiveOn":"2024-10-07","sourceKind":"agent","sourceRef":"Agent quote 7 Oct 2024"}');
  fx := public.fn_pda_fx_rate('EUR', 'USD', '2024-10-08');
  if (fx->>'inverse')::boolean or (fx->>'rate')::numeric <> 1.10 then raise exception 'FX6: a newer inverse beat the direct EUR/USD rate: %', fx; end if;
  fx := public.fn_pda_fx_rate('USD', 'EUR', '2024-10-08');
  if (fx->>'inverse')::boolean or (fx->>'rate')::numeric <> 0.8 then raise exception 'FX6: the direct USD/EUR rate was not used: %', fx; end if;
  fx := public.fn_pda_fx_rate('USD', 'EUR', '2024-10-06');
  if not (fx->>'inverse')::boolean or (fx->>'rate')::numeric <> round(1 / 1.10, 8) then raise exception 'FX6: no direct row, the inverse should answer: %', fx; end if;

  -- FX7 · the governed commands are the only write path: service_role cannot insert directly
  if has_table_privilege('service_role', 'public.pda_fx_rates', 'insert') then raise exception 'FX7: service_role can insert FX rates directly'; end if;
  if not has_table_privilege('service_role', 'public.pda_fx_rates', 'select') then raise exception 'FX7: service_role cannot read FX rates'; end if;
end $$;

-- FX7 (behaviour) · as service_role a direct insert is refused, while the governed admin command still records
set local role service_role;
do $$
declare denied boolean := false;
begin
  begin
    insert into public.pda_fx_rates (base_currency, quote_currency, rate, effective_on, source_kind, source_ref, created_by)
    values ('EUR', 'GBP', 0.85, '2024-10-06', 'ecb', 'forged direct insert', null);
  exception when insufficient_privilege then denied := true; end;
  if not denied then raise exception 'FX7: service_role inserted an FX rate directly'; end if;
  perform public.pda_record_fx_rate((select id from public.users where email = 'pda-fx-admin@example.test'),
    '{"baseCurrency":"EUR","quoteCurrency":"GBP","rate":0.85,"effectiveOn":"2024-10-06","sourceKind":"ecb","sourceRef":"ECB euro reference rate 6 Oct 2024"}');
end $$;
reset role;

do $m$ begin raise notice 'PDA FX RATES: ALL ASSERTIONS PASSED'; end $m$;
rollback;

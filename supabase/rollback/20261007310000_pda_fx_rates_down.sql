-- DOWN for 20261007310000_pda_fx_rates (PDA FX). Refuses while any rate is recorded:
-- rates are governed history; export them first, then remove them deliberately.
do $down$
begin
  if to_regclass('public.pda_fx_rates') is not null and exists (select 1 from public.pda_fx_rates) then
    raise exception 'PDA_FX_DOWN: % recorded FX rate(s) exist; export them first', (select count(*) from public.pda_fx_rates)
      using errcode = '55000';
  end if;
end
$down$;

drop function if exists public.fn_pda_fx_rate(text, text, date);
drop function if exists public.pda_record_fx_rate(uuid, jsonb);
drop table if exists public.pda_fx_rates;
drop function if exists public.fn_pda_fx_rates_append_only();

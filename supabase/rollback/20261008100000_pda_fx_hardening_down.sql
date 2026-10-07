-- DOWN for 20261008100000_pda_fx_hardening: restores the 20261007310000 resolver and service_role INSERT grant and the
-- 20261007320000 feed function (uuid return) byte for byte. Rows recorded meanwhile are governed history and stay.
grant insert on table public.pda_fx_rates to service_role;

create or replace function public.fn_pda_fx_rate(p_base text, p_quote text, p_on date)
returns jsonb
language sql stable security definer set search_path to ''
as $$
  with wanted as (
    select upper(trim(p_base)) as base, upper(trim(p_quote)) as quote, p_on as on_date
  ), candidates as (
    select r.rate as rate, r.effective_on, r.source_kind, r.source_ref, false as inverse
      from public.pda_fx_rates r, wanted w
     where r.base_currency = w.base and r.quote_currency = w.quote
       and r.effective_on <= w.on_date and r.effective_on > w.on_date - 31
    union all
    select 1 / r.rate, r.effective_on, r.source_kind, r.source_ref, true
      from public.pda_fx_rates r, wanted w
     where r.base_currency = w.quote and r.quote_currency = w.base
       and r.effective_on <= w.on_date and r.effective_on > w.on_date - 31
  )
  select jsonb_build_object(
           'base', (select base from wanted), 'quote', (select quote from wanted),
           'rate', round(c.rate, 8), 'effectiveOn', c.effective_on,
           'sourceKind', c.source_kind, 'sourceRef', c.source_ref, 'inverse', c.inverse)
    from candidates c
   order by c.effective_on desc, c.inverse asc
   limit 1;
$$;
revoke all on function public.fn_pda_fx_rate(text, text, date) from public, anon;
grant execute on function public.fn_pda_fx_rate(text, text, date) to authenticated, service_role;

drop function if exists public.pda_record_fx_rate_system(jsonb);
create or replace function public.pda_record_fx_rate_system(p_payload jsonb)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_base text := upper(trim(coalesce(p_payload->>'baseCurrency', '')));
  v_quote text := upper(trim(coalesce(p_payload->>'quoteCurrency', '')));
  v_ref text := trim(coalesce(p_payload->>'sourceRef', ''));
  v_rate numeric;
  v_on date;
  v_existing public.pda_fx_rates;
  v_id uuid;
begin
  if coalesce(p_payload->>'sourceKind', '') <> 'ecb' then
    raise exception 'PDA_FX: the automatic feed records ECB reference rates only' using errcode = '22023';
  end if;
  if v_ref !~ '^ECB euro foreign exchange reference rates, [0-9]{4}-[0-9]{2}-[0-9]{2}' then
    raise exception 'PDA_FX: the source reference must name the ECB publication and its date' using errcode = '22023';
  end if;
  if v_base <> 'EUR' or v_quote !~ '^[A-Z]{3}$' or v_quote = 'EUR' then
    raise exception 'PDA_FX: ECB reference rates are EUR → another ISO 4217 currency' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'rate') <> 'number' or (p_payload->>'rate')::numeric <= 0 then
    raise exception 'PDA_FX: the rate must be a positive number' using errcode = '22023';
  end if;
  v_rate := (p_payload->>'rate')::numeric;
  v_on := (p_payload->>'effectiveOn')::date;
  if v_on is null or v_on > current_date + 1 or v_on < current_date - 31 then
    raise exception 'PDA_FX: effectiveOn must be within the last 31 days' using errcode = '22023';
  end if;
  select * into v_existing from public.pda_fx_rates
   where base_currency = v_base and quote_currency = v_quote and effective_on = v_on;
  if found then
    if v_existing.rate <> v_rate then
      raise exception 'PDA_FX: % → % on % is already recorded at % (source %); it is never overwritten',
        v_base, v_quote, v_on, v_existing.rate, v_existing.source_kind using errcode = '23505';
    end if;
    return v_existing.id;
  end if;
  insert into public.pda_fx_rates (base_currency, quote_currency, rate, effective_on, source_kind, source_ref, created_by)
  values (v_base, v_quote, v_rate, v_on, 'ecb', v_ref, null)
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.pda_record_fx_rate_system(jsonb) from public, anon, authenticated;
grant execute on function public.pda_record_fx_rate_system(jsonb) to service_role;
comment on function public.pda_record_fx_rate_system(jsonb) is
  'PDA FX: the daily ECB reference-rate feed (service_role only; source_kind ecb; idempotent per pair and day; never overwrites).';

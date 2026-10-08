-- PDA FX: automatic daily ECB feed (owner request 7 Oct 2026: "updated automatically live from a free service").
-- The European Central Bank publishes the euro foreign exchange reference rates every TARGET working day
-- (about 16:00 CET) at https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml — free, no key.
-- A scheduled server route (app/api/cron/fx-ecb) reads that file and records EUR → USD/RON/TRY here.
--  * pda_record_fx_rate_system is service_role only. It accepts ONLY source_kind 'ecb' with a source reference
--    naming the ECB publication and its date; no admin actor (created_by stays null — the source is the feed).
--  * Idempotent: the same pair and date twice returns the existing row (append-only table, unique per day);
--    a DIFFERENT rate for an already-recorded pair/date is refused (never overwritten).
--  * Admin-recorded rates (pda_record_fx_rate) are unchanged; fn_pda_fx_rate keeps resolving the newest rate
--    on or before the call date, whoever recorded it.
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

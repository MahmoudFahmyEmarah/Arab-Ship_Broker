-- PDA FX hardening (Codex C2O-090 B2C-037 and C2O-089 B2C-041, both AMEND; forward fix because staging carries
-- 20261007310000 and 20261007320000).
--  1. The governed commands are the only write path: service_role keeps SELECT but loses direct INSERT on
--     pda_fx_rates (it could forge created_by, source and date and skip the owner-admin assertion). The SECURITY
--     DEFINER commands pda_record_fx_rate (owner admin) and pda_record_fx_rate_system (ECB feed) still insert.
--  2. fn_pda_fx_rate prefers a DIRECT rate: the latest direct row in the 31-day window wins; the inverse of the
--     latest reciprocal row is used only when no direct row exists (was: newest of either, so results depended on
--     which direction happened to be recorded last).
--  3. The ECB feed binds provenance exactly and replays atomically:
--     * sourceRef must be exactly 'ECB euro foreign exchange reference rates, <effectiveOn> (<ECB daily URL>)';
--     * effectiveOn may not be in the future and not older than 31 days;
--     * insert ... on conflict do nothing; on a replay the existing row must be the same ECB publication
--       (source_kind 'ecb', same rate, same reference) or the call is refused — a manual or agent row for that
--       day is never presented as ECB;
--     * returns {id, inserted} so the job reports new rows vs replays.
revoke insert, update, delete, truncate on table public.pda_fx_rates from service_role;
grant select on table public.pda_fx_rates to service_role;

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
   order by c.inverse asc, c.effective_on desc
   limit 1;
$$;
revoke all on function public.fn_pda_fx_rate(text, text, date) from public, anon;
grant execute on function public.fn_pda_fx_rate(text, text, date) to authenticated, service_role;

drop function if exists public.pda_record_fx_rate_system(jsonb);
create function public.pda_record_fx_rate_system(p_payload jsonb)
returns jsonb
language plpgsql security definer set search_path to ''
as $$
declare
  v_base text := upper(trim(coalesce(p_payload->>'baseCurrency', '')));
  v_quote text := upper(trim(coalesce(p_payload->>'quoteCurrency', '')));
  v_ref text := coalesce(p_payload->>'sourceRef', '');
  v_rate numeric;
  v_on date;
  v_existing public.pda_fx_rates;
  v_id uuid;
begin
  if coalesce(p_payload->>'sourceKind', '') <> 'ecb' then
    raise exception 'PDA_FX: the automatic feed records ECB reference rates only' using errcode = '22023';
  end if;
  if v_base <> 'EUR' or v_quote !~ '^[A-Z]{3}$' or v_quote = 'EUR' then
    raise exception 'PDA_FX: ECB reference rates are EUR → another ISO 4217 currency' using errcode = '22023';
  end if;
  if jsonb_typeof(p_payload->'rate') <> 'number' or (p_payload->>'rate')::numeric <= 0 then
    raise exception 'PDA_FX: the rate must be a positive number' using errcode = '22023';
  end if;
  v_rate := (p_payload->>'rate')::numeric;
  begin
    v_on := (p_payload->>'effectiveOn')::date;
  exception when others then
    raise exception 'PDA_FX: effectiveOn must be a date' using errcode = '22023';
  end;
  if v_on is null or v_on > current_date or v_on < current_date - 31 then
    raise exception 'PDA_FX: effectiveOn must be today or within the last 31 days, never in the future' using errcode = '22023';
  end if;
  if v_ref <> 'ECB euro foreign exchange reference rates, ' || v_on::text
              || ' (https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml)' then
    raise exception 'PDA_FX: the source reference must name the ECB daily publication of exactly %', v_on using errcode = '22023';
  end if;

  insert into public.pda_fx_rates (base_currency, quote_currency, rate, effective_on, source_kind, source_ref, created_by)
  values (v_base, v_quote, v_rate, v_on, 'ecb', v_ref, null)
  on conflict on constraint pda_fx_rates_pair_day_uq do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('id', v_id, 'inserted', true);
  end if;

  select * into v_existing from public.pda_fx_rates
   where base_currency = v_base and quote_currency = v_quote and effective_on = v_on;
  if v_existing.source_kind <> 'ecb' or v_existing.source_ref <> v_ref or v_existing.created_by is not null then
    raise exception 'PDA_FX: % → % on % is already recorded from another source (%); the feed never replaces or relabels it',
      v_base, v_quote, v_on, v_existing.source_kind using errcode = '23505';
  end if;
  if v_existing.rate <> v_rate then
    raise exception 'PDA_FX: % → % on % is already recorded at %; it is never overwritten',
      v_base, v_quote, v_on, v_existing.rate using errcode = '23505';
  end if;
  return jsonb_build_object('id', v_existing.id, 'inserted', false);
end;
$$;
revoke all on function public.pda_record_fx_rate_system(jsonb) from public, anon, authenticated;
grant execute on function public.pda_record_fx_rate_system(jsonb) to service_role;
comment on function public.pda_record_fx_rate_system(jsonb) is
  'PDA FX: the daily ECB reference-rate feed (service_role only; exact ECB publication binding; atomic; replays only the identical ECB row; returns {id, inserted}).';

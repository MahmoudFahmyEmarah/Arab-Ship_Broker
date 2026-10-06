-- PDA Wave 3 groundwork (owner directive B2C-033; implemented by Opus B, audited by Codex).
-- Governed FX rates for the PDA route view, so a tariff in EUR/RON/EGP can be shown in
-- the display currency (today every non-USD tariff ends FX_RATE_REQUIRED).
--  * public.pda_fx_rates is append-only: a rate is never edited; a newer effective date
--    supersedes it. Every row names its source (kind + reference) and its recording admin.
--  * Owner-only admins record rates through pda_record_fx_rate (service_role, like the
--    other PDA admin commands). Members never read the table; they get one resolved rate
--    through fn_pda_fx_rate.
--  * fn_pda_fx_rate(base, quote, on) answers the latest rate effective on or before the
--    call date, the direct pair first, else the inverse pair (1 / rate), and only within
--    31 days; otherwise null, so the app keeps FX_RATE_REQUIRED instead of guessing.

create table if not exists public.pda_fx_rates (
  id uuid primary key default gen_random_uuid(),
  base_currency text not null,
  quote_currency text not null,
  rate numeric(20,8) not null,
  effective_on date not null,
  source_kind text not null,
  source_ref text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint pda_fx_rates_currency_ck check (base_currency ~ '^[A-Z]{3}$' and quote_currency ~ '^[A-Z]{3}$' and base_currency <> quote_currency),
  constraint pda_fx_rates_rate_ck check (rate > 0),
  constraint pda_fx_rates_source_ck check (source_kind in ('central_bank','ecb','agent','manual') and length(trim(source_ref)) between 3 and 300),
  constraint pda_fx_rates_pair_day_uq unique (base_currency, quote_currency, effective_on)
);
comment on table public.pda_fx_rates is
  'Governed, append-only FX rates for PDA display conversion (Wave 3). 1 base = rate quote. Recorded by owner-only admins with a named source.';

alter table public.pda_fx_rates enable row level security;
revoke all on table public.pda_fx_rates from public, anon, authenticated, service_role;
grant select, insert on table public.pda_fx_rates to service_role;

create or replace function public.fn_pda_fx_rates_append_only()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  raise exception 'PDA_FX: FX rates are append-only; record a newer effective date instead' using errcode = '55000';
end;
$$;
revoke all on function public.fn_pda_fx_rates_append_only() from public, anon, authenticated;

drop trigger if exists trg_pda_fx_rates_append_only on public.pda_fx_rates;
create trigger trg_pda_fx_rates_append_only
  before update or delete on public.pda_fx_rates
  for each row execute function public.fn_pda_fx_rates_append_only();

create or replace function public.pda_record_fx_rate(p_actor uuid, p_payload jsonb)
returns uuid
language plpgsql security definer set search_path to ''
as $$
declare
  v_id uuid;
  v_base text := upper(trim(coalesce(p_payload->>'baseCurrency', '')));
  v_quote text := upper(trim(coalesce(p_payload->>'quoteCurrency', '')));
  v_rate numeric;
  v_on date;
begin
  perform public.fn_pda_assert_admin_actor(p_actor);
  if v_base !~ '^[A-Z]{3}$' or v_quote !~ '^[A-Z]{3}$' or v_base = v_quote then
    raise exception 'PDA_FX: two different ISO 4217 currency codes are required' using errcode = '22023';
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
  if v_on is null or v_on > current_date + 7 then
    raise exception 'PDA_FX: effectiveOn is required and may not be more than 7 days ahead' using errcode = '22023';
  end if;
  begin
    insert into public.pda_fx_rates (base_currency, quote_currency, rate, effective_on, source_kind, source_ref, created_by)
    values (v_base, v_quote, v_rate, v_on, coalesce(nullif(trim(p_payload->>'sourceKind'), ''), 'manual'),
            trim(coalesce(p_payload->>'sourceRef', '')), p_actor)
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'PDA_FX: a % → % rate effective % already exists; rates are append-only', v_base, v_quote, v_on using errcode = '23505';
    when check_violation then
      raise exception 'PDA_FX: the source kind must be central_bank, ecb, agent or manual, with a source reference of 3–300 characters' using errcode = '22023';
  end;
  return v_id;
end;
$$;
revoke all on function public.pda_record_fx_rate(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.pda_record_fx_rate(uuid, jsonb) to service_role;

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

-- Suez Canal transit cost domain (Voyage Economics program, Stream S, 3 Oct 2026).
--
-- Every figure the calculator uses is DATA with an effective window, never a
-- constant in code: toll tiers (SDR per SCNT, by SCA vessel category and
-- laden/ballast), the fixed accompanying charges, the conditional charges that
-- surface as risk flags, the waste tariff, and the dated SDR→USD rate.
-- Members read one published version through get_suez_tariff_context(date);
-- admins maintain versions through the service role (Voyage estimator data).
--
-- Suez is its own domain (docs/phase-0-pda-fixture-architecture.md:231), so
-- these are sibling tables to the PDA tariff tables, with the same shape:
-- version (status, effective window, source ref) → items (code, label, basis,
-- currency, params) → bands (toll tiers).

create table if not exists public.suez_tariff_versions (
  id            uuid primary key default gen_random_uuid(),
  version_no    integer not null unique check (version_no > 0),
  status        text not null default 'draft'
                check (status in ('draft','published','superseded','withdrawn')),
  effective_from date not null,
  effective_to   date,
  source_ref    text not null,
  source_url    text,
  notes         text,
  created_by    uuid references public.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  published_by  uuid references public.users(id) on delete set null,
  published_at  timestamptz,
  constraint suez_tariff_versions_dates_ck check (effective_to is null or effective_to >= effective_from),
  constraint suez_tariff_versions_source_ck check (length(trim(source_ref)) between 2 and 500),
  constraint suez_tariff_versions_publish_ck check (status <> 'published' or published_at is not null)
);

create table if not exists public.suez_tariff_items (
  id                 uuid primary key default gen_random_uuid(),
  version_id         uuid not null references public.suez_tariff_versions(id) on delete cascade,
  code               text not null,
  label_en           text not null,
  label_ar           text,
  layer              text not null check (layer in ('toll','fixed','conditional','waste')),
  basis              text not null check (basis in (
                       'toll_tiered_scnt',  -- the toll itself: progressive SDR per SCNT from suez_toll_tiers
                       'flat',              -- params {amount}
                       'pct_of_toll',       -- params {pct} | {bands:[{key,pct,capSdr}]} | {pctPerUnit, unit}
                       'tier_by_scnt',      -- params {tiers:[{from,to,amount,includedUnits}]}
                       'per_unit',          -- params {rate, unit, freeUnits}
                       'gt_threshold',      -- params {threshold, below, atOrAbove}
                       'flag_only'          -- no amount; a warning the broker must consider
                     )),
  currency           text not null default 'USD' check (currency in ('USD','SDR')),
  params             jsonb not null default '{}'::jsonb,
  direction_scope    text not null default 'any' check (direction_scope in ('any','SB','NB')),
  cargo_status_scope text not null default 'any' check (cargo_status_scope in ('any','laden','ballast')),
  condition_key      text,
  payer_party        text not null default 'owner' check (payer_party in ('owner','charterer','either')),
  sort_order         integer not null default 100,
  is_active          boolean not null default true,
  notes              text,
  constraint suez_tariff_items_code_ck check (code ~ '^[a-z][a-z0-9_]{1,79}$'),
  constraint suez_tariff_items_label_ck check (length(trim(label_en)) between 2 and 200),
  constraint suez_tariff_items_params_ck check (jsonb_typeof(params) = 'object'),
  constraint suez_tariff_items_condition_ck check (layer <> 'conditional' or condition_key is not null),
  unique (version_id, code)
);

create table if not exists public.suez_toll_tiers (
  id              uuid primary key default gen_random_uuid(),
  version_id      uuid not null references public.suez_tariff_versions(id) on delete cascade,
  vessel_category text not null,
  cargo_status    text not null check (cargo_status in ('laden','ballast')),
  tier_order      smallint not null check (tier_order >= 0),
  scnt_from       numeric(12,2) not null check (scnt_from >= 0),
  scnt_to         numeric(12,2),
  sdr_per_scnt    numeric(12,4) not null check (sdr_per_scnt >= 0),
  confidence      text not null default 'official' check (confidence in ('official','placeholder')),
  constraint suez_toll_tiers_bounds_ck check (scnt_to is null or scnt_to > scnt_from),
  constraint suez_toll_tiers_category_ck check (vessel_category ~ '^[a-z][a-z0-9_]{1,40}$'),
  unique (version_id, vessel_category, cargo_status, tier_order)
);

create table if not exists public.sdr_rates (
  id         uuid primary key default gen_random_uuid(),
  rate_usd   numeric(12,6) not null check (rate_usd > 0),
  as_of      date not null unique,
  source     text not null default 'IMF',
  notes      text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists suez_tariff_versions_effective_idx
  on public.suez_tariff_versions (status, effective_from, effective_to);
create index if not exists suez_tariff_items_version_idx on public.suez_tariff_items (version_id, sort_order);
create index if not exists suez_toll_tiers_version_idx on public.suez_toll_tiers (version_id, vessel_category, cargo_status, tier_order);

-- Published versions must not overlap in time: the calculator picks exactly one.
create or replace function public.fn_suez_version_no_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $suez_overlap$
begin
  if new.status = 'published' then
    if exists (
      select 1 from public.suez_tariff_versions v
       where v.id <> new.id and v.status = 'published'
         and daterange(v.effective_from, coalesce(v.effective_to, 'infinity'::date), '[]')
             && daterange(new.effective_from, coalesce(new.effective_to, 'infinity'::date), '[]')
    ) then
      raise exception 'SUEZ_OVERLAP: another published Suez tariff version covers part of % .. %',
        new.effective_from, coalesce(new.effective_to::text, 'open') using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$suez_overlap$;
revoke all on function public.fn_suez_version_no_overlap() from public, anon, authenticated;

drop trigger if exists trg_suez_version_no_overlap on public.suez_tariff_versions;
create trigger trg_suez_version_no_overlap
  before insert or update of status, effective_from, effective_to on public.suez_tariff_versions
  for each row execute function public.fn_suez_version_no_overlap();

-- Published versions are immutable except for closing the window or superseding.
create or replace function public.fn_suez_version_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $suez_guard$
begin
  if tg_op = 'UPDATE' and old.status = 'published' then
    if new.version_no <> old.version_no or new.effective_from <> old.effective_from
       or new.source_ref <> old.source_ref or new.status not in ('published','superseded','withdrawn') then
      raise exception 'SUEZ_IMMUTABLE: a published Suez tariff version only accepts effective_to, status→superseded/withdrawn and notes'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$suez_guard$;
revoke all on function public.fn_suez_version_guard() from public, anon, authenticated;

drop trigger if exists trg_suez_version_guard on public.suez_tariff_versions;
create trigger trg_suez_version_guard
  before update on public.suez_tariff_versions
  for each row execute function public.fn_suez_version_guard();

create or replace function public.fn_suez_children_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $suez_children$
declare
  v_status text;
  v_version uuid := coalesce(new.version_id, old.version_id);
begin
  select status into v_status from public.suez_tariff_versions where id = v_version;
  if v_status in ('published','superseded') then
    raise exception 'SUEZ_IMMUTABLE: items and tiers of a published Suez tariff version cannot change; create a new version'
      using errcode = '55000';
  end if;
  return coalesce(new, old);
end;
$suez_children$;
revoke all on function public.fn_suez_children_guard() from public, anon, authenticated;

drop trigger if exists trg_suez_items_guard on public.suez_tariff_items;
create trigger trg_suez_items_guard
  before insert or update or delete on public.suez_tariff_items
  for each row execute function public.fn_suez_children_guard();
drop trigger if exists trg_suez_tiers_guard on public.suez_toll_tiers;
create trigger trg_suez_tiers_guard
  before insert or update or delete on public.suez_toll_tiers
  for each row execute function public.fn_suez_children_guard();

-- Access: service role only; members read through the RPC below.
alter table public.suez_tariff_versions enable row level security;
alter table public.suez_tariff_items    enable row level security;
alter table public.suez_toll_tiers      enable row level security;
alter table public.sdr_rates            enable row level security;
revoke all on table public.suez_tariff_versions, public.suez_tariff_items, public.suez_toll_tiers, public.sdr_rates
  from public, anon, authenticated;
grant all on table public.suez_tariff_versions, public.suez_tariff_items, public.suez_toll_tiers, public.sdr_rates
  to service_role;

-- The member read: the one published version in force on p_date, its items and
-- tiers, the SDR rate dated on or before p_date (else the earliest known), and
-- the Suez day assumptions from voyage_settings.
create or replace function public.get_suez_tariff_context(p_date date default current_date)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $suez_ctx$
declare
  v_date date := coalesce(p_date, current_date);
  v_version public.suez_tariff_versions%rowtype;
  v_items jsonb;
  v_tiers jsonb;
  v_sdr jsonb;
  v_settings jsonb;
begin
  select * into v_version
    from public.suez_tariff_versions v
   where v.status = 'published'
     and v.effective_from <= v_date
     and (v.effective_to is null or v.effective_to >= v_date)
   order by v.effective_from desc, v.version_no desc
   limit 1;
  if not found then
    return jsonb_build_object('found', false, 'date', v_date);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code', i.code, 'labelEn', i.label_en, 'labelAr', i.label_ar, 'layer', i.layer,
           'basis', i.basis, 'currency', i.currency, 'params', i.params,
           'directionScope', i.direction_scope, 'cargoStatusScope', i.cargo_status_scope,
           'conditionKey', i.condition_key, 'payerParty', i.payer_party, 'sortOrder', i.sort_order,
           'notes', i.notes) order by i.sort_order, i.code), '[]'::jsonb)
    into v_items
    from public.suez_tariff_items i
   where i.version_id = v_version.id and i.is_active;

  select coalesce(jsonb_agg(jsonb_build_object(
           'vesselCategory', t.vessel_category, 'cargoStatus', t.cargo_status, 'tierOrder', t.tier_order,
           'scntFrom', t.scnt_from, 'scntTo', t.scnt_to, 'sdrPerScnt', t.sdr_per_scnt, 'confidence', t.confidence)
           order by t.vessel_category, t.cargo_status, t.tier_order), '[]'::jsonb)
    into v_tiers
    from public.suez_toll_tiers t
   where t.version_id = v_version.id;

  select jsonb_build_object('rateUsd', r.rate_usd, 'asOf', r.as_of, 'source', r.source, 'notes', r.notes)
    into v_sdr
    from public.sdr_rates r
   where r.as_of <= v_date
   order by r.as_of desc
   limit 1;
  if v_sdr is null then
    select jsonb_build_object('rateUsd', r.rate_usd, 'asOf', r.as_of, 'source', r.source, 'notes', r.notes)
      into v_sdr
      from public.sdr_rates r
     order by r.as_of asc
     limit 1;
  end if;

  select s.value into v_settings from public.app_settings s where s.key = 'voyage_settings';

  return jsonb_build_object(
    'found', true,
    'date', v_date,
    'version', jsonb_build_object(
      'id', v_version.id, 'versionNo', v_version.version_no,
      'effectiveFrom', v_version.effective_from, 'effectiveTo', v_version.effective_to,
      'sourceRef', v_version.source_ref, 'sourceUrl', v_version.source_url, 'notes', v_version.notes),
    'items', v_items,
    'tiers', v_tiers,
    'sdr', v_sdr,
    'suezDays', coalesce(v_settings -> 'suez', '{}'::jsonb)
  );
end;
$suez_ctx$;
revoke all on function public.get_suez_tariff_context(date) from public, anon;
grant execute on function public.get_suez_tariff_context(date) to authenticated, service_role;

-- Admin read of every version (including drafts) for the Voyage estimator data page.
create or replace function public.admin_list_suez_tariff_versions()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $suez_admin_list$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', v.id, 'versionNo', v.version_no, 'status', v.status,
           'effectiveFrom', v.effective_from, 'effectiveTo', v.effective_to,
           'sourceRef', v.source_ref, 'sourceUrl', v.source_url, 'notes', v.notes,
           'createdAt', v.created_at, 'publishedAt', v.published_at,
           'itemCount', (select count(*) from public.suez_tariff_items i where i.version_id = v.id),
           'tierCount', (select count(*) from public.suez_toll_tiers t where t.version_id = v.id))
           order by v.version_no desc), '[]'::jsonb)
    from public.suez_tariff_versions v;
$suez_admin_list$;
revoke all on function public.admin_list_suez_tariff_versions() from public, anon, authenticated;
grant execute on function public.admin_list_suez_tariff_versions() to service_role;

comment on table public.suez_tariff_versions is 'Suez Canal transit tariff versions; one published version per date (Voyage Economics, Stream S).';
comment on table public.suez_tariff_items is 'Tariff items per version: layer toll|fixed|conditional|waste, basis + params evaluated by lib/suez/engine.ts; never executable.';
comment on table public.suez_toll_tiers is 'Progressive SCA toll bands: SDR per SCNT by vessel category and cargo status.';
comment on table public.sdr_rates is 'Dated SDR→USD rates; the calculator uses the rate dated on or before the transit date.';

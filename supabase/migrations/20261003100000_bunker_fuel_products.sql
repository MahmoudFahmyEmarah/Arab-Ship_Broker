-- Fuel Bar (Voyage Economics plan r2 §3.2): marine fuel catalogue and the
-- per-port compliance flags the estimator needs.
--
-- The product key is family + sulphur class + ISO 8217 grade; the market
-- label is display only (owner's Marine Fuels reference §6). CO2 factors are
-- the IMO values by ISO grade: RMA–RMD 3.151, RME–RMK 3.114, distillates 3.206.
-- Both tables are readable by signed-in members (catalogue data, no PII) and
-- written only by the service role.

create table if not exists public.fuel_products (
  key           text primary key check (key ~ '^[A-Z0-9]{2,16}$'),
  family        text not null check (family in ('residual', 'distillate')),
  sulphur_class text not null check (sulphur_class in ('HS', 'VLS', 'ULS')),
  iso_grade     text not null,
  iso_table     smallint check (iso_table between 1 and 4),
  market_label  text not null,
  co2_factor    numeric(5,3) not null check (co2_factor > 0),
  bio_pct       numeric(5,2) not null default 0 check (bio_pct between 0 and 100),
  core_slot     boolean not null default false,  -- one of the three slots every port shows
  eca_slot      boolean not null default false,  -- extra slot shown at ECA ports
  sort_order    smallint not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);

comment on table public.fuel_products is
  'Fuel Bar catalogue. key = family + sulphur class + ISO 8217 grade; market_label is display only.';

insert into public.fuel_products
  (key, family, sulphur_class, iso_grade, iso_table, market_label, co2_factor, core_slot, eca_slot, sort_order)
values
  ('HSFO380', 'residual',   'HS',  'RMG380',  4, 'HSFO 380', 3.114, true,  false, 10),
  ('VLSFO',   'residual',   'VLS', 'RMG',     2, 'VLSFO',    3.114, true,  false, 20),
  ('ULSFO',   'residual',   'ULS', 'RMD',     2, 'ULSFO',    3.151, false, true,  30),
  ('LSMGO',   'distillate', 'ULS', 'DMA',     1, 'LSMGO',    3.206, true,  false, 40),
  ('MGO05',   'distillate', 'VLS', 'DMA',     1, 'MGO 0.5%', 3.206, false, false, 50),
  ('MDO',     'distillate', 'VLS', 'DMB',     1, 'MDO',      3.206, false, false, 60)
on conflict (key) do nothing;

-- Per-port compliance flags (public.ports itself is not altered).
create table if not exists public.bunker_port_flags (
  port_locode    text primary key references public.ports(locode) on update cascade,
  eca_zone       text,                             -- null = outside every ECA
  eu_berth_rule  boolean not null default false,   -- 0.10 % at berth beyond 2 h
  open_loop_ban  boolean not null default false,   -- no open-loop scrubber discharge
  notes          text,
  updated_by     uuid references public.users(id),
  updated_at     timestamptz not null default now()
);

comment on table public.bunker_port_flags is
  'Fuel compliance flags per port: ECA zone, EU at-berth rule, open-loop scrubber ban.';

alter table public.fuel_products     enable row level security;
alter table public.bunker_port_flags enable row level security;

revoke all on public.fuel_products, public.bunker_port_flags from anon, authenticated;
grant select on public.fuel_products, public.bunker_port_flags to authenticated;

drop policy if exists fuel_products_member_read on public.fuel_products;
create policy fuel_products_member_read on public.fuel_products
  for select to authenticated using (is_active);

drop policy if exists bunker_port_flags_member_read on public.bunker_port_flags;
create policy bunker_port_flags_member_read on public.bunker_port_flags
  for select to authenticated using (true);

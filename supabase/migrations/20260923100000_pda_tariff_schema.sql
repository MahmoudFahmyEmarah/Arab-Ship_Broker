-- PDA Estimator: governed tariff evidence, staging and immutable publication.
-- Calculation remains deterministic TypeScript; these tables contain typed
-- data only and never executable SQL/JavaScript formulas.

create table if not exists public.port_terminals (
  id              uuid primary key default gen_random_uuid(),
  port_locode     text not null references public.ports(locode) on delete restrict,
  name            text not null,
  normalized_name text not null,
  aliases         text[] not null default '{}',
  is_active       boolean not null default true,
  is_verified     boolean not null default false,
  verified_by     uuid references public.users(id) on delete restrict,
  verified_at     timestamptz,
  created_by      uuid not null references public.users(id) on delete restrict,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint port_terminals_locode_ck check (port_locode ~ '^[A-Z]{2}[A-Z0-9]{3}$'),
  constraint port_terminals_name_ck check (length(trim(name)) between 2 and 200),
  constraint port_terminals_normalized_ck check (normalized_name = lower(trim(normalized_name)) and length(normalized_name) between 2 and 200),
  constraint port_terminals_verified_ck check ((not is_verified) or (verified_by is not null and verified_at is not null)),
  unique (port_locode, normalized_name)
);

create table if not exists public.tariff_publishers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  publisher_type text not null check (publisher_type in ('port_authority','terminal','agent','statutory','other')),
  country        text,
  website        text,
  is_active      boolean not null default true,
  created_by     uuid not null references public.users(id) on delete restrict,
  created_at     timestamptz not null default now(),
  unique (name, publisher_type)
);

create table if not exists public.tariff_sources (
  id               uuid primary key default gen_random_uuid(),
  publisher_id     uuid references public.tariff_publishers(id) on delete restrict,
  title            text not null,
  source_filename  text not null,
  mime_type        text not null,
  sha256           text not null,
  storage_path     text,
  source_uri       text,
  language         text,
  authority        text not null default 'unverified' check (authority in ('official','agent','statutory','reference','unverified')),
  issue_date       date,
  effective_from   date,
  effective_to     date,
  currentness_note text,
  registered_by    uuid not null references public.users(id) on delete restrict,
  registered_at    timestamptz not null default now(),
  constraint tariff_sources_title_ck check (length(trim(title)) between 2 and 500),
  constraint tariff_sources_sha_ck check (sha256 ~ '^[a-f0-9]{64}$'),
  constraint tariff_sources_dates_ck check (effective_to is null or effective_from is null or effective_to >= effective_from),
  unique (sha256)
);

create table if not exists public.tariff_import_batches (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.tariff_sources(id) on delete restrict,
  status         text not null default 'staging' check (status in ('staging','review','approved','rejected','published','failed')),
  extractor      text,
  extractor_meta jsonb not null default '{}'::jsonb,
  summary        jsonb not null default '{}'::jsonb,
  started_by     uuid not null references public.users(id) on delete restrict,
  reviewed_by    uuid references public.users(id) on delete restrict,
  started_at     timestamptz not null default now(),
  reviewed_at    timestamptz,
  completed_at   timestamptz,
  constraint tariff_import_batches_meta_ck check (jsonb_typeof(extractor_meta) = 'object' and jsonb_typeof(summary) = 'object')
);

create table if not exists public.tariff_staged_rules (
  id                  uuid primary key default gen_random_uuid(),
  batch_id            uuid not null references public.tariff_import_batches(id) on delete cascade,
  row_no              integer not null,
  raw_text            text not null,
  normalized_proposal jsonb not null default '{}'::jsonb,
  source_page         text,
  source_sheet        text,
  confidence          numeric(5,4),
  port_locode         text references public.ports(locode) on delete restrict,
  terminal_id         uuid references public.port_terminals(id) on delete restrict,
  validation_errors   jsonb not null default '[]'::jsonb,
  decision            text not null default 'pending' check (decision in ('pending','accepted','rejected','needs_mapping')),
  decided_by          uuid references public.users(id) on delete restrict,
  decided_at          timestamptz,
  decision_note       text,
  created_at          timestamptz not null default now(),
  constraint tariff_staged_rules_confidence_ck check (confidence is null or confidence between 0 and 1),
  constraint tariff_staged_rules_json_ck check (jsonb_typeof(normalized_proposal) = 'object' and jsonb_typeof(validation_errors) = 'array'),
  constraint tariff_staged_rules_terminal_ck check (terminal_id is null or port_locode is not null),
  unique (batch_id, row_no)
);

create table if not exists public.port_tariff_sets (
  id            uuid primary key default gen_random_uuid(),
  port_locode   text not null references public.ports(locode) on delete restrict,
  terminal_id   uuid references public.port_terminals(id) on delete restrict,
  publisher_id  uuid not null references public.tariff_publishers(id) on delete restrict,
  name          text not null,
  scope         text not null default 'port_call' check (scope in ('port_call','terminal','waste','pilotage','towage','agency','other')),
  is_active     boolean not null default true,
  created_by    uuid not null references public.users(id) on delete restrict,
  created_at    timestamptz not null default now(),
  constraint port_tariff_sets_name_ck check (length(trim(name)) between 2 and 300),
  unique nulls not distinct (port_locode, terminal_id, publisher_id, name)
);

create table if not exists public.port_tariff_versions (
  id                uuid primary key default gen_random_uuid(),
  tariff_set_id     uuid not null references public.port_tariff_sets(id) on delete restrict,
  version_no        integer not null,
  status            text not null default 'draft' check (status in ('draft','in_review','published','superseded','withdrawn')),
  currency          text not null,
  effective_from    date not null,
  effective_to      date,
  rounding_mode     text not null default 'half_up' check (rounding_mode in ('half_up','up','down')),
  decimal_places    smallint not null default 2 check (decimal_places between 0 and 6),
  primary_source_id uuid not null references public.tariff_sources(id) on delete restrict,
  supersedes_id     uuid references public.port_tariff_versions(id) on delete restrict,
  notes             text,
  created_by        uuid not null references public.users(id) on delete restrict,
  submitted_by      uuid references public.users(id) on delete restrict,
  approved_by       uuid references public.users(id) on delete restrict,
  created_at        timestamptz not null default now(),
  submitted_at      timestamptz,
  approved_at       timestamptz,
  published_at      timestamptz,
  constraint port_tariff_versions_no_ck check (version_no > 0),
  constraint port_tariff_versions_currency_ck check (currency ~ '^[A-Z]{3}$'),
  constraint port_tariff_versions_dates_ck check (effective_to is null or effective_to >= effective_from),
  constraint port_tariff_versions_checker_ck check (approved_by is null or approved_by <> created_by),
  constraint port_tariff_versions_publish_ck check (
    status <> 'published' or (approved_by is not null and approved_at is not null and published_at is not null)
  ),
  unique (tariff_set_id, version_no)
);

create table if not exists public.port_tariff_rules (
  id                  uuid primary key default gen_random_uuid(),
  tariff_version_id   uuid not null references public.port_tariff_versions(id) on delete cascade,
  code                text not null,
  label               text not null,
  basis               text not null check (basis in (
    'flat','per_call','per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa',
    'per_cargo_mt','per_unit','percentage','tiered_flat','tiered_rate','progressive','manual_quote'
  )),
  amount              numeric(18,6),
  rate                numeric(18,6),
  unit                text,
  priority            integer not null default 100,
  included_units      numeric(18,6) not null default 0,
  minimum_amount      numeric(18,6),
  maximum_amount      numeric(18,6),
  tax_percent         numeric(9,6),
  applicability       jsonb not null default '{}'::jsonb,
  manual_instructions text,
  source_id           uuid not null references public.tariff_sources(id) on delete restrict,
  source_page         text,
  source_sheet        text,
  source_excerpt      text,
  created_at          timestamptz not null default now(),
  constraint port_tariff_rules_code_ck check (code ~ '^[a-z][a-z0-9_]{1,79}$'),
  constraint port_tariff_rules_label_ck check (length(trim(label)) between 2 and 200),
  constraint port_tariff_rules_amounts_ck check (
    coalesce(amount, 0) >= 0 and coalesce(rate, 0) >= 0 and included_units >= 0 and
    coalesce(minimum_amount, 0) >= 0 and coalesce(maximum_amount, 0) >= 0 and
    (minimum_amount is null or maximum_amount is null or maximum_amount >= minimum_amount) and
    (tax_percent is null or tax_percent between 0 and 1000)
  ),
  constraint port_tariff_rules_basis_value_ck check (
    (basis in ('flat','per_call') and coalesce(amount, rate) is not null)
    or (basis in ('per_day','per_hour','per_gt','per_nt','per_scnrt','per_dwt','per_loa','per_cargo_mt','per_unit','percentage') and rate is not null)
    or basis in ('tiered_flat','tiered_rate','progressive','manual_quote')
  ),
  constraint port_tariff_rules_percentage_ck check (
    basis <> 'percentage' or (
      jsonb_typeof(applicability->'percentageBaseCodes') = 'array'
      and jsonb_array_length(applicability->'percentageBaseCodes') > 0
    )
  ),
  constraint port_tariff_rules_applicability_ck check (jsonb_typeof(applicability) = 'object'),
  constraint port_tariff_rules_evidence_ck check (source_page is not null or source_sheet is not null),
  constraint port_tariff_rules_manual_ck check (
    (basis = 'manual_quote' and manual_instructions is not null) or basis <> 'manual_quote'
  ),
  unique (tariff_version_id, code)
);

create table if not exists public.port_tariff_bands (
  id         uuid primary key default gen_random_uuid(),
  rule_id    uuid not null references public.port_tariff_rules(id) on delete cascade,
  band_order integer not null,
  lower_bound numeric(18,6) not null,
  upper_bound numeric(18,6),
  flat_amount numeric(18,6),
  rate        numeric(18,6),
  created_at  timestamptz not null default now(),
  constraint port_tariff_bands_order_ck check (band_order >= 0),
  constraint port_tariff_bands_bounds_ck check (lower_bound >= 0 and (upper_bound is null or upper_bound > lower_bound)),
  constraint port_tariff_bands_value_ck check (
    (flat_amount is not null or rate is not null) and coalesce(flat_amount, 0) >= 0 and coalesce(rate, 0) >= 0
  ),
  unique (rule_id, band_order),
  unique (rule_id, lower_bound)
);

create index if not exists port_terminals_port_idx on public.port_terminals (port_locode, is_active, is_verified);
create index if not exists tariff_staged_rules_batch_idx on public.tariff_staged_rules (batch_id, decision, row_no);
create index if not exists port_tariff_sets_port_idx on public.port_tariff_sets (port_locode, terminal_id, is_active);
create index if not exists port_tariff_versions_effective_idx on public.port_tariff_versions (tariff_set_id, status, effective_from, effective_to);
create index if not exists port_tariff_rules_version_idx on public.port_tariff_rules (tariff_version_id, priority, code);
create index if not exists port_tariff_bands_rule_idx on public.port_tariff_bands (rule_id, band_order);

alter table public.port_terminals enable row level security;
alter table public.tariff_publishers enable row level security;
alter table public.tariff_sources enable row level security;
alter table public.tariff_import_batches enable row level security;
alter table public.tariff_staged_rules enable row level security;
alter table public.port_tariff_sets enable row level security;
alter table public.port_tariff_versions enable row level security;
alter table public.port_tariff_rules enable row level security;
alter table public.port_tariff_bands enable row level security;

revoke all on table public.port_terminals, public.tariff_publishers, public.tariff_sources,
  public.tariff_import_batches, public.tariff_staged_rules, public.port_tariff_sets,
  public.port_tariff_versions, public.port_tariff_rules, public.port_tariff_bands
  from public, anon, authenticated;

grant all on table public.port_terminals, public.tariff_publishers, public.tariff_sources,
  public.tariff_import_batches, public.tariff_staged_rules, public.port_tariff_sets,
  public.port_tariff_versions, public.port_tariff_rules, public.port_tariff_bands
  to service_role;

comment on table public.tariff_staged_rules is 'Untrusted extracted suggestions. Publication is impossible until exact port/terminal mapping, validation, maker review and checker approval.';
comment on table public.port_tariff_versions is 'Effective-dated immutable publication unit. Published rows and their child rules/bands are protected by PDA immutability triggers.';
comment on column public.port_tariff_rules.applicability is 'Typed JSON validated again by lib/pda schemas; never executable code.';

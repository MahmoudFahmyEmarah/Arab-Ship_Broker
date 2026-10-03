-- Fuel Bar: suppliers, their ports and member accounts, append-only quotes
-- and the quote audit trail.
--
-- A supplier user is an ordinary member linked through bunker_supplier_members;
-- there is no new users.role (the 330000 privilege boundary stays as it is).
-- Every table here is RPC-only: RLS on, no member grants. Contact details
-- stay behind the contact firewall and are never returned by a member read.
--
-- Quotes are append-only (plan r2.1 §3). A quote is submitted, then approved
-- (automatically for a verified supplier, otherwise by an admin), rejected or
-- withdrawn. Approving a quote sets superseded_at on the previous approved
-- row for the same (supplier, port, product). Prices, fees and validity are
-- never edited and nothing is deleted, so the history and the ticker's
-- direction arrows are reconstructible. client_ref makes ingestion idempotent.

create table if not exists public.bunker_suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(btrim(name)) between 2 and 120),
  url            text check (url is null or url ~* '^https?://'),
  country        text,
  verified       boolean not null default false,
  status         text not null default 'enabled' check (status in ('enabled', 'disabled')),
  trust_score    smallint not null default 50 check (trust_score between 0 and 100),
  is_platform    boolean not null default false,  -- internal "Platform (manual)" row; never a sponsor
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  notes          text,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now(),
  updated_by     uuid references public.users(id),
  updated_at     timestamptz not null default now()
);

create unique index if not exists bunker_suppliers_name_key
  on public.bunker_suppliers (lower(btrim(name)));
create unique index if not exists bunker_suppliers_one_platform
  on public.bunker_suppliers (is_platform) where is_platform;

create table if not exists public.bunker_supplier_ports (
  supplier_id  uuid not null references public.bunker_suppliers(id) on delete cascade,
  port_locode  text not null references public.ports(locode) on update cascade,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  primary key (supplier_id, port_locode)
);

create unique index if not exists bunker_supplier_ports_one_primary
  on public.bunker_supplier_ports (supplier_id) where is_primary;

create table if not exists public.bunker_supplier_members (
  supplier_id  uuid not null references public.bunker_suppliers(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  role         text not null default 'editor' check (role in ('editor', 'viewer')),
  invited_by   uuid references public.users(id),
  created_at   timestamptz not null default now(),
  primary key (supplier_id, user_id)
);

create index if not exists bunker_supplier_members_user_idx
  on public.bunker_supplier_members (user_id);

create table if not exists public.bunker_quotes (
  id                     uuid primary key default gen_random_uuid(),
  supplier_id            uuid not null references public.bunker_suppliers(id),
  port_locode            text not null references public.ports(locode),  -- no cascade: quotes are immutable
  product_key            text not null references public.fuel_products(key),
  price                  numeric(10,2) not null check (price > 0 and price < 10000),
  currency               text not null default 'USD' check (currency = 'USD'),
  unit                   text not null default 'mt' check (unit = 'mt'),
  delivery_mode          text not null default 'barge'
                         check (delivery_mode in ('barge', 'truck', 'pipe', 'ex_wharf')),
  -- Smallest stem the price applies to; the index skips the quote for smaller stems.
  min_qty_mt             numeric(10,2) check (min_qty_mt is null or min_qty_mt > 0),
  -- Fixed per delivery; the index spreads them over the requested stem.
  barge_fee_usd          numeric(10,2) not null default 0 check (barge_fee_usd >= 0),
  mandatory_charges_usd  numeric(10,2) not null default 0 check (mandatory_charges_usd >= 0),
  valid_from             timestamptz not null,
  valid_until            timestamptz not null,
  source                 text not null check (source in ('supplier', 'admin_override', 'admin_input')),
  status                 text not null default 'submitted'
                         check (status in ('submitted', 'approved', 'rejected', 'withdrawn')),
  client_ref             text check (client_ref is null or length(client_ref) between 1 and 80),
  reason                 text,
  submitted_by           uuid references public.users(id),
  submitted_at           timestamptz not null default now(),
  decided_by             uuid references public.users(id),
  decided_at             timestamptz,
  decision_reason        text,
  superseded_at          timestamptz,
  constraint bunker_quotes_validity check (valid_until > valid_from),
  constraint bunker_quotes_superseded_only_approved check (superseded_at is null or status in ('approved', 'withdrawn')),
  constraint bunker_quotes_override_reason check (
    source <> 'admin_override' or length(btrim(coalesce(reason, ''))) >= 3
  )
);

comment on column public.bunker_quotes.price is
  'Execution price in good faith, USD per MT, before barge fee and mandatory charges. Never zero.';

-- One live (approved, not superseded) and one pending row per (supplier, port, product).
create unique index if not exists bunker_quotes_one_live
  on public.bunker_quotes (supplier_id, port_locode, product_key)
  where status = 'approved' and superseded_at is null;
create unique index if not exists bunker_quotes_one_pending
  on public.bunker_quotes (supplier_id, port_locode, product_key) where status = 'submitted';
create unique index if not exists bunker_quotes_client_ref
  on public.bunker_quotes (supplier_id, client_ref) where client_ref is not null;
create index if not exists bunker_quotes_port_product_idx
  on public.bunker_quotes (port_locode, product_key, submitted_at desc);
create index if not exists bunker_quotes_history_idx
  on public.bunker_quotes (supplier_id, port_locode, product_key, submitted_at desc);

create table if not exists public.bunker_quote_events (
  id           bigint generated always as identity primary key,
  quote_id     uuid references public.bunker_quotes(id),
  supplier_id  uuid not null references public.bunker_suppliers(id),
  port_locode  text not null,
  product_key  text not null,
  action       text not null
               check (action in ('submit', 'approve', 'reject', 'withdraw', 'override', 'import')),
  old_price    numeric(10,2),
  new_price    numeric(10,2),
  valid_until  timestamptz,
  actor        uuid references public.users(id),
  reason       text,
  created_at   timestamptz not null default now()
);

create index if not exists bunker_quote_events_supplier_idx
  on public.bunker_quote_events (supplier_id, created_at desc);
create index if not exists bunker_quote_events_created_idx
  on public.bunker_quote_events (created_at desc);

-- Append-only guards. A quote's content never changes; the permitted updates
-- are a status decision (submitted -> approved|rejected|withdrawn, approved ->
-- withdrawn) with its decided_* stamp, and setting superseded_at once.
-- Events are never changed.
create or replace function public.fn_bunker_quote_append_only()
returns trigger
language plpgsql set search_path to ''
as $$
declare
  v_state  text[] := array['status', 'decided_by', 'decided_at', 'decision_reason', 'superseded_at'];
begin
  if tg_op = 'DELETE' then
    raise exception 'BUNKER_IMMUTABLE: quotes are append-only' using errcode = '55000';
  end if;
  if (to_jsonb(new) - v_state) <> (to_jsonb(old) - v_state) then
    raise exception 'BUNKER_IMMUTABLE: quote content cannot change' using errcode = '55000';
  end if;
  if old.superseded_at is not null and new.superseded_at is distinct from old.superseded_at then
    raise exception 'BUNKER_IMMUTABLE: a quote can only be superseded once' using errcode = '55000';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'submitted' and new.status in ('approved', 'rejected', 'withdrawn'))
    or (old.status = 'approved'  and new.status = 'withdrawn')) then
    raise exception 'BUNKER_STATUS: % -> % is not allowed', old.status, new.status using errcode = '55000';
  end if;
  if new.status = old.status and (new.decided_by, new.decided_at, new.decision_reason)
       is distinct from (old.decided_by, old.decided_at, old.decision_reason) then
    raise exception 'BUNKER_IMMUTABLE: a decision is recorded once' using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.fn_bunker_quote_append_only() from public, anon, authenticated;

drop trigger if exists trg_bunker_quote_append_only on public.bunker_quotes;
create trigger trg_bunker_quote_append_only
before update or delete on public.bunker_quotes
for each row execute function public.fn_bunker_quote_append_only();

create or replace function public.fn_bunker_event_immutable()
returns trigger
language plpgsql set search_path to ''
as $$
begin
  raise exception 'BUNKER_IMMUTABLE: quote events are append-only' using errcode = '55000';
end;
$$;
revoke all on function public.fn_bunker_event_immutable() from public, anon, authenticated;

drop trigger if exists trg_bunker_event_immutable on public.bunker_quote_events;
create trigger trg_bunker_event_immutable
before update or delete on public.bunker_quote_events
for each row execute function public.fn_bunker_event_immutable();

alter table public.bunker_suppliers        enable row level security;
alter table public.bunker_supplier_ports   enable row level security;
alter table public.bunker_supplier_members enable row level security;
alter table public.bunker_quotes           enable row level security;
alter table public.bunker_quote_events     enable row level security;

revoke all on public.bunker_suppliers, public.bunker_supplier_ports, public.bunker_supplier_members,
              public.bunker_quotes, public.bunker_quote_events
  from anon, authenticated;

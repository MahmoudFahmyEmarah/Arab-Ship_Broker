-- ════════════════════════════════════════════════════════════════════════
-- Billing & Gateway Layer — Phase 1 schema (06 Sep 2026)
--
-- Decisions (owner, 6 Sep 2026): Egyptian issuer, USD list prices with the
-- EGP equivalent at the CBE rate frozen on each invoice; per-seat plans bought
-- by a company (personal subscriptions allowed too); bank transfer + Paymob
-- hosted checkout + owner manual activation; monthly and annual (10×) periods
-- with a 7-day grace; VAT treatment per customer (14% standard, zero-rated
-- export, pending review) until the accountant confirms; owner issues /
-- credits / refunds, a "billing" sub-admin may view and record transfers.
--
-- Principles: the database is the ledger. Money rows are written by the
-- service role only; members read their own company's documents; issued
-- invoices are immutable (corrections are credit/debit notes); every change
-- is audited; numbering is gapless per prefix and year; the ETA fields live
-- on the invoice from day one so the API integration is plumbing later.
-- ════════════════════════════════════════════════════════════════════════

-- ── enums ───────────────────────────────────────────────────────────────
do $$ begin
  create type public.billing_currency as enum ('USD', 'EGP');
  create type public.billing_period as enum ('monthly', 'annual');
  create type public.subscription_status as enum ('trialing', 'active', 'past_due', 'canceled', 'expired');
  create type public.invoice_status as enum ('draft', 'issued', 'partially_paid', 'paid', 'void');
  create type public.einvoice_status as enum ('not_submitted', 'submitted', 'valid', 'invalid', 'rejected', 'cancelled');
  create type public.payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');
  create type public.payment_method as enum ('bank_transfer', 'paymob', 'manual', 'credit_note');
  create type public.vat_treatment as enum ('standard', 'zero_rated_export', 'out_of_scope', 'pending_review');
  create type public.eta_receiver_type as enum ('B', 'P', 'F');
  create type public.eta_document_type as enum ('I', 'C', 'D');
exception when duplicate_object then null; end $$;

-- ── settings (single row) ───────────────────────────────────────────────
create table if not exists public.billing_settings (
  id                    integer primary key default 1 check (id = 1),
  issuer_legal_name     text,
  issuer_legal_name_ar  text,
  issuer_tax_id         text,               -- ETA tax registration number
  issuer_activity_code  text,               -- ETA taxpayer activity code
  issuer_branch_id      text not null default '0',
  issuer_address        jsonb not null default '{}'::jsonb,  -- {country,governate,regionCity,street,buildingNumber,postalCode}
  bank_details          jsonb not null default '{}'::jsonb,  -- {bank,accountName,iban,swift,currency,notes}
  invoice_prefix        text not null default 'ASB',
  vat_rate              numeric(5,2) not null default 14,
  grace_days            integer not null default 7,
  reminder_days         integer[] not null default '{7,1}',
  fx_source             text not null default 'CBE',
  paymob_enabled        boolean not null default false,
  paymob_merchant_id    text,
  paymob_integration_id text,
  paymob_iframe_id      text,
  updated_at            timestamptz not null default now()
);
insert into public.billing_settings (id) values (1) on conflict (id) do nothing;

-- secrets (Paymob API key / HMAC, ETA client id+secret) — Vault-backed
create table if not exists public.billing_secret (
  key        text primary key,
  secret_id  uuid not null,
  updated_at timestamptz not null default now()
);
create or replace function public.billing_set_secret(p_key text, p_value text)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_secret_id uuid;
begin
  if coalesce(trim(p_key), '') = '' then raise exception 'secret key required'; end if;
  if coalesce(p_value, '') = '' then raise exception 'secret value required'; end if;
  select secret_id into v_secret_id from public.billing_secret where key = p_key;
  if v_secret_id is null then
    v_secret_id := vault.create_secret(p_value, 'billing:' || p_key, 'ASB billing secret');
    insert into public.billing_secret (key, secret_id) values (p_key, v_secret_id);
  else
    perform vault.update_secret(v_secret_id, p_value);
    update public.billing_secret set updated_at = now() where key = p_key;
  end if;
end $$;
create or replace function public.billing_get_secret(p_key text)
returns text language plpgsql security definer set search_path to 'public'
as $$
declare v_secret_id uuid; v_secret text;
begin
  select secret_id into v_secret_id from public.billing_secret where key = p_key;
  if v_secret_id is null then return null; end if;
  select decrypted_secret into v_secret from vault.decrypted_secrets where id = v_secret_id;
  return v_secret;
end $$;
revoke all on function public.billing_set_secret(text, text) from public, anon, authenticated;
revoke all on function public.billing_get_secret(text) from public, anon, authenticated;
grant execute on function public.billing_set_secret(text, text) to service_role;
grant execute on function public.billing_get_secret(text) to service_role;

-- ── FX rates (USD→EGP, frozen per invoice) ──────────────────────────────
create table if not exists public.fx_rates (
  day        date not null,
  base       text not null default 'USD',
  quote      text not null default 'EGP',
  rate       numeric(14,5) not null check (rate > 0),
  source     text not null,                -- CBE · fallback provider · manual
  fetched_at timestamptz not null default now(),
  primary key (day, base, quote)
);

-- ── catalogue ───────────────────────────────────────────────────────────
create table if not exists public.plans (
  code        text primary key,            -- T2 · T3 · T4
  tier        public.subscription_tier_enum not null,
  name        text not null,
  name_ar     text,
  description text,
  egs_code    text,                        -- EG-<tax id>-SUB-T3 once registered
  gpc_code    text,
  is_active   boolean not null default true,
  sort_order  integer not null default 0
);
create table if not exists public.prices (
  id          uuid primary key default gen_random_uuid(),
  plan_code   text not null references public.plans(code),
  period      public.billing_period not null,
  currency    public.billing_currency not null,
  unit_amount numeric(12,2) not null check (unit_amount >= 0),   -- per seat per period
  active_from date not null default current_date,
  active_to   date,
  unique (plan_code, period, currency, active_from)
);
insert into public.plans (code, tier, name, name_ar, description, sort_order) values
  ('T2', 'T2', 'Standard',   'قياسي',  '30-day archive, Smart Parser, daily digest', 2),
  ('T3', 'T3', 'Subscriber', 'مشترك',  'Vessel names + IMO, full match intelligence, voyage calculators, 6-month archive', 3),
  ('T4', 'T4', 'Partner',    'شريك',   'Everything in Subscriber, partner dashboard, API access, account manager', 4)
on conflict (code) do nothing;
insert into public.prices (plan_code, period, currency, unit_amount) values
  ('T2', 'monthly', 'USD', 89),  ('T2', 'annual', 'USD', 890),
  ('T3', 'monthly', 'USD', 249), ('T3', 'annual', 'USD', 2490)
on conflict do nothing;

-- ── customers (one tax profile per company or per individual) ───────────
create table if not exists public.billing_customers (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid unique references public.organizations(id) on delete restrict,
  user_id        uuid unique references public.users(id) on delete restrict,   -- personal subscriptions
  legal_name     text not null,
  legal_name_ar  text,
  receiver_type  public.eta_receiver_type not null default 'B',
  tax_id         text,                      -- ETA tax id / UAE TRN / national id for P
  country        char(2) not null default 'EG',
  address        jsonb not null default '{}'::jsonb,  -- {governate,regionCity,street,buildingNumber,postalCode}
  currency       public.billing_currency not null default 'USD',
  vat_treatment  public.vat_treatment not null default 'pending_review',
  billing_email  text,
  phone          text,
  notes          text,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check ((org_id is not null) <> (user_id is not null))
);

-- seat flag on company memberships (which members consume a purchased seat)
alter table public.organization_members add column if not exists plan_seat boolean not null default false;

-- ── subscriptions ───────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  id                    uuid primary key default gen_random_uuid(),
  customer_id           uuid not null references public.billing_customers(id),
  plan_code             text not null references public.plans(code),
  period                public.billing_period not null default 'monthly',
  seats                 integer not null default 1 check (seats >= 1),
  status                public.subscription_status not null default 'trialing',
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean not null default false,
  gateway               text,                      -- paymob · null
  gateway_customer_id   text,
  gateway_token_ref     text,                      -- saved-card token reference (never the card)
  notes                 text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists subscriptions_customer_idx on public.subscriptions (customer_id, status);

-- ── invoices ────────────────────────────────────────────────────────────
create table if not exists public.invoice_counters (
  prefix text not null, year integer not null, last integer not null default 0,
  primary key (prefix, year)
);
create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  number              text unique,                 -- ASB-2026-000012, assigned at issue
  document_type       public.eta_document_type not null default 'I',
  related_invoice_id  uuid references public.invoices(id),   -- credit / debit notes point at the original
  customer_id         uuid not null references public.billing_customers(id),
  subscription_id     uuid references public.subscriptions(id),
  status              public.invoice_status not null default 'draft',
  einvoice_status     public.einvoice_status not null default 'not_submitted',
  currency            public.billing_currency not null,
  fx_rate             numeric(14,5),               -- USD→EGP frozen at issue (1 for EGP)
  fx_source           text,
  fx_date             date,
  vat_treatment       public.vat_treatment not null default 'standard',
  vat_rate            numeric(5,2) not null default 14,
  period_start        date,
  period_end          date,
  issuer_snapshot     jsonb,                       -- billing_settings issuer block at issue time
  customer_snapshot   jsonb,                       -- billing_customers row at issue time
  subtotal            numeric(14,2) not null default 0,
  discount_total      numeric(14,2) not null default 0,
  tax_total           numeric(14,2) not null default 0,
  total               numeric(14,2) not null default 0,
  amount_paid         numeric(14,2) not null default 0,
  egp_total           numeric(14,2),
  due_at              timestamptz,
  issued_at           timestamptz,
  paid_at             timestamptz,
  voided_at           timestamptz,
  void_reason         text,
  notes               text,
  eta_uuid            text,
  eta_long_id         text,
  eta_submission_id   text,
  eta_hash            text,
  eta_submitted_at    timestamptz,
  eta_response        jsonb,
  pdf_path            text,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists invoices_customer_idx on public.invoices (customer_id, created_at desc);
create index if not exists invoices_status_idx on public.invoices (status, due_at);

create table if not exists public.invoice_lines (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.invoices(id) on delete cascade,
  position       integer not null default 1,
  description    text not null,
  description_ar text,
  item_type      text not null default 'EGS',      -- EGS · GS1
  item_code      text,
  unit_type      text not null default 'EA',
  quantity       numeric(12,3) not null default 1 check (quantity > 0),
  unit_price     numeric(14,2) not null default 0,
  discount       numeric(14,2) not null default 0,
  tax_type       text not null default 'T1',
  tax_subtype    text not null default 'V009',     -- V009 = 14% standard
  tax_rate       numeric(5,2) not null default 14,
  net_total      numeric(14,2) not null default 0,
  tax_amount     numeric(14,2) not null default 0,
  total          numeric(14,2) not null default 0
);
create index if not exists invoice_lines_invoice_idx on public.invoice_lines (invoice_id, position);

-- ── payments ────────────────────────────────────────────────────────────
create table if not exists public.payments (
  id                 uuid primary key default gen_random_uuid(),
  invoice_id         uuid not null references public.invoices(id),
  customer_id        uuid not null references public.billing_customers(id),
  method             public.payment_method not null,
  status             public.payment_status not null default 'succeeded',
  amount             numeric(14,2) not null check (amount <> 0),
  currency           public.billing_currency not null,
  gateway            text,
  gateway_payment_id text unique,
  reference          text,                         -- bank transfer reference
  received_at        timestamptz not null default now(),
  recorded_by        uuid,
  note               text,
  raw                jsonb,
  created_at         timestamptz not null default now()
);
create index if not exists payments_invoice_idx on public.payments (invoice_id);

-- ── gateway webhook inbox (idempotency + forensics) ─────────────────────
create table if not exists public.billing_webhook_inbox (
  id           bigint generated always as identity primary key,
  gateway      text not null,
  event_id     text not null,
  signature_ok boolean not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text,
  unique (gateway, event_id)
);

-- ── e-invoice submissions (every talk with a tax authority) ─────────────
create table if not exists public.einvoice_submissions (
  id           bigint generated always as identity primary key,
  invoice_id   uuid not null references public.invoices(id),
  authority    text not null default 'ETA',
  mode         text not null default 'portal',      -- portal · api
  request      jsonb,
  response     jsonb,
  status       public.einvoice_status not null default 'submitted',
  uuid         text,
  long_id      text,
  attempted_at timestamptz not null default now(),
  attempted_by uuid
);

-- ── audit (append-only) ─────────────────────────────────────────────────
create table if not exists public.billing_events (
  id        bigint generated always as identity primary key,
  at        timestamptz not null default now(),
  actor     uuid,                                   -- auth uid when available
  entity    text not null,
  entity_id uuid,
  action    text not null,
  before    jsonb,
  after     jsonb
);
create index if not exists billing_events_entity_idx on public.billing_events (entity, entity_id, at desc);

create or replace function public.fn_billing_audit()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
begin
  insert into public.billing_events (actor, entity, entity_id, action, before, after)
  values (
    nullif(current_setting('request.jwt.claim.sub', true), '')::uuid,
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', null)::uuid,
    lower(tg_op),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;
do $$
declare t text;
begin
  foreach t in array array['billing_customers','subscriptions','invoices','invoice_lines','payments','billing_settings']
  loop
    execute format('drop trigger if exists trg_%I_audit on public.%I', t, t);
    execute format('create trigger trg_%I_audit after insert or update or delete on public.%I for each row execute function public.fn_billing_audit()', t, t);
  end loop;
end $$;
-- nobody edits history
revoke update, delete on public.billing_events from public, anon, authenticated;

-- ── immutability of issued invoices ─────────────────────────────────────
create or replace function public.fn_invoice_guard()
returns trigger language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Issued invoices cannot be deleted — void it or issue a credit note'; end if;
    return old;
  end if;
  if old.status <> 'draft' then
    -- once issued, only settlement / e-invoice / file columns may change
    if new.document_type is distinct from old.document_type or new.customer_id is distinct from old.customer_id
       or new.currency is distinct from old.currency or new.fx_rate is distinct from old.fx_rate
       or new.subtotal is distinct from old.subtotal or new.discount_total is distinct from old.discount_total
       or new.tax_total is distinct from old.tax_total or new.total is distinct from old.total
       or new.egp_total is distinct from old.egp_total or new.number is distinct from old.number
       or new.issued_at is distinct from old.issued_at or new.issuer_snapshot is distinct from old.issuer_snapshot
       or new.customer_snapshot is distinct from old.customer_snapshot or new.vat_treatment is distinct from old.vat_treatment
       or new.vat_rate is distinct from old.vat_rate or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end or new.related_invoice_id is distinct from old.related_invoice_id
    then
      raise exception 'Invoice % is issued and immutable — corrections go through a credit or debit note', old.number;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_invoice_guard on public.invoices;
create trigger trg_invoice_guard before update or delete on public.invoices for each row execute function public.fn_invoice_guard();

create or replace function public.fn_invoice_lines_guard()
returns trigger language plpgsql
as $$
declare v_status public.invoice_status;
begin
  select status into v_status from public.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Lines of an issued invoice cannot change';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_invoice_lines_guard on public.invoice_lines;
create trigger trg_invoice_lines_guard before insert or update or delete on public.invoice_lines for each row execute function public.fn_invoice_lines_guard();

-- ── gapless numbering ───────────────────────────────────────────────────
create or replace function public.fn_next_invoice_number(p_prefix text, p_year integer)
returns text language plpgsql security definer set search_path to 'public'
as $$
declare v_last integer;
begin
  insert into public.invoice_counters (prefix, year, last) values (p_prefix, p_year, 0)
  on conflict (prefix, year) do nothing;
  update public.invoice_counters set last = last + 1 where prefix = p_prefix and year = p_year returning last into v_last;
  return format('%s-%s-%s', p_prefix, p_year, lpad(v_last::text, 6, '0'));
end $$;
revoke all on function public.fn_next_invoice_number(text, integer) from public, anon, authenticated;

-- ── invoice totals from lines (draft only) ──────────────────────────────
create or replace function public.fn_invoice_recalc(p_invoice_id uuid)
returns void language plpgsql security definer set search_path to 'public'
as $$
declare v_sub numeric; v_disc numeric; v_tax numeric; v_total numeric; v_fx numeric; v_cur public.billing_currency;
begin
  select coalesce(sum(quantity * unit_price), 0), coalesce(sum(discount), 0), coalesce(sum(tax_amount), 0), coalesce(sum(total), 0)
    into v_sub, v_disc, v_tax, v_total
  from public.invoice_lines where invoice_id = p_invoice_id;
  select fx_rate, currency into v_fx, v_cur from public.invoices where id = p_invoice_id;
  update public.invoices
     set subtotal = round(v_sub, 2), discount_total = round(v_disc, 2), tax_total = round(v_tax, 2), total = round(v_total, 2),
         egp_total = case when v_cur = 'EGP' then round(v_total, 2) when v_fx is not null then round(v_total * v_fx, 2) end
   where id = p_invoice_id and status = 'draft';
end $$;
revoke all on function public.fn_invoice_recalc(uuid) from public, anon, authenticated;

-- ── payments settle invoices ────────────────────────────────────────────
create or replace function public.fn_payment_settle()
returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare v_inv public.invoices%rowtype; v_paid numeric;
begin
  select * into v_inv from public.invoices where id = coalesce(new.invoice_id, old.invoice_id) for update;
  select coalesce(sum(case when status = 'succeeded' then amount when status = 'refunded' then 0 else 0 end), 0)
    into v_paid from public.payments where invoice_id = v_inv.id;
  update public.invoices
     set amount_paid = round(v_paid, 2),
         status = case
           when status in ('void', 'draft') then status
           when v_paid >= total - 0.005 then 'paid'::public.invoice_status
           when v_paid > 0 then 'partially_paid'::public.invoice_status
           else 'issued'::public.invoice_status end,
         paid_at = case when v_paid >= total - 0.005 and status <> 'void' then coalesce(paid_at, now()) else null end
   where id = v_inv.id;
  return coalesce(new, old);
end $$;
drop trigger if exists trg_payment_settle on public.payments;
create trigger trg_payment_settle after insert or update or delete on public.payments for each row execute function public.fn_payment_settle();

-- ── entitlements: tiers follow subscriptions ────────────────────────────
-- A member's tier = the best of: a personal active subscription, or a seat on
-- an active company subscription (plan_seat = true, within the seat count,
-- oldest memberships first). Everyone else is T1. Admin accounts untouched.
create or replace function public.fn_billing_sync_tiers()
returns integer language plpgsql security definer set search_path to 'public'
as $$
declare v_changed integer := 0;
begin
  with active_subs as (
    select s.id, s.customer_id, s.seats, p.tier, c.org_id, c.user_id
    from public.subscriptions s
    join public.plans p on p.code = s.plan_code
    join public.billing_customers c on c.id = s.customer_id
    where s.status in ('trialing', 'active', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now())
  ),
  seats as (
    select m.user_id, a.tier,
           row_number() over (partition by a.id order by m.added_at, m.user_id) as rn, a.seats
    from active_subs a
    join public.organization_members m on m.org_id = a.org_id and m.is_current and m.status = 'active' and m.plan_seat
    where a.org_id is not null
  ),
  personal as (
    select a.user_id, a.tier from active_subs a where a.user_id is not null
  ),
  entitled as (
    select user_id, max(tier) as tier from (
      select user_id, tier from seats where rn <= seats
      union all
      select user_id, tier from personal
    ) x group by user_id
  ),
  target as (
    select u.id, coalesce(e.tier, 'T1'::public.subscription_tier_enum) as tier
    from public.users u left join entitled e on e.user_id = u.id
    where u.role <> 'admin'
  ),
  upd as (
    update public.users u set subscription_tier = t.tier
    from target t where t.id = u.id and u.subscription_tier is distinct from t.tier
    returning 1
  )
  select count(*) into v_changed from upd;
  return v_changed;
end $$;
revoke all on function public.fn_billing_sync_tiers() from public, anon, authenticated;
grant execute on function public.fn_billing_sync_tiers() to service_role;

-- ── member-facing reads ─────────────────────────────────────────────────
-- Which billing customer(s) the signed-in member may see: their own personal
-- profile and the company they belong to (active membership).
create or replace function public.fn_my_billing_customer_ids()
returns setof uuid language sql stable security definer set search_path to 'public'
as $$
  select c.id from public.billing_customers c where c.user_id = public.fn_app_user_id()
  union
  select c.id from public.billing_customers c
  join public.organization_members m on m.org_id = c.org_id
  where m.user_id = public.fn_app_user_id() and m.is_current and m.status = 'active';
$$;
grant execute on function public.fn_my_billing_customer_ids() to authenticated;

-- Bank details for the pay-by-transfer instructions (never the whole settings row).
create or replace function public.fn_billing_bank_details()
returns jsonb language sql stable security definer set search_path to 'public'
as $$ select bank_details from public.billing_settings where id = 1; $$;
grant execute on function public.fn_billing_bank_details() to authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────────
alter table public.billing_settings      enable row level security;
alter table public.billing_secret        enable row level security;
alter table public.fx_rates              enable row level security;
alter table public.plans                 enable row level security;
alter table public.prices                enable row level security;
alter table public.billing_customers     enable row level security;
alter table public.subscriptions         enable row level security;
alter table public.invoices              enable row level security;
alter table public.invoice_lines         enable row level security;
alter table public.payments              enable row level security;
alter table public.billing_webhook_inbox enable row level security;
alter table public.einvoice_submissions  enable row level security;
alter table public.billing_events        enable row level security;
alter table public.invoice_counters      enable row level security;

drop policy if exists billing_settings_admin on public.billing_settings;
create policy billing_settings_admin on public.billing_settings for select to authenticated using (public.fn_is_admin());
drop policy if exists plans_read on public.plans;
create policy plans_read on public.plans for select to authenticated using (true);
drop policy if exists prices_read on public.prices;
create policy prices_read on public.prices for select to authenticated using (true);
drop policy if exists fx_read on public.fx_rates;
create policy fx_read on public.fx_rates for select to authenticated using (true);

drop policy if exists customers_read on public.billing_customers;
create policy customers_read on public.billing_customers for select to authenticated
  using (public.fn_is_admin() or id in (select public.fn_my_billing_customer_ids()));
drop policy if exists subscriptions_read on public.subscriptions;
create policy subscriptions_read on public.subscriptions for select to authenticated
  using (public.fn_is_admin() or customer_id in (select public.fn_my_billing_customer_ids()));
drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices for select to authenticated
  using (public.fn_is_admin() or (status <> 'draft' and customer_id in (select public.fn_my_billing_customer_ids())));
drop policy if exists invoice_lines_read on public.invoice_lines;
create policy invoice_lines_read on public.invoice_lines for select to authenticated
  using (exists (select 1 from public.invoices i where i.id = invoice_id
                 and (public.fn_is_admin() or (i.status <> 'draft' and i.customer_id in (select public.fn_my_billing_customer_ids())))));
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated
  using (public.fn_is_admin() or customer_id in (select public.fn_my_billing_customer_ids()));
drop policy if exists einvoice_admin on public.einvoice_submissions;
create policy einvoice_admin on public.einvoice_submissions for select to authenticated using (public.fn_is_admin());
drop policy if exists billing_events_admin on public.billing_events;
create policy billing_events_admin on public.billing_events for select to authenticated using (public.fn_is_admin());
-- billing_secret, billing_webhook_inbox, invoice_counters: service role only (no policies)

grant select on public.billing_settings, public.plans, public.prices, public.fx_rates, public.billing_customers,
  public.subscriptions, public.invoices, public.invoice_lines, public.payments, public.einvoice_submissions, public.billing_events
  to authenticated;
grant all on public.billing_settings, public.billing_secret, public.fx_rates, public.plans, public.prices, public.billing_customers,
  public.subscriptions, public.invoices, public.invoice_lines, public.payments, public.billing_webhook_inbox,
  public.einvoice_submissions, public.billing_events, public.invoice_counters to service_role;
grant usage, select on all sequences in schema public to service_role;

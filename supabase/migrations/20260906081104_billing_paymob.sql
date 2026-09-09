-- Billing Phase 2 — Paymob hosted checkout (06 Sep 2026)
-- A payment intent is created when a member presses "Pay by card": it holds
-- the Paymob order id so the webhook / return callback can find the invoice,
-- the EGP amount charged (USD invoices are charged at the invoice's frozen
-- rate) and the outcome. Service-role only; members see the result on the
-- invoice itself.
create table if not exists public.billing_payment_intents (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.invoices(id),
  gateway           text not null default 'paymob',
  gateway_order_id  text unique,
  merchant_ref      text not null unique,
  amount_cents      bigint not null check (amount_cents > 0),
  currency          text not null default 'EGP',
  invoice_amount    numeric(14,2) not null,        -- what this intent settles, in the invoice currency
  status            text not null default 'created' check (status in ('created', 'paid', 'failed', 'expired')),
  gateway_txn_id    text,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  raw               jsonb
);
create index if not exists billing_payment_intents_invoice_idx on public.billing_payment_intents (invoice_id, created_at desc);
alter table public.billing_payment_intents enable row level security;
drop policy if exists payment_intents_admin on public.billing_payment_intents;
create policy payment_intents_admin on public.billing_payment_intents for select to authenticated using (public.fn_is_admin());
grant select on public.billing_payment_intents to authenticated;
grant all on public.billing_payment_intents to service_role;

-- reminders sent per invoice (so the cron never nags twice for the same milestone)
create table if not exists public.billing_reminders (
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  kind        text not null,                          -- due-7 · due-1 · overdue · expired
  sent_at     timestamptz not null default now(),
  sent_to     text,
  primary key (invoice_id, kind)
);
alter table public.billing_reminders enable row level security;
drop policy if exists billing_reminders_admin on public.billing_reminders;
create policy billing_reminders_admin on public.billing_reminders for select to authenticated using (public.fn_is_admin());
grant select on public.billing_reminders to authenticated;
grant all on public.billing_reminders to service_role;

-- renewal drafts are raised this many days before the period ends
alter table public.billing_settings add column if not exists renew_before_days integer not null default 7;

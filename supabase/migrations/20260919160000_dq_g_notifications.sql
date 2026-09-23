-- ════════════════════════════════════════════════════════════════════════
-- Data Quality · workstream G — durable notifications and truthful scheduling
-- (19 Sep 2026, amended 20 Sep; re-audit: mark-before-send, hour-only schedule)
--
--   dq_notification_outbox   every notification is a row first: unique
--       idempotency key, kind, payload, status (queued → sending → sent |
--       failed), claim token + lease, attempts, next_attempt_at with bounded
--       exponential back-off, sent_at, last_error. The engine and the cron
--       ENQUEUE inside their own transactions (fn_dq_settle_run,
--       fn_dq_finish_run, fn_dq_settle_ai, the cron's digest); a worker
--       (lib/dq/notify.ts deliverOutbox) claims, sends over SMTP and marks
--       sent only after SMTP succeeded. A failed send stays retryable.
--   dq_runs.schedule_key     one nightly run per UTC day, enforced by a unique
--       index, so concurrent cron invocations cannot create two; the cron
--       compares the full HH:MM and catches up once when it fires late.
--   dq_config_events         gains kind 'notification' for delivery records.
-- Idempotent. DOWN: supabase/rollback/20260919_dq_g_down.sql
-- ════════════════════════════════════════════════════════════════════════
set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- ── 1 · the outbox ──────────────────────────────────────────────────────────
create table if not exists public.dq_notification_outbox (
  id              bigserial primary key,
  idem_key        text not null unique,
  kind            text not null check (kind in ('run_finished', 'budget80', 'digest')),
  payload         jsonb not null default '{}'::jsonb,
  status          text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  claim_token     uuid,
  lease_until     timestamptz,
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  sent_at         timestamptz,
  last_error      text,
  recipients      text[],
  created_at      timestamptz not null default now()
);
create index if not exists dq_notification_outbox_due_idx on public.dq_notification_outbox (next_attempt_at) where status in ('queued', 'sending');
alter table public.dq_notification_outbox enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'dq_notification_outbox' and policyname = 'dq_notification_outbox_admin_read') then
    create policy dq_notification_outbox_admin_read on public.dq_notification_outbox for select using (public.fn_is_admin());
  end if;
end $$;
grant select on public.dq_notification_outbox to service_role;
comment on table public.dq_notification_outbox is 'Notifications to deliver: enqueued inside the transaction that decided them, claimed under a lease, marked sent only after SMTP succeeded, retried with bounded back-off.';

-- Enqueue once per idempotency key. Returns true when a row was created.
create or replace function public.fn_dq_outbox_enqueue(p_kind text, p_idem_key text, p_payload jsonb default '{}'::jsonb)
 returns boolean language sql security definer set search_path to ''
as $$
  with i as (
    insert into public.dq_notification_outbox (kind, idem_key, payload) values (p_kind, p_idem_key, coalesce(p_payload, '{}'::jsonb))
    on conflict (idem_key) do nothing returning 1
  ) select exists (select 1 from i);
$$;

-- Claim due rows under a lease (FOR UPDATE SKIP LOCKED): two workers never
-- hold the same row; a lease that lapses mid-send is claimable again.
-- 21 Sep 2026: the default lease was 120 s, shorter than a slow SMTP
-- conversation, so a send in progress could be reclaimed and sent AGAIN. The
-- claim token protects the database row, not the mail already accepted by the
-- server. The lease is now 600 s by default, which is longer than any send
-- this module makes, and the contract is documented as at-least-once: each
-- message carries a stable Message-ID derived from its idempotency key so a
-- receiving server can collapse a duplicate.
create or replace function public.fn_dq_outbox_claim(p_limit integer default 10, p_ttl_seconds integer default 600, p_max_attempts integer default 8)
 returns setof public.dq_notification_outbox language plpgsql security definer set search_path to ''
as $$
declare
  v_ttl interval := make_interval(secs => greatest(15, least(coalesce(p_ttl_seconds, 600), 3600)));
  v_lim int := greatest(1, least(coalesce(p_limit, 10), 100));
  v_max int := greatest(1, least(coalesce(p_max_attempts, 8), 100));
begin
  -- Give up on a row whose attempts are spent, BEFORE claiming anything
  -- (21 Sep 2026).
  --
  -- The attempt is counted here, at claim time, so a worker that crashes
  -- mid-send does shrink the budget rather than retrying free of charge. But
  -- only fn_dq_outbox_settle ever marked a row `failed` at the cap — and a
  -- crashed worker never settles. So a row whose worker kept dying was
  -- re-claimed for ever: attempts climbing past eight, past eighty, with
  -- nothing to stop it and nothing in the console to show it had given up.
  -- The cap belongs on the claim as well.
  update public.dq_notification_outbox o
     set status = 'failed',
         claim_token = null,
         last_error = coalesce(o.last_error,
           format('abandoned after %s attempt(s): the worker never settled its claim', o.attempts))
   where o.attempts >= v_max
     and (o.status = 'queued' or (o.status = 'sending' and o.lease_until < now()));

  return query
  with c as (
    select o.id from public.dq_notification_outbox o
     where (o.status = 'queued' or (o.status = 'sending' and o.lease_until < now()))
       and o.next_attempt_at <= now()
       and o.attempts < v_max
     order by o.next_attempt_at, o.id
     limit v_lim
       for update skip locked
  )
  update public.dq_notification_outbox o
     set status = 'sending', claim_token = gen_random_uuid(), lease_until = now() + v_ttl, attempts = o.attempts + 1
    from c where o.id = c.id
  returning o.*;
end $$;

comment on function public.fn_dq_outbox_claim(integer, integer, integer) is
  'Claim due notifications under a lease. Counts the attempt at claim time, so a crashed worker still spends its budget, and fails a row whose budget is spent so an abandoned claim cannot be retried for ever. Delivery is AT-LEAST-ONCE: see lib/dq/notify.ts.';

-- Settle one claimed row: sent (only after SMTP succeeded), or retry later
-- with back-off 2^attempts minutes (max 4 h), or failed after p_max_attempts.
create or replace function public.fn_dq_outbox_settle(p_id bigint, p_token uuid, p_ok boolean, p_error text default null, p_recipients text[] default null, p_max_attempts integer default 8)
 returns boolean language plpgsql security definer set search_path to ''
as $$
declare o public.dq_notification_outbox%rowtype;
begin
  select * into o from public.dq_notification_outbox where id = p_id for update;
  if not found or o.claim_token is distinct from p_token or o.status <> 'sending' then return false; end if;
  if p_ok then
    -- p_error on a successful settle is a delivery note ("skipped: recipients empty"), kept for the console
    update public.dq_notification_outbox set status = 'sent', sent_at = now(), claim_token = null, lease_until = null, last_error = left(p_error, 500), recipients = coalesce(p_recipients, recipients) where id = p_id;
  elsif o.attempts >= p_max_attempts then
    update public.dq_notification_outbox set status = 'failed', claim_token = null, lease_until = null, last_error = left(p_error, 500), recipients = coalesce(p_recipients, recipients) where id = p_id;
  else
    update public.dq_notification_outbox
       set status = 'queued', claim_token = null, lease_until = null, last_error = left(p_error, 500), recipients = coalesce(p_recipients, recipients),
           next_attempt_at = now() + make_interval(mins => least(power(2, o.attempts)::int, 240))
     where id = p_id;
  end if;
  return true;
end $$;

-- Requeue a failed notification by hand (console "Retry").
create or replace function public.fn_dq_outbox_requeue(p_id bigint)
 returns boolean language sql security definer set search_path to ''
as $$
  with u as (update public.dq_notification_outbox set status = 'queued', attempts = 0, next_attempt_at = now(), last_error = null where id = p_id and status = 'failed' returning 1)
  select exists (select 1 from u);
$$;

-- ── 2 · one nightly run per day ─────────────────────────────────────────────
alter table public.dq_runs add column if not exists schedule_key text;
create unique index if not exists dq_runs_schedule_key_uq on public.dq_runs (schedule_key) where schedule_key is not null;
comment on column public.dq_runs.schedule_key is 'nightly/<UTC date> for the scheduler''s run of that day: the unique index makes a second cron invocation a no-op.';

-- ── 3 · delivery records in the configuration history ───────────────────────
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.dq_config_events'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table public.dq_config_events drop constraint %I', c.conname);
  end loop;
  alter table public.dq_config_events add constraint dq_config_events_kind_check
    check (kind in ('channel_mode', 'settings', 'notification'));
end $$;
grant insert on public.dq_config_events to service_role;

revoke all on function public.fn_dq_outbox_enqueue(text, text, jsonb) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_outbox_claim(integer, integer, integer) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_outbox_settle(bigint, uuid, boolean, text, text[], integer) from public, anon, authenticated, dq_evaluator;
revoke all on function public.fn_dq_outbox_requeue(bigint) from public, anon, authenticated, dq_evaluator;
grant execute on function public.fn_dq_outbox_enqueue(text, text, jsonb), public.fn_dq_outbox_claim(integer, integer, integer), public.fn_dq_outbox_settle(bigint, uuid, boolean, text, text[], integer), public.fn_dq_outbox_requeue(bigint) to service_role;

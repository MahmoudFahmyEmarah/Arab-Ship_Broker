-- Shared member notifications: private-by-default records plus a leased,
-- service-only email delivery queue. Fixture Room owns masking-aware event
-- projection; this core accepts only render-ready safe snapshots.
-- DOWN: supabase/rollback/20260923350000_shared_fixture_services_down.sql

set local lock_timeout = '5s';
set local statement_timeout = '10min';

create table public.notification_preferences (
  user_id          uuid primary key references public.users(id) on delete cascade,
  in_app_enabled   boolean not null default true,
  email_mode       text not null default 'digest'
                   check (email_mode in ('instant', 'digest', 'off')),
  digest_hour_utc  smallint not null default 7
                   check (digest_hour_utc between 0 and 23),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table public.notifications (
  id                uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references public.users(id) on delete restrict,
  dedupe_key        text not null check (char_length(dedupe_key) between 1 and 180),
  kind              text not null check (kind ~ '^[a-z0-9][a-z0-9_.-]{0,79}$'),
  importance        text not null default 'normal'
                    check (importance in ('urgent', 'normal', 'info')),
  title             text not null check (char_length(title) between 1 and 160),
  body              text not null check (char_length(body) between 1 and 1200),
  href              text check (href is null or (left(href, 1) = '/' and left(href, 2) <> '//' and char_length(href) <= 500)),
  payload           jsonb not null default '{}'::jsonb
                    check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 16384),
  in_app_visible    boolean not null default true,
  read_at           timestamptz,
  expires_at        timestamptz,
  created_at        timestamptz not null default now(),
  unique (recipient_user_id, dedupe_key)
);

create index notifications_member_feed_idx
  on public.notifications (recipient_user_id, created_at desc, id)
  where in_app_visible;
create index notifications_member_unread_idx
  on public.notifications (recipient_user_id, created_at desc)
  where in_app_visible and read_at is null;

create table public.notification_deliveries (
  id               uuid primary key default gen_random_uuid(),
  notification_id  uuid not null references public.notifications(id) on delete cascade,
  channel          text not null check (channel in ('email')),
  status           text not null default 'queued'
                   check (status in ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  claim_token      uuid,
  lease_until      timestamptz,
  attempts         integer not null default 0 check (attempts >= 0),
  next_attempt_at  timestamptz not null default now(),
  sent_at          timestamptz,
  last_error       text check (last_error is null or char_length(last_error) <= 500),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (notification_id, channel),
  check ((status = 'sending') = (claim_token is not null and lease_until is not null))
);

create index notification_deliveries_due_idx
  on public.notification_deliveries (next_attempt_at, id)
  where status in ('queued', 'sending');

alter table public.notification_preferences enable row level security;
alter table public.notifications enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on table public.notification_preferences from public, anon, authenticated;
revoke all on table public.notifications from public, anon, authenticated;
revoke all on table public.notification_deliveries from public, anon, authenticated;
grant select, insert, update, delete on table public.notification_preferences to service_role;
grant select, insert, update, delete on table public.notifications to service_role;
grant select, insert, update, delete on table public.notification_deliveries to service_role;

comment on table public.notifications is
  'Durable member notifications. Payloads are render-ready masking-safe snapshots; direct member table access is forbidden.';
comment on table public.notification_deliveries is
  'Leased at-least-once external deliveries. Recipient addresses are resolved at send time and are not persisted here.';

create or replace function public.fn_notification_actor()
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.fn_app_user_id();
begin
  if v_actor is null or not exists (
    select 1 from public.users u where u.id = v_actor and u.is_active
  ) then
    raise exception using errcode = '42501', message = 'NTF_AUTH: active member required';
  end if;
  return v_actor;
end;
$$;

create or replace function public.list_my_notifications(
  p_limit integer default 30,
  p_before timestamptz default null
)
returns table (
  id uuid,
  kind text,
  importance text,
  title text,
  body text,
  href text,
  payload jsonb,
  read_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.fn_notification_actor();
  v_limit integer := greatest(1, least(coalesce(p_limit, 30), 100));
begin
  return query
  select n.id, n.kind, n.importance, n.title, n.body, n.href, n.payload,
         n.read_at, n.expires_at, n.created_at
    from public.notifications n
   where n.recipient_user_id = v_actor
     and n.in_app_visible
     and (n.expires_at is null or n.expires_at > now())
     and (p_before is null or n.created_at < p_before)
   order by n.created_at desc, n.id desc
   limit v_limit;
end;
$$;

create or replace function public.mark_notifications_read(p_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.fn_notification_actor();
  v_count integer;
begin
  if coalesce(cardinality(p_ids), 0) = 0 then return 0; end if;
  if cardinality(p_ids) > 100 then
    raise exception using errcode = '22023', message = 'NTF_INPUT: at most 100 notifications may be marked at once';
  end if;
  update public.notifications n
     set read_at = coalesce(n.read_at, now())
   where n.recipient_user_id = v_actor
     and n.id = any (p_ids)
     and n.in_app_visible
     and n.read_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.notification_badge()
returns integer
language sql
stable
security definer
set search_path to ''
as $$
  select count(*)::integer
    from public.notifications n
   where n.recipient_user_id = public.fn_notification_actor()
     and n.in_app_visible
     and n.read_at is null
     and (n.expires_at is null or n.expires_at > now());
$$;

create or replace function public.set_notification_preferences(
  p_in_app_enabled boolean,
  p_email_mode text,
  p_digest_hour_utc integer
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_actor uuid := public.fn_notification_actor();
  v_row public.notification_preferences%rowtype;
begin
  if p_email_mode is null or p_email_mode not in ('instant', 'digest', 'off') then
    raise exception using errcode = '22023', message = 'NTF_INPUT: invalid email mode';
  end if;
  if p_digest_hour_utc is null or p_digest_hour_utc not between 0 and 23 then
    raise exception using errcode = '22023', message = 'NTF_INPUT: digest hour must be 0..23 UTC';
  end if;

  insert into public.notification_preferences as p
    (user_id, in_app_enabled, email_mode, digest_hour_utc, updated_at)
  values
    (v_actor, coalesce(p_in_app_enabled, true), p_email_mode, p_digest_hour_utc, now())
  on conflict (user_id) do update
    set in_app_enabled = excluded.in_app_enabled,
        email_mode = excluded.email_mode,
        digest_hour_utc = excluded.digest_hour_utc,
        updated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

create or replace function public.fn_notification_enqueue(
  p_recipient_user_id uuid,
  p_kind text,
  p_dedupe_key text,
  p_title text,
  p_body text,
  p_href text default null,
  p_importance text default 'normal',
  p_payload jsonb default '{}'::jsonb,
  p_request_email boolean default true,
  p_not_before timestamptz default null,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_id uuid;
  v_pref public.notification_preferences%rowtype;
  v_status text;
  v_next timestamptz;
  v_digest timestamptz;
begin
  if p_recipient_user_id is null or not exists (
    select 1 from public.users u where u.id = p_recipient_user_id and u.is_active
  ) then
    raise exception using errcode = '22023', message = 'NTF_RECIPIENT: active recipient required';
  end if;
  if p_expires_at is not null and p_expires_at <= now() then
    raise exception using errcode = '22023', message = 'NTF_INPUT: expiry must be in the future';
  end if;

  select * into v_pref
    from public.notification_preferences p
   where p.user_id = p_recipient_user_id;
  if not found then
    v_pref.user_id := p_recipient_user_id;
    v_pref.in_app_enabled := true;
    v_pref.email_mode := 'digest';
    v_pref.digest_hour_utc := 7;
  end if;

  insert into public.notifications
    (recipient_user_id, dedupe_key, kind, importance, title, body, href, payload,
     in_app_visible, expires_at)
  values
    (p_recipient_user_id, p_dedupe_key, p_kind, p_importance, p_title, p_body,
     p_href, coalesce(p_payload, '{}'::jsonb), v_pref.in_app_enabled, p_expires_at)
  on conflict (recipient_user_id, dedupe_key) do nothing
  returning id into v_id;

  if v_id is null then
    select n.id into v_id
      from public.notifications n
     where n.recipient_user_id = p_recipient_user_id
       and n.dedupe_key = p_dedupe_key;
  end if;

  if not coalesce(p_request_email, true) or v_pref.email_mode = 'off' then
    v_status := 'suppressed';
    v_next := coalesce(p_not_before, now());
  elsif p_importance = 'urgent' or v_pref.email_mode = 'instant' then
    v_status := 'queued';
    v_next := greatest(now(), coalesce(p_not_before, now()));
  else
    v_status := 'queued';
    v_digest := date_trunc('day', now()) + make_interval(hours => v_pref.digest_hour_utc);
    if v_digest <= now() then v_digest := v_digest + interval '1 day'; end if;
    v_next := greatest(v_digest, coalesce(p_not_before, v_digest));
  end if;

  insert into public.notification_deliveries
    (notification_id, channel, status, next_attempt_at, last_error)
  values
    (v_id, 'email', v_status, v_next,
     case when v_status = 'suppressed' then 'suppressed by member preference or projector' end)
  on conflict (notification_id, channel) do nothing;

  return v_id;
end;
$$;

create or replace function public.fn_notification_delivery_claim(
  p_limit integer default 25,
  p_ttl_seconds integer default 600,
  p_max_attempts integer default 8
)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_ttl interval := make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 600), 3600)));
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 8), 50));
begin
  update public.notification_deliveries d
     set status = 'suppressed', claim_token = null, lease_until = null,
         updated_at = now(),
         last_error = case
           when not u.is_active then 'suppressed because recipient is inactive'
           else 'suppressed because notification expired'
         end
    from public.notifications n
    join public.users u on u.id = n.recipient_user_id
   where d.notification_id = n.id
     and (d.status = 'queued' or (d.status = 'sending' and d.lease_until < now()))
     and (not u.is_active or (n.expires_at is not null and n.expires_at <= now()));

  update public.notification_deliveries d
     set status = 'failed', claim_token = null, lease_until = null,
         updated_at = now(),
         last_error = coalesce(d.last_error, format('abandoned after %s attempts', d.attempts))
   where d.attempts >= v_max
     and (d.status = 'queued' or (d.status = 'sending' and d.lease_until < now()));

  return query
  with candidates as (
    select d.id
      from public.notification_deliveries d
      join public.notifications n on n.id = d.notification_id
      join public.users u on u.id = n.recipient_user_id
     where (d.status = 'queued' or (d.status = 'sending' and d.lease_until < now()))
       and d.next_attempt_at <= now()
       and d.attempts < v_max
       and u.is_active
       and (n.expires_at is null or n.expires_at > now())
     order by d.next_attempt_at, d.id
     limit v_limit
     for update skip locked
  )
  update public.notification_deliveries d
     set status = 'sending',
         claim_token = gen_random_uuid(),
         lease_until = now() + v_ttl,
         attempts = d.attempts + 1,
         updated_at = now()
    from candidates c
   where d.id = c.id
  returning d.*;
end;
$$;

create or replace function public.fn_notification_delivery_settle(
  p_id uuid,
  p_token uuid,
  p_ok boolean,
  p_error text default null,
  p_max_attempts integer default 8
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_row public.notification_deliveries%rowtype;
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 8), 50));
begin
  select * into v_row
    from public.notification_deliveries d
   where d.id = p_id
   for update;

  if not found or v_row.status <> 'sending' or v_row.claim_token is distinct from p_token then
    return false;
  end if;

  if p_ok then
    update public.notification_deliveries
       set status = 'sent', sent_at = now(), claim_token = null,
           lease_until = null, last_error = left(p_error, 500), updated_at = now()
     where id = p_id;
  elsif v_row.attempts >= v_max then
    update public.notification_deliveries
       set status = 'failed', claim_token = null, lease_until = null,
           last_error = left(coalesce(p_error, 'delivery failed'), 500), updated_at = now()
     where id = p_id;
  else
    update public.notification_deliveries
       set status = 'queued', claim_token = null, lease_until = null,
           next_attempt_at = now() + make_interval(mins => least(power(2, v_row.attempts)::integer, 240)),
           last_error = left(coalesce(p_error, 'delivery failed'), 500), updated_at = now()
     where id = p_id;
  end if;
  return true;
end;
$$;

revoke all on function public.fn_notification_actor() from public, anon, authenticated;
revoke all on function public.list_my_notifications(integer, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid[]) from public, anon, authenticated;
revoke all on function public.notification_badge() from public, anon, authenticated;
revoke all on function public.set_notification_preferences(boolean, text, integer) from public, anon, authenticated;
revoke all on function public.fn_notification_enqueue(uuid, text, text, text, text, text, text, jsonb, boolean, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_notification_delivery_claim(integer, integer, integer) from public, anon, authenticated;
revoke all on function public.fn_notification_delivery_settle(uuid, uuid, boolean, text, integer) from public, anon, authenticated;

grant execute on function public.list_my_notifications(integer, timestamptz) to authenticated;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.notification_badge() to authenticated;
grant execute on function public.set_notification_preferences(boolean, text, integer) to authenticated;
grant execute on function public.fn_notification_enqueue(uuid, text, text, text, text, text, text, jsonb, boolean, timestamptz, timestamptz) to service_role;
grant execute on function public.fn_notification_delivery_claim(integer, integer, integer) to service_role;
grant execute on function public.fn_notification_delivery_settle(uuid, uuid, boolean, text, integer) to service_role;

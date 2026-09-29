-- DOWN for true digest batching and durable expired in-app notifications.
-- Refuse to collapse a populated digest into the old one-message-per-row model.

set local lock_timeout = '5s';
set local statement_timeout = '10min';

do $$
begin
  if exists (select 1 from public.notification_deliveries where digest_batch_id is not null)
     or exists (select 1 from public.notification_digest_batches) then
    raise exception using
      errcode = '55000',
      message = 'DOWN refused: notification digest batches still contain delivery state';
  end if;
end;
$$;

drop function if exists public.fn_notification_email_settle(text, uuid, uuid, text, text, integer);
drop function if exists public.fn_notification_email_snapshot(text, uuid, uuid, integer);
drop function if exists public.fn_notification_email_claim(integer, integer);

drop function public.list_my_notifications(integer, timestamptz);
create function public.list_my_notifications(
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
  select n.id, n.kind, n.importance, n.title, n.body, n.href,
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

alter table public.notification_deliveries drop column digest_batch_id;
drop table public.notification_digest_batches;
drop function public.fn_notification_digest_window(timestamptz, integer);
comment on column public.notifications.expires_at is null;

revoke all on function public.list_my_notifications(integer, timestamptz) from public, anon, authenticated;
grant execute on function public.list_my_notifications(integer, timestamptz) to authenticated;
grant select on table public.notifications to service_role;
grant execute on function public.fn_notification_delivery_claim(integer, integer, integer) to service_role;
grant execute on function public.fn_notification_delivery_settle(uuid, uuid, boolean, text, integer) to service_role;

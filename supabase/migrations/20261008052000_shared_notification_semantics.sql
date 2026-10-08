-- Correct the shared notification semantics before first release:
--   * a digest is one leased SMTP envelope per recipient/window, not a set of
--     individually delayed messages;
--   * expires_at is an email cut-off, never an in-app retention cut-off.
-- DOWN: supabase/rollback/20261008052000_shared_notification_semantics_down.sql

set local lock_timeout = '5s';
set local statement_timeout = '10min';

-- The first checkpoint never reached a hosted database. Refuse to guess which
-- pre-existing rows were intended as digest members because the old schema did
-- not persist that fact. A release operator must drain/review such rows first.
do $$
begin
  if exists (select 1 from public.notification_deliveries) then
    raise exception using
      errcode = '55000',
      message = 'NTF_MIGRATION: notification deliveries must be empty before enabling true digest batching';
  end if;
end;
$$;

create table public.notification_digest_batches (
  id                 uuid primary key default gen_random_uuid(),
  recipient_user_id  uuid not null references public.users(id) on delete restrict,
  digest_window_at   timestamptz not null,
  -- 0 for the window's envelope; a successor minted when a retried frozen envelope became obsolete is 1, 2, …
  generation         integer not null default 0 check (generation >= 0),
  status             text not null default 'queued'
                     check (status in ('queued', 'sending', 'sent', 'failed', 'suppressed')),
  claim_token        uuid,
  lease_until        timestamptz,
  attempts           integer not null default 0 check (attempts >= 0),
  next_attempt_at    timestamptz not null,
  snapshot_at        timestamptz,
  sent_at            timestamptz,
  last_error         text check (last_error is null or char_length(last_error) <= 500),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (recipient_user_id, digest_window_at, generation),
  check ((status = 'sending') = (claim_token is not null and lease_until is not null))
);

alter table public.notification_digest_batches enable row level security;
revoke all on table public.notification_digest_batches from public, anon, authenticated, service_role;

create index notification_digest_batches_due_idx
  on public.notification_digest_batches (next_attempt_at, id)
  where status in ('queued', 'sending');

alter table public.notification_deliveries
  add column digest_batch_id uuid references public.notification_digest_batches(id) on delete cascade;

create index notification_deliveries_digest_batch_idx
  on public.notification_deliveries (digest_batch_id, notification_id)
  where digest_batch_id is not null;

comment on table public.notification_digest_batches is
  'One durable leased SMTP envelope per recipient and UTC digest window. Child delivery rows remain the per-notification audit trail.';
comment on column public.notifications.expires_at is
  'Email delivery cut-off. The durable in-app item remains visible and readable after this time.';

-- Use UTC explicitly; session TimeZone must not move a member's configured
-- digest hour. Strictly-after avoids attaching an event to a batch that may be
-- claimed at the exact boundary.
create or replace function public.fn_notification_digest_window(
  p_floor timestamptz,
  p_hour_utc integer
)
returns timestamptz
language plpgsql
volatile
set search_path to ''
as $$
declare
  v_clock timestamptz := clock_timestamp();
  v_floor timestamptz := greatest(coalesce(p_floor, v_clock), v_clock);
  v_window timestamptz;
begin
  if p_hour_utc is null or p_hour_utc not between 0 and 23 then
    raise exception using errcode = '22023', message = 'NTF_INPUT: digest hour must be 0..23 UTC';
  end if;
  v_window := (date_trunc('day', v_floor at time zone 'UTC')
               + make_interval(hours => p_hour_utc)) at time zone 'UTC';
  if v_window <= v_floor then v_window := v_window + interval '1 day'; end if;
  return v_window;
end;
$$;

-- The return row gains authoritative server-clock expiry state. Dropping and
-- recreating is required because PostgreSQL cannot replace an OUT row shape.
drop function public.list_my_notifications(integer, timestamptz);
-- C2O-092 P2: a composite (created_at, id) cursor, so rows sharing one timestamp are never skipped between pages
create function public.list_my_notifications(
  p_limit integer default 30,
  p_before timestamptz default null,
  p_before_id uuid default null
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
  is_expired boolean,
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
         n.read_at, n.expires_at,
         (n.expires_at is not null and n.expires_at <= now()) as is_expired,
         n.created_at
    from public.notifications n
   where n.recipient_user_id = v_actor
     and n.in_app_visible
     and (p_before is null or n.created_at < p_before
          or (p_before_id is not null and n.created_at = p_before and n.id < p_before_id))
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
     and n.read_at is null;
$$;

-- Same public signature as checkpoint 1. The durable notification is inserted
-- even when already expired. Only the email audit item is suppressed.
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
  v_batch uuid;
  v_last_error text;
  v_digest_attempts integer := 0;
begin
  if p_recipient_user_id is null or not exists (
    select 1 from public.users u where u.id = p_recipient_user_id and u.is_active
  ) then
    raise exception using errcode = '22023', message = 'NTF_RECIPIENT: active recipient required';
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

  -- A replay returns the original immutable snapshot and delivery decision.
  if exists (select 1 from public.notification_deliveries d where d.notification_id = v_id) then
    return v_id;
  end if;

  if not coalesce(p_request_email, true) or v_pref.email_mode = 'off' then
    v_status := 'suppressed';
    v_next := greatest(clock_timestamp(), coalesce(p_not_before, clock_timestamp()));
    v_last_error := 'suppressed by member preference or projector';
  elsif p_expires_at is not null and p_expires_at <= clock_timestamp() then
    v_status := 'suppressed';
    v_next := clock_timestamp();
    v_last_error := 'suppressed because notification expired';
  elsif p_importance = 'urgent' or v_pref.email_mode = 'instant' then
    v_status := 'queued';
    v_next := greatest(clock_timestamp(), coalesce(p_not_before, clock_timestamp()));
  else
    -- Serialize membership changes with the dispatcher claim. Re-evaluate the
    -- wall clock only after taking the lock so a transaction that began before
    -- a digest boundary cannot join an envelope that is already in flight.
    perform pg_catalog.pg_advisory_xact_lock(1095978574);
    v_digest := public.fn_notification_digest_window(
      greatest(clock_timestamp(), coalesce(p_not_before, clock_timestamp())),
      v_pref.digest_hour_utc
    );
    loop
      if p_expires_at is not null and p_expires_at <= v_digest then
        v_status := 'suppressed';
        v_next := v_digest;
        v_last_error := 'suppressed because notification expires before digest window';
        exit;
      end if;

      v_batch := null;
      insert into public.notification_digest_batches as b
        (recipient_user_id, digest_window_at, generation, status, next_attempt_at)
      values
        (p_recipient_user_id, v_digest, 0, 'queued', v_digest)
      on conflict (recipient_user_id, digest_window_at, generation) do update
        set updated_at = clock_timestamp()
        where b.status = 'queued'
          and b.claim_token is null
          and b.snapshot_at is null
      returning b.id into v_batch;

      if v_batch is not null then
        v_status := 'queued';
        v_next := v_digest;
        exit;
      end if;

      -- A closed envelope owns this recipient/window forever. Select the next
      -- daily window rather than mutating or appending to its frozen contents.
      v_digest := v_digest + interval '1 day';
      v_digest_attempts := v_digest_attempts + 1;
      if v_digest_attempts > 366 then
        raise exception using errcode = '55000', message = 'NTF_STATE: no open digest window available';
      end if;
    end loop;
  end if;

  insert into public.notification_deliveries
    (notification_id, channel, status, next_attempt_at, last_error, digest_batch_id)
  values
    (v_id, 'email', v_status, v_next, v_last_error, v_batch)
  on conflict (notification_id, channel) do nothing;

  return v_id;
end;
$$;

-- One short global scheduler lock makes choosing the oldest row across the two
-- job tables atomic. It is held only for this transaction, never during SMTP.
create or replace function public.fn_notification_email_claim(
  p_ttl_seconds integer default 600,
  p_max_attempts integer default 8
)
returns table (
  job_kind text,
  id uuid,
  claim_token uuid,
  attempts integer,
  recipient_user_id uuid
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_ttl interval := make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 600), 3600)));
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 8), 50));
  v_kind text;
  v_id uuid;
  v_now timestamptz;
  r_old record;
  v_successor uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(1095978574);
  -- the clock is read AFTER the lock (C2O-092 #5): a claimant that waited behind another never receives a lease
  -- that is already expired, and every comparison below uses this one instant
  v_now := clock_timestamp();

  -- C2O-092 #2: a frozen digest envelope whose retry would carry an item that expired since its snapshot is obsolete.
  -- Its expired items are suppressed, the still-valid ones move to a successor envelope (a new id, so a new
  -- Message-ID) in the same window, and the obsolete envelope is closed as superseded — never re-sent.
  for r_old in
    select b.id, b.recipient_user_id, b.digest_window_at
      from public.notification_digest_batches b
     where b.snapshot_at is not null
       and (b.status = 'queued' or (b.status = 'sending' and b.lease_until < v_now))
       and exists (
         select 1 from public.notification_deliveries d
           join public.notifications n on n.id = d.notification_id
          where d.digest_batch_id = b.id and d.status = 'queued'
            and n.expires_at is not null and n.expires_at <= v_now)
  loop
    update public.notification_deliveries d
       set status = 'suppressed', updated_at = v_now, last_error = 'suppressed because notification expired before a retry'
      from public.notifications n
     where d.notification_id = n.id and d.digest_batch_id = r_old.id and d.status = 'queued'
       and n.expires_at is not null and n.expires_at <= v_now;
    v_successor := null;
    if exists (select 1 from public.notification_deliveries d where d.digest_batch_id = r_old.id and d.status = 'queued') then
      insert into public.notification_digest_batches as nb (recipient_user_id, digest_window_at, generation, status, next_attempt_at)
      values (r_old.recipient_user_id, r_old.digest_window_at,
              (select max(g.generation) + 1 from public.notification_digest_batches g
                where g.recipient_user_id = r_old.recipient_user_id and g.digest_window_at = r_old.digest_window_at),
              'queued', v_now)
      returning nb.id into v_successor;
      update public.notification_deliveries d set digest_batch_id = v_successor, updated_at = v_now
       where d.digest_batch_id = r_old.id and d.status = 'queued';
    end if;
    update public.notification_digest_batches ob
       set status = 'suppressed', claim_token = null, lease_until = null, updated_at = v_now,
           last_error = case when v_successor is null then 'superseded: every item expired before a retry'
                             else 'superseded by ' || v_successor::text || ': an item expired before a retry' end
     where ob.id = r_old.id;
  end loop;

  -- C2O-092 #7: a member who turned email off gets no further email, including work already queued
  update public.notification_deliveries d
     set status = 'suppressed', claim_token = null, lease_until = null, updated_at = v_now,
         last_error = 'suppressed because the member turned email off'
    from public.notifications n
    join public.notification_preferences pr on pr.user_id = n.recipient_user_id and pr.email_mode = 'off'
   where d.notification_id = n.id
     and (d.status = 'queued' or (d.status = 'sending' and d.lease_until < v_now));
  update public.notification_digest_batches b
     set status = 'suppressed', claim_token = null, lease_until = null, updated_at = v_now,
         last_error = 'suppressed because the member turned email off'
    from public.notification_preferences pr
   where pr.user_id = b.recipient_user_id and pr.email_mode = 'off'
     and (b.status = 'queued' or (b.status = 'sending' and b.lease_until < v_now));

  -- Expiry and account state suppress email only. The notification row remains
  -- in the member feed and continues through the ordinary read-state RPCs.
  update public.notification_deliveries d
     set status = 'suppressed', claim_token = null, lease_until = null,
         updated_at = v_now,
         last_error = case
           when not u.is_active then 'suppressed because recipient is inactive'
           else 'suppressed because notification expired'
         end
    from public.notifications n
    join public.users u on u.id = n.recipient_user_id
   where d.notification_id = n.id
     and (d.status = 'queued' or (d.status = 'sending' and d.lease_until < v_now))
     and (
       not u.is_active
       or (
         n.expires_at is not null
         and n.expires_at <= coalesce(
           (select b.snapshot_at
              from public.notification_digest_batches b
             where b.id = d.digest_batch_id),
           v_now
         )
       )
     );

  update public.notification_deliveries d
     set status = 'failed', claim_token = null, lease_until = null,
         updated_at = v_now,
         last_error = coalesce(d.last_error, format('abandoned after %s attempts', d.attempts))
   where d.digest_batch_id is null
     and d.attempts >= v_max
     and (d.status = 'queued' or (d.status = 'sending' and d.lease_until < v_now));

  update public.notification_digest_batches b
     set status = 'suppressed', claim_token = null, lease_until = null,
         updated_at = v_now, last_error = 'suppressed because recipient is inactive'
    from public.users u
   where u.id = b.recipient_user_id
     and not u.is_active
     and (b.status = 'queued' or (b.status = 'sending' and b.lease_until < v_now));

  update public.notification_digest_batches b
     set status = 'failed', claim_token = null, lease_until = null,
         updated_at = v_now,
         last_error = coalesce(b.last_error, format('abandoned after %s attempts', b.attempts))
   where b.attempts >= v_max
     and (b.status = 'queued' or (b.status = 'sending' and b.lease_until < v_now));

  update public.notification_deliveries d
     set status = case when b.status = 'failed' then 'failed' else 'suppressed' end,
         claim_token = null, lease_until = null, updated_at = v_now,
         last_error = coalesce(d.last_error, b.last_error)
    from public.notification_digest_batches b
   where d.digest_batch_id = b.id
     and d.status = 'queued'
     and b.status in ('failed', 'suppressed');

  -- A batch can become empty when every child expires before its window.
  update public.notification_digest_batches b
     set status = 'suppressed', claim_token = null, lease_until = null,
         updated_at = v_now, last_error = 'suppressed because no deliverable digest items remain'
   where (b.status = 'queued' or (b.status = 'sending' and b.lease_until < v_now))
     and not exists (
       select 1
         from public.notification_deliveries d
         join public.notifications n on n.id = d.notification_id
         join public.users u on u.id = n.recipient_user_id
        where d.digest_batch_id = b.id
          and d.status = 'queued'
           and u.is_active
           and (n.expires_at is null or n.expires_at > coalesce(b.snapshot_at, v_now))
     );

  select q.job_kind, q.id
    into v_kind, v_id
    from (
      select 'instant'::text as job_kind, d.id, d.next_attempt_at,
             -- urgent first; everything else (normal instant and digests alike) stays oldest-first
             case when n.importance = 'urgent' then 0 else 1 end as priority
        from public.notification_deliveries d
        join public.notifications n on n.id = d.notification_id
        join public.users u on u.id = n.recipient_user_id
       where d.digest_batch_id is null
         and (d.status = 'queued' or (d.status = 'sending' and d.lease_until < v_now))
         and d.next_attempt_at <= v_now
         and d.attempts < v_max
          and u.is_active
          and (n.expires_at is null or n.expires_at > v_now)
      union all
      select 'digest'::text, b.id, b.next_attempt_at, 1
        from public.notification_digest_batches b
        join public.users u on u.id = b.recipient_user_id
       where (b.status = 'queued' or (b.status = 'sending' and b.lease_until < v_now))
         and b.next_attempt_at <= v_now
         and b.attempts < v_max
         and u.is_active
         and exists (
           select 1
             from public.notification_deliveries d
             join public.notifications n on n.id = d.notification_id
            where d.digest_batch_id = b.id and d.status = 'queued'
               and (n.expires_at is null or n.expires_at > coalesce(b.snapshot_at, v_now))
         )
    ) q
   -- C2O-092 #6: an urgent instant item is never starved behind a digest or a normal backlog
   order by q.priority, q.next_attempt_at, q.job_kind, q.id
   limit 1;

  if v_id is null then return; end if;

  if v_kind = 'instant' then
    return query
    update public.notification_deliveries d
       set status = 'sending', claim_token = gen_random_uuid(),
           lease_until = v_now + v_ttl, attempts = d.attempts + 1,
           updated_at = v_now
      from public.notifications n
     where d.id = v_id and n.id = d.notification_id
       and (d.status = 'queued' or (d.status = 'sending' and d.lease_until < v_now))
       and d.next_attempt_at <= v_now
    returning 'instant'::text, d.id, d.claim_token, d.attempts, n.recipient_user_id;
  else
    return query
    update public.notification_digest_batches b
       set status = 'sending', claim_token = gen_random_uuid(),
            lease_until = v_now + v_ttl, attempts = b.attempts + 1,
            snapshot_at = coalesce(b.snapshot_at, v_now),
            updated_at = v_now
     where b.id = v_id
       and (b.status = 'queued' or (b.status = 'sending' and b.lease_until < v_now))
       and b.next_attempt_at <= v_now
    returning 'digest'::text, b.id, b.claim_token, b.attempts, b.recipient_user_id;
  end if;
end;
$$;

create or replace function public.fn_notification_email_snapshot(
  p_job_kind text,
  p_id uuid,
  p_token uuid,
  p_item_limit integer default 25
)
returns table (
  recipient_user_id uuid,
  id uuid,
  importance text,
  title text,
  body text,
  href text,
  created_at timestamptz,
  total_count integer
)
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_item_limit, 25), 50));
begin
  if p_job_kind = 'instant' then
    return query
    select n.recipient_user_id, n.id, n.importance, n.title, n.body, n.href,
           n.created_at, 1
      from public.notification_deliveries d
      join public.notifications n on n.id = d.notification_id
      join public.users u on u.id = n.recipient_user_id
     where d.id = p_id and d.status = 'sending' and d.claim_token = p_token
       and u.is_active and (n.expires_at is null or n.expires_at > now())
       -- C2O-097 #2: the CURRENT preference decides at the last moment before sending; email off sends nothing
       and not exists (select 1 from public.notification_preferences pf where pf.user_id = n.recipient_user_id and pf.email_mode = 'off');
  elsif p_job_kind = 'digest' then
    update public.notification_digest_batches b
       set snapshot_at = coalesce(b.snapshot_at, now()), updated_at = now()
     where b.id = p_id and b.status = 'sending' and b.claim_token = p_token;
    if not found then return; end if;
    return query
    select x.recipient_user_id, x.id, x.importance, x.title, x.body, x.href,
           x.created_at, x.total_count
      from (
        select n.recipient_user_id, n.id, n.importance, n.title, n.body, n.href,
               n.created_at, count(*) over ()::integer as total_count
          from public.notification_digest_batches b
          join public.notification_deliveries d on d.digest_batch_id = b.id
          join public.notifications n on n.id = d.notification_id
          join public.users u on u.id = n.recipient_user_id
         where b.id = p_id and b.status = 'sending' and b.claim_token = p_token
            and d.status = 'queued' and u.is_active
            and not exists (select 1 from public.notification_preferences pf where pf.user_id = n.recipient_user_id and pf.email_mode = 'off')
            and d.created_at <= b.snapshot_at
            and (n.expires_at is null or n.expires_at > b.snapshot_at)
         order by n.created_at, n.id
         limit v_limit
      ) x;
  else
    raise exception using errcode = '22023', message = 'NTF_INPUT: invalid email job kind';
  end if;
end;
$$;

create or replace function public.fn_notification_email_settle(
  p_job_kind text,
  p_id uuid,
  p_token uuid,
  p_outcome text,
  p_error text default null,
  p_max_attempts integer default 8
)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_delivery public.notification_deliveries%rowtype;
  v_batch public.notification_digest_batches%rowtype;
  v_max integer := greatest(1, least(coalesce(p_max_attempts, 8), 50));
begin
  if p_outcome not in ('sent', 'failed', 'suppressed') then
    raise exception using errcode = '22023', message = 'NTF_INPUT: invalid email settlement outcome';
  end if;

  if p_job_kind = 'instant' then
    select * into v_delivery from public.notification_deliveries d
     where d.id = p_id for update;
    if not found or v_delivery.status <> 'sending' or v_delivery.claim_token is distinct from p_token then
      return false;
    end if;
    if p_outcome = 'sent' then
      update public.notification_deliveries set status = 'sent', sent_at = now(),
        claim_token = null, lease_until = null, last_error = null, updated_at = now() where id = p_id;
    elsif p_outcome = 'suppressed' then
      update public.notification_deliveries set status = 'suppressed', claim_token = null,
        lease_until = null, last_error = left(coalesce(p_error, 'delivery suppressed'), 500),
        updated_at = now() where id = p_id;
    elsif v_delivery.attempts >= v_max then
      update public.notification_deliveries set status = 'failed', claim_token = null,
        lease_until = null, last_error = left(coalesce(p_error, 'delivery failed'), 500),
        updated_at = now() where id = p_id;
    else
      update public.notification_deliveries set status = 'queued', claim_token = null,
        lease_until = null,
        next_attempt_at = now() + make_interval(mins => least(power(2, least(v_delivery.attempts, 8))::integer, 240)),
        last_error = left(coalesce(p_error, 'delivery failed'), 500), updated_at = now()
       where id = p_id;
    end if;
    return true;
  elsif p_job_kind = 'digest' then
    select * into v_batch from public.notification_digest_batches b
     where b.id = p_id for update;
    if not found or v_batch.status <> 'sending' or v_batch.claim_token is distinct from p_token then
      return false;
    end if;
    if p_outcome = 'sent' and v_batch.snapshot_at is null then
      return false;
    end if;
    if p_outcome = 'sent' then
      update public.notification_digest_batches set status = 'sent', sent_at = now(),
        claim_token = null, lease_until = null, last_error = null, updated_at = now() where id = p_id;
      update public.notification_deliveries d
         set status = case when n.expires_at is not null and n.expires_at <= v_batch.snapshot_at then 'suppressed' else 'sent' end,
             sent_at = case when n.expires_at is null or n.expires_at > v_batch.snapshot_at then now() else null end,
             last_error = case when n.expires_at is not null and n.expires_at <= v_batch.snapshot_at
                               then 'suppressed because notification expired' else null end,
             updated_at = now()
        from public.notifications n
       where d.digest_batch_id = p_id and d.notification_id = n.id
         and d.status = 'queued' and d.created_at <= v_batch.snapshot_at;
    elsif p_outcome = 'suppressed' then
      update public.notification_digest_batches set status = 'suppressed', claim_token = null,
        lease_until = null, last_error = left(coalesce(p_error, 'digest suppressed'), 500),
        updated_at = now() where id = p_id;
      update public.notification_deliveries set status = 'suppressed',
        last_error = left(coalesce(p_error, 'digest suppressed'), 500), updated_at = now()
       where digest_batch_id = p_id and status = 'queued';
    elsif v_batch.attempts >= v_max then
      update public.notification_digest_batches set status = 'failed', claim_token = null,
        lease_until = null, last_error = left(coalesce(p_error, 'digest delivery failed'), 500),
        updated_at = now() where id = p_id;
      update public.notification_deliveries set status = 'failed',
        last_error = left(coalesce(p_error, 'digest delivery failed'), 500), updated_at = now()
       where digest_batch_id = p_id and status = 'queued';
    else
      update public.notification_digest_batches set status = 'queued', claim_token = null,
        lease_until = null,
        next_attempt_at = now() + make_interval(mins => least(power(2, least(v_batch.attempts, 8))::integer, 240)),
        last_error = left(coalesce(p_error, 'digest delivery failed'), 500), updated_at = now()
       where id = p_id;
    end if;
    return true;
  end if;

  raise exception using errcode = '22023', message = 'NTF_INPUT: invalid email job kind';
end;
$$;

-- The dispatcher now reads snapshots and changes state only through the leased
-- envelope RPCs. Retire the old per-row service claim surface.
revoke select on table public.notifications from service_role;
revoke all on function public.fn_notification_delivery_claim(integer, integer, integer) from service_role;
revoke all on function public.fn_notification_delivery_settle(uuid, uuid, boolean, text, integer) from service_role;

-- C2O-097 #2: an opt-out serializes with the scheduler. The setter takes the same advisory lock as enqueue and claim,
-- so a claim either finishes before it (its job is already 'sending') or sees the new preference. Turning email off
-- suppresses, in the same transaction, every email of this member still waiting (instant deliveries and digest
-- envelopes); the snapshot taken just before sending re-checks the preference as well. Only an email already being
-- sent at that instant can still arrive — the settings card says so.
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
  perform pg_catalog.pg_advisory_xact_lock(1095978574);

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

  if p_email_mode = 'off' then
    update public.notification_deliveries d
       set status = 'suppressed', claim_token = null, lease_until = null, updated_at = clock_timestamp(),
           last_error = 'suppressed because the member turned email off'
      from public.notifications n
     where n.id = d.notification_id and n.recipient_user_id = v_actor and d.status = 'queued';
    update public.notification_digest_batches b
       set status = 'suppressed', claim_token = null, lease_until = null, updated_at = clock_timestamp(),
           last_error = 'suppressed because the member turned email off'
     where b.recipient_user_id = v_actor and b.status = 'queued';
  end if;

  return to_jsonb(v_row);
end;
$$;

-- C2O-092 P2: a digest child always belongs to its envelope's recipient, enforced by the schema, not only the code
create or replace function public.fn_notification_digest_recipient_guard()
 returns trigger language plpgsql security definer set search_path to ''
as $$
begin
  if new.digest_batch_id is not null and not exists (
       select 1 from public.notification_digest_batches b join public.notifications n on n.id = new.notification_id
        where b.id = new.digest_batch_id and b.recipient_user_id = n.recipient_user_id) then
    raise exception using errcode = '23514', message = 'NTF_DIGEST_RECIPIENT: a digest item must belong to its envelope''s recipient';
  end if;
  return new;
end $$;
revoke all on function public.fn_notification_digest_recipient_guard() from public, anon, authenticated;
drop trigger if exists notification_deliveries_digest_recipient on public.notification_deliveries;
create trigger notification_deliveries_digest_recipient
  before insert or update of digest_batch_id, notification_id on public.notification_deliveries
  for each row when (new.digest_batch_id is not null)
  execute function public.fn_notification_digest_recipient_guard();

revoke all on function public.list_my_notifications(integer, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.fn_notification_digest_window(timestamptz, integer) from public, anon, authenticated, service_role;
revoke all on function public.fn_notification_email_claim(integer, integer) from public, anon, authenticated;
revoke all on function public.fn_notification_email_snapshot(text, uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.fn_notification_email_settle(text, uuid, uuid, text, text, integer) from public, anon, authenticated;

grant execute on function public.list_my_notifications(integer, timestamptz, uuid) to authenticated;
grant execute on function public.fn_notification_email_claim(integer, integer) to service_role;
grant execute on function public.fn_notification_email_snapshot(text, uuid, uuid, integer) to service_role;
grant execute on function public.fn_notification_email_settle(text, uuid, uuid, text, text, integer) to service_role;

-- C2O-092 #7: what the member's delivery settings are now, and whether they are still the platform defaults
-- (in-app on; email as a daily digest at 07:00 UTC; urgent items — invitations, offers with a deadline, fix
-- confirmations, recaps — email at once unless email is off). Written only through set_notification_preferences.
create or replace function public.get_my_notification_preferences()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare v_actor uuid := public.fn_notification_actor(); v_row public.notification_preferences%rowtype;
begin
  select * into v_row from public.notification_preferences p where p.user_id = v_actor;
  return jsonb_build_object(
    'inAppEnabled', coalesce(v_row.in_app_enabled, true),
    'emailMode', coalesce(v_row.email_mode, 'digest'),
    'digestHourUtc', coalesce(v_row.digest_hour_utc, 7),
    'isDefault', v_row.user_id is null,
    'updatedAt', v_row.updated_at,
    'defaults', jsonb_build_object('inAppEnabled', true, 'emailMode', 'digest', 'digestHourUtc', 7),
    'urgentEmailsAtOnce', coalesce(v_row.email_mode, 'digest') <> 'off');
end;
$$;
revoke all on function public.get_my_notification_preferences() from public, anon;
grant execute on function public.get_my_notification_preferences() to authenticated;


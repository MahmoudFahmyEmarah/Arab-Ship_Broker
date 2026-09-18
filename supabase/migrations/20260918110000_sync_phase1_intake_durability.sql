-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · phase 1 — durable intake (18 Sep 2026)
--
-- EMAIL. The checkpoint was one timestamp: the newest page was taken and the
-- clock jumped to the run's start, so a backlog larger than one page lost its
-- older mail for good, and two runs (hourly cron + an admin on the card) could
-- overlap. Now:
--   sync_source_state.uid_validity / last_uid   IMAP checkpoint: every
--       message with a UID above last_uid in the same UIDVALIDITY epoch is
--       still to be read. Oldest first, page by page.
--   sync_source_state.lease_owner / lease_until  one run at a time per
--       source. claim_sync_run() takes the lease atomically (row lock);
--       a live lease held by someone else is refused, an expired one is
--       taken over. release_sync_run() frees it; set_email_checkpoint()
--       moves the checkpoint only for the lease holder and only forward.
--
-- WHATSAPP. Workers selected pending rows without claiming them, so the
-- webhook's after() kick, the admin sweep and the local worker could stage
-- and acknowledge the same message twice. Now:
--   whatsapp_message.status gains 'processing'; lease_token / lease_until /
--       attempts record who holds a message and for how long.
--   claim_whatsapp_messages()  FOR UPDATE SKIP LOCKED claim of the oldest
--       pending rows (plus expired leases, plus failed rows on request);
--       every claimed row gets a fresh token. Workers write results only
--       where the token still matches. A message that has been claimed
--       p_max_attempts times without a result is parked as failed.
-- Idempotent. Service-role only.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · email checkpoint + lease ────────────────────────────────────────────
alter table public.sync_source_state
  add column if not exists uid_validity bigint,
  add column if not exists last_uid     bigint,
  add column if not exists lease_owner  text,
  add column if not exists lease_until  timestamptz;

comment on column public.sync_source_state.uid_validity is 'IMAP UIDVALIDITY of the folder the checkpoint belongs to; a different value resets last_uid.';
comment on column public.sync_source_state.last_uid     is 'Highest IMAP UID whose message has been staged. The next run reads last_uid+1:*.';
comment on column public.sync_source_state.lease_owner  is 'Who holds the run lease (cron, admin:<name>, …). One run per source at a time.';
comment on column public.sync_source_state.lease_until  is 'When the lease expires on its own if the holder never releases it.';

create or replace function public.claim_sync_run(p_source text, p_owner text, p_ttl_seconds integer default 900)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare
  r public.sync_source_state%rowtype;
  v_until timestamptz := now() + make_interval(secs => greatest(30, least(p_ttl_seconds, 3600)));
begin
  if p_source is null or p_owner is null or btrim(p_owner) = '' then
    raise exception 'claim_sync_run: source and owner are required' using errcode = '22023';
  end if;
  select * into r from public.sync_source_state where source = p_source for update;
  if not found then
    -- first run of a source: the row is created with the lease and no checkpoint
    insert into public.sync_source_state (source, last_sync_at, updated_at, lease_owner, lease_until)
    values (p_source, null, now(), p_owner, v_until);
    return jsonb_build_object('claimed', true, 'lease_owner', p_owner, 'lease_until', v_until);
  end if;
  if r.lease_until is not null and r.lease_until > now() and r.lease_owner is distinct from p_owner then
    return jsonb_build_object('claimed', false, 'lease_owner', r.lease_owner, 'lease_until', r.lease_until);
  end if;
  update public.sync_source_state
     set lease_owner = p_owner, lease_until = v_until, updated_at = now()
   where source = p_source;
  return jsonb_build_object('claimed', true, 'lease_owner', p_owner, 'lease_until', v_until);
end $$;

create or replace function public.release_sync_run(p_source text, p_owner text)
 returns boolean language sql volatile security definer set search_path to ''
as $$
  with u as (
    update public.sync_source_state
       set lease_owner = null, lease_until = null, updated_at = now()
     where source = p_source and lease_owner = p_owner
    returning 1
  ) select exists (select 1 from u);
$$;

-- Moves the email checkpoint. Only the current lease holder may; last_uid
-- only ever grows within one UIDVALIDITY epoch and resets when the epoch
-- changes; last_sync_at never goes backwards. Returns false when the caller
-- no longer holds the lease (expired mid-run) — the caller must say so.
create or replace function public.set_email_checkpoint(
  p_owner text, p_uid_validity bigint, p_last_uid bigint, p_last_sync_at timestamptz
) returns boolean language sql volatile security definer set search_path to ''
as $$
  with u as (
    update public.sync_source_state s
       set uid_validity = coalesce(p_uid_validity, s.uid_validity),
           last_uid     = case
                            when p_last_uid is null then s.last_uid
                            when p_uid_validity is not null and s.uid_validity is distinct from p_uid_validity then p_last_uid
                            else greatest(coalesce(s.last_uid, 0), p_last_uid)
                          end,
           last_sync_at = greatest(coalesce(s.last_sync_at, p_last_sync_at), coalesce(p_last_sync_at, s.last_sync_at)),
           updated_at   = now()
     where s.source = 'email' and s.lease_owner = p_owner and s.lease_until > now()
    returning 1
  ) select exists (select 1 from u);
$$;

revoke all on function public.claim_sync_run(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_sync_run(text, text) from public, anon, authenticated;
revoke all on function public.set_email_checkpoint(text, bigint, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_sync_run(text, text, integer) to service_role;
grant execute on function public.release_sync_run(text, text) to service_role;
grant execute on function public.set_email_checkpoint(text, bigint, bigint, timestamptz) to service_role;

-- ── 2 · WhatsApp claims ─────────────────────────────────────────────────────
alter table public.whatsapp_message
  add column if not exists lease_token uuid,
  add column if not exists lease_until timestamptz,
  add column if not exists attempts    integer not null default 0;

alter table public.whatsapp_message drop constraint if exists whatsapp_message_status_check;
alter table public.whatsapp_message add constraint whatsapp_message_status_check
  check (status in ('pending', 'processing', 'staged', 'irrelevant', 'failed'));

create index if not exists idx_wa_msg_claimable
  on public.whatsapp_message (received_at)
  where status in ('pending', 'processing', 'failed');

comment on column public.whatsapp_message.lease_token is 'Set when a worker claims the message; every result write is guarded by it.';
comment on column public.whatsapp_message.attempts    is 'How many times the message has been claimed. Parked as failed after the limit.';

create or replace function public.claim_whatsapp_messages(
  p_owner text, p_limit integer default 25, p_ttl_seconds integer default 120,
  p_include_failed boolean default false, p_max_attempts integer default 5
) returns setof public.whatsapp_message
 language plpgsql volatile security definer set search_path to ''
as $$
declare
  v_ttl interval := make_interval(secs => greatest(15, least(p_ttl_seconds, 3600)));
  v_lim integer  := greatest(1, least(coalesce(p_limit, 25), 100));
begin
  -- a message claimed p_max_attempts times with no result is a poison
  -- message: park it so it stops eating every sweep
  update public.whatsapp_message
     set status = 'failed',
         error = left(coalesce(error, 'no result') || ' · gave up after ' || attempts || ' attempts', 500),
         lease_token = null, lease_until = null
   where status = 'processing' and lease_until < now() and attempts >= p_max_attempts;

  return query
  with c as (
    select m.id
      from public.whatsapp_message m
     where (m.status = 'pending'
         or (m.status = 'processing' and m.lease_until < now())
         or (p_include_failed and m.status = 'failed'))
       and (m.attempts < p_max_attempts or p_include_failed)
     order by m.received_at, m.id
     limit v_lim
       for update skip locked
  )
  update public.whatsapp_message m
     set status = 'processing',
         lease_token = gen_random_uuid(),
         lease_until = now() + v_ttl,
         attempts = m.attempts + 1,
         error = null
    from c
   where m.id = c.id
  returning m.*;
end $$;

-- Hands unprocessed claims back (a worker that ran out of time). Only rows
-- still holding one of the caller's tokens move.
create or replace function public.release_whatsapp_messages(p_tokens uuid[])
 returns integer language sql volatile security definer set search_path to ''
as $$
  with u as (
    update public.whatsapp_message
       set status = 'pending', lease_token = null, lease_until = null
     where status = 'processing' and lease_token = any (p_tokens)
    returning 1
  ) select count(*)::integer from u;
$$;

revoke all on function public.claim_whatsapp_messages(text, integer, integer, boolean, integer) from public, anon, authenticated;
revoke all on function public.release_whatsapp_messages(uuid[]) from public, anon, authenticated;
grant execute on function public.claim_whatsapp_messages(text, integer, integer, boolean, integer) to service_role;
grant execute on function public.release_whatsapp_messages(uuid[]) to service_role;

-- ════════════════════════════════════════════════════════════════════════
-- Data Sync hardening · lease v2 — an opaque token per run (20 Sep 2026)
--
-- Defect: claim_sync_run accepted a live lease again when p_owner matched.
-- Every scheduled run says owner = 'cron', so two overlapping cron calls
-- both claimed, both fetched, and both moved the checkpoint.
--
-- Now the lease is a UUID token minted by claim_sync_run_v2. Any unexpired
-- lease refuses every new claim, whatever the label; the checkpoint moves
-- and the lease is released only with the exact token. The label
-- (owner_label) is informational. The v1 functions stay for the currently
-- deployed application, guarded so they cannot touch a v2 lease:
--   claim_sync_run        refuses any unexpired lease that carries a token
--   release_sync_run      releases only token-less (v1) leases
--   set_email_checkpoint  moves the checkpoint only under a token-less lease
-- Deploy the database first; the new application calls the v2 names.
-- Idempotent. Service-role only. DOWN: supabase/rollback/20260920_sync_lease_v2_down.sql
-- ════════════════════════════════════════════════════════════════════════

alter table public.sync_source_state add column if not exists lease_token uuid;
comment on column public.sync_source_state.lease_token is 'Opaque token of the run that holds the lease (claim_sync_run_v2). The checkpoint moves and the lease is released only with this exact token.';

-- ── 1 · v2: token-based lease ───────────────────────────────────────────────
create or replace function public.claim_sync_run_v2(p_source text, p_owner_label text default null, p_ttl_seconds integer default 900)
 returns jsonb language plpgsql volatile security definer set search_path to ''
as $$
declare
  r       public.sync_source_state%rowtype;
  v_token uuid := gen_random_uuid();
  v_until timestamptz := now() + make_interval(secs => greatest(30, least(coalesce(p_ttl_seconds, 900), 3600)));
begin
  if p_source is null or btrim(p_source) = '' then
    raise exception 'claim_sync_run_v2: source is required' using errcode = '22023';
  end if;
  select * into r from public.sync_source_state where source = p_source for update;
  if not found then
    insert into public.sync_source_state (source, last_sync_at, updated_at, lease_owner, lease_until, lease_token)
    values (p_source, null, now(), p_owner_label, v_until, v_token);
    return jsonb_build_object('claimed', true, 'lease_token', v_token, 'lease_owner', p_owner_label, 'lease_until', v_until);
  end if;
  -- any unexpired lease refuses every new claim — the label is not an identity
  if r.lease_until is not null and r.lease_until > now() then
    return jsonb_build_object('claimed', false, 'lease_token', null, 'lease_owner', r.lease_owner, 'lease_until', r.lease_until);
  end if;
  update public.sync_source_state
     set lease_owner = p_owner_label, lease_until = v_until, lease_token = v_token, updated_at = now()
   where source = p_source;
  return jsonb_build_object('claimed', true, 'lease_token', v_token, 'lease_owner', p_owner_label, 'lease_until', v_until);
end $$;

create or replace function public.release_sync_run_v2(p_source text, p_token uuid)
 returns boolean language sql volatile security definer set search_path to ''
as $$
  with u as (
    update public.sync_source_state
       set lease_owner = null, lease_until = null, lease_token = null, updated_at = now()
     where source = p_source and p_token is not null and lease_token = p_token
    returning 1
  ) select exists (select 1 from u);
$$;

-- Moves the email checkpoint for the exact token, while its lease is live.
-- Same forward-only rules as v1: last_uid only grows within one UIDVALIDITY
-- epoch and resets when the epoch changes; last_sync_at never goes backwards.
create or replace function public.set_email_checkpoint_v2(
  p_token uuid, p_uid_validity bigint, p_last_uid bigint, p_last_sync_at timestamptz
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
     where s.source = 'email' and p_token is not null and s.lease_token = p_token and s.lease_until > now()
    returning 1
  ) select exists (select 1 from u);
$$;

revoke all on function public.claim_sync_run_v2(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_sync_run_v2(text, uuid) from public, anon, authenticated;
revoke all on function public.set_email_checkpoint_v2(uuid, bigint, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_sync_run_v2(text, text, integer) to service_role;
grant execute on function public.release_sync_run_v2(text, uuid) to service_role;
grant execute on function public.set_email_checkpoint_v2(uuid, bigint, bigint, timestamptz) to service_role;

-- ── 2 · v1 stays for the deployed application, but cannot touch a v2 lease ─
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
    insert into public.sync_source_state (source, last_sync_at, updated_at, lease_owner, lease_until)
    values (p_source, null, now(), p_owner, v_until);
    return jsonb_build_object('claimed', true, 'lease_owner', p_owner, 'lease_until', v_until);
  end if;
  -- a live v2 lease (token) refuses everyone; a live v1 lease refuses other owners (legacy semantics)
  if r.lease_until is not null and r.lease_until > now()
     and (r.lease_token is not null or r.lease_owner is distinct from p_owner) then
    return jsonb_build_object('claimed', false, 'lease_owner', r.lease_owner, 'lease_until', r.lease_until);
  end if;
  update public.sync_source_state
     set lease_owner = p_owner, lease_until = v_until, lease_token = null, updated_at = now()
   where source = p_source;
  return jsonb_build_object('claimed', true, 'lease_owner', p_owner, 'lease_until', v_until);
end $$;

create or replace function public.release_sync_run(p_source text, p_owner text)
 returns boolean language sql volatile security definer set search_path to ''
as $$
  with u as (
    update public.sync_source_state
       set lease_owner = null, lease_until = null, updated_at = now()
     where source = p_source and lease_owner = p_owner and lease_token is null
    returning 1
  ) select exists (select 1 from u);
$$;

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
     where s.source = 'email' and s.lease_owner = p_owner and s.lease_token is null and s.lease_until > now()
    returning 1
  ) select exists (select 1 from u);
$$;

revoke all on function public.claim_sync_run(text, text, integer) from public, anon, authenticated;
revoke all on function public.release_sync_run(text, text) from public, anon, authenticated;
revoke all on function public.set_email_checkpoint(text, bigint, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.claim_sync_run(text, text, integer) to service_role;
grant execute on function public.release_sync_run(text, text) to service_role;
grant execute on function public.set_email_checkpoint(text, bigint, bigint, timestamptz) to service_role;

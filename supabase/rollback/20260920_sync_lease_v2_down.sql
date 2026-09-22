-- DOWN for 20260920100000_sync_lease_v2.sql
--   psql "$SUPABASE_DB_URL" -f supabase/rollback/20260920_sync_lease_v2_down.sql
--   supabase migration repair --status reverted 20260920100000
-- Deploy the pre-v2 application first (it calls claim_sync_run_v2 / set_email_checkpoint_v2 / release_sync_run_v2).
-- Restores the v1 lease functions exactly as 20260918110000 (phase 1) defined them.

drop function if exists public.claim_sync_run_v2(text, text, integer);
drop function if exists public.release_sync_run_v2(text, uuid);
drop function if exists public.set_email_checkpoint_v2(uuid, bigint, bigint, timestamptz);

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
grant execute on function public.claim_sync_run(text, text, integer) to service_role;
revoke all on function public.release_sync_run(text, text) from public, anon, authenticated;
grant execute on function public.release_sync_run(text, text) to service_role;
revoke all on function public.set_email_checkpoint(text, bigint, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.set_email_checkpoint(text, bigint, bigint, timestamptz) to service_role;

alter table public.sync_source_state drop column if exists lease_token;

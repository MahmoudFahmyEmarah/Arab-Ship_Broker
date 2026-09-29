-- Global market privacy firewall, stage 1: governed discovery APIs.
--
-- This migration is intentionally additive.  The portal can cut over to these
-- RPCs before 20260923361000 closes the historical table/view/RPC paths.
-- Browser-visible listing keys are random, actor-bound, purpose-bound handles;
-- no cargo, availability or vessel UUID is exposed for a non-owned position.

create schema if not exists market_private;
revoke all on schema market_private from public, anon, authenticated;
grant usage on schema market_private to service_role;

create table if not exists market_private.listing_handles (
  key             uuid primary key default gen_random_uuid(),
  actor_user_id   uuid not null references public.users(id) on delete cascade,
  purpose         text not null check (purpose in (
                    'cargo_board', 'vessel_board',
                    'cargo_match', 'vessel_match'
                  )),
  listing_type    text not null check (listing_type in ('cargo', 'vessel_availability')),
  listing_id      uuid not null,
  created_at      timestamptz not null default now(),
  last_used_at    timestamptz not null default now(),
  expires_at      timestamptz not null
);

create unique index if not exists market_listing_handles_actor_purpose_listing_uq
  on market_private.listing_handles (actor_user_id, purpose, listing_type, listing_id);
create index if not exists market_listing_handles_expiry_idx
  on market_private.listing_handles (expires_at, key);

-- Governed board scans and bulk payload assembly must remain set based at the
-- release target (200 cargo x 200 positions).  The historical indexes cover
-- individual lookups but not the two board orderings, the reverse match-count
-- direction, or the two poster provenance lookups.
create index market_cargo_board_scan_idx
  on public.cargo_listings (created_at desc, id)
  where review_status = 'APPROVED'
    and status in ('IN', 'PARTIAL');
create index market_vessel_board_scan_idx
  on public.vessel_availability (open_date asc nulls last, created_at desc, id)
  where review_status = 'APPROVED'
    and status = 'OPEN';
create index market_matches_vessel_cargo_idx
  on public.matches (vessel_avail_id, cargo_id);
create index market_sync_cargo_poster_idx
  on public.sync_staged_row (business_key, created_at desc)
  include (batch_id)
  where sheet = 'cargo' and committed;
create index market_vrq_availability_poster_idx
  on public.vessel_review_queue (resolved_availability_id, resolved_at desc)
  include (resolved_by)
  where resolved_availability_id is not null;

alter table market_private.listing_handles enable row level security;
revoke all on table market_private.listing_handles from public, anon, authenticated;
grant all on table market_private.listing_handles to service_role;

comment on table market_private.listing_handles is
  'Private actor/purpose-bound market handles. No PDA/Fixture FK or member policy. Active handles are stable for 30 minutes; rows more than one day expired are purged in bounded batches.';

-- Resolve auth.uid() to the application identity once.  Handles always bind to
-- public.users.id, never to the dual-key auth UUID by accident.
create or replace function public.fn_market_actor()
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid;
begin
  if auth.uid() is null or auth.role() is distinct from 'authenticated' then
    raise exception 'MARKET_AUTH: authentication is required'
      using errcode = '42501';
  end if;

  select u.id
    into v_actor
    from public.users u
   where (u.supabase_user_id = auth.uid() or u.id = auth.uid())
     and u.is_active
   order by coalesce(u.supabase_user_id = auth.uid(), false) desc,
            coalesce(u.id = auth.uid(), false) desc,
            u.id
   limit 1;

  if v_actor is null then
    raise exception 'MARKET_AUTH: an active application profile is required'
      using errcode = '42501';
  end if;
  return v_actor;
end;
$function$;
revoke all on function public.fn_market_actor()
  from public, anon, authenticated, service_role;

-- Exact ownership only.  A personal listing belongs to its recorded member.
-- An organisation listing belongs only to a current, active seat in that exact
-- organisation; an unrelated seat held by the same member never qualifies.
create or replace function public.fn_market_owns_listing(
  p_actor uuid,
  p_listing_type text,
  p_listing_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select coalesce(exists (
    select 1
      from public.listing_ownership lo
     where lo.listing_type::text = p_listing_type
       and lo.listing_id = p_listing_id
       and lo.role = 'primary'::public.ownership_role_enum
       and lo.is_current
       and (lo.owned_until is null or lo.owned_until > now())
       and (
         (
           lo.owner_org_id is null
           and lo.owner_user_id = p_actor
         )
         or (
           lo.owner_org_id is not null
           and exists (
             select 1
               from public.organization_members om
              where om.org_id = lo.owner_org_id
                and om.user_id = p_actor
                and om.is_current
                and om.status = 'active'
           )
         )
       )
  ), false);
$function$;
revoke all on function public.fn_market_owns_listing(uuid, text, uuid)
  from public, anon, authenticated, service_role;

-- RLS-safe public wrapper: the actor is always resolved from the session, so
-- a member cannot ask ownership questions on behalf of an arbitrary user.
create or replace function public.fn_market_owns_listing(
  p_listing_type text,
  p_listing_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.fn_market_owns_listing(
    public.fn_market_actor(), p_listing_type, p_listing_id
  );
$function$;
revoke all on function public.fn_market_owns_listing(text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.fn_market_owns_listing(text, uuid) to authenticated;

-- Public discovery has a stricter freshness rule than the owner-management
-- read.  It intentionally has no owner/admin bypass: a stale listing cannot be
-- used as a match-enumeration source merely because the caller manages it.
create or replace function market_private.discovery_fresh_ok(
  p_refreshed timestamptz,
  p_future date
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_cfg jsonb := '{}'::jsonb;
  v_tier text := 'T1';
  v_raw text;
  v_fresh integer := 7;
  v_archive integer := 0;
  v_cap integer;
  v_laycan_exception boolean := true;
begin
  select u.subscription_tier::text
    into v_tier
    from public.users u
   where (u.supabase_user_id = auth.uid() or u.id = auth.uid())
     and u.is_active
   order by coalesce(u.supabase_user_id = auth.uid(), false) desc,
            coalesce(u.id = auth.uid(), false) desc,
            u.id
   limit 1;

  select coalesce(s.value, '{}'::jsonb)
    into v_cfg
    from public.app_settings s
   where s.key = 'market_visibility';
  v_cfg := coalesce(v_cfg, '{}'::jsonb);

  v_raw := v_cfg->>'freshDays';
  if v_raw ~ '^[0-9]{1,9}$' then
    v_fresh := greatest(v_raw::integer, 1);
  end if;

  v_tier := case
    when v_tier in ('T1', 'T2', 'T3', 'T4') then v_tier
    else 'T1'
  end;
  v_raw := v_cfg->'archiveDaysByTier'->>v_tier;
  if v_raw ~ '^[0-9]{1,9}$' then
    v_archive := v_raw::integer;
  end if;

  if lower(coalesce(v_cfg->>'laycanException', 'true')) in ('true', 'false') then
    v_laycan_exception := (v_cfg->>'laycanException')::boolean;
  end if;
  v_cap := greatest(v_fresh, v_archive);

  if p_refreshed is not null
     and p_refreshed >= now() - make_interval(days => v_cap) then
    return true;
  end if;
  if v_laycan_exception and p_future is not null and p_future >= current_date then
    return true;
  end if;
  return false;
end;
$function$;
revoke all on function market_private.discovery_fresh_ok(timestamptz, date)
  from public, anon, authenticated, service_role;

-- Replace the historical owner-management freshness predicate with one that
-- resolves the application user through either auth key and treats only exact
-- ownership as an owner override. Public discovery uses the stricter helper
-- above. Configuration and tier are always read on the server.
create or replace function public.fn_market_fresh_ok(
  p_listing_id uuid,
  p_type public.listing_type_enum,
  p_refreshed timestamptz,
  p_future date
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_cfg jsonb := '{}'::jsonb;
  v_actor uuid;
  v_tier text := 'T1';
  v_raw text;
  v_fresh integer := 7;
  v_archive integer := 0;
  v_cap integer;
  v_laycan_exception boolean := true;
begin
  if public.fn_is_admin() then
    return true;
  end if;

  select u.id, u.subscription_tier::text
    into v_actor, v_tier
    from public.users u
   where (u.supabase_user_id = auth.uid() or u.id = auth.uid())
     and u.is_active
   order by coalesce(u.supabase_user_id = auth.uid(), false) desc,
            coalesce(u.id = auth.uid(), false) desc,
            u.id
   limit 1;

  if v_actor is not null and exists (
    select 1
      from public.listing_ownership lo
     where lo.listing_type = p_type
       and lo.listing_id = p_listing_id
       and lo.role = 'primary'::public.ownership_role_enum
       and lo.is_current
       and (lo.owned_until is null or lo.owned_until > now())
       and (
         (lo.owner_org_id is null and lo.owner_user_id = v_actor)
         or (
           lo.owner_org_id is not null
           and exists (
             select 1
               from public.organization_members om
              where om.org_id = lo.owner_org_id
                and om.user_id = v_actor
                and om.is_current
                and om.status = 'active'
           )
         )
       )
  ) then
    return true;
  end if;

  select coalesce(s.value, '{}'::jsonb)
    into v_cfg
    from public.app_settings s
   where s.key = 'market_visibility';
  v_cfg := coalesce(v_cfg, '{}'::jsonb);

  v_raw := v_cfg->>'freshDays';
  if v_raw ~ '^[0-9]{1,9}$' then
    v_fresh := greatest(v_raw::integer, 1);
  end if;

  v_tier := case
    when v_tier in ('T1', 'T2', 'T3', 'T4') then v_tier
    else 'T1'
  end;
  v_raw := v_cfg->'archiveDaysByTier'->>v_tier;
  if v_raw ~ '^[0-9]{1,9}$' then
    v_archive := v_raw::integer;
  end if;

  if lower(coalesce(v_cfg->>'laycanException', 'true')) in ('true', 'false') then
    v_laycan_exception := (v_cfg->>'laycanException')::boolean;
  end if;
  v_cap := greatest(v_fresh, v_archive);

  if p_refreshed is not null
     and p_refreshed >= now() - make_interval(days => v_cap) then
    return true;
  end if;
  if v_laycan_exception and p_future is not null and p_future >= current_date then
    return true;
  end if;
  return false;
end;
$function$;

-- Admin-configured spot/undated-position windows are also authoritative.  A
-- requested cutoff is accepted only when it is later (more restrictive).
create or replace function market_private.active_window_cutoff(
  p_kind text,
  p_requested date default null
)
returns date
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_cfg jsonb := '{}'::jsonb;
  v_raw text;
  v_days integer := 14;
  v_server date;
begin
  if p_kind not in ('cargo', 'vessel_availability') then
    raise exception 'MARKET_VALIDATION: invalid active-window kind'
      using errcode = '22023';
  end if;

  select coalesce(s.value, '{}'::jsonb)
    into v_cfg
    from public.app_settings s
   where s.key = 'platform_settings';
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_raw := case p_kind
    when 'cargo' then v_cfg->'marketplace'->>'spotActiveDays'
    else v_cfg->'marketplace'->>'vesselActiveDays'
  end;
  if v_raw ~ '^[0-9]{1,9}$' then
    v_days := greatest(v_raw::integer, 1);
  end if;

  v_server := current_date - v_days;
  if p_requested is null or p_requested < v_server then
    return v_server;
  end if;
  return p_requested;
end;
$function$;
revoke all on function market_private.active_window_cutoff(text, date)
  from public, anon, authenticated, service_role;

-- Resolve all request-wide policy inputs once.  Bulk RPCs consume this row in
-- relational predicates rather than calling configuration/tier helpers once
-- per listing (or, worse, once per match edge).
create or replace function market_private.market_request_context(
  p_actor uuid,
  p_cargo_requested date default null,
  p_vessel_requested date default null
)
returns table (
  fresh_after timestamptz,
  laycan_exception boolean,
  cargo_active_from date,
  vessel_active_from date
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_visibility jsonb := '{}'::jsonb;
  v_platform jsonb := '{}'::jsonb;
  v_tier text := 'T1';
  v_raw text;
  v_fresh integer := 7;
  v_archive integer := 0;
  v_cargo_days integer := 14;
  v_vessel_days integer := 14;
  v_server date;
begin
  if p_actor is null then
    raise exception 'MARKET_AUTH: authentication is required'
      using errcode = '42501';
  end if;

  select case
           when u.subscription_tier::text in ('T1', 'T2', 'T3', 'T4')
             then u.subscription_tier::text
           else 'T1'
         end
    into v_tier
    from public.users u
   where u.id = p_actor and u.is_active;
  v_tier := coalesce(v_tier, 'T1');

  select coalesce(s.value, '{}'::jsonb)
    into v_visibility
    from public.app_settings s
   where s.key = 'market_visibility';
  v_visibility := coalesce(v_visibility, '{}'::jsonb);

  v_raw := v_visibility->>'freshDays';
  if v_raw ~ '^[0-9]{1,9}$' then
    v_fresh := greatest(v_raw::integer, 1);
  end if;
  v_raw := v_visibility->'archiveDaysByTier'->>v_tier;
  if v_raw ~ '^[0-9]{1,9}$' then
    v_archive := v_raw::integer;
  end if;
  fresh_after := now() - make_interval(days => greatest(v_fresh, v_archive));
  laycan_exception := case
    when lower(coalesce(v_visibility->>'laycanException', 'true'))
         in ('true', 'false')
      then (v_visibility->>'laycanException')::boolean
    else true
  end;

  select coalesce(s.value, '{}'::jsonb)
    into v_platform
    from public.app_settings s
   where s.key = 'platform_settings';
  v_platform := coalesce(v_platform, '{}'::jsonb);
  v_raw := v_platform->'marketplace'->>'spotActiveDays';
  if v_raw ~ '^[0-9]{1,9}$' then
    v_cargo_days := greatest(v_raw::integer, 1);
  end if;
  v_raw := v_platform->'marketplace'->>'vesselActiveDays';
  if v_raw ~ '^[0-9]{1,9}$' then
    v_vessel_days := greatest(v_raw::integer, 1);
  end if;

  v_server := current_date - v_cargo_days;
  cargo_active_from := case
    when p_cargo_requested is null or p_cargo_requested < v_server
      then v_server else p_cargo_requested end;
  v_server := current_date - v_vessel_days;
  vessel_active_from := case
    when p_vessel_requested is null or p_vessel_requested < v_server
      then v_server else p_vessel_requested end;
  return next;
end;
$function$;
revoke all on function market_private.market_request_context(uuid, date, date)
  from public, anon, authenticated, service_role;

create or replace function market_private.cargo_is_market_live(p_cargo_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
  select coalesce(exists (
    select 1
      from public.cargo_listings c
     where c.id = p_cargo_id
       and c.review_status::text = 'APPROVED'
       and c.status::text in ('IN', 'PARTIAL')
       and market_private.discovery_fresh_ok(c.refreshed_at, c.laycan_to)
       and (
         not coalesce(c.is_spot, false)
         or c.created_at::date >= market_private.active_window_cutoff('cargo', null)
       )
  ), false);
$function$;
revoke all on function market_private.cargo_is_market_live(uuid)
  from public, anon, authenticated, service_role;

create or replace function market_private.vessel_is_market_live(p_availability_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
  select coalesce(exists (
    select 1
      from public.vessel_availability a
      join public.vessels v on v.id = a.vessel_id
     where a.id = p_availability_id
       and a.review_status::text = 'APPROVED'
       and a.status::text = 'OPEN'
       and not v.is_sanctioned
       and market_private.discovery_fresh_ok(a.refreshed_at, a.open_date)
       and (
         a.open_date is not null
         or a.created_at::date >= market_private.active_window_cutoff(
              'vessel_availability', null
            )
       )
  ), false);
$function$;
revoke all on function market_private.vessel_is_market_live(uuid)
  from public, anon, authenticated, service_role;

-- Cleanup is request-scoped, never row-scoped: a board with 1,000 rows still
-- performs one bounded delete. SKIP LOCKED keeps concurrent requests moving.
create or replace function market_private.purge_listing_handles(
  p_limit integer default 1000
)
returns integer
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'market_private'
as $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1000), 1), 1000);
  v_deleted integer;
begin
  with doomed as (
    select h.key
      from market_private.listing_handles h
     where h.expires_at < now() - interval '1 day'
     order by h.expires_at, h.key
     for update skip locked
     limit v_limit
  )
  delete from market_private.listing_handles h
   using doomed d
   where h.key = d.key;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;
revoke all on function market_private.purge_listing_handles(integer)
  from public, anon, authenticated, service_role;

-- Every request that mutates more than one handle comes through this helper.
-- The sort is a global lock order, including the match-before-board order used
-- by governed detail reads.  DISTINCT also prevents one INSERT command from
-- attempting to update the same conflict tuple twice.
create or replace function market_private.issue_listing_handles_bulk(
  p_actor uuid,
  p_listing_types text[],
  p_purposes text[],
  p_listing_ids uuid[]
)
returns table (
  listing_type text,
  purpose text,
  listing_id uuid,
  key uuid,
  expires_at timestamptz
)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'market_private'
as $function$
#variable_conflict use_column
declare
  v_now timestamptz := now();
  v_count integer;
begin
  if p_actor is null
     or p_listing_types is null
     or p_purposes is null
     or p_listing_ids is null then
    raise exception 'MARKET_VALIDATION: invalid handle request'
      using errcode = '22023';
  end if;

  v_count := cardinality(p_listing_ids);
  if cardinality(p_listing_types) <> v_count
     or cardinality(p_purposes) <> v_count then
    raise exception 'MARKET_VALIDATION: invalid handle request'
      using errcode = '22023';
  end if;

  if exists (
    select 1
      from unnest(p_listing_types, p_purposes, p_listing_ids)
             as q(listing_type, purpose, listing_id)
     where q.listing_id is null
        or not (
          (q.listing_type = 'cargo'
           and q.purpose in ('cargo_board', 'cargo_match'))
          or
          (q.listing_type = 'vessel_availability'
           and q.purpose in ('vessel_board', 'vessel_match'))
        )
  ) then
    raise exception 'MARKET_VALIDATION: invalid handle request'
      using errcode = '22023';
  end if;

  return query
  with requested as materialized (
    select distinct q.listing_type, q.purpose, q.listing_id
      from unnest(p_listing_types, p_purposes, p_listing_ids)
             as q(listing_type, purpose, listing_id)
  ),
  ordered as materialized (
    select r.listing_type, r.purpose, r.listing_id,
           case when r.purpose in ('cargo_match', 'vessel_match')
                then 0 else 1 end as purpose_rank
      from requested r
     order by r.listing_type, r.listing_id, purpose_rank, r.purpose
  )
  insert into market_private.listing_handles as h (
    actor_user_id, purpose, listing_type, listing_id, expires_at
  )
  select p_actor, o.purpose, o.listing_type, o.listing_id,
         v_now + interval '30 minutes'
    from ordered o
   order by o.listing_type, o.listing_id, o.purpose_rank, o.purpose
  on conflict (actor_user_id, purpose, listing_type, listing_id)
  do update set
    key = case
      when h.expires_at > v_now then h.key
      else gen_random_uuid()
    end,
    created_at = case
      when h.expires_at > v_now then h.created_at
      else v_now
    end,
    last_used_at = v_now,
    expires_at = v_now + interval '30 minutes'
  returning h.listing_type, h.purpose, h.listing_id, h.key, h.expires_at;
end;
$function$;
revoke all on function market_private.issue_listing_handles_bulk(
  uuid, text[], text[], uuid[]
) from public, anon, authenticated, service_role;

create or replace function public.fn_market_issue_handle(
  p_actor uuid,
  p_purpose text,
  p_listing_type text,
  p_listing_id uuid
)
returns table (key uuid, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
begin
  if p_actor is null
     or p_purpose not in ('cargo_board', 'vessel_board', 'cargo_match', 'vessel_match')
     or p_listing_type not in ('cargo', 'vessel_availability')
     or (p_purpose in ('cargo_board', 'cargo_match') and p_listing_type <> 'cargo')
     or (p_purpose in ('vessel_board', 'vessel_match') and p_listing_type <> 'vessel_availability')
     or p_listing_id is null then
    raise exception 'MARKET_VALIDATION: invalid handle request'
      using errcode = '22023';
  end if;

  return query
  select h.key, h.expires_at
    from market_private.issue_listing_handles_bulk(
      p_actor,
      array[p_listing_type],
      array[p_purpose],
      array[p_listing_id]
    ) h;
end;
$function$;
revoke all on function public.fn_market_issue_handle(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.fn_market_resolve_handle(
  p_actor uuid,
  p_key uuid
)
returns table (purpose text, listing_type text, listing_id uuid)
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  h market_private.listing_handles%rowtype;
  v_now timestamptz := now();
begin
  if p_key is null then
    raise exception 'MARKET_VALIDATION: listing key is required'
      using errcode = '22023';
  end if;

  -- The expiry predicate and TTL refresh are one locked write. An expired key
  -- can never be revived between a SELECT check and a later UPDATE.
  update market_private.listing_handles x
     set last_used_at = v_now,
         expires_at = v_now + interval '30 minutes'
   where x.key = p_key
     and x.actor_user_id = p_actor
     and x.expires_at > v_now
     and (
       (x.purpose in ('cargo_board', 'cargo_match') and x.listing_type = 'cargo')
       or (
         x.purpose in ('vessel_board', 'vessel_match')
         and x.listing_type = 'vessel_availability'
       )
     )
  returning x.* into h;

  -- Unknown and foreign handles are deliberately indistinguishable.
  if h.key is null and exists (
    select 1
      from market_private.listing_handles x
     where x.key = p_key
       and x.actor_user_id = p_actor
       and x.expires_at <= v_now
  ) then
    raise exception 'MARKET_EXPIRED: listing key expired; reload the market'
      using errcode = '55000';
  end if;
  if h.key is null then
    raise exception 'MARKET_NOT_FOUND: listing key was not found'
      using errcode = 'P0002';
  end if;

  return query select h.purpose, h.listing_type, h.listing_id;
end;
$function$;
revoke all on function public.fn_market_resolve_handle(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Match enumeration must discover every handle it will touch before it takes
-- any row lock.  This read-only twin preserves the public resolver's unknown /
-- foreign / expired error contract; the source tuple is refreshed later in the
-- same globally ordered bulk issuance as all counterpart tuples.
create or replace function market_private.peek_listing_handle(
  p_actor uuid,
  p_key uuid
)
returns table (purpose text, listing_type text, listing_id uuid)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'market_private'
as $function$
declare
  h market_private.listing_handles%rowtype;
  v_now timestamptz := now();
begin
  if p_key is null then
    raise exception 'MARKET_VALIDATION: listing key is required'
      using errcode = '22023';
  end if;

  select x.*
    into h
    from market_private.listing_handles x
   where x.key = p_key
     and x.actor_user_id = p_actor
     and x.expires_at > v_now
     and (
       (x.purpose in ('cargo_board', 'cargo_match') and x.listing_type = 'cargo')
       or (
         x.purpose in ('vessel_board', 'vessel_match')
         and x.listing_type = 'vessel_availability'
       )
     );

  if h.key is null and exists (
    select 1
      from market_private.listing_handles x
     where x.key = p_key
       and x.actor_user_id = p_actor
       and x.expires_at <= v_now
  ) then
    raise exception 'MARKET_EXPIRED: listing key expired; reload the market'
      using errcode = '55000';
  end if;
  if h.key is null then
    raise exception 'MARKET_NOT_FOUND: listing key was not found'
      using errcode = 'P0002';
  end if;

  return query select h.purpose, h.listing_type, h.listing_id;
end;
$function$;
revoke all on function market_private.peek_listing_handle(uuid, uuid)
  from public, anon, authenticated, service_role;

-- Preserve the platform's governed poster display without carrying org/user
-- identifiers into the browser payload.  A masked TBN never calls this helper.
create or replace function public.fn_market_poster(
  p_listing_type text,
  p_listing_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_out jsonb;
  v_synced_actor uuid;
begin
  if p_listing_type not in ('cargo', 'vessel_availability') then
    return null;
  end if;

  -- The organisation is the one recorded on this ownership row. Never pick an
  -- unrelated active membership merely because the same poster holds it. If
  -- the recorded owner no longer has an active seat in that exact organisation,
  -- expose the company only, not the former member's personal identity.
  select jsonb_build_object(
           'name', case
             when lo.owner_org_id is null or om.user_id is not null
               then u.full_name
             else null
           end,
           'company', case
             when lo.owner_org_id is null then u.company
             else o.name
           end,
           'kind', case
             when lo.owner_org_id is null then 'individual'
             when om.user_id is null then 'company'
             else 'employee'
           end,
           'is_admin', lower(coalesce(u.role, '')) = 'admin'
         )
    into v_out
    from public.listing_ownership lo
    join public.users u on u.id = lo.owner_user_id
    left join public.organizations o on o.id = lo.owner_org_id
    left join public.organization_members om
      on om.org_id = lo.owner_org_id
     and om.user_id = lo.owner_user_id
     and om.is_current
     and om.status = 'active'
   where lo.listing_type::text = p_listing_type
     and lo.listing_id = p_listing_id
     and lo.role = 'primary'::public.ownership_role_enum
     and lo.is_current
     and (lo.owned_until is null or lo.owned_until > now())
   order by lo.owned_from desc
   limit 1;

  if v_out is not null then
    return v_out;
  end if;

  -- Listings committed by ingestion may intentionally have no ownership row.
  -- Attribute those to the recorded platform actor through either identity
  -- key, without attaching any of that actor's unrelated organisation seats.
  if p_listing_type = 'cargo' then
    select b.started_by
      into v_synced_actor
      from public.cargo_listings c
      join public.sync_staged_row s
        on s.business_key = c.ref
       and s.sheet = 'cargo'
       and s.committed
      join public.sync_batch b on b.id = s.batch_id
     where c.id = p_listing_id
     order by s.created_at desc
     limit 1;
  else
    select q.resolved_by
      into v_synced_actor
      from public.vessel_review_queue q
     where q.resolved_availability_id = p_listing_id
     order by q.resolved_at desc nulls last
     limit 1;
  end if;

  if v_synced_actor is not null then
    select jsonb_build_object(
             'name', u.full_name,
             'company', u.company,
             'kind', 'individual',
             'is_admin', lower(coalesce(u.role, '')) = 'admin'
           )
      into v_out
      from public.users u
     where u.id = v_synced_actor
        or u.supabase_user_id = v_synced_actor
     order by (u.id = v_synced_actor) desc, u.id
     limit 1;
    if v_out is not null then
      return v_out;
    end if;
  end if;

  return jsonb_build_object(
    'name', null,
    'company', 'Arab ShipBroker',
    'kind', 'company',
    'is_admin', true
  );
end;
$function$;
revoke all on function public.fn_market_poster(text, uuid)
  from public, anon, authenticated, service_role;

-- Resolve exact ownership and display-only poster data for a whole response in
-- one query.  This is deliberately private: callers cannot submit arbitrary
-- listing ids to turn it into an identity oracle.
create or replace function market_private.market_listing_metadata(
  p_actor uuid,
  p_listing_type text,
  p_listing_ids uuid[],
  p_is_admin boolean
)
returns table (
  listing_id uuid,
  is_owned boolean,
  can_manage boolean,
  poster jsonb,
  management_ownership jsonb
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
begin
  if p_actor is null
     or p_listing_type not in ('cargo', 'vessel_availability')
     or p_listing_ids is null then
    raise exception 'MARKET_VALIDATION: invalid metadata request'
      using errcode = '22023';
  end if;

  return query
  with ids as materialized (
    select distinct x.id
      from unnest(p_listing_ids) as x(id)
     where x.id is not null
  ),
  owner_row as materialized (
    select distinct on (lo.listing_id)
           lo.listing_id,
           lo.owner_user_id,
           lo.owner_org_id
      from public.listing_ownership lo
      join ids i on i.id = lo.listing_id
     where lo.listing_type::text = p_listing_type
       and lo.role = 'primary'::public.ownership_role_enum
       and lo.is_current
       and (lo.owned_until is null or lo.owned_until > now())
     order by lo.listing_id, lo.owned_from desc
  ),
  ownership as materialized (
    select i.id as listing_id,
           coalesce(
             (o.owner_org_id is null and o.owner_user_id = p_actor)
             or (
               o.owner_org_id is not null
               and exists (
                 select 1
                   from public.organization_members am
                  where am.org_id = o.owner_org_id
                    and am.user_id = p_actor
                    and am.is_current
                    and am.status = 'active'
               )
             ),
             false
           ) as is_owned
      from ids i
      left join owner_row o on o.listing_id = i.id
  ),
  cargo_fallback as materialized (
    select distinct on (c.id)
           c.id as listing_id,
           b.started_by as actor_id
      from ids i
      join public.cargo_listings c on c.id = i.id
      left join owner_row o on o.listing_id = i.id
      join public.sync_staged_row s
        on s.business_key = c.ref
       and s.sheet = 'cargo'
       and s.committed
      join public.sync_batch b on b.id = s.batch_id
     where p_listing_type = 'cargo'
       and o.listing_id is null
     order by c.id, s.created_at desc
  ),
  vessel_fallback as materialized (
    select distinct on (q.resolved_availability_id)
           q.resolved_availability_id as listing_id,
           q.resolved_by as actor_id
      from ids i
      left join owner_row o on o.listing_id = i.id
      join public.vessel_review_queue q
        on q.resolved_availability_id = i.id
     where p_listing_type = 'vessel_availability'
       and o.listing_id is null
     order by q.resolved_availability_id, q.resolved_at desc nulls last
  ),
  fallback_actor as materialized (
    select * from cargo_fallback
    union all
    select * from vessel_fallback
  ),
  fallback_user as materialized (
    select distinct on (f.listing_id)
           f.listing_id,
           u.full_name,
           u.company,
           lower(coalesce(u.role, '')) = 'admin' as is_admin
      from fallback_actor f
      join public.users u
        on u.id = f.actor_id or u.supabase_user_id = f.actor_id
     order by f.listing_id, (u.id = f.actor_id) desc, u.id
  ),
  vessel_facts as materialized (
    select i.id as listing_id,
           v,
           nullif(to_jsonb(v)->>'owner_org_id', '')::uuid as owner_org_id,
           nullif(to_jsonb(v)->>'manager_org_id', '')::uuid as manager_org_id
      from ids i
      join ownership own on own.listing_id = i.id
      join public.vessel_availability a on a.id = i.id
      join public.vessels v on v.id = a.vessel_id
     where p_listing_type = 'vessel_availability'
       and (coalesce(p_is_admin, false) or own.is_owned)
  ),
  owner_org as materialized (
    select distinct on (vf.listing_id)
           vf.listing_id, o
      from vessel_facts vf
      join public.organizations o
        on o.id = vf.owner_org_id
        or (
          nullif(btrim((vf.v).owner_company), '') is not null
          and upper(btrim(o.name)) = upper(btrim((vf.v).owner_company))
        )
     order by vf.listing_id,
              (o.id = vf.owner_org_id) desc,
              o.created_at,
              o.id
  ),
  manager_org as materialized (
    select distinct on (vf.listing_id)
           vf.listing_id, o
      from vessel_facts vf
      join public.organizations o
        on o.id = vf.manager_org_id
        or (
          nullif(btrim((vf.v).manager_company), '') is not null
          and upper(btrim(o.name)) = upper(btrim((vf.v).manager_company))
        )
     order by vf.listing_id,
              (o.id = vf.manager_org_id) desc,
              o.created_at,
              o.id
  ),
  vessel_management as materialized (
    select vf.listing_id,
           jsonb_build_object(
             'owner_company', (vf.v).owner_company,
             'owner_org_name', (oo.o).name,
             'owner_org_imo', (oo.o).imo,
             'owner_org_country', coalesce(
               (oo.o).country, (vf.v).owner_country
             ),
             'owner_org_fleet', (oo.o).fleet_total,
             'owner_org_desk', (oo.o).desk_contact_name,
             'manager_company', (vf.v).manager_company,
             'manager_org_name', (mo.o).name,
             'manager_org_country', coalesce(
               (mo.o).country, (vf.v).manager_country
             ),
             'manager_org_fleet', (mo.o).fleet_total,
             'manager_org_desk', (mo.o).desk_contact_name
           ) as value
      from vessel_facts vf
      left join owner_org oo on oo.listing_id = vf.listing_id
      left join manager_org mo on mo.listing_id = vf.listing_id
  )
  select i.id,
         own.is_owned,
         coalesce(p_is_admin, false) or own.is_owned,
         case
           when o.listing_id is not null then
             jsonb_build_object(
               'name', case
                 when o.owner_org_id is null or poster_seat.user_id is not null
                   then ou.full_name
                 else null
               end,
               'company', case
                 when o.owner_org_id is null then ou.company
                 else org.name
               end,
               'kind', case
                 when o.owner_org_id is null then 'individual'
                 when poster_seat.user_id is null then 'company'
                 else 'employee'
               end,
               'is_admin', lower(coalesce(ou.role, '')) = 'admin'
             )
           when fu.listing_id is not null then
             jsonb_build_object(
               'name', fu.full_name,
               'company', fu.company,
               'kind', 'individual',
               'is_admin', fu.is_admin
             )
           else jsonb_build_object(
             'name', null,
             'company', 'Arab ShipBroker',
             'kind', 'company',
             'is_admin', true
           )
         end,
         case
           when coalesce(p_is_admin, false) or own.is_owned then vm.value
           else null
         end
    from ids i
    join ownership own on own.listing_id = i.id
    left join owner_row o on o.listing_id = i.id
    left join public.users ou on ou.id = o.owner_user_id
    left join public.organizations org on org.id = o.owner_org_id
    left join public.organization_members poster_seat
      on poster_seat.org_id = o.owner_org_id
     and poster_seat.user_id = o.owner_user_id
     and poster_seat.is_current
     and poster_seat.status = 'active'
    left join fallback_user fu on fu.listing_id = i.id
    left join vessel_management vm on vm.listing_id = i.id;
end;
$function$;
revoke all on function market_private.market_listing_metadata(
  uuid, text, uuid[], boolean
) from public, anon, authenticated, service_role;

-- Match counts are grouped over one materialized live counterpart set.  The
-- old renderer called a liveness function for every match edge (40,000 times
-- in the 200x200 release fixture); this helper evaluates the predicate once
-- per counterpart table scan and groups all requested sources together.
create or replace function market_private.market_match_counts(
  p_source_type text,
  p_source_ids uuid[],
  p_fresh_after timestamptz,
  p_laycan_exception boolean,
  p_cargo_active_from date,
  p_vessel_active_from date
)
returns table (listing_id uuid, match_count integer)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
begin
  if p_source_type not in ('cargo', 'vessel_availability')
     or p_source_ids is null
     or p_fresh_after is null
     or p_cargo_active_from is null
     or p_vessel_active_from is null then
    raise exception 'MARKET_VALIDATION: invalid match-count request'
      using errcode = '22023';
  end if;

  if p_source_type = 'cargo' then
    return query
    with edges as materialized (
      select m.cargo_id, m.vessel_avail_id
        from public.matches m
       where m.cargo_id = any (p_source_ids)
    ),
    live_vessels as materialized (
      select a.id
        from (select distinct e.vessel_avail_id from edges e) needed
        join public.vessel_availability a
          on a.id = needed.vessel_avail_id
        join public.vessels v on v.id = a.vessel_id
       where a.review_status::text = 'APPROVED'
         and a.status::text = 'OPEN'
         and not v.is_sanctioned
         and (
           a.refreshed_at >= p_fresh_after
           or (
             coalesce(p_laycan_exception, true)
             and a.open_date is not null
             and a.open_date >= current_date
           )
         )
         and (
           a.open_date is not null
           or a.created_at::date >= p_vessel_active_from
         )
    )
    select e.cargo_id, count(*)::integer
      from edges e
      join live_vessels v on v.id = e.vessel_avail_id
     group by e.cargo_id;
  else
    return query
    with edges as materialized (
      select m.vessel_avail_id, m.cargo_id
        from public.matches m
       where m.vessel_avail_id = any (p_source_ids)
    ),
    live_cargo as materialized (
      select c.id
        from (select distinct e.cargo_id from edges e) needed
        join public.cargo_listings c on c.id = needed.cargo_id
       where c.review_status::text = 'APPROVED'
         and c.status::text in ('IN', 'PARTIAL')
         and (
           c.refreshed_at >= p_fresh_after
           or (
             coalesce(p_laycan_exception, true)
             and c.laycan_to is not null
             and c.laycan_to >= current_date
           )
         )
         and (
           not coalesce(c.is_spot, false)
           or c.created_at::date >= p_cargo_active_from
         )
    )
    select e.vessel_avail_id, count(*)::integer
      from edges e
      join live_cargo c on c.id = e.cargo_id
     group by e.vessel_avail_id;
  end if;
end;
$function$;
revoke all on function market_private.market_match_counts(
  text, uuid[], timestamptz, boolean, date, date
) from public, anon, authenticated, service_role;

-- Query-free cargo renderer for bulk endpoints.  Every authorization,
-- liveness, count, poster and handle input is computed by the enclosing
-- SECURITY DEFINER RPC before this private function is called.
create or replace function market_private.render_cargo_payload(
  p_cargo public.cargo_listings,
  p_purpose text,
  p_key uuid,
  p_board_key uuid,
  p_expires timestamptz,
  p_owned boolean,
  p_manage boolean,
  p_count integer,
  p_poster jsonb,
  p_fit jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
begin
  if p_cargo.id is null
     or p_purpose not in ('cargo_board', 'cargo_match')
     or p_key is null or p_board_key is null or p_expires is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', p_key,
    'listing_key', p_key,
    'board_listing_key', p_board_key,
    'listing_type', 'cargo',
    'is_owned', coalesce(p_owned, false),
    'can_manage', coalesce(p_manage, false),
    'owned_listing_id', case when p_manage then p_cargo.id else null end,
    'expires_at', p_expires,
    'match_count', coalesce(p_count, 0),
    'ref', p_cargo.ref,
    'status', p_cargo.status,
    'review_status', p_cargo.review_status,
    'goes_live_at', p_cargo.goes_live_at,
    'cargo_type', p_cargo.cargo_type,
    'commodity_name', p_cargo.commodity_name,
    'is_dg_cargo', p_cargo.is_dg_cargo,
    'is_grain_cargo', p_cargo.is_grain_cargo,
    'qty_min_mt', p_cargo.qty_min_mt,
    'qty_max_mt', p_cargo.qty_max_mt,
    'stowage_factor', p_cargo.stowage_factor,
    'volume_cbm', p_cargo.volume_cbm,
    'load_port_locode', p_cargo.load_port_locode,
    'load_port_name', p_cargo.load_port_name,
    'load_zone', p_cargo.load_zone,
    'load_country', p_cargo.load_country,
    'disch_port_locode', p_cargo.disch_port_locode,
    'disch_port_name', p_cargo.disch_port_name,
    'disch_zone', p_cargo.disch_zone,
    'disch_country', p_cargo.disch_country,
    'load_port_scope', p_cargo.load_port_scope,
    'disch_port_scope', p_cargo.disch_port_scope,
    'load_ref_locode', p_cargo.load_ref_locode,
    'disch_ref_locode', p_cargo.disch_ref_locode,
    'load_ports', p_cargo.load_ports,
    'disch_ports', p_cargo.disch_ports
  ) || jsonb_build_object(
    'laycan_from', p_cargo.laycan_from,
    'laycan_to', p_cargo.laycan_to,
    'is_spot', p_cargo.is_spot,
    'nor_clause', p_cargo.nor_clause,
    'load_rate', p_cargo.load_rate,
    'disch_rate', p_cargo.disch_rate,
    'load_terms', p_cargo.load_terms,
    'laytime_structure', p_cargo.laytime_structure,
    'freight_idea_usd_mt', p_cargo.freight_idea_usd_mt,
    'commission_pct', p_cargo.commission_pct,
    'commission_ttl_pct', p_cargo.commission_ttl_pct,
    'demurrage_rate', p_cargo.demurrage_rate,
    'despatch_rate', p_cargo.despatch_rate,
    'requires_geared', p_cargo.requires_geared,
    'max_vessel_age_yr', p_cargo.max_vessel_age_yr,
    'max_loa_m', p_cargo.max_loa_m,
    'max_draft_m', p_cargo.max_draft_m,
    'broker', case when p_manage then p_cargo.broker else null end,
    'created_at', p_cargo.created_at,
    'updated_at', p_cargo.updated_at,
    'refreshed_at', p_cargo.refreshed_at,
    'poster', p_poster,
    'fit', p_fit
  );
end;
$function$;
revoke all on function market_private.render_cargo_payload(
  public.cargo_listings, text, uuid, uuid, timestamptz,
  boolean, boolean, integer, jsonb, jsonb
) from public, anon, authenticated, service_role;

create or replace function market_private.cargo_payload_preissued(
  p_actor uuid,
  p_purpose text,
  p_cargo_id uuid,
  p_key uuid,
  p_board_key uuid,
  p_expires timestamptz,
  p_fit jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  c public.cargo_listings%rowtype;
  v_owned boolean;
  v_manage boolean;
  v_live boolean;
  v_key uuid := p_key;
  v_board_key uuid := p_board_key;
  v_expires timestamptz := p_expires;
  v_count integer := 0;
begin
  if p_purpose not in ('cargo_board', 'cargo_match') then
    raise exception 'MARKET_VALIDATION: invalid cargo handle purpose'
      using errcode = '22023';
  end if;

  select * into c from public.cargo_listings x where x.id = p_cargo_id;
  if c.id is null then return null; end if;

  v_owned := public.fn_market_owns_listing(p_actor, 'cargo', c.id);
  v_manage := v_owned or public.fn_is_admin();
  v_live := market_private.cargo_is_market_live(c.id);
  if (p_purpose = 'cargo_match' and not v_live)
     or (not v_manage and not v_live) then
    return null;
  end if;
  if v_key is null or v_board_key is null or v_expires is null then
    return null;
  end if;

  select count(*)::integer into v_count
    from public.matches m
    join public.vessel_availability va on va.id = m.vessel_avail_id
    join public.vessels v on v.id = va.vessel_id
   where m.cargo_id = c.id
     and market_private.vessel_is_market_live(va.id);

  return jsonb_build_object(
    'id', v_key,
    'listing_key', v_key,
    'board_listing_key', v_board_key,
    'listing_type', 'cargo',
    'is_owned', v_owned,
    'can_manage', v_manage,
    'owned_listing_id', case when v_manage then c.id else null end,
    'expires_at', v_expires,
    'match_count', v_count,
    'ref', c.ref,
    'status', c.status,
    'review_status', c.review_status,
    'goes_live_at', c.goes_live_at,
    'cargo_type', c.cargo_type,
    'commodity_name', c.commodity_name,
    'is_dg_cargo', c.is_dg_cargo,
    'is_grain_cargo', c.is_grain_cargo,
    'qty_min_mt', c.qty_min_mt,
    'qty_max_mt', c.qty_max_mt,
    'stowage_factor', c.stowage_factor,
    'volume_cbm', c.volume_cbm,
    'load_port_locode', c.load_port_locode,
    'load_port_name', c.load_port_name,
    'load_zone', c.load_zone,
    'load_country', c.load_country,
    'disch_port_locode', c.disch_port_locode,
    'disch_port_name', c.disch_port_name,
    'disch_zone', c.disch_zone,
    'disch_country', c.disch_country,
    'load_port_scope', c.load_port_scope,
    'disch_port_scope', c.disch_port_scope,
    'load_ref_locode', c.load_ref_locode,
    'disch_ref_locode', c.disch_ref_locode,
    'load_ports', c.load_ports,
    'disch_ports', c.disch_ports
  ) || jsonb_build_object(
    'laycan_from', c.laycan_from,
    'laycan_to', c.laycan_to,
    'is_spot', c.is_spot,
    'nor_clause', c.nor_clause,
    'load_rate', c.load_rate,
    'disch_rate', c.disch_rate,
    'load_terms', c.load_terms,
    'laytime_structure', c.laytime_structure,
    'freight_idea_usd_mt', c.freight_idea_usd_mt,
    'commission_pct', c.commission_pct,
    'commission_ttl_pct', c.commission_ttl_pct,
    'demurrage_rate', c.demurrage_rate,
    'despatch_rate', c.despatch_rate,
    'requires_geared', c.requires_geared,
    'max_vessel_age_yr', c.max_vessel_age_yr,
    'max_loa_m', c.max_loa_m,
    'max_draft_m', c.max_draft_m,
    'broker', case when v_manage then c.broker else null end,
    'created_at', c.created_at,
    'updated_at', c.updated_at,
    'refreshed_at', c.refreshed_at,
    'poster', public.fn_market_poster('cargo', c.id),
    'fit', p_fit
  );
end;
$function$;
revoke all on function market_private.cargo_payload_preissued(
  uuid, text, uuid, uuid, uuid, timestamptz, jsonb
) from public, anon, authenticated, service_role;

-- Compatibility wrapper for the historical private call shape.  It validates
-- visibility first, obtains every needed key in one ordered bulk operation,
-- then delegates to the retained one-row path. Bulk APIs use the query-free
-- renderer above; M27 proves both paths produce exactly the same JSON.
create or replace function public.fn_market_cargo_payload(
  p_actor uuid,
  p_purpose text,
  p_cargo_id uuid,
  p_existing_key uuid,
  p_fit jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  c public.cargo_listings%rowtype;
  v_owned boolean;
  v_manage boolean;
  v_live boolean;
  v_key uuid;
  v_board_key uuid;
  v_expires timestamptz;
  r record;
begin
  if p_purpose not in ('cargo_board', 'cargo_match') then
    raise exception 'MARKET_VALIDATION: invalid cargo handle purpose'
      using errcode = '22023';
  end if;

  select * into c from public.cargo_listings x where x.id = p_cargo_id;
  if c.id is null then return null; end if;
  v_owned := public.fn_market_owns_listing(p_actor, 'cargo', c.id);
  v_manage := v_owned or public.fn_is_admin();
  v_live := market_private.cargo_is_market_live(c.id);
  if (p_purpose = 'cargo_match' and not v_live)
     or (not v_manage and not v_live) then
    return null;
  end if;

  if p_existing_key is not null and not exists (
    select 1 from market_private.listing_handles h
     where h.key = p_existing_key
       and h.actor_user_id = p_actor
       and h.purpose = p_purpose
       and h.listing_type = 'cargo'
       and h.listing_id = c.id
       and h.expires_at > now()
  ) then
    return null;
  end if;

  for r in
    select *
      from market_private.issue_listing_handles_bulk(
        p_actor,
        case when p_purpose = 'cargo_match'
          then array['cargo', 'cargo']::text[]
          else array['cargo']::text[] end,
        case when p_purpose = 'cargo_match'
          then array['cargo_match', 'cargo_board']::text[]
          else array['cargo_board']::text[] end,
        case when p_purpose = 'cargo_match'
          then array[c.id, c.id]::uuid[]
          else array[c.id]::uuid[] end
      )
  loop
    if r.purpose = p_purpose then
      v_key := r.key;
      v_expires := r.expires_at;
    end if;
    if r.purpose = 'cargo_board' then
      v_board_key := r.key;
    end if;
  end loop;

  if p_existing_key is not null and v_key is distinct from p_existing_key then
    return null;
  end if;

  return market_private.cargo_payload_preissued(
    p_actor, p_purpose, c.id, v_key, v_board_key, v_expires, p_fit
  );
end;
$function$;
revoke all on function public.fn_market_cargo_payload(uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Ownership and commercial-management identity is management data, not a
-- market-board field.  Resolve the display-only organisation facts behind a
-- private helper and attach them only after fn_market_vessel_payload has
-- established exact listing ownership (or admin access).  Matching the
-- registry by the source company name also keeps this migration compatible
-- with installations that predate the optional vessel -> organisation link
-- columns.  Contact email, phone and address never enter this object.
create or replace function market_private.vessel_ownership(
  p_vessel_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v public.vessels%rowtype;
  v_json jsonb;
  v_owner_org_id uuid;
  v_manager_org_id uuid;
  v_owner public.organizations%rowtype;
  v_manager public.organizations%rowtype;
begin
  select * into v
    from public.vessels x
   where x.id = p_vessel_id;

  if v.id is null then
    return null;
  end if;

  -- Some installations already carry the optional durable org link columns;
  -- to_jsonb keeps this migration valid on the baseline that does not. Prefer
  -- a durable link when present, then fall back to the lossless company-name
  -- association used by the original registry migration.
  v_json := to_jsonb(v);
  v_owner_org_id := nullif(v_json->>'owner_org_id', '')::uuid;
  v_manager_org_id := nullif(v_json->>'manager_org_id', '')::uuid;

  if v_owner_org_id is not null
     or nullif(btrim(v.owner_company), '') is not null then
    select * into v_owner
      from public.organizations o
     where o.id = v_owner_org_id
        or upper(btrim(o.name)) = upper(btrim(v.owner_company))
     order by (o.id = v_owner_org_id) desc, o.created_at, o.id
     limit 1;
  end if;

  if v_manager_org_id is not null
     or nullif(btrim(v.manager_company), '') is not null then
    select * into v_manager
      from public.organizations o
     where o.id = v_manager_org_id
        or upper(btrim(o.name)) = upper(btrim(v.manager_company))
     order by (o.id = v_manager_org_id) desc, o.created_at, o.id
     limit 1;
  end if;

  return jsonb_build_object(
    'owner_company', v.owner_company,
    'owner_org_name', v_owner.name,
    'owner_org_imo', v_owner.imo,
    'owner_org_country', coalesce(v_owner.country, v.owner_country),
    'owner_org_fleet', v_owner.fleet_total,
    'owner_org_desk', v_owner.desk_contact_name,
    'manager_company', v.manager_company,
    'manager_org_name', v_manager.name,
    'manager_org_country', coalesce(v_manager.country, v.manager_country),
    'manager_org_fleet', v_manager.fleet_total,
    'manager_org_desk', v_manager.desk_contact_name
  );
end;
$function$;
revoke all on function market_private.vessel_ownership(uuid)
  from public, anon, authenticated, service_role;

create or replace function market_private.render_vessel_payload(
  p_availability public.vessel_availability,
  p_vessel public.vessels,
  p_purpose text,
  p_key uuid,
  p_board_key uuid,
  p_expires timestamptz,
  p_owned boolean,
  p_manage boolean,
  p_count integer,
  p_poster jsonb,
  p_ownership jsonb,
  p_fit jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_mask_tbn boolean := coalesce(p_vessel.is_tbn, false)
                        and not coalesce(p_manage, false);
begin
  if p_availability.id is null or p_vessel.id is null
     or p_purpose not in ('vessel_board', 'vessel_match')
     or p_key is null or p_board_key is null or p_expires is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', p_key,
    'listing_key', p_key,
    'board_listing_key', p_board_key,
    'listing_type', 'vessel_availability',
    'is_owned', coalesce(p_owned, false),
    'can_manage', coalesce(p_manage, false),
    'owned_listing_id', case when p_manage then p_availability.id else null end,
    'expires_at', p_expires,
    'match_count', coalesce(p_count, 0),
    'ref', p_availability.ref,
    'open_port_locode', p_availability.open_port_locode,
    'open_port_name', p_availability.open_port_name,
    'open_zone', p_availability.open_zone,
    'open_date', p_availability.open_date,
    'open_date_range_days', p_availability.open_date_range_days,
    'last_cargo', p_availability.last_cargo,
    'service_speed_kn', p_availability.service_speed_kn,
    'me_consumption_mt_day', p_availability.me_consumption_mt_day,
    'me_consumption_port_mt_day', p_availability.me_consumption_port_mt_day,
    'aux_consumption_mt_day', p_availability.aux_consumption_mt_day,
    'aux_consumption_port_mt_day', p_availability.aux_consumption_port_mt_day,
    'vlsfo_sea_mt_day', p_availability.vlsfo_sea_mt_day,
    'vlsfo_port_mt_day', p_availability.vlsfo_port_mt_day,
    'lsmgo_sea_mt_day', p_availability.lsmgo_sea_mt_day,
    'lsmgo_port_mt_day', p_availability.lsmgo_port_mt_day,
    'fuel_type', p_availability.fuel_type,
    'freight_idea_usd_mt', p_availability.freight_idea_usd_mt,
    'accepts_part_cargo', p_availability.accepts_part_cargo,
    'status', p_availability.status,
    'review_status', p_availability.review_status,
    'goes_live_at', p_availability.goes_live_at,
    'created_at', p_availability.created_at,
    'updated_at', p_availability.updated_at,
    'refreshed_at', p_availability.refreshed_at,
    'vessel', jsonb_build_object(
      'id', case when p_manage then p_vessel.id else null end,
      'vessel_name', case when v_mask_tbn then 'TBN' else p_vessel.vessel_name end,
      'imo_number', case when v_mask_tbn then null else p_vessel.imo_number end,
      'vessel_type', p_vessel.vessel_type,
      'dwt_grain', p_vessel.dwt_grain,
      'dwt_bale', p_vessel.dwt_bale,
      'grain_cbm', p_vessel.grain_cbm,
      'bale_cbm', p_vessel.bale_cbm,
      'gross_tonnage', p_vessel.gross_tonnage,
      'scnrt', p_vessel.scnrt,
      'build_year', p_vessel.build_year,
      'flag', p_vessel.flag,
      'scope', p_vessel.scope,
      'risk_level', p_vessel.risk_level,
      'is_geared', p_vessel.is_geared,
      'grain_certified', p_vessel.grain_certified,
      'dg_certified', p_vessel.dg_certified,
      'max_loa_m', p_vessel.max_loa_m,
      'max_draft_m', p_vessel.max_draft_m,
      'beam_m', p_vessel.beam_m,
      'preferred_zones', p_vessel.preferred_zones,
      'is_tbn', p_vessel.is_tbn,
      'is_verified', p_vessel.is_verified
    ),
    'poster', case when v_mask_tbn then null else p_poster end,
    'ownership', case when p_manage then p_ownership else null end,
    'fit', p_fit
  );
end;
$function$;
revoke all on function market_private.render_vessel_payload(
  public.vessel_availability, public.vessels, text, uuid, uuid,
  timestamptz, boolean, boolean, integer, jsonb, jsonb, jsonb
) from public, anon, authenticated, service_role;

create or replace function market_private.vessel_payload_preissued(
  p_actor uuid,
  p_purpose text,
  p_availability_id uuid,
  p_key uuid,
  p_board_key uuid,
  p_expires timestamptz,
  p_fit jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  a public.vessel_availability%rowtype;
  v public.vessels%rowtype;
  v_owned boolean;
  v_manage boolean;
  v_live boolean;
  v_mask_tbn boolean;
  v_key uuid := p_key;
  v_board_key uuid := p_board_key;
  v_expires timestamptz := p_expires;
  v_count integer := 0;
begin
  if p_purpose not in ('vessel_board', 'vessel_match') then
    raise exception 'MARKET_VALIDATION: invalid vessel handle purpose'
      using errcode = '22023';
  end if;

  select * into a from public.vessel_availability x where x.id = p_availability_id;
  if a.id is null then return null; end if;
  select * into v from public.vessels x where x.id = a.vessel_id;
  if v.id is null then return null; end if;

  v_owned := public.fn_market_owns_listing(p_actor, 'vessel_availability', a.id);
  v_manage := v_owned or public.fn_is_admin();
  v_live := market_private.vessel_is_market_live(a.id);
  if (p_purpose = 'vessel_match' and not v_live)
     or (not v_manage and not v_live) then
    return null;
  end if;
  v_mask_tbn := coalesce(v.is_tbn, false) and not v_manage;
  if v_key is null or v_board_key is null or v_expires is null then
    return null;
  end if;

  select count(*)::integer into v_count
    from public.matches m
    join public.cargo_listings c on c.id = m.cargo_id
   where m.vessel_avail_id = a.id
     and market_private.cargo_is_market_live(c.id);

  return jsonb_build_object(
    'id', v_key,
    'listing_key', v_key,
    'board_listing_key', v_board_key,
    'listing_type', 'vessel_availability',
    'is_owned', v_owned,
    'can_manage', v_manage,
    'owned_listing_id', case when v_manage then a.id else null end,
    'expires_at', v_expires,
    'match_count', v_count,
    'ref', a.ref,
    'open_port_locode', a.open_port_locode,
    'open_port_name', a.open_port_name,
    'open_zone', a.open_zone,
    'open_date', a.open_date,
    'open_date_range_days', a.open_date_range_days,
    'last_cargo', a.last_cargo,
    'service_speed_kn', a.service_speed_kn,
    'me_consumption_mt_day', a.me_consumption_mt_day,
    'me_consumption_port_mt_day', a.me_consumption_port_mt_day,
    'aux_consumption_mt_day', a.aux_consumption_mt_day,
    'aux_consumption_port_mt_day', a.aux_consumption_port_mt_day,
    'vlsfo_sea_mt_day', a.vlsfo_sea_mt_day,
    'vlsfo_port_mt_day', a.vlsfo_port_mt_day,
    'lsmgo_sea_mt_day', a.lsmgo_sea_mt_day,
    'lsmgo_port_mt_day', a.lsmgo_port_mt_day,
    'fuel_type', a.fuel_type,
    'freight_idea_usd_mt', a.freight_idea_usd_mt,
    'accepts_part_cargo', a.accepts_part_cargo,
    'status', a.status,
    'review_status', a.review_status,
    'goes_live_at', a.goes_live_at,
    'created_at', a.created_at,
    'updated_at', a.updated_at,
    'refreshed_at', a.refreshed_at,
    'vessel', jsonb_build_object(
      'id', case when v_manage then v.id else null end,
      'vessel_name', case when v_mask_tbn then 'TBN' else v.vessel_name end,
      'imo_number', case when v_mask_tbn then null else v.imo_number end,
      'vessel_type', v.vessel_type,
      'dwt_grain', v.dwt_grain,
      'dwt_bale', v.dwt_bale,
      'grain_cbm', v.grain_cbm,
      'bale_cbm', v.bale_cbm,
      'gross_tonnage', v.gross_tonnage,
      'scnrt', v.scnrt,
      'build_year', v.build_year,
      'flag', v.flag,
      'scope', v.scope,
      'risk_level', v.risk_level,
      'is_geared', v.is_geared,
      'grain_certified', v.grain_certified,
      'dg_certified', v.dg_certified,
      'max_loa_m', v.max_loa_m,
      'max_draft_m', v.max_draft_m,
      'beam_m', v.beam_m,
      'preferred_zones', v.preferred_zones,
      'is_tbn', v.is_tbn,
      'is_verified', v.is_verified
    ),
    -- A TBN poster can identify the hidden operator just as effectively as the
    -- hull name.  Return JSON null; the UI supplies a generic brokered label.
    'poster', case when v_mask_tbn then null else public.fn_market_poster('vessel_availability', a.id) end,
    'ownership', case
      when v_manage then market_private.vessel_ownership(v.id)
      else null
    end,
    'fit', p_fit
  );
end;
$function$;
revoke all on function market_private.vessel_payload_preissued(
  uuid, text, uuid, uuid, uuid, timestamptz, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.fn_market_vessel_payload(
  p_actor uuid,
  p_purpose text,
  p_availability_id uuid,
  p_existing_key uuid,
  p_fit jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  a public.vessel_availability%rowtype;
  v public.vessels%rowtype;
  v_owned boolean;
  v_manage boolean;
  v_live boolean;
  v_key uuid;
  v_board_key uuid;
  v_expires timestamptz;
  r record;
begin
  if p_purpose not in ('vessel_board', 'vessel_match') then
    raise exception 'MARKET_VALIDATION: invalid vessel handle purpose'
      using errcode = '22023';
  end if;

  select * into a from public.vessel_availability x where x.id = p_availability_id;
  if a.id is null then return null; end if;
  select * into v from public.vessels x where x.id = a.vessel_id;
  if v.id is null then return null; end if;
  v_owned := public.fn_market_owns_listing(
    p_actor, 'vessel_availability', a.id
  );
  v_manage := v_owned or public.fn_is_admin();
  v_live := market_private.vessel_is_market_live(a.id);
  if (p_purpose = 'vessel_match' and not v_live)
     or (not v_manage and not v_live) then
    return null;
  end if;

  if p_existing_key is not null and not exists (
    select 1 from market_private.listing_handles h
     where h.key = p_existing_key
       and h.actor_user_id = p_actor
       and h.purpose = p_purpose
       and h.listing_type = 'vessel_availability'
       and h.listing_id = a.id
       and h.expires_at > now()
  ) then
    return null;
  end if;

  for r in
    select *
      from market_private.issue_listing_handles_bulk(
        p_actor,
        case when p_purpose = 'vessel_match'
          then array['vessel_availability', 'vessel_availability']::text[]
          else array['vessel_availability']::text[] end,
        case when p_purpose = 'vessel_match'
          then array['vessel_match', 'vessel_board']::text[]
          else array['vessel_board']::text[] end,
        case when p_purpose = 'vessel_match'
          then array[a.id, a.id]::uuid[]
          else array[a.id]::uuid[] end
      )
  loop
    if r.purpose = p_purpose then
      v_key := r.key;
      v_expires := r.expires_at;
    end if;
    if r.purpose = 'vessel_board' then
      v_board_key := r.key;
    end if;
  end loop;

  if p_existing_key is not null and v_key is distinct from p_existing_key then
    return null;
  end if;

  return market_private.vessel_payload_preissued(
    p_actor, p_purpose, a.id, v_key, v_board_key, v_expires, p_fit
  );
end;
$function$;
revoke all on function public.fn_market_vessel_payload(uuid, text, uuid, uuid, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.list_market_cargo(
  p_archive_cutoff date default null,
  p_spot_active_from date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_admin boolean := public.fn_is_admin();
  v_context record;
  v_out jsonb;
begin
  select * into v_context
    from market_private.market_request_context(
      v_actor, p_spot_active_from, null
    );

  with candidates as materialized (
    select c.id, c.created_at, c as listing_row
      from public.cargo_listings c
     where c.review_status = 'APPROVED'
       and c.status in ('IN', 'PARTIAL')
       and (
         c.refreshed_at >= v_context.fresh_after
         or (
           v_context.laycan_exception
           and c.laycan_to is not null
           and c.laycan_to >= current_date
         )
       )
       and (
         p_archive_cutoff is null
         or coalesce(c.is_spot, false)
         or c.laycan_from >= p_archive_cutoff
         or (c.laycan_from is null and c.created_at::date >= p_archive_cutoff)
       )
       and (
         not coalesce(c.is_spot, false)
         or c.created_at::date >= v_context.cargo_active_from
       )
     order by c.created_at desc, c.id
     limit 1000
  ),
  args as materialized (
    select coalesce(array_agg('cargo'::text), array[]::text[]) as listing_types,
           coalesce(array_agg('cargo_board'::text), array[]::text[]) as purposes,
           coalesce(array_agg(c.id), array[]::uuid[]) as listing_ids
      from candidates c
  ),
  issued as materialized (
    select h.*
      from args a
      cross join lateral market_private.issue_listing_handles_bulk(
        v_actor, a.listing_types, a.purposes, a.listing_ids
      ) h
  ),
  metadata as materialized (
    select m.*
      from args a
      cross join lateral market_private.market_listing_metadata(
        v_actor, 'cargo', a.listing_ids, v_admin
      ) m
  ),
  counts as materialized (
    select n.*
      from args a
      cross join lateral market_private.market_match_counts(
        'cargo', a.listing_ids,
        v_context.fresh_after,
        v_context.laycan_exception,
        v_context.cargo_active_from,
        v_context.vessel_active_from
      ) n
  ),
  payloads as materialized (
    select c.id, c.created_at,
           market_private.render_cargo_payload(
             c.listing_row, 'cargo_board',
             h.key, h.key, h.expires_at,
             m.is_owned, m.can_manage,
             coalesce(n.match_count, 0), m.poster, null
           ) as payload
      from candidates c
      join issued h
        on h.listing_type = 'cargo'
       and h.purpose = 'cargo_board'
       and h.listing_id = c.id
      join metadata m on m.listing_id = c.id
      left join counts n on n.listing_id = c.id
  )
  select coalesce(
           jsonb_agg(x.payload order by x.created_at desc, x.id),
           '[]'::jsonb
         )
    into v_out
    from payloads x
   where x.payload is not null;

  perform market_private.purge_listing_handles(1000);
  return v_out;
end;
$function$;

create or replace function public.list_market_vessels(
  p_archive_cutoff date default null,
  p_vessel_active_from date default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_admin boolean := public.fn_is_admin();
  v_context record;
  v_out jsonb;
begin
  select * into v_context
    from market_private.market_request_context(
      v_actor, null, p_vessel_active_from
    );

  with candidates as materialized (
    select a.id, a.open_date, a.created_at,
           a as availability_row, v as vessel_row
      from public.vessel_availability a
      join public.vessels v on v.id = a.vessel_id
     where a.review_status = 'APPROVED'
       and a.status = 'OPEN'
       and not v.is_sanctioned
       and (
         a.refreshed_at >= v_context.fresh_after
         or (
           v_context.laycan_exception
           and a.open_date is not null
           and a.open_date >= current_date
         )
       )
       and (
         p_archive_cutoff is null
         or a.open_date is null
         or a.open_date >= p_archive_cutoff
       )
       and (
         a.open_date is not null
         or a.created_at::date >= v_context.vessel_active_from
       )
     order by a.open_date nulls last, a.created_at desc, a.id
     limit 500
  ),
  args as materialized (
    select coalesce(
             array_agg('vessel_availability'::text), array[]::text[]
           ) as listing_types,
           coalesce(array_agg('vessel_board'::text), array[]::text[]) as purposes,
           coalesce(array_agg(c.id), array[]::uuid[]) as listing_ids
      from candidates c
  ),
  issued as materialized (
    select h.*
      from args a
      cross join lateral market_private.issue_listing_handles_bulk(
        v_actor, a.listing_types, a.purposes, a.listing_ids
      ) h
  ),
  metadata as materialized (
    select m.*
      from args a
      cross join lateral market_private.market_listing_metadata(
        v_actor, 'vessel_availability', a.listing_ids, v_admin
      ) m
  ),
  counts as materialized (
    select n.*
      from args a
      cross join lateral market_private.market_match_counts(
        'vessel_availability', a.listing_ids,
        v_context.fresh_after,
        v_context.laycan_exception,
        v_context.cargo_active_from,
        v_context.vessel_active_from
      ) n
  ),
  payloads as materialized (
    select c.id, c.open_date, c.created_at,
           market_private.render_vessel_payload(
             c.availability_row, c.vessel_row, 'vessel_board',
             h.key, h.key, h.expires_at,
             m.is_owned, m.can_manage,
             coalesce(n.match_count, 0), m.poster,
             m.management_ownership,
             null
           ) as payload
      from candidates c
      join issued h
        on h.listing_type = 'vessel_availability'
       and h.purpose = 'vessel_board'
       and h.listing_id = c.id
      join metadata m on m.listing_id = c.id
      left join counts n on n.listing_id = c.id
  )
  select coalesce(
           jsonb_agg(
             x.payload order by x.open_date nulls last, x.created_at desc, x.id
           ),
           '[]'::jsonb
         )
    into v_out
    from payloads x
   where x.payload is not null;

  perform market_private.purge_listing_handles(1000);
  return v_out;
end;
$function$;

create or replace function public.list_market_matches(p_listing_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_admin boolean := public.fn_is_admin();
  v_context record;
  h record;
  v_out jsonb;
  v_refreshed_source uuid;
begin
  select * into v_context
    from market_private.market_request_context(v_actor, null, null);

  select * into h
    from market_private.peek_listing_handle(v_actor, p_listing_key);

  -- Match drill-down starts only from a board key. Match-purpose keys are
  -- detail keys for their counterpart and cannot recursively become a source.
  if not (
    (h.purpose = 'cargo_board' and h.listing_type = 'cargo')
    or (
      h.purpose = 'vessel_board'
      and h.listing_type = 'vessel_availability'
    )
  ) then
    raise exception 'MARKET_NOT_FOUND: listing key was not found'
      using errcode = 'P0002';
  end if;

  if h.purpose = 'cargo_board' then
    -- Ownership never bypasses match-source governance: the source must still
    -- be approved, live, fresh and (for a vessel source) non-sanctioned.
    if not market_private.cargo_is_market_live(h.listing_id) then
      raise exception 'MARKET_NOT_FOUND: listing is no longer available'
        using errcode = 'P0002';
    end if;

    with candidates as materialized (
      select m.availability_id,
             m.is_rate_aligned as rate_aligned,
             m.dwt_delta,
             m.open_zone,
             m.accepts_part_cargo,
             c.load_zone,
             c.is_spot,
             c.is_grain_cargo,
             c.is_dg_cargo,
             c.requires_geared,
             a as availability_row,
             v as vessel_row
        from public.get_matches_for_cargo(h.listing_id) m
        join public.cargo_listings c on c.id = h.listing_id
        join public.vessel_availability a on a.id = m.availability_id
        join public.vessels v on v.id = a.vessel_id
       where a.review_status = 'APPROVED'
         and a.status = 'OPEN'
         and not v.is_sanctioned
         and (
           a.refreshed_at >= v_context.fresh_after
           or (
             v_context.laycan_exception
             and a.open_date is not null
             and a.open_date >= current_date
           )
         )
         and (
           a.open_date is not null
           or a.created_at::date >= v_context.vessel_active_from
         )
       order by m.is_rate_aligned desc, m.dwt_delta, m.availability_id
       limit 500
    ),
    requests as materialized (
      select 'cargo'::text as listing_type,
             'cargo_board'::text as purpose,
             h.listing_id::uuid as listing_id
      union all
      select 'vessel_availability', 'vessel_match', c.availability_id
        from candidates c
      union all
      select 'vessel_availability', 'vessel_board', c.availability_id
        from candidates c
    ),
    args as materialized (
      select array_agg(r.listing_type) as listing_types,
             array_agg(r.purpose) as purposes,
             array_agg(r.listing_id) as listing_ids
        from requests r
    ),
    issued as materialized (
      select ih.*
        from args a
        cross join lateral market_private.issue_listing_handles_bulk(
          v_actor, a.listing_types, a.purposes, a.listing_ids
        ) ih
    ),
    target_args as materialized (
      select coalesce(array_agg(c.availability_id), array[]::uuid[])
             as listing_ids
        from candidates c
    ),
    metadata as materialized (
      select mm.*
        from target_args a
        cross join lateral market_private.market_listing_metadata(
          v_actor, 'vessel_availability', a.listing_ids, v_admin
        ) mm
    ),
    counts as materialized (
      select n.*
        from target_args a
        cross join lateral market_private.market_match_counts(
          'vessel_availability', a.listing_ids,
          v_context.fresh_after,
          v_context.laycan_exception,
          v_context.cargo_active_from,
          v_context.vessel_active_from
        ) n
    ),
    payloads as materialized (
      select c.availability_id,
             c.rate_aligned,
             c.dwt_delta,
             market_private.render_vessel_payload(
               c.availability_row,
               c.vessel_row,
               'vessel_match', hm.key, hb.key, hm.expires_at,
               mm.is_owned, mm.can_manage,
               coalesce(n.match_count, 0), mm.poster,
               mm.management_ownership,
               jsonb_build_object(
                 'rate_aligned', c.rate_aligned,
                 'dwt_delta', c.dwt_delta,
                 'zone', case when c.open_zone = c.load_zone::text
                              then 'load' else 'discharge' end,
                 'laycan', case when c.is_spot then 'spot' else 'window' end,
                 'grain', c.is_grain_cargo,
                 'dg', c.is_dg_cargo,
                 'gear_required', coalesce(c.requires_geared, false),
                 'part_cargo', c.accepts_part_cargo
               )
             ) as payload
        from candidates c
        join issued hm
          on hm.listing_type = 'vessel_availability'
         and hm.purpose = 'vessel_match'
         and hm.listing_id = c.availability_id
        join issued hb
          on hb.listing_type = 'vessel_availability'
         and hb.purpose = 'vessel_board'
         and hb.listing_id = c.availability_id
        join metadata mm on mm.listing_id = c.availability_id
        left join counts n on n.listing_id = c.availability_id
    )
    select coalesce(
             jsonb_agg(
               x.payload order by
                 x.rate_aligned desc, x.dwt_delta, x.availability_id
             ) filter (where x.payload is not null),
             '[]'::jsonb
           ),
           (
             select ih.key
               from issued ih
              where ih.listing_type = 'cargo'
                and ih.purpose = 'cargo_board'
                and ih.listing_id = h.listing_id
           )
      into v_out, v_refreshed_source
      from payloads x;
  elsif h.purpose = 'vessel_board' then
    if not market_private.vessel_is_market_live(h.listing_id) then
      raise exception 'MARKET_NOT_FOUND: listing is no longer available'
        using errcode = 'P0002';
    end if;

    with candidates as materialized (
      select m.cargo_id,
             m.is_rate_aligned as rate_aligned,
             m.dwt_delta,
             m.load_zone,
             m.is_spot,
             m.is_grain_cargo,
             m.is_dg_cargo,
             m.requires_geared,
             a.open_zone,
             a.accepts_part_cargo,
             c as cargo_row
        from public.get_matches_for_availability(h.listing_id) m
        join public.vessel_availability a on a.id = h.listing_id
        join public.cargo_listings c on c.id = m.cargo_id
       where c.review_status = 'APPROVED'
         and c.status in ('IN', 'PARTIAL')
         and (
           c.refreshed_at >= v_context.fresh_after
           or (
             v_context.laycan_exception
             and c.laycan_to is not null
             and c.laycan_to >= current_date
           )
         )
         and (
           not coalesce(c.is_spot, false)
           or c.created_at::date >= v_context.cargo_active_from
         )
       order by m.is_rate_aligned desc, m.dwt_delta, m.cargo_id
       limit 500
    ),
    requests as materialized (
      select 'vessel_availability'::text as listing_type,
             'vessel_board'::text as purpose,
             h.listing_id::uuid as listing_id
      union all
      select 'cargo', 'cargo_match', c.cargo_id
        from candidates c
      union all
      select 'cargo', 'cargo_board', c.cargo_id
        from candidates c
    ),
    args as materialized (
      select array_agg(r.listing_type) as listing_types,
             array_agg(r.purpose) as purposes,
             array_agg(r.listing_id) as listing_ids
        from requests r
    ),
    issued as materialized (
      select ih.*
        from args a
        cross join lateral market_private.issue_listing_handles_bulk(
          v_actor, a.listing_types, a.purposes, a.listing_ids
        ) ih
    ),
    target_args as materialized (
      select coalesce(array_agg(c.cargo_id), array[]::uuid[]) as listing_ids
        from candidates c
    ),
    metadata as materialized (
      select mm.*
        from target_args a
        cross join lateral market_private.market_listing_metadata(
          v_actor, 'cargo', a.listing_ids, v_admin
        ) mm
    ),
    counts as materialized (
      select n.*
        from target_args a
        cross join lateral market_private.market_match_counts(
          'cargo', a.listing_ids,
          v_context.fresh_after,
          v_context.laycan_exception,
          v_context.cargo_active_from,
          v_context.vessel_active_from
        ) n
    ),
    payloads as materialized (
      select c.cargo_id,
             c.rate_aligned,
             c.dwt_delta,
             market_private.render_cargo_payload(
               c.cargo_row,
               'cargo_match', hm.key, hb.key, hm.expires_at,
               mm.is_owned, mm.can_manage,
               coalesce(n.match_count, 0), mm.poster,
               jsonb_build_object(
                 'rate_aligned', c.rate_aligned,
                 'dwt_delta', c.dwt_delta,
                 'zone', case when c.open_zone::text = c.load_zone
                              then 'load' else 'discharge' end,
                 'laycan', case when c.is_spot then 'spot' else 'window' end,
                 'grain', c.is_grain_cargo,
                 'dg', c.is_dg_cargo,
                 'gear_required', coalesce(c.requires_geared, false),
                 'part_cargo', c.accepts_part_cargo
               )
             ) as payload
        from candidates c
        join issued hm
          on hm.listing_type = 'cargo'
         and hm.purpose = 'cargo_match'
         and hm.listing_id = c.cargo_id
        join issued hb
          on hb.listing_type = 'cargo'
         and hb.purpose = 'cargo_board'
         and hb.listing_id = c.cargo_id
        join metadata mm on mm.listing_id = c.cargo_id
        left join counts n on n.listing_id = c.cargo_id
    )
    select coalesce(
             jsonb_agg(
               x.payload order by
                 x.rate_aligned desc, x.dwt_delta, x.cargo_id
             ) filter (where x.payload is not null),
             '[]'::jsonb
           ),
           (
             select ih.key
               from issued ih
              where ih.listing_type = 'vessel_availability'
                and ih.purpose = 'vessel_board'
                and ih.listing_id = h.listing_id
           )
      into v_out, v_refreshed_source
      from payloads x;
  else
    raise exception 'MARKET_NOT_FOUND: listing key was not found'
      using errcode = 'P0002';
  end if;

  if v_refreshed_source is distinct from p_listing_key then
    raise exception 'MARKET_NOT_FOUND: listing key was not found'
      using errcode = 'P0002';
  end if;

  perform market_private.purge_listing_handles(1000);
  return v_out;
end;
$function$;

create or replace function public.get_market_listing_detail(p_listing_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  h record;
  r record;
  v_out jsonb;
  v_key uuid;
  v_board_key uuid;
  v_expires timestamptz;
begin
  select * into h
    from market_private.peek_listing_handle(v_actor, p_listing_key);

  for r in
    select *
      from market_private.issue_listing_handles_bulk(
        v_actor,
        case h.purpose
          when 'cargo_match' then array['cargo', 'cargo']::text[]
          when 'vessel_match' then
            array['vessel_availability', 'vessel_availability']::text[]
          else array[h.listing_type]::text[]
        end,
        case h.purpose
          when 'cargo_match' then array['cargo_match', 'cargo_board']::text[]
          when 'vessel_match' then
            array['vessel_match', 'vessel_board']::text[]
          else array[h.purpose]::text[]
        end,
        case h.purpose
          when 'cargo_match' then array[h.listing_id, h.listing_id]::uuid[]
          when 'vessel_match' then array[h.listing_id, h.listing_id]::uuid[]
          else array[h.listing_id]::uuid[]
        end
      )
  loop
    if r.purpose = h.purpose then
      v_key := r.key;
      v_expires := r.expires_at;
    end if;
    if r.purpose in ('cargo_board', 'vessel_board') then
      v_board_key := r.key;
    end if;
  end loop;

  if v_key is distinct from p_listing_key then
    raise exception 'MARKET_NOT_FOUND: listing key was not found'
      using errcode = 'P0002';
  end if;

  if h.listing_type = 'cargo' then
    v_out := market_private.cargo_payload_preissued(
      v_actor, h.purpose, h.listing_id,
      v_key, v_board_key, v_expires, null
    );
  elsif h.listing_type = 'vessel_availability' then
    v_out := market_private.vessel_payload_preissued(
      v_actor, h.purpose, h.listing_id,
      v_key, v_board_key, v_expires, null
    );
  end if;
  if v_out is null then
    raise exception 'MARKET_NOT_FOUND: listing is no longer available'
      using errcode = 'P0002';
  end if;
  perform market_private.purge_listing_handles(1000);
  return v_out;
end;
$function$;

-- Raw identifiers belong on management surfaces only. These RPCs replace the
-- client-side listing_ownership -> base-table joins that Stage 2 closes.
create or replace function public.list_my_cargo()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_out jsonb;
begin
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
    into v_out
    from public.cargo_listings c
   where public.fn_market_owns_listing(v_actor, 'cargo', c.id);
  return v_out;
end;
$function$;

create or replace function public.list_my_vessels()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_out jsonb;
begin
  select coalesce(
           jsonb_agg(
             to_jsonb(a) || jsonb_build_object('vessel', to_jsonb(v))
             order by a.created_at desc
           ),
           '[]'::jsonb
         )
    into v_out
    from public.vessel_availability a
    join public.vessels v on v.id = a.vessel_id
   where public.fn_market_owns_listing(
           v_actor, 'vessel_availability', a.id
         );
  return v_out;
end;
$function$;

create or replace function public.get_managed_vessel(p_vessel_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_out jsonb;
  v_allowed boolean;
begin
  select public.fn_is_admin()
         or exists (
           select 1
             from public.vessel_claims vc
            where vc.vessel_id = p_vessel_id
              and vc.user_id in (auth.uid(), v_actor)
         )
         or exists (
           select 1
             from public.vessel_availability a
            where a.vessel_id = p_vessel_id
              and public.fn_market_owns_listing(
                    v_actor, 'vessel_availability', a.id
                  )
         )
    into v_allowed;

  if not coalesce(v_allowed, false) then
    raise exception 'MARKET_NOT_FOUND: managed vessel was not found'
      using errcode = 'P0002';
  end if;

  select to_jsonb(v)
    into v_out
    from public.vessels v
   where v.id = p_vessel_id;
  if v_out is null then
    raise exception 'MARKET_NOT_FOUND: managed vessel was not found'
      using errcode = 'P0002';
  end if;
  return v_out;
end;
$function$;

create or replace function public.set_market_vessel_availability_status(
  p_availability_id uuid,
  p_status public.vessel_status_enum
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_position public.vessel_availability%rowtype;
begin
  if p_status is null then
    raise exception 'MARKET_VALIDATION: vessel status is required'
      using errcode = '22023';
  end if;

  select a.*
    into v_position
    from public.vessel_availability a
   where a.id = p_availability_id
     and (
       public.fn_is_admin()
       or public.fn_market_owns_listing(
            v_actor, 'vessel_availability', a.id
          )
     )
   for update;

  if v_position.id is null then
    raise exception 'MARKET_NOT_FOUND: position was not found'
      using errcode = 'P0002';
  end if;

  -- Repeating the current state is harmless. FIXED and INACTIVE are terminal;
  -- reopening either requires an administrator-owned workflow, not this RPC.
  if v_position.status = p_status then
    return to_jsonb(v_position);
  end if;
  if not (
    (
      v_position.status::text = 'OPEN'
      and p_status::text in ('ON SUBS', 'FIXED', 'INACTIVE')
    )
    or (
      v_position.status::text = 'ON SUBS'
      and p_status::text in ('OPEN', 'FIXED', 'INACTIVE')
    )
  ) then
    raise exception 'MARKET_VALIDATION: vessel status transition is not allowed'
      using errcode = '22023';
  end if;

  update public.vessel_availability a
     set status = p_status
   where a.id = v_position.id
  returning a.* into v_position;
  return to_jsonb(v_position);
end;
$function$;

-- Legacy management helpers remain callable under their existing signatures,
-- but no longer rely on fn_my_org_ids() (which historically admitted ended or
-- pending seats). Every decision now shares the exact ownership predicate.
create or replace function public.fn_owns_cargo(p_cargo_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select public.fn_market_owns_listing(
    public.fn_market_actor(), 'cargo', p_cargo_id
  );
$function$;

create or replace function public.fn_owns_vessel(p_vessel_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
begin
  return exists (
    select 1
      from public.vessel_availability a
     where a.vessel_id = p_vessel_id
       and public.fn_market_owns_listing(
             v_actor, 'vessel_availability', a.id
           )
  );
end;
$function$;

create or replace function public.fn_position_checkin(
  p_availability_id uuid,
  p_eta_port_locode text default null::text,
  p_eta_date date default null::date,
  p_eta_time time without time zone default null::time without time zone,
  p_open_date date default null::date
)
returns timestamp with time zone
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_now timestamptz := now();
begin
  if not public.fn_is_admin()
     and not public.fn_market_owns_listing(
       v_actor, 'vessel_availability', p_availability_id
     ) then
    raise exception 'MARKET_NOT_FOUND: position was not found'
      using errcode = 'P0002';
  end if;

  update public.vessel_availability
     set eta_port_locode = coalesce(p_eta_port_locode, eta_port_locode),
         eta_date = coalesce(p_eta_date, eta_date),
         eta_time = coalesce(p_eta_time, eta_time),
         open_date = coalesce(p_open_date, open_date),
         position_confirmed_at = v_now,
         refreshed_at = v_now
   where id = p_availability_id;

  if not found then
    raise exception 'MARKET_NOT_FOUND: position was not found'
      using errcode = 'P0002';
  end if;
  return v_now;
end;
$function$;

revoke all on function public.list_market_cargo(date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.list_market_vessels(date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.list_market_matches(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_market_listing_detail(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.list_my_cargo()
  from public, anon, authenticated, service_role;
revoke all on function public.list_my_vessels()
  from public, anon, authenticated, service_role;
revoke all on function public.get_managed_vessel(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.set_market_vessel_availability_status(
  uuid, public.vessel_status_enum
) from public, anon, authenticated, service_role;
revoke all on function public.fn_owns_cargo(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_owns_vessel(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.fn_position_checkin(uuid, text, date, time without time zone, date)
  from public, anon, authenticated, service_role;

grant execute on function public.list_market_cargo(date, date) to authenticated;
grant execute on function public.list_market_vessels(date, date) to authenticated;
grant execute on function public.list_market_matches(uuid) to authenticated;
grant execute on function public.get_market_listing_detail(uuid) to authenticated;
grant execute on function public.list_my_cargo() to authenticated;
grant execute on function public.list_my_vessels() to authenticated;
grant execute on function public.get_managed_vessel(uuid) to authenticated;
grant execute on function public.set_market_vessel_availability_status(
  uuid, public.vessel_status_enum
) to authenticated;
grant execute on function public.fn_owns_cargo(uuid) to authenticated;
grant execute on function public.fn_owns_vessel(uuid) to authenticated;
grant execute on function public.fn_position_checkin(uuid, text, date, time without time zone, date)
  to authenticated;

comment on function public.list_market_cargo(date, date) is
  'Governed cargo market board. Returns a JSON array with opaque actor-bound listing keys, display-only poster data and no raw non-owned listing UUIDs.';
comment on function public.list_market_vessels(date, date) is
  'Governed tonnage market board. Returns a JSON array; every non-owned position uses an opaque key and TBN identity/poster data is masked.';
comment on function public.list_market_matches(uuid) is
  'Governed live match drill-down. Accepts only the caller''s unexpired board-purpose handle and emits separate opaque match and board counterpart handles.';
comment on function public.get_market_listing_detail(uuid) is
  'Governed listing detail. Revalidates live visibility and returns no non-owned raw listing/vessel UUID.';
comment on function public.list_my_cargo() is
  'Authenticated management feed containing only cargo rows under exact current ownership.';
comment on function public.list_my_vessels() is
  'Authenticated management feed containing only vessel positions under exact current ownership.';
comment on function public.get_managed_vessel(uuid) is
  'Full vessel row for an administrator, exact vessel claimant or exact owner of one of the vessel positions; all other callers receive MARKET_NOT_FOUND.';
comment on function public.set_market_vessel_availability_status(uuid, public.vessel_status_enum) is
  'Exact-owner/admin lifecycle command. OPEN and ON SUBS may advance or withdraw; FIXED and INACTIVE are terminal here.';

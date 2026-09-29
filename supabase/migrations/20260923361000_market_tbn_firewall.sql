-- Global market privacy firewall, stage 2: close legacy discovery bypasses.
--
-- DEPLOYMENT ORDER IS MATERIAL:
--   1. apply 20260923360000 and deploy the application cut-over;
--   2. only then apply this closure migration.
--
-- Owner/admin management remains on the base tables under exact ownership
-- policies. Named, non-sanctioned vessels remain searchable in the registry.
-- General market discovery and matching must use the governed handle RPCs.

-- Preserve the grants on legacy relations before closing them.  The DOWN file
-- restores this snapshot instead of guessing at a deployment's historical
-- ACLs.  Keeping the snapshot in the private schema also prevents it becoming
-- a discovery surface of its own.
create table if not exists market_private.legacy_relation_acl_snapshot (
  relation_name text not null,
  grantor text not null,
  grantee text not null,
  privilege_type text not null,
  is_grantable boolean not null,
  primary key (relation_name, grantor, grantee, privilege_type)
);
revoke all on table market_private.legacy_relation_acl_snapshot
  from public, anon, authenticated;
grant all on table market_private.legacy_relation_acl_snapshot to service_role;

insert into market_private.legacy_relation_acl_snapshot (
  relation_name, grantor, grantee, privilege_type, is_grantable
)
select c.relname,
       coalesce(grantor_role.rolname, pg_catalog.pg_get_userbyid(c.relowner)),
       coalesce(grantee_role.rolname, 'PUBLIC'),
       acl.privilege_type, acl.is_grantable
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 cross join lateral pg_catalog.aclexplode(c.relacl) acl
  left join pg_catalog.pg_roles grantor_role on grantor_role.oid = acl.grantor
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = acl.grantee
 where n.nspname = 'public'
   and c.relacl is not null
   and coalesce(grantee_role.rolname, 'PUBLIC') = any (
     array['PUBLIC', 'anon', 'authenticated', 'service_role']
   )
   and c.relname = any (array[
     'cargo_listings',
     'vessel_availability',
     'listing_ownership',
     'vessels',
     'vessel_claims',
     'vessel_contact_history',
     'matches',
     'v_live_cargo',
     'v_live_vessels',
     'v_cargo_match_counts',
     'v_vessel_match_counts',
     'v_vessel_detail',
     'v_vessel_flag_issues',
     'v_admin_queue',
     'v_eligible_matches'
   ])
on conflict do nothing;

-- Table-level REVOKE does not clear PostgreSQL's per-column ACLs. Snapshot
-- those independently so a historical column grant cannot remain as a raw-ID
-- bypass and DOWN can restore the deployment's exact grantor/grant-option
-- state rather than assuming the repository baseline.
create table if not exists market_private.legacy_column_acl_snapshot (
  relation_name text not null,
  column_name text not null,
  grantor text not null,
  grantee text not null,
  privilege_type text not null,
  is_grantable boolean not null,
  primary key (
    relation_name, column_name, grantor, grantee, privilege_type
  )
);
revoke all on table market_private.legacy_column_acl_snapshot
  from public, anon, authenticated;
grant all on table market_private.legacy_column_acl_snapshot to service_role;

insert into market_private.legacy_column_acl_snapshot (
  relation_name, column_name, grantor, grantee, privilege_type, is_grantable
)
select c.relname, a.attname,
       coalesce(grantor_role.rolname, pg_catalog.pg_get_userbyid(c.relowner)),
       coalesce(grantee_role.rolname, 'PUBLIC'),
       acl.privilege_type, acl.is_grantable
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_class c on c.oid = a.attrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 cross join lateral pg_catalog.aclexplode(a.attacl) acl
  left join pg_catalog.pg_roles grantor_role on grantor_role.oid = acl.grantor
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = acl.grantee
 where n.nspname = 'public'
   and a.attnum > 0
   and not a.attisdropped
   and a.attacl is not null
   and coalesce(grantee_role.rolname, 'PUBLIC') = any (
     array['PUBLIC', 'anon', 'authenticated', 'service_role']
   )
   and c.relname = any (array[
     'cargo_listings',
     'vessel_availability',
     'listing_ownership',
     'vessels',
     'vessel_claims',
     'vessel_contact_history',
     'matches',
     'v_live_cargo',
     'v_live_vessels',
     'v_cargo_match_counts',
     'v_vessel_match_counts',
     'v_vessel_detail',
     'v_vessel_flag_issues',
     'v_admin_queue',
     'v_eligible_matches'
   ])
on conflict do nothing;

-- Policies are deployment state too. Capture every policy on every relation
-- whose read boundary is replaced below, preserving role-array ordinality so
-- DOWN can reproduce the original catalogue representation exactly.
create table if not exists market_private.legacy_policy_snapshot (
  relation_name text not null,
  policy_name text not null,
  is_permissive boolean not null,
  command_code "char" not null,
  role_names text[] not null,
  using_expression text,
  check_expression text,
  primary key (relation_name, policy_name)
);
revoke all on table market_private.legacy_policy_snapshot
  from public, anon, authenticated;
grant all on table market_private.legacy_policy_snapshot to service_role;

insert into market_private.legacy_policy_snapshot (
  relation_name, policy_name, is_permissive, command_code, role_names,
  using_expression, check_expression
)
select c.relname, p.polname, p.polpermissive, p.polcmd,
       coalesce((
         select array_agg(
                  case when pr.role_oid = 0 then 'PUBLIC' else r.rolname end
                  order by pr.ordinality
                )
           from unnest(p.polroles) with ordinality as pr(role_oid, ordinality)
           left join pg_catalog.pg_roles r on r.oid = pr.role_oid
       ), array['PUBLIC']::text[]),
       pg_catalog.pg_get_expr(p.polqual, p.polrelid),
       pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid)
  from pg_catalog.pg_policy p
  join pg_catalog.pg_class c on c.oid = p.polrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = any (array[
     'cargo_listings', 'vessel_availability', 'listing_ownership',
     'vessels', 'vessel_contact_history', 'matches'
   ])
on conflict do nothing;

-- Exact rollback deliberately supports grants made by each object's owner or
-- by a superuser.  A delegated grant chain (A grants WITH GRANT OPTION to B,
-- then B grants to C) needs dependency-ordered revocation/restoration; refuse
-- that unexpected deployment shape before closing any public surface.
do $legacy_relation_acl_preflight$
declare
  v_relation text;
  v_grantor text;
  r record;
begin
  select x.relation_name, x.grantor
    into v_relation, v_grantor
    from (
      select relation_name, grantor
        from market_private.legacy_relation_acl_snapshot
      union
      select relation_name, grantor
        from market_private.legacy_column_acl_snapshot
    ) x
    join pg_catalog.pg_class c
      on c.oid = to_regclass(format('public.%I', x.relation_name))
    left join pg_catalog.pg_roles g on g.rolname = x.grantor
   where x.grantor is distinct from pg_catalog.pg_get_userbyid(c.relowner)
     and not coalesce(g.rolsuper, false)
   order by x.relation_name, x.grantor
   limit 1;

  if found then
    raise exception
      'MARKET_PREFLIGHT: delegated relation ACL grant by % on public.% is unsupported',
      v_grantor, v_relation
      using errcode = '55000';
  end if;

  for r in
    select distinct grantor
      from (
        select grantor from market_private.legacy_relation_acl_snapshot
        union
        select grantor from market_private.legacy_column_acl_snapshot
      ) grantors
     order by grantor
  loop
    begin
      execute format('set local role %I', r.grantor);
      execute 'reset role';
    exception when others then
      raise exception
        'MARKET_PREFLIGHT: migration executor cannot assume ACL grantor %',
        r.grantor
        using errcode = '55000';
    end;
  end loop;
end;
$legacy_relation_acl_preflight$;

do $close_legacy_column_acls$
declare
  r record;
begin
  for r in
    select c.relname, a.attname
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any (array[
         'cargo_listings', 'vessel_availability', 'listing_ownership',
         'vessels', 'vessel_claims', 'vessel_contact_history', 'matches',
         'v_live_cargo', 'v_live_vessels', 'v_cargo_match_counts',
         'v_vessel_match_counts', 'v_vessel_detail',
         'v_vessel_flag_issues', 'v_admin_queue', 'v_eligible_matches'
       ])
       and a.attnum > 0
       and not a.attisdropped
  loop
    execute format(
      'revoke all (%I) on table public.%I from public, anon, authenticated, service_role',
      r.attname, r.relname
    );
  end loop;
end;
$close_legacy_column_acls$;

-- Function ACLs are deployment-specific too (several refresh signatures are
-- optional). Capture the exact effective ACL before making these legacy
-- SECURITY DEFINER entry points service-only.
create table if not exists market_private.legacy_routine_acl_snapshot (
  routine_signature text not null,
  grantor text not null,
  grantee text not null,
  privilege_type text not null,
  is_grantable boolean not null,
  primary key (routine_signature, grantor, grantee, privilege_type)
);
revoke all on table market_private.legacy_routine_acl_snapshot
  from public, anon, authenticated;
grant all on table market_private.legacy_routine_acl_snapshot to service_role;

insert into market_private.legacy_routine_acl_snapshot (
  routine_signature, grantor, grantee, privilege_type, is_grantable
)
select format(
         '%I.%I(%s)', n.nspname, p.proname,
         pg_catalog.oidvectortypes(p.proargtypes)
       ),
       coalesce(grantor_role.rolname, pg_catalog.pg_get_userbyid(p.proowner)),
       coalesce(grantee_role.rolname, 'PUBLIC'),
       acl.privilege_type,
       acl.is_grantable
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
 cross join lateral pg_catalog.aclexplode(
   coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
  ) acl
  left join pg_catalog.pg_roles grantor_role on grantor_role.oid = acl.grantor
  left join pg_catalog.pg_roles grantee_role on grantee_role.oid = acl.grantee
 where n.nspname = 'public'
   and coalesce(grantee_role.rolname, 'PUBLIC') = any (
     array['PUBLIC', 'anon', 'authenticated', 'service_role']
   )
   and format(
         '%I.%I(%s)', n.nspname, p.proname,
         pg_catalog.oidvectortypes(p.proargtypes)
       ) = any (array[
         'public.fn_vessel_contact_history_insert()',
         'public.get_matches_for_cargo(uuid)',
         'public.get_matches_for_availability(uuid)',
         'public.get_listing_posters(text, uuid[])',
         'public.count_live_matches(text, uuid[])',
         'public.create_vessel_availability(jsonb)',
         'public.create_vessel_position(jsonb)',
         'public.fn_refresh_matches()',
         'public.fn_refresh_matches_for_cargo(uuid)',
         'public.fn_refresh_matches_for_availability(uuid)'
       ])
on conflict do nothing;

do $legacy_routine_acl_preflight$
declare
  v_signature text;
  v_grantor text;
  r record;
begin
  select s.routine_signature, s.grantor
    into v_signature, v_grantor
    from market_private.legacy_routine_acl_snapshot s
    join pg_catalog.pg_proc p
      on p.oid = to_regprocedure(s.routine_signature)
    left join pg_catalog.pg_roles g on g.rolname = s.grantor
   where s.grantor is distinct from pg_catalog.pg_get_userbyid(p.proowner)
     and not coalesce(g.rolsuper, false)
   order by s.routine_signature, s.grantor
   limit 1;

  if found then
    raise exception
      'MARKET_PREFLIGHT: delegated routine ACL grant by % on % is unsupported',
      v_grantor, v_signature
      using errcode = '55000';
  end if;

  for r in
    select distinct grantor
      from market_private.legacy_routine_acl_snapshot
     order by grantor
  loop
    begin
      execute format('set local role %I', r.grantor);
      execute 'reset role';
    exception when others then
      raise exception
        'MARKET_PREFLIGHT: migration executor cannot assume routine ACL grantor %',
        r.grantor
        using errcode = '55000';
    end;
  end loop;
end;
$legacy_routine_acl_preflight$;

-- The two historical posting RPCs are SECURITY DEFINER and accepted a vessel
-- UUID (or an IMO that happened to resolve to an existing vessel) without
-- proving that the caller already managed that hull.  Keep their mature insert
-- and review-routing bodies intact, but make them private implementation
-- details.  The public signatures below become the only callable entry points.
alter function public.create_vessel_availability(jsonb)
  set schema market_private;
alter function public.create_vessel_position(jsonb)
  set schema market_private;

revoke all on function market_private.create_vessel_availability(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function market_private.create_vessel_position(jsonb)
  from public, anon, authenticated, service_role;

-- Vessel IMO is an identity key.  The historical UNIQUE constraint is
-- bytewise, so whitespace variants can occupy different index keys even
-- though the posting APIs treat them as the same canonical IMO.  Serialize
-- every future INSERT / IMO change on the same transaction advisory key used
-- by the guarded position wrapper, normalize NEW, and recheck canonically.
-- This also closes register_vessel/direct-writer races without a table lock or
-- a potentially unsafe cleanup of pre-existing noncanonical data here.  The
-- existing UNIQUE (imo_number) constraint remains the final normalized-key
-- backstop if a higher-isolation transaction retains an older read snapshot.
create or replace function market_private.guard_vessel_imo_identity()
returns trigger
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_imo text := nullif(pg_catalog.btrim(new.imo_number), '');
begin
  -- Keep every post-migration writer on the same canonical representation as
  -- the advisory key and wrapper lookup.  Historical noncanonical rows are
  -- handled explicitly by the wrapper rather than silently rewritten here.
  new.imo_number := v_imo;
  if v_imo is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.imo_number is not distinct from old.imo_number then
    return new;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('market:vessel-imo:' || v_imo, 0)
  );

  if exists (
    select 1
      from public.vessels v
     where pg_catalog.btrim(v.imo_number) = v_imo
       and v.id is distinct from new.id
  ) then
    raise exception 'A vessel with IMO number % already exists in the register.',
      v_imo
      using errcode = '23505',
            constraint = 'vessels_imo_identity_guard';
  end if;

  return new;
end;
$function$;
revoke all on function market_private.guard_vessel_imo_identity()
  from public, anon, authenticated, service_role;

create trigger trg_vessels_imo_identity_guard
before insert or update of imo_number on public.vessels
for each row execute function market_private.guard_vessel_imo_identity();

-- Resolve and lock the canonical application actor.  The row lock keeps
-- activation/role decisions stable until the surrounding transaction ends.
create or replace function market_private.lock_vessel_post_actor()
returns uuid
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_auth_id uuid := auth.uid();
  v_actor uuid;
begin
  if v_auth_id is null or auth.role() is distinct from 'authenticated' then
    raise exception 'MARKET_AUTH: authentication is required'
      using errcode = '42501';
  end if;

  select u.id
    into v_actor
    from public.users u
   where (u.supabase_user_id = v_auth_id or u.id = v_auth_id)
     and u.is_active
   order by coalesce(u.supabase_user_id = v_auth_id, false) desc,
            coalesce(u.id = v_auth_id, false) desc,
            u.id
   limit 1
   for share of u;

  if v_actor is null then
    raise exception 'MARKET_AUTH: an active application profile is required'
      using errcode = '42501';
  end if;
  return v_actor;
end;
$function$;
revoke all on function market_private.lock_vessel_post_actor()
  from public, anon, authenticated, service_role;

-- Lock one existing vessel and every row on which the authorization decision
-- can depend.  Locks are acquired in one fixed order (vessel, claims,
-- availabilities, ownership rows, organisation memberships), with UUID order
-- inside each set.  A qualifying row therefore cannot be revoked, transferred,
-- reassigned, or ended between this check and the private legacy write.
create or replace function market_private.lock_existing_vessel_for_post(
  p_vessel_id uuid,
  p_actor uuid,
  p_auth_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_allowed boolean := false;
  v_availability_ids uuid[] := array[]::uuid[];
  v_org_ids uuid[] := array[]::uuid[];
  r record;
begin
  -- This is also the serialization point for every existing-hull post.  The
  -- lock is intentionally taken before looking at claims or listing ownership.
  perform v.id
    from public.vessels v
   where v.id = p_vessel_id
   for update of v;
  if not found then
    raise exception 'MARKET_NOT_FOUND: vessel was not found'
      using errcode = 'P0002';
  end if;

  if coalesce(
       (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
       and exists (
         select 1
           from public.users u
          where u.id = p_actor
            and lower(coalesce(u.role, '')) = 'admin'
            and u.is_active
       ),
       false
     ) then
    return;
  end if;

  -- Claims reference auth.users, so only the exact authenticated identity can
  -- satisfy this path.  Newer listing ownership rows use public.users ids and
  -- are checked against the canonical application actor below.
  for r in
    select vc.id
      from public.vessel_claims vc
     where vc.vessel_id = p_vessel_id
       and vc.user_id = p_auth_id
     order by vc.id
     for share of vc
  loop
    v_allowed := true;
  end loop;

  if v_allowed then
    return;
  end if;

  -- Freeze the exact availability-to-vessel associations first.  Ownership is
  -- then locked in listing/id order, independently of RLS visibility.
  for r in
    select a.id
      from public.vessel_availability a
     where a.vessel_id = p_vessel_id
     order by a.id
     for share of a
  loop
    v_availability_ids := array_append(v_availability_ids, r.id);
  end loop;

  for r in
    select lo.id, lo.owner_user_id, lo.owner_org_id
      from public.listing_ownership lo
     where lo.listing_type::text = 'vessel_availability'
       and lo.listing_id = any (v_availability_ids)
       and lo.role::text = 'primary'
       and lo.is_current
       and (lo.owned_until is null or lo.owned_until > now())
     order by lo.listing_id, lo.id
     for share of lo
  loop
    if r.owner_org_id is null and r.owner_user_id = p_actor then
      v_allowed := true;
    elsif r.owner_org_id is not null
          and not (r.owner_org_id = any (v_org_ids)) then
      v_org_ids := array_append(v_org_ids, r.owner_org_id);
    end if;
  end loop;

  -- An organisation-owned listing is exact only for a current, active seat in
  -- that recorded organisation.  Lock candidate seats in primary-key order.
  for r in
    select om.org_id, om.user_id, om.is_current, om.status
      from public.organization_members om
     where om.user_id = p_actor
       and om.org_id = any (v_org_ids)
     order by om.org_id, om.user_id
     for share of om
  loop
    if r.is_current and r.status = 'active' then
      v_allowed := true;
    end if;
  end loop;

  if not v_allowed then
    raise exception 'MARKET_AUTH: an existing vessel requires a pre-existing exact claim or current listing ownership'
      using errcode = '42501';
  end if;
end;
$function$;
revoke all on function market_private.lock_existing_vessel_for_post(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.create_vessel_availability(payload jsonb)
returns public.vessel_availability
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_auth_id uuid := auth.uid();
  v_actor uuid;
  v_vessel_id uuid;
begin
  v_actor := market_private.lock_vessel_post_actor();
  v_vessel_id := nullif(payload->>'vessel_id', '')::uuid;
  perform market_private.lock_existing_vessel_for_post(
    v_vessel_id, v_actor, v_auth_id
  );
  return market_private.create_vessel_availability(payload);
end;
$function$;
revoke all on function public.create_vessel_availability(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_vessel_availability(jsonb)
  to authenticated, service_role;

create or replace function public.create_vessel_position(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'market_private'
as $function$
declare
  v_auth_id uuid := auth.uid();
  v_actor uuid;
  v_app_role text;
  v_has_profile boolean := false;
  v_mode text := coalesce(payload->>'entry_mode', 'fleet');
  v_vessel_id uuid;
  v_imo text;
  v_imo_vessel_ids uuid[] := array[]::uuid[];
  v_imo_noncanonical boolean := false;
  r record;
begin
  v_actor := market_private.lock_vessel_post_actor();

  if v_mode not in ('fleet', 'new', 'tbn') then
    raise exception 'MARKET_VALIDATION: entry_mode must be fleet, new or tbn'
      using errcode = '22023';
  end if;
  if v_mode <> 'fleet' and nullif(payload->>'vessel_id', '') is not null then
    raise exception 'MARKET_VALIDATION: vessel_id is accepted only in fleet mode'
      using errcode = '22023';
  end if;

  select u.role into v_app_role
    from public.users u
   where u.id = v_actor;

  -- Preserve the legacy coarse posting gate, but lock any profile that makes
  -- it true so it cannot disappear while this transaction is writing.
  for r in
    select p.id
      from public.profiles p
     where p.account_id = v_actor
       and p.profile_type = 'vessel'::public.profile_type_enum
       and p.is_active
     order by p.id
     for share of p
  loop
    v_has_profile := true;
  end loop;
  if coalesce(v_app_role, '') not in ('vessel_owner', 'broker', 'admin')
     and not v_has_profile then
    raise exception 'Only users with an active Vessel profile may post positions';
  end if;

  if v_mode = 'fleet' then
    v_vessel_id := nullif(payload->>'vessel_id', '')::uuid;
    perform market_private.lock_existing_vessel_for_post(
      v_vessel_id, v_actor, v_auth_id
    );
  elsif v_mode = 'new' then
    v_imo := nullif(trim(payload->'vessel'->>'imo'), '');
    if v_imo is null or not public.fn_imo_check_digit(v_imo) then
      raise exception 'MARKET_VALIDATION: a valid 7-digit IMO number is required'
        using errcode = '22023';
    end if;

    -- Same-IMO callers and every vessel INSERT / IMO change serialize before
    -- this lookup.  The trigger above uses this same key and rejects a stale
    -- register_vessel/direct-writer insert after waiting for our transaction.
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('market:vessel-imo:' || v_imo, 0)
    );
    -- The legacy core looks up the raw stored value.  Lock every canonical
    -- match in UUID order and refuse ambiguity/noncanonical storage so it can
    -- never resolve a different row from the one we authorized.
    for r in
      select v.id, v.imo_number
        from public.vessels v
       where pg_catalog.btrim(v.imo_number) = v_imo
       order by v.id
       for update of v
    loop
      v_imo_vessel_ids := array_append(v_imo_vessel_ids, r.id);
      v_imo_noncanonical := v_imo_noncanonical or r.imo_number <> v_imo;
    end loop;

    if pg_catalog.cardinality(v_imo_vessel_ids) > 1 then
      raise exception 'MARKET_VALIDATION: duplicate registry rows make IMO % ambiguous', v_imo
        using errcode = '22023';
    elsif v_imo_noncanonical then
      raise exception 'MARKET_VALIDATION: registry IMO % must be canonicalized before posting', v_imo
        using errcode = '22023';
    elsif pg_catalog.cardinality(v_imo_vessel_ids) = 1 then
      v_vessel_id := v_imo_vessel_ids[1];
      perform market_private.lock_existing_vessel_for_post(
        v_vessel_id, v_actor, v_auth_id
      );
    end if;
  end if;

  return market_private.create_vessel_position(payload);
end;
$function$;
revoke all on function public.create_vessel_position(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.create_vessel_position(jsonb)
  to authenticated, service_role;

-- Fail closed against an unexpected permissive or restrictive policy. The
-- complete pre-migration policy set is already snapshotted above for DOWN.
do $drop_legacy_market_policies$
declare
  r record;
begin
  for r in
    select c.relname as relation_name, p.polname as policy_name
      from pg_catalog.pg_policy p
      join pg_catalog.pg_class c on c.oid = p.polrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any (array[
         'cargo_listings', 'vessel_availability', 'listing_ownership',
         'vessels', 'vessel_contact_history', 'matches'
       ])
     order by c.relname, p.polname
  loop
    execute format(
      'drop policy if exists %I on public.%I',
      r.policy_name, r.relation_name
    );
  end loop;
end;
$drop_legacy_market_policies$;

-- Cargo: remove the broad live-market read and unaudited direct insert. Exact
-- personal/org ownership is the only member base-table read/update path.
drop policy if exists "cl: auth see live" on public.cargo_listings;
drop policy if exists "cl: owner see own" on public.cargo_listings;
drop policy if exists "cl: owner update own" on public.cargo_listings;
drop policy if exists "cl: owner insert" on public.cargo_listings;
drop policy if exists "cl: freshness horizon" on public.cargo_listings;
drop policy if exists "cl: governed owner read" on public.cargo_listings;
drop policy if exists "cl: governed owner update" on public.cargo_listings;

create policy "cl: governed owner read"
on public.cargo_listings for select to authenticated
using (
  public.fn_is_admin()
  or public.fn_market_owns_listing('cargo', id)
);

create policy "cl: governed owner update"
on public.cargo_listings for update to authenticated
using (
  public.fn_is_admin()
  or public.fn_market_owns_listing('cargo', id)
)
with check (
  public.fn_is_admin()
  or public.fn_market_owns_listing('cargo', id)
);

revoke all on table public.cargo_listings from public, anon, authenticated;
grant select on table public.cargo_listings to authenticated;
grant update (
  qty_min_mt,
  qty_max_mt,
  stowage_factor,
  volume_cbm,
  load_port_locode,
  disch_port_locode,
  laycan_from,
  laycan_to,
  load_rate,
  disch_rate,
  load_terms,
  laytime_basis,
  freight_idea_usd_mt,
  commission_pct,
  commission_ttl_pct,
  demurrage_rate,
  despatch_rate,
  broker,
  notes
) on table public.cargo_listings to authenticated;
grant all on table public.cargo_listings to service_role;

-- Positions: same boundary. Posting remains through the governed SECURITY
-- DEFINER create RPC; direct member insertion cannot self-approve a row.
drop policy if exists "va: auth see live" on public.vessel_availability;
drop policy if exists "va: owner see own" on public.vessel_availability;
drop policy if exists "va: owner update own" on public.vessel_availability;
drop policy if exists "va: owner insert" on public.vessel_availability;
drop policy if exists "va: freshness horizon" on public.vessel_availability;
drop policy if exists "va: governed owner read" on public.vessel_availability;
drop policy if exists "va: governed owner update" on public.vessel_availability;

create policy "va: governed owner read"
on public.vessel_availability for select to authenticated
using (
  public.fn_is_admin()
  or public.fn_market_owns_listing('vessel_availability', id)
);

create policy "va: governed owner update"
on public.vessel_availability for update to authenticated
using (
  public.fn_is_admin()
  or public.fn_market_owns_listing('vessel_availability', id)
)
with check (
  public.fn_is_admin()
  or public.fn_market_owns_listing('vessel_availability', id)
);

revoke all on table public.vessel_availability from public, anon, authenticated;
grant select on table public.vessel_availability to authenticated;
grant update (
  open_port_locode,
  ballast_port_locode,
  open_date,
  open_date_range_days,
  last_cargo,
  service_speed_kn,
  me_consumption_mt_day,
  me_consumption_port_mt_day,
  aux_consumption_mt_day,
  aux_consumption_port_mt_day,
  fuel_type,
  accepts_part_cargo,
  notes
) on table public.vessel_availability to authenticated;
grant all on table public.vessel_availability to service_role;

-- Defence in depth for future grant drift: even if a later migration
-- accidentally broadens UPDATE, ordinary members cannot approve, publish, or
-- directly drive a listing lifecycle.  Governed lifecycle commands execute as
-- their trusted function owner; admins and service jobs remain explicit.
create or replace function public.fn_market_protect_listing_workflow()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if current_user not in ('postgres', 'service_role')
     and not public.fn_is_admin()
     and (
       new.review_status is distinct from old.review_status
       or new.goes_live_at is distinct from old.goes_live_at
       or new.status is distinct from old.status
     ) then
    raise exception 'MARKET_AUTH: listing workflow fields require a governed command'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.fn_market_protect_listing_workflow()
  from public, anon, authenticated;
grant execute on function public.fn_market_protect_listing_workflow()
  to service_role;

drop trigger if exists trg_market_protect_cargo_workflow
  on public.cargo_listings;
create trigger trg_market_protect_cargo_workflow
before update on public.cargo_listings
for each row execute function public.fn_market_protect_listing_workflow();

drop trigger if exists trg_market_protect_vessel_workflow
  on public.vessel_availability;
create trigger trg_market_protect_vessel_workflow
before update on public.vessel_availability
for each row execute function public.fn_market_protect_listing_workflow();

-- Ownership rows are metadata, not a writable member API.  A member may read
-- only a row for a listing that the exact personal identity or an active,
-- current organisation seat represents.  Inserts/transfers remain governed by
-- the posting and administrative SECURITY DEFINER commands.
drop policy if exists "lo: own rows only" on public.listing_ownership;
drop policy if exists "lo: governed exact owner read" on public.listing_ownership;
create policy "lo: governed exact owner read"
on public.listing_ownership for select to authenticated
using (
  public.fn_is_admin()
  or public.fn_market_owns_listing(listing_type::text, listing_id)
);
revoke all on table public.listing_ownership from public, anon, authenticated;
grant select on table public.listing_ownership to authenticated;
grant all on table public.listing_ownership to service_role;

-- The named registry remains useful for posting a position. TBN hulls are not
-- registry records: only an exact position owner or admin may select them.
drop policy if exists "vessels: auth read non-sanctioned" on public.vessels;
drop policy if exists "vessels: named registry read" on public.vessels;
drop policy if exists "vessels: governed tbn owner read" on public.vessels;

create policy "vessels: named registry read"
on public.vessels for select to authenticated
using (
  not is_sanctioned
  and not coalesce(is_tbn, false)
);

create policy "vessels: governed tbn owner read"
on public.vessels for select to authenticated
using (
  public.fn_is_admin()
  or exists (
    select 1
      from public.vessel_availability va
     where va.vessel_id = vessels.id
       and public.fn_market_owns_listing('vessel_availability', va.id)
  )
  or public.fn_is_vessel_owner(vessels.id)
);

revoke all on table public.vessels from public, anon, authenticated;
-- Never add a table-level authenticated SELECT here: that would reopen every
-- owner/manager/contact PII column for named registry rows.
grant all on table public.vessels to service_role;

-- Rebuild the named-vessel registry only after the table-level REVOKE, because
-- PostgreSQL clears column grants when ALL table privileges are revoked. The
-- canonical allow-list contains specifications plus the UI's non-narrative
-- safety/eligibility/provenance signals. Unknown/new columns default private;
-- ownership, manager, contact, notes and detailed risk fields stay closed.
do $grant_named_vessel_registry$
declare
  v_column text;
  v_safe_columns constant text[] := array[
    'id', 'vessel_name', 'imo_number', 'vessel_type',
    'dwt_grain', 'dwt_bale', 'dwcc', 'grain_cbm', 'bale_cbm',
    'gross_tonnage', 'net_tonnage', 'scnrt',
    'build_year', 'flag', 'flag_category', 'scope', 'risk_level',
    'preferred_zones',
    'is_geared', 'crane_count', 'crane_swl_mt',
    'grain_certified', 'dg_certified',
    'max_loa_m', 'beam_m', 'max_draft_m',
    'is_sanctioned', 'vessel_review_status',
    'class_society', 'is_tbn', 'is_verified', 'source_tag',
    'vessel_config', 'num_holds', 'num_hatches', 'box_shaped',
    'hatch_type', 'strengthened_heavy', 'holds_may_be_empty', 'log_fitted'
  ];
begin
  foreach v_column in array v_safe_columns
  loop
    if exists (
      select 1
        from information_schema.columns c
       where c.table_schema = 'public'
         and c.table_name = 'vessels'
         and c.column_name = v_column
    ) then
      execute format(
        'grant select (%I) on table public.vessels to authenticated',
        v_column
      );
    end if;
  end loop;
end;
$grant_named_vessel_registry$;

-- Claims are written only inside the guarded posting flow. Direct member
-- INSERT/UPDATE/DELETE would let a caller manufacture ownership authority.
revoke all on table public.vessel_claims from public, anon, authenticated;
grant all on table public.vessel_claims to service_role;

-- Contact history is not a market feed. The historical "current only" policy
-- exposed the current owner/manager/contact row for every vessel, including a
-- TBN's stable vessel UUID. Keep reads admin-only and service-owned.
drop policy if exists "vch: auth current only" on public.vessel_contact_history;
create policy "vch: governed admin all"
on public.vessel_contact_history
as permissive for all to authenticated
using (public.fn_is_admin())
with check (public.fn_is_admin());
revoke all on table public.vessel_contact_history from public, anon, authenticated;
grant select on table public.vessel_contact_history to authenticated;
grant all on table public.vessel_contact_history to service_role;
revoke all on function public.fn_vessel_contact_history_insert()
  from public, anon, authenticated;
grant execute on function public.fn_vessel_contact_history_insert() to service_role;

-- The cache is an internal implementation detail. Raw pair UUIDs are a direct
-- bypass around both opaque listing handles.
drop policy if exists "matches: auth read" on public.matches;
revoke all on table public.matches from public, anon, authenticated;
grant all on table public.matches to service_role;

-- The flag-quality view includes stable vessel identifiers and therefore
-- cannot remain a generally readable authenticated view.  The current admin
-- UI needs only the issue count, so expose that smallest useful surface behind
-- the same durable admin claim check used elsewhere. Service jobs may call it
-- as well; ordinary members receive the same authorization failure without
-- learning whether any issue rows exist.
create or replace function public.count_admin_vessel_flag_issues()
returns bigint
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_count bigint;
begin
  if not (
    public.fn_is_admin()
    or coalesce(auth.role() = 'service_role', false)
    or current_user = 'service_role'
  ) then
    raise exception 'MARKET_AUTH: administrator access is required'
      using errcode = '42501';
  end if;

  select count(*) into v_count
    from public.v_vessel_flag_issues;
  return v_count;
end;
$function$;
revoke all on function public.count_admin_vessel_flag_issues()
  from public, anon;
grant execute on function public.count_admin_vessel_flag_issues()
  to authenticated, service_role;

-- Legacy views expose raw listing/availability/vessel UUIDs. Keep them for
-- service jobs during rollback compatibility, but remove every member/anon
-- privilege after application cut-over.
do $views$
declare
  v_name text;
begin
  foreach v_name in array array[
    'v_live_cargo',
    'v_live_vessels',
    'v_cargo_match_counts',
    'v_vessel_match_counts',
    'v_vessel_detail',
    'v_vessel_flag_issues',
    'v_admin_queue',
    'v_eligible_matches'
  ] loop
    if to_regclass('public.' || v_name) is not null then
      execute format(
        'revoke all on table public.%I from public, anon, authenticated',
        v_name
      );
      execute format('grant select on table public.%I to service_role', v_name);
    end if;
  end loop;
end;
$views$;

-- Raw-id discovery RPCs and poster/count helpers are callable bypasses even
-- after table RLS because they are SECURITY DEFINER. Fixture/private server
-- functions may still call them as their owner; browser roles may not.
revoke all on function public.get_matches_for_cargo(uuid)
  from public, anon, authenticated;
revoke all on function public.get_matches_for_availability(uuid)
  from public, anon, authenticated;
revoke all on function public.get_listing_posters(text, uuid[])
  from public, anon, authenticated;
revoke all on function public.count_live_matches(text, uuid[])
  from public, anon, authenticated;

grant execute on function public.get_matches_for_cargo(uuid) to service_role;
grant execute on function public.get_matches_for_availability(uuid) to service_role;
grant execute on function public.get_listing_posters(text, uuid[]) to service_role;
grant execute on function public.count_live_matches(text, uuid[]) to service_role;

-- Refresh commands vary by environment (the active chain and the baseline
-- bootstrap do not contain exactly the same set). Close whichever exist.
do $refresh$
declare
  v_sig text;
begin
  foreach v_sig in array array[
    'public.fn_refresh_matches()',
    'public.fn_refresh_matches_for_cargo(uuid)',
    'public.fn_refresh_matches_for_availability(uuid)'
  ] loop
    if to_regprocedure(v_sig) is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        v_sig
      );
      execute format('grant execute on function %s to service_role', v_sig);
    end if;
  end loop;
end;
$refresh$;

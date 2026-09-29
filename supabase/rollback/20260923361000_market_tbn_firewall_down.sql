-- DOWN for 20260923361000_market_tbn_firewall.sql.
-- Restores the historical discovery grants/policies. Apply only after the
-- closure migration is no longer serving traffic.

-- Remove the guarded facades, discard their private lock helpers, and move the
-- untouched legacy function objects back to their original schema.  Their
-- deployment-specific ACLs are restored from the snapshot near the end of this
-- file, after all forward grants have been cleared.
drop function if exists public.create_vessel_availability(jsonb);
drop function if exists public.create_vessel_position(jsonb);
drop trigger if exists trg_vessels_imo_identity_guard on public.vessels;
drop function if exists market_private.guard_vessel_imo_identity();
drop function if exists market_private.lock_existing_vessel_for_post(uuid, uuid, uuid);
drop function if exists market_private.lock_vessel_post_actor();
alter function market_private.create_vessel_availability(jsonb)
  set schema public;
alter function market_private.create_vessel_position(jsonb)
  set schema public;

drop trigger if exists trg_market_protect_cargo_workflow
  on public.cargo_listings;
drop trigger if exists trg_market_protect_vessel_workflow
  on public.vessel_availability;
drop function if exists public.fn_market_protect_listing_workflow();

drop policy if exists "cl: governed owner read" on public.cargo_listings;
drop policy if exists "cl: governed owner update" on public.cargo_listings;
drop policy if exists "cl: auth see live" on public.cargo_listings;
drop policy if exists "cl: owner insert" on public.cargo_listings;
drop policy if exists "cl: owner see own" on public.cargo_listings;
drop policy if exists "cl: owner update own" on public.cargo_listings;
drop policy if exists "cl: freshness horizon" on public.cargo_listings;

create policy "cl: auth see live" on public.cargo_listings
as permissive for select to public
using (
  auth.role() = 'authenticated'
  and review_status = 'APPROVED'::public.review_status_enum
  and status = any (array[
    'IN'::public.cargo_status_enum,
    'PARTIAL'::public.cargo_status_enum
  ])
);
create policy "cl: owner insert" on public.cargo_listings
as permissive for insert to public
with check (auth.role() = 'authenticated');
create policy "cl: owner see own" on public.cargo_listings
as permissive for select to public
using (exists (
  select 1 from public.listing_ownership lo
   where lo.listing_id = cargo_listings.id
     and lo.listing_type = 'cargo'::public.listing_type_enum
     and lo.owner_user_id = auth.uid()
));
create policy "cl: owner update own" on public.cargo_listings
as permissive for update to public
using (exists (
  select 1 from public.listing_ownership lo
   where lo.listing_id = cargo_listings.id
     and lo.listing_type = 'cargo'::public.listing_type_enum
     and lo.owner_user_id = auth.uid()
     and lo.role = 'primary'::public.ownership_role_enum
     and lo.is_current
));
create policy "cl: freshness horizon" on public.cargo_listings
as restrictive for select to public
using (
  current_user = 'dq_evaluator'
  or public.fn_market_fresh_ok(
    id, 'cargo'::public.listing_type_enum, refreshed_at, laycan_to
  )
);

revoke update (
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
) on table public.cargo_listings from authenticated;
grant delete, insert, references, select, trigger, truncate, update
  on public.cargo_listings to anon, authenticated, service_role;

drop policy if exists "va: governed owner read" on public.vessel_availability;
drop policy if exists "va: governed owner update" on public.vessel_availability;
drop policy if exists "va: auth see live" on public.vessel_availability;
drop policy if exists "va: owner insert" on public.vessel_availability;
drop policy if exists "va: owner see own" on public.vessel_availability;
drop policy if exists "va: owner update own" on public.vessel_availability;
drop policy if exists "va: freshness horizon" on public.vessel_availability;

create policy "va: auth see live" on public.vessel_availability
as permissive for select to public
using (
  auth.role() = 'authenticated'
  and review_status = 'APPROVED'::public.review_status_enum
  and status = 'OPEN'::public.vessel_status_enum
);
create policy "va: owner insert" on public.vessel_availability
as permissive for insert to public
with check (auth.role() = 'authenticated');
create policy "va: owner see own" on public.vessel_availability
as permissive for select to public
using (exists (
  select 1 from public.listing_ownership lo
   where lo.listing_id = vessel_availability.id
     and lo.listing_type = 'vessel_availability'::public.listing_type_enum
     and lo.owner_user_id = auth.uid()
));
create policy "va: owner update own" on public.vessel_availability
as permissive for update to public
using (exists (
  select 1 from public.listing_ownership lo
   where lo.listing_id = vessel_availability.id
     and lo.listing_type = 'vessel_availability'::public.listing_type_enum
     and lo.owner_user_id = auth.uid()
     and lo.role = 'primary'::public.ownership_role_enum
     and lo.is_current
));
create policy "va: freshness horizon" on public.vessel_availability
as restrictive for select to public
using (
  current_user = 'dq_evaluator'
  or public.fn_market_fresh_ok(
    id, 'vessel_availability'::public.listing_type_enum,
    refreshed_at, open_date
  )
);

revoke update (
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
) on table public.vessel_availability from authenticated;
grant delete, insert, references, select, trigger, truncate, update
  on public.vessel_availability to anon, authenticated, service_role;

drop policy if exists "lo: governed exact owner read" on public.listing_ownership;
drop policy if exists "lo: own rows only" on public.listing_ownership;
create policy "lo: own rows only" on public.listing_ownership
as permissive for select to public
using (owner_user_id = auth.uid());
grant delete, insert, references, select, trigger, truncate, update
  on public.listing_ownership to anon, authenticated, service_role;

drop policy if exists "vessels: named registry read" on public.vessels;
drop policy if exists "vessels: governed tbn owner read" on public.vessels;
drop policy if exists "vessels: auth read non-sanctioned" on public.vessels;
create policy "vessels: auth read non-sanctioned" on public.vessels
as permissive for select to public
using (auth.role() = 'authenticated' and is_sanctioned = false);
-- Temporary compatibility grant; the exact deployment ACL (including its
-- historical column grants) is restored from the snapshots below.
grant all on public.vessels to service_role;

drop policy if exists "vch: auth current only" on public.vessel_contact_history;
create policy "vch: auth current only" on public.vessel_contact_history
as permissive for select to public
using (auth.role() = 'authenticated' and is_current = true);
grant delete, insert, references, select, trigger, truncate, update
  on public.vessel_contact_history to anon, authenticated, service_role;

drop policy if exists "matches: auth read" on public.matches;
create policy "matches: auth read" on public.matches
as permissive for select to public
using (auth.role() = 'authenticated');
grant delete, insert, references, select, trigger, truncate, update
  on public.matches to anon, authenticated, service_role;

-- The definitions above preserve compatibility with the historical repository
-- baseline. Replace them with the exact deployment snapshot so emergency DOWN
-- is also correct when policy names, roles or expressions had drifted.
do $restore_legacy_market_policies$
declare
  r record;
  v_command text;
  v_roles text;
  v_sql text;
begin
  if to_regclass('market_private.legacy_policy_snapshot') is null then
    raise exception 'MARKET_ROLLBACK: legacy policy snapshot is missing';
  end if;

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

  for r in
    select *
      from market_private.legacy_policy_snapshot
     order by relation_name, policy_name
  loop
    v_command := case r.command_code
      when 'r' then 'select'
      when 'a' then 'insert'
      when 'w' then 'update'
      when 'd' then 'delete'
      when '*' then 'all'
      else null
    end;
    if v_command is null then
      raise exception 'MARKET_ROLLBACK: unsupported policy command %',
        r.command_code;
    end if;

    select string_agg(
             case when role_name = 'PUBLIC' then 'public'
                  else format('%I', role_name) end,
             ', ' order by role_ordinality
           )
      into v_roles
      from unnest(r.role_names) with ordinality
        as restored_role(role_name, role_ordinality);

    v_sql := format(
      'create policy %I on public.%I as %s for %s to %s',
      r.policy_name,
      r.relation_name,
      case when r.is_permissive then 'permissive' else 'restrictive' end,
      v_command,
      v_roles
    );
    if r.using_expression is not null then
      v_sql := v_sql || format(' using (%s)', r.using_expression);
    end if;
    if r.check_expression is not null then
      v_sql := v_sql || format(' with check (%s)', r.check_expression);
    end if;
    execute v_sql;
  end loop;
end;
$restore_legacy_market_policies$;

drop function if exists public.count_admin_vessel_flag_issues();

do $relations$
declare
  v_name text;
begin
  -- First remove every grant installed by the forward migration.  The exact
  -- pre-migration grants are restored from its private snapshot below.
  foreach v_name in array array[
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
  ] loop
    if to_regclass('public.' || v_name) is not null then
      execute format(
        'revoke all on table public.%I from public, anon, authenticated, service_role',
        v_name
      );
    end if;
  end loop;
end;
$relations$;

do $clear_legacy_column_acl$
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
$clear_legacy_column_acl$;

do $restore_acl$
declare
  r record;
  v_grantee text;
  v_grant_option text;
begin
  if to_regclass('market_private.legacy_relation_acl_snapshot') is null then
    raise exception 'MARKET_ROLLBACK: legacy relation ACL snapshot is missing';
  end if;

  for r in
    select relation_name, grantor, grantee, privilege_type, is_grantable
      from market_private.legacy_relation_acl_snapshot
     where grantee = any (array['PUBLIC', 'anon', 'authenticated', 'service_role'])
     order by relation_name, grantor, grantee, privilege_type
  loop
    if to_regclass('public.' || r.relation_name) is not null then
      v_grantee := case
        when r.grantee = 'PUBLIC' then 'public'
        else format('%I', r.grantee)
      end;
      v_grant_option := case
        when r.is_grantable then ' with grant option'
        else ''
      end;
      if not exists (select 1 from pg_catalog.pg_roles where rolname = r.grantor) then
        raise exception 'MARKET_ROLLBACK: relation ACL grantor % no longer exists', r.grantor;
      end if;
      execute format('set local role %I', r.grantor);
      begin
        execute format(
          'grant %s on table public.%I to %s%s',
          lower(r.privilege_type),
          r.relation_name,
          v_grantee,
          v_grant_option
        );
      exception when others then
        execute 'reset role';
        raise;
      end;
      execute 'reset role';
    end if;
  end loop;
end;
$restore_acl$;

do $restore_column_acl$
declare
  r record;
  v_grantee text;
  v_grant_option text;
begin
  if to_regclass('market_private.legacy_column_acl_snapshot') is null then
    raise exception 'MARKET_ROLLBACK: legacy column ACL snapshot is missing';
  end if;

  for r in
    select relation_name, column_name, grantor, grantee,
           privilege_type, is_grantable
      from market_private.legacy_column_acl_snapshot
     where grantee = any (array['PUBLIC', 'anon', 'authenticated', 'service_role'])
     order by relation_name, column_name, grantor, grantee, privilege_type
  loop
    if to_regclass('public.' || r.relation_name) is not null then
      v_grantee := case
        when r.grantee = 'PUBLIC' then 'public'
        else format('%I', r.grantee)
      end;
      v_grant_option := case
        when r.is_grantable then ' with grant option'
        else ''
      end;
      begin
        execute format('set local role %I', r.grantor);
        execute format(
          'grant %s (%I) on table public.%I to %s%s',
          r.privilege_type, r.column_name, r.relation_name,
          v_grantee, v_grant_option
        );
        reset role;
      exception when others then
        reset role;
        raise;
      end;
    end if;
  end loop;
end;
$restore_column_acl$;

drop table market_private.legacy_relation_acl_snapshot;
drop table market_private.legacy_column_acl_snapshot;
drop table market_private.legacy_policy_snapshot;

do $restore_routine_acl$
declare
  r record;
  v_grantee text;
  v_grant_option text;
begin
  if to_regclass('market_private.legacy_routine_acl_snapshot') is null then
    raise exception 'MARKET_ROLLBACK: legacy routine ACL snapshot is missing';
  end if;

  for r in
    select distinct routine_signature
      from market_private.legacy_routine_acl_snapshot
  loop
    if to_regprocedure(r.routine_signature) is not null then
      execute format(
        'revoke all on function %s from public, anon, authenticated',
        r.routine_signature
      );
      execute format('revoke all on function %s from service_role', r.routine_signature);
    end if;
  end loop;

  for r in
    select routine_signature, grantor, grantee, privilege_type, is_grantable
      from market_private.legacy_routine_acl_snapshot
     where grantee = any (array['PUBLIC', 'anon', 'authenticated', 'service_role'])
     order by routine_signature, grantor, grantee, privilege_type
  loop
    if to_regprocedure(r.routine_signature) is not null then
      v_grantee := case
        when r.grantee = 'PUBLIC' then 'public'
        else format('%I', r.grantee)
      end;
      v_grant_option := case
        when r.is_grantable then ' with grant option'
        else ''
      end;
      if not exists (select 1 from pg_catalog.pg_roles where rolname = r.grantor) then
        raise exception 'MARKET_ROLLBACK: routine ACL grantor % no longer exists', r.grantor;
      end if;
      execute format('set local role %I', r.grantor);
      begin
        execute format(
          'grant %s on function %s to %s%s',
          lower(r.privilege_type),
          r.routine_signature,
          v_grantee,
          v_grant_option
        );
      exception when others then
        execute 'reset role';
        raise;
      end;
      execute 'reset role';
    end if;
  end loop;
end;
$restore_routine_acl$;

drop table market_private.legacy_routine_acl_snapshot;

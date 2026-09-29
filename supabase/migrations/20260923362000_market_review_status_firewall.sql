-- Global market privacy firewall, stage 3: keep moderation internals private.
--
-- review_queue contains raw listing identifiers, trust decisions, sampling
-- flags, moderation reasons and administrator notes.  Members may learn the
-- lifecycle state of submissions they made, but must not read that ledger or
-- the administrator join view directly.

create table if not exists market_private.review_relation_acl_snapshot (
  relation_name text not null,
  grantor text not null,
  grantee text not null,
  privilege_type text not null,
  is_grantable boolean not null,
  primary key (relation_name, grantor, grantee, privilege_type)
);
revoke all on table market_private.review_relation_acl_snapshot
  from public, anon, authenticated;
grant all on table market_private.review_relation_acl_snapshot to service_role;

insert into market_private.review_relation_acl_snapshot (
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
   and c.relname = any (array['review_queue', 'v_admin_queue_detail'])
on conflict do nothing;

create table if not exists market_private.review_column_acl_snapshot (
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
revoke all on table market_private.review_column_acl_snapshot
  from public, anon, authenticated;
grant all on table market_private.review_column_acl_snapshot to service_role;

insert into market_private.review_column_acl_snapshot (
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
   and c.relname = any (array['review_queue', 'v_admin_queue_detail'])
on conflict do nothing;

create table if not exists market_private.review_policy_snapshot (
  policy_name text primary key,
  is_permissive boolean not null,
  command_code "char" not null,
  role_names text[] not null,
  using_expression text,
  check_expression text
);
revoke all on table market_private.review_policy_snapshot
  from public, anon, authenticated;
grant all on table market_private.review_policy_snapshot to service_role;

insert into market_private.review_policy_snapshot (
  policy_name, is_permissive, command_code, role_names,
  using_expression, check_expression
)
select p.polname, p.polpermissive, p.polcmd,
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
 where p.polrelid = 'public.review_queue'::regclass
on conflict do nothing;

-- The administrator view historically joined both identity namespaces with
-- OR, which duplicates a queue row when one auth UUID is another profile's
-- application UUID. Preserve its exact definition for DOWN before replacing
-- that ambiguous join with a fail-closed one-row projection.
create table if not exists market_private.review_view_snapshot (
  view_name text primary key,
  definition text not null,
  reloptions text[]
);
revoke all on table market_private.review_view_snapshot
  from public, anon, authenticated;
grant all on table market_private.review_view_snapshot to service_role;

insert into market_private.review_view_snapshot (
  view_name, definition, reloptions
)
select c.relname, pg_catalog.pg_get_viewdef(c.oid, true), c.reloptions
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relname = 'v_admin_queue_detail'
   and c.relkind = 'v'
on conflict do nothing;

-- DOWN can restore owner/superuser-authored ACLs exactly. Refuse delegated
-- grant chains before touching the public ledger because they require a
-- dependency graph rather than a deterministic flat replay.
do $review_acl_preflight$
declare
  v_relation text;
  v_grantor text;
  r record;
begin
  select x.relation_name, x.grantor
    into v_relation, v_grantor
    from (
      select relation_name, grantor
        from market_private.review_relation_acl_snapshot
      union
      select relation_name, grantor
        from market_private.review_column_acl_snapshot
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
      'MARKET_PREFLIGHT: delegated review ACL grant by % on public.% is unsupported',
      v_grantor, v_relation
      using errcode = '55000';
  end if;

  for r in
    select distinct grantor
      from (
        select grantor from market_private.review_relation_acl_snapshot
        union
        select grantor from market_private.review_column_acl_snapshot
      ) grantors
     order by grantor
  loop
    begin
      execute format('set local role %I', r.grantor);
      execute 'reset role';
    exception when others then
      raise exception
        'MARKET_PREFLIGHT: migration executor cannot assume review ACL grantor %',
        r.grantor
        using errcode = '55000';
    end;
  end loop;
end;
$review_acl_preflight$;

do $drop_review_policies$
declare
  r record;
begin
  for r in
    select policy_name from market_private.review_policy_snapshot
     order by policy_name
  loop
    execute format(
      'drop policy if exists %I on public.review_queue', r.policy_name
    );
  end loop;
  -- Also makes re-application fail closed after a partially completed attempt.
  drop policy if exists "rq: governed admin all" on public.review_queue;
end;
$drop_review_policies$;

create policy "rq: governed admin all"
on public.review_queue
as permissive for all to authenticated
using (public.fn_is_admin())
with check (public.fn_is_admin());

-- Preserve the authenticated administrator application's direct workflow,
-- while RLS makes the same table return no rows to an ordinary member.
revoke all on table public.review_queue
  from public, anon, authenticated, service_role;
do $clear_review_columns$
declare
  r record;
begin
  for r in
    select c.relname, a.attname
      from pg_catalog.pg_attribute a
      join pg_catalog.pg_class c on c.oid = a.attrelid
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = any (array['review_queue', 'v_admin_queue_detail'])
       and a.attnum > 0
       and not a.attisdropped
  loop
    execute format(
      'revoke all (%I) on table public.%I from public, anon, authenticated, service_role',
      r.attname, r.relname
    );
  end loop;
end;
$clear_review_columns$;
grant select, insert, update, delete on table public.review_queue to authenticated;
grant all on table public.review_queue to service_role;

-- The view must already evaluate base-table policies as its caller. Refuse a
-- drifted deployment instead of silently changing a view option that an
-- emergency DOWN could not reconstruct safely.
do $review_view_preflight$
declare
  v_security_invoker boolean;
begin
  select coalesce(c.reloptions @> array['security_invoker=true']::text[], false)
    into v_security_invoker
    from pg_catalog.pg_class c
   where c.oid = to_regclass('public.v_admin_queue_detail');
  if not coalesce(v_security_invoker, false) then
    raise exception 'MARKET_PREFLIGHT: v_admin_queue_detail must be security_invoker=true'
      using errcode = '55000';
  end if;
end;
$review_view_preflight$;

create or replace view public.v_admin_queue_detail
with (security_invoker = true) as
select
  rq.id, rq.listing_type, rq.listing_id, rq.submitted_by,
  rq.trust_tier_at_submit, rq.is_random_sample,
  rq.review_reason, rq.status, rq.action_taken, rq.amendment_detail,
  rq.reviewed_by, rq.reviewed_at,
  rq.submitted_at as created_at,
  coalesce(rq.reviewed_at, rq.submitted_at) as updated_at,
  u.full_name as submitter_name,
  u.email as submitter_email,
  u.trust_tier as submitter_trust_tier,
  u.clean_posts as submitter_clean_posts,
  u.strike_count as submitter_strike_count,
  cl.ref as cargo_ref, cl.commodity_name, cl.cargo_type,
  cl.qty_min_mt, cl.qty_max_mt,
  cl.load_port_name, cl.load_zone, cl.disch_port_name, cl.disch_zone,
  cl.laycan_from, cl.laycan_to, cl.is_spot,
  cl.status as cargo_status, cl.review_status as cargo_review_status,
  va.vessel_id, v.vessel_name, v.vessel_type, v.dwt_grain,
  v.risk_level, v.is_sanctioned,
  va.open_port_name, va.open_zone, va.open_date,
  va.status as vessel_status, va.review_status as vessel_review_status
from public.review_queue rq
left join lateral (
  select candidate.*
    from public.users candidate
   where (
       candidate.supabase_user_id = rq.submitted_by
       or candidate.id = rq.submitted_by
     )
     and not exists (
       select 1
         from public.users competing
        where (
            competing.supabase_user_id = rq.submitted_by
            or competing.id = rq.submitted_by
          )
          and competing.id is distinct from candidate.id
     )
   limit 1
) u on true
left join public.cargo_listings cl
  on cl.id = rq.listing_id and rq.listing_type = 'cargo'
left join public.vessel_availability va
  on va.id = rq.listing_id and rq.listing_type = 'vessel_availability'
left join public.vessels v on v.id = va.vessel_id;

revoke all on table public.v_admin_queue_detail
  from public, anon, authenticated, service_role;
grant select on table public.v_admin_queue_detail to authenticated, service_role;

-- A deliberately small member projection.  Both identity keys are accepted
-- because historical queue writers used a mixture of auth.uid() and users.id.
-- Raw queue/listing ids, review reasons, sampling flags, trust snapshots,
-- reviewer identity, administrator notes and amendment text never leave it.
create or replace function public.list_my_review_statuses(p_limit integer default 100)
returns table (
  listing_type public.listing_type_enum,
  status public.review_status_enum,
  action_taken public.review_action_enum,
  submitted_at timestamptz,
  reviewed_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_actor uuid := public.fn_market_actor();
  v_auth_id uuid := auth.uid();
  v_auth_key_safe boolean;
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 200);
begin
  if auth.role() is distinct from 'authenticated' or v_auth_id is null then
    raise exception 'MARKET_AUTH: authentication is required'
      using errcode = '42501';
  end if;

  -- A legacy row keyed by auth.uid() is attributable to this actor only when
  -- that UUID is not simultaneously another application user's primary id.
  -- The application-user mapping wins in fn_market_actor; the ambiguous raw
  -- auth key is deliberately ignored rather than exposing the other member.
  select v_auth_id = v_actor or not exists (
           select 1
             from public.users u
            where u.id = v_auth_id
              and u.id is distinct from v_actor
         )
    into v_auth_key_safe;

  return query
  select rq.listing_type, rq.status, rq.action_taken,
         rq.submitted_at, rq.reviewed_at
    from public.review_queue rq
   where rq.submitted_by = v_actor
      or (v_auth_key_safe and rq.submitted_by = v_auth_id)
   order by rq.submitted_at desc, rq.id desc
   limit v_limit;
end;
$function$;

revoke all on function public.list_my_review_statuses(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_my_review_statuses(integer)
  to authenticated;

comment on function public.list_my_review_statuses(integer) is
  'Bounded, identifier-free status history for the active member. Moderation ledger fields remain administrator-only.';

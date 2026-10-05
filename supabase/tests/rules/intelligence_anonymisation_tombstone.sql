-- Intelligence ledger integration with the shared account-erasure boundary.
-- History retains only the stable anonymous app-user UUID; direct PII and
-- access are removed by fn_anonymize_account.
begin;

do $tombstone$
declare
  v_actor constant uuid := '31030000-0000-4000-8000-000000000001';
  v_reviewer constant uuid := '31030000-0000-4000-8000-000000000002';
  v_actor_email constant text := 'intelligence-erasure-actor@example.test';
  v_actor_name constant text := 'Intelligence Erasure Actor';
  v_base uuid;
  v_revision bigint;
  v_clone jsonb;
  v_created jsonb;
  v_created_id uuid;
  v_erased jsonb;
  v_detail jsonb;
  v_events jsonb;
  v_denied boolean;
begin
  insert into auth.users(id, email)
  values
    (v_actor, v_actor_email),
    (v_reviewer, 'intelligence-erasure-reviewer@example.test');

  insert into public.users(
    id, supabase_user_id, email, full_name, company, role, phone,
    is_active, admin_tier, subscription_tier, notes
  ) values
    (v_actor, v_actor, v_actor_email, v_actor_name, 'Erase Intelligence Co',
      'admin', '+201111111111', true, 'super', 'T4', 'erase this note'),
    (v_reviewer, null, 'intelligence-erasure-reviewer@example.test',
      'Intelligence Erasure Reviewer', null, 'admin', null, true, 'super', 'T4', null);

  select active_rule_set_id, revision into v_base, v_revision
  from public.intelligence_rule_state where singleton;
  v_clone := public.admin_intelligence_get_clone_input(v_actor, v_base);
  v_created := public.admin_intelligence_create_rule_set(
    v_actor,
    v_clone->'document',
    v_clone->'provenance',
    'Erasure ledger proof',
    'Creates immutable Intelligence history before account erasure',
    v_base,
    '31030000-0000-4000-8000-000000000011'
  );
  v_created_id := (v_created->>'ruleSetId')::uuid;
  perform public.admin_intelligence_activate_rule_set(
    v_actor,
    v_created_id,
    v_revision,
    '31030000-0000-4000-8000-000000000012'
  );

  if not exists (select 1 from public.intelligence_rule_sets where id=v_created_id and created_by=v_actor)
     or not exists (select 1 from public.intelligence_rule_requests where actor_user_id=v_actor)
     or not exists (select 1 from public.intelligence_rule_events where actor_user_id=v_actor)
     or (select activated_by from public.intelligence_rule_state where singleton) is distinct from v_actor then
    raise exception 'INTELLIGENCE TOMBSTONE: actor-linked history was not established';
  end if;

  v_erased := public.fn_anonymize_account(v_actor);
  if v_erased->>'status' <> 'anonymized' or (v_erased->>'app_user_id')::uuid <> v_actor then
    raise exception 'INTELLIGENCE TOMBSTONE: account erasure returned %', v_erased;
  end if;
  if not exists (
    select 1 from public.users u
    where u.id=v_actor and u.erased_at is not null and not u.is_active
      and u.full_name='Deleted account' and u.email is null and u.phone is null
      and u.company is null and u.role is null and u.admin_tier is null
      and u.admin_perms is null and u.notes is null and u.supabase_user_id is null
  ) then
    raise exception 'INTELLIGENCE TOMBSTONE: canonical anonymous user tombstone is incomplete';
  end if;

  -- Commercial/audit history survives, but it points only at the scrubbed
  -- tombstone and never receives a copied email/name snapshot.
  if not exists (select 1 from public.intelligence_rule_sets where id=v_created_id and created_by=v_actor)
     or not exists (select 1 from public.intelligence_rule_requests where actor_user_id=v_actor)
     or not exists (select 1 from public.intelligence_rule_events where actor_user_id=v_actor)
     or (select activated_by from public.intelligence_rule_state where singleton) is distinct from v_actor then
    raise exception 'INTELLIGENCE TOMBSTONE: immutable history did not survive erasure';
  end if;

  v_detail := public.admin_intelligence_get_rule_set(v_reviewer, v_created_id);
  v_events := public.admin_intelligence_list_events(v_reviewer, 100);
  if v_detail::text ilike '%' || v_actor_email || '%'
     or v_detail::text ilike '%' || v_actor_name || '%'
     or v_events::text ilike '%' || v_actor_email || '%'
     or v_events::text ilike '%' || v_actor_name || '%' then
    raise exception 'INTELLIGENCE TOMBSTONE: actor PII leaked through admin history';
  end if;

  v_denied := false;
  begin
    perform public.admin_intelligence_list_rule_sets(v_actor);
  exception when insufficient_privilege then
    v_denied := true;
  end;
  if not v_denied then
    raise exception 'INTELLIGENCE TOMBSTONE: erased actor retained administration access';
  end if;

  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', v_actor, 'role', 'authenticated',
    'app_metadata', jsonb_build_object('role', 'admin')
  )::text, true);
  execute 'set local role authenticated';
  v_denied := false;
  begin
    perform public.get_intelligence_rules();
  exception when insufficient_privilege then
    v_denied := true;
  end;
  execute 'reset role';
  if not v_denied then
    raise exception 'INTELLIGENCE TOMBSTONE: erased identity retained member rule access';
  end if;

  v_erased := public.fn_anonymize_account(v_actor);
  if v_erased->>'status' <> 'already_anonymized' then
    raise exception 'INTELLIGENCE TOMBSTONE: repeat erasure is not idempotent: %', v_erased;
  end if;
end;
$tombstone$;

select 'INTELLIGENCE TOMBSTONE: ALL ASSERTIONS PASSED' as result;
rollback;

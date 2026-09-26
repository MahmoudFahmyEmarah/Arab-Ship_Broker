begin;

do $$
declare
  v_auth_one constant uuid := 'f3000000-0000-4000-8000-000000000001';
  v_app_one constant uuid := 'f3000000-0000-4000-8000-000000000001';
  v_auth_two constant uuid := 'f3000000-0000-4000-8000-000000000002';
  v_app_two constant uuid := 'f3000000-0000-4000-8000-000000000002';
  v_before text;
  v_failed boolean;
begin
  insert into auth.users (id, email, raw_app_meta_data)
  values
    (v_auth_one, 'profile-one@asb.test', '{}'::jsonb),
    (v_auth_two, 'profile-two@asb.test', '{}'::jsonb);

  insert into public.users (
    id, supabase_user_id, full_name, company, phone, email, role,
    subscription_tier, admin_tier, admin_perms, trust_tier, strike_count,
    clean_posts, is_active
  ) values
    (v_app_one, v_auth_one, 'Profile One', 'One Co', '+201',
      'profile-one@asb.test', 'broker', 'T1', null, null, 'NEW', 0, 0, true),
    (v_app_two, v_auth_two, 'Profile Two', 'Two Co', '+202',
      'profile-two@asb.test', 'broker', 'T1', null, null, 'NEW', 0, 0, true);

  -- Reproduce a normal browser JWT for the first member.
  perform set_config('request.jwt.claim.sub', v_auth_one::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_auth_one, 'role', 'authenticated',
    'app_metadata', json_build_object('role', 'member')
  )::text, true);
  execute 'set local role authenticated';

  update public.users set full_name = 'Profile One Updated' where id = v_app_one;
  if (select full_name from public.users where id = v_app_one) <> 'Profile One Updated' then
    raise exception 'U1: allowed profile update did not persist';
  end if;

  foreach v_before in array array[
    'role = ''admin''',
    'subscription_tier = ''T4''',
    'admin_tier = ''super''',
    'admin_perms = ''{"fixtures":"edit"}''::jsonb',
    'trust_tier = ''VERIFIED''',
    'strike_count = 1',
    'clean_posts = 99',
    'is_active = false',
    'is_market_partner = true',
    'supabase_user_id = ''f3000000-0000-4000-8000-000000000002''::uuid'
  ] loop
    v_failed := false;
    begin
      execute format('update public.users set %s where id = %L', v_before, v_app_one);
    exception when insufficient_privilege then
      v_failed := true;
    end;
    if not v_failed then
      raise exception 'U2: privileged update was accepted: %', v_before;
    end if;
  end loop;

  update public.users set full_name = 'Cross account overwrite' where id = v_app_two;
  if found then
    raise exception 'U3: a member updated a second profile';
  end if;

  execute 'reset role';
  if exists (
    select 1 from public.users
    where id = v_app_one
      and (role <> 'broker' or subscription_tier <> 'T1' or admin_tier is not null
        or admin_perms is not null or trust_tier <> 'NEW' or strike_count <> 0
        or clean_posts <> 0 or not is_active or is_market_partner
        or supabase_user_id <> v_auth_one)
  ) then
    raise exception 'U2: privileged values changed despite the guard';
  end if;

  -- Service-owned promotion writes the Auth app_metadata claim, then an
  -- inactive/demoted row immediately fails fn_is_admin even with a stale JWT.
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object(
    'role', 'service_role', 'app_metadata', '{}'::jsonb
  )::text, true);
  execute 'set local role service_role';
  update public.users
     set role = 'admin', admin_tier = 'sub'
   where id = v_app_one;
  execute 'reset role';
  if not exists (
    select 1 from auth.users where id = v_auth_one
      and raw_app_meta_data ->> 'role' = 'admin'
  ) then
    raise exception 'U4: promotion did not synchronize app_metadata.role';
  end if;

  perform set_config('request.jwt.claim.sub', v_auth_one::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_auth_one, 'role', 'authenticated',
    'app_metadata', json_build_object('role', 'admin')
  )::text, true);
  execute 'set local role authenticated';
  if not public.fn_is_admin() then
    raise exception 'U4: synchronized active administrator was not recognized';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object(
    'role', 'service_role', 'app_metadata', '{}'::jsonb
  )::text, true);
  execute 'set local role service_role';
  update public.users set role = 'broker', admin_tier = null, admin_perms = null where id = v_app_one;
  perform set_config('request.jwt.claim.sub', v_auth_one::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_auth_one, 'role', 'authenticated',
    'app_metadata', json_build_object('role', 'admin')
  )::text, true);
  execute 'set local role authenticated';
  if public.fn_is_admin() then
    raise exception 'U5: stale JWT retained administrator authority after demotion';
  end if;
  execute 'reset role';

  -- An approved review writes the submitter's reputation counters through the
  -- service-owned review path. An authenticated administrator remains unable
  -- to change those counters directly (the server action is statically pinned
  -- to the service client by user-privilege-boundary-check.mjs).
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', json_build_object(
    'role', 'service_role', 'app_metadata', '{}'::jsonb
  )::text, true);
  execute 'set local role service_role';
  update public.users
     set role = 'admin', admin_tier = 'super', subscription_tier = 'T4'
   where id = v_app_one;
  insert into public.review_queue (
    listing_type, listing_id, submitted_by, trust_tier_at_submit, status
  ) values (
    'cargo', 'f3000000-0000-4000-8000-000000000099', v_app_two, 'NEW', 'PENDING'
  );
  update public.review_queue
     set status = 'APPROVED', action_taken = 'approved', reviewed_by = v_app_one
   where submitted_by = v_app_two and status = 'PENDING';
  if (select clean_posts from public.users where id = v_app_two) <> 1 then
    raise exception 'U7: service-owned review did not increment clean_posts';
  end if;

  perform set_config('request.jwt.claim.sub', v_auth_one::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', v_auth_one, 'role', 'authenticated',
    'app_metadata', json_build_object('role', 'admin')
  )::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    update public.users set clean_posts = clean_posts + 1 where id = v_app_two;
  exception when insufficient_privilege then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'U7: authenticated admin directly updated a member counter';
  end if;
  execute 'reset role';

  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'users' and policyname = 'users: own row') then
    raise exception 'U6: broad users: own row policy still exists';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'users'
      and policyname = 'users: own profile update'
      and with_check is not null
  ) then
    raise exception 'U6: own-profile policy is missing WITH CHECK';
  end if;

  raise notice 'user_privilege_boundary_smoke: ALL ASSERTIONS PASSED';
end $$;

rollback;

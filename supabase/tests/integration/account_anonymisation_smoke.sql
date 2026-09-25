begin;

do $$
declare
  v_auth_id constant uuid := 'f1000000-0000-4000-8000-000000000001';
  v_org_id constant uuid := 'f1000000-0000-4000-8000-000000000002';
  v_vessel_id constant uuid := 'f1000000-0000-4000-8000-000000000003';
  v_customer_id constant uuid := 'f1000000-0000-4000-8000-000000000004';
  v_result jsonb;
begin
  if has_function_privilege('authenticated', 'public.fn_anonymize_account(uuid)', 'EXECUTE') then
    raise exception 'S1: authenticated may execute the service-only erasure function';
  end if;
  if not has_function_privilege('service_role', 'public.fn_anonymize_account(uuid)', 'EXECUTE') then
    raise exception 'S1: service_role cannot execute the erasure function';
  end if;

  insert into auth.users (id, email)
  values (v_auth_id, 'erase-me@asb.test');

  insert into public.users (
    id, supabase_user_id, full_name, company, role, phone, email,
    trust_tier, clean_posts, strike_count, subscription_tier,
    declared_role, admin_tier, admin_perms, notes
  ) values (
    v_auth_id, v_auth_id, 'Erase Me', 'Private Co', 'broker', '+20123456789',
    'erase-me@asb.test', 'VERIFIED', 12, 1, 'T3', 'broker_dual', 'sub',
    '{"billing":true}'::jsonb, 'private note'
  );

  insert into public.profiles (
    account_id, profile_type, display_name, company, phone, notes,
    operating_zones, preferred_cargo, dwt_min, dwt_max
  ) values (
    v_auth_id, 'cargo', 'Personal desk', 'Private Co', '+20123456789',
    'profile note', array['E.MED'::public.zone_enum], array['grain'], 5000, 15000
  );

  insert into public.organizations (id, name, org_type)
  values (v_org_id, 'Erasure Test Org', 'broker');
  insert into public.organization_members (
    org_id, user_id, member_role, is_current, status,
    requested_company_name, requested_email_domain, plan_seat
  ) values (
    v_org_id, v_auth_id, 'broker', true, 'active',
    'Private Co', 'asb.test', true
  );

  insert into public.vessels (id, vessel_name, imo_number, vessel_type)
  values (v_vessel_id, 'ERASURE TEST VESSEL', '9999001', 'Bulk Carrier');
  insert into public.vessel_claims (vessel_id, user_id, role)
  values (v_vessel_id, v_auth_id, 'owner');

  insert into public.market_insights_subscribers (email, source)
  values ('erase-me@asb.test', 'erasure_test');

  insert into public.billing_customers (
    id, user_id, legal_name, legal_name_ar, tax_id, address,
    billing_email, phone, notes, created_by
  ) values (
    v_customer_id, v_auth_id, 'Erase Me Legal', 'Erase Arabic', 'TAX-PII',
    '{"street":"Secret Street"}'::jsonb, 'billing@asb.test', '+209999',
    'billing PII', v_auth_id
  );
  insert into public.subscriptions (
    customer_id, plan_code, status, gateway_customer_id, gateway_token_ref,
    notes, created_by
  ) values (
    v_customer_id, 'T3', 'active', 'gateway-person', 'secret-token',
    'subscription PII', v_auth_id
  );

  v_result := public.fn_anonymize_account(v_auth_id);
  if v_result->>'status' <> 'anonymized' then
    raise exception 'S2: first erasure returned %', v_result;
  end if;

  if not exists (
    select 1 from public.users
    where id = v_auth_id
      and erased_at is not null
      and full_name = 'Deleted account'
      and email is null and phone is null and company is null
      and role is null and notes is null and supabase_user_id is null
      and not is_active and subscription_tier = 'T1' and trust_tier = 'NEW'
  ) then
    raise exception 'S2: user tombstone is missing or still contains PII/access';
  end if;

  if exists (
    select 1 from public.profiles
    where account_id = v_auth_id
      and (display_name is not null or company is not null or phone is not null
        or notes is not null or operating_zones is not null
        or preferred_cargo is not null or dwt_min is not null or dwt_max is not null
        or is_active)
  ) then
    raise exception 'S2: profile PII or access survived';
  end if;

  if not exists (
    select 1 from public.organization_members
    where org_id = v_org_id and user_id = v_auth_id
      and not is_current and status = 'rejected' and not plan_seat
      and requested_company_name is null and requested_email_domain is null
  ) then
    raise exception 'S2: organisation access survived';
  end if;

  if exists (select 1 from public.vessel_claims where user_id = v_auth_id) then
    raise exception 'S2: vessel access survived';
  end if;
  if exists (select 1 from public.market_insights_subscribers where email = 'erase-me@asb.test') then
    raise exception 'S2: newsletter identity survived';
  end if;

  if not exists (
    select 1 from public.billing_customers
    where id = v_customer_id and legal_name = 'Deleted account'
      and legal_name_ar is null and tax_id is null and address = '{}'::jsonb
      and billing_email is null and phone is null and notes is null and created_by is null
  ) then
    raise exception 'S2: personal billing customer was not scrubbed';
  end if;
  if not exists (
    select 1 from public.subscriptions
    where customer_id = v_customer_id and status = 'canceled'
      and cancel_at_period_end and gateway_customer_id is null
      and gateway_token_ref is null and notes is null and created_by is null
  ) then
    raise exception 'S2: subscription was not canceled and scrubbed';
  end if;
  if exists (
    select 1 from public.billing_events
    where actor = v_auth_id
       or coalesce(before::text, '') like '%erase-me@asb.test%'
       or coalesce(after::text, '') like '%erase-me@asb.test%'
       or coalesce(before::text, '') like '%secret-token%'
       or coalesce(after::text, '') like '%secret-token%'
  ) then
    raise exception 'S2: billing audit retained mutable PII or a gateway token';
  end if;

  -- The database boundary intentionally leaves Auth deletion to the server
  -- action; the FK anchor must still exist at this point.
  if not exists (select 1 from auth.users where id = v_auth_id) then
    raise exception 'S2: database erasure unexpectedly hard-deleted Auth';
  end if;

  v_result := public.fn_anonymize_account(v_auth_id);
  if v_result->>'status' <> 'already_anonymized' then
    raise exception 'S3: repeat erasure is not idempotent: %', v_result;
  end if;

  raise notice 'account_anonymisation_smoke: ALL ASSERTIONS PASSED';
end $$;

rollback;

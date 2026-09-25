-- Shared integration: account erasure without deleting immutable history.
--
-- PDA estimates and Fixture Room events deliberately retain their actor UUIDs
-- for commercial/audit integrity.  The user row therefore becomes a stable,
-- anonymous tombstone and the Auth identity is soft-deleted by the server
-- action after this transaction succeeds.

alter table public.users
  add column if not exists erased_at timestamptz;

comment on column public.users.erased_at is
  'When set, direct account PII has been scrubbed and this row is an anonymous history tombstone.';

create or replace function public.fn_anonymize_account(p_auth_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_app_user_id uuid;
  v_match_count integer;
  v_old_email text;
  v_customer_ids uuid[];
begin
  if p_auth_user_id is null then
    raise exception using errcode = '22004', message = 'AUTH_USER_ID_REQUIRED';
  end if;

  select count(distinct u.id)
    into v_match_count
  from public.users u
  where u.supabase_user_id = p_auth_user_id
     or u.id = p_auth_user_id;

  if v_match_count = 0 then
    raise exception using errcode = 'P0002', message = 'ACCOUNT_NOT_FOUND';
  elsif v_match_count > 1 then
    raise exception using errcode = 'P0003', message = 'ACCOUNT_IDENTITY_AMBIGUOUS';
  end if;

  select u.id, u.email
    into v_app_user_id, v_old_email
  from public.users u
  where u.supabase_user_id = p_auth_user_id
     or u.id = p_auth_user_id
  limit 1;

  -- Lock the identity row so two erasure requests cannot interleave.
  perform 1 from public.users where id = v_app_user_id for update;

  if (select erased_at is not null from public.users where id = v_app_user_id) then
    return jsonb_build_object(
      'status', 'already_anonymized',
      'app_user_id', v_app_user_id
    );
  end if;

  -- Revoke access-bearing relationships while retaining the commercial rows
  -- that refer to the anonymous app-user UUID.
  update public.organization_members
     set is_current = false,
         status = 'rejected',
         requested_company_name = null,
         requested_email_domain = null,
         decided_at = now(),
         decided_by = null,
         plan_seat = false
   where user_id = v_app_user_id;

  delete from public.vessel_claims
   where user_id = p_auth_user_id;

  update public.profiles
     set display_name = null,
         company = null,
         phone = null,
         notes = null,
         operating_zones = null,
         preferred_cargo = null,
         dwt_min = null,
         dwt_max = null,
         is_active = false
   where account_id = v_app_user_id;

  if v_old_email is not null then
    delete from public.market_insights_subscribers
     where lower(email) = lower(v_old_email);
  end if;

  -- Personal billing rows remain as ledger anchors, while mutable contact and
  -- gateway data is removed. Issued invoice snapshots are retained because
  -- they are statutory accounting records and are already immutable.
  select array_agg(c.id)
    into v_customer_ids
  from public.billing_customers c
  where c.user_id = v_app_user_id;

  if coalesce(cardinality(v_customer_ids), 0) > 0 then
    update public.subscriptions
       set status = 'canceled',
           cancel_at_period_end = true,
           gateway_customer_id = null,
           gateway_token_ref = null,
           notes = null,
           created_by = null,
           updated_at = now()
     where customer_id = any(v_customer_ids);

    update public.billing_customers
       set legal_name = 'Deleted account',
           legal_name_ar = null,
           tax_id = null,
           address = '{}'::jsonb,
           billing_email = null,
           phone = null,
           notes = null,
           created_by = null,
           updated_at = now()
     where id = any(v_customer_ids);

    -- Billing updates are audited. Scrub the copies in that audit stream too,
    -- while preserving entity/action/timestamp evidence.
    update public.billing_events
       set actor = case when actor = p_auth_user_id then null else actor end,
           before = case when before is null then null else before - array[
             'legal_name', 'legal_name_ar', 'tax_id', 'address',
             'billing_email', 'phone', 'notes', 'created_by'
           ] end,
           after = case when after is null then null else after - array[
             'legal_name', 'legal_name_ar', 'tax_id', 'address',
             'billing_email', 'phone', 'notes', 'created_by'
           ] end
     where entity = 'billing_customers'
       and entity_id = any(v_customer_ids);

    update public.billing_events
       set actor = case when actor = p_auth_user_id then null else actor end,
           before = case when before is null then null else before - array[
             'gateway_customer_id', 'gateway_token_ref', 'notes', 'created_by'
           ] end,
           after = case when after is null then null else after - array[
             'gateway_customer_id', 'gateway_token_ref', 'notes', 'created_by'
           ] end
     where entity = 'subscriptions'
       and ((before->>'customer_id')::uuid = any(v_customer_ids)
         or (after->>'customer_id')::uuid = any(v_customer_ids));
  end if;

  update public.billing_events
     set actor = null
   where actor = p_auth_user_id;

  update public.users
     set full_name = 'Deleted account',
         company = null,
         role = null,
         phone = null,
         email = null,
         trust_tier = 'NEW',
         clean_posts = 0,
         strike_count = 0,
         is_active = false,
         notes = null,
         subscription_tier = 'T1',
         declared_role = null,
         admin_tier = null,
         admin_perms = null,
         supabase_user_id = null,
         erased_at = now(),
         updated_at = now()
   where id = v_app_user_id;

  return jsonb_build_object(
    'status', 'anonymized',
    'app_user_id', v_app_user_id
  );
end;
$$;

revoke all on function public.fn_anonymize_account(uuid)
  from public, anon, authenticated;
grant execute on function public.fn_anonymize_account(uuid)
  to service_role;

comment on function public.fn_anonymize_account(uuid) is
  'Service-role erasure boundary: scrubs mutable PII and access while retaining anonymous commercial history.';

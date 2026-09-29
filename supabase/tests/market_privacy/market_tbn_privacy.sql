-- Market / TBN privacy firewall - transactional SQL proof (29 Sep 2026).
--
-- Run after 20260923360000_market_candidate_handles.sql and
-- 20260923361000_market_tbn_firewall.sql and
-- 20260923362000_market_review_status_firewall.sql. The fixture is deliberately hostile:
-- every raw UUID and every private TBN/poster identity is a canary. A governed
-- non-owner response must contain none of them, even as nested JSON text.
--
-- This file owns no durable rows: the harness runs it with ON_ERROR_STOP and
-- the final ROLLBACK removes every seed and handle.

begin;

set local session_replication_role = replica;

create temp table mp_ids (k text primary key, v uuid not null);
grant all on table mp_ids to authenticated, anon, service_role;
insert into mp_ids (k, v) values
  ('org_owner', '10000000-0000-4000-8000-000000000001'),
  ('org_cargo', '10000000-0000-4000-8000-000000000002'),
  ('org_other', '10000000-0000-4000-8000-000000000003'),
  ('org_manager','10000000-0000-4000-8000-000000000004'),
  ('u_owner',   '10000000-0000-4000-8000-000000000011'),
  ('u_seat',    '10000000-0000-4000-8000-000000000012'),
  ('u_pending', '10000000-0000-4000-8000-000000000013'),
  ('u_ended',   '10000000-0000-4000-8000-000000000014'),
  ('u_out',     '10000000-0000-4000-8000-000000000015'),
  ('u_admin',   '10000000-0000-4000-8000-000000000016'),
  ('u_cargo',   '10000000-0000-4000-8000-000000000017'),
  ('u_dual',    '10000000-0000-4000-8000-000000000018'),
  ('auth_dual', '10000000-0000-4000-8000-000000000019'),
  ('u_review_out', '10000000-0000-4000-8000-000000000020'),
  ('cargo',     '10000000-0000-4000-8000-000000000021'),
  ('cargo_old', '10000000-0000-4000-8000-000000000022'),
  ('v_tbn',     '10000000-0000-4000-8000-000000000031'),
  ('v_old',     '10000000-0000-4000-8000-000000000033'),
  ('v_rpc',     '10000000-0000-4000-8000-000000000034'),
  ('v_dup_a',   '10000000-0000-4000-8000-000000000035'),
  ('v_dup_b',   '10000000-0000-4000-8000-000000000036'),
  ('v_ws_imo',  '10000000-0000-4000-8000-000000000037'),
  ('a_tbn',     '10000000-0000-4000-8000-000000000041'),
  ('v_named',   '10000000-0000-4000-8000-000000000032'),
  ('a_named',   '10000000-0000-4000-8000-000000000042'),
  ('a_old',     '10000000-0000-4000-8000-000000000043'),
  ('vch_tbn',   '10000000-0000-4000-8000-000000000051'),
  ('stale_cargo_owner_key',  '10000000-0000-4000-8000-000000000061'),
  ('stale_cargo_admin_key',  '10000000-0000-4000-8000-000000000062'),
  ('stale_vessel_owner_key', '10000000-0000-4000-8000-000000000063'),
  ('stale_vessel_admin_key', '10000000-0000-4000-8000-000000000064');

create or replace function pg_temp.mp_id(p_k text) returns uuid
language sql stable as $$ select v from mp_ids where k = p_k $$;

create or replace function pg_temp.mp_as(p_k text, p_admin boolean default false)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', pg_temp.mp_id(p_k)::text, true);
  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', pg_temp.mp_id(p_k),
      'role', 'authenticated',
      'app_metadata', case when p_admin then jsonb_build_object('role', 'admin') else jsonb_build_object('role', 'member') end
    )::text,
    true
  );
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.mp_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  execute 'set local role anon';
end $$;

create or replace function pg_temp.mp_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
end $$;

create or replace function pg_temp.mp_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Execute a scalar/json statement and return the stable application prefix,
-- or SQLSTATE for a privilege-layer refusal. Unknown keys deliberately look
-- identical to another actor's keys.
create or replace function pg_temp.mp_err(p_sql text) returns text
language plpgsql as $$
declare v jsonb;
begin
  execute p_sql into v;
  return 'OK';
exception when others then
  return coalesce(
    substring(sqlerrm from '^(MARKET_[A-Z_]+):'),
    substring(sqlerrm from '^(FX_[A-Z_]+):'),
    sqlstate
  );
end $$;

create or replace function pg_temp.mp_key(p_rows jsonb, p_commodity text default null, p_vessel_name text default null)
returns uuid language sql immutable as $$
  select coalesce(x->>'listing_key', x->>'id')::uuid
    from jsonb_array_elements(p_rows) x
   where (p_commodity is null or coalesce(x->>'commodity_name', x->'cargo'->>'commodity_name') = p_commodity)
     and (p_vessel_name is null or coalesce(x->>'vessel_name', x->'vessel'->>'vessel_name') = p_vessel_name)
   limit 1
$$;

create or replace function pg_temp.mp_has(p_text text, p_needle text) returns boolean
language sql immutable as $$ select position(lower(p_needle) in lower(p_text)) > 0 $$;

create or replace function pg_temp.mp_actor() returns uuid
language sql stable security definer
set search_path to 'pg_catalog', 'public'
as $$ select public.fn_market_actor() $$;
grant execute on function pg_temp.mp_actor() to authenticated;

insert into auth.users (id, email, aud, role, raw_app_meta_data)
select v, k || '@market-privacy.test', 'authenticated', 'authenticated',
       case when k = 'u_admin' then '{"role":"admin"}'::jsonb else '{"role":"member"}'::jsonb end
  from mp_ids
 where (k like 'u\_%' and k <> 'u_dual') or k = 'auth_dual'
on conflict (id) do nothing;

insert into public.organizations (
  id, name, org_type, desk_contact_name, desk_email, desk_phone,
  address, imo, country, fleet_total
) values
  (pg_temp.mp_id('org_owner'), 'HIDDEN TBN POSTER ORG', 'owner', 'HIDDEN TBN DESK', 'hidden-desk@privacy.test', '+30 555 9911',
   'HIDDEN TBN OWNER ADDRESS', '1234567', 'Egypt', 7),
  (pg_temp.mp_id('org_cargo'), 'Privacy Charterers', 'charterer', 'Cargo Desk', 'cargo-desk@privacy.test', '+20 555 9922',
   null, null, 'Egypt', null),
  (pg_temp.mp_id('org_other'), 'Unrelated Seat Org', 'broker', 'Other Desk', 'other@privacy.test', null,
   null, null, null, null),
  (pg_temp.mp_id('org_manager'), 'HIDDEN TBN MANAGER ORG', 'manager', 'HIDDEN MANAGER DESK', 'hidden-manager@privacy.test', '+30 555 9933',
   'HIDDEN TBN MANAGER ADDRESS', '7654321', 'Greece', 9)
on conflict (id) do nothing;

insert into public.users (id, supabase_user_id, email, full_name, company, role, subscription_tier, is_active) values
  (pg_temp.mp_id('u_owner'),   pg_temp.mp_id('u_owner'),   'u_owner@market-privacy.test',   'HIDDEN TBN POSTER PERSON', 'HIDDEN TBN POSTER COMPANY', 'vessel_owner', 'T3', true),
  (pg_temp.mp_id('u_seat'),    pg_temp.mp_id('u_seat'),    'u_seat@market-privacy.test',    'Exact Active Seat',         'HIDDEN TBN POSTER ORG',     'vessel_owner', 'T3', true),
  (pg_temp.mp_id('u_pending'), pg_temp.mp_id('u_pending'), 'u_pending@market-privacy.test', 'Pending Seat',              'HIDDEN TBN POSTER ORG',     'vessel_owner', 'T3', true),
  (pg_temp.mp_id('u_ended'),   pg_temp.mp_id('u_ended'),   'u_ended@market-privacy.test',   'Ended Seat',                'HIDDEN TBN POSTER ORG',     'vessel_owner', 'T3', true),
  -- A broker is deliberately used as the outsider: it passes the legacy
  -- position RPC's coarse role gate but owns no target vessel or listing.
  (pg_temp.mp_id('u_out'),     pg_temp.mp_id('u_out'),     'u_out@market-privacy.test',     'Privacy Outsider',          'Outsider Co',               'broker',       'T3', true),
  (pg_temp.mp_id('u_admin'),   pg_temp.mp_id('u_admin'),   'u_admin@market-privacy.test',   'Privacy Admin',             'Arab ShipBroker',           'admin',        'T4', true),
  (pg_temp.mp_id('u_cargo'),   pg_temp.mp_id('u_cargo'),   'u_cargo@market-privacy.test',   'Privacy Charterer',         'Privacy Charterers',        'cargo_owner',  'T3', true),
  -- Kept out of every earlier mutation scenario so M26 has a pristine
  -- unrelated-member identity even when workflow triggers enqueue reviews.
  (pg_temp.mp_id('u_review_out'), pg_temp.mp_id('u_review_out'), 'u_review_out@market-privacy.test', 'Review Projection Outsider', 'Review Outsider Co', 'broker', 'T3', true),
  -- Deliberately distinct application/auth UUIDs. Ownership and private handle
  -- storage must use u_dual; request.jwt.claim.sub uses auth_dual.
  (pg_temp.mp_id('u_dual'),    pg_temp.mp_id('auth_dual'), 'u_dual@market-privacy.test',    'Dual Key Exact Seat',       'HIDDEN TBN POSTER ORG',     'vessel_owner', 'T3', true)
on conflict (id) do nothing;

insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
  (pg_temp.mp_id('org_owner'), pg_temp.mp_id('u_owner'),   'admin',  true,  'active'),
  (pg_temp.mp_id('org_owner'), pg_temp.mp_id('u_seat'),    'broker', true,  'active'),
  (pg_temp.mp_id('org_owner'), pg_temp.mp_id('u_pending'), 'broker', true,  'pending'),
  (pg_temp.mp_id('org_owner'), pg_temp.mp_id('u_ended'),   'broker', false, 'active'),
  (pg_temp.mp_id('org_owner'), pg_temp.mp_id('u_dual'),    'broker', true,  'active'),
  -- The recorded poster has two current active seats. Poster resolution must
  -- select the listing's exact owner_org_id, never an arbitrary member org.
  (pg_temp.mp_id('org_other'), pg_temp.mp_id('u_owner'),   'broker', true,  'active'),
  (pg_temp.mp_id('org_cargo'), pg_temp.mp_id('u_cargo'),   'admin',  true,  'active'),
  (pg_temp.mp_id('org_other'), pg_temp.mp_id('u_out'),     'admin',  true,  'active')
on conflict do nothing;

insert into public.ports (locode, trade_name, country, zone, port_type, is_active, is_verified) values
  ('ZZMPA', 'Privacy Load Port',  'Egypt',  'E.MED', 'Sea Port', true, true),
  ('ZZMPB', 'Privacy Disch Port', 'Turkey', 'E.MED', 'Sea Port', true, true)
on conflict do nothing;

insert into public.cargo_listings (
  id, ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo,
  qty_min_mt, qty_max_mt, load_port_locode, load_port_name, load_zone,
  disch_port_locode, disch_port_name, disch_zone, laycan_from, laycan_to,
  is_spot, load_terms, freight_idea_usd_mt, broker, notes, created_at,
  refreshed_at
) values
  (pg_temp.mp_id('cargo'), 'MPC-001', 'IN', 'APPROVED', 'Dry Bulk', 'PRIVACY TEST WHEAT', false, true,
   29000, 31000, 'ZZMPA', 'Privacy Load Port', 'E.MED',
   'ZZMPB', 'Privacy Disch Port', 'E.MED', current_date + 10, current_date + 20,
   false, 'FIOST', 25.00, 'HIDDEN CARGO POSTER PERSON', 'private cargo owner ref', now(), now()),
  -- This row remains otherwise discoverable (approved/IN, non-spot and newly
  -- created) so only discovery_fresh_ok can reject its stale refreshed_at.
  (pg_temp.mp_id('cargo_old'), 'MPC-OLD', 'IN', 'APPROVED', 'Dry Bulk', 'STALE PRIVACY CARGO', false, true,
   29000, 31000, 'ZZMPA', 'Privacy Load Port', 'E.MED',
   'ZZMPB', 'Privacy Disch Port', 'E.MED', null, null,
   false, 'FIOST', 24.00, 'Stale Poster', 'strict discovery freshness canary', now(), now() - interval '2 years')
on conflict (id) do nothing;

insert into public.vessels (
  id, vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag,
  is_geared, grain_certified, dg_certified, max_draft_m, is_sanctioned,
  owner_company, owner_country, manager_company, manager_country,
  pic_name, email_chartering, is_tbn
) values
  -- The unknown flag deliberately places the TBN in v_vessel_flag_issues so
  -- that the DQ view is proven as an admin/service surface, not a member-side
  -- identity bypass.
  (pg_temp.mp_id('v_tbn'), 'HIDDEN TBN HULL ZEUS', '9765433', 'Bulk Carrier', 30000, 2014, 'PRIVACY UNKNOWN FLAG', true, true, false, 10.5, false,
   'HIDDEN TBN POSTER ORG', 'Egypt', 'HIDDEN TBN MANAGER ORG', 'Greece',
   'HIDDEN TBN PIC', 'hidden-tbn@privacy.test', true),
  (pg_temp.mp_id('v_named'), 'PUBLIC NAMED HULL', '9123457', 'Bulk Carrier', 30500, 2013, 'Malta', true, true, false, 10.6, false,
   'HIDDEN NAMED OWNER COMPANY', null, null, null,
   'HIDDEN NAMED PIC', 'hidden-named@privacy.test', false),
  (pg_temp.mp_id('v_old'), 'PUBLIC STALE HULL', '9000001', 'Bulk Carrier', 30200, 2012, 'Malta', true, true, false, 10.4, false,
    'Stale Owner', null, null, null,
    'Stale PIC', 'stale-vessel@privacy.test', false),
  -- Valid IMO canary for the legacy entry_mode=new existing-IMO path.
  (pg_temp.mp_id('v_rpc'), 'RPC EXISTING HULL', '9876505', 'Bulk Carrier', 28000, 2018, 'Malta', true, true, false, 9.8, false,
    'RPC ORIGINAL OWNER', null, 'RPC ORIGINAL MANAGER', null,
    'RPC ORIGINAL PIC', 'rpc-existing@privacy.test', false),
  -- The deployed uniqueness check is bytewise, so a historical whitespace
  -- variant can coexist with its canonical IMO. One is claimed by the test
  -- broker below; new-mode posting must reject the canonical pair.
  (pg_temp.mp_id('v_dup_a'), 'DUPLICATE IMO HULL A', '9876531', 'Bulk Carrier', 28100, 2017, 'Malta', true, true, false, 9.7, false,
    'DUPLICATE OWNER A', null, null, null,
    null, null, false),
  (pg_temp.mp_id('v_dup_b'), 'DUPLICATE IMO HULL B', ' 9876531 ', 'Bulk Carrier', 28200, 2016, 'Liberia', true, true, false, 9.6, false,
    'DUPLICATE OWNER B', null, null, null,
    null, null, false),
  (pg_temp.mp_id('v_ws_imo'), 'WHITESPACE IMO HULL', ' 9876543 ', 'Bulk Carrier', 28300, 2015, 'Malta', true, true, false, 9.5, false,
    'WHITESPACE OWNER', null, null, null,
    null, null, false)
on conflict (id) do nothing;

insert into public.vessel_claims (vessel_id, user_id, role)
values
  (pg_temp.mp_id('v_dup_a'), pg_temp.mp_id('u_out'), 'owner'),
  (pg_temp.mp_id('v_ws_imo'), pg_temp.mp_id('u_out'), 'owner')
on conflict (vessel_id, user_id) do nothing;

insert into public.vessel_availability (
  id, vessel_id, open_port_locode, open_port_name, open_zone, open_date,
  status, review_status, freight_idea_usd_mt, accepts_part_cargo, broker, notes,
  created_at, refreshed_at
) values
  (pg_temp.mp_id('a_tbn'),   pg_temp.mp_id('v_tbn'),   'ZZMPA', 'Privacy Load Port', 'E.MED', current_date + 5, 'OPEN', 'APPROVED', 26.00, false, 'HIDDEN TBN BROKER', 'HIDDEN POSITION NOTE', now(), now()),
  (pg_temp.mp_id('a_named'), pg_temp.mp_id('v_named'), 'ZZMPA', 'Privacy Load Port', 'E.MED', current_date + 5, 'OPEN', 'APPROVED', 26.50, false, 'Public Named Broker', null, now(), now()),
  -- NULL open_date avoids the future-date exception, while recent created_at
  -- passes the undated-position window. Only strict refreshed_at can reject it.
  (pg_temp.mp_id('a_old'),   pg_temp.mp_id('v_old'),   'ZZMPA', 'Privacy Load Port', 'E.MED', null, 'OPEN', 'APPROVED', 25.50, false, 'Stale Broker', 'strict discovery freshness canary', now(), now() - interval '2 years')
on conflict (id) do nothing;

insert into public.vessel_contact_history (
  id, vessel_id, change_type, owner_company, manager_company, pic_name,
  email_chartering, is_current
) values (
  pg_temp.mp_id('vch_tbn'), pg_temp.mp_id('v_tbn'), 'full_update',
  'HIDDEN CONTACT OWNER', 'HIDDEN CONTACT MANAGER', 'HIDDEN CONTACT PIC',
  'hidden-contact@privacy.test', true
)
on conflict (id) do nothing;

insert into public.listing_ownership (listing_type, listing_id, owner_user_id, owner_org_id, role, is_current, transfer_reason) values
  ('cargo', pg_temp.mp_id('cargo'), pg_temp.mp_id('u_cargo'), pg_temp.mp_id('org_cargo'), 'primary', true, 'initial_post'),
  ('cargo', pg_temp.mp_id('cargo_old'), pg_temp.mp_id('u_cargo'), pg_temp.mp_id('org_cargo'), 'primary', true, 'initial_post'),
  ('vessel_availability', pg_temp.mp_id('a_tbn'), pg_temp.mp_id('u_owner'), pg_temp.mp_id('org_owner'), 'primary', true, 'initial_post'),
  ('vessel_availability', pg_temp.mp_id('a_old'), pg_temp.mp_id('u_owner'), pg_temp.mp_id('org_owner'), 'primary', true, 'initial_post'),
  -- Keep the public named row under a different, non-canary poster.  This
  -- proves that named non-TBN display identity remains useful without making
  -- the board-wide TBN leak oracle mistake an intentional named-row poster for
  -- a disclosure of the TBN owner's identity.
  ('vessel_availability', pg_temp.mp_id('a_named'), pg_temp.mp_id('u_cargo'), pg_temp.mp_id('org_cargo'), 'primary', true, 'initial_post')
on conflict do nothing;

-- Pin server-owned windows inside this rolled-back fixture. The stale-row proof
-- must not depend on whatever values a developer happens to have in Settings.
insert into public.app_settings (key, value) values
  ('market_visibility', '{"freshDays":7,"archiveDaysByTier":{"T1":0,"T2":0,"T3":30,"T4":60},"laycanException":true}'::jsonb),
  ('platform_settings', '{"marketplace":{"spotActiveDays":14,"vesselActiveDays":14}}'::jsonb)
on conflict (key) do update set value = excluded.value;

-- Simulate still-valid board handles issued before each source became stale.
-- Match enumeration must re-check strict discovery freshness, not trust the
-- handle or let exact ownership/admin management privileges bypass it.
insert into market_private.listing_handles (
  key, actor_user_id, purpose, listing_type, listing_id, expires_at
) values
  (pg_temp.mp_id('stale_cargo_owner_key'), pg_temp.mp_id('u_cargo'), 'cargo_board', 'cargo', pg_temp.mp_id('cargo_old'), now() + interval '30 minutes'),
  (pg_temp.mp_id('stale_cargo_admin_key'), pg_temp.mp_id('u_admin'), 'cargo_board', 'cargo', pg_temp.mp_id('cargo_old'), now() + interval '30 minutes'),
  (pg_temp.mp_id('stale_vessel_owner_key'), pg_temp.mp_id('u_owner'), 'vessel_board', 'vessel_availability', pg_temp.mp_id('a_old'), now() + interval '30 minutes'),
  (pg_temp.mp_id('stale_vessel_admin_key'), pg_temp.mp_id('u_admin'), 'vessel_board', 'vessel_availability', pg_temp.mp_id('a_old'), now() + interval '30 minutes')
on conflict (key) do nothing;

-- Preserve one legacy review row whose submitted_by stores auth.uid() rather
-- than public.users.id. The current FK allows only the canonical application
-- id, so the replica-mode fixture deliberately models data written before that
-- constraint existed. M26 proves the read path handles it safely, including a
-- later namespace collision, without weakening the production constraint.
insert into public.review_queue (
  listing_type, listing_id, submitted_by, trust_tier_at_submit,
  review_reason, is_random_sample, status, admin_note, amendment_detail
) values
  ('cargo', pg_temp.mp_id('cargo'), pg_temp.mp_id('u_cargo'), 'VERIFIED',
   'M26 PRIVATE REVIEW REASON A', true, 'PENDING',
   'M26 PRIVATE ADMIN NOTE A', 'M26 PRIVATE AMENDMENT A'),
  ('cargo', pg_temp.mp_id('cargo'), pg_temp.mp_id('u_dual'), 'VERIFIED',
   'M26 PRIVATE REVIEW REASON B', false, 'PENDING',
   'M26 PRIVATE ADMIN NOTE B', 'M26 PRIVATE AMENDMENT B'),
  ('vessel_availability', pg_temp.mp_id('a_tbn'), pg_temp.mp_id('auth_dual'), 'VERIFIED',
   'M26 PRIVATE REVIEW REASON C', true, 'PENDING',
   'M26 PRIVATE ADMIN NOTE C', 'M26 PRIVATE AMENDMENT C');

set local session_replication_role = origin;

-- One canonical leak oracle. UUIDs are checked case-insensitively and both
-- hyphenated/unhyphenated; strings include vessel and TBN poster identities.
create or replace function pg_temp.mp_leaks(p_value jsonb) returns text
language sql stable as $$
  select string_agg(k, ', ' order by k)
    from (values
      ('cargo_uuid', pg_temp.mp_id('cargo')::text),
      ('tbn_availability_uuid', pg_temp.mp_id('a_tbn')::text),
      ('tbn_vessel_uuid', pg_temp.mp_id('v_tbn')::text),
      ('named_availability_uuid', pg_temp.mp_id('a_named')::text),
      ('named_vessel_uuid', pg_temp.mp_id('v_named')::text),
      ('tbn_name', 'HIDDEN TBN HULL ZEUS'),
      ('tbn_imo', '9765433'),
      ('poster_person', 'HIDDEN TBN POSTER PERSON'),
      ('poster_org', 'HIDDEN TBN POSTER ORG'),
      ('poster_company', 'HIDDEN TBN POSTER COMPANY'),
      ('poster_broker', 'HIDDEN TBN BROKER'),
      ('poster_pic', 'HIDDEN TBN PIC'),
      ('manager_org', 'HIDDEN TBN MANAGER ORG'),
      ('owner_address', 'HIDDEN TBN OWNER ADDRESS'),
      ('manager_address', 'HIDDEN TBN MANAGER ADDRESS'),
      ('owner_email', 'hidden-desk@privacy.test'),
      ('manager_email', 'hidden-manager@privacy.test'),
      ('owner_phone', '+30 555 9911'),
      ('manager_phone', '+30 555 9933'),
      ('contact_owner', 'HIDDEN CONTACT OWNER'),
      ('contact_manager', 'HIDDEN CONTACT MANAGER'),
      ('contact_pic', 'HIDDEN CONTACT PIC')
    ) canary(k, needle)
   where lower(p_value::text) like '%' || lower(needle) || '%'
      or lower(replace(p_value::text, '-', '')) like '%' || lower(replace(needle, '-', '')) || '%'
$$;

create or replace function pg_temp.mp_assert_ownership(p_value jsonb, p_label text)
returns void language plpgsql as $$
begin
  if jsonb_typeof(p_value) <> 'object' then
    raise exception '%: governed ownership object is absent: %', p_label, p_value;
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_value) k
     where k not in (
       'owner_company', 'owner_org_name', 'owner_org_imo', 'owner_org_country',
       'owner_org_fleet', 'owner_org_desk', 'manager_company',
       'manager_org_name', 'manager_org_country', 'manager_org_fleet',
       'manager_org_desk'
     )
  ) or (select count(*) from jsonb_object_keys(p_value)) <> 11 then
    raise exception '%: ownership object has a non-allowlisted or missing key: %', p_label, p_value;
  end if;
  if p_value->>'owner_company' <> 'HIDDEN TBN POSTER ORG'
     or p_value->>'owner_org_name' <> 'HIDDEN TBN POSTER ORG'
     or p_value->>'owner_org_imo' <> '1234567'
     or p_value->>'owner_org_country' <> 'Egypt'
     or (p_value->>'owner_org_fleet')::integer <> 7
     or p_value->>'owner_org_desk' <> 'HIDDEN TBN DESK'
     or p_value->>'manager_company' <> 'HIDDEN TBN MANAGER ORG'
     or p_value->>'manager_org_name' <> 'HIDDEN TBN MANAGER ORG'
     or p_value->>'manager_org_country' <> 'Greece'
     or (p_value->>'manager_org_fleet')::integer <> 9
     or p_value->>'manager_org_desk' <> 'HIDDEN MANAGER DESK' then
    raise exception '%: ownership allow-list lost expected display facts: %', p_label, p_value;
  end if;
  if lower(p_value::text) ~ '(email|phone|address|org_id|user_id|account_id)'
     or pg_temp.mp_has(p_value::text, pg_temp.mp_id('org_owner')::text)
     or pg_temp.mp_has(p_value::text, pg_temp.mp_id('org_manager')::text) then
    raise exception '%: ownership object contains contact PII or stable ids: %', p_label, p_value;
  end if;
end $$;

-- Exact mutation oracle for the legacy vessel-post RPCs.  It captures the
-- vessel plus every claim, availability and ownership row reachable from that
-- vessel, so a denied call cannot hide a partial write behind RLS.
create or replace function pg_temp.mp_post_state(p_vessel_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select jsonb_build_object(
    'vessel', (
      select to_jsonb(v)
        from public.vessels v
       where v.id = p_vessel_id
    ),
    'claims', coalesce((
      select jsonb_agg(to_jsonb(vc) order by vc.id)
        from public.vessel_claims vc
       where vc.vessel_id = p_vessel_id
    ), '[]'::jsonb),
    'availability', coalesce((
      select jsonb_agg(to_jsonb(a) order by a.id)
        from public.vessel_availability a
       where a.vessel_id = p_vessel_id
    ), '[]'::jsonb),
    'ownership', coalesce((
      select jsonb_agg(to_jsonb(lo) order by lo.id)
        from public.vessel_availability a
        join public.listing_ownership lo
          on lo.listing_type::text = 'vessel_availability'
         and lo.listing_id = a.id
       where a.vessel_id = p_vessel_id
    ), '[]'::jsonb)
  )
$$;

create or replace function pg_temp.mp_post_totals()
returns jsonb
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $$
  select jsonb_build_object(
    'vessels', (select count(*) from public.vessels),
    'claims', (select count(*) from public.vessel_claims),
    'availability', (select count(*) from public.vessel_availability),
    'ownership', (
      select count(*) from public.listing_ownership lo
       where lo.listing_type::text = 'vessel_availability'
    )
  )
$$;

-- M21 tags synthetic abandoned handles independently of any earlier expiry
-- fixture, so the deletion bound is measured exactly per top-level request.
create temp table mp_purge_keys (key uuid primary key);

do $$
declare
  rows jsonb;
  rows2 jsonb;
  item jsonb;
  detail jsonb;
  matches jsonb;
  cargo_key uuid;
  tbn_key uuid;
  tbn_match_key uuid;
  owner_key uuid;
  board_key uuid;
  old_key uuid;
  new_key uuid;
  fixture_key uuid;
  e text;
  n bigint;
  open_before date;
  expiry_before timestamptz;
  expiry_after timestamptz;
  actor_key text;
  state_before jsonb;
  state_after jsonb;
  attack_payload jsonb;
  posted jsonb;
  posted_vessel_id uuid;
  posted_availability_id uuid;
begin
  -- M1 - outsider board: all raw ids and private TBN/poster identity are gone.
  perform pg_temp.mp_as('u_out');
  rows := public.list_market_vessels(null, null);
  if jsonb_typeof(rows) <> 'array' then raise exception 'M1: vessel board is not an array: %', rows; end if;
  if pg_temp.mp_leaks(rows) is not null then raise exception 'M1: governed vessel board leaked %', pg_temp.mp_leaks(rows); end if;
  tbn_key := pg_temp.mp_key(rows, null, 'TBN');
  if tbn_key is null then raise exception 'M1: masked TBN card not found: %', rows; end if;
  select x into item from jsonb_array_elements(rows) x where coalesce(x->>'listing_key', x->>'id') = tbn_key::text;
  if coalesce((item->>'is_owned')::boolean, false) or coalesce((item->>'can_manage')::boolean, false) then
    raise exception 'M1: outsider was marked as owner/manager: %', item; end if;
  if item->'owned_listing_id' is distinct from 'null'::jsonb then raise exception 'M1: outsider got owned_listing_id: %', item; end if;
  if coalesce(item->'vessel'->>'vessel_name', item->>'vessel_name') <> 'TBN' then raise exception 'M1: TBN label is not fixed: %', item; end if;
  if coalesce(item->'vessel'->>'imo_number', item->>'imo_number') is not null then raise exception 'M1: TBN IMO is present: %', item; end if;
  if item->'poster' is distinct from 'null'::jsonb then
    raise exception 'M1: an unowned TBN poster must be JSON null (the UI supplies any generic label): %', item->'poster'; end if;
  if item->'ownership' is distinct from 'null'::jsonb then
    raise exception 'M1: an unowned TBN board row exposed ownership: %', item->'ownership'; end if;
  if not exists (
    select 1 from jsonb_array_elements(rows) x
     where coalesce(x->'vessel'->>'vessel_name', x->>'vessel_name') = 'PUBLIC NAMED HULL'
  ) then raise exception 'M1: named non-TBN identity stopped being discoverable'; end if;
  raise notice 'M1 ok: outsider sees usable named tonnage and an identifier-free, poster-free TBN card';

  -- M2 - cargo board and match/detail payloads use independent actor-bound keys.
  rows := public.list_market_cargo(null, null);
  cargo_key := pg_temp.mp_key(rows, 'PRIVACY TEST WHEAT', null);
  if cargo_key is null or cargo_key = pg_temp.mp_id('cargo') then raise exception 'M2: cargo handle missing/not opaque: %', rows; end if;
  if pg_temp.mp_has(rows::text, pg_temp.mp_id('cargo')::text) then raise exception 'M2: cargo UUID leaked from board'; end if;
  matches := public.list_market_matches(cargo_key);
  if pg_temp.mp_leaks(matches) is not null then raise exception 'M2: match payload leaked %', pg_temp.mp_leaks(matches); end if;
  tbn_match_key := pg_temp.mp_key(matches, null, 'TBN');
  if tbn_match_key is null then raise exception 'M2: TBN match key missing: %', matches; end if;
  detail := public.get_market_listing_detail(tbn_match_key);
  if pg_temp.mp_leaks(detail) is not null then raise exception 'M2: detail payload leaked %', pg_temp.mp_leaks(detail); end if;
  if coalesce(detail->'vessel'->>'vessel_name', detail->>'vessel_name') <> 'TBN' then raise exception 'M2: detail unmasked TBN: %', detail; end if;
  if detail->'ownership' is distinct from 'null'::jsonb then raise exception 'M2: unowned TBN detail exposed ownership: %', detail->'ownership'; end if;
  raise notice 'M2 ok: cargo, match and detail APIs expose opaque keys only; TBN remains masked';

  -- M3 - active handles are reused and refreshed; purposes reflect issuance.
  perform pg_temp.mp_owner();
  select expires_at into expiry_before from market_private.listing_handles where key = tbn_key;
  if not exists (select 1 from market_private.listing_handles where key = tbn_key and actor_user_id = pg_temp.mp_id('u_out') and purpose = 'vessel_board') then
    raise exception 'M3: board handle actor/purpose binding missing'; end if;
  if not exists (select 1 from market_private.listing_handles where key = tbn_match_key and actor_user_id = pg_temp.mp_id('u_out') and purpose = 'vessel_match') then
    raise exception 'M3: match handle purpose binding missing'; end if;
  perform pg_temp.mp_as('u_out');
  rows2 := public.list_market_vessels(null, null);
  if pg_temp.mp_key(rows2, null, 'TBN') <> tbn_key then raise exception 'M3: active tuple did not reuse its key'; end if;
  perform pg_temp.mp_owner();
  select expires_at into expiry_after from market_private.listing_handles where key = tbn_key;
  if expiry_after < expiry_before then raise exception 'M3: reuse shortened expiry (% -> %)', expiry_before, expiry_after; end if;
  raise notice 'M3 ok: active handle tuple reuses the key, refreshes TTL and records the correct purpose';

  -- M4 - another actor cannot distinguish a foreign key from an unknown key.
  perform pg_temp.mp_as('u_cargo');
  e := pg_temp.mp_err(format('select public.get_market_listing_detail(%L)', tbn_key));
  if e <> 'MARKET_NOT_FOUND' then raise exception 'M4: foreign actor detail expected MARKET_NOT_FOUND, got %', e; end if;
  e := pg_temp.mp_err(format('select public.get_market_listing_detail(%L)', 'ffffffff-ffff-4fff-8fff-ffffffffffff'));
  if e <> 'MARKET_NOT_FOUND' then raise exception 'M4: unknown key expected the same MARKET_NOT_FOUND, got %', e; end if;
  raise notice 'M4 ok: handles are actor-bound and foreign/unknown keys are indistinguishable';

  -- M5 - an own expired key is explicit; relisting rotates it; >1d rows purge.
  perform pg_temp.mp_owner();
  old_key := tbn_key;
  update market_private.listing_handles set expires_at = now() - interval '1 second' where key = old_key;
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format('select public.get_market_listing_detail(%L)', old_key));
  if e <> 'MARKET_EXPIRED' then raise exception 'M5: own expired key expected MARKET_EXPIRED, got %', e; end if;
  rows := public.list_market_vessels(null, null);
  new_key := pg_temp.mp_key(rows, null, 'TBN');
  if new_key is null or new_key = old_key then raise exception 'M5: relisting did not rotate an expired key'; end if;
  perform pg_temp.mp_owner();
  update market_private.listing_handles set expires_at = now() - interval '2 days' where key = old_key;
  perform pg_temp.mp_as('u_out');
  perform public.list_market_cargo(null, null);
  perform pg_temp.mp_owner();
  if exists (select 1 from market_private.listing_handles where key = old_key) then raise exception 'M5: >1d expired handle was not purged'; end if;
  raise notice 'M5 ok: expiry is enforced, relisting rotates, and abandoned handles purge';

  -- M6 - exact direct owner and exact current+active organisation seat retain identity/manage id.
  foreach e in array array['u_owner','u_seat'] loop
    perform pg_temp.mp_as(e);
    rows := public.list_market_vessels(null, null);
    if not pg_temp.mp_has(rows::text, 'HIDDEN TBN HULL ZEUS') or not pg_temp.mp_has(rows::text, pg_temp.mp_id('a_tbn')::text) then
      raise exception 'M6: % did not receive owned TBN identity/manage id: %', e, rows; end if;
    select x into item from jsonb_array_elements(rows) x where coalesce(x->>'owned_listing_id','') = pg_temp.mp_id('a_tbn')::text;
    if item is null or coalesce((item->>'is_owned')::boolean, false) is not true or coalesce((item->>'can_manage')::boolean, false) is not true then
      raise exception 'M6: % ownership flags wrong: %', e, item; end if;
    detail := public.get_market_listing_detail((item->>'listing_key')::uuid);
    perform pg_temp.mp_assert_ownership(detail->'ownership', 'M6 ' || e);
  end loop;
  raise notice 'M6 ok: direct owner and exact active organisation seat retain management identity';

  -- M7 - pending/current, ended/active and unrelated active seats are not ownership.
  foreach e in array array['u_pending','u_ended','u_out'] loop
    perform pg_temp.mp_as(e);
    rows := public.list_market_vessels(null, null);
    if pg_temp.mp_leaks(rows) is not null then raise exception 'M7: % leaked %', e, pg_temp.mp_leaks(rows); end if;
    if not pg_temp.mp_has(rows::text, 'TBN') then raise exception 'M7: % did not receive the masked card', e; end if;
    select x into item from jsonb_array_elements(rows) x
     where coalesce(x->'vessel'->>'vessel_name', x->>'vessel_name') = 'TBN';
    if item->'ownership' is distinct from 'null'::jsonb then raise exception 'M7: % received TBN ownership: %', e, item; end if;
  end loop;
  raise notice 'M7 ok: pending, ended and unrelated seats never inherit ownership';

  -- M8 - admin retains the governed management path and private identity.
  perform pg_temp.mp_as('u_admin', true);
  rows := public.list_market_vessels(null, null);
  if not pg_temp.mp_has(rows::text, 'HIDDEN TBN HULL ZEUS') or not pg_temp.mp_has(rows::text, pg_temp.mp_id('a_tbn')::text) then
    raise exception 'M8: admin did not receive the managed TBN row: %', rows; end if;
  select x into item from jsonb_array_elements(rows) x
   where coalesce(x->>'owned_listing_id','') = pg_temp.mp_id('a_tbn')::text;
  detail := public.get_market_listing_detail((item->>'listing_key')::uuid);
  perform pg_temp.mp_assert_ownership(detail->'ownership', 'M8 admin');
  detail := public.get_managed_vessel(pg_temp.mp_id('v_tbn'));
  if detail->>'id' <> pg_temp.mp_id('v_tbn')::text
     or detail->>'vessel_name' <> 'HIDDEN TBN HULL ZEUS' then
    raise exception 'M8: admin lost the governed vessel management read: %', detail; end if;
  if public.count_admin_vessel_flag_issues() < 1 then
    raise exception 'M8: admin lost the governed vessel flag-issue count'; end if;
  raise notice 'M8 ok: admin retains governed identity, DQ flag issues and vessel management';

  -- M9 - authenticated/anonymous bypass surfaces and private storage are closed.
  perform pg_temp.mp_as('u_out');
  -- Resolve private-schema object names as the harness owner. The privilege
  -- predicates still inspect the explicitly named application role; resolving
  -- those names as `authenticated` would itself (correctly) fail at schema
  -- USAGE before the predicate could return false.
  perform pg_temp.mp_owner();
  if has_schema_privilege('authenticated', 'market_private', 'usage') then raise exception 'M9: authenticated has USAGE on market_private'; end if;
  if has_table_privilege('authenticated', 'market_private.listing_handles', 'select') then raise exception 'M9: authenticated can select handle storage'; end if;
  if has_function_privilege('authenticated', 'market_private.create_vessel_availability(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'market_private.create_vessel_position(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'market_private.guard_vessel_imo_identity()', 'execute')
     or has_function_privilege('authenticated', 'market_private.lock_vessel_post_actor()', 'execute')
     or has_function_privilege('authenticated', 'market_private.lock_existing_vessel_for_post(uuid,uuid,uuid)', 'execute') then
    raise exception 'M9: authenticated can bypass a guarded legacy vessel-post wrapper'; end if;
  if not has_function_privilege('authenticated', 'public.create_vessel_availability(jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.create_vessel_position(jsonb)', 'execute') then
    raise exception 'M9: guarded legacy vessel-post wrappers are not callable'; end if;
  if has_function_privilege('authenticated', 'public.get_matches_for_cargo(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.get_matches_for_availability(uuid)', 'execute') then
    raise exception 'M9: authenticated can execute a legacy matcher'; end if;
  if has_function_privilege('authenticated', 'public.get_listing_posters(text,uuid[])', 'execute')
     or has_function_privilege('authenticated', 'public.count_live_matches(text,uuid[])', 'execute') then
    raise exception 'M9: authenticated can execute an arbitrary-id helper'; end if;
  if has_table_privilege('authenticated', 'public.matches', 'select')
     or has_table_privilege('authenticated', 'public.v_live_cargo', 'select')
     or has_table_privilege('authenticated', 'public.v_live_vessels', 'select')
     or has_table_privilege('authenticated', 'public.v_cargo_match_counts', 'select')
     or has_table_privilege('authenticated', 'public.v_vessel_match_counts', 'select')
     or has_table_privilege('authenticated', 'public.v_vessel_detail', 'select')
     or has_table_privilege('authenticated', 'public.v_admin_queue', 'select')
     or has_table_privilege('authenticated', 'public.v_eligible_matches', 'select') then
    raise exception 'M9: authenticated retains a legacy table/view correlation path'; end if;
  if has_table_privilege('authenticated', 'public.vessel_claims', 'insert')
     or has_table_privilege('authenticated', 'public.vessel_claims', 'update')
     or has_table_privilege('authenticated', 'public.vessel_claims', 'delete')
     or has_any_column_privilege('authenticated', 'public.vessel_claims', 'insert')
     or has_any_column_privilege('authenticated', 'public.vessel_claims', 'update') then
    raise exception 'M9: authenticated can forge or rewrite a vessel claim'; end if;
  if not has_column_privilege('authenticated', 'public.vessels', 'id', 'select')
     or not has_column_privilege('authenticated', 'public.vessels', 'vessel_name', 'select')
     or not has_column_privilege('authenticated', 'public.vessels', 'imo_number', 'select')
     or not has_column_privilege('authenticated', 'public.vessels', 'dwt_grain', 'select')
     or not has_column_privilege('authenticated', 'public.vessels', 'risk_level', 'select')
     or not has_column_privilege('authenticated', 'public.vessels', 'source_tag', 'select') then
    raise exception 'M9: authenticated lost a required named-vessel registry column'; end if;
  -- Some historical deployments have not yet installed the archived vessel
  -- review-status column. When present, it is a safe registry field and must
  -- be granted; when absent, this firewall migration must remain deployable.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'vessels'
       and column_name = 'vessel_review_status'
  ) then
    if not has_column_privilege(
      'authenticated', 'public.vessels', 'vessel_review_status', 'select'
    ) then
      raise exception 'M9: authenticated lost optional vessel review status';
    end if;
  end if;
  if has_column_privilege('authenticated', 'public.vessels', 'owner_company', 'select')
     or has_column_privilege('authenticated', 'public.vessels', 'manager_company', 'select')
     or has_column_privilege('authenticated', 'public.vessels', 'registered_owner', 'select')
     or has_column_privilege('authenticated', 'public.vessels', 'technical_operator', 'select')
     or has_column_privilege('authenticated', 'public.vessels', 'email_chartering', 'select')
     or has_column_privilege('authenticated', 'public.vessels', 'commercial_manager_email', 'select')
     or has_column_privilege('authenticated', 'public.vessels', 'owner_address', 'select')
     or has_column_privilege('authenticated', 'public.vessels', 'notes', 'select')
     or has_column_privilege('authenticated', 'public.vessels', 'risk_notes', 'select') then
    raise exception 'M9: authenticated retained a private vessel registry column'; end if;
  if has_column_privilege('anon', 'public.vessels', 'vessel_name', 'select') then
    raise exception 'M9: anon retained a vessel registry column'; end if;
  -- Base-table management may be preserved through exact ownership/RLS or an
  -- owner RPC, but an outsider must never recover a raw listing correlation or
  -- the current contact-history record.
  perform pg_temp.mp_as('u_out');
  begin
    execute format('select count(*) from public.cargo_listings where id = %L', pg_temp.mp_id('cargo')) into n;
    if n <> 0 then raise exception 'M9: outsider read the raw cargo row'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('select count(*) from public.vessel_availability where id = %L', pg_temp.mp_id('a_tbn')) into n;
    if n <> 0 then raise exception 'M9: outsider read the raw availability row'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('select count(*) from public.vessels where id = %L', pg_temp.mp_id('v_tbn')) into n;
    if n <> 0 then raise exception 'M9: outsider read the raw vessel row'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('select count(*) from public.vessel_contact_history where id = %L', pg_temp.mp_id('vch_tbn')) into n;
    if n <> 0 then raise exception 'M9: outsider enumerated vessel contact history'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('select count(*) from public.v_vessel_flag_issues where id = %L', pg_temp.mp_id('v_tbn')) into n;
    if n <> 0 then raise exception 'M9: outsider recovered TBN id/name/IMO through v_vessel_flag_issues'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'select count(*) from public.v_admin_queue' into n;
    raise exception 'M9: ordinary member read v_admin_queue (% rows)', n;
  exception when insufficient_privilege then null;
  end;
  begin
    execute 'select count(*) from public.v_eligible_matches' into n;
    raise exception 'M9: ordinary member read v_eligible_matches (% rows)', n;
  exception when insufficient_privilege then null;
  end;
  e := pg_temp.mp_err('select to_jsonb(public.count_admin_vessel_flag_issues())');
  if e <> 'MARKET_AUTH' then raise exception 'M9: ordinary member admin flag count expected MARKET_AUTH, got %', e; end if;
  perform pg_temp.mp_anon();
  if has_function_privilege('anon', 'public.list_market_vessels(date,date)', 'execute')
     or has_function_privilege('anon', 'public.list_market_cargo(date,date)', 'execute')
     or has_function_privilege('anon', 'public.list_market_matches(uuid)', 'execute')
     or has_function_privilege('anon', 'public.get_market_listing_detail(uuid)', 'execute')
     or has_function_privilege('anon', 'public.list_my_cargo()', 'execute')
     or has_function_privilege('anon', 'public.list_my_vessels()', 'execute')
     or has_function_privilege('anon', 'public.fn_owns_cargo(uuid)', 'execute')
     or has_function_privilege('anon', 'public.fn_owns_vessel(uuid)', 'execute')
     or has_function_privilege('anon', 'public.fn_position_checkin(uuid,text,date,time without time zone,date)', 'execute')
     or has_function_privilege('anon', 'public.get_managed_vessel(uuid)', 'execute')
     or has_function_privilege('anon', 'public.set_market_vessel_availability_status(uuid,public.vessel_status_enum)', 'execute')
     or has_function_privilege('anon', 'public.create_vessel_availability(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.create_vessel_position(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.count_admin_vessel_flag_issues()', 'execute') then
    raise exception 'M9: anon can execute governed market APIs'; end if;
  e := pg_temp.mp_err('select public.list_market_vessels(null, null)');
  if e <> '42501' then raise exception 'M9: anon call expected privilege denial 42501, got %', e; end if;
  begin
    execute format('select count(*) from public.vessel_contact_history where id = %L', pg_temp.mp_id('vch_tbn')) into n;
    if n <> 0 then raise exception 'M9: anon enumerated vessel contact history'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    execute format('select count(*) from public.v_vessel_flag_issues where id = %L', pg_temp.mp_id('v_tbn')) into n;
    if n <> 0 then raise exception 'M9: anon recovered TBN id/name/IMO through v_vessel_flag_issues'; end if;
  exception when insufficient_privilege then null;
  end;
  if has_table_privilege('anon', 'public.v_admin_queue', 'select')
     or has_table_privilege('anon', 'public.v_eligible_matches', 'select') then
    raise exception 'M9: anon retains a raw-id admin/matching view'; end if;
  raise notice 'M9 ok: anonymous/member bypass and all enumerated legacy surfaces are closed';

  -- M10 - service retains refresh/read capability, but members do not acquire it.
  perform pg_temp.mp_owner();
  if not has_table_privilege('service_role', 'public.matches', 'select')
     or not has_function_privilege('service_role', 'public.get_matches_for_cargo(uuid)', 'execute')
     or not has_function_privilege('service_role', 'public.get_matches_for_availability(uuid)', 'execute')
     or not has_table_privilege('service_role', 'public.v_admin_queue', 'select')
     or not has_table_privilege('service_role', 'public.v_eligible_matches', 'select') then
    raise exception 'M10: service legacy compatibility was revoked'; end if;
  if not has_function_privilege('service_role', 'public.create_vessel_availability(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.create_vessel_position(jsonb)', 'execute') then
    raise exception 'M10: service lost guarded legacy vessel-post signature compatibility'; end if;
  if has_function_privilege('service_role', 'market_private.create_vessel_availability(jsonb)', 'execute')
     or has_function_privilege('service_role', 'market_private.create_vessel_position(jsonb)', 'execute')
     or has_function_privilege('service_role', 'market_private.guard_vessel_imo_identity()', 'execute')
     or has_function_privilege('service_role', 'market_private.lock_vessel_post_actor()', 'execute')
     or has_function_privilege('service_role', 'market_private.lock_existing_vessel_for_post(uuid,uuid,uuid)', 'execute') then
    raise exception 'M10: service can bypass a guarded vessel-post signature through market_private'; end if;
  if has_function_privilege('service_role', 'public.list_market_cargo(date,date)', 'execute')
     or has_function_privilege('service_role', 'public.list_market_vessels(date,date)', 'execute')
     or has_function_privilege('service_role', 'public.list_market_matches(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.get_market_listing_detail(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.list_my_cargo()', 'execute')
     or has_function_privilege('service_role', 'public.list_my_vessels()', 'execute')
     or has_function_privilege('service_role', 'public.get_managed_vessel(uuid)', 'execute') then
    raise exception 'M10: service can call an actor-bound member RPC without an application identity'; end if;
  if not has_table_privilege('service_role', 'market_private.listing_handles', 'select')
     or not has_table_privilege('service_role', 'market_private.listing_handles', 'insert')
     or not has_table_privilege('service_role', 'market_private.listing_handles', 'update')
     or not has_table_privilege('service_role', 'market_private.listing_handles', 'delete') then
    raise exception 'M10: service cannot maintain handle storage'; end if;
  perform pg_temp.mp_service();
  e := pg_temp.mp_err('select to_jsonb(public.create_vessel_availability(''{}''::jsonb))');
  if e <> 'MARKET_AUTH' then
    raise exception 'M10: service availability post without actor expected MARKET_AUTH, got %', e; end if;
  e := pg_temp.mp_err('select public.create_vessel_position(''{}''::jsonb)');
  if e <> 'MARKET_AUTH' then
    raise exception 'M10: service position post without actor expected MARKET_AUTH, got %', e; end if;
  e := pg_temp.mp_err($probe$
    insert into public.vessels (vessel_name, imo_number, vessel_type)
    values ('M10 DUPLICATE IMO PROBE', '9876505', 'Bulk Carrier'::public.vessel_type_enum)
    returning jsonb_build_object('id', id)
  $probe$);
  if e <> '23505' then
    raise exception 'M10: direct service duplicate IMO expected 23505, got %', e; end if;
  if (select count(*) from public.vessels where imo_number = '9876505') <> 1 then
    raise exception 'M10: duplicate-IMO guard left a second vessel row'; end if;
  perform count(*) from public.matches;
  if (select count(*) from public.vessel_contact_history where id = pg_temp.mp_id('vch_tbn')) <> 1 then
    raise exception 'M10: service lost vessel contact-history maintenance access'; end if;
  if public.count_admin_vessel_flag_issues() < 1 then
    raise exception 'M10: service lost vessel flag-issue count access'; end if;
  if (select count(*) from public.v_vessel_flag_issues where id = pg_temp.mp_id('v_tbn')) <> 1 then
    raise exception 'M10: service lost vessel flag-issue maintenance access'; end if;
  perform pg_temp.mp_owner();
  raise notice 'M10 ok: service retains governed maintenance and legacy refresh/read access';

  -- M11 - handles are market-only: no PDA dependency/FK and no Fixture key crossover.
  if exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace nsp on nsp.oid = t.relnamespace
      join pg_class rt on rt.oid = c.confrelid
     where nsp.nspname = 'market_private' and t.relname = 'listing_handles'
       and c.contype = 'f' and rt.relname in ('pda_estimates','fixture_rooms','fixture_match_handles','match_handles')
  ) then raise exception 'M11: market handle storage has a cross-domain FK'; end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'market_private' and table_name = 'listing_handles'
       and column_name like 'pda%'
  ) then raise exception 'M11: market handle storage has a PDA column'; end if;

  -- When Fixture 208000 is composed, mint a real Fixture key and prove both
  -- directions reject the foreign domain. The conditional keeps this module's
  -- isolated two-migration harness independent of Fixture release ordering.
  if to_regprocedure('public.list_fixture_match_candidates(text,uuid)') is not null
     and to_regprocedure('public.create_fixture_room_from_candidate(uuid,jsonb,text,jsonb)') is not null then
    perform pg_temp.mp_as('u_cargo');
    select (x->>'candidateKey')::uuid into fixture_key
      from jsonb_array_elements(public.list_fixture_match_candidates('cargo', pg_temp.mp_id('cargo'))) x
     limit 1;
    if fixture_key is not null then
      e := pg_temp.mp_err(format('select public.get_market_listing_detail(%L)', fixture_key));
      if e <> 'MARKET_NOT_FOUND' then raise exception 'M11: Fixture key crossed into market detail: %', e; end if;
      e := pg_temp.mp_err(format('select public.create_fixture_room_from_candidate(%L, %L::jsonb, %L, %L::jsonb)', new_key, '[]', 'market-cross-domain', '{}'));
      if e <> 'FX_NOT_FOUND' then raise exception 'M11: market key crossed into Fixture create: %', e; end if;
    end if;
  end if;
  raise notice 'M11 ok: no PDA FK/dependency; Fixture and market key domains remain separate';

  -- M12 - no unbounded duplicate live tuples.
  perform pg_temp.mp_owner();
  select count(*) into n
    from market_private.listing_handles
   where actor_user_id = pg_temp.mp_id('u_out')
     and listing_type = 'vessel_availability'
     and listing_id = pg_temp.mp_id('a_tbn')
     and purpose = 'vessel_board'
     and expires_at > now();
  if n <> 1 then raise exception 'M12: expected one live actor/purpose/listing tuple, got %', n; end if;
  raise notice 'M12 ok: active tuple uniqueness prevents refresh amplification';

  -- M13 - a match-purpose key carries the independently scoped board key used
  -- by cards/map focus. Neither key is a raw id and both resolve to one exact
  -- counterpart for this actor.
  perform pg_temp.mp_as('u_out');
  rows := public.list_market_vessels(null, null);
  board_key := pg_temp.mp_key(rows, null, 'TBN');
  rows2 := public.list_market_cargo(null, null);
  cargo_key := pg_temp.mp_key(rows2, 'PRIVACY TEST WHEAT', null);
  matches := public.list_market_matches(cargo_key);
  select x into item from jsonb_array_elements(matches) x
   where coalesce(x->'vessel'->>'vessel_name', x->>'vessel_name') = 'TBN';
  if item is null then raise exception 'M13: TBN match row missing: %', matches; end if;
  tbn_match_key := (item->>'listing_key')::uuid;
  if (item->>'board_listing_key')::uuid is distinct from board_key then
    raise exception 'M13: match board_listing_key % did not correlate to board key %', item->>'board_listing_key', board_key; end if;
  if tbn_match_key = board_key then
    raise exception 'M13: match-purpose and board-purpose keys were conflated'; end if;
  if exists (
    select 1 from jsonb_array_elements(matches) m
     where m->>'board_listing_key' is null
        or m->>'board_listing_key' = m->>'listing_key'
        or not exists (
          select 1 from jsonb_array_elements(rows) b
           where b->>'listing_key' = m->>'board_listing_key'
        )
  ) then raise exception 'M13: a vessel match did not correlate to its board row: %', matches; end if;

  detail := public.list_market_matches(board_key);
  select x into item from jsonb_array_elements(detail) x
   where coalesce(x->>'commodity_name', x->'cargo'->>'commodity_name') = 'PRIVACY TEST WHEAT';
  if item is null
     or (item->>'board_listing_key')::uuid is distinct from cargo_key
     or item->>'listing_key' = item->>'board_listing_key' then
    raise exception 'M13: cargo match did not correlate to its independent board key: %', detail; end if;
  perform pg_temp.mp_owner();
  if not exists (
    select 1 from market_private.listing_handles
     where key = board_key and actor_user_id = pg_temp.mp_id('u_out')
       and purpose = 'vessel_board' and listing_type = 'vessel_availability'
       and listing_id = pg_temp.mp_id('a_tbn')
  ) or not exists (
    select 1 from market_private.listing_handles
     where key = tbn_match_key and actor_user_id = pg_temp.mp_id('u_out')
       and purpose = 'vessel_match' and listing_type = 'vessel_availability'
       and listing_id = pg_temp.mp_id('a_tbn')
  ) then raise exception 'M13: board/match keys did not bind to the exact actor, purpose and listing'; end if;
  raise notice 'M13 ok: match rows correlate through a separate actor-bound board_listing_key';

  -- M14 - match-purpose keys may open detail, but can never be recycled as a
  -- source for another match enumeration.
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format('select public.list_market_matches(%L)', tbn_match_key));
  if e <> 'MARKET_NOT_FOUND' then
    raise exception 'M14: purpose-mismatched match enumeration expected MARKET_NOT_FOUND, got %', e; end if;
  detail := public.get_market_listing_detail(tbn_match_key);
  if coalesce(detail->'vessel'->>'vessel_name', detail->>'vessel_name') <> 'TBN' then
    raise exception 'M14: valid match-purpose detail was refused or unmasked: %', detail; end if;
  raise notice 'M14 ok: endpoint purpose mismatch is refused while governed detail remains usable';

  -- M15 - ownership is not a stale market visibility token. Once a source is
  -- no longer approved/live, its already-issued owner key cannot drive match
  -- discovery. Exact owner detail remains available as a management path.
  perform pg_temp.mp_as('u_cargo');
  rows := public.list_market_cargo(null, null);
  owner_key := pg_temp.mp_key(rows, 'PRIVACY TEST WHEAT', null);
  perform pg_temp.mp_owner();
  update public.cargo_listings set review_status = 'PENDING' where id = pg_temp.mp_id('cargo');
  perform pg_temp.mp_as('u_cargo');
  e := pg_temp.mp_err(format('select public.list_market_matches(%L)', owner_key));
  if e <> 'MARKET_NOT_FOUND' then raise exception 'M15: closed owned cargo remained a match source: %', e; end if;
  detail := public.get_market_listing_detail(owner_key);
  if detail->>'owned_listing_id' <> pg_temp.mp_id('cargo')::text then
    raise exception 'M15: closed cargo lost its separate exact-owner management detail: %', detail; end if;
  perform pg_temp.mp_owner();
  update public.cargo_listings set review_status = 'APPROVED' where id = pg_temp.mp_id('cargo');

  perform pg_temp.mp_as('u_owner');
  rows := public.list_market_vessels(null, null);
  select (x->>'listing_key')::uuid into owner_key from jsonb_array_elements(rows) x
   where x->>'owned_listing_id' = pg_temp.mp_id('a_tbn')::text;
  perform pg_temp.mp_owner();
  update public.vessel_availability set status = 'FIXED' where id = pg_temp.mp_id('a_tbn');
  perform pg_temp.mp_as('u_owner');
  e := pg_temp.mp_err(format('select public.list_market_matches(%L)', owner_key));
  if e <> 'MARKET_NOT_FOUND' then raise exception 'M15: closed owned vessel remained a match source: %', e; end if;
  detail := public.get_market_listing_detail(owner_key);
  if detail->>'owned_listing_id' <> pg_temp.mp_id('a_tbn')::text
     or detail->'vessel'->>'vessel_name' <> 'HIDDEN TBN HULL ZEUS' then
    raise exception 'M15: closed vessel lost its separate exact-owner management detail: %', detail; end if;
  perform pg_temp.mp_owner();
  update public.vessel_availability set status = 'OPEN' where id = pg_temp.mp_id('a_tbn');
  raise notice 'M15 ok: closed owned sources are refused by governed discovery APIs';

  -- M16 - optional client cutoffs may only narrow the server-owned freshness
  -- windows. NULL and deliberately ancient dates must omit both stale canaries.
  perform pg_temp.mp_as('u_out');
  rows := public.list_market_cargo(null, null);
  rows2 := public.list_market_cargo(date '1900-01-01', date '1900-01-01');
  if pg_temp.mp_has(rows::text, 'STALE PRIVACY CARGO')
     or pg_temp.mp_has(rows2::text, 'STALE PRIVACY CARGO') then
    raise exception 'M16: NULL/ancient cargo cutoff widened the server freshness floor'; end if;
  rows := public.list_market_vessels(null, null);
  rows2 := public.list_market_vessels(date '1900-01-01', date '1900-01-01');
  if pg_temp.mp_has(rows::text, 'PUBLIC STALE HULL')
     or pg_temp.mp_has(rows2::text, 'PUBLIC STALE HULL') then
    raise exception 'M16: NULL/ancient vessel cutoff widened the server freshness floor'; end if;
  raise notice 'M16 ok: caller cutoffs are narrow-only over server freshness';

  -- M17 - an exact owner can edit allowed business fields, but direct table
  -- access cannot approve a listing, stamp goes_live_at, or move workflow state.
  perform pg_temp.mp_owner();
  update public.cargo_listings
     set review_status = 'PENDING', goes_live_at = null, status = 'IN'
   where id = pg_temp.mp_id('cargo');
  perform pg_temp.mp_as('u_cargo');
  e := pg_temp.mp_err(format(
    'update public.cargo_listings set review_status = ''APPROVED'', goes_live_at = now() where id = %L returning to_jsonb(id)',
    pg_temp.mp_id('cargo')
  ));
  if e not in ('42501', 'MARKET_AUTH') then raise exception 'M17: cargo owner self-approval was not denied: %', e; end if;
  e := pg_temp.mp_err(format(
    'update public.cargo_listings set status = ''PARTIAL'' where id = %L returning to_jsonb(id)',
    pg_temp.mp_id('cargo')
  ));
  if e not in ('42501', 'MARKET_AUTH') then raise exception 'M17: cargo owner workflow change was not denied: %', e; end if;
  perform pg_temp.mp_owner();
  if exists (
    select 1 from public.cargo_listings where id = pg_temp.mp_id('cargo')
      and (review_status::text <> 'PENDING' or status::text <> 'IN' or goes_live_at is not null)
  ) then raise exception 'M17: denied cargo workflow update changed protected state'; end if;
  update public.cargo_listings set review_status = 'APPROVED' where id = pg_temp.mp_id('cargo');

  update public.vessel_availability
     set review_status = 'PENDING', goes_live_at = null, status = 'OPEN'
   where id = pg_temp.mp_id('a_tbn');
  perform pg_temp.mp_as('u_owner');
  e := pg_temp.mp_err(format(
    'update public.vessel_availability set review_status = ''APPROVED'', goes_live_at = now() where id = %L returning to_jsonb(id)',
    pg_temp.mp_id('a_tbn')
  ));
  if e not in ('42501', 'MARKET_AUTH') then raise exception 'M17: vessel owner self-approval was not denied: %', e; end if;
  e := pg_temp.mp_err(format(
    'update public.vessel_availability set status = ''FIXED'' where id = %L returning to_jsonb(id)',
    pg_temp.mp_id('a_tbn')
  ));
  if e not in ('42501', 'MARKET_AUTH') then raise exception 'M17: vessel owner workflow change was not denied: %', e; end if;
  perform pg_temp.mp_owner();
  if exists (
    select 1 from public.vessel_availability where id = pg_temp.mp_id('a_tbn')
      and (review_status::text <> 'PENDING' or status::text <> 'OPEN' or goes_live_at is not null)
  ) then raise exception 'M17: denied vessel workflow update changed protected state'; end if;
  update public.vessel_availability set review_status = 'APPROVED' where id = pg_temp.mp_id('a_tbn');
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format(
    'select public.set_market_vessel_availability_status(%L, ''ON SUBS'')',
    pg_temp.mp_id('a_tbn')
  ));
  if e <> 'MARKET_NOT_FOUND' then raise exception 'M17: outsider used governed vessel workflow command: %', e; end if;
  perform pg_temp.mp_as('u_owner');
  detail := public.set_market_vessel_availability_status(pg_temp.mp_id('a_tbn'), 'ON SUBS');
  if detail->>'status' <> 'ON SUBS' then raise exception 'M17: governed OPEN -> ON SUBS transition failed: %', detail; end if;
  detail := public.set_market_vessel_availability_status(pg_temp.mp_id('a_tbn'), 'ON SUBS');
  if detail->>'status' <> 'ON SUBS' then raise exception 'M17: governed same-state transition was not idempotent: %', detail; end if;
  detail := public.set_market_vessel_availability_status(pg_temp.mp_id('a_tbn'), 'OPEN');
  if detail->>'status' <> 'OPEN' then raise exception 'M17: governed ON SUBS -> OPEN transition failed: %', detail; end if;
  perform pg_temp.mp_owner();
  if exists (
    select 1 from public.vessel_availability where id = pg_temp.mp_id('a_tbn')
      and (review_status::text <> 'APPROVED' or status::text <> 'OPEN' or goes_live_at is not null)
  ) then raise exception 'M17: governed status command changed approval/publication fields'; end if;
  raise notice 'M17 ok: direct workflow writes are forbidden; exact-owner command is bounded and governed';

  -- M18 - the recorded owner/poster is deterministic even when that member has
  -- multiple active organisation seats; the viewing seat never becomes poster.
  foreach e in array array['u_owner','u_seat'] loop
    perform pg_temp.mp_as(e);
    rows := public.list_market_vessels(null, null);
    select x into item from jsonb_array_elements(rows) x
     where x->>'owned_listing_id' = pg_temp.mp_id('a_tbn')::text;
    if jsonb_typeof(item->'poster') <> 'object'
       or item->'poster'->>'name' <> 'HIDDEN TBN POSTER PERSON'
       or item->'poster'->>'company' <> 'HIDDEN TBN POSTER ORG'
       or pg_temp.mp_has((item->'poster')::text, 'Unrelated Seat Org')
       or pg_temp.mp_has((item->'poster')::text, 'Exact Active Seat') then
      raise exception 'M18: % received a non-exact/multi-seat poster: %', e, item->'poster'; end if;
  end loop;
  raise notice 'M18 ok: exact owning organisation and recorded poster win across multiple seats';

  -- M19 - position check-in uses the same exact ownership predicate. Pending,
  -- ended and unrelated seats cannot turn a SECURITY DEFINER command into an
  -- arbitrary raw-id update.
  foreach e in array array['u_owner','u_seat'] loop
    perform pg_temp.mp_as(e);
    if pg_temp.mp_err(format(
      'select to_jsonb(public.fn_position_checkin(%L, null, null, null, null))',
      pg_temp.mp_id('a_tbn')
    )) <> 'OK' then raise exception 'M19: exact owner/seat % lost position check-in', e; end if;
  end loop;
  perform pg_temp.mp_owner();
  select open_date into open_before from public.vessel_availability where id = pg_temp.mp_id('a_tbn');
  foreach e in array array['u_pending','u_ended','u_out'] loop
    perform pg_temp.mp_as(e);
    if pg_temp.mp_err(format(
      'select to_jsonb(public.fn_position_checkin(%L, null, null, null, %L::date))',
      pg_temp.mp_id('a_tbn'), (current_date + 99)::text
    )) = 'OK' then raise exception 'M19: non-owner % performed position check-in', e; end if;
    perform pg_temp.mp_owner();
    if (select open_date from public.vessel_availability where id = pg_temp.mp_id('a_tbn')) is distinct from open_before then
      raise exception 'M19: denied check-in by % changed the position', e; end if;
  end loop;
  raise notice 'M19 ok: position check-in accepts exact ownership only';

  -- M20 - retained legacy ownership helpers use the exact current+active org
  -- predicate too; no pending-seat shortcut survives in older app call sites.
  perform pg_temp.mp_as('u_cargo');
  if public.fn_owns_cargo(pg_temp.mp_id('cargo')) is not true then raise exception 'M20: cargo owner lost fn_owns_cargo'; end if;
  foreach e in array array['u_owner','u_seat','auth_dual'] loop
    perform pg_temp.mp_as(e);
    if public.fn_owns_vessel(pg_temp.mp_id('v_tbn')) is not true then raise exception 'M20: exact vessel owner % lost fn_owns_vessel', e; end if;
  end loop;
  foreach e in array array['u_pending','u_ended','u_out'] loop
    perform pg_temp.mp_as(e);
    if public.fn_owns_vessel(pg_temp.mp_id('v_tbn')) is not false
       or public.fn_owns_cargo(pg_temp.mp_id('cargo')) is not false then
      raise exception 'M20: non-owner % passed a legacy ownership helper', e; end if;
  end loop;
  raise notice 'M20 ok: legacy ownership helpers enforce exact current active ownership';

  -- M21 - one top-level request performs one bounded cleanup batch, independent
  -- of the number of rows for which it issues/reuses handles.
  perform pg_temp.mp_owner();
  with seeded as (
    insert into market_private.listing_handles (
      key, actor_user_id, purpose, listing_type, listing_id,
      created_at, last_used_at, expires_at
    )
    select gen_random_uuid(), pg_temp.mp_id('u_out'), 'cargo_board', 'cargo', gen_random_uuid(),
           now() - interval '3 days', now() - interval '3 days', now() - interval '2 days'
      from generate_series(1, 2501)
    returning key
  )
  insert into mp_purge_keys(key) select key from seeded;
  if (select count(*) from mp_purge_keys) <> 2501 then raise exception 'M21: abandoned-handle fixture is incomplete'; end if;
  perform pg_temp.mp_as('u_out');
  perform public.list_market_vessels(null, null);
  perform pg_temp.mp_owner();
  select count(*) into n from mp_purge_keys p join market_private.listing_handles h using (key);
  if n <> 1501 then raise exception 'M21: one board request must purge exactly one <=1000 batch; % tagged rows remain', n; end if;
  perform pg_temp.mp_as('u_out');
  perform public.list_market_vessels(null, null);
  perform pg_temp.mp_owner();
  select count(*) into n from mp_purge_keys p join market_private.listing_handles h using (key);
  if n <> 501 then raise exception 'M21: second request did not drain exactly one further bounded batch; % remain', n; end if;
  raise notice 'M21 ok: abandoned-handle purge runs once and is bounded per request';

  -- M22 - raw vessel management is a separate exact-owner/admin RPC. Knowing a
  -- vessel UUID does not let any other member turn it into registry identity.
  foreach e in array array['u_owner','u_seat'] loop
    perform pg_temp.mp_as(e);
    detail := public.get_managed_vessel(pg_temp.mp_id('v_tbn'));
    if detail->>'id' <> pg_temp.mp_id('v_tbn')::text
       or detail->>'vessel_name' <> 'HIDDEN TBN HULL ZEUS' then
      raise exception 'M22: exact owner % lost managed vessel identity: %', e, detail; end if;
  end loop;
  foreach e in array array['u_pending','u_ended','u_out'] loop
    perform pg_temp.mp_as(e);
    if pg_temp.mp_err(format('select public.get_managed_vessel(%L)', pg_temp.mp_id('v_tbn'))) <> 'MARKET_NOT_FOUND' then
      raise exception 'M22: non-owner % did not receive indistinguishable managed-vessel denial', e; end if;
  end loop;
  raise notice 'M22 ok: managed vessel identity is exact-owner/admin only';

  -- M23 - auth.uid() and public.users.id are deliberately different. Handles
  -- and ownership bind to the canonical application id, never the auth key.
  perform pg_temp.mp_as('auth_dual');
  rows := public.list_market_vessels(null, null);
  select x into item from jsonb_array_elements(rows) x
   where x->>'owned_listing_id' = pg_temp.mp_id('a_tbn')::text;
  if item is null or coalesce((item->>'can_manage')::boolean, false) is not true
     or coalesce(item->'vessel'->>'vessel_name', item->>'vessel_name') <> 'HIDDEN TBN HULL ZEUS' then
    raise exception 'M23: dual-key exact seat did not resolve to its application identity: %', rows; end if;
  board_key := (item->>'listing_key')::uuid;
  perform pg_temp.mp_owner();
  if not exists (
    select 1 from market_private.listing_handles
     where key = board_key and actor_user_id = pg_temp.mp_id('u_dual')
  ) or exists (
    select 1 from market_private.listing_handles
     where key = board_key and actor_user_id = pg_temp.mp_id('auth_dual')
  ) then raise exception 'M23: dual-key handle did not bind exclusively to public.users.id'; end if;
  raise notice 'M23 ok: dual auth/application identities canonicalize before ownership and handle issuance';

  -- M24 - management visibility never widens public discovery. These rows are
  -- approved and in a live workflow state, and pass the separate active-window
  -- gates; only their two-year-old refreshed_at makes them undiscoverable.
  -- Still-valid handles prove match enumeration re-checks that same predicate.
  foreach actor_key in array array['u_cargo','u_admin'] loop
    perform pg_temp.mp_as(actor_key, actor_key = 'u_admin');
    rows := public.list_market_cargo(null, null);
    if pg_temp.mp_has(rows::text, 'STALE PRIVACY CARGO') then
      raise exception 'M24: exact owner/admin % discovered stale cargo', actor_key; end if;
    cargo_key := case actor_key
      when 'u_cargo' then pg_temp.mp_id('stale_cargo_owner_key')
      else pg_temp.mp_id('stale_cargo_admin_key')
    end;
    if pg_temp.mp_err(format('select public.list_market_matches(%L)', cargo_key)) <> 'MARKET_NOT_FOUND' then
      raise exception 'M24: exact owner/admin % enumerated matches from stale cargo', actor_key; end if;
  end loop;

  foreach actor_key in array array['u_owner','u_admin'] loop
    perform pg_temp.mp_as(actor_key, actor_key = 'u_admin');
    rows := public.list_market_vessels(null, null);
    if pg_temp.mp_has(rows::text, 'PUBLIC STALE HULL') then
      raise exception 'M24: exact owner/admin % discovered stale vessel', actor_key; end if;
    tbn_key := case actor_key
      when 'u_owner' then pg_temp.mp_id('stale_vessel_owner_key')
      else pg_temp.mp_id('stale_vessel_admin_key')
    end;
    if pg_temp.mp_err(format('select public.list_market_matches(%L)', tbn_key)) <> 'MARKET_NOT_FOUND' then
      raise exception 'M24: exact owner/admin % enumerated matches from stale vessel', actor_key; end if;
  end loop;
  raise notice 'M24 ok: strict freshness rejects stale cargo/vessel discovery and match sources for owner and admin';

  -- M25 - legacy posting RPCs cannot convert a caller-supplied existing hull,
  -- TBN UUID, or existing IMO into ownership.  Each refusal is compared against
  -- a full vessel/claim/availability/ownership snapshot.  The same broker may
  -- still create genuinely new named and TBN hulls, and exact pre-existing
  -- owners may continue to post against their vessel.
  perform pg_temp.mp_owner();
  state_before := pg_temp.mp_post_state(pg_temp.mp_id('v_tbn'));
  attack_payload := jsonb_build_object(
    'vessel_id', pg_temp.mp_id('v_tbn'),
    'open_port_locode', 'ZZMPA',
    'open_date', (current_date + 8)::text,
    'notes', 'OUTSIDER DIRECT AVAILABILITY'
  );
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format(
    'select to_jsonb(public.create_vessel_availability(%L::jsonb))',
    attack_payload::text
  ));
  if e <> 'MARKET_AUTH' then
    raise exception 'M25: outsider create_vessel_availability expected MARKET_AUTH, got %', e;
  end if;
  perform pg_temp.mp_owner();
  state_after := pg_temp.mp_post_state(pg_temp.mp_id('v_tbn'));
  if state_after is distinct from state_before then
    raise exception 'M25: denied create_vessel_availability changed vessel post state: before=% after=%', state_before, state_after;
  end if;

  attack_payload := jsonb_build_object(
    'entry_mode', 'fleet',
    'vessel_id', pg_temp.mp_id('v_tbn'),
    'dwt_backfill_mt', '12345',
    'arrangement', jsonb_build_object(
      '_source', 'user', 'config', 'OUTSIDER CONFIG', 'num_holds', '4'
    ),
    'gear', jsonb_build_object(
      '_source', 'user', 'geared', false, 'crane_count', '1'
    ),
    'ownership', jsonb_build_object(
      'registered_owner', 'OUTSIDER OWNER',
      'commercial_operator', 'OUTSIDER MANAGER'
    ),
    'performance', '{}'::jsonb,
    'availability', jsonb_build_object(
      'status', 'OPEN',
      'open_port_locode', 'ZZMPA',
      'open_from', (current_date + 9)::text
    ),
    'notes', 'OUTSIDER FLEET POSITION'
  );
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format(
    'select public.create_vessel_position(%L::jsonb)',
    attack_payload::text
  ));
  if e <> 'MARKET_AUTH' then
    raise exception 'M25: outsider fleet create_vessel_position expected MARKET_AUTH, got %', e;
  end if;
  perform pg_temp.mp_owner();
  state_after := pg_temp.mp_post_state(pg_temp.mp_id('v_tbn'));
  if state_after is distinct from state_before then
    raise exception 'M25: denied fleet create_vessel_position changed vessel post state: before=% after=%', state_before, state_after;
  end if;

  -- entry_mode=new must not be an ownership shortcut when its IMO already
  -- exists.  The payload contains several would-be mutations to make the
  -- no-write assertion adversarial rather than a permission-only check.
  state_before := pg_temp.mp_post_state(pg_temp.mp_id('v_rpc'));
  attack_payload := jsonb_build_object(
    'entry_mode', 'new',
    'vessel', jsonb_build_object(
      'name', 'OUTSIDER RENAMED HULL',
      'imo', '9876505',
      'type', 'Bulk Carrier',
      'dwt', '27999',
      'flag', 'Panama'
    ),
    'arrangement', jsonb_build_object(
      '_source', 'user', 'config', 'OUTSIDER IMO CONFIG', 'num_holds', '5'
    ),
    'ownership', jsonb_build_object(
      'registered_owner', 'OUTSIDER IMO OWNER',
      'commercial_operator', 'OUTSIDER IMO MANAGER'
    ),
    'performance', '{}'::jsonb,
    'availability', jsonb_build_object(
      'status', 'OPEN',
      'open_port_locode', 'ZZMPA',
      'open_from', (current_date + 10)::text
    ),
    'notes', 'OUTSIDER EXISTING IMO POSITION'
  );
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format(
    'select public.create_vessel_position(%L::jsonb)',
    attack_payload::text
  ));
  if e <> 'MARKET_AUTH' then
    raise exception 'M25: outsider existing-IMO create_vessel_position expected MARKET_AUTH, got %', e;
  end if;
  perform pg_temp.mp_owner();
  state_after := pg_temp.mp_post_state(pg_temp.mp_id('v_rpc'));
  if state_after is distinct from state_before then
    raise exception 'M25: denied existing-IMO create_vessel_position changed vessel post state: before=% after=%', state_before, state_after;
  end if;

  -- Owning one historical canonical duplicate does not make an IMO safe: the
  -- private core's unordered legacy lookup could otherwise choose the other
  -- row.  The wrapper must lock the full exact-IMO set and reject before write.
  state_before := jsonb_build_object(
    'totals', pg_temp.mp_post_totals(),
    'a', pg_temp.mp_post_state(pg_temp.mp_id('v_dup_a')),
    'b', pg_temp.mp_post_state(pg_temp.mp_id('v_dup_b'))
  );
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format(
    'select public.create_vessel_position(%L::jsonb)',
    jsonb_build_object(
      'entry_mode', 'new',
      'vessel', jsonb_build_object(
        'name', 'AMBIGUOUS DUPLICATE PROBE', 'imo', '9876531',
        'type', 'Bulk Carrier', 'dwt', '28000', 'flag', 'Malta'
      ),
      'availability', jsonb_build_object(
        'status', 'OPEN', 'open_port_locode', 'ZZMPA',
        'open_from', (current_date + 10)::text
      )
    )::text
  ));
  if e <> 'MARKET_VALIDATION' then
    raise exception 'M25: ambiguous existing IMO expected MARKET_VALIDATION, got %', e; end if;
  perform pg_temp.mp_owner();
  state_after := jsonb_build_object(
    'totals', pg_temp.mp_post_totals(),
    'a', pg_temp.mp_post_state(pg_temp.mp_id('v_dup_a')),
    'b', pg_temp.mp_post_state(pg_temp.mp_id('v_dup_b'))
  );
  if state_after is distinct from state_before then
    raise exception 'M25: ambiguous-IMO refusal changed posting state: before=% after=%', state_before, state_after;
  end if;

  state_before := jsonb_build_object(
    'totals', pg_temp.mp_post_totals(),
    'vessel', pg_temp.mp_post_state(pg_temp.mp_id('v_ws_imo'))
  );
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format(
    'select public.create_vessel_position(%L::jsonb)',
    jsonb_build_object(
      'entry_mode', 'new',
      'vessel', jsonb_build_object(
        'name', 'WHITESPACE IMO PROBE', 'imo', '9876543',
        'type', 'Bulk Carrier', 'dwt', '28000', 'flag', 'Malta'
      ),
      'availability', jsonb_build_object(
        'status', 'OPEN', 'open_port_locode', 'ZZMPA',
        'open_from', (current_date + 10)::text
      )
    )::text
  ));
  if e <> 'MARKET_VALIDATION' then
    raise exception 'M25: noncanonical existing IMO expected MARKET_VALIDATION, got %', e; end if;
  perform pg_temp.mp_owner();
  state_after := jsonb_build_object(
    'totals', pg_temp.mp_post_totals(),
    'vessel', pg_temp.mp_post_state(pg_temp.mp_id('v_ws_imo'))
  );
  if state_after is distinct from state_before then
    raise exception 'M25: noncanonical-IMO refusal changed posting state: before=% after=%', state_before, state_after;
  end if;

  -- Mode selection is fail-closed before the private core: unknown modes,
  -- invalid new-mode IMO values, and a raw vessel UUID smuggled into a
  -- creation mode all fail without changing any posting graph.
  state_before := jsonb_build_object(
    'totals', pg_temp.mp_post_totals(),
    'tbn', pg_temp.mp_post_state(pg_temp.mp_id('v_tbn')),
    'rpc', pg_temp.mp_post_state(pg_temp.mp_id('v_rpc'))
  );
  perform pg_temp.mp_as('u_out');
  e := pg_temp.mp_err(format(
    'select public.create_vessel_position(%L::jsonb)',
    jsonb_build_object(
      'entry_mode', 'mystery',
      'vessel_id', pg_temp.mp_id('v_tbn'),
      'availability', jsonb_build_object(
        'status', 'OPEN', 'open_port_locode', 'ZZMPA',
        'open_from', (current_date + 10)::text
      )
    )::text
  ));
  if e <> 'MARKET_VALIDATION' then
    raise exception 'M25: unknown position mode expected MARKET_VALIDATION, got %', e; end if;

  e := pg_temp.mp_err(format(
    'select public.create_vessel_position(%L::jsonb)',
    jsonb_build_object(
      'entry_mode', 'new',
      'vessel', jsonb_build_object(
        'name', 'INVALID IMO PROBE', 'imo', '1234560',
        'type', 'Bulk Carrier', 'dwt', '26000', 'flag', 'Malta'
      ),
      'availability', jsonb_build_object(
        'status', 'OPEN', 'open_port_locode', 'ZZMPA',
        'open_from', (current_date + 10)::text
      )
    )::text
  ));
  if e <> 'MARKET_VALIDATION' then
    raise exception 'M25: invalid new-mode IMO expected MARKET_VALIDATION, got %', e; end if;

  e := pg_temp.mp_err(format(
    'select public.create_vessel_position(%L::jsonb)',
    jsonb_build_object(
      'entry_mode', 'tbn',
      'vessel_id', pg_temp.mp_id('v_tbn'),
      'tbn', jsonb_build_object(
        'type', 'Bulk Carrier', 'dwt', '26000', 'flag', 'Liberia'
      ),
      'availability', jsonb_build_object(
        'status', 'OPEN', 'open_port_locode', 'ZZMPA',
        'open_from', (current_date + 10)::text
      )
    )::text
  ));
  if e <> 'MARKET_VALIDATION' then
    raise exception 'M25: non-fleet vessel_id smuggling expected MARKET_VALIDATION, got %', e; end if;
  perform pg_temp.mp_owner();
  state_after := jsonb_build_object(
    'totals', pg_temp.mp_post_totals(),
    'tbn', pg_temp.mp_post_state(pg_temp.mp_id('v_tbn')),
    'rpc', pg_temp.mp_post_state(pg_temp.mp_id('v_rpc'))
  );
  if state_after is distinct from state_before then
    raise exception 'M25: malformed mode/IMO/id probes changed posting state: before=% after=%', state_before, state_after;
  end if;

  -- A current exact listing owner remains allowed through both legacy public
  -- signatures.  The position call also creates the idempotent exact claim.
  perform pg_temp.mp_as('u_owner');
  select to_jsonb(public.create_vessel_availability(jsonb_build_object(
    'vessel_id', pg_temp.mp_id('v_tbn'),
    'open_port_locode', 'ZZMPA',
    'open_date', (current_date + 11)::text,
    'notes', 'EXACT OWNER DIRECT AVAILABILITY'
  ))) into posted;
  posted_availability_id := (posted->>'id')::uuid;
  perform pg_temp.mp_owner();
  if not exists (
    select 1
      from public.vessel_availability a
      join public.listing_ownership lo
        on lo.listing_type::text = 'vessel_availability'
       and lo.listing_id = a.id
     where a.id = posted_availability_id
       and a.vessel_id = pg_temp.mp_id('v_tbn')
       and lo.owner_user_id = pg_temp.mp_id('u_owner')
       and lo.role::text = 'primary'
       and lo.is_current
  ) then raise exception 'M25: exact listing owner lost create_vessel_availability'; end if;

  perform pg_temp.mp_as('u_owner');
  posted := public.create_vessel_position(jsonb_build_object(
    'entry_mode', 'fleet',
    'vessel_id', pg_temp.mp_id('v_tbn'),
    'availability', jsonb_build_object(
      'status', 'OPEN',
      'open_port_locode', 'ZZMPA',
      'open_from', (current_date + 12)::text
    ),
    'notes', 'EXACT OWNER FLEET POSITION'
  ));
  posted_availability_id := (posted->>'availability_id')::uuid;
  perform pg_temp.mp_owner();
  if not exists (
    select 1 from public.vessel_claims vc
     where vc.vessel_id = pg_temp.mp_id('v_tbn')
       and vc.user_id = pg_temp.mp_id('u_owner')
  ) or not exists (
    select 1
      from public.vessel_availability a
      join public.listing_ownership lo
        on lo.listing_type::text = 'vessel_availability'
       and lo.listing_id = a.id
     where a.id = posted_availability_id
       and a.vessel_id = pg_temp.mp_id('v_tbn')
       and lo.owner_user_id = pg_temp.mp_id('u_owner')
       and lo.is_current
  ) then raise exception 'M25: exact listing owner lost fleet create_vessel_position'; end if;

  -- A verified administrator (JWT role plus the locked active application
  -- row) retains compatibility through both guarded public signatures.
  perform pg_temp.mp_as('u_admin', true);
  select to_jsonb(public.create_vessel_availability(jsonb_build_object(
    'vessel_id', pg_temp.mp_id('v_rpc'),
    'open_port_locode', 'ZZMPA',
    'open_date', (current_date + 12)::text,
    'notes', 'ADMIN DIRECT AVAILABILITY'
  ))) into posted;
  posted_availability_id := (posted->>'id')::uuid;
  if posted_availability_id is null then
    raise exception 'M25: admin create_vessel_availability returned no id: %', posted; end if;

  posted := public.create_vessel_position(jsonb_build_object(
    'entry_mode', 'fleet',
    'vessel_id', pg_temp.mp_id('v_rpc'),
    'availability', jsonb_build_object(
      'status', 'OPEN',
      'open_port_locode', 'ZZMPA',
      'open_from', (current_date + 12)::text
    ),
    'notes', 'ADMIN FLEET POSITION'
  ));
  posted_availability_id := (posted->>'availability_id')::uuid;
  perform pg_temp.mp_owner();
  if posted_availability_id is null or not exists (
    select 1 from public.vessel_availability a
     where a.id = posted_availability_id
       and a.vessel_id = pg_temp.mp_id('v_rpc')
  ) then raise exception 'M25: verified admin lost guarded vessel-post compatibility: %', posted; end if;

  -- The same previously-unrelated broker may create a genuinely new IMO.  Its
  -- resulting exact claim must also authorize the simpler availability RPC.
  perform pg_temp.mp_as('u_out');
  posted := public.create_vessel_position(jsonb_build_object(
    'entry_mode', 'new',
    'vessel', jsonb_build_object(
      'name', 'M25 NEW NAMED HULL',
      'imo', '9876517',
      'type', 'Bulk Carrier',
      'dwt', '27500',
      'built', '2020',
      'flag', 'Malta'
    ),
    'availability', jsonb_build_object(
      'status', 'OPEN',
      'open_port_locode', 'ZZMPA',
      'open_from', (current_date + 13)::text
    ),
    'notes', 'M25 GENUINELY NEW POSITION'
  ));
  posted_vessel_id := (posted->>'vessel_id')::uuid;
  posted_availability_id := (posted->>'availability_id')::uuid;
  perform pg_temp.mp_owner();
  if not exists (
    select 1 from public.vessels v
     where v.id = posted_vessel_id
       and v.imo_number = '9876517'
       and not coalesce(v.is_tbn, false)
  ) or not exists (
    select 1 from public.vessel_claims vc
     where vc.vessel_id = posted_vessel_id
       and vc.user_id = pg_temp.mp_id('u_out')
  ) or not exists (
    select 1 from public.listing_ownership lo
     where lo.listing_type::text = 'vessel_availability'
       and lo.listing_id = posted_availability_id
       and lo.owner_user_id = pg_temp.mp_id('u_out')
       and lo.is_current
  ) then raise exception 'M25: genuinely new IMO path did not create exact claim/listing ownership: %', posted; end if;

  perform pg_temp.mp_as('u_out');
  select to_jsonb(public.create_vessel_availability(jsonb_build_object(
    'vessel_id', posted_vessel_id,
    'open_port_locode', 'ZZMPA',
    'open_date', (current_date + 14)::text,
    'notes', 'M25 CLAIM OWNER DIRECT AVAILABILITY'
  ))) into posted;
  posted_availability_id := (posted->>'id')::uuid;
  perform pg_temp.mp_owner();
  if not exists (
    select 1 from public.listing_ownership lo
     where lo.listing_type::text = 'vessel_availability'
       and lo.listing_id = posted_availability_id
       and lo.owner_user_id = pg_temp.mp_id('u_out')
       and lo.is_current
  ) then raise exception 'M25: exact vessel claim did not authorize create_vessel_availability'; end if;

  -- TBN remains a creation mode, never an attach-to-supplied-id mode.
  perform pg_temp.mp_as('u_out');
  posted := public.create_vessel_position(jsonb_build_object(
    'entry_mode', 'tbn',
    'tbn', jsonb_build_object(
      'type', 'Bulk Carrier',
      'dwt', '26500',
      'built', '2019',
      'flag', 'Liberia'
    ),
    'availability', jsonb_build_object(
      'status', 'OPEN',
      'open_port_locode', 'ZZMPA',
      'open_from', (current_date + 15)::text
    ),
    'notes', 'M25 NEW TBN POSITION'
  ));
  posted_vessel_id := (posted->>'vessel_id')::uuid;
  posted_availability_id := (posted->>'availability_id')::uuid;
  perform pg_temp.mp_owner();
  if not exists (
    select 1 from public.vessels v
     where v.id = posted_vessel_id
       and v.vessel_name = 'TBN'
       and v.imo_number is null
       and v.is_tbn
  ) or not exists (
    select 1 from public.vessel_claims vc
     where vc.vessel_id = posted_vessel_id
       and vc.user_id = pg_temp.mp_id('u_out')
  ) or not exists (
    select 1 from public.listing_ownership lo
     where lo.listing_type::text = 'vessel_availability'
       and lo.listing_id = posted_availability_id
       and lo.owner_user_id = pg_temp.mp_id('u_out')
       and lo.is_current
  ) then raise exception 'M25: new TBN path did not create exact claim/listing ownership: %', posted; end if;
  raise notice 'M25 ok: legacy vessel RPCs fail closed with zero-write takeover denial and retain owner/admin/new/TBN posting';

  -- M27 - bulk board rendering and the retained one-row detail path must keep
  -- exactly the same JSON contract. This catches field loss, poster drift,
  -- masking drift and grouped-count differences during set-based optimization.
  perform pg_temp.mp_as('u_out');
  rows := public.list_market_cargo(null, null);
  select x into item
    from jsonb_array_elements(rows) x
   where x->>'ref' = 'MPC-001';
  if item is null then raise exception 'M27: optimized cargo board row missing'; end if;
  detail := public.get_market_listing_detail((item->>'listing_key')::uuid);
  if detail is distinct from item then
    raise exception 'M27: cargo bulk/detail payload drift: board=% detail=%', item, detail;
  end if;

  rows := public.list_market_vessels(null, null);
  select x into item
    from jsonb_array_elements(rows) x
   where x->'vessel'->>'vessel_name' = 'PUBLIC NAMED HULL';
  if item is null then raise exception 'M27: optimized vessel board row missing'; end if;
  detail := public.get_market_listing_detail((item->>'listing_key')::uuid);
  if detail is distinct from item then
    raise exception 'M27: vessel bulk/detail payload drift: board=% detail=%', item, detail;
  end if;

  perform pg_temp.mp_as('u_owner');
  rows := public.list_market_vessels(null, null);
  select x into item
    from jsonb_array_elements(rows) x
   where x->>'owned_listing_id' = pg_temp.mp_id('a_tbn')::text;
  if item is null then raise exception 'M27: optimized managed TBN row missing'; end if;
  detail := public.get_market_listing_detail((item->>'listing_key')::uuid);
  if detail is distinct from item then
    raise exception 'M27: managed vessel bulk/detail payload drift: board=% detail=%', item, detail;
  end if;
  perform pg_temp.mp_owner();
  raise notice 'M27 ok: set-based board renderers preserve the one-row payload contract';
end $$;

-- M26 - moderation is an administrator ledger, while a member can obtain only
-- a bounded identifier-free status history for rows submitted under either of
-- the application's historical identity keys.
do $$
declare
  n integer;
  payload text;
  e text;
begin
  perform pg_temp.mp_owner();
  select count(*), coalesce(jsonb_agg(jsonb_build_object(
           'submitted_by', submitted_by, 'listing_type', listing_type
         ))::text, '[]')
    into n, payload
    from public.review_queue
   where submitted_by = pg_temp.mp_id('u_review_out');
  if n <> 0 then
    raise exception 'M26 fixture: unrelated member % unexpectedly owns % seeded rows: %',
      pg_temp.mp_id('u_review_out'), n, payload;
  end if;
  perform pg_temp.mp_as('u_review_out');
  select count(*) into n from public.review_queue;
  if n <> 0 then
    raise exception 'M26: ordinary member read review_queue returned % rows', n;
  end if;
  select count(*) into n from public.v_admin_queue_detail;
  if n <> 0 then
    raise exception 'M26: ordinary member read v_admin_queue_detail returned % rows', n;
  end if;
  select count(*), coalesce(jsonb_agg(to_jsonb(s))::text, '[]')
    into n, payload
    from public.list_my_review_statuses() s;
  if n <> 0 then
    raise exception 'M26: unrelated member received % review statuses (auth %, actor %, payload %)',
      n, auth.uid(), pg_temp.mp_actor(), payload;
  end if;

  perform pg_temp.mp_as('u_cargo');
  select count(*), coalesce(jsonb_agg(to_jsonb(s))::text, '[]')
    into n, payload
    from public.list_my_review_statuses() s;
  if n <> 1 then
    raise exception 'M26: submitter review history expected 1 row, got %', n;
  end if;
  if pg_temp.mp_has(payload, pg_temp.mp_id('cargo')::text)
     or pg_temp.mp_has(payload, 'M26 PRIVATE REVIEW')
     or pg_temp.mp_has(payload, 'M26 PRIVATE ADMIN')
     or pg_temp.mp_has(payload, 'M26 PRIVATE AMENDMENT')
     or pg_temp.mp_has(payload, 'trust_tier')
     or pg_temp.mp_has(payload, 'random_sample')
     or pg_temp.mp_has(payload, 'reviewed_by') then
    raise exception 'M26: review status payload leaked a raw identifier or moderation field: %', payload;
  end if;

  -- request.jwt.claim.sub is auth_dual while fn_market_actor() resolves u_dual;
  -- both historical submitted_by representations belong to this one caller.
  perform pg_temp.mp_as('auth_dual');
  select count(*), coalesce(jsonb_agg(to_jsonb(s))::text, '[]')
    into n, payload
    from public.list_my_review_statuses(1000) s;
  if n <> 2 then
    raise exception 'M26: dual-key review history expected 2 rows, got %', n;
  end if;
  if pg_temp.mp_has(payload, pg_temp.mp_id('u_dual')::text)
     or pg_temp.mp_has(payload, pg_temp.mp_id('auth_dual')::text)
     or pg_temp.mp_has(payload, pg_temp.mp_id('cargo')::text)
     or pg_temp.mp_has(payload, pg_temp.mp_id('a_tbn')::text)
     or pg_temp.mp_has(payload, 'M26 PRIVATE') then
    raise exception 'M26: dual-key status payload leaked a raw identifier or private text: %', payload;
  end if;

  -- Adversarial dual-key collision: auth_dual is now also the primary id of a
  -- different application profile. The mapped u_dual actor keeps its own
  -- users.id row, while the ambiguous auth-key row fails closed.
  perform pg_temp.mp_owner();
  insert into public.users (
    id, supabase_user_id, email, full_name, company, role,
    subscription_tier, is_active
  ) values (
    pg_temp.mp_id('auth_dual'), null, 'm26-collision@privacy.test',
    'M26 Collision User', 'M26 Collision Company', 'cargo_owner', 'T3', true
  );
  perform pg_temp.mp_as('auth_dual');
  select count(*), min(s.listing_type::text)
    into n, payload
    from public.list_my_review_statuses() s;
  if n <> 1 or payload is distinct from 'cargo' then
    raise exception 'M26: collided auth key must retain only the mapped cargo actor row; got count %, type %', n, payload;
  end if;

  perform pg_temp.mp_as('u_admin', true);
  select count(*) into n
    from public.review_queue
   where review_reason like 'M26 PRIVATE REVIEW REASON%';
  if n <> 3 then
    raise exception 'M26: verified admin expected 3 ledger rows, got %', n;
  end if;
  select count(*) into n
    from public.v_admin_queue_detail
   where review_reason like 'M26 PRIVATE REVIEW REASON%';
  if n <> 3 then
    raise exception 'M26: verified admin expected exactly 3 joined ledger rows, got %', n;
  end if;
  select count(*) into n
    from public.v_admin_queue_detail
   where submitted_by = pg_temp.mp_id('auth_dual');
  if n <> 1 then
    raise exception 'M26: ambiguous dual-key queue item expected exactly one view row, got %', n;
  end if;
  select count(*) into n
    from public.v_admin_queue_detail
   where submitted_by = pg_temp.mp_id('auth_dual')
     and (
       submitter_name is not null
       or submitter_email is not null
       or submitter_trust_tier is not null
     );
  if n <> 0 then
    raise exception 'M26: ambiguous dual-key submitter was attributed to a guessed profile';
  end if;

  perform pg_temp.mp_anon();
  e := pg_temp.mp_err('select to_jsonb(s) from public.list_my_review_statuses() s limit 1');
  if e <> '42501' then
    raise exception 'M26: anonymous review-status call expected 42501, got %', e;
  end if;

  perform pg_temp.mp_service();
  e := pg_temp.mp_err('select to_jsonb(s) from public.list_my_review_statuses() s limit 1');
  if e <> '42501' then
    raise exception 'M26: service review-status call expected 42501, got %', e;
  end if;
  select count(*) into n
    from public.review_queue
   where review_reason like 'M26 PRIVATE REVIEW REASON%';
  if n <> 3 then
    raise exception 'M26: service maintenance expected 3 ledger rows, got %', n;
  end if;

  perform pg_temp.mp_owner();
  raise notice 'M26 ok: review ledger is admin-only and member status history is identifier-free';
end $$;

do $$ begin raise notice 'MARKET TBN PRIVACY: ALL ASSERTIONS PASSED'; end $$;

rollback;

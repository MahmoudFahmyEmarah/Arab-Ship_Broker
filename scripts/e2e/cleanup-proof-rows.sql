-- e2e-shaped rows next to the Fixture suite seed (rolled back by the caller)
insert into fx_ids values
  ('e_ch', '00000000-0000-4000-8000-00000000e0a1'), ('e_ow', '00000000-0000-4000-8000-00000000e0a2'),
  ('e_och', '00000000-0000-4000-8000-00000000e0c1'), ('e_oow', '00000000-0000-4000-8000-00000000e0c2'),
  ('e_c', '00000000-0000-4000-8000-00000000e0e1'), ('e_v', '00000000-0000-4000-8000-00000000e0f1'), ('e_a', '00000000-0000-4000-8000-00000000e0b1');
insert into auth.users (id, email, aud, role) values
  (pg_temp.fx_id('e_ch'), 'e2e-fx-ch-proof@arabshipbroker.test', 'authenticated', 'authenticated'),
  (pg_temp.fx_id('e_ow'), 'e2e-fx-ow-proof@arabshipbroker.test', 'authenticated', 'authenticated');
insert into public.users (id, supabase_user_id, email, full_name, company, role, subscription_tier, is_active) values
  (pg_temp.fx_id('e_ch'), pg_temp.fx_id('e_ch'), 'e2e-fx-ch-proof@arabshipbroker.test', 'E2E cargo_owner', 'E2E Charterers proof', 'cargo_owner', 'T3', true),
  (pg_temp.fx_id('e_ow'), pg_temp.fx_id('e_ow'), 'e2e-fx-ow-proof@arabshipbroker.test', 'E2E vessel_owner', 'E2E Owners proof', 'vessel_owner', 'T3', true);
insert into public.organizations (id, name, org_type, desk_contact_name) values
  (pg_temp.fx_id('e_och'), 'E2E Charterers proof', 'charterer', 'Desk'), (pg_temp.fx_id('e_oow'), 'E2E Owners proof', 'owner', 'Desk');
insert into public.organization_members (org_id, user_id, member_role, is_current, status) values
  (pg_temp.fx_id('e_och'), pg_temp.fx_id('e_ch'), 'admin', true, 'active'), (pg_temp.fx_id('e_oow'), pg_temp.fx_id('e_ow'), 'admin', true, 'active');
insert into public.profiles (account_id, profile_type, display_name, is_active) values
  (pg_temp.fx_id('e_ch'), 'cargo', 'E2E cargo_owner', true), (pg_temp.fx_id('e_ow'), 'vessel', 'E2E vessel_owner', true);
insert into public.cargo_listings (id, ref, status, review_status, cargo_type, commodity_name, is_dg_cargo, is_grain_cargo,
  qty_min_mt, qty_max_mt, stowage_factor, load_port_locode, load_port_name, load_zone, disch_port_locode, disch_port_name, disch_zone,
  laycan_from, laycan_to, is_spot, load_rate, disch_rate, load_terms, freight_idea_usd_mt) values
  (pg_temp.fx_id('e_c'), 'E2EFX-proof', 'IN', 'APPROVED', 'Dry Bulk', 'E2E Wheat, Bulk', false, true, 25000, 27500, 1.25,
   'ZZFXA', 'Fixture Load Port', 'E.MED', 'ZZFXB', 'Fixture Disch Port', 'E.MED', current_date + 10, current_date + 20, false, '8000', '6000', 'FIOST', 24.50);
insert into public.vessels (id, vessel_name, imo_number, vessel_type, dwt_grain, build_year, flag, is_geared, grain_certified, dg_certified, max_draft_m, is_sanctioned, is_tbn) values
  (pg_temp.fx_id('e_v'), 'E2E HULL PROOF', '1999999', 'Bulk Carrier', 30000, 2012, 'Malta', true, true, false, 10.5, false, false);
insert into public.vessel_availability (id, vessel_id, open_port_locode, open_port_name, open_zone, open_date, status, review_status, freight_idea_usd_mt, accepts_part_cargo) values
  (pg_temp.fx_id('e_a'), pg_temp.fx_id('e_v'), 'ZZFXA', 'Fixture Load Port', 'E.MED', current_date + 5, 'OPEN', 'APPROVED', 26.00, false);
insert into public.listing_ownership (listing_type, listing_id, owner_user_id, owner_org_id, role, is_current, transfer_reason) values
  ('cargo', pg_temp.fx_id('e_c'), pg_temp.fx_id('e_ch'), pg_temp.fx_id('e_och'), 'primary', true, 'initial_post'),
  ('vessel_availability', pg_temp.fx_id('e_a'), pg_temp.fx_id('e_ow'), pg_temp.fx_id('e_oow'), 'primary', true, 'initial_post');
-- a real room with ledger rows on both sides, and a successor chain (supersedes)
do $$
declare v jsonb; v_room uuid; v_tid uuid;
begin
  perform pg_temp.fx_as('e_ch');
  v := pg_temp.fx_create(pg_temp.fx_id('e_c'), pg_temp.fx_id('e_a'), pg_temp.fx_terms(), 'e2e-proof-create', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('e_ow');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'e2e-proof-inv');
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 27}'::jsonb, 'proof', false, null, pg_temp.fx_ver(v_room), 'e2e-proof-offer');
  v := public.post_fixture_message(v_room, 'proof note', 'note', 'room', null, pg_temp.fx_ver(v_room), 'e2e-proof-msg');
  reset role;
  if (select count(*) from public.fixture_events where room_id = v_room) < 4 then raise exception 'proof setup: expected a ledger, got %', (select count(*) from public.fixture_events where room_id = v_room); end if;
  raise notice 'proof setup: room % with % events, % proposals, % messages', v_room,
    (select count(*) from public.fixture_events where room_id = v_room), (select count(*) from public.fixture_proposals where room_id = v_room),
    (select count(*) from public.fixture_messages where room_id = v_room);
end $$;

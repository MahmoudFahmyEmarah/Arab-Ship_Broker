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
-- C2O-078 #2 shapes: an agreed term, a proposal chain, a PDA-link chain with a self link, a successor room
do $$
declare v jsonb; v_room uuid; v_room2 uuid; v_tid uuid; v_pid uuid; v_est uuid := gen_random_uuid(); v_ev bigint[]; v_l1 uuid := gen_random_uuid(); v_l2 uuid := gen_random_uuid(); v_l3 uuid := gen_random_uuid();
  v_party uuid;
begin
  v_room := (select id from public.fixture_rooms where cargo_listing_id = pg_temp.fx_id('e_c'));
  -- an agreed term (agreed_proposal_id + agreed_by_party_id set)
  perform pg_temp.fx_as('e_ch');
  v_tid := pg_temp.fx_term(v_room, 'quantity');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 26000}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'e2e-proof-qty');
  v_pid := (v->'data'->>'proposalId')::uuid;
  perform pg_temp.fx_as('e_ow');
  v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'e2e-proof-qty-acc');
  -- a proposal chain: the owner's second offer supersedes its first
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'freight'), '{"num": 26.5}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'e2e-proof-offer-2');
  reset role;
  if not exists (select 1 from public.fixture_terms where room_id = v_room and status = 'agreed') then raise exception 'proof setup: no agreed term'; end if;
  if not exists (select 1 from public.fixture_proposals where room_id = v_room and supersedes_proposal_id is not null) then raise exception 'proof setup: no proposal chain'; end if;
  -- a PDA-link chain: three links on three events; link 2 supersedes link 1, link 3 supersedes itself
  insert into public.pda_estimates (id, owner_user_id, port_locode, terminal_name, call_date, coverage, input_snapshot, native_currency, native_total, generated_at)
  values (v_est, pg_temp.fx_id('u_ch1'), 'ZZFXA', 'proof quay', current_date + 12, 'manual_required', '{}', 'USD', 1000, now());
  select array_agg(id order by seq) into v_ev from (select id, seq from public.fixture_events where room_id = v_room order by seq limit 3) e;
  v_party := (select id from public.fixture_parties where room_id = v_room and side = 'cargo' and capacity = 'principal' limit 1);
  insert into public.fixture_pda_links (id, room_id, pda_estimate_id, purpose, linked_by_party_id, linked_by_user_id, linked_event_id, supersedes_link_id) values
    (v_l1, v_room, v_est, 'load', v_party, pg_temp.fx_id('e_ch'), v_ev[1], null),
    (v_l2, v_room, v_est, 'discharge', v_party, pg_temp.fx_id('e_ch'), v_ev[2], v_l1),
    (v_l3, v_room, v_est, 'other', v_party, pg_temp.fx_id('e_ch'), v_ev[3], v_l3);
  -- a successor room: close, then recreate on the same pairing (the new room's parties are e2e seats too)
  perform pg_temp.fx_as('e_ch');
  v := public.close_fixture_room(v_room, 'withdrawn', 'proof', pg_temp.fx_ver(v_room), 'e2e-proof-close');
  v := public.recreate_fixture_room(v_room, pg_temp.fx_terms(), 'e2e-proof-recreate', '{}'::jsonb);
  reset role;
  -- no command writes supersedes_room_id today; the column can still hold a chain, so the proof sets one
  v_room2 := (v->'data'->>'roomId')::uuid;
  update public.fixture_rooms set supersedes_room_id = v_room where id = v_room2;
  if v_room2 is null or not exists (select 1 from public.fixture_rooms where id = v_room2 and supersedes_room_id = v_room) then raise exception 'proof setup: no successor room (%)', v; end if;
  raise notice 'proof shapes: agreed term, proposal chain, 3 PDA links (chain + self link), successor room %', v_room2;
end $$;

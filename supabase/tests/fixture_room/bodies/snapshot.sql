-- ── N1 · listing edits and status changes after creation do not touch the room ─
do $$
declare v jsonb; r jsonb; v_room uuid; v_hash text; v_recap uuid; v_list jsonb;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'snap-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'snap-accept');
  perform pg_temp.fx_as('u_ch1');
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'quantity'), '{"num": 26000}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'snap-bid-qty');
  v := public.publish_fixture_recap(v_room, pg_temp.fx_ver(v_room), 'snap-recap-1');
  v_recap := (v->'data'->>'recapVersionId')::uuid;
  r := public.get_fixture_room(v_room);
  v_hash := r->'room'->>'snapshotHash';
  if r->'snapshot'->'cargo'->>'commodity_name' <> 'Wheat, Bulk' or (r->'snapshot'->'cargo'->>'qty_max_mt')::int <> 27500 then raise exception 'N1: baseline snapshot %', r->'snapshot'->'cargo'; end if;

  -- the marketplace moves on: the cargo is edited, the position goes off-market
  perform pg_temp.fx_owner();
  set local session_replication_role = replica;
  update public.cargo_listings set commodity_name = 'Corn, Bulk', qty_max_mt = 40000, notes = 'changed after the room opened' where id = pg_temp.fx_id('c1');
  update public.vessel_availability set status = 'FIXED', freight_idea_usd_mt = 99 where id = pg_temp.fx_id('a1');
  set local session_replication_role = origin;

  -- the charterer, who can no longer see the position through listing RLS, still reads the whole room
  perform pg_temp.fx_as('u_ch1');
  if exists (select 1 from public.vessel_availability where id = pg_temp.fx_id('a1')) then raise exception 'N1: the off-market position should be invisible to the charterer through RLS (test premise)'; end if;
  r := public.get_fixture_room(v_room);
  if r->'snapshot'->'cargo'->>'commodity_name' <> 'Wheat, Bulk' or (r->'snapshot'->'cargo'->>'qty_max_mt')::int <> 27500 then raise exception 'N1: snapshot rewritten by a listing edit: %', r->'snapshot'->'cargo'; end if;
  if r->'snapshot'->'vessel'->'availability'->>'status' <> 'OPEN' or (r->'snapshot'->'vessel'->'availability'->>'freight_idea_usd_mt')::numeric <> 26 then raise exception 'N1: vessel snapshot rewritten: %', r->'snapshot'->'vessel'->'availability'; end if;
  if r->'room'->>'snapshotHash' <> v_hash then raise exception 'N1: snapshot hash changed'; end if;
  if r::text like '%changed after the room opened%' then raise exception 'N1: post-creation notes leaked'; end if;
  if (select x->>'contentText' from jsonb_array_elements(r->'recaps') x where x->>'id' = v_recap::text) not like '%Wheat, Bulk%' then raise exception 'N1: recap text must keep the snapshot'; end if;
  -- the owner still reads too, and the inbox still lists the room from the snapshot
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  if r->'snapshot'->'vessel'->'vessel'->>'vessel_name' <> 'SEED VESSEL ONE' then raise exception 'N1: owner read broke'; end if;
  v_list := public.list_fixture_rooms(null, 50);
  if not exists (select 1 from jsonb_array_elements(v_list) x where x->>'id' = v_room::text and x->'cargo'->>'commodity' = 'Wheat, Bulk') then raise exception 'N1: inbox must come from the snapshot: %', v_list; end if;
  raise notice 'N1 ok: listing edits and a position going FIXED neither blank nor rewrite the room, the recap or the inbox';
end $$;

-- ── N2 · decision D4: the room never writes the listings; the sync view tells the truth ─
do $$
declare v jsonb; r jsonb; v_room uuid; v_code text; v_tid uuid; v_pid uuid; v_cargo text; v_vessel text;
begin
  perform pg_temp.fx_as('u_ow1');
  v := public.create_fixture_room(pg_temp.fx_id('c2'), pg_temp.fx_id('a3'), pg_temp.fx_terms(), 'snap-create-2', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_t1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'snap2-accept');
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates', 'freight'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_ow1');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, false, null, pg_temp.fx_ver(v_room), 'snap2-offer-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_t1');
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'snap2-accept-' || v_code);
  end loop;
  perform pg_temp.fx_as('u_ow1');
  v := public.add_fixture_subject(v_room, 'Sub stem', null, 'cargo', null, pg_temp.fx_ver(v_room), 'snap2-sub');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'snap2-fix');
  r := public.get_fixture_room(v_room);
  if r->'room'->'listingSync'->'cargo'->>'target' <> 'OUT' or r->'room'->'listingSync'->'vessel'->>'target' <> 'ON SUBS' then raise exception 'N2: targets %', r->'room'->'listingSync'; end if;
  if r->'room'->'listingSync'->'cargo'->>'current' <> 'IN' or r->'room'->'listingSync'->'vessel'->>'current' <> 'OPEN' then raise exception 'N2: current statuses %', r->'room'->'listingSync'; end if;
  if (r->'room'->'listingSync'->>'outstanding')::boolean is not true then raise exception 'N2: sync must be outstanding'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'events') x where x->>'type' = 'listing_sync.required' and x->'payload'->'target'->>'vessel_status' = 'ON SUBS') then raise exception 'N2: listing_sync.required event missing'; end if;
  -- the listings themselves were NOT touched by the room
  perform pg_temp.fx_owner();
  select status::text into v_cargo from public.cargo_listings where id = pg_temp.fx_id('c2');
  select status::text into v_vessel from public.vessel_availability where id = pg_temp.fx_id('a3');
  if v_cargo <> 'IN' or v_vessel <> 'OPEN' then raise exception 'N2: the room mutated a listing (% / %)', v_cargo, v_vessel; end if;
  -- an authorised owner updates the listings through the existing flows (simulated here): the requirement clears
  set local session_replication_role = replica;
  update public.vessel_availability set status = 'ON SUBS' where id = pg_temp.fx_id('a3');
  update public.cargo_listings set status = 'OUT' where id = pg_temp.fx_id('c2');
  set local session_replication_role = origin;
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  if (r->'room'->'listingSync'->>'outstanding')::boolean then raise exception 'N2: sync should be satisfied now: %', r->'room'->'listingSync'; end if;
  if not exists (select 1 from jsonb_array_elements(public.list_fixture_rooms(null, 50)) x where x->>'id' = v_room::text and (x->>'listingSyncOutstanding')::boolean = false) then raise exception 'N2: inbox flag'; end if;
  raise notice 'N2 ok: on_subjects records the requirement (cargo OUT, vessel ON SUBS), writes nothing to the listings, and the view clears once the owner updates them';
end $$;

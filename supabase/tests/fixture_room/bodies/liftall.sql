-- Fixture Room · LIFT ALL body (C2O-012 item 5, 28 Sep 2026): lift_all_fixture_subjects of
-- 20260923207000. Runs after the shared seed inside the caller's transaction.

do $$
declare v jsonb; v_fresh jsonb; v_room uuid; v_tid uuid; v_pid uuid; v_code text; e text; n bigint; v_key_events int; t text;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'lift-create', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'lift-accept');
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates', 'freight'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_ow1');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, false, null, pg_temp.fx_ver(v_room), 'lift-offer-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_ch1');
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'lift-acc-' || v_code);
  end loop;
  v := public.add_fixture_subject(v_room, 'Sub stem', null, 'cargo', null, pg_temp.fx_ver(v_room), 'lift-sub-1');
  -- a hostile title: a member typed a name, a phone and an email into it (C2O-012 item 2)
  v := public.add_fixture_subject(v_room, 'Sub details - call Tasos +30 690 000 0000 tasos@seed-owners.test', null, null, null, pg_temp.fx_ver(v_room), 'lift-sub-2');
  perform pg_temp.fx_as('u_ow1');
  v := public.add_fixture_subject(v_room, 'Sub owners'' approval', null, 'vessel', null, pg_temp.fx_ver(v_room), 'lift-sub-3');

  -- L0 · refused before the room is on subjects
  e := pg_temp.fx_err(format('select public.lift_all_fixture_subjects(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'lift-early'));
  if e <> 'FX_STATE' then raise exception 'L0: lift all while negotiating must be FX_STATE, got %', e; end if;
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'lift-fix');
  perform pg_temp.fx_as('u_ch1');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'lift-fix-c');
  if v->'data'->>'roomStatus' <> 'on_subjects' then raise exception 'L0: on subjects expected: %', v; end if;
  raise notice 'L0 ok: lift all is refused until the room is on subjects';

  -- L1 · the charterer lifts its own and the unassigned subject in one command
  perform pg_temp.fx_as('u_ch1');
  n := pg_temp.fx_events(v_room);
  v := public.lift_all_fixture_subjects(v_room, pg_temp.fx_ver(v_room), 'lift-all-ch');
  v_fresh := v;
  if (v->'data'->>'lifted')::int <> 2 or (v->'data'->>'openSubjects')::int <> 1 or v->'data'->>'roomStatus' <> 'on_subjects' then
    raise exception 'L1: two lifted, one left, still on subjects expected: %', v; end if;
  perform pg_temp.fx_owner();   -- the ledger and subjects are read as the database owner (members have no table access)
  select count(*) into v_key_events from public.fixture_events where room_id = v_room and idempotency_key = 'lift-all-ch' and type = 'subject.lifted';
  if v_key_events <> 2 or pg_temp.fx_events(v_room) <> n + 2 then raise exception 'L1: one ledger event per lifted subject expected, got %', v_key_events; end if;
  if (select count(*) from public.fixture_subjects where room_id = v_room and status = 'open' and responsible_side = 'vessel') <> 1 then
    raise exception 'L1: the owner''s subject must stay open'; end if;
  raise notice 'L1 ok: one command lifts every subject the side may lift, one ledger event each; the other side''s stays open';

  -- L2 · a retry replays; a stale version and a second attempt are refused
  perform pg_temp.fx_as('u_ch1');
  n := pg_temp.fx_events(v_room);
  v := public.lift_all_fixture_subjects(v_room, pg_temp.fx_ver(v_room) - 5, 'lift-all-ch');
  if (v->>'replayed')::boolean is not true or pg_temp.fx_events(v_room) <> n then raise exception 'L2: the retry must replay without new events: %', v; end if;
  -- C2O-012 item 1: the replay is the first response, field for field (only "replayed" differs)
  if (v - 'replayed') <> (v_fresh - 'replayed') then raise exception 'L2: replay must equal the first response: first % / replay %', v_fresh, v; end if;
  e := pg_temp.fx_err(format('select public.lift_all_fixture_subjects(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room) - 1, 'lift-all-stale'));
  if e = 'OK' then raise exception 'L2: a stale version must be refused'; end if;
  e := pg_temp.fx_err(format('select public.lift_all_fixture_subjects(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'lift-all-ch-2'));
  if e <> 'FX_STATE' then raise exception 'L2: nothing left for the charterer must be FX_STATE, got %', e; end if;
  raise notice 'L2 ok: a retry replays the first response exactly; stale versions and empty lifts are refused';

  -- L3 · an outsider cannot lift
  perform pg_temp.fx_as('u_out');
  e := pg_temp.fx_err(format('select public.lift_all_fixture_subjects(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'lift-all-out'));
  if e <> 'FX_AUTH' then raise exception 'L3: an outsider must be FX_AUTH, got %', e; end if;
  raise notice 'L3 ok: a non-party cannot lift subjects';

  -- L4 · the owner lifts the last one: the room is clean fixed in the same command
  perform pg_temp.fx_as('u_ow1');
  v := public.lift_all_fixture_subjects(v_room, pg_temp.fx_ver(v_room), 'lift-all-ow');
  if v->'data'->>'roomStatus' <> 'fixed' or (v->'data'->>'openSubjects')::int <> 0 then raise exception 'L4: the last lift must fix: %', v; end if;
  if pg_temp.fx_status(v_room) <> 'fixed' then raise exception 'L4: room not fixed'; end if;
  if pg_temp.fx_event_types(v_room) not like '%subject.lifted,room.fixed,listing_sync.required%' then raise exception 'L4: ledger %', pg_temp.fx_event_types(v_room); end if;
  perform pg_temp.fx_owner();
  raise notice 'L4 ok: lifting the last subjects clean-fixes the room with the listing sync, as a single lift does';

  -- L5 · with the shared notification core present: no subject title in any notification
  if to_regclass('public.notifications') is not null and exists (select 1 from pg_trigger g where g.tgrelid = 'public.fixture_events'::regclass and not g.tgisinternal and g.tgfoid = to_regprocedure('public.fn_fixture_notify_project()')) then
    select string_agg(x.title || ' ' || x.body || ' ' || x.payload::text, E'\n') into t from public.notifications x where x.payload->>'roomId' = v_room::text;
    if t is null then raise exception 'L5: the lifts must notify the other side'; end if;
    if t ~* '(Tasos|\+30 690|seed-owners\.test|Sub details|Sub stem)' then raise exception 'L5: a subject title reached a notification: %', t; end if;
    raise notice 'L5 ok: subject titles (member free text) never reach a notification';
  else
    raise notice 'L5 skipped: the shared notification core or the projector is absent';
  end if;
end $$;

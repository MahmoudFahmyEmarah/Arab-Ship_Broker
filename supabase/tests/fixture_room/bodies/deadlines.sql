-- Fixture Room · SUBJECT DEADLINES body (O2ALL-005, 9 Oct 2026): the room clock's subject sweep of 20261009200000.
-- Runs after the shared seed inside the caller's transaction (now() is that transaction's start; the test moves a
-- deadline with triggers off, as the owner, to stand in for the passage of time).
--   D1  a deadline two hours or less away is reminded once (subject.deadline_near); a later or missing one is not
--   D2  a passed deadline is flagged once (subject.overdue); the subject stays OPEN and the room stays on subjects
--   D3  an extension agreed by both sides re-arms the reminder for the new deadline
--   D4  lifted subjects and closed rooms are never reminded or flagged
--   D5  (with the notification core) the reminder reaches both sides, the overdue flag both sides AND the broker
--       desk; neither carries the subject's free-text title
--   D6  the clock runs the sweep; only service_role may call it
--   D7  O2ALL-006: a deadline changes only by agreement (propose, the other side accepts or declines; never
--       earlier, never past; the unilateral extend is refused)

do $$
declare v jsonb; v_room uuid; v_tid uuid; v_pid uuid; v_code text; v_s1 uuid; v_s2 uuid; v_s3 uuid; r jsonb; n int; v_core boolean;
begin
  v_core := to_regprocedure('public.fn_notification_enqueue(uuid, text, text, text, text, text, text, jsonb, boolean, timestamptz, timestamptz)') is not null;
  -- an active NON-owner admin exists throughout (C2O-101 P1: it must never hear a Fixture deadline)
  perform pg_temp.fx_owner();
  set local session_replication_role = replica;
  insert into auth.users (id, email, aud, role) values ('00000000-0000-4000-8000-0000000000af', 'u_sub@fixture.test', 'authenticated', 'authenticated');
  insert into public.users (id, supabase_user_id, email, full_name, company, role, admin_tier, subscription_tier, is_active)
  values ('00000000-0000-4000-8000-0000000000af', '00000000-0000-4000-8000-0000000000af', 'u_sub@fixture.test', 'Seed Sub-admin', 'Arab ShipBroker', 'admin', 'sub', 'T4', true);
  set local session_replication_role = origin;
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'dl-create', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'dl-accept');
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates', 'freight'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_ow1');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, false, null, pg_temp.fx_ver(v_room), 'dl-offer-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_ch1');
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'dl-acc-' || v_code);
  end loop;
  -- s1 due within the hour (a hostile title), s2 due in five hours, s3 without a deadline
  v := public.add_fixture_subject(v_room, 'Sub stem - call Tasos +30 690 000 0000', null, 'cargo', now() + interval '1 hour', pg_temp.fx_ver(v_room), 'dl-sub-1');
  v_s1 := (v->'data'->>'subjectId')::uuid;
  v := public.add_fixture_subject(v_room, 'Sub details', null, 'cargo', now() + interval '5 hours', pg_temp.fx_ver(v_room), 'dl-sub-2');
  v_s2 := (v->'data'->>'subjectId')::uuid;
  v := public.add_fixture_subject(v_room, 'Sub approval', null, 'cargo', null, pg_temp.fx_ver(v_room), 'dl-sub-3');
  v_s3 := (v->'data'->>'subjectId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'dl-fix-o');
  perform pg_temp.fx_as('u_ch1');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'dl-fix-c');
  if v->'data'->>'roomStatus' <> 'on_subjects' then raise exception 'D0: on subjects expected: %', v; end if;

  -- D1 · reminder once, only for the subject within two hours
  perform pg_temp.fx_owner();
  r := public.sweep_fixture_subject_deadlines(100);
  if (select count(*) from public.fixture_events where room_id = v_room and type = 'subject.deadline_near') <> 1
     or not exists (select 1 from public.fixture_events where room_id = v_room and type = 'subject.deadline_near'
                     and payload->>'subjectId' = v_s1::text and (payload->>'seq')::int = 1 and actor_user_id is null) then
    raise exception 'D1: one reminder for subject 1 only expected (sweep %)', r; end if;
  r := public.sweep_fixture_subject_deadlines(100);
  if (select count(*) from public.fixture_events where room_id = v_room and type = 'subject.deadline_near') <> 1 then
    raise exception 'D1: a second sweep must not repeat the reminder'; end if;
  raise notice 'D1 ok: a deadline within two hours is reminded once; a later one and a missing one are not';

  -- D2 · flagged once when passed; nothing fails
  set local session_replication_role = replica;
  update public.fixture_subjects set deadline_at = now() - interval '1 minute' where id = v_s1;
  set local session_replication_role = origin;
  r := public.sweep_fixture_subject_deadlines(100);
  r := public.sweep_fixture_subject_deadlines(100);
  if (select count(*) from public.fixture_events where room_id = v_room and type = 'subject.overdue' and payload->>'subjectId' = v_s1::text) <> 1 then
    raise exception 'D2: exactly one overdue flag for subject 1 expected'; end if;
  if (select status from public.fixture_subjects where id = v_s1) <> 'open'
     or (select status from public.fixture_rooms where id = v_room) <> 'on_subjects'
     or exists (select 1 from public.fixture_events where room_id = v_room and type in ('subject.failed', 'room.closed')) then
    raise exception 'D2: an overdue subject must stay open and the room on subjects (no automatic failure)'; end if;
  raise notice 'D2 ok: a passed deadline is flagged once; the subject stays open and nothing fails automatically';

  -- D3 · an extension AGREED by both sides re-arms the reminder for the new deadline (O2ALL-006)
  perform pg_temp.fx_as('u_ch1');
  v := public.propose_fixture_subject_extension(v_room, v_s1, now() + interval '90 minutes', pg_temp.fx_ver(v_room), 'dl-extend-1');
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_subject_extension(v_room, v_s1, true, pg_temp.fx_ver(v_room), 'dl-extend-1-ok');
  perform pg_temp.fx_owner();
  r := public.sweep_fixture_subject_deadlines(100);
  if (select count(*) from public.fixture_events where room_id = v_room and type = 'subject.deadline_near' and payload->>'subjectId' = v_s1::text) <> 2
     or not exists (select 1 from public.fixture_events e join public.fixture_subjects s on s.id = v_s1
                     where e.room_id = v_room and e.type = 'subject.deadline_near' and (e.payload->>'deadlineAt')::timestamptz = s.deadline_at) then
    raise exception 'D3: the extended deadline must be reminded once more'; end if;
  raise notice 'D3 ok: an extension re-arms the reminder for the new deadline';

  -- D4 · a lifted subject is never flagged
  perform pg_temp.fx_as('u_ch1');
  v := public.lift_fixture_subject(v_room, v_s2, pg_temp.fx_ver(v_room), 'dl-lift-2');
  perform pg_temp.fx_owner();
  set local session_replication_role = replica;
  update public.fixture_subjects set deadline_at = now() - interval '1 minute' where id = v_s2;
  set local session_replication_role = origin;
  r := public.sweep_fixture_subject_deadlines(100);
  if exists (select 1 from public.fixture_events where room_id = v_room and type in ('subject.deadline_near', 'subject.overdue') and payload->>'subjectId' in (v_s2::text, v_s3::text)) then
    raise exception 'D4: a lifted subject or one without a deadline must never be reminded or flagged'; end if;
  raise notice 'D4 ok: lifted subjects and subjects without a deadline are left alone';

  -- D5 · who hears it, masked
  if v_core then
    -- C2O-101 P1: an active NON-owner admin (tier 'sub') is not the broker desk and hears nothing of this room
    if exists (select 1 from public.notifications x join public.users u on u.id = x.recipient_user_id
                where x.payload->>'roomId' = v_room::text and lower(coalesce(u.role, '')) = 'admin' and coalesce(u.admin_tier, 'super') <> 'super') then
      raise exception 'D5: a non-owner admin must never hear a Fixture deadline'; end if;
    select count(*) into n from public.notifications x
     where x.kind = 'fixture.subject.deadline_near' and x.payload->>'roomId' = v_room::text
       and x.recipient_user_id in (pg_temp.fx_id('u_ch1'), pg_temp.fx_id('u_ow1')) and x.importance = 'urgent';
    if n < 2 then raise exception 'D5: the reminder reaches both sides, urgent (got %)', n; end if;
    if exists (select 1 from public.notifications x where x.kind = 'fixture.subject.deadline_near' and x.payload->>'roomId' = v_room::text
                and x.recipient_user_id = pg_temp.fx_id('u_adm')) then
      raise exception 'D5: the reminder is for the parties, not the broker desk'; end if;
    if not exists (select 1 from public.notifications x where x.kind = 'fixture.subject.overdue' and x.payload->>'roomId' = v_room::text and x.recipient_user_id = pg_temp.fx_id('u_ch1'))
       or not exists (select 1 from public.notifications x where x.kind = 'fixture.subject.overdue' and x.payload->>'roomId' = v_room::text and x.recipient_user_id = pg_temp.fx_id('u_ow1'))
       or not exists (select 1 from public.notifications x where x.kind = 'fixture.subject.overdue' and x.payload->>'roomId' = v_room::text and x.recipient_user_id = pg_temp.fx_id('u_adm')) then
      raise exception 'D5: the overdue flag reaches both sides and the broker desk'; end if;
    if exists (select 1 from public.notifications x where x.kind in ('fixture.subject.deadline_near', 'fixture.subject.overdue') and x.payload->>'roomId' = v_room::text
                and (x.title || ' ' || x.body) ~* '(tasos|\+30|stem)') then
      raise exception 'D5: a subject title must never reach a notification'; end if;
    if not exists (select 1 from public.notifications x where x.kind = 'fixture.subject.overdue' and x.payload->>'roomId' = v_room::text
                    and x.title like '%subject 1 is overdue' and x.body like '%Nothing fails automatically%') then
      raise exception 'D5: the overdue wording names the subject number and says nothing fails'; end if;
    raise notice 'D5 ok: the reminder reaches both sides; the overdue flag both sides and the broker desk; no subject title leaves the room';
  else
    raise notice 'D5 skipped: no shared notification core on this database';
  end if;

  -- D6 · the clock runs it; only the service role may
  r := public.run_fixture_room_clock();
  if r->'subjects' is null then raise exception 'D6: the room clock must run the subject sweep: %', r; end if;
  if has_function_privilege('authenticated', 'public.sweep_fixture_subject_deadlines(integer)', 'execute')
     or has_function_privilege('anon', 'public.sweep_fixture_subject_deadlines(integer)', 'execute')
     or not has_function_privilege('service_role', 'public.sweep_fixture_subject_deadlines(integer)', 'execute') then
    raise exception 'D6: the sweep is service_role only'; end if;
  raise notice 'D6 ok: the room clock runs the subject sweep; only service_role may call it';
end $$;

-- D7 · O2ALL-006: a deadline changes only by agreement — proposed by one side, answered by the other
do $$
declare v jsonb; v_room uuid; v_tid uuid; v_pid uuid; v_code text; v_s uuid; e text; v_before timestamptz; n int;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a3'), pg_temp.fx_terms(), 'dlx-create', '{}'::jsonb);   -- a3: u_ow1's third position (v2 is the sanctioned vessel)
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'dlx-accept');
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates', 'freight'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_ow1');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, false, null, pg_temp.fx_ver(v_room), 'dlx-offer-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_ch1');
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'dlx-acc-' || v_code);
  end loop;
  v := public.add_fixture_subject(v_room, 'Sub stem', null, 'cargo', now() + interval '1 day', pg_temp.fx_ver(v_room), 'dlx-sub');
  v_s := (v->'data'->>'subjectId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'dlx-fix-o');
  perform pg_temp.fx_as('u_ch1');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'dlx-fix-c');
  perform pg_temp.fx_owner();
  select deadline_at into v_before from public.fixture_subjects where id = v_s;

  -- the unilateral path is closed; earlier, equal and past deadlines are refused
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.extend_fixture_subject(%L, %L, %L, %s, %L)', v_room, v_s, now() + interval '3 days', pg_temp.fx_ver(v_room), 'dlx-old'));
  if e <> 'FX_STATE' then raise exception 'D7: the unilateral extend must be refused, got %', e; end if;
  e := pg_temp.fx_err(format('select public.propose_fixture_subject_extension(%L, %L, %L, %s, %L)', v_room, v_s, v_before - interval '1 hour', pg_temp.fx_ver(v_room), 'dlx-earlier'));
  if e <> 'FX_VALIDATION' then raise exception 'D7: an earlier deadline must be refused, got %', e; end if;
  e := pg_temp.fx_err(format('select public.propose_fixture_subject_extension(%L, %L, %L, %s, %L)', v_room, v_s, now() - interval '1 hour', pg_temp.fx_ver(v_room), 'dlx-past'));
  if e <> 'FX_VALIDATION' then raise exception 'D7: a past deadline must be refused, got %', e; end if;

  -- a proposal leaves the deadline as it is; the proposer cannot accept its own proposal
  v := public.propose_fixture_subject_extension(v_room, v_s, now() + interval '3 days', pg_temp.fx_ver(v_room), 'dlx-propose');
  perform pg_temp.fx_owner();
  if (select deadline_at from public.fixture_subjects where id = v_s) <> v_before then raise exception 'D7: a proposal must not move the deadline'; end if;
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.respond_fixture_subject_extension(%L, %L, true, %s, %L)', v_room, v_s, pg_temp.fx_ver(v_room), 'dlx-self'));
  if e <> 'FX_AUTH' then raise exception 'D7: the proposing side must not accept its own proposal, got %', e; end if;

  -- the other side declines: the deadline stands and nothing is pending
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_subject_extension(v_room, v_s, false, pg_temp.fx_ver(v_room), 'dlx-decline');
  perform pg_temp.fx_owner();
  if (select deadline_at from public.fixture_subjects where id = v_s) <> v_before or (public.fn_fixture_subject_pending_extension(v_room, v_s)).id is not null then
    raise exception 'D7: a declined proposal leaves the deadline and nothing pending'; end if;
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.respond_fixture_subject_extension(%L, %L, true, %s, %L)', v_room, v_s, pg_temp.fx_ver(v_room), 'dlx-none'));
  if e <> 'FX_STATE' then raise exception 'D7: answering with nothing pending must be FX_STATE, got %', e; end if;

  -- the owner side proposes, the charterer side accepts: the deadline moves, once
  v := public.propose_fixture_subject_extension(v_room, v_s, now() + interval '4 days', pg_temp.fx_ver(v_room), 'dlx-propose-2');
  perform pg_temp.fx_as('u_ch1');
  v := public.respond_fixture_subject_extension(v_room, v_s, true, pg_temp.fx_ver(v_room), 'dlx-accept-2');
  perform pg_temp.fx_owner();
  if (select deadline_at from public.fixture_subjects where id = v_s) <> now() + interval '4 days'
     or (select extended_count from public.fixture_subjects where id = v_s) <> 1
     or not exists (select 1 from public.fixture_events where room_id = v_room and type = 'subject.extended'
                     and payload->>'proposedBySide' = 'vessel' and payload->>'acceptedBySide' = 'cargo') then
    raise exception 'D7: an accepted proposal moves the deadline once and records both sides'; end if;
  raise notice 'D7 ok: unilateral, earlier and past deadlines are refused; a proposal waits for the other side; decline keeps it; accept moves it once';
end $$;

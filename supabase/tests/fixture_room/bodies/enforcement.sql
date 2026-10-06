-- ── E1 · hold and refer stop a term from moving (PR-08) ─────────────────────
do $$
declare v jsonb; r jsonb; v_room uuid; e text; v_tid uuid; v_offer uuid;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'enf-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  r := public.get_fixture_room(v_room);
  if (r->'room'->>'negotiationWindowEndsAt') is null
     or (r->'room'->>'negotiationWindowEndsAt')::timestamptz not between now() + interval '13 days 23 hours' and now() + interval '14 days 1 hour' then
    raise exception 'E1: a new room must get a 14-day negotiation window, got %', r->'room'->>'negotiationWindowEndsAt'; end if;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'enf-inv');
  v_tid := pg_temp.fx_term(v_room, 'freight');

  -- hold: nobody proposes on the term; only the holder resumes
  perform pg_temp.fx_as('u_ch1');
  v := public.set_fixture_term_flag(v_room, v_tid, 'hold', 'checking with the receivers', pg_temp.fx_ver(v_room), 'enf-hold');
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, '{"num": 25}', pg_temp.fx_ver(v_room), 'enf-bid-held'));
  if e <> 'FX_STATE' then raise exception 'E1: a bid on a held term must be FX_STATE, got %', e; end if;
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, '{"num": 27}', pg_temp.fx_ver(v_room), 'enf-offer-held'));
  if e <> 'FX_STATE' then raise exception 'E1: an offer on a term the other side holds must be FX_STATE, got %', e; end if;
  e := pg_temp.fx_err(format('select public.set_fixture_term_flag(%L, %L, %L, null, %s, %L)', v_room, v_tid, 'resume', pg_temp.fx_ver(v_room), 'enf-resume-owner'));
  if e <> 'FX_AUTH' then raise exception 'E1: only the holder resumes, got %', e; end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.set_fixture_term_flag(v_room, v_tid, 'resume', null, pg_temp.fx_ver(v_room), 'enf-resume');

  -- refer: the standing offer cannot be accepted until the referring side clears it
  perform pg_temp.fx_as('u_ow1');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 26}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'enf-offer-1');
  v_offer := (v->'data'->>'proposalId')::uuid;
  perform pg_temp.fx_as('u_ch1');
  v := public.set_fixture_term_flag(v_room, v_tid, 'refer', 'to principals', pg_temp.fx_ver(v_room), 'enf-refer');
  e := pg_temp.fx_err(format('select public.accept_fixture_proposal(%L, %L, %s, %L)', v_room, v_offer, pg_temp.fx_ver(v_room), 'enf-accept-referred'));
  if e <> 'FX_STATE' then raise exception 'E1: accepting on a referred term must be FX_STATE, got %', e; end if;
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, '{"num": 25.75}', pg_temp.fx_ver(v_room), 'enf-offer-referred'));
  if e <> 'FX_STATE' then raise exception 'E1: a new offer on a referred term must be FX_STATE, got %', e; end if;
  e := pg_temp.fx_err(format('select public.set_fixture_term_flag(%L, %L, %L, null, %s, %L)', v_room, v_tid, 'clear_referral', pg_temp.fx_ver(v_room), 'enf-clear-owner'));
  if e <> 'FX_AUTH' then raise exception 'E1: only the referring side clears a referral, got %', e; end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.set_fixture_term_flag(v_room, v_tid, 'clear_referral', null, pg_temp.fx_ver(v_room), 'enf-clear');
  v := public.accept_fixture_proposal(v_room, v_offer, pg_temp.fx_ver(v_room), 'enf-accept-1');
  if v->'data'->>'termStatus' <> 'agreed' then raise exception 'E1: accept after the referral cleared must agree: %', v; end if;
  raise notice 'E1 ok: 14-day window at creation; held and referred terms take no proposal and no acceptance; only the holder resumes and only the referring side clears';
end $$;

-- ── E2 · both sides confirm the same basis (PR-07) ──────────────────────────
do $$
declare v jsonb; r jsonb; v_room uuid; e text; v_tid uuid; v_pid uuid; v_code text; v_sub_v uuid; v_sub_c uuid;
begin
  v_room := pg_temp.fx_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'));
  foreach v_code in array array['cargo_grade', 'quantity', 'ports', 'laycan', 'ld_rates'] loop
    v_tid := pg_temp.fx_term(v_room, v_code);
    perform pg_temp.fx_as('u_ch1');
    v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value(v_code), null, false, null, pg_temp.fx_ver(v_room), 'enf-bid-' || v_code);
    v_pid := (v->'data'->>'proposalId')::uuid;
    perform pg_temp.fx_as('u_ow1');
    v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'enf-acc-' || v_code);
  end loop;
  -- the charterer confirms first
  perform pg_temp.fx_as('u_ch1');
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'enf-fix-c1');
  if v->'data'->>'awaitingSide' <> 'vessel' or pg_temp.fx_status(v_room) <> 'negotiating' then raise exception 'E2: first confirmation must wait for the owner: %', v; end if;
  -- the owner adds subjects: the charterer's confirmation no longer matches
  perform pg_temp.fx_as('u_ow1');
  v := public.add_fixture_subject(v_room, 'Sub owners'' management approval', null, 'vessel', null, pg_temp.fx_ver(v_room), 'enf-sub-v');
  v_sub_v := (v->'data'->>'subjectId')::uuid;
  v := public.add_fixture_subject(v_room, 'Sub stem', null, 'cargo', null, pg_temp.fx_ver(v_room), 'enf-sub-c');
  v_sub_c := (v->'data'->>'subjectId')::uuid;
  r := public.get_fixture_room(v_room);
  if r->'viewer'->'capabilities'->'fixConfirmedSides' <> '[]'::jsonb then raise exception 'E2: a stale confirmation must not count: %', r->'viewer'->'capabilities'->'fixConfirmedSides'; end if;
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'enf-fix-o1');
  if v->'data'->>'awaitingSide' <> 'cargo' or pg_temp.fx_status(v_room) <> 'negotiating' then raise exception 'E2: the owner must now wait for the charterer to confirm the new basis: %', v; end if;
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  if r->'viewer'->'capabilities'->'fixConfirmedSides' <> '["vessel"]'::jsonb then raise exception 'E2: confirmed sides %', r->'viewer'->'capabilities'->'fixConfirmedSides'; end if;
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room), 'enf-fix-c2');
  if v->'data'->>'roomStatus' <> 'on_subjects' or (v->'data'->>'openSubjects')::int <> 2 then raise exception 'E2: both confirmed → on subjects with 2 open: %', v; end if;
  -- a replay returns the original result, it does not confirm again
  v := public.fix_fixture_on_subjects(v_room, pg_temp.fx_ver(v_room) - 1, 'enf-fix-c2');
  if (v->>'replayed')::boolean is not true then raise exception 'E2: same key must replay: %', v; end if;
  raise notice 'E2 ok: one confirmation waits; a new subject voids the earlier one; the second side on the same basis fixes on subjects';
end $$;

-- ── E3 · reopening from on subjects reinstates lifted subjects (PR-08) ─────
do $$
declare v jsonb; r jsonb; v_room uuid; v_sub_v uuid; v_n int;
begin
  v_room := pg_temp.fx_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'));
  perform pg_temp.fx_owner();   -- table peeks run as the owner: members cannot read fixture tables
  select id into v_sub_v from public.fixture_subjects where room_id = v_room and responsible_side = 'vessel';
  perform pg_temp.fx_as('u_ow1');
  v := public.lift_fixture_subject(v_room, v_sub_v, pg_temp.fx_ver(v_room), 'enf-lift-v');
  if (v->'data'->>'openSubjects')::int <> 1 then raise exception 'E3: one subject left expected: %', v; end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.reopen_fixture_term(v_room, pg_temp.fx_term(v_room, 'laycan'), 'receivers moved the laycan', pg_temp.fx_ver(v_room), 'enf-reopen');
  if v->'data'->>'roomStatus' <> 'negotiating' or (v->'data'->>'subjectsReinstated')::int <> 1 then raise exception 'E3: reopen must return to negotiation and reinstate 1 subject: %', v; end if;
  perform pg_temp.fx_owner();
  select count(*) into v_n from public.fixture_subjects where room_id = v_room and status = 'open';
  perform pg_temp.fx_as('u_ch1');
  if v_n <> 2 then raise exception 'E3: both subjects must be open again, % open', v_n; end if;
  if pg_temp.fx_event_types(v_room) not like '%term.reopened,room.returned_to_negotiation,subject.reinstated,listing_sync.required%' then raise exception 'E3: ledger %', pg_temp.fx_event_types(v_room); end if;
  r := public.get_fixture_room(v_room);
  if (r->'room'->>'negotiationWindowEndsAt')::timestamptz < now() + interval '3 days' - interval '1 minute' then raise exception 'E3: returning to negotiation must leave at least three days: %', r->'room'->>'negotiationWindowEndsAt'; end if;
  raise notice 'E3 ok: reopen from on subjects reinstates the lifted subject, records subject.reinstated and keeps three days of window';
end $$;

-- ── E4 · the negotiation window closes, the mediator extends it, the clock expires (PR-08, C2O-052) ─
-- the exact refusal: E4 must fail for the window, not for any other FX_STATE
create or replace function pg_temp.fx_errmsg(p_sql text) returns text language plpgsql as $f$
declare v jsonb;
begin
  execute p_sql into v;
  return 'OK';
exception when others then
  return sqlerrm;
end $f$;

do $$
declare v jsonb; r jsonb; v_room uuid; e text; v_tid uuid; v_last jsonb; v_bid uuid; v_win constant text := '%negotiation window closed%';
begin
  v_room := pg_temp.fx_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'));
  v_tid := pg_temp.fx_term(v_room, 'laycan');
  -- a live bid to withdraw later; everything below is allowed until the deadline
  perform pg_temp.fx_as('u_ch1');
  v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value('laycan'), null, false, null, pg_temp.fx_ver(v_room), 'enf-bid-before');
  v_bid := (v->'data'->>'proposalId')::uuid;
  perform pg_temp.fx_owner();
  update public.fixture_rooms set negotiation_window_ends_at = now() - interval '1 minute' where id = v_room;
  perform pg_temp.fx_as('u_ch1');
  -- every commercial command answers with the window, not another state
  e := pg_temp.fx_errmsg(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, %L)', v_room, v_tid, pg_temp.fx_value('laycan'), pg_temp.fx_ver(v_room), 'enf-bid-late'));
  if e not like 'FX_STATE: ' || v_win then raise exception 'E4: a bid after the deadline must be refused for the window, got %', e; end if;
  e := pg_temp.fx_errmsg(format('select public.withdraw_fixture_proposal(%L, %L, %s, %L)', v_room, v_bid, pg_temp.fx_ver(v_room), 'enf-withdraw-late'));
  if e not like 'FX_STATE: ' || v_win then raise exception 'E4: withdraw after the deadline, got %', e; end if;
  e := pg_temp.fx_errmsg(format('select public.set_fixture_term_flag(%L, %L, %L, null, %s, %L)', v_room, v_tid, 'hold', pg_temp.fx_ver(v_room), 'enf-hold-late'));
  if e not like 'FX_STATE: ' || v_win then raise exception 'E4: hold after the deadline, got %', e; end if;
  e := pg_temp.fx_errmsg(format('select public.add_fixture_subject(%L, %L, null, null, null, %s, %L)', v_room, 'Sub late', pg_temp.fx_ver(v_room), 'enf-sub-late'));
  if e not like 'FX_STATE: ' || v_win then raise exception 'E4: add subject after the deadline, got %', e; end if;
  e := pg_temp.fx_errmsg(format('select public.invite_fixture_party(%L, %L, %L, %L, null, %s, %L)', v_room, 'cargo', 'viewer', pg_temp.fx_id('org_ch'), pg_temp.fx_ver(v_room), 'enf-invite-late'));
  if e not like 'FX_STATE: ' || v_win then raise exception 'E4: invite after the deadline, got %', e; end if;
  e := pg_temp.fx_errmsg(format('select public.reopen_fixture_term(%L, %L, null, %s, %L)', v_room, pg_temp.fx_term(v_room, 'freight'), pg_temp.fx_ver(v_room), 'enf-reopen-late'));
  if e not like 'FX_STATE: ' || v_win then raise exception 'E4: reopen after the deadline, got %', e; end if;
  e := pg_temp.fx_errmsg(format('select public.fix_fixture_on_subjects(%L, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'enf-fix-late'));
  if e not like 'FX_STATE: ' || v_win then raise exception 'E4: a fix after the deadline, got %', e; end if;
  r := public.get_fixture_room(v_room);
  if (r->'viewer'->'capabilities'->>'windowClosed')::boolean is not true
     or (r->'viewer'->'capabilities'->>'canPropose')::boolean or (r->'viewer'->'capabilities'->>'canAddSubject')::boolean
     or (r->'viewer'->'capabilities'->>'canInvite')::boolean or (r->'viewer'->'capabilities'->>'canFixOnSubjects')::boolean then
    raise exception 'E4: capabilities must show the closed window: %', r->'viewer'->'capabilities'; end if;
  -- only the mediator extends, never shorter than the current deadline, at most 60 days
  e := pg_temp.fx_err(format('select public.extend_fixture_negotiation_window(%L, %L::timestamptz, %s, %L)', v_room, now() + interval '2 days', pg_temp.fx_ver(v_room), 'enf-extend-member'));
  if e <> 'FX_AUTH' then raise exception 'E4: a member extending the window must be FX_AUTH, got %', e; end if;
  perform pg_temp.fx_as('u_adm', true);
  e := pg_temp.fx_err(format('select public.extend_fixture_negotiation_window(%L, %L::timestamptz, %s, %L)', v_room, now() + interval '90 days', pg_temp.fx_ver(v_room), 'enf-extend-far'));
  if e <> 'FX_VALIDATION' then raise exception 'E4: a window beyond 60 days must be FX_VALIDATION, got %', e; end if;
  v := public.extend_fixture_negotiation_window(v_room, now() + interval '2 days', pg_temp.fx_ver(v_room), 'enf-extend');
  if pg_temp.fx_event_types(v_room) not like '%room.window_extended' then raise exception 'E4: ledger %', pg_temp.fx_event_types(v_room); end if;
  e := pg_temp.fx_errmsg(format('select public.extend_fixture_negotiation_window(%L, %L::timestamptz, %s, %L)', v_room, now() + interval '1 day', pg_temp.fx_ver(v_room), 'enf-extend-shorter'));
  if e not like 'FX_VALIDATION: an extension must end after the current deadline%' then raise exception 'E4: an extension may not shorten the window, got %', e; end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.withdraw_fixture_proposal(v_room, v_bid, pg_temp.fx_ver(v_room), 'enf-withdraw-extended');
  v := public.submit_fixture_proposal(v_room, v_tid, pg_temp.fx_value('laycan'), null, false, null, pg_temp.fx_ver(v_room), 'enf-bid-extended');
  -- close it again and let the clock run
  perform pg_temp.fx_owner();
  update public.fixture_rooms set negotiation_window_ends_at = now() - interval '1 minute' where id = v_room;
  v := public.run_fixture_room_clock();
  if (v->'windows'->>'expired')::int < 1 or pg_temp.fx_status(v_room) <> 'expired' then raise exception 'E4: the clock must expire the room: % / %', v, pg_temp.fx_status(v_room); end if;
  if (select closed_reason from public.fixture_rooms where id = v_room) <> 'expired' then raise exception 'E4: closed reason must be expired'; end if;
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  select x into v_last from jsonb_array_elements(r->'events') x where x->>'type' = 'room.closed';
  if v_last->>'actorLabel' <> 'System' or v_last->'payload'->>'reason' <> 'expired' then raise exception 'E4: the expiry must read as a System close: %', v_last; end if;
  raise notice 'E4 ok: after the deadline bid, withdraw, hold, add-subject, invite, reopen and fix are refused for the window; only the mediator extends, never shorter, ≤ 60 days; the clock expires the room as System';
end $$;

-- ── E6 · a never-accepted invitee: no answer after the deadline, no access after expiry (C2O-052) ─
do $$
declare v jsonb; r jsonb; v_room uuid; e text;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'enf-create-2', '{}'::jsonb);
  if (v->>'ok')::boolean is not true then raise exception 'E6: a new room on the expired pairing must open: %', v; end if;
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_owner();
  update public.fixture_rooms set negotiation_window_ends_at = now() - interval '1 minute' where id = v_room;
  perform pg_temp.fx_as('u_ow1');
  r := public.get_fixture_room(v_room);
  if (r->'viewer'->'capabilities'->>'canRespondInvitation')::boolean then raise exception 'E6: no answer after the deadline: %', r->'viewer'->'capabilities'; end if;
  e := pg_temp.fx_errmsg(format('select public.respond_fixture_invitation(%L, true, %s, %L)', v_room, pg_temp.fx_ver(v_room), 'enf-respond-late'));
  if e not like 'FX_STATE: %negotiation window closed%' then raise exception 'E6: answering after the deadline must be refused for the window, got %', e; end if;
  perform pg_temp.fx_owner();
  v := public.run_fixture_room_clock();
  if pg_temp.fx_status(v_room) <> 'expired' then raise exception 'E6: the clock must expire the room'; end if;
  -- the pending invitee loses the room; the accepted charterer keeps the archive
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.get_fixture_room(%L)', v_room));
  if e <> 'FX_AUTH' then raise exception 'E6: a pending invitee must lose access to an expired room, got %', e; end if;
  if exists (select 1 from jsonb_array_elements(public.list_fixture_rooms()) x where x->>'id' = v_room::text) then raise exception 'E6: the expired room must leave the invitee''s inbox'; end if;
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  if r->'room'->>'status' <> 'expired' then raise exception 'E6: the accepted participant keeps the archive: %', r->'room'; end if;
  if not exists (select 1 from jsonb_array_elements(public.list_fixture_rooms()) x where x->>'id' = v_room::text) then raise exception 'E6: the expired room stays in the participant''s inbox'; end if;
  raise notice 'E6 ok: a pending invitee cannot answer after the deadline and loses the room (read and inbox) once it expires; the accepted participant keeps the archive';
end $$;

-- ── E5 · the clock observes a lapsed proposal exactly once ──────────────────
do $$
declare v jsonb; v_room uuid; v_tid uuid; v_pid uuid; v_n int;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a4'), pg_temp.fx_terms(), 'enf-create-a4', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_solo');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'enf-a4-inv');
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 30}'::jsonb, null, false, 5, pg_temp.fx_ver(v_room), 'enf-a4-offer');
  v_pid := (v->'data'->>'proposalId')::uuid;
  perform pg_temp.fx_owner();
  set local session_replication_role = replica;   -- proposals are append-only; age this one for the test
  update public.fixture_proposals set expires_at = now() - interval '1 minute' where id = v_pid;
  set local session_replication_role = origin;
  v := public.run_fixture_room_clock();
  if (v->'lapses'->>'swept')::int < 1 then raise exception 'E5: the clock must observe the lapse: %', v; end if;
  v := public.run_fixture_room_clock();
  select count(*) into v_n from public.fixture_events where room_id = v_room and type = 'proposal.lapsed' and payload->>'proposalId' = v_pid::text;
  if v_n <> 1 then raise exception 'E5: one observation expected after two runs, got %', v_n; end if;
  -- the owner replaces it: the submit path does not observe it a second time
  perform pg_temp.fx_as('u_solo');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 29}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'enf-a4-offer-2');
  perform pg_temp.fx_owner();
  select count(*) into v_n from public.fixture_events where room_id = v_room and type = 'proposal.lapsed' and payload->>'proposalId' = v_pid::text;
  if v_n <> 1 then raise exception 'E5: the submit path must not observe the lapse again, got %', v_n; end if;
  -- members cannot reach the clock
  if has_function_privilege('authenticated', 'public.run_fixture_room_clock()', 'execute')
     or has_function_privilege('authenticated', 'public.sweep_fixture_room_windows(integer)', 'execute')
     or has_function_privilege('authenticated', 'public.sweep_fixture_proposal_lapses(integer)', 'execute') then
    raise exception 'E5: the clock must be service-only'; end if;
  raise notice 'E5 ok: one lapse observation per proposal across clock runs and the submit path; the clock is service-only';
end $$;

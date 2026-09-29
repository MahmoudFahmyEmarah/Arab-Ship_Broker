-- Fixture Room · EXPIRY body (26 Sep 2026): the service-only proposal-lapse sweep
-- (migration 20260923204000). Runs after the shared seed inside the caller's
-- transaction; assembled into fixture_expiry_smoke.sql by scripts/fixture-room-harness.sh.

-- ── X1 · the sweep observes a live, expired proposal once; the room version moves; a second run writes nothing ─
-- ── X2 · UPGRADE REGRESSION (C2O-003): the harness applies the original 20260923203000 first and 20260923204000 alone after it; sweep -> member replacement leaves exactly one proposal.lapsed ─
-- ── X3 · an agreed term is never swept, whatever its proposal's validity says ─
-- ── X4 · a closed room is never swept ─
do $$
declare v jsonb; s jsonb; t jsonb; v_room uuid; v_tid uuid; v_pid uuid; v_fid uuid; v_ver integer; n bigint; e text;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'exp-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'exp-accept-inv');
  v_tid := pg_temp.fx_term(v_room, 'ld_rates');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"load": 8000, "disch": 6000}'::jsonb, null, false, 1, pg_temp.fx_ver(v_room), 'exp-offer-rates-1');
  v_pid := (v->'data'->>'proposalId')::uuid;
  -- an open-ended offer on another term is never a sweep candidate
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'freight'), '{"num": 30}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'exp-offer-freight-1');
  v_fid := (v->'data'->>'proposalId')::uuid;

  -- nothing has lapsed: the sweep is a no-op and moves no version
  perform pg_temp.fx_owner();
  v_ver := pg_temp.fx_ver(v_room);
  s := public.sweep_fixture_proposal_lapses(100);
  if (s->>'swept')::int <> 0 or pg_temp.fx_ver(v_room) <> v_ver then raise exception 'X1: nothing should lapse yet: %', s; end if;

  -- the one-minute offer lapses: now() is the transaction time, so the row is backdated as the table owner with
  -- the append-only trigger switched off for that one statement (the suite is rolled back; nothing persists)
  execute 'alter table public.fixture_proposals disable trigger trg_fixture_proposals_immutable';
  update public.fixture_proposals set expires_at = now() - interval '1 minute' where id = v_pid;
  execute 'alter table public.fixture_proposals enable trigger trg_fixture_proposals_immutable';

  s := public.sweep_fixture_proposal_lapses(100);
  if (s->>'swept')::int <> 1 or (s->>'rooms')::int <> 1 then raise exception 'X1: expected one lapse in one room, got %', s; end if;
  if pg_temp.fx_ver(v_room) <> v_ver + 1 then raise exception 'X1: the sweep must move the room version by exactly one (% -> %)', v_ver, pg_temp.fx_ver(v_room); end if;
  if pg_temp.fx_event_types(v_room) not like '%,proposal.lapsed' then raise exception 'X1: ledger %', pg_temp.fx_event_types(v_room); end if;
  select count(*) into n from public.fixture_events x
   where x.room_id = v_room and x.type = 'proposal.lapsed' and x.payload->>'proposalId' = v_pid::text
     and x.actor_user_id is null and x.actor_party_id is null and x.command = 'sweep_fixture_proposal_lapses'
     and x.idempotency_key = 'sweep:' || v_pid::text and x.result is null
     and x.payload->>'source' = 'sweep' and x.payload->>'termCode' = 'ld_rates' and x.payload->>'side' = 'vessel'
     and x.payload->>'displayValue' is not null and x.payload->>'expiredAt' is not null;
  if n <> 1 then raise exception 'X1: expected one system lapse event with the full payload, found %', n; end if;
  -- proposals, term status and the live pointer are untouched
  if (select status from public.fixture_terms where id = v_tid) not in ('open', 'countered') then raise exception 'X1: the term status must not change'; end if;
  if (select vessel_proposal_id from public.fixture_terms where id = v_tid) is distinct from v_pid then raise exception 'X1: the live pointer must stay'; end if;

  -- a second sweep writes nothing
  v_ver := pg_temp.fx_ver(v_room);
  s := public.sweep_fixture_proposal_lapses(100);
  if (s->>'swept')::int <> 0 or pg_temp.fx_ver(v_room) <> v_ver then raise exception 'X1: the sweep must be idempotent: %', s; end if;

  -- a member sees the lapse in the read model and the observation labelled System in the ledger
  perform pg_temp.fx_as('u_ch1');
  v := public.get_fixture_room(v_room);
  if (v->>'version')::int <> v_ver then raise exception 'X1: the read model must carry the swept version'; end if;
  if not exists (select 1 from jsonb_array_elements(v->'terms') x where x->>'id' = v_tid::text and (x->'vesselPosition'->>'lapsed')::boolean) then
    raise exception 'X1: the read model must report the vessel position as lapsed'; end if;
  select count(*) into n from jsonb_array_elements(v->'events') ev where ev->>'type' = 'proposal.lapsed' and ev->>'actorLabel' = 'System';
  if n <> 1 then raise exception 'X1: the ledger entry must be labelled System for a member, found %', n; end if;
  raise notice 'X1 ok: one System lapse observation, version +1, idempotent, pointers untouched, visible to the counterparty';

  -- X2 · the owner replaces the lapsed offer: the ledger gains proposal.submitted only (no second lapse), the new offer is live
  perform pg_temp.fx_as('u_ow1');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"load": 8500, "disch": 6500}'::jsonb, 'renewed', false, null, pg_temp.fx_ver(v_room), 'exp-offer-rates-2');
  perform pg_temp.fx_owner();  -- owner-level peeks: members hold no table grant
  if pg_temp.fx_event_types(v_room) not like '%,proposal.lapsed,proposal.submitted' then raise exception 'X2: ledger %', pg_temp.fx_event_types(v_room); end if;
  select count(*) into n from public.fixture_events x where x.room_id = v_room and x.type = 'proposal.lapsed' and x.payload->>'proposalId' = v_pid::text;
  if n <> 1 then raise exception 'X2: the submit path must not observe the lapse a second time, found %', n; end if;
  if (select vessel_proposal_id from public.fixture_terms where id = v_tid) = v_pid then raise exception 'X2: the new offer must be live'; end if;
  -- the lapsed offer can still not be accepted
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.accept_fixture_proposal(%L, %L, %s, %L)', v_room, v_pid, pg_temp.fx_ver(v_room), 'exp-accept-lapsed'));
  if e <> 'FX_STATE' then raise exception 'X2: accepting a lapsed proposal must be FX_STATE, got %', e; end if;
  raise notice 'X2 ok: the submit path observes no second lapse; the lapsed offer stays unacceptable';

  -- X3 · the charterer accepts the freight offer; its row is then given a past validity: agreed terms are never swept
  v := public.accept_fixture_proposal(v_room, v_fid, pg_temp.fx_ver(v_room), 'exp-accept-freight');
  perform pg_temp.fx_owner();
  if (select status from public.fixture_terms where room_id = v_room and code = 'freight') <> 'agreed' then raise exception 'X3: freight must be agreed'; end if;
  execute 'alter table public.fixture_proposals disable trigger trg_fixture_proposals_immutable';
  update public.fixture_proposals set expires_at = now() - interval '1 minute' where id = v_fid;
  execute 'alter table public.fixture_proposals enable trigger trg_fixture_proposals_immutable';
  v_ver := pg_temp.fx_ver(v_room);
  s := public.sweep_fixture_proposal_lapses(100);
  if (s->>'swept')::int <> 0 or pg_temp.fx_ver(v_room) <> v_ver then raise exception 'X3: an agreed term must never be swept: %', s; end if;
  raise notice 'X3 ok: an agreed term is never swept';

  -- X4 · the live rates offer is backdated too, then the charterer withdraws the room: terminal rooms are never swept
  execute 'alter table public.fixture_proposals disable trigger trg_fixture_proposals_immutable';
  update public.fixture_proposals set expires_at = now() - interval '1 minute' where id = (select vessel_proposal_id from public.fixture_terms where id = v_tid);
  execute 'alter table public.fixture_proposals enable trigger trg_fixture_proposals_immutable';
  perform pg_temp.fx_as('u_ch1');
  v := public.close_fixture_room(v_room, 'withdrawn', 'expiry suite', pg_temp.fx_ver(v_room), 'exp-close');
  if pg_temp.fx_status(v_room) <> 'withdrawn' then raise exception 'X4: the room must be withdrawn, got %', pg_temp.fx_status(v_room); end if;
  perform pg_temp.fx_owner();
  v_ver := pg_temp.fx_ver(v_room);
  s := public.sweep_fixture_proposal_lapses(100);
  if (s->>'swept')::int <> 0 or pg_temp.fx_ver(v_room) <> v_ver then raise exception 'X4: a closed room must never be swept: %', s; end if;
  raise notice 'X4 ok: a closed room is never swept';
end $$;

-- ── X5 · the sweep is service-owned: no member or anonymous execute; the limit is clamped ─
do $$
declare s jsonb;
begin
  if has_function_privilege('authenticated', 'public.sweep_fixture_proposal_lapses(integer)', 'execute')
     or has_function_privilege('anon', 'public.sweep_fixture_proposal_lapses(integer)', 'execute') then
    raise exception 'X5: the sweep must not be callable by members or anonymous sessions'; end if;
  if not has_function_privilege('service_role', 'public.sweep_fixture_proposal_lapses(integer)', 'execute') then
    raise exception 'X5: service_role must be able to run the sweep'; end if;
  perform pg_temp.fx_owner();
  s := public.sweep_fixture_proposal_lapses(0);
  if (s->>'limit')::int <> 1 then raise exception 'X5: a limit below one must clamp to one, got %', s; end if;
  s := public.sweep_fixture_proposal_lapses(5000);
  if (s->>'limit')::int <> 1000 then raise exception 'X5: a limit above 1000 must clamp to 1000, got %', s; end if;
  s := public.sweep_fixture_proposal_lapses(null);
  if (s->>'limit')::int <> 200 then raise exception 'X5: a null limit must fall back to 200, got %', s; end if;
  raise notice 'X5 ok: service_role only; limit clamped to 1..1000, default 200';
end $$;

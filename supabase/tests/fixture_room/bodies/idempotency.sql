-- ── I1 · a repeated key replays; a reused key with other arguments is refused ─
do $$
declare v jsonb; w jsonb; v_room uuid; v_tid uuid; v_ver int; e text; n1 bigint; n2 bigint;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'idem-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid; v_ver := (v->>'version')::int;
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 24}'::jsonb, 'first', false, null, v_ver, 'idem-bid-1');
  n1 := pg_temp.fx_events(v_room);
  -- the retry: same key, same arguments, the OLD expected_version (as a retried request would carry)
  w := public.submit_fixture_proposal(v_room, v_tid, '{"num": 24}'::jsonb, 'first', false, null, v_ver, 'idem-bid-1');
  n2 := pg_temp.fx_events(v_room);
  if (w->>'replayed')::boolean is not true then raise exception 'I1: retry must be a replay: %', w; end if;
  if w->'data'->>'proposalId' <> v->'data'->>'proposalId' or (w->>'version')::int <> (v->>'version')::int or w->>'eventId' <> v->>'eventId' then
    raise exception 'I1: replay must return the original result (% vs %)', v, w; end if;
  if n2 <> n1 then raise exception 'I1: a replay wrote % new event(s)', n2 - n1; end if;
  -- the same key with different arguments
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, %L, false, null, %s, %L)', v_room, v_tid, '{"num": 23}', 'first', pg_temp.fx_ver(v_room), 'idem-bid-1'));
  if e <> 'FX_IDEMPOTENCY_MISMATCH' then raise exception 'I1: reused key must be FX_IDEMPOTENCY_MISMATCH, got %', e; end if;
  -- a missing key is a validation error, never silently accepted
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, null, false, null, %s, null)', v_room, v_tid, '{"num": 23}', pg_temp.fx_ver(v_room)));
  if e <> 'FX_VALIDATION' then raise exception 'I1: missing key must be FX_VALIDATION, got %', e; end if;
  raise notice 'I1 ok: replay returns the original envelope without a new event; reuse with other arguments refused; key required';
end $$;

-- ── I2 · a multi-event command replays at its final version ─────────────────
do $$
declare v jsonb; w jsonb; v_room uuid; v_tid uuid; v_pid uuid; e text; n1 bigint; n2 bigint; v_types text;
begin
  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'idem-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'idem-accept-inv');
  v_tid := pg_temp.fx_term(v_room, 'quantity');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 26000}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'idem-offer-qty');
  v_pid := (v->'data'->>'proposalId')::uuid;
  perform pg_temp.fx_as('u_ch1');
  v := public.publish_fixture_recap(v_room, pg_temp.fx_ver(v_room), 'idem-recap-1');
  -- accepting now writes term.agreed AND recap.invalidated: two events, one key
  v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'idem-accept-qty');
  n1 := pg_temp.fx_events(v_room);
  if pg_temp.fx_event_types(v_room) not like '%term.agreed,recap.invalidated' then raise exception 'I2: ledger %', pg_temp.fx_event_types(v_room); end if;
  if (v->>'version')::int <> pg_temp.fx_ver(v_room) then raise exception 'I2: the envelope must carry the final version (% vs %)', v->>'version', pg_temp.fx_ver(v_room); end if;
  w := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room) - 2, 'idem-accept-qty');
  n2 := pg_temp.fx_events(v_room);
  if (w->>'replayed')::boolean is not true or (w->>'version')::int <> (v->>'version')::int or w->>'eventId' <> v->>'eventId' or w->'data'->>'termStatus' <> 'agreed' then
    raise exception 'I2: replay must return the final version and the original data: % vs %', v, w; end if;
  if n2 <> n1 then raise exception 'I2: replay wrote events'; end if;
  -- create replays too, at the room level
  perform pg_temp.fx_as('u_ch1');
  w := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'idem-create-1', '{}'::jsonb);
  if (w->>'replayed')::boolean is not true or w->'data'->>'roomId' <> v_room::text then raise exception 'I2: create replay %', w; end if;
  raise notice 'I2 ok: a two-event command replays at its final version with its original result; create replays the room';
end $$;

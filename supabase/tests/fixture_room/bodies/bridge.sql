-- ── B1 · only the mediator suggests; a suggestion moves nothing (Wave 3) ─────
do $$
declare v jsonb; w jsonb; r jsonb; v_room uuid; e text; v_tid uuid; v_props int; v_status text; v_ver int; v_n int;
begin
  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'br-create-1', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'br-inv');
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 27}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'br-offer-1');
  perform pg_temp.fx_as('u_ch1');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 25}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'br-bid-1');

  -- principals, the outsider and anon may not suggest
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, null, %s, %L)', v_room, v_tid, '{"num": 26}', pg_temp.fx_ver(v_room), 'br-ch'));
  if e <> 'FX_AUTH' then raise exception 'B1: the charterer must not suggest, got %', e; end if;
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, null, %s, %L)', v_room, v_tid, '{"num": 26}', pg_temp.fx_ver(v_room), 'br-ow'));
  if e <> 'FX_AUTH' then raise exception 'B1: the owner must not suggest, got %', e; end if;
  perform pg_temp.fx_as('u_out');
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, null, %s, %L)', v_room, v_tid, '{"num": 26}', pg_temp.fx_ver(v_room), 'br-out'));
  if e <> 'FX_AUTH' then raise exception 'B1: an outsider must not suggest, got %', e; end if;

  -- the mediator suggests: one ledger event, no proposal, no term or room change
  perform pg_temp.fx_owner();
  select count(*) into v_props from public.fixture_proposals where room_id = v_room;
  select status into v_status from public.fixture_terms where id = v_tid;
  v_ver := pg_temp.fx_ver(v_room);
  perform pg_temp.fx_as('u_adm', true);
  v := public.suggest_fixture_bridge(v_room, v_tid, '{"num": 26, "currency": "USD"}'::jsonb, 'splits the difference', v_ver, 'br-sug-1');
  if (v->>'ok')::boolean is not true or (v->>'version')::int <> v_ver + 1 or v->'data'->>'termId' <> v_tid::text then raise exception 'B1: suggestion envelope %', v; end if;
  perform pg_temp.fx_owner();
  if (select count(*) from public.fixture_proposals where room_id = v_room) <> v_props then raise exception 'B1: a suggestion must not create a proposal'; end if;
  if (select status from public.fixture_terms where id = v_tid) <> v_status or pg_temp.fx_status(v_room) <> 'negotiating' then raise exception 'B1: a suggestion must not move the term or the room'; end if;
  select count(*) into v_n from public.fixture_events where room_id = v_room and type = 'term.bridge_suggested' and actor_party_id = pg_temp.fx_party(v_room, 'mediator', 'broker')
     and payload->>'termCode' = 'freight' and payload->>'comment' = 'splits the difference' and payload->'value' = '{"num": 26, "currency": "USD"}'::jsonb;
  if v_n <> 1 then raise exception 'B1: one term.bridge_suggested event by the platform mediator expected, got %', v_n; end if;

  -- replay returns the stored envelope (minus replayed); a stale version is refused
  perform pg_temp.fx_as('u_adm', true);
  w := public.suggest_fixture_bridge(v_room, v_tid, '{"num": 26, "currency": "USD"}'::jsonb, 'splits the difference', v_ver, 'br-sug-1');
  if (w->>'replayed')::boolean is not true or (w - 'replayed') <> (v - 'replayed') then raise exception 'B1: replay must equal the fresh result: % vs %', w, v; end if;
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, null, %s, %L)', v_room, v_tid, '{"num": 26.5}', v_ver, 'br-stale'));
  if e = 'OK' then raise exception 'B1: a stale version must be refused'; end if;
  -- validation
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, null, %s, %L)', v_room, v_tid, '{"text": "about 26"}', pg_temp.fx_ver(v_room), 'br-bad'));
  if e <> 'FX_VALIDATION' then raise exception 'B1: a value of the wrong kind must be FX_VALIDATION, got %', e; end if;
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, %L, %s, %L)', v_room, v_tid, '{"num": 26}', repeat('x', 1001), pg_temp.fx_ver(v_room), 'br-long'));
  if e <> 'FX_VALIDATION' then raise exception 'B1: a comment over 1000 characters must be FX_VALIDATION, got %', e; end if;
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, null, %s, %L)', v_room, gen_random_uuid(), '{"num": 26}', pg_temp.fx_ver(v_room), 'br-noterm'));
  if e <> 'FX_NOT_FOUND' then raise exception 'B1: an unknown term must be FX_NOT_FOUND, got %', e; end if;
  -- C2O-089: a principal or an outsider holding the mediator's original key and arguments gets FX_AUTH, not the envelope
  perform pg_temp.fx_as('u_ch1');
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, %L, %s, %L)', v_room, v_tid, '{"num": 26, "currency": "USD"}', 'splits the difference', v_ver, 'br-sug-1'));
  if e <> 'FX_AUTH' then raise exception 'B1: a principal replaying the mediator''s key must be FX_AUTH, got %', e; end if;
  perform pg_temp.fx_as('u_out');
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, %L, %s, %L)', v_room, v_tid, '{"num": 26, "currency": "USD"}', 'splits the difference', v_ver, 'br-sug-1'));
  if e <> 'FX_AUTH' then raise exception 'B1: an outsider replaying the mediator''s key must be FX_AUTH, got %', e; end if;
  raise notice 'B1 ok: principals, outsider refused (also when replaying the mediator''s key); the mediator''s suggestion is one event, no proposal, no state change; replay equal; validated';
end $$;

-- ── B2 · both sides read the live suggestion; a newer one replaces it ───────
do $$
declare v jsonb; r jsonb; v_room uuid; v_tid uuid; b jsonb;
begin
  v_room := pg_temp.fx_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'));
  v_tid := pg_temp.fx_term(v_room, 'freight');
  foreach b in array array['"u_ch1"'::jsonb, '"u_ow1"'::jsonb] loop
    perform pg_temp.fx_as(b #>> '{}');
    r := public.get_fixture_room(v_room);
    if jsonb_array_length(r->'bridges') <> 1 or r->'bridges'->0->>'termId' <> v_tid::text or r->'bridges'->0->>'displayValue' is null
       or r->'bridges'->0->'value' <> '{"num": 26, "currency": "USD"}'::jsonb or r->'bridges'->0->>'byLabel' <> 'Arab ShipBroker'
       or r->'bridges'->0->>'comment' <> 'splits the difference' then
      raise exception 'B2: % must see the one live suggestion: %', b, r->'bridges'; end if;
  end loop;
  perform pg_temp.fx_as('u_adm', true);
  v := public.suggest_fixture_bridge(v_room, v_tid, '{"num": 26.25, "currency": "USD"}'::jsonb, null, pg_temp.fx_ver(v_room), 'br-sug-2');
  perform pg_temp.fx_as('u_ch1');
  r := public.get_fixture_room(v_room);
  if jsonb_array_length(r->'bridges') <> 1 or r->'bridges'->0->'value' <> '{"num": 26.25, "currency": "USD"}'::jsonb or (r->'bridges'->0->>'comment') is not null then
    raise exception 'B2: the newer suggestion replaces the older: %', r->'bridges'; end if;
  if not exists (select 1 from jsonb_array_elements(r->'events') x where x->>'type' = 'term.bridge_suggested' and x->>'actorLabel' = 'Arab ShipBroker') then
    raise exception 'B2: the suggestion is in the room''s ledger read'; end if;
  perform pg_temp.fx_as('u_out');
  begin
    r := public.get_fixture_room(v_room);
    raise exception 'B2: an outsider must not read the room (and its suggestions)';
  exception when others then
    if sqlerrm like 'B2:%' then raise; end if;
  end;
  raise notice 'B2 ok: both sides read the live suggestion with value, label and comment; a newer one replaces it; outsiders read nothing';
end $$;

-- ── B3 · adoption is an ordinary proposal; hold blocks it; agreement retires the suggestion ─
do $$
declare v jsonb; r jsonb; v_room uuid; v_tid uuid; e text; v_pid uuid;
begin
  v_room := pg_temp.fx_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'));
  v_tid := pg_temp.fx_term(v_room, 'freight');
  -- hold: the mediator may still suggest (advisory), but nobody adopts until it is resumed
  perform pg_temp.fx_as('u_ch1');
  v := public.set_fixture_term_flag(v_room, v_tid, 'hold', null, pg_temp.fx_ver(v_room), 'br-hold');
  perform pg_temp.fx_as('u_adm', true);
  v := public.suggest_fixture_bridge(v_room, v_tid, '{"num": 26.25, "currency": "USD"}'::jsonb, 'on hold, for later', pg_temp.fx_ver(v_room), 'br-sug-held');
  perform pg_temp.fx_as('u_ow1');
  e := pg_temp.fx_err(format('select public.submit_fixture_proposal(%L, %L, %L::jsonb, %L, false, null, %s, %L)', v_room, v_tid, '{"num": 26.25, "currency": "USD"}', 'Adopted the mediator''s suggestion.', pg_temp.fx_ver(v_room), 'br-adopt-held'));
  if e <> 'FX_STATE' then raise exception 'B3: adopting on a held term must be FX_STATE, got %', e; end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.set_fixture_term_flag(v_room, v_tid, 'resume', null, pg_temp.fx_ver(v_room), 'br-resume');
  -- the owner adopts; the charterer accepts
  perform pg_temp.fx_as('u_ow1');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 26.25, "currency": "USD"}'::jsonb, 'Adopted the mediator''s suggestion.', false, null, pg_temp.fx_ver(v_room), 'br-adopt');
  v_pid := (v->'data'->>'proposalId')::uuid;
  r := public.get_fixture_room(v_room);
  if jsonb_array_length(r->'bridges') <> 1 then raise exception 'B3: the suggestion stays visible until the term is agreed: %', r->'bridges'; end if;
  perform pg_temp.fx_as('u_ch1');
  v := public.accept_fixture_proposal(v_room, v_pid, pg_temp.fx_ver(v_room), 'br-accept');
  r := public.get_fixture_room(v_room);
  if jsonb_array_length(r->'bridges') <> 0 then raise exception 'B3: an agreed term has no live suggestion: %', r->'bridges'; end if;
  perform pg_temp.fx_as('u_adm', true);
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, null, %s, %L)', v_room, v_tid, '{"num": 26}', pg_temp.fx_ver(v_room), 'br-agreed'));
  if e <> 'FX_STATE' then raise exception 'B3: suggesting on an agreed term must be FX_STATE, got %', e; end if;
  -- reopening does not revive the old suggestion
  perform pg_temp.fx_as('u_ch1');
  v := public.reopen_fixture_term(v_room, v_tid, 'second thoughts', pg_temp.fx_ver(v_room), 'br-reopen');
  r := public.get_fixture_room(v_room);
  if jsonb_array_length(r->'bridges') <> 0 then raise exception 'B3: a reopened term must not revive a pre-agreement suggestion: %', r->'bridges'; end if;
  raise notice 'B3 ok: hold blocks adoption, not the advice; adoption is a plain proposal; agreement retires the suggestion and a reopen does not revive it';
end $$;

-- ── B4 · the window and terminal rooms; grants ──────────────────────────────
do $$
declare v_room uuid; v_tid uuid; e text;
begin
  v_room := pg_temp.fx_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'));
  v_tid := pg_temp.fx_term(v_room, 'laycan');
  perform pg_temp.fx_owner();
  update public.fixture_rooms set negotiation_window_ends_at = now() - interval '1 minute' where id = v_room;
  perform pg_temp.fx_as('u_adm', true);
  e := pg_temp.fx_err(format('select public.suggest_fixture_bridge(%L, %L, %L::jsonb, null, %s, %L)', v_room, v_tid, '{"from": "2026-10-06", "to": "2026-10-12"}', pg_temp.fx_ver(v_room), 'br-window'));
  if e <> 'FX_STATE' then raise exception 'B4: a closed window must refuse suggestions, got %', e; end if;
  perform pg_temp.fx_owner();
  if has_function_privilege('anon', 'public.suggest_fixture_bridge(uuid, uuid, jsonb, text, integer, text)', 'execute') then raise exception 'B4: anon must not execute the command'; end if;
  if not has_function_privilege('authenticated', 'public.suggest_fixture_bridge(uuid, uuid, jsonb, text, integer, text)', 'execute') then raise exception 'B4: members execute the command (the body authorises)'; end if;
  if has_function_privilege('authenticated', 'public.fn_fixture_live_bridges(uuid)', 'execute') or has_function_privilege('anon', 'public.fn_fixture_live_bridges(uuid)', 'execute') then
    raise exception 'B4: the internal live-bridges reader must not be callable by members'; end if;
  raise notice 'B4 ok: a closed window refuses suggestions; anon cannot call the command; the internal reader is private';
end $$;

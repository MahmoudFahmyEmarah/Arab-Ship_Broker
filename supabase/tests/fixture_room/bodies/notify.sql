-- Fixture Room · NOTIFY body (28 Sep 2026): the projector of 20260923205000 into the
-- shared notification core. Runs after the shared seed inside the caller's transaction.
-- Without the core (public.fn_notification_enqueue absent) the suite proves the
-- trigger is a no-op; with it, it proves recipients, urgency, deadlines and masking.

do $$
declare v jsonb; v_room uuid; v_tid uuid; n int; t text; v_core boolean;
begin
  v_core := to_regprocedure('public.fn_notification_enqueue(uuid, text, text, text, text, text, text, jsonb, boolean, timestamptz, timestamptz)') is not null;

  perform pg_temp.fx_as('u_ch1');
  v := public.create_fixture_room(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'ntf-create', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  if v_room is null then raise exception 'N0: the room must open with or without the core'; end if;

  if not v_core then
    raise notice 'N0 ok: shared notification core absent · the projector is a no-op and the negotiation is unaffected';
    return;
  end if;

  -- N1 · the invited owner is told; the charterer who opened the room is not
  perform pg_temp.fx_owner();
  select count(*) into n from public.notifications x where x.recipient_user_id = pg_temp.fx_id('u_ow1') and x.kind = 'fixture.party.invited' and x.payload->>'roomId' = v_room::text;
  if n <> 1 then raise exception 'N1: the owner must get exactly one invitation, got %', n; end if;
  select count(*) into n from public.notifications x where x.recipient_user_id = pg_temp.fx_id('u_ch1') and x.payload->>'roomId' = v_room::text;
  if n <> 0 then raise exception 'N1: the actor must not be notified of their own move, got %', n; end if;
  if (select importance from public.notifications x where x.recipient_user_id = pg_temp.fx_id('u_ow1') and x.kind = 'fixture.party.invited' and x.payload->>'roomId' = v_room::text) <> 'urgent' then
    raise exception 'N1: an invitation is urgent'; end if;
  raise notice 'N1 ok: the invited owner is notified (urgent); the charterer is not told of their own move';

  -- N2 · the owner accepts: the charterer hears; the owner does not
  perform pg_temp.fx_as('u_ow1');
  v := public.respond_fixture_invitation(v_room, true, pg_temp.fx_ver(v_room), 'ntf-accept');
  perform pg_temp.fx_owner();
  select count(*) into n from public.notifications x where x.recipient_user_id = pg_temp.fx_id('u_ch1') and x.kind = 'fixture.party.accepted' and x.payload->>'roomId' = v_room::text;
  if n <> 1 then raise exception 'N2: the charterer must hear the owner joined, got %', n; end if;
  raise notice 'N2 ok: acceptance reaches the other side';

  -- N3 · an offer with a validity window is urgent for the other side and carries the deadline
  perform pg_temp.fx_as('u_ow1');
  v_tid := pg_temp.fx_term(v_room, 'freight');
  v := public.submit_fixture_proposal(v_room, v_tid, '{"num": 26.5}'::jsonb, null, false, 30, pg_temp.fx_ver(v_room), 'ntf-offer');
  perform pg_temp.fx_owner();
  select count(*) into n from public.notifications x where x.recipient_user_id = pg_temp.fx_id('u_ch1') and x.kind = 'fixture.proposal.submitted' and x.importance = 'urgent' and x.expires_at is not null and x.href like '%#term-freight';
  if n <> 1 then raise exception 'N3: the charterer must get one urgent offer with a deadline and a term link, got %', n; end if;
  raise notice 'N3 ok: an offer with validity is urgent, deadlined and deep-linked';

  -- N4 · a side-private message notifies no one
  perform pg_temp.fx_as('u_ow1');
  v := public.post_fixture_message(v_room, 'internal: hold at 26.5', 'note', 'side', null, pg_temp.fx_ver(v_room), 'ntf-side');
  perform pg_temp.fx_owner();
  select count(*) into n from public.notifications x where x.kind = 'fixture.message.posted' and x.payload->>'roomId' = v_room::text;
  if n <> 0 then raise exception 'N4: a side-private message must notify no one, got %', n; end if;
  raise notice 'N4 ok: side-private messages stay private';

  -- N5 · masking: no organisation name, vessel name, IMO or email in any title, body or link
  select string_agg(x.title || ' ' || x.body || ' ' || coalesce(x.href, '') || ' ' || x.payload::text, E'\n') into t
    from public.notifications x where x.payload->>'roomId' = v_room::text;
  if t ~* '(Seed Charterers|Seed Owners|SEED VESSEL|9000001|@fixture\.test|internal: hold)' then
    raise exception 'N5: a notification leaked an identity or private text: %', t; end if;
  raise notice 'N5 ok: every notification is masked (no organisation, vessel, IMO, email or private text)';
end $$;

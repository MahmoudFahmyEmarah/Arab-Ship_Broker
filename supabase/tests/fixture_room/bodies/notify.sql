-- Fixture Room · NOTIFY body (28 Sep 2026; Wave 4 8 Oct 2026): the projector of 20261008100000 into the
-- shared notification core. Runs after the shared seed inside the caller's transaction.
-- Without the core (public.fn_notification_enqueue absent) the suite proves the
-- trigger is a no-op; with it, it proves recipients, urgency, deadlines and masking.

do $$
declare v jsonb; v_room uuid; v_tid uuid; n int; t text; v_core boolean;
begin
  v_core := to_regprocedure('public.fn_notification_enqueue(uuid, text, text, text, text, text, text, jsonb, boolean, timestamptz, timestamptz)') is not null;

  perform pg_temp.fx_as('u_ch1');
  v := pg_temp.fx_create(pg_temp.fx_id('c1'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'ntf-create', '{}'::jsonb);
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
  select count(*) into n from public.notifications x where x.recipient_user_id = pg_temp.fx_id('u_ch1') and x.kind = 'fixture.proposal.submitted' and x.importance = 'urgent' and x.expires_at is not null and x.expires_at = (x.payload->>'deadlineAt')::timestamptz and x.href like '%#term-freight';
  if n <> 1 then raise exception 'N3: the charterer must get one urgent offer with a deadline and a term link, got %', n; end if;
  raise notice 'N3 ok: an offer with validity is urgent, its deadline is the email cutoff (the bell keeps it, marked expired later), deep-linked';

  -- N4 · a side-private message notifies no one
  perform pg_temp.fx_as('u_ow1');
  v := public.post_fixture_message(v_room, 'internal: hold at 26.5', 'note', 'side', null, pg_temp.fx_ver(v_room), 'ntf-side');
  perform pg_temp.fx_owner();
  select count(*) into n from public.notifications x where x.kind = 'fixture.message.posted' and x.payload->>'roomId' = v_room::text;
  if n <> 0 then raise exception 'N4: a side-private message must notify no one, got %', n; end if;
  raise notice 'N4 ok: side-private messages stay private';

  -- N6 · a hostile stored label: even if a party's display label named the organisation,
  -- the notification says "Owner side" (the label is derived from the side, C2O-010)
  set local session_replication_role = replica;
  update public.fixture_parties set display_label = 'Seed Owners SA <desk@seed-owners.test>'
   where room_id = v_room and side = 'vessel' and capacity = 'principal';
  set local session_replication_role = origin;
  perform pg_temp.fx_as('u_ow1');
  v := public.post_fixture_message(v_room, 'ready when you are', 'note', 'room', null, pg_temp.fx_ver(v_room), 'ntf-hostile');
  perform pg_temp.fx_owner();
  select x.body into t from public.notifications x
   where x.recipient_user_id = pg_temp.fx_id('u_ch1') and x.kind = 'fixture.message.posted' and x.payload->>'roomId' = v_room::text;
  if t is null or t not like 'Owner side %' or t ~* 'seed owners|seed-owners' then
    raise exception 'N6: the actor must be named "Owner side", got %', t; end if;
  if (select importance from public.notifications x where x.recipient_user_id = pg_temp.fx_id('u_ch1') and x.kind = 'fixture.message.posted' and x.payload->>'roomId' = v_room::text) <> 'info' then
    raise exception 'N6: an ordinary room message is info'; end if;
  raise notice 'N6 ok: a hostile stored label never reaches a notification; the actor is named by its side';

  -- N5 · masking: no organisation name, vessel name, IMO or email in any title, body or link
  select string_agg(x.title || ' ' || x.body || ' ' || coalesce(x.href, '') || ' ' || x.payload::text, E'\n') into t
    from public.notifications x where x.payload->>'roomId' = v_room::text;
  if t ~* '(Seed Charterers|Seed Owners|SEED VESSEL|9000001|@fixture\.test|internal: hold)' then
    raise exception 'N5: a notification leaked an identity or private text: %', t; end if;
  raise notice 'N5 ok: every notification is masked (no organisation, vessel, IMO, email or private text)';

  -- N7 · the mediator's bridging suggestion reaches both sides (normal), never the mediator desk itself, and
  -- never carries the mediator's free-text comment
  perform pg_temp.fx_as('u_adm', true);
  v := public.suggest_fixture_bridge(v_room, v_tid, '{"num": 26.25, "currency": "USD"}'::jsonb, 'call Tasos on +30 690', pg_temp.fx_ver(v_room), 'ntf-bridge');
  perform pg_temp.fx_owner();
  select count(*) into n from public.notifications x where x.kind = 'fixture.term.bridge_suggested' and x.payload->>'roomId' = v_room::text
     and x.importance = 'normal' and x.recipient_user_id in (pg_temp.fx_id('u_ch1'), pg_temp.fx_id('u_ow1'));
  if n <> 2 then raise exception 'N7: both sides must hear the suggestion, got %', n; end if;
  if exists (select 1 from public.notifications x where x.kind = 'fixture.term.bridge_suggested' and x.payload->>'roomId' = v_room::text and x.recipient_user_id = pg_temp.fx_id('u_adm')) then
    raise exception 'N7: the mediator is not told of its own suggestion'; end if;
  if exists (select 1 from public.notifications x where x.payload->>'roomId' = v_room::text and (x.title || x.body) ~* 'tasos|\+30') then
    raise exception 'N7: the mediator''s comment must never reach a notification'; end if;
  raise notice 'N7 ok: a suggestion reaches both sides, not its author, without the free-text comment';

  -- N8 · the room's lifecycle events reach the audience the rules name; an unknown type notifies no one
  if public.fn_fixture_notify_rule('room.fix_confirmed', '{"awaitingSide": "vessel"}'::jsonb, 'Charterer side', 'FX-1', v_room)->>'audience' <> 'other_side'
     or public.fn_fixture_notify_rule('room.fix_confirmed', '{}'::jsonb, 'Charterer side', 'FX-1', v_room) is not null
     or public.fn_fixture_notify_rule('subject.reinstated', '{"seq": 2}'::jsonb, 'Owner side', 'FX-1', v_room)->>'body' <> 'A term was reopened, so subject 2 is open again.'
     or public.fn_fixture_notify_rule('room.window_extended', '{}'::jsonb, 'Arab ShipBroker', 'FX-1', v_room)->>'audience' <> 'both_sides'
     or public.fn_fixture_notify_rule('message.posted', '{"visibility": "mediator"}'::jsonb, 'Owner side', 'FX-1', v_room) is not null then
    raise exception 'N8: rule shapes'; end if;
  raise notice 'N8 ok: the second fix confirmation and private messages notify no one; reinstated subjects name only their number';

  -- N9 · a projection failure never breaks the negotiation: the core's table is made unavailable (inside this rolled
  -- back transaction), every enqueue fails, and the command still commits
  perform pg_temp.fx_owner();
  alter table public.notifications rename to notifications_unavailable;
  perform pg_temp.fx_as('u_ow1');
  v := public.post_fixture_message(v_room, 'still here', 'note', 'room', null, pg_temp.fx_ver(v_room), 'ntf-broken-core');
  if (v->>'ok')::boolean is not true then raise exception 'N9: the command must succeed whatever the notification core does'; end if;
  perform pg_temp.fx_owner();
  alter table public.notifications_unavailable rename to notifications;
  if not exists (select 1 from public.fixture_events e where e.room_id = v_room and e.idempotency_key = 'ntf-broken-core') then raise exception 'N9: the ledger event must be committed'; end if;
  -- an inactive member is never a recipient
  update public.users set is_active = false where id = pg_temp.fx_id('u_ch1');
  perform pg_temp.fx_as('u_ow1');
  v := public.post_fixture_message(v_room, 'anyone there', 'nudge', 'room', null, pg_temp.fx_ver(v_room), 'ntf-inactive');
  perform pg_temp.fx_owner();
  if exists (select 1 from public.notifications x where x.recipient_user_id = pg_temp.fx_id('u_ch1') and x.kind = 'fixture.message.posted' and x.dedupe_key in (select 'fixture:' || e.id from public.fixture_events e where e.idempotency_key = 'ntf-inactive')) then
    raise exception 'N9: an inactive member must not be notified'; end if;
  update public.users set is_active = true where id = pg_temp.fx_id('u_ch1');
  raise notice 'N9 ok: a failing core never breaks a command (the event commits, a warning is logged); inactive members are never recipients';

  -- N12 · the failure of N9 is recorded and replayed: once the core is back, reconcile writes the notification
  if not exists (select 1 from public.fixture_notification_projections pr join public.fixture_events e on e.id = pr.event_id
                  where e.idempotency_key = 'ntf-broken-core' and pr.status = 'failed') then
    raise exception 'N12: the failed projection must be recorded'; end if;
  v := public.fn_fixture_notify_reconcile(50);
  if (v->>'done')::int < 1 or exists (select 1 from public.fixture_notification_projections where status <> 'done') then raise exception 'N12: reconcile must replay it: %', v; end if;
  if not exists (select 1 from public.notifications x join public.fixture_events e on x.dedupe_key = 'fixture:' || e.id
                  where e.idempotency_key = 'ntf-broken-core' and x.recipient_user_id = pg_temp.fx_id('u_ch1')) then
    raise exception 'N12: the replayed notification must exist'; end if;
  v := public.fn_fixture_notify_reconcile(50);
  if (v->>'retried')::int <> 0 then raise exception 'N12: a done projection is not replayed twice'; end if;
  raise notice 'N12 ok: a failed projection is recorded and replayed once by reconcile — never lost';

  -- N10 · free text never leaves the room: a hostile text value and member-typed port names
  perform pg_temp.fx_as('u_ow1');
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'cargo_grade'),
         jsonb_build_object('text', 'Call Tasos Papadakis +30 690 111 2222 tasos@secret-owners.gr, Secret Owners SA, MV HIDDEN STAR <script>x</script>'),
         null, false, null, pg_temp.fx_ver(v_room), 'ntf-hostile-text');
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'ports'),
         '{"load": "ZZFXA", "disch": "ZZFXB", "load_name": "Tasos private jetty", "disch_name": "Secret Owners SA berth"}'::jsonb,
         null, false, null, pg_temp.fx_ver(v_room), 'ntf-hostile-ports');
  perform pg_temp.fx_as('u_ch1');
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'ports'),
         '{"load": "TASOS", "disch": "ZZFXB", "load_name": "x", "disch_name": "y"}'::jsonb,
         null, false, null, pg_temp.fx_ver(v_room), 'ntf-fake-code');
  perform pg_temp.fx_as('u_ow1');
  perform pg_temp.fx_owner();
  select string_agg(x.title || ' ' || x.body || ' ' || x.payload::text, E'\n') into t from public.notifications x
   where x.payload->>'roomId' = v_room::text and x.dedupe_key in (select 'fixture:' || e.id from public.fixture_events e where e.idempotency_key in ('ntf-hostile-text', 'ntf-hostile-ports', 'ntf-fake-code'));
  if t is null or t ~* '(tasos|papadakis|\+30|secret|hidden star|<script|jetty|berth)' then raise exception 'N10: free text reached a notification: %', t; end if;
  if t !~ 'a new wording' or t !~ 'ZZFXA → ZZFXB' or t !~ 'new ports' then raise exception 'N10: generic wording, registered LOCODEs and "new ports" for a fake code expected: %', t; end if;
  raise notice 'N10 ok: a hostile text value and member-typed port names never reach a notification (generic wording, bare UN/LOCODEs)';
end $$;

-- N11 · a relayed side (a contact-backed charterer, no member seat) is represented by the mediator desk, which hears
do $$
declare v jsonb; v_room uuid; n int;
begin
  if to_regprocedure('public.fn_notification_enqueue(uuid, text, text, text, text, text, text, jsonb, boolean, timestamptz, timestamptz)') is null then
    raise notice 'N11 skipped: no core'; return;
  end if;
  -- C2O-097 #1: an active NON-owner admin (tier 'sub') exists and must hear nothing of the room
  perform pg_temp.fx_owner();
  set local session_replication_role = replica;
  insert into auth.users (id, email, aud, role) values ('00000000-0000-4000-8000-0000000000af', 'u_sub@fixture.test', 'authenticated', 'authenticated');
  insert into public.users (id, supabase_user_id, email, full_name, company, role, admin_tier, subscription_tier, is_active)
  values ('00000000-0000-4000-8000-0000000000af', '00000000-0000-4000-8000-0000000000af', 'u_sub@fixture.test', 'Seed Sub-admin', 'Arab ShipBroker', 'admin', 'sub', 'T4', true);
  set local session_replication_role = origin;
  perform pg_temp.fx_as('u_ow1');
  v := pg_temp.fx_create(pg_temp.fx_id('c4'), pg_temp.fx_id('a1'), pg_temp.fx_terms(), 'ntf-relayed-create', '{}'::jsonb);
  v_room := (v->'data'->>'roomId')::uuid;
  v := public.submit_fixture_proposal(v_room, pg_temp.fx_term(v_room, 'freight'), '{"num": 31}'::jsonb, null, false, null, pg_temp.fx_ver(v_room), 'ntf-relayed-offer');
  perform pg_temp.fx_owner();
  select count(*) into n from public.notifications x where x.kind = 'fixture.proposal.submitted' and x.payload->>'roomId' = v_room::text and x.recipient_user_id = pg_temp.fx_id('u_adm');
  if n <> 1 then raise exception 'N11: the mediator desk must hear the offer to the relayed side, got %', n; end if;
  if exists (select 1 from public.notifications x where x.payload->>'roomId' = v_room::text and (x.title || x.body) ~* 'seed brokers|desk@') then
    raise exception 'N11: the relayed principal must stay masked'; end if;
  if exists (select 1 from public.notifications x where x.payload->>'roomId' = v_room::text and x.recipient_user_id = '00000000-0000-4000-8000-0000000000af') then
    raise exception 'N11: a non-owner admin must never hear Fixture notifications (owner-only administration)'; end if;
  raise notice 'N11 ok: an offer to a relayed side reaches the owner desk, masked; a sub-admin hears nothing';
end $$;

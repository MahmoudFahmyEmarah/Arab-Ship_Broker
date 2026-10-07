-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · notification projector (Wave 4, 8 Oct 2026; owner decision O2ALL-003: in-app AND email now)
--
-- Supersedes the unreleased 20260923205000 (feature/fixture-room), rebuilt on today's ledger: two-sided fix
-- confirmations, the negotiation window, reinstated subjects and the mediator's bridging suggestion.
--
-- Each ledger event that a party should hear about becomes one notification per recipient through the shared
-- core's public.fn_notification_enqueue (20260923350000/352000). The core owns storage, the member's preference
-- (in-app on/off; email instant / digest / off — urgent items email at once unless email is off), digests,
-- retries and the bell. This file owns only the Fixture rules: who hears, how urgently, in what words.
--
--   fn_fixture_notify_rule(type, payload, actor label, room ref, room id) — PURE: the rule for one event, or null.
--     It mirrors lib/fixture-room/notify-model.ts#notificationFor word for word; scripts/fixture-notify-parity.ts
--     runs both on the same events and requires identical output.
--   fn_fixture_notify_recipients(room, sides, admins, party) — the active users behind the room's parties.
--   trg_fixture_events_notify — after insert on fixture_events: rule → recipients → enqueue.
--
-- Guarantees:
--   * masking by construction: a title, body or link carries only the room reference, one of three labels
--     derived from the actor's governed side ("Charterer side", "Owner side", "Arab ShipBroker"), term labels,
--     display values and governed numbers; never a member's free text, a name, an email, a vessel or an id;
--   * a notification can never break the negotiation: the projection runs in its own sub-transaction and a
--     failure is a warning only;
--   * nobody is told about their own move; private messages notify no one;
--   * idempotent through the core's (recipient, dedupe_key): fixture:<event id>.
--
-- DOWN: supabase/rollback/20261008100000_fixture_room_notifications_down.sql
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.fn_fixture_notify_rule(p_type text, p_payload jsonb, p_actor_label text, p_room_ref text, p_room_id uuid)
 returns jsonb language plpgsql immutable set search_path to ''
as $$
declare
  p jsonb := coalesce(p_payload, '{}'::jsonb);
  who text := coalesce(p_actor_label, 'Arab ShipBroker');
  room text := p_room_ref;
  base text := '/dashboard/fixture-room/' || p_room_id::text;
  term text := coalesce(nullif(lower(coalesce(nullif(p->>'termLabel', ''), p->>'termCode', '')), ''), 'a term');
  subj text := case when (p->>'seq') ~ '^[0-9]+$' and (p->>'seq')::numeric > 0 then 'subject ' || ((p->>'seq')::numeric)::text else 'a subject' end;
  reason text := case when p->>'reason' in ('withdrawn', 'failed', 'expired') then p->>'reason' else 'closed' end;
  deadline text := nullif(coalesce(p->>'expiresAt', ''), '');
  v text := coalesce(p->>'displayValue', '');
  rule jsonb;
begin
  rule := case p_type
    when 'party.invited' then jsonb_build_object('audience', 'other_side', 'importance', 'urgent',
      'title', 'Invitation to fixture ' || room, 'body', who || ' opened a fixture room on your listing. Accept to negotiate.', 'href', base)
    when 'party.accepted' then jsonb_build_object('audience', 'other_side', 'importance', 'normal',
      'title', room || ': counterparty joined', 'body', who || ' accepted the invitation. The negotiation is open.', 'href', base)
    when 'proposal.submitted' then jsonb_build_object('audience', 'other_side', 'importance', case when deadline is not null then 'urgent' else 'normal' end,
      'title', room || ': ' || case when p->>'kind' = 'bid' then 'bid' else 'offer' end || ' on ' || term,
      'body', who || ' ' || case when p->>'kind' = 'bid' then 'bid' else 'offered' end || ' ' || v || ' on ' || term
              || case when coalesce((p->>'isFinal')::boolean, false) then ' (final)' else '' end
              || case when deadline is not null then ', valid until the time shown' else '' end || '. Your move.',
      'href', base || '#term-' || coalesce(p->>'termCode', ''), 'deadlineAt', deadline)
    when 'proposal.lapsed' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': figure lapsed on ' || term, 'body', 'The ' || coalesce(p->>'side', '') || ' side''s ' || v || ' on ' || term || ' lapsed without an answer.',
      'href', base || '#term-' || coalesce(p->>'termCode', ''))
    when 'term.agreed' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': ' || term || ' agreed', 'body', term || ' agreed at ' || v || '.', 'href', base)
    when 'term.reopened' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': ' || term || ' reopened', 'body', who || ' reopened ' || term || '.', 'href', base)
    when 'term.referred' then jsonb_build_object('audience', 'mediator', 'importance', 'urgent',
      'title', room || ': ' || term || ' referred to principal', 'body', who || ' referred ' || term || '. The item waits for a decision.', 'href', base)
    when 'term.bridge_suggested' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': suggested figure on ' || term, 'body', who || ' suggested ' || v || ' on ' || term || ' to bridge the gap. Either side may adopt it.',
      'href', base || '#term-' || coalesce(p->>'termCode', ''))
    when 'room.fix_confirmed' then case when nullif(coalesce(p->>'awaitingSide', ''), '') is null then null else jsonb_build_object('audience', 'other_side', 'importance', 'urgent',
      'title', room || ': fixture confirmed by the other side', 'body', who || ' confirmed the fixture on the agreed terms. Your confirmation fixes it.', 'href', base) end
    when 'room.fixed_on_subjects' then jsonb_build_object('audience', 'all', 'importance', 'urgent',
      'title', room || ': fixed on subjects', 'body', 'Both sides confirmed every required term. The fixture is recorded on subjects.', 'href', base)
    when 'subject.reinstated' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': subject open again', 'body', 'A term was reopened, so ' || subj || ' is open again.', 'href', base)
    when 'subject.lifted' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': subject lifted', 'body', who || ' lifted ' || subj || '.', 'href', base)
    when 'subject.failed' then jsonb_build_object('audience', 'all', 'importance', 'urgent',
      'title', room || ': subject failed', 'body', upper(left(subj, 1)) || substr(subj, 2) || ' failed. The fixture fails with it.', 'href', base)
    when 'room.fixed' then jsonb_build_object('audience', 'all', 'importance', 'urgent',
      'title', room || ': clean fixed', 'body', 'All subjects lifted. The fixture is clean.', 'href', base || '/recap')
    when 'recap.published' then jsonb_build_object('audience', 'other_side', 'importance', 'urgent',
      'title', room || ': recap v' || coalesce(p->>'versionNo', '') || ' to acknowledge',
      'body', who || ' published recap v' || coalesce(p->>'versionNo', '') || '. Please review and acknowledge it.', 'href', base || '/recap')
    when 'room.counterparty_disclosed' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': identities released', 'body', 'Both principals agreed to disclose. Organisation names are now shown in the room.', 'href', base)
    when 'message.posted' then case
      when coalesce(nullif(p->>'visibility', ''), 'room') <> 'room' then null
      when p->>'kind' = 'nudge' then jsonb_build_object('audience', 'other_side', 'importance', 'urgent',
        'title', room || ': your answer is awaited', 'body', who || ' is waiting for your answer.', 'href', base)
      else jsonb_build_object('audience', 'other_side', 'importance', 'info',
        'title', room || ': new message', 'body', who || ' posted a message in the room.', 'href', base) end
    when 'room.closed' then jsonb_build_object('audience', 'all', 'importance', 'urgent',
      'title', room || ': negotiation ' || reason, 'body', who || ' closed the room (' || reason || ').', 'href', base)
    else null
  end;
  if rule is null then return null; end if;
  return rule || jsonb_build_object('deadlineAt', coalesce(rule->>'deadlineAt', null));
end $$;
revoke all on function public.fn_fixture_notify_rule(text, jsonb, text, text, uuid) from public, anon, authenticated;

-- the active users behind the room's parties on the given sides (a party is either a member, or an organisation
-- whose current active members all count), or behind one named party; plus active administrators when asked
create or replace function public.fn_fixture_notify_recipients(p_room_id uuid, p_sides text[], p_include_admins boolean, p_party_id uuid default null)
 returns setof uuid language sql stable security definer set search_path to 'public'
as $$
  select distinct u.id
    from public.fixture_parties p
    join public.users u
      on u.is_active
     and (u.id = p.user_id
          or (p.user_id is null and p.org_id is not null and exists (
                select 1 from public.organization_members m
                 where m.org_id = p.org_id and m.user_id = u.id and m.is_current and m.status = 'active')))
   where p.room_id = p_room_id
     and not p.is_platform
     and (case when p_party_id is not null then p.id = p_party_id
               else p.side = any (p_sides) and p.status = 'active' end)
  union
  select u.id from public.users u
   where p_include_admins and u.is_active and lower(coalesce(u.role, '')) = 'admin';
$$;
revoke all on function public.fn_fixture_notify_recipients(uuid, text[], boolean, uuid) from public, anon, authenticated;

create or replace function public.fn_fixture_notify_project()
 returns trigger language plpgsql security definer set search_path to 'public'
as $$
declare
  v_enqueue regprocedure := to_regprocedure('public.fn_notification_enqueue(uuid, text, text, text, text, text, text, jsonb, boolean, timestamptz, timestamptz)');
  r public.fixture_rooms;
  p jsonb := coalesce(new.payload, '{}'::jsonb);
  v_actor_side text; v_actor_label text; v_rule jsonb; v_sides text[]; v_admins boolean; v_party uuid := null; v_recipient uuid;
begin
  if v_enqueue is null then return new; end if;   -- the shared core is not installed: nothing to do
  begin
    -- the platform's own invitation to itself is not news
    if new.type = 'party.invited' and coalesce((p->>'isPlatform')::boolean, false) then return new; end if;
    select * into r from public.fixture_rooms where id = new.room_id;
    -- the actor is named by one of three labels derived from its governed side, never by a stored display label
    select ap.side, case when ap.is_platform then 'Arab ShipBroker' when ap.side = 'cargo' then 'Charterer side'
                         when ap.side = 'vessel' then 'Owner side' else 'Arab ShipBroker' end
      into v_actor_side, v_actor_label
      from public.fixture_parties ap where ap.id = coalesce(new.on_behalf_of_party_id, new.actor_party_id);
    v_rule := public.fn_fixture_notify_rule(new.type, p, coalesce(v_actor_label, 'Arab ShipBroker'), r.ref, r.id);
    if v_rule is null then return new; end if;
    v_admins := v_rule->>'audience' in ('mediator', 'all');
    v_sides := case v_rule->>'audience'
                 when 'other_side' then case v_actor_side when 'cargo' then array['vessel'] when 'vessel' then array['cargo'] else array['cargo', 'vessel'] end
                 when 'mediator' then array[]::text[]
                 else array['cargo', 'vessel'] end;
    if new.type = 'party.invited' then v_party := nullif(p->>'partyId', '')::uuid; end if;
    for v_recipient in select * from public.fn_fixture_notify_recipients(r.id, v_sides, v_admins, v_party) loop
      continue when v_recipient = new.actor_user_id;   -- nobody is told about their own move
      execute 'select public.fn_notification_enqueue($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)'
        using v_recipient, 'fixture.' || new.type, 'fixture:' || new.id::text,
              left(v_rule->>'title', 160), left(v_rule->>'body', 1200), v_rule->>'href', v_rule->>'importance',
              jsonb_build_object('roomId', r.id, 'roomRef', r.ref, 'eventSeq', new.seq, 'eventType', new.type,
                                 'termCode', p->>'termCode', 'deadlineAt', v_rule->>'deadlineAt'),
              -- no expiry: the core hides an expired notification from the bell, and a member who missed an offer
              -- must still see that it came (the deadline travels in the payload)
              true, null::timestamptz, null::timestamptz;
    end loop;
  exception when others then
    raise warning 'fixture notification projection skipped for event %: % (%)', new.id, sqlerrm, sqlstate;
  end;
  return new;
end $$;
revoke all on function public.fn_fixture_notify_project() from public, anon, authenticated;

drop trigger if exists trg_fixture_events_notify on public.fixture_events;
create trigger trg_fixture_events_notify
after insert on public.fixture_events
for each row execute function public.fn_fixture_notify_project();

comment on function public.fn_fixture_notify_rule(text, jsonb, text, text, uuid) is
  'Fixture Room: the notification rule for one ledger event (audience, importance, title, body, href, deadline) or null; mirrors lib/fixture-room/notify-model.ts word for word (scripts/fixture-notify-parity.ts).';
comment on function public.fn_fixture_notify_project() is
  'Fixture Room: projects each notifiable ledger event into the shared notification core, one per recipient, masked by construction, never failing the negotiation; a no-op while the core is absent.';

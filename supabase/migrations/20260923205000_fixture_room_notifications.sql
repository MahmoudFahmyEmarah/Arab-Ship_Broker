-- Fixture Room · notification projector (Phase 1.1, 28 Sep 2026)
-- Migration 20260923205000, inside the reserved Fixture range 2026092320xxxx–2026092324xxxx.
--
-- Each ledger event that a party should hear about becomes one notification
-- per recipient through the shared core's public.fn_notification_enqueue
-- (integration-owned, feature/shared-fixture-services, O2C-009). The core owns
-- storage, preferences, digest vs instant email, retries and the bell; this
-- file owns only the Fixture rules: who hears, how urgently, in what words.
-- The rules mirror lib/fixture-room/notify-model.ts (the pure check pins the
-- event list on both sides).
--
-- Three guarantees:
--   * masking by construction: a title, body or link carries only the room
--     reference, masked party labels ("Owner side", "Charterer side",
--     "Arab ShipBroker"), term labels and display values; never an
--     organisation or person name, email, phone, vessel name or identifier;
--   * a notification can never break the negotiation: the projection runs in
--     its own sub-transaction and a failure is logged as a warning only;
--   * without the shared core installed the trigger does nothing, so this
--     migration applies and reverses on its own.
-- Idempotent through the core's (recipient, dedupe_key) key: fixture:<event id>.

-- recipients for one audience: active users behind the room's parties on the
-- given sides (a party is either a member or an organisation, whose current
-- active members all count), plus active administrators for the mediator
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
  v_actor_side text;
  v_actor_label text;
  v_term text := lower(coalesce(nullif(p->>'termLabel', ''), nullif(p->>'termCode', ''), 'a term'));
  v_href text;
  v_title text; v_body text; v_importance text; v_sides text[]; v_admins boolean := false; v_party uuid := null;
  v_deadline timestamptz := null;
  v_actor_user uuid := new.actor_user_id;
  v_recipient uuid;
begin
  if v_enqueue is null then return new; end if;   -- shared core not installed: nothing to do
  begin
    select * into r from public.fixture_rooms where id = new.room_id;
    select ap.side, case when ap.is_platform then 'Arab ShipBroker' else ap.display_label end
      into v_actor_side, v_actor_label
      from public.fixture_parties ap where ap.id = coalesce(new.on_behalf_of_party_id, new.actor_party_id);
    v_actor_label := coalesce(v_actor_label, case when new.actor_user_id is null then 'System' else 'Arab ShipBroker' end);
    v_href := '/dashboard/fixture-room/' || r.id::text;
    -- "the other side": the principal sides the actor is not on (both when the actor is the platform)
    v_sides := case v_actor_side when 'cargo' then array['vessel'] when 'vessel' then array['cargo'] else array['cargo', 'vessel'] end;

    case new.type
      when 'party.invited' then
        if coalesce((p->>'isPlatform')::boolean, false) then return new; end if;
        v_party := (p->>'partyId')::uuid; v_importance := 'urgent';
        v_title := r.ref || ': invitation to a fixture room';
        v_body := v_actor_label || ' opened a fixture room on your listing. Accept to negotiate.';
      when 'party.accepted' then
        v_importance := 'normal';
        v_title := r.ref || ': counterparty joined';
        v_body := v_actor_label || ' accepted the invitation. The negotiation is open.';
      when 'proposal.submitted' then
        v_deadline := nullif(p->>'expiresAt', '')::timestamptz;
        v_importance := case when v_deadline is not null then 'urgent' else 'normal' end;
        v_title := r.ref || ': ' || case when p->>'kind' = 'bid' then 'bid' else 'offer' end || ' on ' || v_term;
        v_body := v_actor_label || ' ' || case when p->>'kind' = 'bid' then 'bid' else 'offered' end || ' ' || coalesce(p->>'displayValue', '')
                  || ' on ' || v_term || case when coalesce((p->>'isFinal')::boolean, false) then ' (final)' else '' end
                  || case when v_deadline is not null then ', valid for a limited time' else '' end || '. Your move.';
        v_href := v_href || '#term-' || coalesce(p->>'termCode', '');
      when 'proposal.lapsed' then
        v_sides := array['cargo', 'vessel']; v_importance := 'normal';
        v_title := r.ref || ': figure lapsed on ' || v_term;
        v_body := 'The ' || coalesce(p->>'side', '') || ' side''s ' || coalesce(p->>'displayValue', '') || ' on ' || v_term || ' lapsed without an answer.';
      when 'term.agreed' then
        v_sides := array['cargo', 'vessel']; v_importance := 'normal';
        v_title := r.ref || ': ' || v_term || ' agreed';
        v_body := initcap(v_term) || ' agreed at ' || coalesce(p->>'displayValue', '') || '.';
      when 'term.reopened' then
        v_sides := array['cargo', 'vessel']; v_importance := 'normal';
        v_title := r.ref || ': ' || v_term || ' reopened';
        v_body := v_actor_label || ' reopened ' || v_term || '.';
      when 'term.referred' then
        v_sides := array[]::text[]; v_admins := true; v_importance := 'urgent';
        v_title := r.ref || ': ' || v_term || ' referred to principal';
        v_body := v_actor_label || ' referred ' || v_term || '. The item waits for a decision.';
      when 'room.fixed_on_subjects' then
        v_sides := array['cargo', 'vessel']; v_admins := true; v_importance := 'urgent';
        v_title := r.ref || ': fixed on subjects';
        v_body := 'Every required term is agreed. The fixture is recorded on subjects.';
      when 'subject.lifted' then
        v_sides := array['cargo', 'vessel']; v_importance := 'normal';
        v_title := r.ref || ': subject lifted';
        v_body := v_actor_label || ' lifted a subject: ' || left(coalesce(p->>'title', ''), 200) || '.';
      when 'subject.failed' then
        v_sides := array['cargo', 'vessel']; v_admins := true; v_importance := 'urgent';
        v_title := r.ref || ': subject failed';
        v_body := 'A subject failed (' || left(coalesce(p->>'title', ''), 200) || '). The fixture fails with it.';
      when 'room.fixed' then
        v_sides := array['cargo', 'vessel']; v_admins := true; v_importance := 'urgent';
        v_title := r.ref || ': clean fixed';
        v_body := 'All subjects lifted. The fixture is clean.';
        v_href := v_href || '/recap';
      when 'recap.published' then
        v_importance := 'urgent';
        v_title := r.ref || ': recap v' || coalesce(p->>'versionNo', '') || ' to acknowledge';
        v_body := v_actor_label || ' published recap v' || coalesce(p->>'versionNo', '') || '. Please review and acknowledge it.';
        v_href := v_href || '/recap';
      when 'room.counterparty_disclosed' then
        v_sides := array['cargo', 'vessel']; v_importance := 'normal';
        v_title := r.ref || ': identities released';
        v_body := 'Both principals agreed to disclose. Organisation names are now shown in the room.';
      when 'message.posted' then
        -- side-private and mediator-private messages notify no one outside their audience
        if coalesce(p->>'visibility', 'room') <> 'room' then return new; end if;
        if p->>'kind' = 'nudge' then
          v_importance := 'urgent';
          v_title := r.ref || ': your answer is awaited';
          v_body := v_actor_label || ' is waiting for your answer.';
        else
          v_importance := 'info';
          v_title := r.ref || ': new message';
          v_body := v_actor_label || ' posted a message in the room.';
        end if;
      when 'room.closed' then
        v_sides := array['cargo', 'vessel']; v_admins := true; v_importance := 'urgent';
        v_title := r.ref || ': negotiation ' || coalesce(p->>'reason', 'closed');
        v_body := v_actor_label || ' closed the room (' || coalesce(p->>'reason', 'closed') || ').';
      else
        return new;
    end case;

    for v_recipient in select * from public.fn_fixture_notify_recipients(r.id, v_sides, v_admins, v_party) loop
      continue when v_recipient = v_actor_user;   -- nobody is told about their own move
      execute 'select public.fn_notification_enqueue($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)'
        using v_recipient, 'fixture.' || new.type, 'fixture:' || new.id::text,
              left(v_title, 160), left(v_body, 1200), v_href, v_importance,
              jsonb_build_object('roomId', r.id, 'roomRef', r.ref, 'eventSeq', new.seq, 'eventType', new.type, 'termCode', p->>'termCode'),
              true, null::timestamptz, case when v_deadline > now() then v_deadline else null end;
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

comment on function public.fn_fixture_notify_project() is
  'Fixture Room: projects each notifiable ledger event into the shared notification core (fn_notification_enqueue), one per recipient, masked by construction, never failing the negotiation; a no-op while the core is absent. Rules mirror lib/fixture-room/notify-model.ts.';

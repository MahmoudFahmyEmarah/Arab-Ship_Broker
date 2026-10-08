-- DOWN for 20261009200000 (subject deadlines). Refuses while subject deadline observations exist (they are ledger
-- history the narrower CHECK could not hold); otherwise restores the clock, the rule and the CHECK of
-- 20261006100000 / 20261008100000 / 20261007500000.
do $$
begin
  if exists (select 1 from public.fixture_events where type in ('subject.deadline_near', 'subject.overdue')) then
    raise exception 'FX_DOWN_REFUSED: subject deadline events exist in the ledger; a DOWN cannot remove them' using errcode = '55000';
  end if;
end $$;

create or replace function public.run_fixture_room_clock()
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
begin
  return jsonb_build_object('lapses', public.sweep_fixture_proposal_lapses(500), 'windows', public.sweep_fixture_room_windows(200), 'at', now());
end $$;
revoke all on function public.run_fixture_room_clock() from public, anon, authenticated;
grant execute on function public.run_fixture_room_clock() to service_role;
comment on function public.run_fixture_room_clock() is
  'Fixture Room clock (PR-08): observes lapsed proposals once and expires invited / negotiating rooms whose negotiation window closed. Service only; scheduled every five minutes on pg_cron as fixture-room-clock. SKIP LOCKED per room, idempotent through the ledger.';
drop function if exists public.sweep_fixture_subject_deadlines(integer);

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
  v text := public.fn_fixture_notify_outbound_value(p);
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
              || case when deadline is not null then ', valid ' || public.fn_fixture_notify_deadline_label(deadline) else '' end || '. Your move.',
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
    when 'room.window_extended' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': negotiation window extended', 'body', who || ' extended the negotiation window.', 'href', base)
    when 'room.closed' then jsonb_build_object('audience', 'all', 'importance', 'urgent',
      'title', room || ': negotiation ' || reason, 'body', who || ' closed the room (' || reason || ').', 'href', base)
    else null
  end;
  if rule is null then return null; end if;
  return rule || jsonb_build_object('deadlineAt', coalesce(rule->>'deadlineAt', null));
end $$;
revoke all on function public.fn_fixture_notify_rule(text, jsonb, text, text, uuid) from public, anon, authenticated;

do $$
declare v_comment text;
begin
  select obj_description(oid, 'pg_constraint') into v_comment from pg_constraint
   where conrelid = 'public.fixture_events'::regclass and conname = 'fixture_events_type_check';
  alter table public.fixture_events drop constraint if exists fixture_events_type_check;
  alter table public.fixture_events add constraint fixture_events_type_check check (type in (
    'room.created','party.invited','party.accepted','party.declined','party.removed',
    'party.disclosure_agreed','room.counterparty_disclosed',
    'proposal.submitted','proposal.withdrawn','proposal.lapsed','proposal.accepted',
    'term.agreed','term.reopened','term.held','term.resumed','term.referred','term.referral_cleared',
    'term.bridge_suggested',
    'subject.added','subject.lifted','subject.failed','subject.extended','subject.reinstated',
    'room.fix_confirmed','room.fixed_on_subjects','room.fixed','room.returned_to_negotiation','room.window_extended',
    'recap.published','recap.acknowledged','recap.invalidated',
    'message.posted','message.redacted',
    'listing_sync.required','listing_sync.applied','pda.linked','room.closed',
    'room.continued_from'));
  if v_comment is not null then
    execute format('comment on constraint fixture_events_type_check on public.fixture_events is %L', v_comment);
  end if;
end $$;

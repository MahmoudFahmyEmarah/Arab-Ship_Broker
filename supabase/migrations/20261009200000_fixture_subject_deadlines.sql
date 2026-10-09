-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · subject deadlines: reminder, overdue flag, broker desk (owner decision O2ALL-005, 8 Oct 2026)
--
-- A subject with a deadline_at gets two ledger observations from the room clock (every five minutes):
--   * subject.deadline_near — once, when the deadline is two hours or less away: both sides, urgent, emailed only
--     until the deadline (it is the email cut-off);
--   * subject.overdue — once, when the deadline has passed and the subject is still open: both sides AND the broker
--     desk (audience all), urgent.
-- NOTHING FAILS AUTOMATICALLY: the subject stays open; the parties lift it, extend it by agreement, or fail it.
-- Extensions are by agreement (owner decision O2ALL-006): one side PROPOSES a strictly later, future deadline
-- (subject.extension_proposed); the OTHER side accepts (subject.extended) or declines (subject.extension_declined);
-- the broker desk may answer for a relayed side. Until accepted the old deadline stands. The unilateral
-- extend_fixture_subject is refused. A partial index keeps the five-minute sweep on open, dated subjects only.
-- Both observations are bound to the deadline they saw (payload deadlineAt, idempotency key), so an extension
-- re-arms them for the new deadline and a re-run never repeats them. A notification carries only the subject's
-- number and the deadline, never its free-text title.
--
-- Needs the Fixture notification projector (20261008100000). Idempotent.
-- DOWN: supabase/rollback/20261009200000_fixture_subject_deadlines_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · event types ─────────────────────────────────────────────────────────
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
    'subject.deadline_near','subject.overdue','subject.extension_proposed','subject.extension_declined',
    'room.fix_confirmed','room.fixed_on_subjects','room.fixed','room.returned_to_negotiation','room.window_extended',
    'recap.published','recap.acknowledged','recap.invalidated',
    'message.posted','message.redacted',
    'listing_sync.required','listing_sync.applied','pda.linked','room.closed',
    'room.continued_from'));
  if v_comment is not null then
    execute format('comment on constraint fixture_events_type_check on public.fixture_events is %L', v_comment);
  end if;
end $$;

-- ── 2 · the sweep (service only) ────────────────────────────────────────────
create or replace function public.sweep_fixture_subject_deadlines(p_limit integer default 200)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_near integer := 0; v_overdue integer := 0; rec record; r public.fixture_rooms; s public.fixture_subjects;
  v_type text; v_key text;
begin
  for rec in
    select x.id as subject_id, x.room_id
      from public.fixture_subjects x
      join public.fixture_rooms rm on rm.id = x.room_id
     where x.status = 'open' and x.deadline_at is not null and x.deadline_at <= now() + interval '2 hours'
       and rm.status not in ('withdrawn', 'failed', 'expired')
       and not exists (select 1 from public.fixture_events e
                        where e.room_id = x.room_id
                          and e.type = case when x.deadline_at <= now() then 'subject.overdue' else 'subject.deadline_near' end
                          and e.payload->>'subjectId' = x.id::text
                          and (e.payload->>'deadlineAt')::timestamptz = x.deadline_at)
     order by x.deadline_at, x.id
     limit v_limit
  loop
    -- the room lock every command takes; a room another session holds waits for the next run
    select * into r from public.fixture_rooms y where y.id = rec.room_id for update skip locked;
    if not found or r.status in ('withdrawn', 'failed', 'expired') then continue; end if;
    select * into s from public.fixture_subjects y where y.id = rec.subject_id;   -- re-read under the room lock
    if s.status <> 'open' or s.deadline_at is null or s.deadline_at > now() + interval '2 hours' then continue; end if;
    v_type := case when s.deadline_at <= now() then 'subject.overdue' else 'subject.deadline_near' end;
    if exists (select 1 from public.fixture_events e where e.room_id = r.id and e.type = v_type
                 and e.payload->>'subjectId' = s.id::text and (e.payload->>'deadlineAt')::timestamptz = s.deadline_at) then continue; end if;
    v_key := 'clock:' || v_type || ':' || s.id::text || ':' || extract(epoch from s.deadline_at)::bigint::text;
    perform public.fn_fixture_event(r.id, v_type, null, null, null, false, 'sweep_fixture_subject_deadlines', v_key, null,
      jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'deadlineAt', s.deadline_at, 'responsibleSide', s.responsible_side,
                         'source', 'clock'), null);
    if v_type = 'subject.overdue' then v_overdue := v_overdue + 1; else v_near := v_near + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'near', v_near, 'overdue', v_overdue, 'limit', v_limit);
end $$;
revoke all on function public.sweep_fixture_subject_deadlines(integer) from public, anon, authenticated;
grant execute on function public.sweep_fixture_subject_deadlines(integer) to service_role;

create or replace function public.run_fixture_room_clock()
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
begin
  return jsonb_build_object('lapses', public.sweep_fixture_proposal_lapses(500), 'windows', public.sweep_fixture_room_windows(200),
                            'subjects', public.sweep_fixture_subject_deadlines(500), 'at', now());
end $$;
revoke all on function public.run_fixture_room_clock() from public, anon, authenticated;
grant execute on function public.run_fixture_room_clock() to service_role;
comment on function public.run_fixture_room_clock() is
  'Fixture Room clock (PR-08, O2ALL-005): observes lapsed proposals once, expires invited / negotiating rooms whose negotiation window closed, and records subject.deadline_near / subject.overdue once per subject deadline (never fails a subject). Service only; scheduled every five minutes on pg_cron as fixture-room-clock. SKIP LOCKED per room, idempotent through the ledger.';

-- ── 2b · the sweep reads only open, dated subjects and their clock events (C2O-101 P2) ─────────────────────
create index if not exists fixture_subjects_open_deadline_idx
  on public.fixture_subjects (deadline_at, id) where status = 'open' and deadline_at is not null;
create index if not exists fixture_events_subject_clock_idx
  on public.fixture_events (room_id, type, ((payload->>'subjectId')))
  where type in ('subject.deadline_near', 'subject.overdue', 'subject.extension_proposed', 'subject.extended', 'subject.extension_declined');

-- ── 2c · extensions by agreement (O2ALL-006) ────────────────────────────────────────────────────────────────
-- the open proposal of a subject: its latest subject.extension_proposed that no later event answered
create or replace function public.fn_fixture_subject_pending_extension(p_room_id uuid, p_subject_id uuid)
 returns public.fixture_events language sql stable security definer set search_path to 'public'
as $$
  select e.* from public.fixture_events e
   where e.room_id = p_room_id and e.type = 'subject.extension_proposed' and e.payload->>'subjectId' = p_subject_id::text
     and not exists (select 1 from public.fixture_events x
                      where x.room_id = p_room_id and x.seq > e.seq and x.payload->>'subjectId' = p_subject_id::text
                        and x.type in ('subject.extension_proposed', 'subject.extended', 'subject.extension_declined',
                                       'subject.lifted', 'subject.failed'))
   order by e.seq desc limit 1;
$$;
revoke all on function public.fn_fixture_subject_pending_extension(uuid, uuid) from public, anon, authenticated;

create or replace function public.propose_fixture_subject_extension(
  p_room_id uuid, p_subject_id uuid, p_deadline_at timestamptz, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        s public.fixture_subjects;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'propose_fixture_subject_extension', 'subject', p_subject_id, 'deadline', p_deadline_at,
                                   'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status <> 'on_subjects' then
    raise exception 'FX_STATE: subject deadlines can change only while the room is on subjects' using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  if rep.capacity = 'viewer' or rep.side not in ('cargo', 'vessel') then
    raise exception 'FX_AUTH: a principal side (or the desk for a relayed side) proposes a new deadline' using errcode = '42501';
  end if;
  select * into s from public.fixture_subjects x where x.id = p_subject_id and x.room_id = r.id for update;
  if s.id is null then raise exception 'FX_NOT_FOUND: subject not found in this room' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'FX_STATE: subject "%" is already %', s.title, s.status using errcode = '55000'; end if;
  if p_deadline_at is null or p_deadline_at <= greatest(coalesce(s.deadline_at, now()), now()) then
    raise exception 'FX_VALIDATION: a new deadline must be later than the current one and in the future' using errcode = '22023';
  end if;
  return public.fn_fixture_event(r.id, 'subject.extension_proposed', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'propose_fixture_subject_extension', p_idempotency_key, v_hash,
    jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'deadlineAt', p_deadline_at, 'previousDeadlineAt', s.deadline_at, 'proposedBySide', rep.side),
    jsonb_build_object('subjectId', s.id, 'deadlineAt', p_deadline_at, 'pending', true));
end $$;
revoke all on function public.propose_fixture_subject_extension(uuid, uuid, timestamptz, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.propose_fixture_subject_extension(uuid, uuid, timestamptz, integer, text, uuid, uuid) to authenticated, service_role;

create or replace function public.respond_fixture_subject_extension(
  p_room_id uuid, p_subject_id uuid, p_accept boolean, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        s public.fixture_subjects; pe public.fixture_events; v_new timestamptz;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'respond_fixture_subject_extension', 'subject', p_subject_id, 'accept', p_accept,
                                   'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if p_accept is null then raise exception 'FX_VALIDATION: accept or decline' using errcode = '22023'; end if;
  if r.status <> 'on_subjects' then
    raise exception 'FX_STATE: subject deadlines can change only while the room is on subjects' using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  select * into s from public.fixture_subjects x where x.id = p_subject_id and x.room_id = r.id for update;
  if s.id is null then raise exception 'FX_NOT_FOUND: subject not found in this room' using errcode = 'P0002'; end if;
  if s.status <> 'open' then raise exception 'FX_STATE: subject "%" is already %', s.title, s.status using errcode = '55000'; end if;
  pe := public.fn_fixture_subject_pending_extension(r.id, s.id);
  if pe.id is null then raise exception 'FX_STATE: no new deadline is waiting for an answer on this subject' using errcode = '55000'; end if;
  -- only the OTHER principal side answers (the desk may answer for a relayed side); never the proposer's own side
  if rep.capacity = 'viewer' or rep.side not in ('cargo', 'vessel') or rep.side = pe.payload->>'proposedBySide' then
    raise exception 'FX_AUTH: the other side answers a proposed deadline' using errcode = '42501';
  end if;
  v_new := (pe.payload->>'deadlineAt')::timestamptz;
  if not p_accept then
    return public.fn_fixture_event(r.id, 'subject.extension_declined', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
      'respond_fixture_subject_extension', p_idempotency_key, v_hash,
      jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'proposalEventId', pe.id, 'deadlineAt', v_new, 'declinedBySide', rep.side),
      jsonb_build_object('subjectId', s.id, 'accepted', false, 'deadlineAt', s.deadline_at));
  end if;
  if v_new <= greatest(coalesce(s.deadline_at, now()), now()) then
    raise exception 'FX_STATE: the proposed deadline is no longer in the future; propose a new one' using errcode = '55000';
  end if;
  update public.fixture_subjects set deadline_at = v_new, extended_count = extended_count + 1 where id = s.id;
  return public.fn_fixture_event(r.id, 'subject.extended', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'respond_fixture_subject_extension', p_idempotency_key, v_hash,
    jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'title', s.title, 'previousDeadlineAt', s.deadline_at, 'deadlineAt', v_new,
                       'extendedCount', s.extended_count + 1, 'proposalEventId', pe.id, 'proposedBySide', pe.payload->>'proposedBySide', 'acceptedBySide', rep.side),
    jsonb_build_object('subjectId', s.id, 'accepted', true, 'deadlineAt', v_new));
end $$;
revoke all on function public.respond_fixture_subject_extension(uuid, uuid, boolean, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.respond_fixture_subject_extension(uuid, uuid, boolean, integer, text, uuid, uuid) to authenticated, service_role;

-- the unilateral path is closed: a deadline changes only by agreement (C2O-101 P1, O2ALL-006)
create or replace function public.extend_fixture_subject(
  p_room_id uuid, p_subject_id uuid, p_deadline_at timestamptz, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
begin
  perform public.fn_fixture_actor();
  raise exception 'FX_STATE: a subject deadline changes only by agreement: propose the new deadline; the other side accepts it' using errcode = '55000';
end $$;
revoke all on function public.extend_fixture_subject(uuid, uuid, timestamptz, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.extend_fixture_subject(uuid, uuid, timestamptz, integer, text, uuid) to authenticated, service_role;

-- ── 3 · notification wording: the projector's rule with the two clock events ──
-- Mirrors lib/fixture-room/notify-model.ts#notificationFor; scripts/fixture-notify-parity.ts compares them.
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
    -- O2ALL-005: the deadline clock. Only the subject's number and the deadline leave the room (its title is free text).
    when 'subject.deadline_near' then jsonb_build_object('audience', 'both_sides', 'importance', 'urgent',
      'title', room || ': ' || subj || ' is due within 2 hours',
      'body', upper(left(subj, 1)) || substr(subj, 2) || ' is open ' || public.fn_fixture_notify_deadline_label(nullif(p->>'deadlineAt', ''))
              || '. Lift it, agree an extension or fail it before then.',
      'href', base, 'deadlineAt', nullif(p->>'deadlineAt', ''))
    when 'subject.overdue' then jsonb_build_object('audience', 'all', 'importance', 'urgent',
      'title', room || ': ' || subj || ' is overdue',
      'body', upper(left(subj, 1)) || substr(subj, 2) || ' passed its deadline without being lifted. Nothing fails automatically: lift it, agree an extension or fail it.',
      'href', base)
    when 'subject.extension_proposed' then jsonb_build_object('audience', 'other_side', 'importance', 'urgent',
      'title', room || ': new deadline proposed for ' || subj,
      'body', who || ' proposes to keep ' || subj || ' open ' || public.fn_fixture_notify_deadline_label(nullif(p->>'deadlineAt', ''))
              || '. Accept or decline it in the room; until then the current deadline stands.',
      'href', base)
    when 'subject.extended' then jsonb_build_object('audience', 'both_sides', 'importance', 'normal',
      'title', room || ': ' || subj || ' extended',
      'body', upper(left(subj, 1)) || substr(subj, 2) || ' is now open ' || public.fn_fixture_notify_deadline_label(nullif(p->>'deadlineAt', ''))
              || ', agreed by both sides.',
      'href', base)
    when 'subject.extension_declined' then jsonb_build_object('audience', 'other_side', 'importance', 'normal',
      'title', room || ': new deadline declined for ' || subj,
      'body', who || ' declined the proposed new deadline for ' || subj || '. The current deadline stands.',
      'href', base)
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

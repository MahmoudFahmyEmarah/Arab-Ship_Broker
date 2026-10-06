-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · enforcement (6 Oct 2026) — release audit PR-07 and PR-08
--
-- PR-07 · a fixture needs both sides. fix_fixture_on_subjects used to move a
--   fully agreed room to on_subjects (and, with no subjects, straight to
--   fixed) on ONE side's command. Each principal side now records its own
--   confirmation together with a fingerprint ("basis") of the agreed terms
--   and the subjects. The room moves only when both sides have confirmed the
--   SAME basis, so any later change (an accept, a reopen, a new subject)
--   voids an earlier confirmation without every command having to clear it.
--   The mediator confirms only for a relayed party it represents.
--
-- PR-08 · the room's own rules are enforced, not just displayed:
--   * a term on hold or referred to principal does not move: no proposal and
--     no acceptance until it is resumed / the referral is cleared; a fix waits
--     until no term is held or referred; only the side that referred a term
--     (or the mediator) clears the referral, as for hold / resume;
--   * reopening a term from on_subjects reinstates the subjects already
--     lifted: they were lifted against the terms that have just changed;
--   * the negotiation window is real: every room gets one (14 days from
--     creation, owner ruling 6 Oct 2026; open rooms at this migration get 14
--     days from now, each with a System room.window_extended event), every
--     commercial command is refused once it has closed, the mediator can
--     only lengthen it, a clock expires rooms whose window closed, and a
--     never-accepted invitee loses access to a terminal room;
--   * the clock also observes lapsed proposals (the service-only sweep that
--     was held out of the 30 Sep release as 20260923204000, carried forward
--     here unchanged in behaviour) and runs every five minutes on pg_cron.
--
-- Additive on the released module (20260923200000…208000 + 320000).
-- DOWN: supabase/rollback/20261006_fixture_room_enforcement_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · columns ─────────────────────────────────────────────────────────────
alter table public.fixture_rooms add column if not exists fix_confirmations jsonb not null default '{}'::jsonb;
comment on column public.fixture_rooms.fix_confirmations is
  'PR-07: per principal side {"cargo"|"vessel": {at, partyId, userId, relayed, basis}}. A confirmation counts only while its basis equals fn_fixture_fix_basis(room); the room fixes when both sides hold the current basis.';

alter table public.fixture_rooms alter column negotiation_window_ends_at set default (now() + interval '14 days');
comment on column public.fixture_rooms.negotiation_window_ends_at is
  'PR-08: terms move and the room fixes only before this instant; the clock (run_fixture_room_clock) expires an invited / negotiating room after it. Set to 14 days at creation; the mediator extends it.';

-- ── 2 · event types ─────────────────────────────────────────────────────────
-- The CHECK in force before this migration (20260923200000's, or 320000's
-- wider list) is kept in the new constraint's comment, so the DOWN restores
-- exactly that list; a re-run keeps the first saved definition.
do $$
declare c record; v_prev text;
begin
  select obj_description(oid, 'pg_constraint') into v_prev from pg_constraint
   where conrelid = 'public.fixture_events'::regclass and conname = 'fixture_events_type_check'
     and coalesce(obj_description(oid, 'pg_constraint'), '') like 'down:%';
  if v_prev is null then
    select 'down:' || pg_get_constraintdef(oid) into v_prev from pg_constraint
     where conrelid = 'public.fixture_events'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%type%' and pg_get_constraintdef(oid) ilike '%room.created%'
     limit 1;
  end if;
  for c in select conname from pg_constraint
            where conrelid = 'public.fixture_events'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%type%' and pg_get_constraintdef(oid) ilike '%room.created%' loop
    execute format('alter table public.fixture_events drop constraint %I', c.conname);
  end loop;
  alter table public.fixture_events add constraint fixture_events_type_check check (type in (
    'room.created','party.invited','party.accepted','party.declined','party.removed',
    'party.disclosure_agreed','room.counterparty_disclosed',
    'proposal.submitted','proposal.withdrawn','proposal.lapsed','proposal.accepted',
    'term.agreed','term.reopened','term.held','term.resumed','term.referred','term.referral_cleared',
    'subject.added','subject.lifted','subject.failed','subject.extended','subject.reinstated',
    'room.fix_confirmed','room.fixed_on_subjects','room.fixed','room.returned_to_negotiation','room.window_extended',
    'recap.published','recap.acknowledged','recap.invalidated',
    'message.posted','message.redacted',
    'listing_sync.required','listing_sync.applied','pda.linked','room.closed'));
  if v_prev is not null then
    execute format('comment on constraint fixture_events_type_check on public.fixture_events is %L', v_prev);
  end if;
end $$;

-- ── 3 · internals ───────────────────────────────────────────────────────────
-- What a side confirms: the agreed proposal behind every agreed term and every
-- subject (id, wording, responsible side, status). Any change moves the md5.
create or replace function public.fn_fixture_fix_basis(p_room_id uuid)
 returns text language sql stable security definer set search_path to 'public'
as $$
  select md5(jsonb_build_object(
    'terms', coalesce((select jsonb_agg(jsonb_build_array(t.code, t.agreed_proposal_id) order by t.sort_order, t.code)
                         from public.fixture_terms t where t.room_id = p_room_id and t.status = 'agreed'), '[]'::jsonb),
    'subjects', coalesce((select jsonb_agg(jsonb_build_array(s.id, s.title, s.responsible_side, s.status) order by s.seq)
                            from public.fixture_subjects s where s.room_id = p_room_id), '[]'::jsonb))::text);
$$;
revoke all on function public.fn_fixture_fix_basis(uuid) from public, anon, authenticated;

-- The sides whose confirmation still matches the room (empty unless negotiating).
create or replace function public.fn_fixture_fix_confirmed_sides(r public.fixture_rooms)
 returns jsonb language sql stable security definer set search_path to 'public'
as $$
  select case when r.status <> 'negotiating' then '[]'::jsonb else coalesce((
    select jsonb_agg(e.key order by e.key)
      from jsonb_each(coalesce(r.fix_confirmations, '{}'::jsonb)) e
     where e.key in ('cargo', 'vessel') and e.value->>'basis' = public.fn_fixture_fix_basis(r.id)), '[]'::jsonb) end;
$$;
revoke all on function public.fn_fixture_fix_confirmed_sides(public.fixture_rooms) from public, anon, authenticated;

create or replace function public.fn_fixture_window_closed(r public.fixture_rooms)
 returns boolean language sql stable set search_path to ''
as $$ select r.status in ('invited', 'negotiating') and r.negotiation_window_ends_at is not null and r.negotiation_window_ends_at <= now(); $$;
revoke all on function public.fn_fixture_window_closed(public.fixture_rooms) from public, anon, authenticated;

create or replace function public.fn_fixture_require_window(r public.fixture_rooms)
 returns void language plpgsql stable set search_path to ''
as $$
begin
  if public.fn_fixture_window_closed(r) then
    raise exception 'FX_STATE: the negotiation window closed at % — the mediator can extend it',
      to_char(r.negotiation_window_ends_at at time zone 'UTC', 'DD Mon HH24:MI "UTC"') using errcode = '55000';
  end if;
end $$;
revoke all on function public.fn_fixture_require_window(public.fixture_rooms) from public, anon, authenticated;

create or replace function public.fn_fixture_require_movable(t public.fixture_terms)
 returns void language plpgsql immutable set search_path to ''
as $$
begin
  if t.held_by_party_id is not null then
    raise exception 'FX_STATE: "%" is on hold — resume it before it moves', t.label using errcode = '55000';
  end if;
  if t.referred_at is not null then
    raise exception 'FX_STATE: "%" is referred to principal — clear the referral before it moves', t.label using errcode = '55000';
  end if;
end $$;
revoke all on function public.fn_fixture_require_movable(public.fixture_terms) from public, anon, authenticated;

-- ── 4 · submit_fixture_proposal: window, hold / refer, one lapse observation ─
create or replace function public.submit_fixture_proposal(
  p_room_id uuid, p_term_id uuid, p_value jsonb, p_comment text, p_is_final boolean, p_expires_in_minutes integer,
  p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
  t public.fixture_terms; v_norm jsonb; v_display text; v_prev public.fixture_proposals; v_prev_id uuid; v_expires timestamptz;
  v_pid uuid; v_round int; v_first jsonb; v_last jsonb; v_new_status text; v_prev_status text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'submit_fixture_proposal', 'term', p_term_id, 'value', p_value, 'comment', p_comment,
                                   'final', coalesce(p_is_final, false), 'expires', p_expires_in_minutes, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: proposals are not accepted while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  perform public.fn_fixture_require_window(r);
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);

  select * into t from public.fixture_terms x where x.id = p_term_id and x.room_id = r.id for update;
  if t.id is null then
    raise exception 'FX_NOT_FOUND: term not found in this room' using errcode = 'P0002';
  end if;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is agreed — reopen it before proposing again', t.label using errcode = '55000';
  end if;
  if t.status = 'withdrawn' then
    raise exception 'FX_STATE: "%" was withdrawn from the term sheet', t.label using errcode = '55000';
  end if;
  perform public.fn_fixture_require_movable(t);
  v_norm := public.fn_fixture_validate_value(t.value_kind, p_value);
  v_display := public.fn_fixture_display_value(t.value_kind, v_norm, t.unit);
  if coalesce(length(p_comment), 0) > 1000 then
    raise exception 'FX_VALIDATION: comment must be at most 1000 characters' using errcode = '22023';
  end if;
  if p_expires_in_minutes is not null then
    if p_expires_in_minutes < 1 or p_expires_in_minutes > 10080 then
      raise exception 'FX_VALIDATION: validity must be between 1 minute and 7 days' using errcode = '22023';
    end if;
    v_expires := now() + make_interval(mins => p_expires_in_minutes);
  end if;

  v_prev_id := case rep.side when 'cargo' then t.cargo_proposal_id else t.vessel_proposal_id end;
  if v_prev_id is not null then
    select * into v_prev from public.fixture_proposals x where x.id = v_prev_id;
    -- observe the lapse once: the clock may already have written it
    if v_prev.expires_at is not null and v_prev.expires_at < now()
       and not exists (select 1 from public.fixture_events e where e.room_id = r.id and e.type = 'proposal.lapsed'
                          and e.payload->>'proposalId' = v_prev.id::text) then
      v_last := public.fn_fixture_event(r.id, 'proposal.lapsed', v_actor, acting.id, null, false, 'submit_fixture_proposal', p_idempotency_key, v_hash,
        jsonb_build_object('proposalId', v_prev.id, 'termId', t.id, 'termCode', t.code, 'side', rep.side, 'displayValue', v_prev.display_value, 'expiredAt', v_prev.expires_at), null);
    end if;
  end if;

  v_prev_status := r.status;
  v_new_status := case when r.status = 'invited' then 'negotiating' else r.status end;
  v_pid := gen_random_uuid();
  select count(*) + 1 into v_round from public.fixture_proposals x where x.term_id = t.id;

  v_first := public.fn_fixture_event(r.id, 'proposal.submitted', v_actor, acting.id,
    case when rep.id <> acting.id then rep.id end, rep.id <> acting.id, 'submit_fixture_proposal', p_idempotency_key, v_hash,
    jsonb_build_object('proposalId', v_pid, 'termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'side', rep.side,
                       'kind', case rep.side when 'cargo' then 'bid' else 'offer' end, 'displayValue', v_display, 'value', v_norm,
                       'comment', nullif(btrim(coalesce(p_comment, '')), ''), 'isFinal', coalesce(p_is_final, false), 'expiresAt', v_expires,
                       'round', v_round, 'supersedesProposalId', v_prev_id, 'previousRoomStatus', v_prev_status, 'roomStatus', v_new_status),
    jsonb_build_object('proposalId', v_pid, 'termId', t.id, 'termStatus', 'countered', 'roomStatus', v_new_status, 'displayValue', v_display));

  insert into public.fixture_proposals (id, room_id, term_id, party_id, recorded_by_user_id, relayed, kind, value_kind, value, display_value, comment,
                                        is_final, expires_at, supersedes_proposal_id, round, event_id)
  values (v_pid, r.id, t.id, rep.id, v_actor, rep.id <> acting.id, case rep.side when 'cargo' then 'bid' else 'offer' end, t.value_kind, v_norm, v_display,
          nullif(btrim(coalesce(p_comment, '')), ''), coalesce(p_is_final, false), v_expires, v_prev_id, v_round, (v_first->>'eventId')::bigint);

  update public.fixture_terms
     set cargo_proposal_id  = case when rep.side = 'cargo'  then v_pid else cargo_proposal_id end,
         vessel_proposal_id = case when rep.side = 'vessel' then v_pid else vessel_proposal_id end,
         last_proposal_id = v_pid, status = 'countered', updated_at = now()
   where id = t.id;
  if v_new_status <> v_prev_status then
    update public.fixture_rooms set status = v_new_status where id = r.id;
  end if;
  -- the first event (proposal.submitted) carries the result; a lapse observation may precede it
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.submit_fixture_proposal(uuid, uuid, jsonb, text, boolean, integer, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.submit_fixture_proposal(uuid, uuid, jsonb, text, boolean, integer, integer, text, uuid, uuid) to authenticated, service_role;

-- ── 5 · accept_fixture_proposal: window, hold / refer ───────────────────────
create or replace function public.accept_fixture_proposal(
  p_room_id uuid, p_proposal_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        pr public.fixture_proposals; pp public.fixture_parties; t public.fixture_terms; v_first jsonb; v_prev_status text; v_new_status text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'accept_fixture_proposal', 'proposal', p_proposal_id, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: proposals cannot be accepted while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  perform public.fn_fixture_require_window(r);
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);
  select * into pr from public.fixture_proposals x where x.id = p_proposal_id and x.room_id = r.id;
  if pr.id is null then
    raise exception 'FX_NOT_FOUND: proposal not found in this room' using errcode = 'P0002';
  end if;
  select * into pp from public.fixture_parties x where x.id = pr.party_id;
  if pp.side = rep.side then
    raise exception 'FX_STATE: you can only accept the other side''s proposal' using errcode = '55000';
  end if;
  select * into t from public.fixture_terms x where x.id = pr.term_id for update;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is already agreed', t.label using errcode = '55000';
  end if;
  if (pp.side = 'cargo' and t.cargo_proposal_id is distinct from pr.id) or (pp.side = 'vessel' and t.vessel_proposal_id is distinct from pr.id) then
    raise exception 'FX_STATE: this proposal is no longer live' using errcode = '55000';
  end if;
  perform public.fn_fixture_require_movable(t);
  if pr.expires_at is not null and pr.expires_at < now() then
    raise exception 'FX_STATE: this proposal lapsed at % — ask for a fresh one', to_char(pr.expires_at, 'DD Mon HH24:MI "UTC"') using errcode = '55000';
  end if;
  v_prev_status := r.status;
  v_new_status := case when r.status = 'invited' then 'negotiating' else r.status end;

  v_first := public.fn_fixture_event(r.id, 'term.agreed', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'accept_fixture_proposal', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'proposalId', pr.id, 'displayValue', pr.display_value,
                       'proposalSide', pp.side, 'acceptedBySide', rep.side, 'previousRoomStatus', v_prev_status, 'roomStatus', v_new_status),
    jsonb_build_object('termId', t.id, 'proposalId', pr.id, 'termStatus', 'agreed', 'roomStatus', v_new_status, 'displayValue', pr.display_value));
  update public.fixture_terms
     set status = 'agreed', agreed_proposal_id = pr.id, agreed_at = now(), agreed_by_party_id = rep.id, agreed_event_id = (v_first->>'eventId')::bigint,
         last_proposal_id = pr.id, held_by_party_id = null, held_at = null, referred_at = null, referred_by_party_id = null, updated_at = now()
   where id = t.id;
  if v_new_status <> v_prev_status then
    update public.fixture_rooms set status = v_new_status where id = r.id;
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'term agreed: ' || t.label, p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.accept_fixture_proposal(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_fixture_proposal(uuid, uuid, integer, text, uuid, uuid) to authenticated, service_role;

-- ── 6 · reopen_fixture_term: reinstates lifted subjects, voids confirmations ─
create or replace function public.reopen_fixture_term(
  p_room_id uuid, p_term_id uuid, p_reason text, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        t public.fixture_terms; ap public.fixture_proposals; v_first jsonb; s public.fixture_subjects; v_reinstated int := 0;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'reopen_fixture_term', 'term', p_term_id, 'reason', p_reason, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('negotiating', 'on_subjects') then
    raise exception 'FX_STATE: terms cannot be reopened while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  perform public.fn_fixture_require_window(r);
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  if rep.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot reopen terms' using errcode = '42501';
  end if;
  select * into t from public.fixture_terms x where x.id = p_term_id and x.room_id = r.id for update;
  if t.id is null then
    raise exception 'FX_NOT_FOUND: term not found in this room' using errcode = 'P0002';
  end if;
  if t.status <> 'agreed' then
    raise exception 'FX_STATE: "%" is not agreed, so there is nothing to reopen', t.label using errcode = '55000';
  end if;
  if coalesce(length(p_reason), 0) > 500 then
    raise exception 'FX_VALIDATION: reason must be at most 500 characters' using errcode = '22023';
  end if;
  select * into ap from public.fixture_proposals x where x.id = t.agreed_proposal_id;
  -- the result is complete before it is stored, so a replay returns exactly what this call returns (C2O-055)
  if r.status = 'on_subjects' then
    select count(*) into v_reinstated from public.fixture_subjects x where x.room_id = r.id and x.status = 'lifted';
  end if;

  v_first := public.fn_fixture_event(r.id, 'term.reopened', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'reopen_fixture_term', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'reason', nullif(btrim(coalesce(p_reason, '')), ''),
                       'previousProposalId', ap.id, 'previousAgreedValue', ap.display_value, 'reopenCount', t.reopen_count + 1,
                       'previousRoomStatus', r.status, 'roomStatus', 'negotiating'),
    jsonb_build_object('termId', t.id, 'termStatus', 'open', 'roomStatus', 'negotiating', 'subjectsReinstated', v_reinstated));
  update public.fixture_terms
     set status = 'open', agreed_proposal_id = null, agreed_at = null, agreed_by_party_id = null, agreed_event_id = null,
         cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, reopen_count = reopen_count + 1, updated_at = now()
   where id = t.id;
  -- any confirmation was given on the terms that just changed
  update public.fixture_rooms set fix_confirmations = '{}'::jsonb where id = r.id;
  if r.status = 'on_subjects' then
    -- back to negotiation, with at least three days to renegotiate
    update public.fixture_rooms
       set status = 'negotiating',
           negotiation_window_ends_at = greatest(coalesce(negotiation_window_ends_at, now()), now() + interval '3 days')
     where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.returned_to_negotiation', v_actor, acting.id, null, false, 'reopen_fixture_term', p_idempotency_key, v_hash,
      jsonb_build_object('reason', 'term reopened', 'termId', t.id, 'termLabel', t.label), null);
    -- a subject lifted against the old terms is open again (PR-08)
    for s in select * from public.fixture_subjects x where x.room_id = r.id and x.status = 'lifted' order by x.seq for update loop
      update public.fixture_subjects set status = 'open', resolved_at = null, resolved_by_party_id = null, resolved_event_id = null where id = s.id;
      perform public.fn_fixture_event(r.id, 'subject.reinstated', v_actor, acting.id, null, false, 'reopen_fixture_term', p_idempotency_key, v_hash,
        jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'title', s.title, 'reason', 'term reopened: ' || t.label), null);
    end loop;
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'IN', 'vessel_status', 'OPEN'),
      'returned to negotiation', v_actor, acting.id, p_idempotency_key, v_hash);
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'term reopened: ' || t.label, p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.reopen_fixture_term(uuid, uuid, text, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reopen_fixture_term(uuid, uuid, text, integer, text, uuid, uuid) to authenticated, service_role;

-- ── 7 · set_fixture_term_flag: the referring side clears its referral ──────
create or replace function public.set_fixture_term_flag(
  p_room_id uuid, p_term_id uuid, p_flag text, p_note text, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties; t public.fixture_terms; v_type text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'set_fixture_term_flag', 'term', p_term_id, 'flag', p_flag, 'note', p_note, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: term flags cannot change while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  perform public.fn_fixture_require_window(r);
  if p_flag not in ('hold', 'resume', 'refer', 'clear_referral') then
    raise exception 'FX_VALIDATION: flag must be hold, resume, refer or clear_referral' using errcode = '22023';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  if rep.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot flag terms' using errcode = '42501';
  end if;
  select * into t from public.fixture_terms x where x.id = p_term_id and x.room_id = r.id for update;
  if t.id is null then
    raise exception 'FX_NOT_FOUND: term not found in this room' using errcode = 'P0002';
  end if;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is agreed', t.label using errcode = '55000';
  end if;
  case p_flag
    when 'hold' then
      if t.held_by_party_id is not null then raise exception 'FX_STATE: "%" is already on hold', t.label using errcode = '55000'; end if;
      update public.fixture_terms set held_by_party_id = rep.id, held_at = now(), updated_at = now() where id = t.id; v_type := 'term.held';
    when 'resume' then
      if t.held_by_party_id is null then raise exception 'FX_STATE: "%" is not on hold', t.label using errcode = '55000'; end if;
      if t.held_by_party_id <> rep.id and acting.side <> 'mediator' then raise exception 'FX_AUTH: only the party that put "%" on hold can resume it', t.label using errcode = '42501'; end if;
      update public.fixture_terms set held_by_party_id = null, held_at = null, updated_at = now() where id = t.id; v_type := 'term.resumed';
    when 'refer' then
      if t.referred_at is not null then raise exception 'FX_STATE: "%" is already referred', t.label using errcode = '55000'; end if;
      update public.fixture_terms set referred_at = now(), referred_by_party_id = rep.id, updated_at = now() where id = t.id; v_type := 'term.referred';
    else
      if t.referred_at is null then raise exception 'FX_STATE: "%" is not referred', t.label using errcode = '55000'; end if;
      if t.referred_by_party_id is distinct from rep.id and acting.side <> 'mediator' then
        raise exception 'FX_AUTH: only the party that referred "%" (or the mediator) can clear the referral', t.label using errcode = '42501';
      end if;
      update public.fixture_terms set referred_at = null, referred_by_party_id = null, updated_at = now() where id = t.id; v_type := 'term.referral_cleared';
  end case;
  return public.fn_fixture_event(r.id, v_type, v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'set_fixture_term_flag', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'flag', p_flag, 'note', nullif(btrim(coalesce(p_note, '')), ''), 'side', rep.side),
    jsonb_build_object('termId', t.id, 'flag', p_flag));
end $$;
revoke all on function public.set_fixture_term_flag(uuid, uuid, text, text, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_fixture_term_flag(uuid, uuid, text, text, integer, text, uuid, uuid) to authenticated, service_role;

-- ── 8 · fix_fixture_on_subjects: both sides confirm the same basis (PR-07) ─
drop function if exists public.fix_fixture_on_subjects(uuid, integer, text, uuid);
create or replace function public.fix_fixture_on_subjects(
  p_room_id uuid, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        v_open_terms text; v_flagged text; v_missing text; v_agreed jsonb; v_open_subjects int; v_first jsonb; v_status text := 'on_subjects';
        v_basis text; v_conf jsonb; v_other text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  -- the pre-PR-07 hash when no party is named, so a retried request still replays
  v_hash := md5((jsonb_build_object('cmd', 'fix_fixture_on_subjects', 'as', p_as_party_id)
                 || case when p_on_behalf_of_party_id is null then '{}'::jsonb else jsonb_build_object('behalf', p_on_behalf_of_party_id) end)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status <> 'negotiating' then
    raise exception 'FX_STATE: a room can be fixed on subjects only while negotiating (it is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  perform public.fn_fixture_require_window(r);
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot fix a room' using errcode = '42501';
  end if;
  if acting.side = 'mediator' and p_on_behalf_of_party_id is null then
    raise exception 'FX_AUTH: each principal side confirms the fixture; the mediator confirms only for a relayed party it represents' using errcode = '42501';
  end if;
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);
  if rep.side not in ('cargo', 'vessel') then
    raise exception 'FX_AUTH: only the charterer side and the owner side confirm a fixture' using errcode = '42501';
  end if;
  select string_agg(t.label, ', ' order by t.sort_order) into v_open_terms from public.fixture_terms t where t.room_id = r.id and t.required and t.status <> 'agreed';
  if v_open_terms is not null then
    raise exception 'FX_STATE: every required term must be agreed first — still open: %', v_open_terms using errcode = '55000';
  end if;
  select string_agg(t.label, ', ' order by t.sort_order) into v_flagged from public.fixture_terms t
   where t.room_id = r.id and t.status <> 'withdrawn' and (t.held_by_party_id is not null or t.referred_at is not null);
  if v_flagged is not null then
    raise exception 'FX_STATE: settle the terms on hold or referred to principal first — %', v_flagged using errcode = '55000';
  end if;
  select string_agg(s, ' and ') into v_missing from (
    select case x when 'cargo' then 'the charterer side' else 'the owner side' end as s
      from unnest(array['cargo', 'vessel']) x
     where not exists (select 1 from public.fixture_parties p where p.room_id = r.id and p.side = x and p.capacity = 'principal' and p.status = 'active')) m;
  if v_missing is not null then
    raise exception 'FX_STATE: % has not joined the room', v_missing using errcode = '55000';
  end if;

  v_basis := public.fn_fixture_fix_basis(r.id);
  v_conf := coalesce(r.fix_confirmations, '{}'::jsonb);
  if v_conf->rep.side->>'basis' = v_basis then
    raise exception 'FX_STATE: your side has already confirmed this fixture — waiting for the other side' using errcode = '55000';
  end if;
  v_other := case rep.side when 'cargo' then 'vessel' else 'cargo' end;
  v_conf := v_conf || jsonb_build_object(rep.side, jsonb_build_object('at', now(), 'partyId', rep.id, 'userId', v_actor, 'relayed', rep.id <> acting.id, 'basis', v_basis));
  update public.fixture_rooms set fix_confirmations = v_conf where id = r.id;
  select count(*) into v_open_subjects from public.fixture_subjects s where s.room_id = r.id and s.status = 'open';

  if v_conf->v_other->>'basis' is distinct from v_basis then
    -- the first side: recorded, the room waits for the other side
    return public.fn_fixture_event(r.id, 'room.fix_confirmed', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
      'fix_fixture_on_subjects', p_idempotency_key, v_hash,
      jsonb_build_object('side', rep.side, 'basis', v_basis, 'openSubjects', v_open_subjects, 'awaitingSide', v_other),
      jsonb_build_object('roomStatus', 'negotiating', 'openSubjects', v_open_subjects, 'confirmedSides', jsonb_build_array(rep.side), 'awaitingSide', v_other));
  end if;

  -- the second side: both confirmed the same terms and subjects
  perform public.fn_fixture_event(r.id, 'room.fix_confirmed', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'fix_fixture_on_subjects', p_idempotency_key, v_hash,
    jsonb_build_object('side', rep.side, 'basis', v_basis, 'openSubjects', v_open_subjects, 'awaitingSide', null), null);
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'label', t.label, 'value', ap.display_value) order by t.sort_order), '[]'::jsonb)
    into v_agreed from public.fixture_terms t join public.fixture_proposals ap on ap.id = t.agreed_proposal_id where t.room_id = r.id and t.status = 'agreed';

  update public.fixture_rooms set status = 'on_subjects', fixed_on_subs_at = now() where id = r.id;
  v_first := public.fn_fixture_event(r.id, 'room.fixed_on_subjects', v_actor, acting.id, null, false, 'fix_fixture_on_subjects', p_idempotency_key, v_hash,
    jsonb_build_object('fixedOnSubsAt', now(), 'agreedTerms', v_agreed, 'openSubjects', v_open_subjects,
                       'confirmedAt', jsonb_build_object('cargo', v_conf->'cargo'->>'at', 'vessel', v_conf->'vessel'->>'at')),
    -- the final result, stored once: a clean fix (no open subject) is 'fixed' in the replay too (C2O-055)
    jsonb_build_object('roomStatus', case when v_open_subjects = 0 then 'fixed' else 'on_subjects' end, 'openSubjects', v_open_subjects,
                       'confirmedSides', jsonb_build_array('cargo', 'vessel'), 'awaitingSide', null));
  perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'ON SUBS'), 'on_subjects', v_actor, acting.id, p_idempotency_key, v_hash);
  if v_open_subjects = 0 then
    update public.fixture_rooms set status = 'fixed', fixed_at = now() where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.fixed', v_actor, acting.id, null, false, 'fix_fixture_on_subjects', p_idempotency_key, v_hash,
      jsonb_build_object('fixedAt', now(), 'note', 'no subjects were recorded, so the fixture is clean'), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'FIXED'), 'fixed', v_actor, acting.id, p_idempotency_key, v_hash);
    v_status := 'fixed';
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'fixed on subjects', p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.fix_fixture_on_subjects(uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.fix_fixture_on_subjects(uuid, integer, text, uuid, uuid) to authenticated, service_role;

-- ── 9 · extend_fixture_negotiation_window (mediator) ────────────────────────
create or replace function public.extend_fixture_negotiation_window(
  p_room_id uuid, p_ends_at timestamptz, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'extend_fixture_negotiation_window', 'endsAt', p_ends_at, 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: the negotiation window applies while the room is invited or negotiating (it is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if not (acting.side = 'mediator' and acting.capacity = 'broker') then
    raise exception 'FX_AUTH: only the mediator can change the negotiation window' using errcode = '42501';
  end if;
  if p_ends_at is null or p_ends_at < now() + interval '1 hour' or p_ends_at > now() + interval '60 days' then
    raise exception 'FX_VALIDATION: the window must end between one hour and 60 days from now' using errcode = '22023';
  end if;
  if r.negotiation_window_ends_at is not null and p_ends_at <= r.negotiation_window_ends_at then
    raise exception 'FX_VALIDATION: an extension must end after the current deadline (%)',
      to_char(r.negotiation_window_ends_at at time zone 'UTC', 'DD Mon YYYY HH24:MI "UTC"') using errcode = '22023';
  end if;
  update public.fixture_rooms set negotiation_window_ends_at = p_ends_at where id = r.id;
  return public.fn_fixture_event(r.id, 'room.window_extended', v_actor, acting.id, null, false, 'extend_fixture_negotiation_window', p_idempotency_key, v_hash,
    jsonb_build_object('previousEndsAt', r.negotiation_window_ends_at, 'endsAt', p_ends_at),
    jsonb_build_object('endsAt', p_ends_at));
end $$;
revoke all on function public.extend_fixture_negotiation_window(uuid, timestamptz, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.extend_fixture_negotiation_window(uuid, timestamptz, integer, text, uuid) to authenticated, service_role;

-- ── 9b · the deadline on every commercial command; terminal retention (C2O-052) ─
-- The released bodies of invite / respond / withdraw / add-subject, byte-for-byte,
-- plus one line: fn_fixture_require_window after the version check (it refuses
-- only while the room is invited or negotiating). A pending invitee loses access
-- to a withdrawn, failed or expired room (reads, inbox, commands); accepted
-- participants keep the archive.
create or replace function public.invite_fixture_party(
  p_room_id uuid, p_side text, p_capacity text, p_org_id uuid, p_user_id uuid,
  p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; v_p public.fixture_parties; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'invite_fixture_party', 'side', p_side, 'capacity', p_capacity, 'org', p_org_id, 'user', p_user_id, 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  perform public.fn_fixture_require_window(r);   -- PR-08 / C2O-052: no commercial move after the deadline
  if public.fn_fixture_terminal(r.status) then
    raise exception 'FX_STATE: the room is %', r.status using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot invite parties' using errcode = '42501';
  end if;
  if p_side not in ('cargo', 'vessel') or p_capacity not in ('principal', 'broker', 'viewer') then
    raise exception 'FX_VALIDATION: side must be cargo or vessel and capacity principal, broker or viewer' using errcode = '22023';
  end if;
  if acting.side <> 'mediator' and acting.side <> p_side then
    raise exception 'FX_AUTH: you may invite onto your own side only' using errcode = '42501';
  end if;
  if (p_org_id is null) = (p_user_id is null) then
    raise exception 'FX_VALIDATION: name exactly one of an organisation or a member' using errcode = '22023';
  end if;
  if p_org_id is not null and not exists (select 1 from public.organizations o where o.id = p_org_id) then
    raise exception 'FX_NOT_FOUND: organisation not found' using errcode = 'P0002';
  end if;
  if p_user_id is not null and not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'FX_NOT_FOUND: member not found' using errcode = 'P0002';
  end if;
  if p_capacity = 'principal' and exists (select 1 from public.fixture_parties p where p.room_id = r.id and p.side = p_side and p.capacity = 'principal' and p.status in ('invited', 'active')) then
    raise exception 'FX_STATE: the % side already has a principal', p_side using errcode = '55000';
  end if;
  begin
    insert into public.fixture_parties (room_id, side, capacity, participation_mode, org_id, user_id, display_label, status, invited_by_user_id, invited_at)
    values (r.id, p_side, p_capacity, 'direct', p_org_id, p_user_id,
            case p_capacity when 'principal' then (case p_side when 'cargo' then 'Charterer side' else 'Owner side' end)
                            when 'broker' then (case p_side when 'cargo' then 'Cargo-side broker' else 'Vessel-side broker' end)
                            else (case p_side when 'cargo' then 'Cargo-side viewer' else 'Vessel-side viewer' end) end,
            'invited', v_actor, now())
    returning * into v_p;
  exception when unique_violation then
    raise exception 'FX_CONFLICT: that organisation or member is already a party of this room' using errcode = '23505';
  end;
  if r.status = 'draft' then update public.fixture_rooms set status = 'invited' where id = r.id; end if;
  v_first := public.fn_fixture_event(r.id, 'party.invited', v_actor, acting.id, null, false, 'invite_fixture_party', p_idempotency_key, v_hash,
    public.fn_fixture_party_payload(v_p), jsonb_build_object('partyId', v_p.id, 'status', v_p.status));
  return v_first;
end $$;
revoke all on function public.invite_fixture_party(uuid, text, text, uuid, uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.invite_fixture_party(uuid, text, text, uuid, uuid, integer, text, uuid) to authenticated, service_role;

create or replace function public.respond_fixture_invitation(
  p_room_id uuid, p_accept boolean, p_expected_version integer, p_idempotency_key text, p_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; v_p public.fixture_parties; v_n int;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'respond_fixture_invitation', 'accept', p_accept, 'party', p_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  perform public.fn_fixture_require_window(r);   -- PR-08 / C2O-052: no commercial move after the deadline
  if public.fn_fixture_terminal(r.status) then
    raise exception 'FX_STATE: the room is %', r.status using errcode = '55000';
  end if;
  select count(*) into v_n from public.fn_fixture_actor_parties(r.id) p where p.status = 'invited';
  if v_n = 0 then
    raise exception 'FX_STATE: you have no pending invitation in this room' using errcode = '55000';
  end if;
  if p_party_id is not null then
    select p.* into v_p from public.fn_fixture_actor_parties(r.id) p where p.status = 'invited' and p.id = p_party_id;
    if v_p.id is null then
      raise exception 'FX_AUTH: that invitation is not yours to answer' using errcode = '42501';
    end if;
  elsif v_n > 1 then
    raise exception 'FX_VALIDATION: you hold % invitations in this room — name the party you are answering for', v_n using errcode = '22023';
  else
    select p.* into v_p from public.fn_fixture_actor_parties(r.id) p where p.status = 'invited';
  end if;
  if coalesce(p_accept, false) then
    update public.fixture_parties set status = 'active', accepted_at = now() where id = v_p.id returning * into v_p;
  else
    update public.fixture_parties set status = 'declined', declined_at = now() where id = v_p.id returning * into v_p;
  end if;
  return public.fn_fixture_event(r.id, case when p_accept then 'party.accepted' else 'party.declined' end, v_actor, v_p.id, null, false,
    'respond_fixture_invitation', p_idempotency_key, v_hash, public.fn_fixture_party_payload(v_p),
    jsonb_build_object('partyId', v_p.id, 'status', v_p.status));
end $$;
revoke all on function public.respond_fixture_invitation(uuid, boolean, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.respond_fixture_invitation(uuid, boolean, integer, text, uuid) to authenticated, service_role;

create or replace function public.withdraw_fixture_proposal(
  p_room_id uuid, p_proposal_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        pr public.fixture_proposals; t public.fixture_terms; v_other uuid; v_status text;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'withdraw_fixture_proposal', 'proposal', p_proposal_id, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  perform public.fn_fixture_require_window(r);   -- PR-08 / C2O-052: no commercial move after the deadline
  if r.status not in ('invited', 'negotiating') then
    raise exception 'FX_STATE: proposals cannot change while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, true);
  select * into pr from public.fixture_proposals x where x.id = p_proposal_id and x.room_id = r.id;
  if pr.id is null then
    raise exception 'FX_NOT_FOUND: proposal not found in this room' using errcode = 'P0002';
  end if;
  if pr.party_id <> rep.id then
    raise exception 'FX_AUTH: you can withdraw your own side''s proposal only' using errcode = '42501';
  end if;
  select * into t from public.fixture_terms x where x.id = pr.term_id for update;
  if t.status = 'agreed' then
    raise exception 'FX_STATE: "%" is agreed — reopen it instead', t.label using errcode = '55000';
  end if;
  if (rep.side = 'cargo' and t.cargo_proposal_id is distinct from pr.id) or (rep.side = 'vessel' and t.vessel_proposal_id is distinct from pr.id) then
    raise exception 'FX_STATE: this proposal is no longer live' using errcode = '55000';
  end if;
  v_other := case rep.side when 'cargo' then t.vessel_proposal_id else t.cargo_proposal_id end;
  v_status := case when v_other is null then 'open' else 'countered' end;
  update public.fixture_terms
     set cargo_proposal_id  = case when rep.side = 'cargo'  then null else cargo_proposal_id end,
         vessel_proposal_id = case when rep.side = 'vessel' then null else vessel_proposal_id end,
         last_proposal_id = case when last_proposal_id = pr.id then v_other else last_proposal_id end,
         status = v_status, updated_at = now()
   where id = t.id;
  return public.fn_fixture_event(r.id, 'proposal.withdrawn', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'withdraw_fixture_proposal', p_idempotency_key, v_hash,
    jsonb_build_object('proposalId', pr.id, 'termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'side', rep.side, 'displayValue', pr.display_value, 'termStatus', v_status),
    jsonb_build_object('proposalId', pr.id, 'termId', t.id, 'termStatus', v_status));
end $$;
revoke all on function public.withdraw_fixture_proposal(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.withdraw_fixture_proposal(uuid, uuid, integer, text, uuid, uuid) to authenticated, service_role;

create or replace function public.add_fixture_subject(
  p_room_id uuid, p_title text, p_description text, p_responsible_side text, p_deadline_at timestamptz,
  p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; v_sid uuid; v_seq int; v_first jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'add_fixture_subject', 'title', p_title, 'description', p_description, 'side', p_responsible_side, 'deadline', p_deadline_at, 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  perform public.fn_fixture_require_window(r);   -- PR-08 / C2O-052: no commercial move after the deadline
  if r.status not in ('negotiating', 'on_subjects') then
    raise exception 'FX_STATE: subjects can be added while negotiating or on subjects, not while the room is %', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot add subjects' using errcode = '42501';
  end if;
  if coalesce(length(btrim(p_title)), 0) not between 1 and 200 then
    raise exception 'FX_VALIDATION: subject title must be 1–200 characters' using errcode = '22023';
  end if;
  if coalesce(length(p_description), 0) > 1000 then
    raise exception 'FX_VALIDATION: subject description must be at most 1000 characters' using errcode = '22023';
  end if;
  if p_responsible_side is not null and p_responsible_side not in ('cargo', 'vessel', 'mediator') then
    raise exception 'FX_VALIDATION: responsible side must be cargo, vessel or mediator' using errcode = '22023';
  end if;
  select coalesce(max(s.seq), 0) + 1 into v_seq from public.fixture_subjects s where s.room_id = r.id;
  v_sid := gen_random_uuid();
  v_first := public.fn_fixture_event(r.id, 'subject.added', v_actor, acting.id, null, false, 'add_fixture_subject', p_idempotency_key, v_hash,
    jsonb_build_object('subjectId', v_sid, 'seq', v_seq, 'title', btrim(p_title), 'responsibleSide', p_responsible_side, 'deadlineAt', p_deadline_at),
    jsonb_build_object('subjectId', v_sid, 'seq', v_seq));
  insert into public.fixture_subjects (id, room_id, seq, title, description, responsible_side, deadline_at, added_by_party_id, added_event_id)
  values (v_sid, r.id, v_seq, btrim(p_title), nullif(btrim(coalesce(p_description, '')), ''), p_responsible_side, p_deadline_at, acting.id, (v_first->>'eventId')::bigint);
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'subject added', p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.add_fixture_subject(uuid, text, text, text, timestamptz, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.add_fixture_subject(uuid, text, text, text, timestamptz, integer, text, uuid) to authenticated, service_role;

create or replace function public.fn_fixture_actor_parties(p_room_id uuid)
 returns setof public.fixture_parties language plpgsql stable security definer set search_path to 'public'
as $$
declare v_actor uuid := public.fn_app_user_id(); v_admin boolean := public.fn_is_admin(); v_orgs uuid[] := public.fn_fixture_member_org_ids();
begin
  return query
    select p.* from public.fixture_parties p
     where p.room_id = p_room_id
       and p.status in ('invited', 'active')
       -- C2O-052: a never-accepted invitation gives no access once the room is withdrawn, failed or expired
       and (p.status = 'active' or not exists (select 1 from public.fixture_rooms x where x.id = p_room_id and x.status in ('withdrawn', 'failed', 'expired')))
       and p.participation_mode = 'direct'
       and ((p.org_id is not null and p.org_id = any (v_orgs))
            or (p.user_id is not null and p.user_id = v_actor)
            or (p.is_platform and v_admin))
     order by (p.capacity = 'principal') desc, (p.capacity = 'broker') desc, p.is_platform, p.created_at;
end $$;
revoke all on function public.fn_fixture_actor_parties(uuid) from public, anon, authenticated;

create or replace function public.list_fixture_rooms(p_status text[] default null, p_limit integer default 50)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; v_admin boolean; v_orgs uuid[]; v_out jsonb;
begin
  v_actor := public.fn_fixture_actor();
  v_admin := public.fn_is_admin();
  v_orgs := public.fn_fixture_member_org_ids();
  if v_admin then
    insert into public.fixture_access_log (room_id, user_id, is_admin, reason) values (null, v_actor, true, 'list');
  end if;
  select coalesce(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) into v_out from (
    select r.id, r.ref, r.status, r.version, r.created_at as "createdAt", r.updated_at as "updatedAt",
           r.fixed_on_subs_at as "fixedOnSubsAt", r.fixed_at as "fixedAt", r.closed_reason as "closedReason",
           (r.counterparty_disclosed_at is not null) as "counterpartyDisclosed",
           jsonb_build_object('ref', r.cargo_snapshot->>'ref', 'commodity', r.cargo_snapshot->>'commodity_name',
                              'qtyMin', r.cargo_snapshot->'qty_min_mt', 'qtyMax', r.cargo_snapshot->'qty_max_mt',
                              'loadPort', r.cargo_snapshot->>'load_port_name', 'dischPort', r.cargo_snapshot->>'disch_port_name',
                              'laycanFrom', r.cargo_snapshot->>'laycan_from', 'laycanTo', r.cargo_snapshot->>'laycan_to') as cargo,
           jsonb_build_object(
             'name', case when coalesce((r.vessel_snapshot->'vessel'->>'is_tbn')::boolean, false)
                               and not (v_admin or r.counterparty_disclosed_at is not null or coalesce(mine.side, '') in ('vessel', 'mediator'))
                          then 'TBN' else r.vessel_snapshot->'vessel'->>'vessel_name' end,
             'type', r.vessel_snapshot->'vessel'->>'vessel_type', 'dwt', r.vessel_snapshot->'vessel'->'dwt_grain',
             'openPort', r.vessel_snapshot->'availability'->>'open_port_name', 'openDate', r.vessel_snapshot->'availability'->>'open_date') as vessel,
           mine.side as "mySide", mine.capacity as "myCapacity", mine.status as "myStatus",
           (select p.display_label from public.fixture_parties p
             where p.room_id = r.id and p.status in ('invited', 'active') and p.capacity = 'principal'
               and p.side in ('cargo', 'vessel') and p.side is distinct from mine.side
             order by p.created_at limit 1) as "counterpartyLabel",
           (select count(*) from public.fixture_terms t where t.room_id = r.id) as "termCount",
           (select count(*) from public.fixture_terms t where t.room_id = r.id and t.status = 'agreed') as "agreedTerms",
           (select count(*) from public.fixture_subjects s where s.room_id = r.id and s.status = 'open') as "openSubjects",
           coalesce((public.fn_fixture_listing_sync(r)->>'outstanding')::boolean, false) as "listingSyncOutstanding"
      from public.fixture_rooms r
      left join lateral (
        select p.side, p.capacity, p.status from public.fixture_parties p
         where p.room_id = r.id and p.status in ('invited', 'active') and p.participation_mode = 'direct'
           and (p.status = 'active' or r.status not in ('withdrawn', 'failed', 'expired'))
           and ((p.org_id is not null and p.org_id = any (v_orgs)) or (p.user_id is not null and p.user_id = v_actor) or (p.is_platform and v_admin))
         order by (p.capacity = 'principal') desc, (p.capacity = 'broker') desc, p.is_platform, p.created_at limit 1) mine on true
     where (p_status is null or r.status = any (p_status))
       and (v_admin or mine.side is not null)
     order by r.updated_at desc
     limit least(greatest(coalesce(p_limit, 50), 1), 200)) x;
  return v_out;
end $$;
revoke all on function public.list_fixture_rooms(text[], integer) from public, anon, authenticated;
grant execute on function public.list_fixture_rooms(text[], integer) to authenticated, service_role;

-- ── 10 · capabilities: the window and the confirmations ────────────────────
create or replace function public.fn_fixture_capabilities(r public.fixture_rooms, p_parties public.fixture_parties[], p_admin boolean, p_relayed_ids uuid[])
 returns jsonb language plpgsql stable set search_path to ''
as $$
declare p public.fixture_parties; v_side text; v_mediator boolean := false; v_commercial boolean := false; v_any boolean := false;
        v_invited boolean := false; v_can_disclose boolean := false; v_terminal boolean; v_open boolean; v_closed boolean;
begin
  v_terminal := r.status in ('withdrawn', 'failed', 'expired');
  foreach p in array coalesce(p_parties, '{}'::public.fixture_parties[]) loop
    if p.status = 'invited' then v_invited := true; end if;
    if p.status <> 'active' then continue; end if;
    v_any := true;
    if p.side in ('cargo', 'vessel') and v_side is null then v_side := p.side; end if;
    if p.side = 'mediator' and p.capacity = 'broker' then v_mediator := true; end if;
    if p.side in ('cargo', 'vessel') and p.capacity in ('principal', 'broker') then v_commercial := true; end if;
    if p.side in ('cargo', 'vessel') and p.capacity = 'principal' and p.disclosure_agreed_at is null then v_can_disclose := true; end if;
  end loop;
  if v_mediator and coalesce(array_length(p_relayed_ids, 1), 0) > 0 then v_commercial := true; end if;
  if v_side is null and v_mediator then v_side := 'mediator'; end if;
  v_closed := public.fn_fixture_window_closed(r);
  v_open := r.status in ('invited', 'negotiating') and not v_closed;
  return jsonb_build_object(
    'viewerSide', v_side,
    'isMediator', v_mediator,
    'isAdmin', coalesce(p_admin, false),
    'canPropose', v_open and v_commercial,
    'canAccept', v_open and v_commercial,
    'canWithdrawProposal', v_open and v_commercial,
    'canReopen', ((r.status = 'negotiating' and not v_closed) or r.status = 'on_subjects') and v_commercial,
    'canFlagTerm', v_open and (v_commercial or v_mediator),
    'canAddSubject', ((r.status = 'negotiating' and not v_closed) or r.status = 'on_subjects') and (v_commercial or v_mediator),
    'canLiftSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canFailSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canExtendSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canFixOnSubjects', r.status = 'negotiating' and not v_closed and v_commercial,
    'fixConfirmedSides', public.fn_fixture_fix_confirmed_sides(r),
    'windowClosed', v_closed,
    'canExtendWindow', r.status in ('invited', 'negotiating') and v_mediator,
    'canPublishRecap', r.status in ('negotiating', 'on_subjects', 'fixed') and (v_commercial or v_mediator),
    'canAcknowledgeRecap', r.status in ('negotiating', 'on_subjects', 'fixed') and v_commercial,
    'canMessage', v_any and not v_terminal,
    'canWithdraw', not v_terminal and r.status <> 'fixed' and v_commercial and not (v_mediator and not exists (select 1 from unnest(coalesce(p_parties, '{}'::public.fixture_parties[])) q where q.status = 'active' and q.side in ('cargo','vessel') and q.capacity in ('principal','broker'))),
    'canFail', not v_terminal and r.status <> 'fixed' and (v_mediator or coalesce(p_admin, false)),
    'canExpire', not v_terminal and r.status <> 'fixed' and (v_mediator or coalesce(p_admin, false)),
    'canAgreeDisclosure', not v_terminal and (v_can_disclose or (v_mediator and coalesce(array_length(p_relayed_ids, 1), 0) > 0)),
    'canInvite', not v_terminal and not v_closed and (v_commercial or v_mediator),
    'canRespondInvitation', v_invited and not v_terminal and not v_closed,
    'canRedact', coalesce(p_admin, false),
    'actForPartyIds', to_jsonb(case when v_mediator then coalesce(p_relayed_ids, '{}'::uuid[]) else '{}'::uuid[] end));
end $$;
revoke all on function public.fn_fixture_capabilities(public.fixture_rooms, public.fixture_parties[], boolean, uuid[]) from public, anon, authenticated;

-- ── 11 · the clock (service only) ───────────────────────────────────────────
-- 11a · observe lapsed proposals once (behaviour of the held-out 20260923204000)
create or replace function public.sweep_fixture_proposal_lapses(p_limit integer default 200)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_swept integer := 0; v_rooms uuid[] := '{}'; rec record; r public.fixture_rooms;
begin
  for rec in
    select t.room_id, t.id as term_id, t.code as term_code, pr.id as proposal_id, pr.display_value, pr.expires_at,
           case when t.cargo_proposal_id = pr.id then 'cargo' else 'vessel' end as side
      from public.fixture_proposals pr
      join public.fixture_terms t on t.id = pr.term_id and (t.cargo_proposal_id = pr.id or t.vessel_proposal_id = pr.id) and t.status in ('open', 'countered')
      join public.fixture_rooms rm on rm.id = t.room_id
     where pr.expires_at is not null and pr.expires_at < now()
       and rm.status not in ('withdrawn', 'failed', 'expired', 'fixed')
       and not exists (select 1 from public.fixture_events e where e.room_id = t.room_id and e.type = 'proposal.lapsed' and e.payload->>'proposalId' = pr.id::text)
     order by pr.expires_at, pr.id
     limit v_limit
  loop
    -- the room lock every command takes; a room another session holds waits for the next run
    select * into r from public.fixture_rooms x where x.id = rec.room_id for update skip locked;
    if not found then continue; end if;
    if r.status in ('withdrawn', 'failed', 'expired', 'fixed') then continue; end if;
    if exists (select 1 from public.fixture_events e where e.room_id = r.id and e.type = 'proposal.lapsed' and e.payload->>'proposalId' = rec.proposal_id::text) then continue; end if;
    if not exists (select 1 from public.fixture_terms t where t.id = rec.term_id and t.status in ('open', 'countered')
                     and (t.cargo_proposal_id = rec.proposal_id or t.vessel_proposal_id = rec.proposal_id)) then continue; end if;
    perform public.fn_fixture_event(r.id, 'proposal.lapsed', null, null, null, false, 'sweep_fixture_proposal_lapses', 'sweep:' || rec.proposal_id::text, null,
      jsonb_build_object('proposalId', rec.proposal_id, 'termId', rec.term_id, 'termCode', rec.term_code, 'side', rec.side,
                         'displayValue', rec.display_value, 'expiredAt', rec.expires_at, 'source', 'sweep'), null);
    v_swept := v_swept + 1;
    if not (r.id = any (v_rooms)) then v_rooms := v_rooms || r.id; end if;
  end loop;
  return jsonb_build_object('ok', true, 'swept', v_swept, 'rooms', coalesce(array_length(v_rooms, 1), 0), 'limit', v_limit);
end $$;
revoke all on function public.sweep_fixture_proposal_lapses(integer) from public, anon, authenticated;
grant execute on function public.sweep_fixture_proposal_lapses(integer) to service_role;

-- 11b · expire rooms whose negotiation window closed
create or replace function public.sweep_fixture_room_windows(p_limit integer default 100)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_expired integer := 0; rec record; r public.fixture_rooms; v_key text; v_note text;
begin
  for rec in
    select x.id from public.fixture_rooms x
     where x.status in ('invited', 'negotiating') and x.negotiation_window_ends_at is not null and x.negotiation_window_ends_at <= now()
     order by x.negotiation_window_ends_at, x.id
     limit v_limit
  loop
    select * into r from public.fixture_rooms x where x.id = rec.id for update skip locked;
    if not found then continue; end if;
    if not public.fn_fixture_window_closed(r) then continue; end if;   -- extended or moved on meanwhile
    v_key := 'clock:expire:' || r.id::text;
    v_note := 'negotiation window closed at ' || to_char(r.negotiation_window_ends_at at time zone 'UTC', 'DD Mon YYYY HH24:MI "UTC"');
    update public.fixture_rooms
       set status = 'expired', closed_at = now(), closed_reason = 'expired', closed_by_user_id = null, closed_note = v_note
     where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.closed', null, null, null, false, 'sweep_fixture_room_windows', v_key, null,
      jsonb_build_object('reason', 'expired', 'note', v_note, 'previousStatus', r.status, 'windowEndsAt', r.negotiation_window_ends_at, 'source', 'clock'), null);
    perform public.fn_fixture_invalidate_recap(r.id, null, null, 'room expired', v_key, null);
    v_expired := v_expired + 1;
  end loop;
  return jsonb_build_object('ok', true, 'expired', v_expired, 'limit', v_limit);
end $$;
revoke all on function public.sweep_fixture_room_windows(integer) from public, anon, authenticated;
grant execute on function public.sweep_fixture_room_windows(integer) to service_role;

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

-- ── 12 · backfill: open rooms get 14 days from now, recorded as an event ──
-- A System room.window_extended per room moves the room version, so a client
-- holding the old view refreshes instead of acting on a deadline it never saw
-- (C2O-052). Only rooms without a window are touched, so a re-run adds nothing.
create or replace function public.fn_fixture_backfill_windows()
 returns integer language plpgsql volatile security definer set search_path to 'public'
as $$
declare rec record; v_ends timestamptz := now() + interval '14 days'; v_n integer := 0;
begin
  for rec in select id from public.fixture_rooms where status in ('draft', 'invited', 'negotiating') and negotiation_window_ends_at is null order by created_at for update loop
    update public.fixture_rooms set negotiation_window_ends_at = v_ends where id = rec.id;
    perform public.fn_fixture_event(rec.id, 'room.window_extended', null, null, null, false, 'migration_20261006100000',
      'migration:20261006100000:window', null, jsonb_build_object('previousEndsAt', null, 'endsAt', v_ends, 'source', 'migration'), null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke all on function public.fn_fixture_backfill_windows() from public, anon, authenticated, service_role;
select public.fn_fixture_backfill_windows();

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fixture-room-clock';
    perform cron.schedule('fixture-room-clock', '*/5 * * * *', $cron$select public.run_fixture_room_clock()$cron$);
  end if;
end $$;

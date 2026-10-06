-- ════════════════════════════════════════════════════════════════════════
-- DOWN · 20261006100000_fixture_room_enforcement.sql (PR-07 / PR-08)
--
-- Restores the released command behaviour: the original definitions of
-- fn_fixture_capabilities (20260923201000) and submit / accept / reopen /
-- set_fixture_term_flag / fix_fixture_on_subjects (20260923203000), copied
-- verbatim, and the released invite / respond / withdraw / add-subject,
-- fn_fixture_actor_parties and list_fixture_rooms; drops the clock, the
-- window command and the internals; drops fix_confirmations and the window
-- default. Window VALUES are kept: informational again, never enforced.
--
-- Ledger rows are never deleted. The event CHECK goes back to the list saved
-- in its comment ONLY when no room.fix_confirmed / subject.reinstated /
-- room.window_extended event exists; otherwise the wider CHECK stays (a
-- superset, so nothing breaks) and a NOTICE says so.
-- Run in one transaction: psql -v ON_ERROR_STOP=1 -1 -f <this file>
-- ════════════════════════════════════════════════════════════════════════

-- Fire any deferred checks first: when this DOWN runs inside a transaction that also wrote rooms (the linked
-- production rehearsal), ALTER TABLE fixture_rooms would otherwise fail with "pending trigger events".
set constraints all immediate;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'fixture-room-clock';
  end if;
end $$;

drop function if exists public.run_fixture_room_clock();
drop function if exists public.sweep_fixture_room_windows(integer);
drop function if exists public.sweep_fixture_proposal_lapses(integer);
drop function if exists public.extend_fixture_negotiation_window(uuid, timestamptz, integer, text, uuid);
drop function if exists public.fix_fixture_on_subjects(uuid, integer, text, uuid, uuid);

-- ── the released definitions ───────────────────────────────────────────────
create or replace function public.fn_fixture_capabilities(r public.fixture_rooms, p_parties public.fixture_parties[], p_admin boolean, p_relayed_ids uuid[])
 returns jsonb language plpgsql stable set search_path to ''
as $$
declare p public.fixture_parties; v_side text; v_mediator boolean := false; v_commercial boolean := false; v_any boolean := false;
        v_invited boolean := false; v_can_disclose boolean := false; v_terminal boolean; v_open boolean;
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
  v_open := r.status in ('invited', 'negotiating');
  return jsonb_build_object(
    'viewerSide', v_side,
    'isMediator', v_mediator,
    'isAdmin', coalesce(p_admin, false),
    'canPropose', v_open and v_commercial,
    'canAccept', v_open and v_commercial,
    'canWithdrawProposal', v_open and v_commercial,
    'canReopen', r.status in ('negotiating', 'on_subjects') and v_commercial,
    'canFlagTerm', v_open and (v_commercial or v_mediator),
    'canAddSubject', r.status in ('negotiating', 'on_subjects') and (v_commercial or v_mediator),
    'canLiftSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canFailSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canExtendSubject', r.status = 'on_subjects' and (v_commercial or v_mediator),
    'canFixOnSubjects', r.status = 'negotiating' and (v_commercial or v_mediator),
    'canPublishRecap', r.status in ('negotiating', 'on_subjects', 'fixed') and (v_commercial or v_mediator),
    'canAcknowledgeRecap', r.status in ('negotiating', 'on_subjects', 'fixed') and v_commercial,
    'canMessage', v_any and not v_terminal,
    'canWithdraw', not v_terminal and r.status <> 'fixed' and v_commercial and not (v_mediator and not exists (select 1 from unnest(coalesce(p_parties, '{}'::public.fixture_parties[])) q where q.status = 'active' and q.side in ('cargo','vessel') and q.capacity in ('principal','broker'))),
    'canFail', not v_terminal and r.status <> 'fixed' and (v_mediator or coalesce(p_admin, false)),
    'canExpire', not v_terminal and r.status <> 'fixed' and (v_mediator or coalesce(p_admin, false)),
    'canAgreeDisclosure', not v_terminal and (v_can_disclose or (v_mediator and coalesce(array_length(p_relayed_ids, 1), 0) > 0)),
    'canInvite', not v_terminal and (v_commercial or v_mediator),
    'canRespondInvitation', v_invited,
    'canRedact', coalesce(p_admin, false),
    'actForPartyIds', to_jsonb(case when v_mediator then coalesce(p_relayed_ids, '{}'::uuid[]) else '{}'::uuid[] end));
end $$;
revoke all on function public.fn_fixture_capabilities(public.fixture_rooms, public.fixture_parties[], boolean, uuid[]) from public, anon, authenticated;

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
    if v_prev.expires_at is not null and v_prev.expires_at < now() then
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

create or replace function public.reopen_fixture_term(
  p_room_id uuid, p_term_id uuid, p_reason text, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        t public.fixture_terms; ap public.fixture_proposals; v_first jsonb;
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

  v_first := public.fn_fixture_event(r.id, 'term.reopened', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'reopen_fixture_term', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'reason', nullif(btrim(coalesce(p_reason, '')), ''),
                       'previousProposalId', ap.id, 'previousAgreedValue', ap.display_value, 'reopenCount', t.reopen_count + 1,
                       'previousRoomStatus', r.status, 'roomStatus', 'negotiating'),
    jsonb_build_object('termId', t.id, 'termStatus', 'open', 'roomStatus', 'negotiating'));
  update public.fixture_terms
     set status = 'open', agreed_proposal_id = null, agreed_at = null, agreed_by_party_id = null, agreed_event_id = null,
         cargo_proposal_id = null, vessel_proposal_id = null, last_proposal_id = null, reopen_count = reopen_count + 1, updated_at = now()
   where id = t.id;
  if r.status = 'on_subjects' then
    update public.fixture_rooms set status = 'negotiating' where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.returned_to_negotiation', v_actor, acting.id, null, false, 'reopen_fixture_term', p_idempotency_key, v_hash,
      jsonb_build_object('reason', 'term reopened', 'termId', t.id, 'termLabel', t.label), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'IN', 'vessel_status', 'OPEN'),
      'returned to negotiation', v_actor, acting.id, p_idempotency_key, v_hash);
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'term reopened: ' || t.label, p_idempotency_key, v_hash);
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id));
end $$;
revoke all on function public.reopen_fixture_term(uuid, uuid, text, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.reopen_fixture_term(uuid, uuid, text, integer, text, uuid, uuid) to authenticated, service_role;

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
      update public.fixture_terms set referred_at = null, referred_by_party_id = null, updated_at = now() where id = t.id; v_type := 'term.referral_cleared';
  end case;
  return public.fn_fixture_event(r.id, v_type, v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'set_fixture_term_flag', p_idempotency_key, v_hash,
    jsonb_build_object('termId', t.id, 'termCode', t.code, 'termLabel', t.label, 'flag', p_flag, 'note', nullif(btrim(coalesce(p_note, '')), ''), 'side', rep.side),
    jsonb_build_object('termId', t.id, 'flag', p_flag));
end $$;
revoke all on function public.set_fixture_term_flag(uuid, uuid, text, text, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_fixture_term_flag(uuid, uuid, text, text, integer, text, uuid, uuid) to authenticated, service_role;

create or replace function public.fix_fixture_on_subjects(p_room_id uuid, p_expected_version integer, p_idempotency_key text, p_as_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; v_open_terms text; v_missing text;
        v_agreed jsonb; v_open_subjects int; v_first jsonb; v_status text := 'on_subjects';
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'fix_fixture_on_subjects', 'as', p_as_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status <> 'negotiating' then
    raise exception 'FX_STATE: a room can be fixed on subjects only while negotiating (it is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  if acting.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot fix a room' using errcode = '42501';
  end if;
  select string_agg(t.label, ', ' order by t.sort_order) into v_open_terms from public.fixture_terms t where t.room_id = r.id and t.required and t.status <> 'agreed';
  if v_open_terms is not null then
    raise exception 'FX_STATE: every required term must be agreed first — still open: %', v_open_terms using errcode = '55000';
  end if;
  select string_agg(s, ' and ') into v_missing from (
    select case x when 'cargo' then 'the charterer side' else 'the owner side' end as s
      from unnest(array['cargo', 'vessel']) x
     where not exists (select 1 from public.fixture_parties p where p.room_id = r.id and p.side = x and p.capacity = 'principal' and p.status = 'active')) m;
  if v_missing is not null then
    raise exception 'FX_STATE: % has not joined the room', v_missing using errcode = '55000';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('code', t.code, 'label', t.label, 'value', ap.display_value) order by t.sort_order), '[]'::jsonb)
    into v_agreed from public.fixture_terms t join public.fixture_proposals ap on ap.id = t.agreed_proposal_id where t.room_id = r.id and t.status = 'agreed';
  select count(*) into v_open_subjects from public.fixture_subjects s where s.room_id = r.id and s.status = 'open';

  update public.fixture_rooms set status = 'on_subjects', fixed_on_subs_at = now() where id = r.id;
  v_first := public.fn_fixture_event(r.id, 'room.fixed_on_subjects', v_actor, acting.id, null, false, 'fix_fixture_on_subjects', p_idempotency_key, v_hash,
    jsonb_build_object('fixedOnSubsAt', now(), 'agreedTerms', v_agreed, 'openSubjects', v_open_subjects),
    jsonb_build_object('roomStatus', 'on_subjects', 'openSubjects', v_open_subjects));
  perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'ON SUBS'), 'on_subjects', v_actor, acting.id, p_idempotency_key, v_hash);
  if v_open_subjects = 0 then
    update public.fixture_rooms set status = 'fixed', fixed_at = now() where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.fixed', v_actor, acting.id, null, false, 'fix_fixture_on_subjects', p_idempotency_key, v_hash,
      jsonb_build_object('fixedAt', now(), 'note', 'no subjects were recorded, so the fixture is clean'), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'FIXED'), 'fixed', v_actor, acting.id, p_idempotency_key, v_hash);
    v_status := 'fixed';
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'fixed on subjects', p_idempotency_key, v_hash);
  return (v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id)))
         || jsonb_build_object('data', jsonb_build_object('roomStatus', v_status, 'openSubjects', v_open_subjects));
end $$;
revoke all on function public.fix_fixture_on_subjects(uuid, integer, text, uuid) from public, anon, authenticated;
grant execute on function public.fix_fixture_on_subjects(uuid, integer, text, uuid) to authenticated, service_role;

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

create or replace function public.lift_fixture_subject(
  p_room_id uuid, p_subject_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        s public.fixture_subjects; v_first jsonb; v_open int; v_fixed boolean := false;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'lift_fixture_subject', 'subject', p_subject_id, 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
  v_replay := public.fn_fixture_replay(r.id, p_idempotency_key, v_hash);
  if v_replay is not null then return v_replay; end if;
  perform public.fn_fixture_check_version(r, p_expected_version);
  if r.status <> 'on_subjects' then
    raise exception 'FX_STATE: subjects can be lifted only while the room is on subjects (it is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  acting := public.fn_fixture_acting_party(r.id, p_as_party_id);
  rep := public.fn_fixture_rep(acting, p_on_behalf_of_party_id, false);
  if rep.capacity = 'viewer' then
    raise exception 'FX_AUTH: viewers cannot lift subjects' using errcode = '42501';
  end if;
  select * into s from public.fixture_subjects x where x.id = p_subject_id and x.room_id = r.id for update;
  if s.id is null then
    raise exception 'FX_NOT_FOUND: subject not found in this room' using errcode = 'P0002';
  end if;
  if s.status <> 'open' then
    raise exception 'FX_STATE: subject "%" is already %', s.title, s.status using errcode = '55000';
  end if;
  if s.responsible_side is not null and s.responsible_side <> rep.side then
    raise exception 'FX_AUTH: the % side must lift "%"', s.responsible_side, s.title using errcode = '42501';
  end if;
  v_first := public.fn_fixture_event(r.id, 'subject.lifted', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
    'lift_fixture_subject', p_idempotency_key, v_hash,
    jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'title', s.title, 'liftedBySide', rep.side),
    jsonb_build_object('subjectId', s.id, 'subjectStatus', 'lifted'));
  update public.fixture_subjects set status = 'lifted', resolved_at = now(), resolved_by_party_id = rep.id, resolved_event_id = (v_first->>'eventId')::bigint where id = s.id;
  select count(*) into v_open from public.fixture_subjects x where x.room_id = r.id and x.status = 'open';
  if v_open = 0 then
    update public.fixture_rooms set status = 'fixed', fixed_at = now() where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.fixed', v_actor, acting.id, null, false, 'lift_fixture_subject', p_idempotency_key, v_hash,
      jsonb_build_object('fixedAt', now(), 'lastSubjectId', s.id, 'lastSubjectTitle', s.title), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'FIXED'), 'fixed', v_actor, acting.id, p_idempotency_key, v_hash);
    v_fixed := true;
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'subject lifted', p_idempotency_key, v_hash);
  return (v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id)))
         || jsonb_build_object('data', (v_first->'data') || jsonb_build_object('roomStatus', case when v_fixed then 'fixed' else 'on_subjects' end, 'openSubjects', v_open));
end $$;
revoke all on function public.lift_fixture_subject(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.lift_fixture_subject(uuid, uuid, integer, text, uuid, uuid) to authenticated, service_role;

drop function if exists public.fn_fixture_fix_confirmed_sides(public.fixture_rooms);
drop function if exists public.fn_fixture_require_window(public.fixture_rooms);
drop function if exists public.fn_fixture_window_closed(public.fixture_rooms);
drop function if exists public.fn_fixture_require_movable(public.fixture_terms);
drop function if exists public.fn_fixture_fix_basis(uuid);
drop function if exists public.fn_fixture_backfill_windows();

alter table public.fixture_rooms drop column if exists fix_confirmations;
alter table public.fixture_rooms alter column negotiation_window_ends_at drop default;
-- Window values are KEPT (C2O-052): they are what members were shown; the
-- released module treats the column as informational, so nothing enforces them.
comment on column public.fixture_rooms.negotiation_window_ends_at is null;

do $$
declare v_def text; v_used int;
begin
  select substr(obj_description(oid, 'pg_constraint'), 6) into v_def from pg_constraint
   where conrelid = 'public.fixture_events'::regclass and conname = 'fixture_events_type_check'
     and coalesce(obj_description(oid, 'pg_constraint'), '') like 'down:%';
  if v_def is null then
    raise notice 'fixture enforcement DOWN: no saved event CHECK found; the current CHECK is left in place';
    return;
  end if;
  select count(*) into v_used from public.fixture_events where type in ('room.fix_confirmed', 'subject.reinstated', 'room.window_extended');
  if v_used > 0 then
    raise notice 'fixture enforcement DOWN: % ledger event(s) use the new types; the wider event CHECK stays (rows are never deleted)', v_used;
    return;
  end if;
  alter table public.fixture_events drop constraint fixture_events_type_check;
  execute format('alter table public.fixture_events add constraint fixture_events_type_check %s', v_def);
end $$;

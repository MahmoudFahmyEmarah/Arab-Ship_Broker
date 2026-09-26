-- Fixture Room · proposal-lapse sweep (26 Sep 2026)
-- Migration 20260923204000, inside the reserved Fixture range 2026092320xxxx–2026092324xxxx.
--
-- Until now proposal expiry was lazy: an expired proposal was refused on
-- acceptance, reported as `lapsed` by the read model, and only observed in the
-- ledger (`proposal.lapsed`) when its own side replaced it. Nothing told a
-- polling counterparty that the offer in front of them had died. This sweep is
-- the service-owned observer: for every LIVE proposal (still pointed to by its
-- term) whose validity has passed, in a room that is still negotiating, it
-- appends one `proposal.lapsed` event with no actor (rendered "System" by the
-- read model), which moves the room version so every open tab refreshes.
--
-- Idempotent by the ledger itself: a proposal that already has a
-- `proposal.lapsed` observation — from an earlier sweep or from the submit
-- path — is never observed twice, and submit_fixture_proposal skips its own
-- observation when the sweep got there first. Rooms are taken under the same
-- FOR UPDATE lock as every command, SKIP LOCKED so the sweep never waits on a
-- live negotiation. Nothing else changes: pointers, term status, proposals
-- (append-only) and the room status are untouched; acceptance of a lapsed
-- proposal stays refused exactly as before.
--
-- Scheduling is the owner's decision (pg_cron or an external cron with the
-- service role); the function is granted to service_role only and refuses
-- nothing else because members cannot reach it at all.

-- ── 1 · the submit path observes a lapse once ──────────────────────────────
-- 20260923203000 stays byte-identical to its accepted version; this migration
-- REPLACES submit_fixture_proposal with the same body plus one guard, so an
-- environment that applied 20260923203000 earlier and receives this file
-- alone gets the guard too (C2O-003). The only change to the body is the
-- marked `not exists` on the lapse observation; scripts/fixture-room-check.ts
-- proves the two definitions are otherwise identical.
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
    -- observe the lapse once: the sweep (below) may already have written it
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

-- ── 2 · the sweep ──────────────────────────────────────────────────────────
create or replace function public.sweep_fixture_proposal_lapses(p_limit integer default 200)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
  v_swept integer := 0;
  v_rooms uuid[] := '{}';
  rec record;
  r public.fixture_rooms;
begin
  for rec in
    select t.room_id, t.id as term_id, t.code as term_code, pr.id as proposal_id,
           pr.display_value, pr.expires_at,
           case when t.cargo_proposal_id = pr.id then 'cargo' else 'vessel' end as side
      from public.fixture_proposals pr
      join public.fixture_terms t
        on t.id = pr.term_id
       and (t.cargo_proposal_id = pr.id or t.vessel_proposal_id = pr.id)
       and t.status in ('open', 'countered')
      join public.fixture_rooms rm on rm.id = t.room_id
     where pr.expires_at is not null
       and pr.expires_at < now()
       and rm.status not in ('withdrawn', 'failed', 'expired', 'fixed')
       and not exists (
         select 1 from public.fixture_events e
          where e.room_id = t.room_id
            and e.type = 'proposal.lapsed'
            and e.payload->>'proposalId' = pr.id::text)
     order by pr.expires_at, pr.id
     limit v_limit
  loop
    -- the room lock every command takes; a room another session holds is left for the next run
    select * into r from public.fixture_rooms x where x.id = rec.room_id for update skip locked;
    if not found then continue; end if;
    if r.status in ('withdrawn', 'failed', 'expired', 'fixed') then continue; end if;
    -- re-check under the lock: a submit may have written the observation meanwhile
    if exists (
      select 1 from public.fixture_events e
       where e.room_id = r.id and e.type = 'proposal.lapsed'
         and e.payload->>'proposalId' = rec.proposal_id::text) then
      continue;
    end if;
    if not exists (
      select 1 from public.fixture_terms t
       where t.id = rec.term_id and t.status in ('open', 'countered')
         and (t.cargo_proposal_id = rec.proposal_id or t.vessel_proposal_id = rec.proposal_id)) then
      continue;
    end if;
    perform public.fn_fixture_event(
      r.id, 'proposal.lapsed', null, null, null, false,
      'sweep_fixture_proposal_lapses', 'sweep:' || rec.proposal_id::text, null,
      jsonb_build_object(
        'proposalId', rec.proposal_id, 'termId', rec.term_id, 'termCode', rec.term_code,
        'side', rec.side, 'displayValue', rec.display_value, 'expiredAt', rec.expires_at,
        'source', 'sweep'),
      null);
    v_swept := v_swept + 1;
    if not (r.id = any (v_rooms)) then v_rooms := v_rooms || r.id; end if;
  end loop;
  return jsonb_build_object('ok', true, 'swept', v_swept, 'rooms', coalesce(array_length(v_rooms, 1), 0), 'limit', v_limit);
end $$;

revoke all on function public.sweep_fixture_proposal_lapses(integer) from public, anon, authenticated;
grant execute on function public.sweep_fixture_proposal_lapses(integer) to service_role;

comment on function public.sweep_fixture_proposal_lapses(integer) is
  'Fixture Room: service-only sweep that appends one proposal.lapsed observation (no actor, rendered "System") for every live proposal whose validity has passed in a room that is still negotiating, moving the room version so pollers refresh. Idempotent through the ledger; SKIP LOCKED per room; touches nothing else. Scheduling belongs to the owner.';

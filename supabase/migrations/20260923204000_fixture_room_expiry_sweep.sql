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

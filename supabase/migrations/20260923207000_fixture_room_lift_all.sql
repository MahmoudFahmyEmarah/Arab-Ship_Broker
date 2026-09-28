-- Fixture Room · lift all subjects in one governed command (C2O-012 item 5, 28 Sep 2026)
-- Migration 20260923207000, inside the reserved Fixture range 2026092320xxxx–2026092324xxxx.
--
-- The design's footer offers "Lift all subjects". The browser must not loop over
-- lift_fixture_subject (one gesture would become several commands, each with its
-- own version race). lift_all_fixture_subjects lifts, under one lock, one
-- version check and one idempotency key, every open subject the representing
-- party may lift (no responsible side, or its own side). Each lift is its own
-- ledger event, exactly as lift_fixture_subject records it; when no subject is
-- left open the room is clean fixed, the listings are asked to sync and the
-- recap is invalidated, as for a single lift. Subjects the other side is
-- responsible for stay open and are reported back.
--
-- Replay equality (C2O-012 item 1): the command's outcome is computed before
-- anything is written, and that one typed aggregate ({lifted, openSubjects,
-- roomStatus, subjectIds}) is stored as the result of the first event; every
-- later event of the command carries no result. A retry with the same key
-- therefore replays exactly the response the first call returned (same data,
-- event id and final version; only "replayed" differs).
-- Additive: lift_fixture_subject and every earlier migration are unchanged.

create or replace function public.lift_all_fixture_subjects(
  p_room_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        s public.fixture_subjects; v_ev jsonb; v_first jsonb; v_ids uuid[]; v_lifted int; v_open int; v_fixed boolean; v_result jsonb;
begin
  v_actor := public.fn_fixture_actor();
  r := public.fn_fixture_lock(p_room_id);
  v_hash := md5(jsonb_build_object('cmd', 'lift_all_fixture_subjects', 'as', p_as_party_id, 'behalf', p_on_behalf_of_party_id)::text);
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

  -- the outcome first, under the room lock: which subjects this command lifts and what is left
  select coalesce(array_agg(x.id order by x.seq), '{}'::uuid[]) into v_ids
    from (select x.id, x.seq from public.fixture_subjects x
           where x.room_id = r.id and x.status = 'open' and (x.responsible_side is null or x.responsible_side = rep.side)
           order by x.seq for update) x;
  v_lifted := coalesce(array_length(v_ids, 1), 0);
  if v_lifted = 0 then
    raise exception 'FX_STATE: no open subject is yours to lift' using errcode = '55000';
  end if;
  select count(*) - v_lifted into v_open from public.fixture_subjects x where x.room_id = r.id and x.status = 'open';
  v_fixed := v_open = 0;
  v_result := jsonb_build_object('lifted', v_lifted, 'openSubjects', v_open, 'roomStatus', case when v_fixed then 'fixed' else 'on_subjects' end,
                                 'subjectIds', to_jsonb(v_ids));

  for s in select * from public.fixture_subjects x where x.id = any (v_ids) order by x.seq loop
    v_ev := public.fn_fixture_event(r.id, 'subject.lifted', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
      'lift_all_fixture_subjects', p_idempotency_key, v_hash,
      jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'title', s.title, 'liftedBySide', rep.side, 'bulk', true),
      case when v_first is null then v_result end);   -- the one result of the command, on its first event
    v_first := coalesce(v_first, v_ev);
    update public.fixture_subjects set status = 'lifted', resolved_at = now(), resolved_by_party_id = rep.id, resolved_event_id = (v_ev->>'eventId')::bigint where id = s.id;
  end loop;

  if v_fixed then
    update public.fixture_rooms set status = 'fixed', fixed_at = now() where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.fixed', v_actor, acting.id, null, false, 'lift_all_fixture_subjects', p_idempotency_key, v_hash,
      jsonb_build_object('fixedAt', now(), 'liftedTogether', v_lifted), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'FIXED'), 'fixed', v_actor, acting.id, p_idempotency_key, v_hash);
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'subjects lifted', p_idempotency_key, v_hash);
  -- exactly what a replay returns: the first event's id and result, at the command's final version
  return v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id), 'data', v_result);
end $$;
revoke all on function public.lift_all_fixture_subjects(uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.lift_all_fixture_subjects(uuid, integer, text, uuid, uuid) to authenticated, service_role;

comment on function public.lift_all_fixture_subjects(uuid, integer, text, uuid, uuid) is
  'Fixture Room (C2O-012 item 5): lifts every open subject the representing party may lift, one ledger event each, under one lock, version check and idempotency key; clean-fixes the room when none is left.';

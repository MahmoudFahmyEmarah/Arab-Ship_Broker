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
-- Additive: lift_fixture_subject and every earlier migration are unchanged.

create or replace function public.lift_all_fixture_subjects(
  p_room_id uuid, p_expected_version integer, p_idempotency_key text,
  p_as_party_id uuid default null, p_on_behalf_of_party_id uuid default null)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid; r public.fixture_rooms; v_hash text; v_replay jsonb; acting public.fixture_parties; rep public.fixture_parties;
        s public.fixture_subjects; v_ev jsonb; v_first jsonb; v_lifted int := 0; v_open int; v_fixed boolean := false;
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

  for s in select * from public.fixture_subjects x
            where x.room_id = r.id and x.status = 'open' and (x.responsible_side is null or x.responsible_side = rep.side)
            order by x.seq for update loop
    v_ev := public.fn_fixture_event(r.id, 'subject.lifted', v_actor, acting.id, case when rep.id <> acting.id then rep.id end, rep.id <> acting.id,
      'lift_all_fixture_subjects', p_idempotency_key, v_hash,
      jsonb_build_object('subjectId', s.id, 'seq', s.seq, 'title', s.title, 'liftedBySide', rep.side, 'bulk', true),
      jsonb_build_object('subjectId', s.id, 'subjectStatus', 'lifted'));
    v_first := coalesce(v_first, v_ev);
    update public.fixture_subjects set status = 'lifted', resolved_at = now(), resolved_by_party_id = rep.id, resolved_event_id = (v_ev->>'eventId')::bigint where id = s.id;
    v_lifted := v_lifted + 1;
  end loop;
  if v_lifted = 0 then
    raise exception 'FX_STATE: no open subject is yours to lift' using errcode = '55000';
  end if;

  select count(*) into v_open from public.fixture_subjects x where x.room_id = r.id and x.status = 'open';
  if v_open = 0 then
    update public.fixture_rooms set status = 'fixed', fixed_at = now() where id = r.id;
    perform public.fn_fixture_event(r.id, 'room.fixed', v_actor, acting.id, null, false, 'lift_all_fixture_subjects', p_idempotency_key, v_hash,
      jsonb_build_object('fixedAt', now(), 'liftedTogether', v_lifted), null);
    perform public.fn_fixture_listing_sync_require(r.id, jsonb_build_object('cargo_status', 'OUT', 'vessel_status', 'FIXED'), 'fixed', v_actor, acting.id, p_idempotency_key, v_hash);
    v_fixed := true;
  end if;
  perform public.fn_fixture_invalidate_recap(r.id, v_actor, acting.id, 'subjects lifted', p_idempotency_key, v_hash);
  return (v_first || jsonb_build_object('version', (select max(e.seq) from public.fixture_events e where e.room_id = r.id)))
         || jsonb_build_object('data', (v_first->'data') || jsonb_build_object('lifted', v_lifted, 'openSubjects', v_open,
                                                                              'roomStatus', case when v_fixed then 'fixed' else 'on_subjects' end));
end $$;
revoke all on function public.lift_all_fixture_subjects(uuid, integer, text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.lift_all_fixture_subjects(uuid, integer, text, uuid, uuid) to authenticated, service_role;

comment on function public.lift_all_fixture_subjects(uuid, integer, text, uuid, uuid) is
  'Fixture Room (C2O-012 item 5): lifts every open subject the representing party may lift, one ledger event each, under one lock, version check and idempotency key; clean-fixes the room when none is left.';

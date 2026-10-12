-- DOWN for 20261012100000_fixture_extension_authority_first: restores propose_/respond_fixture_subject_extension exactly as
-- 20261009200000 released them (Wave 5). Bodies and grants only.
set local lock_timeout = '5s';

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

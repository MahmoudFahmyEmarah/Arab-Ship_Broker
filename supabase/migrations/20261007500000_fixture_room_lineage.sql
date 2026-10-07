-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · a recreated room records, through the ledger, the room it continues (7–8 Oct 2026)
--
-- fixture_rooms.supersedes_room_id exists since 20260923200000 and the room read returns it (supersedesRoomId), but
-- no command wrote it. recreate_fixture_room (last defined in 20260923208000) now (C2O-084):
--   * binds its idempotency to the predecessor: a key this actor already used returns that room ONLY when it is
--     this predecessor's successor; a key used by a plain create, for another predecessor, or a self/cyclic answer
--     is refused (FX_IDEMPOTENCY) — and a live source can no longer be bypassed by naming an old key;
--   * allows one successor per predecessor (a partial unique index; FX_STATE names the existing successor);
--   * records the lineage through the ledger: supersedes_room_id is set on the new room together with a dedicated
--     immutable event room.continued_from (version + 1), and the returned version is the room's final version;
--   * every refusal happens before any write.
--
-- Idempotent. DOWN: supabase/rollback/20261007_fixture_room_lineage_down.sql
-- ════════════════════════════════════════════════════════════════════════

-- ── 1 · event type ──────────────────────────────────────────────────────────
-- term.bridge_suggested's list (20261007400000) plus room.continued_from; the saved 'down:' comment is carried over.
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

-- ── 2 · one successor per predecessor ──────────────────────────────────────
create unique index if not exists fixture_rooms_one_successor_uq
  on public.fixture_rooms (supersedes_room_id) where supersedes_room_id is not null;

-- ── 3 · recreate ────────────────────────────────────────────────────────────
create or replace function public.recreate_fixture_room(
  p_room_id uuid, p_terms jsonb, p_idempotency_key text, p_options jsonb default '{}'::jsonb)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid := public.fn_fixture_actor(); r public.fixture_rooms; v jsonb; v_room public.fixture_rooms;
        v_prior public.fixture_rooms; v_next public.fixture_rooms; v_ev jsonb;
begin
  select * into r from public.fixture_rooms x where x.id = p_room_id;
  if r.id is null or not public.fn_can_access_fixture(r.id) then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  -- idempotency bound to the predecessor: a key this actor already used is a replay only of THIS recreate
  select * into v_prior from public.fixture_rooms x where x.created_by_user_id = v_actor and x.create_idempotency_key = p_idempotency_key;
  if v_prior.id is not null then
    if v_prior.supersedes_room_id is distinct from r.id or v_prior.id = r.id then
      raise exception 'FX_IDEMPOTENCY: this key already opened another room; use a new key to start this negotiation again' using errcode = '22023';
    end if;
    return jsonb_build_object('ok', true, 'version', v_prior.version, 'eventId', null, 'replayed', true,
                              'data', jsonb_build_object('roomId', v_prior.id, 'ref', v_prior.ref, 'status', v_prior.status));
  end if;
  if not public.fn_fixture_terminal(r.status) then
    raise exception 'FX_STATE: only a closed negotiation can be started again (this one is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  select * into v_next from public.fixture_rooms x where x.supersedes_room_id = r.id;
  if v_next.id is not null then
    raise exception 'FX_STATE: % was already started again as %', r.ref, v_next.ref using errcode = '55000';
  end if;
  v := public.create_fixture_room(r.cargo_listing_id, r.vessel_availability_id, p_terms, p_idempotency_key, p_options);
  select * into v_room from public.fixture_rooms x where x.id = (v->'data'->>'roomId')::uuid;
  -- the new room must be new, on the same pairing, and still unlinked; otherwise nothing of this call survives
  if v_room.id is null or v_room.id = r.id or coalesce((v->>'replayed')::boolean, false) or v_room.supersedes_room_id is not null
     or v_room.cargo_listing_id is distinct from r.cargo_listing_id or v_room.vessel_availability_id is distinct from r.vessel_availability_id then
    raise exception 'FX_STATE: the negotiation could not be started again on the same pairing' using errcode = '55000';
  end if;
  update public.fixture_rooms set supersedes_room_id = r.id where id = v_room.id;
  v_ev := public.fn_fixture_event(v_room.id, 'room.continued_from', v_actor, v_room.created_by_party_id, null, false,
    'recreate_fixture_room', null, null,
    jsonb_build_object('previousRoomId', r.id, 'previousRef', r.ref, 'previousStatus', r.status),
    jsonb_build_object('roomId', v_room.id, 'previousRoomId', r.id));
  select * into v_room from public.fixture_rooms x where x.id = v_room.id;
  return jsonb_build_object('ok', true, 'version', v_room.version, 'eventId', v->'eventId', 'replayed', false,
                            'data', jsonb_build_object('roomId', v_room.id, 'ref', v_room.ref, 'status', v_room.status));
end $$;
revoke all on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) to authenticated, service_role;

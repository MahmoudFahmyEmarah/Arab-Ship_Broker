-- ════════════════════════════════════════════════════════════════════════
-- Fixture Room · a recreated room records the room it continues (7 Oct 2026)
--
-- fixture_rooms.supersedes_room_id exists since 20260923200000 and the room
-- read returns it (supersedesRoomId), but no command ever wrote it: every
-- recreated room showed no predecessor (found by the e2e teardown proof,
-- O2C-054). recreate_fixture_room (last defined in 20260923208000) now sets
-- it on the new room — once, on the same pairing only; a replay changes
-- nothing. Everything else is the released body unchanged.
--
-- Idempotent. DOWN: supabase/rollback/20261007_fixture_room_lineage_down.sql
-- ════════════════════════════════════════════════════════════════════════

create or replace function public.recreate_fixture_room(
  p_room_id uuid, p_terms jsonb, p_idempotency_key text, p_options jsonb default '{}'::jsonb)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v_actor uuid := public.fn_fixture_actor(); r public.fixture_rooms; v jsonb; v_room public.fixture_rooms;
begin
  select * into r from public.fixture_rooms x where x.id = p_room_id;
  if r.id is null or not public.fn_can_access_fixture(r.id) then
    raise exception 'FX_NOT_FOUND: room % not found', p_room_id using errcode = 'P0002';
  end if;
  -- a retry of an earlier recreate replays through create_fixture_room's own rule; a first
  -- call needs the old negotiation to be over
  if not public.fn_fixture_terminal(r.status)
     and not exists (select 1 from public.fixture_rooms x where x.created_by_user_id = v_actor and x.create_idempotency_key = p_idempotency_key) then
    raise exception 'FX_STATE: only a closed negotiation can be started again (this one is %)', replace(r.status, '_', ' ') using errcode = '55000';
  end if;
  v := public.create_fixture_room(r.cargo_listing_id, r.vessel_availability_id, p_terms, p_idempotency_key, p_options);
  -- the lineage the room read already exposes (supersedesRoomId): the new room continues this one. Set once, on
  -- the same pairing only; a replay finds it set and changes nothing.
  update public.fixture_rooms x set supersedes_room_id = r.id
   where x.id = (v->'data'->>'roomId')::uuid and x.id <> r.id and x.supersedes_room_id is null
     and x.cargo_listing_id = r.cargo_listing_id and x.vessel_availability_id = r.vessel_availability_id;
  select * into v_room from public.fixture_rooms x where x.id = (v->'data'->>'roomId')::uuid;
  return jsonb_build_object('ok', true, 'version', v->'version', 'eventId', v->'eventId', 'replayed', coalesce((v->>'replayed')::boolean, false),
                            'data', jsonb_build_object('roomId', v_room.id, 'ref', v_room.ref, 'status', v_room.status));
end $$;
revoke all on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) to authenticated, service_role;

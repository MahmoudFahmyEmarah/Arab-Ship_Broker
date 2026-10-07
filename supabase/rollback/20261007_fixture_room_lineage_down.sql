-- ════════════════════════════════════════════════════════════════════════
-- DOWN · 20261007500000_fixture_room_lineage.sql — restores recreate_fixture_room exactly as 20260923208000 defined
-- it, drops the one-successor index, and narrows the event CHECK back to 20261007400000's list.
-- Ledger rows are never deleted: with any room.continued_from event this DOWN refuses (roll forward instead).
-- Lineage values already written are kept (no command reads them).
-- Run in one transaction: psql -v ON_ERROR_STOP=1 -1 -f <this file>
-- ════════════════════════════════════════════════════════════════════════

set constraints all immediate;

do $$
declare v_used int;
begin
  select count(*) into v_used from public.fixture_events where type = 'room.continued_from';
  if v_used > 0 then
    raise exception 'FX_DOWN_REFUSED: % lineage event(s) are in the ledger; roll forward instead', v_used using errcode = '55000';
  end if;
end $$;

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
  select * into v_room from public.fixture_rooms x where x.id = (v->'data'->>'roomId')::uuid;
  return jsonb_build_object('ok', true, 'version', v->'version', 'eventId', v->'eventId', 'replayed', coalesce((v->>'replayed')::boolean, false),
                            'data', jsonb_build_object('roomId', v_room.id, 'ref', v_room.ref, 'status', v_room.status));
end $$;
revoke all on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) from public, anon;
grant execute on function public.recreate_fixture_room(uuid, jsonb, text, jsonb) to authenticated, service_role;

drop index if exists public.fixture_rooms_one_successor_uq;

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
    'listing_sync.required','listing_sync.applied','pda.linked','room.closed'));
  if v_comment is not null then
    execute format('comment on constraint fixture_events_type_check on public.fixture_events is %L', v_comment);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- DOWN · 20261007400000_fixture_bridge_suggestion.sql
--
-- Drops suggest_fixture_bridge and fn_fixture_live_bridges and restores
-- get_fixture_room exactly as 20260923208000 defined it (no `bridges`).
-- Ledger rows are never deleted: with any term.bridge_suggested event the
-- DOWN refuses (roll forward); otherwise the event CHECK goes back to the
-- 20261006100000 list, carrying the saved 'down:' comment.
-- Run in one transaction: psql -v ON_ERROR_STOP=1 -1 -f <this file>
-- ════════════════════════════════════════════════════════════════════════

set constraints all immediate;

-- With mediator suggestions in the ledger this DOWN refuses (C2O-089 P1): ledger rows are never deleted, and a
-- widened CHECK left behind would make the older enforcement DOWN (which restores its saved list) fail later.
-- Roll forward instead.
do $$
declare v_used int;
begin
  select count(*) into v_used from public.fixture_events where type = 'term.bridge_suggested';
  if v_used > 0 then
    raise exception 'FX_DOWN_REFUSED: % mediator suggestion event(s) are in the ledger; this DOWN would leave a CHECK the older DOWNs cannot restore — roll forward instead', v_used
      using errcode = '55000';
  end if;
end $$;

drop function if exists public.suggest_fixture_bridge(uuid, uuid, jsonb, text, integer, text);

create or replace function public.get_fixture_room(p_room_id uuid, p_events_after integer default 0)
 returns jsonb language plpgsql volatile security definer set search_path to 'public'
as $$
declare v jsonb; v_avail uuid; v_vessel uuid; v_name text; v_imo text;
begin
  v := public.fn_fixture_room_read_unscrubbed(p_room_id, p_events_after);
  if coalesce((v->'snapshot'->>'vesselIdentityMasked')::boolean, false) then
    select x.vessel_availability_id, x.vessel_id, x.vessel_snapshot->'vessel'->>'vessel_name', x.vessel_snapshot->'vessel'->>'imo_number'
      into v_avail, v_vessel, v_name, v_imo from public.fixture_rooms x where x.id = p_room_id;
    -- every occurrence, in every string (ids, messages, comments, titles, notes, event payloads);
    -- the hidden hull's name (with and without an MV prefix) and IMO are withheld too
    v := public.fn_fixture_scrub_masked(v, array[v_avail, v_vessel],
           array[v_name, regexp_replace(coalesce(v_name, ''), '^\s*(m\s*/\s*v|mv|m\.v\.)\s+', '', 'i'), v_imo]);
  end if;
  return v;
end $$;
revoke all on function public.get_fixture_room(uuid, integer) from public, anon;
grant execute on function public.get_fixture_room(uuid, integer) to authenticated, service_role;
comment on function public.get_fixture_room(uuid, integer) is
  'Fixture Room read (C2O-013/014): the 202000 read model, with every availability and vessel uuid removed (JSON-safe, recursive, substring and case-insensitive) for a viewer the TBN hull is masked from.';

drop function if exists public.fn_fixture_live_bridges(uuid);

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
    'subject.added','subject.lifted','subject.failed','subject.extended','subject.reinstated',
    'room.fix_confirmed','room.fixed_on_subjects','room.fixed','room.returned_to_negotiation','room.window_extended',
    'recap.published','recap.acknowledged','recap.invalidated',
    'message.posted','message.redacted',
    'listing_sync.required','listing_sync.applied','pda.linked','room.closed'));
  if v_comment is not null then
    execute format('comment on constraint fixture_events_type_check on public.fixture_events is %L', v_comment);
  end if;
end $$;
